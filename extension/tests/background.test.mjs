import assert from 'node:assert/strict';
import test from 'node:test';

const data = {
  'studyx.settings': {
    settingsVersion: 2,
    scholarOsUrl: 'file:///Users/subed/notion1/scholar-os/index.html',
  },
};
let dynamicRules = [];
let messageListener = null;
let alarmListener = null;
const alexaFetches = [];

globalThis.fetch = async (url, options = {}) => {
  alexaFetches.push({ url: String(url), options });
  const data = String(url).endsWith('/v1/status')
    ? { connected: true, devices: [{ id: 'echo-1', name: 'Study Echo', online: true }], routines: [] }
    : { action: JSON.parse(options.body).action, deviceId: 'echo-1' };
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function storageGet(keys) {
  if (keys == null) return { ...data };
  if (typeof keys === 'string') return { [keys]: data[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[key]]));
  return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, data[key] ?? fallback]));
}

globalThis.chrome = {
  storage: {
    local: {
      setAccessLevel: async () => { throw new Error('simulated managed-browser restriction'); },
      get: async (keys) => storageGet(keys),
      set: async (updates) => Object.assign(data, structuredClone(updates)),
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
    },
    onChanged: { addListener() {} },
  },
  declarativeNetRequest: {
    getDynamicRules: async () => structuredClone(dynamicRules),
    updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
      dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id));
      dynamicRules.push(...structuredClone(addRules));
    },
  },
  alarms: {
    create: async () => {},
    clear: async () => true,
    onAlarm: { addListener(listener) { alarmListener = listener; } },
  },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async () => {},
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => ({ ok: true }),
  },
  runtime: {
    getURL: (path) => `chrome-extension://studyx-test/${path}`,
    onMessage: { addListener(listener) { messageListener = listener; } },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
  },
  commands: { onCommand: { addListener() {} } },
  contextMenus: {
    onClicked: { addListener() {} },
    removeAll(callback) { callback?.(); },
    create() {},
  },
};

await import('../background.js');
await new Promise((resolve) => setTimeout(resolve, 10));

function send(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out handling ${message.type}`)), 1000);
    const keepOpen = messageListener(message, sender, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    assert.equal(keepOpen, true);
  });
}

const extensionSender = { url: 'chrome-extension://studyx-test/options.html' };

test('focus lifecycle, blocking, capture, recap, and ScholarOS outbox', async () => {
  const initial = await send({ type: 'studyx.getState' });
  assert.equal(initial.ok, true);
  assert.equal(initial.data.current, null);
  assert.equal(initial.data.settings.defaultDuration, 25);
  assert.equal(initial.data.settings.hideYouTubeRecommendations, false);
  assert.equal(initial.data.settings.settingsVersion, 4);
  assert.equal(initial.data.settings.scholarOsUrl, 'https://nepaliterminal.github.io/scholar-os/');
  assert.ok(initial.data.settings.blockedSites.includes('reddit.com'));
  const scholarSender = { tab: { url: initial.data.settings.scholarOsUrl } };
  const savedSettings = await send({
    type: 'studyx.saveSettings',
    settings: { ...initial.data.settings, alexaBridgeToken: 'private-test-pairing-token' },
  }, extensionSender);
  assert.equal(savedSettings.ok, true);
  assert.equal(savedSettings.data.alexaBridgeToken, '');
  assert.equal(savedSettings.data.alexaBridgePaired, true);
  const privateSettingsView = await send({ type: 'studyx.getSettings' }, extensionSender);
  assert.equal(privateSettingsView.data.alexaBridgeToken, '');
  assert.equal(privateSettingsView.data.alexaBridgePaired, true);
  const preservedSettings = await send({
    type: 'studyx.saveSettings',
    settings: { ...savedSettings.data, alexaBridgeToken: '' },
  }, extensionSender);
  assert.equal(preservedSettings.data.alexaBridgePaired, true, 'a blank field must preserve an existing pairing');
  const redactedState = await send({ type: 'studyx.getState' });
  assert.equal(redactedState.data.settings.alexaBridgeToken, '');
  assert.equal(redactedState.data.settings.alexaBridgePaired, true);
  const scholarState = await send({ type: 'studyx.getScholarState' }, scholarSender);
  assert.equal(scholarState.ok, true);
  assert.equal('settings' in scholarState.data, false, 'ScholarOS must never receive extension settings or the Alexa token');
  assert.equal(JSON.stringify(scholarState.data).includes('private-test-pairing-token'), false);
  const alexaStatus = await send({ type: 'studyx.alexaStatus' }, scholarSender);
  assert.equal(alexaStatus.ok, true);
  assert.equal(alexaStatus.data.devices[0].name, 'Study Echo');
  const alexaCommand = await send({
    type: 'studyx.alexaCommand',
    command: { action: 'speak', deviceId: 'echo-1', text: 'Time to study.' },
  }, scholarSender);
  assert.equal(alexaCommand.ok, true);
  assert.match(alexaFetches.at(-1).options.headers.Authorization, /^Bearer /);
  const context = await send({
    type: 'studyx.saveScholarContext',
    context: { account: 'Alex', classes: ['Science', 'Math', 'Science'], stars: 17 },
  }, scholarSender);
  assert.equal(context.ok, true);
  assert.deepEqual(context.data.classes, ['Science', 'Math']);

  const started = await send({
    type: 'studyx.startSession',
    session: {
      subject: 'Science',
      intention: 'Review moon phases',
      brainDump: 'The Moon reflects sunlight.',
      durationMinutes: 20,
    },
  });
  assert.equal(started.ok, true);
  assert.equal(started.data.subject, 'Science');
  assert.equal(started.data.scholarAccount, 'Alex');
  assert.equal(dynamicRules.length, initial.data.settings.blockedSites.length);
  assert.ok(dynamicRules.every((rule) => rule.action.type === 'redirect'));

  const capture = await send({
    type: 'studyx.saveCapture',
    capture: {
      kind: 'highlight',
      quote: 'The same side of the Moon always faces Earth.',
      title: 'Moon lesson',
      url: 'https://school.example/moon',
    },
  });
  assert.equal(capture.ok, true);

  await send({ type: 'studyx.blockedAttempt', site: 'reddit.com' });
  await send({ type: 'studyx.blockedAttempt', site: 'reddit.com' });
  const unblockRequest = await send({ type: 'studyx.requestUnblock', site: 'reddit.com', reason: 'A teacher linked a reference thread.' });

  const active = await send({ type: 'studyx.getState' });
  assert.equal(active.data.current.highlightCount, 1);
  assert.equal(active.data.current.captureCount, 1);
  assert.equal(active.data.current.blockedAttempts, 1, 'rapid duplicate redirects and the request must not inflate the count');

  const approved = await send({
    type: 'studyx.resolveUnblock',
    request: { requestId: unblockRequest.data.request.id, decision: 'approve', minutes: 5 },
  }, scholarSender);
  assert.equal(approved.ok, true);
  assert.equal(approved.data.status, 'approved');
  assert.equal(dynamicRules.length, initial.data.settings.blockedSites.length - 1);
  const approvalStatus = await send({
    type: 'studyx.getUnblockStatus', requestId: unblockRequest.data.request.id,
  }, extensionSender);
  assert.equal(approvalStatus.data.status, 'approved');
  data['studyx.siteAllowances'][0].expiresAt = Date.now() - 1;
  alarmListener({ name: 'studyx.allowances.expire' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dynamicRules.length, initial.data.settings.blockedSites.length, 'blocking must return after an allowance expires');
  assert.equal(data['studyx.siteAllowances'].length, 0);

  const stopped = await send({ type: 'studyx.stopSession' });
  assert.equal(stopped.ok, true);
  assert.equal(dynamicRules.length, 0);

  const recapState = await send({ type: 'studyx.getState' });
  assert.equal(recapState.data.current, null);
  assert.equal(recapState.data.pendingRecap.subject, 'Science');
  assert.equal(recapState.data.pendingRecap.highlightCount, 1);

  const reflected = await send({
    type: 'studyx.saveRecap',
    recap: { rating: 'mostly', reflection: 'I can explain waxing and waning.' },
  });
  assert.equal(reflected.ok, true);

  const exported = await send({ type: 'studyx.getAllData' }, extensionSender);
  assert.equal(exported.data.settings.alexaBridgeToken, '');
  assert.equal(exported.data.settings.alexaBridgePaired, true);
  assert.equal(exported.data.sessions.length, 1);
  assert.equal(exported.data.captures.length, 1);
  assert.equal(exported.data.unblockRequests.length, 1);
  const eventTypes = exported.data.scholarEvents.map((event) => event.type);
  for (const expected of [
    'session.started',
    'capture.created',
    'unblock.requested',
    'unblock.resolved',
    'session.completed',
    'session.reflected',
  ]) {
    assert.ok(eventTypes.includes(expected), `missing ${expected}`);
  }

  const pulled = await send({ type: 'studyx.bridgePull' }, scholarSender);
  assert.equal(pulled.ok, true);
  assert.equal(pulled.data.length, eventTypes.length);

  const acknowledged = await send(
    { type: 'studyx.bridgeAck', eventIds: pulled.data.map((event) => event.id) },
    scholarSender,
  );
  assert.equal(acknowledged.ok, true);
  const finalState = await send({ type: 'studyx.getState' });
  assert.equal(finalState.data.pendingScholarEvents, 0);
  const forgotten = await send({
    type: 'studyx.saveSettings',
    settings: { ...savedSettings.data, clearAlexaBridgeToken: true, alexaBridgeToken: '' },
  }, extensionSender);
  assert.equal(forgotten.data.alexaBridgePaired, false);
});

test('ScholarOS outbox rejects an unconfigured page', async () => {
  const response = await send(
    { type: 'studyx.bridgePull' },
    { tab: { url: 'https://untrusted.example/dashboard' } },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /not authorized/i);

  const contextResponse = await send(
    { type: 'studyx.saveScholarContext', context: { account: 'Wrong page', classes: ['Math'] } },
    { tab: { url: 'https://untrusted.example/dashboard' } },
  );
  assert.equal(contextResponse.ok, false);
  assert.match(contextResponse.error, /not authorized/i);

  const resolveResponse = await send(
    { type: 'studyx.resolveUnblock', request: { requestId: 'request_fake', decision: 'approve', minutes: 5 } },
    { tab: { url: 'https://untrusted.example/dashboard' } },
  );
  assert.equal(resolveResponse.ok, false);
  assert.match(resolveResponse.error, /not authorized/i);
});
