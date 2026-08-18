import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(scriptDirectory, '..');
const extensionName = JSON.parse(
  await readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'),
).name;
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/homebrew/bin/chromium',
  '/usr/local/bin/chromium',
  '/usr/bin/chromium',
].filter(Boolean);

let chromeBinary = null;
for (const candidate of chromeCandidates) {
  try {
    await access(candidate, constants.X_OK);
    chromeBinary = candidate;
    break;
  } catch {
    // Continue through the explicit Chrome-for-Testing/Chromium candidates.
  }
}
if (!chromeBinary) {
  throw new Error(
    'Chrome for Testing or Chromium is required for extension smoke checks. ' +
    'Branded Google Chrome blocks command-line extension loading; set CHROME_BIN ' +
    'to a Chrome for Testing or Chromium executable.',
  );
}
const profileDirectory = await mkdtemp(path.join(tmpdir(), 'studyx-chrome-smoke-'));

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('Could not reserve a Chrome debugging port.');
  return port;
}

const port = await availablePort();
let stderr = '';
const chrome = spawn(chromeBinary, [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--window-position=-10000,-10000',
  '--window-size=800,600',
  `--disable-extensions-except=${extensionDirectory}`,
  `--load-extension=${extensionDirectory}`,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

async function stopChrome() {
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chrome.once('exit', resolve)),
      delay(2_000),
    ]);
  }
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  await rm(profileDirectory, { recursive: true, force: true });
}

async function workerExtensionName(target) {
  return new Promise((resolve) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const finish = (value) => {
      clearTimeout(timeout);
      socket.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 1_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: 'chrome.runtime.getManifest().name', returnByValue: true },
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) finish(message.result?.result?.value || null);
    });
    socket.addEventListener('error', () => finish(null));
  });
}

try {
  let worker;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const workers = targets.filter((target) =>
        target.type === 'service_worker' && target.url.endsWith('/background.js'));
      for (const candidate of workers) {
        if (await workerExtensionName(candidate) === extensionName) {
          worker = candidate;
          break;
        }
      }
      if (worker) break;
    } catch {
      // Chrome may not have opened its debugging socket yet.
    }
    if (chrome.exitCode !== null) throw new Error(`Chrome exited early.\n${stderr}`);
    await delay(125);
  }
  if (!worker) throw new Error(`The extension service worker did not start.\n${stderr}`);

  const extensionId = new URL(worker.url).hostname;
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const opened = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(popupUrl)}`,
    { method: 'PUT' },
  );
  if (!opened.ok) throw new Error(`Could not open the extension popup (${opened.status}).`);

  const smoke = spawn(process.execPath, [path.join(scriptDirectory, 'chrome-smoke.mjs'), String(port)], {
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    smoke.once('error', reject);
    smoke.once('exit', resolve);
  });
  if (exitCode !== 0) throw new Error(`Chrome smoke checks exited with code ${exitCode}.`);
} finally {
  await stopChrome();
}
