const port = Number(process.argv[2] || 9223);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.endsWith('/popup.html'));
if (!target) throw new Error('Open the extension popup page before running the Chrome smoke test.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const runtimeErrors = [];
let sequence = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function call(method, params = {}) {
  const requestId = ++sequence;
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function evaluateTarget(targetInfo, expression) {
  const targetSocket = new WebSocket(targetInfo.webSocketDebuggerUrl);
  let targetSequence = 0;
  const targetPending = new Map();
  targetSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !targetPending.has(message.id)) return;
    const { resolve, reject } = targetPending.get(message.id);
    targetPending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    targetSocket.addEventListener('open', resolve, { once: true });
    targetSocket.addEventListener('error', reject, { once: true });
  });
  const targetCall = (method, params = {}) => {
    const id = ++targetSequence;
    targetSocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => targetPending.set(id, { resolve, reject }));
  };
  try {
    await targetCall('Runtime.enable');
    let result;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        result = await targetCall('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        break;
      } catch (error) {
        if (!/execution context|navigated or closed/i.test(error.message) || attempt === 79) throw error;
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
    }
    if (!result) throw new Error('The target page did not create an execution context.');
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  } finally {
    targetSocket.close();
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
await call('Runtime.enable');
await delay(350);

const initial = await evaluate(`({
  title: document.title,
  ready: document.readyState,
  hasStartForm: Boolean(document.querySelector('#startForm')),
  bodyText: document.body.innerText.slice(0, 120)
})`);
if (initial.title !== 'Study Session OS' || !initial.hasStartForm) {
  throw new Error(`Popup did not load correctly: ${JSON.stringify(initial)}`);
}

const start = await evaluate(`chrome.runtime.sendMessage({
  type: 'studyx.startSession',
  session: {
    subject: 'Smoke Test',
    intention: 'Verify the extension lifecycle',
    brainDump: 'Persistent state, blocking, capture, recap.',
    durationMinutes: 5
  }
})`);
if (!start?.ok) throw new Error(`Could not start smoke session: ${start?.error}`);
await delay(500);

const active = await evaluate(`(async () => {
  const state = await chrome.runtime.sendMessage({ type: 'studyx.getState' });
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return {
    subject: state.data.current?.subject,
    ruleCount: rules.filter(rule => rule.id >= 1000 && rule.id <= 1999).length,
    activeViewVisible: !document.querySelector('#activeView').classList.contains('hidden')
  };
})()`);
if (active.subject !== 'Smoke Test' || active.ruleCount < 1 || !active.activeViewVisible) {
  throw new Error(`Active session failed smoke checks: ${JSON.stringify(active)}`);
}

const youtubeResponse = await fetch(
  `http://127.0.0.1:${port}/json/new?${encodeURIComponent('https://www.youtube.com/')}`,
  { method: 'PUT' },
);
if (!youtubeResponse.ok) throw new Error(`Could not open the YouTube shield target (${youtubeResponse.status}).`);
const youtubeTarget = await youtubeResponse.json();
const youtubeShield = await evaluateTarget(youtubeTarget, `(async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const style = document.querySelector('#studyx-youtube-shield');
    if (style?.textContent) {
      return {
        url: location.href,
        mode: document.documentElement.getAttribute('data-studyx-shield'),
        bodyFilter: getComputedStyle(document.body).filter,
        htmlFilter: getComputedStyle(document.documentElement).filter,
        targetsThumbnails: style.textContent.includes('ytd-thumbnail img'),
      };
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  return { url: location.href, mode: null, bodyFilter: null, htmlFilter: null, targetsThumbnails: false };
})()`);
await fetch(`http://127.0.0.1:${port}/json/close/${youtubeTarget.id}`);
if (
  youtubeShield.mode !== 'blur' ||
  youtubeShield.bodyFilter !== 'none' ||
  youtubeShield.htmlFilter !== 'none' ||
  !youtubeShield.targetsThumbnails
) {
  throw new Error(`YouTube shield blurred more than thumbnails: ${JSON.stringify(youtubeShield)}`);
}

const stop = await evaluate(`chrome.runtime.sendMessage({ type: 'studyx.stopSession' })`);
if (!stop?.ok) throw new Error(`Could not stop smoke session: ${stop?.error}`);
await delay(400);

const recap = await evaluate(`chrome.runtime.sendMessage({ type: 'studyx.getState' })`);
if (!recap?.data?.pendingRecap || recap.data.pendingRecap.subject !== 'Smoke Test') {
  throw new Error('Stopping the session did not produce a recap.');
}

const save = await evaluate(`chrome.runtime.sendMessage({
  type: 'studyx.saveRecap',
  recap: { rating: 'done', reflection: 'The lifecycle works.' }
})`);
if (!save?.ok) throw new Error(`Could not save smoke recap: ${save?.error}`);

const finalData = await evaluate(`chrome.runtime.sendMessage({ type: 'studyx.getAllData' })`);
const eventTypes = finalData.data.scholarEvents.map(event => event.type);
for (const required of ['session.started', 'session.completed', 'session.reflected']) {
  if (!eventTypes.includes(required)) throw new Error(`Missing outbox event: ${required}`);
}
if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join('; ')}`);

console.log(JSON.stringify({
  popupLoaded: true,
  activeSessionRendered: true,
  dynamicBlockRules: active.ruleCount,
  youtubeThumbnailBlurOnly: true,
  recapSaved: true,
  scholarEvents: eventTypes,
}, null, 2));
socket.close();
