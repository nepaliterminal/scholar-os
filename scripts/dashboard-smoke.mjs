import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardUrl = pathToFileURL(resolve(here, '../index.html')).href;
const chromeCandidates = [
  process.env.SCHOLAROS_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

let chromePath = null;
for (const candidate of chromeCandidates) {
  try {
    await access(candidate);
    chromePath = candidate;
    break;
  } catch {
    // Try the next common Chrome location.
  }
}
if (!chromePath) throw new Error('Chrome was not found. Set SCHOLAROS_CHROME to its executable path.');

const profileDir = await mkdtemp(join(tmpdir(), 'scholaros-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  dashboardUrl,
], { stdio: 'ignore' });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
let socket;

try {
  const portFile = join(profileDir, 'DevToolsActivePort');
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      port = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
      break;
    } catch {
      await delay(50);
    }
  }
  if (!port) throw new Error('Chrome did not expose a DevTools port.');

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && item.url.startsWith('file:'));
  if (!target) throw new Error('ScholarOS page was not opened by Chrome.');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const runtimeErrors = [];
  const eventWaiters = new Map();
  let sequence = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCall, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCall(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    const waiters = eventWaiters.get(message.method) || [];
    eventWaiters.delete(message.method);
    for (const resolveEvent of waiters) resolveEvent(message.params);
  });

  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const call = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
  };
  const waitFor = (method) => new Promise((resolveEvent) => {
    eventWaiters.set(method, [...(eventWaiters.get(method) || []), resolveEvent]);
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('scholaros.g6.accounts', JSON.stringify([{ name: 'Smoke Test', pin: null, avatar: '🧪' }]));
    localStorage.setItem('scholaros.g6.current', 'Smoke Test');
  })()`);
  const loaded = waitFor('Page.loadEventFired');
  await call('Page.reload');
  await loaded;
  await delay(250);

  const initial = await evaluate(`({
    overlayHidden: document.querySelector('#accountOverlay').classList.contains('hidden'),
    account: window.ScholarOS.getSnapshot()?.account,
    subjectCount: document.querySelector('#studySubject').options.length,
    connectionText: document.querySelector('#studyConnection').innerText,
    alexaText: document.querySelector('#alexaConnection').innerText,
    alexaControlsDisabled: document.querySelector('#alexaSpeakBtn').disabled,
  })`);
  assert.equal(initial.overlayHidden, true);
  assert.equal(initial.account, 'Smoke Test');
  assert.ok(initial.subjectCount >= 1);
  assert.match(initial.connectionText, /Extension not detected/);
  assert.match(initial.alexaText, /Extension not detected/);
  assert.equal(initial.alexaControlsDisabled, true);

  const integration = await evaluate(`(() => {
    const completion = {
      id: 'evt_smoke_completed', version: 1, type: 'session.completed', occurredAt: new Date().toISOString(),
      payload: {
        sessionId: 'session_smoke', scholarAccount: 'Smoke Test', subject: 'Science',
        intention: 'Verify ScholarOS sync', plannedMinutes: 25, focusedMinutes: 24.5,
        completed: true, blockedAttempts: 0, captureCount: 1, suggestedStars: 5,
        startedAt: new Date(Date.now() - 1470000).toISOString(), endedAt: new Date().toISOString()
      }
    };
    const firstAck = window.ScholarOS.processEvents([completion]);
    const replayAck = window.ScholarOS.processEvents([completion]);
    const relatedAck = window.ScholarOS.processEvents([
      { id: 'evt_smoke_reflection', version: 1, type: 'session.reflected', occurredAt: new Date().toISOString(), payload: { sessionId: 'session_smoke', scholarAccount: 'Smoke Test', rating: 'done', reflection: 'The bridge works.' } },
      { id: 'evt_smoke_capture', version: 1, type: 'capture.created', occurredAt: new Date().toISOString(), payload: { id: 'capture_smoke', sessionId: 'session_smoke', scholarAccount: 'Smoke Test', subject: 'Science', kind: 'highlight', quote: 'A useful fact', title: 'Smoke source', createdAt: new Date().toISOString() } },
      { id: 'evt_smoke_request', version: 1, type: 'unblock.requested', occurredAt: new Date().toISOString(), payload: { id: 'request_smoke', sessionId: 'session_smoke', scholarAccount: 'Smoke Test', subject: 'Science', site: 'example.com', reason: 'Teacher link', status: 'pending', createdAt: new Date().toISOString() } }
    ]);
    const wrongAccountAck = window.ScholarOS.processEvents([
      { id: 'evt_wrong_account', version: 1, type: 'session.completed', occurredAt: new Date().toISOString(), payload: { sessionId: 'session_wrong', scholarAccount: 'Someone Else', subject: 'Math', focusedMinutes: 10, suggestedStars: 5 } }
    ]);
    const snapshot = window.ScholarOS.getSnapshot();
    return {
      firstAck, replayAck, relatedAck, wrongAccountAck,
      stars: snapshot.stars,
      sessions: snapshot.studySessions.length,
      sessionResult: document.querySelector('#studySessionsTable').innerText,
      captureResult: document.querySelector('#studyCaptureList').innerText,
      requestResult: document.querySelector('#studyRequestList').innerText,
      weekTotal: document.querySelector('#studyWeekTotal').innerText,
      completionRate: document.querySelector('#studyCompletionRate').innerText,
      focusStreak: document.querySelector('#studyFocusStreak').innerText,
      subjectAnalytics: document.querySelector('#studySubjectBreakdown').innerText,
      report: buildReport(),
    };
  })()`);

  assert.deepEqual(integration.firstAck, ['evt_smoke_completed']);
  assert.deepEqual(integration.replayAck, ['evt_smoke_completed']);
  assert.equal(integration.relatedAck.length, 3);
  assert.deepEqual(integration.wrongAccountAck, []);
  assert.equal(integration.stars, 5, 'a replayed completion must not duplicate study stars');
  assert.equal(integration.sessions, 1, 'a replayed completion must not duplicate history');
  assert.match(integration.sessionResult, /Science/);
  assert.match(integration.captureResult, /A useful fact/);
  assert.match(integration.requestResult, /Teacher link/);
  assert.equal(integration.weekTotal, '25 min');
  assert.equal(integration.completionRate, '100%');
  assert.equal(integration.focusStreak, '1 day');
  assert.match(integration.subjectAnalytics, /Science/);
  assert.match(integration.report, /Focus today: 25 min across 1 session/);

  const alexaPrivacy = await evaluate(`(() => {
    const privateDeviceName = 'Private Bedroom Echo';
    const privateDeviceId = 'device_private_identifier';
    const privateRoutineName = 'Private Morning Routine';
    const privateRoutineId = 'routine_private_identifier';
    const privateMessage = 'A private message that must never be stored';
    alexaBridgeState = normalizeAlexaStatus({
      connected: true,
      devices: [{ id: privateDeviceId, name: privateDeviceName, online: true }],
      routines: [{ id: privateRoutineId, name: privateRoutineName }],
    });
    studyExtensionAvailable = true;
    alexaSelectedDeviceId = privateDeviceId;
    document.querySelector('#alexaMessage').value = privateMessage;
    renderAlexaControls();
    const stored = Object.values(localStorage).join('\\n');
    const actionArea = document.querySelector('.alexa-home-actions').getBoundingClientRect();
    const actionButtons = [...document.querySelectorAll('.alexa-home-actions .alexa-button')].map(element => element.getBoundingClientRect());
    return {
      deviceRendered: document.querySelector('#alexaDevice').innerText,
      routineRendered: document.querySelector('#alexaRoutine').innerText,
      leaked: [privateDeviceName, privateDeviceId, privateRoutineName, privateRoutineId, privateMessage]
        .some(value => stored.includes(value)),
      persistentAlexaHistory: stored.includes('alexaActions'),
      actionsStayInsideCard: actionButtons.every(rect => rect.left >= actionArea.left - 1 && rect.right <= actionArea.right + 1),
      actionRows: new Set(actionButtons.map(rect => Math.round(rect.top))).size,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`);
  assert.match(alexaPrivacy.deviceRendered, /Private Bedroom Echo/);
  assert.match(alexaPrivacy.routineRendered, /Private Morning Routine/);
  assert.equal(alexaPrivacy.leaked, false, 'Alexa names, IDs, and message text must not enter localStorage');
  assert.equal(alexaPrivacy.persistentAlexaHistory, false, 'Alexa action history must remain memory-only');
  assert.equal(alexaPrivacy.actionsStayInsideCard, true, 'mobile Alexa actions must stay inside their card');
  assert.ok(alexaPrivacy.actionRows >= 2, 'mobile Alexa actions should use more than one row');
  assert.equal(alexaPrivacy.horizontalOverflow, false, 'mobile ScholarOS must not overflow horizontally');
  assert.deepEqual(runtimeErrors, []);

  if (process.env.SCHOLAROS_SCREENSHOT) {
    await evaluate(`document.querySelector('.alexa-home-actions').scrollIntoView({ block: 'center' })`);
    await delay(100);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(process.env.SCHOLAROS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }

  console.log(JSON.stringify({
    dashboardLoaded: true,
    accountMigration: true,
    eventSyncRendered: true,
    analyticsRendered: true,
    alexaPersonalDataStayedInMemory: true,
    replaySafeStars: integration.stars,
    crossAccountEventHeld: true,
    runtimeErrors: runtimeErrors.length,
  }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await rm(profileDir, { recursive: true, force: true });
}
