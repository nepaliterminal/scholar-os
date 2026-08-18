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
const bridgeFetches = [];
const companionCommandQueue = [];
const companionAcks = [];

globalThis.fetch = async (url, options = {}) => {
  const request = { url: String(url), options };
  bridgeFetches.push(request);
  let responseData;
  if (request.url.endsWith('/bridge/v1/companion/sync')) {
    responseData = { commands: companionCommandQueue.splice(0) };
  } else if (request.url.endsWith('/bridge/v1/companion/ack')) {
    const acknowledgement = JSON.parse(options.body);
    companionAcks.push(acknowledgement);
    responseData = acknowledgement;
  } else if (request.url.endsWith('/bridge/v1/status')) {
    responseData = {
      connected: true,
      enforcementReady: true,
      effectiveBlockedDomainCount: 0,
      focusMode: { active: false, startedAt: null, endsAt: null, taskDescription: null },
      companion: {
        connected: true,
        lastSeenAt: Date.now(),
        secondsSinceSync: 1,
        pendingCommandCount: 0,
        extensionVersion: '0.7.0',
      },
    };
  } else if (request.url.endsWith('/bridge/v1/action')) {
    const action = JSON.parse(options.body);
    if (action.action === 'enter_focus_mode') {
      responseData = { sessionId: '11111111-1111-4111-8111-111111111111', endsAt: Date.now() + 1_200_000 };
    } else if (action.action === 'get_focus_report') {
      responseData = {
        focusMinutes: 75,
        sessionCount: 3,
        completedTasks: 2,
        temporaryAccessRequests: 1,
        topRequestedDomains: [{ domain: 'private.example', count: 1 }],
      };
    } else {
      responseData = { action: action.action };
    }
  } else {
    responseData = request.url.endsWith('/v1/status')
      ? { connected: true, devices: [{ id: 'echo-1', name: 'Study Echo', online: true }], routines: [] }
      : { action: JSON.parse(options.body).action, deviceId: 'echo-1' };
  }
  return new Response(JSON.stringify({ ok: true, data: responseData }), {
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
    getManifest: () => ({ version: '0.5.0' }),
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
  assert.equal(initial.data.settings.settingsVersion, 7);
  assert.equal(initial.data.settings.pokeShareIdentity, false);
  assert.equal(initial.data.settings.pokeSharePrivateHistory, false);
  assert.equal(initial.data.settings.tiktokTrackingEnabled, true);
  assert.equal(initial.data.settings.tiktokDailyLimitMinutes, 30);
  assert.equal(initial.data.settings.scholarOsUrl, 'https://nepaliterminal.github.io/scholar-os/');
  assert.ok(initial.data.settings.blockedSites.includes('reddit.com'));
  const scholarSender = { tab: { url: initial.data.settings.scholarOsUrl } };
  const savedSettings = await send({
    type: 'studyx.saveSettings',
    settings: {
      ...initial.data.settings,
      alexaBridgeToken: 'private-test-pairing-token',
      lockInBridgeUrl: 'https://lockin-test.trycloudflare.com/mcp',
      lockInBridgeToken: 'private-lockin-pairing-token',
    },
  }, extensionSender);
  assert.equal(savedSettings.ok, true);
  assert.equal(savedSettings.data.alexaBridgeToken, '');
  assert.equal(savedSettings.data.alexaBridgePaired, true);
  assert.equal(savedSettings.data.lockInBridgeToken, '');
  assert.equal(savedSettings.data.lockInBridgePaired, true);
  assert.equal(savedSettings.data.lockInBridgeUrl, 'https://lockin-test.trycloudflare.com');
  const privateSettingsView = await send({ type: 'studyx.getSettings' }, extensionSender);
  assert.equal(privateSettingsView.data.alexaBridgeToken, '');
  assert.equal(privateSettingsView.data.alexaBridgePaired, true);
  assert.equal(privateSettingsView.data.lockInBridgeToken, '');
  assert.equal(privateSettingsView.data.lockInBridgePaired, true);
  const preservedSettings = await send({
    type: 'studyx.saveSettings',
    settings: { ...savedSettings.data, alexaBridgeToken: '' },
  }, extensionSender);
  assert.equal(preservedSettings.data.alexaBridgePaired, true, 'a blank field must preserve an existing pairing');
  assert.equal(preservedSettings.data.lockInBridgePaired, true, 'a blank field must preserve LockIn pairing');
  const redactedState = await send({ type: 'studyx.getState' });
  assert.equal(redactedState.data.settings.alexaBridgeToken, '');
  assert.equal(redactedState.data.settings.alexaBridgePaired, true);
  assert.equal(redactedState.data.settings.lockInBridgeToken, '');
  assert.equal(redactedState.data.settings.lockInBridgePaired, true);
  const scholarState = await send({ type: 'studyx.getScholarState' }, scholarSender);
  assert.equal(scholarState.ok, true);
  assert.equal('settings' in scholarState.data, false, 'ScholarOS must never receive extension settings or the Alexa token');
  assert.equal(JSON.stringify(scholarState.data).includes('private-test-pairing-token'), false);
  assert.equal(JSON.stringify(scholarState.data).includes('private-lockin-pairing-token'), false);
  const alexaStatus = await send({ type: 'studyx.alexaStatus' }, scholarSender);
  assert.equal(alexaStatus.ok, true);
  assert.equal(alexaStatus.data.devices[0].name, 'Study Echo');
  const alexaCommand = await send({
    type: 'studyx.alexaCommand',
    command: { action: 'speak', deviceId: 'echo-1', text: 'Time to study.' },
  }, scholarSender);
  assert.equal(alexaCommand.ok, true);
  assert.match(bridgeFetches.at(-1).options.headers.Authorization, /^Bearer /);
  const lockInStatus = await send({ type: 'studyx.lockInStatus' }, scholarSender);
  assert.equal(lockInStatus.ok, true);
  assert.equal(lockInStatus.data.enforcementReady, true);
  assert.equal(lockInStatus.data.report.focusMinutes, 75);
  assert.equal(lockInStatus.data.report.sessionCount, 3);
  assert.equal(lockInStatus.data.companion.connected, true);
  assert.equal(lockInStatus.data.companion.identityShared, false);
  assert.equal(lockInStatus.data.companion.privateHistoryShared, false);
  assert.equal('topRequestedDomains' in lockInStatus.data.report, false);
  assert.equal(JSON.stringify(lockInStatus.data).includes('private.example'), false);
  assert.ok(bridgeFetches.at(-1).url.startsWith('https://lockin-test.trycloudflare.com/bridge/'));
  assert.equal(bridgeFetches.at(-1).options.targetAddressSpace, undefined);
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
  const enterFocusRequest = bridgeFetches
    .filter((request) => request.url.endsWith('/bridge/v1/action'))
    .map((request) => JSON.parse(request.options.body))
    .find((request) => request.action === 'enter_focus_mode');
  assert.ok(enterFocusRequest);
  assert.ok(enterFocusRequest.domains.includes('reddit.com'));
  assert.equal(enterFocusRequest.taskDescription, 'Review moon phases');
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
  const temporaryRequest = bridgeFetches
    .filter((request) => request.url.endsWith('/bridge/v1/action'))
    .map((request) => JSON.parse(request.options.body))
    .find((request) => request.action === 'temporarily_unblock_domains');
  assert.equal(temporaryRequest.sessionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(temporaryRequest.domains, ['reddit.com']);
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
  const exitRequest = bridgeFetches
    .filter((request) => request.url.endsWith('/bridge/v1/action'))
    .map((request) => JSON.parse(request.options.body))
    .find((request) => request.action === 'exit_focus_mode');
  assert.equal(exitRequest.sessionId, '11111111-1111-4111-8111-111111111111');
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
  assert.equal(exported.data.settings.lockInBridgeToken, '');
  assert.equal(exported.data.settings.lockInBridgePaired, true);
  assert.equal(JSON.stringify(exported.data).includes('private-lockin-pairing-token'), false);
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

  companionCommandQueue.push({
    id: '22222222-2222-4222-8222-222222222222',
    type: 'start_session',
    payload: { subject: 'Math', intention: 'Poke-started practice', durationMinutes: 15 },
  });
  const snapshotSaved = await send({
    type: 'studyx.saveScholarSnapshot',
    snapshot: {
      account: 'Alex',
      classes: [{ name: 'Math', grade: 'A' }],
      assignments: [{ name: 'Fractions', cls: 'Math', due: '2026-08-18', status: 'In Progress' }],
      stars: 17,
      studySessions: [],
      day: {
        date: '2026-08-18', mode: 'school', label: 'Tuesday', title: 'School day', notes: 'Private note',
        checklist: [{ text: 'Finish fractions', done: false }],
      },
    },
  }, scholarSender);
  assert.equal(snapshotSaved.ok, true);
  await send({ type: 'studyx.syncCompanion' }, extensionSender);
  const pokeStarted = await send({ type: 'studyx.getState' });
  assert.equal(pokeStarted.data.current.subject, 'Math');
  assert.equal(pokeStarted.data.current.intention, 'Poke-started practice');
  assert.equal(companionAcks.at(-1).status, 'completed');
  assert.equal(companionAcks.at(-1).deviceId, data['studyx.companionDeviceId']);
  const privateSnapshotRequest = bridgeFetches
    .filter((request) => request.url.endsWith('/bridge/v1/companion/sync'))
    .at(-1);
  const privateSnapshot = JSON.parse(privateSnapshotRequest.options.body);
  assert.equal(privateSnapshot.scholarContext.account, null);
  assert.equal(privateSnapshot.dashboard.account, null);
  assert.equal('notes' in privateSnapshot.dashboard.day, false);
  assert.deepEqual(privateSnapshot.browser.recentSessions, []);

  companionCommandQueue.push({
    id: '33333333-3333-4333-8333-333333333333',
    type: 'stop_session',
    payload: {},
  });
  await send({ type: 'studyx.syncCompanion' }, extensionSender);
  const pokeStopped = await send({ type: 'studyx.getState' });
  assert.equal(pokeStopped.data.current, null);
  assert.equal(companionAcks.at(-1).commandId, '33333333-3333-4333-8333-333333333333');

  const localDay = new Date();
  const localDate = [
    localDay.getFullYear(),
    String(localDay.getMonth() + 1).padStart(2, '0'),
    String(localDay.getDate()).padStart(2, '0'),
  ].join('-');
  const summerSnapshot = {
    generatedAt: new Date().toISOString(),
    account: 'Alex',
    classes: [{ name: 'Math' }],
    assignments: [],
    stars: 17,
    studySessions: [],
    day: {
      date: localDate,
      mode: 'summer',
      source: 'manual',
      label: 'Summer Day',
      description: 'Flexible goals, movement, friends, and screen-time balance.',
      title: 'Library and pool day',
      notes: '',
      updatedAt: new Date().toISOString(),
      contextId: `${localDate}:summer:test-context`,
      ignoredContexts: ['school schedule', 'bus times', 'classes', 'backpack routine'],
      checklist: [{
        id: 'summer-goal', text: 'Choose one useful goal', done: false, beforeScreenTime: true,
      }],
      screenGate: {
        target: 'tiktok',
        // The extension must derive this from the checklist instead of trusting
        // a stale or manipulated precomputed gate supplied by the page.
        shouldBlock: false,
        gatedItemCount: 0,
        completedGatedItemCount: 0,
        incompleteItems: [],
        reason: null,
      },
    },
  };
  const gateSaved = await send({
    type: 'studyx.saveScholarSnapshot', snapshot: summerSnapshot,
  }, scholarSender);
  assert.equal(gateSaved.ok, true);
  const summerGate = await send({ type: 'studyx.getTikTokStatus' }, extensionSender);
  assert.equal(summerGate.data.blockReason, 'scholar_gate');
  assert.equal(summerGate.data.scholarScreenGate.mode, 'summer');
  assert.ok(data['studyx.scholarSnapshot'].day.ignoredContexts.includes('bus times'));
  assert.ok(dynamicRules.some((rule) => rule.id === 3000));

  summerSnapshot.day.checklist[0].done = true;
  summerSnapshot.day.screenGate.shouldBlock = true;
  summerSnapshot.day.screenGate.completedGatedItemCount = 0;
  summerSnapshot.day.screenGate.incompleteItems = [{ id: 'fake-task', text: 'Catch the 8:40 bus' }];
  summerSnapshot.day.screenGate.reason = 'Catch the 8:40 bus first.';
  await send({ type: 'studyx.saveScholarSnapshot', snapshot: summerSnapshot }, scholarSender);
  const clearedSummerGate = await send({ type: 'studyx.getTikTokStatus' }, extensionSender);
  assert.equal(clearedSummerGate.data.blocked, false);
  assert.equal(dynamicRules.some((rule) => rule.id === 3000), false);
  await new Promise((resolve) => setTimeout(resolve, 10));

  companionCommandQueue.push({
    id: '44444444-4444-4444-8444-444444444444',
    type: 'set_tiktok_policy',
    payload: { dailyLimitMinutes: 12, trackingEnabled: true },
  });
  await send({ type: 'studyx.syncCompanion' }, extensionSender);
  const pokePolicy = await send({ type: 'studyx.getTikTokStatus' }, extensionSender);
  assert.equal(pokePolicy.data.dailyLimitMinutes, 12);
  assert.equal(pokePolicy.data.trackingEnabled, true);

  companionCommandQueue.push({
    id: '55555555-5555-4555-8555-555555555555',
    type: 'block_tiktok',
    payload: { durationMinutes: 10 },
  });
  await send({ type: 'studyx.syncCompanion' }, extensionSender);
  const pokeBlock = await send({ type: 'studyx.getTikTokStatus' }, extensionSender);
  assert.equal(pokeBlock.data.blocked, true);
  assert.equal(pokeBlock.data.blockReason, 'manual');
  assert.ok(dynamicRules.some((rule) => rule.id === 3000));

  const forgotten = await send({
    type: 'studyx.saveSettings',
    settings: { ...savedSettings.data, clearAlexaBridgeToken: true, alexaBridgeToken: '' },
  }, extensionSender);
  assert.equal(forgotten.data.alexaBridgePaired, false);
  const forgottenLockIn = await send({
    type: 'studyx.saveSettings',
    settings: { ...forgotten.data, clearLockInBridgeToken: true, lockInBridgeToken: '' },
  }, extensionSender);
  assert.equal(forgottenLockIn.data.lockInBridgePaired, false);
});

test('counts only validated TikTok foreground heartbeats and enforces the daily cap', async () => {
  const currentSettings = await send({ type: 'studyx.getSettings' }, extensionSender);
  await send({
    type: 'studyx.saveSettings',
    settings: {
      ...currentSettings.data,
      tiktokTrackingEnabled: true,
      tiktokDailyLimitMinutes: 5,
    },
  }, extensionSender);
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  data['studyx.tiktokUsage'] = {
    date,
    activeSeconds: 298,
    scrollingSeconds: 200,
    lastSampleAt: 0,
    limitReachedAt: null,
    manualBlockedUntil: null,
    updatedAt: Date.now(),
  };

  const ignored = await send({
    type: 'studyx.tiktokActivity',
    activity: { visible: true, scrolling: true },
  }, { tab: { id: 8, active: true, url: 'https://example.com/' } });
  assert.equal(ignored.data.counted, false);
  assert.equal(data['studyx.tiktokUsage'].activeSeconds, 298);

  const counted = await send({
    type: 'studyx.tiktokActivity',
    activity: { visible: true, scrolling: true },
  }, { tab: { id: 9, active: true, url: 'https://www.tiktok.com/foryou' } });
  assert.equal(counted.data.counted, true);
  assert.equal(counted.data.limitReached, true);
  assert.equal(counted.data.blocked, true);
  assert.equal(data['studyx.tiktokUsage'].activeSeconds, 303);
  assert.equal(data['studyx.tiktokUsage'].scrollingSeconds, 205);
  assert.ok(dynamicRules.some((rule) => rule.id === 3000));
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

  const lockInResponse = await send(
    { type: 'studyx.lockInStatus' },
    { tab: { url: 'https://untrusted.example/dashboard' } },
  );
  assert.equal(lockInResponse.ok, false);
  assert.match(lockInResponse.error, /not authorized/i);
});
