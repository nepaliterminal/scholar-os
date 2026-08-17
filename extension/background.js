'use strict';

const KEYS = Object.freeze({
  settings: 'studyx.settings',
  current: 'studyx.currentSession',
  sessions: 'studyx.sessions',
  captures: 'studyx.captures',
  requests: 'studyx.unblockRequests',
  events: 'studyx.scholarEvents',
  recap: 'studyx.pendingRecap',
  scholarContext: 'studyx.scholarContext',
});

const DEFAULT_SETTINGS = Object.freeze({
  defaultDuration: 25,
  blockedSites: [
    'facebook.com',
    'instagram.com',
    'reddit.com',
    'tiktok.com',
    'twitch.tv',
    'x.com',
  ],
  youtubeShield: 'blur',
  hideYouTubeShorts: true,
  hideYouTubeRecommendations: false,
  scholarOsUrl: 'https://nepaliterminal.github.io/scholar-os/',
  alexaBridgeUrl: 'http://127.0.0.1:3457',
  alexaBridgeToken: '',
  settingsVersion: 4,
});

const SESSION_ALARM = 'studyx.session.end';
const LEGACY_LOCAL_SCHOLAR_OS_URL = 'file:///Users/subed/notion1/scholar-os/index.html';
const BLOCK_RULE_START = 1000;
const BLOCK_RULE_END = 1999;
const MAX_SESSIONS = 200;
const MAX_CAPTURES = 1500;
const MAX_EVENTS = 500;
const MAX_REQUESTS = 200;

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeSite(value) {
  let site = cleanText(value, 300).toLowerCase();
  if (!site) return null;

  try {
    if (site.includes('://')) site = new URL(site).hostname;
  } catch {
    return null;
  }

  site = site
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^\.+|\.+$/g, '');

  if (!site || !/^[a-z0-9.-]+$/.test(site) || !site.includes('.')) return null;
  return site;
}

function normalizeSettings(input = {}) {
  const defaults = cloneDefaults();
  const settingsVersion = Number(input.settingsVersion || 1);
  const sites = Array.isArray(input.blockedSites) ? input.blockedSites : defaults.blockedSites;
  // Version 1 enabled recommendation hiding by default, which made the YouTube
  // homepage look broken. Migrate that old default to the thumbnail-only behavior.
  const hideYouTubeRecommendations = settingsVersion < 2
    ? false
    : input.hideYouTubeRecommendations === true;
  const savedScholarOsUrl = cleanText(input.scholarOsUrl, 1000);
  const scholarOsUrl = settingsVersion < 3 && savedScholarOsUrl === LEGACY_LOCAL_SCHOLAR_OS_URL
    ? defaults.scholarOsUrl
    : savedScholarOsUrl || defaults.scholarOsUrl;
  let alexaBridgeUrl = cleanText(input.alexaBridgeUrl || defaults.alexaBridgeUrl, 500).replace(/\/$/, '');
  try {
    const parsed = new URL(alexaBridgeUrl);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      alexaBridgeUrl = defaults.alexaBridgeUrl;
    }
  } catch {
    alexaBridgeUrl = defaults.alexaBridgeUrl;
  }
  return {
    defaultDuration: Math.round(clampNumber(input.defaultDuration, 5, 180, defaults.defaultDuration)),
    blockedSites: [...new Set(sites.map(normalizeSite).filter(Boolean))].slice(0, BLOCK_RULE_END - BLOCK_RULE_START + 1),
    youtubeShield: ['off', 'blur', 'hide'].includes(input.youtubeShield)
      ? input.youtubeShield
      : defaults.youtubeShield,
    hideYouTubeShorts: input.hideYouTubeShorts !== false,
    hideYouTubeRecommendations,
    scholarOsUrl,
    alexaBridgeUrl,
    alexaBridgeToken: cleanText(input.alexaBridgeToken, 500),
    settingsVersion: defaults.settingsVersion,
  };
}

function redactAlexaPairing(settings) {
  return {
    ...settings,
    alexaBridgeToken: '',
    alexaBridgePaired: Boolean(settings.alexaBridgeToken),
  };
}

function normalizeScholarContext(input = {}) {
  const classes = Array.isArray(input.classes) ? input.classes : [];
  return {
    account: cleanText(input.account, 100) || null,
    classes: [...new Set(classes.map((value) => cleanText(value, 100)).filter(Boolean))].slice(0, 100),
    stars: Math.max(0, Math.round(clampNumber(input.stars, 0, 1_000_000, 0))),
    updatedAt: new Date().toISOString(),
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(KEYS.settings);
  return normalizeSettings(stored[KEYS.settings] || {});
}

async function ensureDefaults() {
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  const stored = await chrome.storage.local.get([
    KEYS.settings,
    KEYS.sessions,
    KEYS.captures,
    KEYS.requests,
    KEYS.events,
    KEYS.scholarContext,
  ]);
  const updates = {};
  updates[KEYS.settings] = normalizeSettings(stored[KEYS.settings] || {});
  if (!Array.isArray(stored[KEYS.sessions])) updates[KEYS.sessions] = [];
  if (!Array.isArray(stored[KEYS.captures])) updates[KEYS.captures] = [];
  if (!Array.isArray(stored[KEYS.requests])) updates[KEYS.requests] = [];
  if (!Array.isArray(stored[KEYS.events])) updates[KEYS.events] = [];
  if (!stored[KEYS.scholarContext]) updates[KEYS.scholarContext] = normalizeScholarContext();
  await chrome.storage.local.set(updates);
}

async function queueScholarEvent(type, payload) {
  const stored = await chrome.storage.local.get(KEYS.events);
  const events = Array.isArray(stored[KEYS.events]) ? stored[KEYS.events] : [];
  const event = {
    id: id('evt'),
    version: 1,
    type,
    occurredAt: new Date().toISOString(),
    payload,
    deliveredAt: null,
  };
  events.unshift(event);
  await chrome.storage.local.set({ [KEYS.events]: events.slice(0, MAX_EVENTS) });
  return event;
}

async function clearBlockRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .map((rule) => rule.id)
    .filter((ruleId) => ruleId >= BLOCK_RULE_START && ruleId <= BLOCK_RULE_END);
  if (removeRuleIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  }
}

async function applyBlockRules() {
  const stored = await chrome.storage.local.get(KEYS.current);
  const session = stored[KEYS.current];
  await clearBlockRules();
  if (!session || session.endsAt <= Date.now()) return;

  const settings = await getSettings();
  const rules = settings.blockedSites.map((site, index) => ({
    id: BLOCK_RULE_START + index,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        url: `${chrome.runtime.getURL('blocked.html')}?site=${encodeURIComponent(site)}`,
      },
    },
    condition: {
      urlFilter: `||${site}^`,
      resourceTypes: ['main_frame'],
    },
  }));

  if (rules.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
  }
}

async function broadcastStateChanged() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'studyx.stateChanged' })),
  );
}

async function updateBadge(active, finished = false) {
  if (finished) {
    await chrome.action.setBadgeBackgroundColor({ color: '#6e8b62' });
    await chrome.action.setBadgeText({ text: '✓' });
    return;
  }
  if (active) {
    await chrome.action.setBadgeBackgroundColor({ color: '#9c6f44' });
    await chrome.action.setBadgeText({ text: 'ON' });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
}

async function startSession(input) {
  await finishExpiredSession();
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.scholarContext]);
  if (stored[KEYS.current]) throw new Error('A study session is already running.');

  const settings = await getSettings();
  const durationMinutes = Math.round(
    clampNumber(input.durationMinutes, 5, 180, settings.defaultDuration),
  );
  const startedAt = Date.now();
  const session = {
    id: id('session'),
    subject: cleanText(input.subject, 100) || 'General study',
    intention: cleanText(input.intention, 500),
    brainDump: cleanText(input.brainDump, 4000),
    durationMinutes,
    startedAt,
    endsAt: startedAt + durationMinutes * 60_000,
    blockedAttempts: 0,
    captureCount: 0,
    highlightCount: 0,
    noteCount: 0,
    scholarAccount: stored[KEYS.scholarContext]?.account || null,
    lastBlockedSite: null,
    lastBlockedAt: 0,
  };

  await chrome.storage.local.set({ [KEYS.current]: session });
  await chrome.storage.local.remove(KEYS.recap);
  await chrome.alarms.create(SESSION_ALARM, { when: session.endsAt });
  await applyBlockRules();
  await updateBadge(true);
  await queueScholarEvent('session.started', {
    sessionId: session.id,
    subject: session.subject,
    intention: session.intention,
    brainDump: session.brainDump,
    durationMinutes: session.durationMinutes,
    startedAt: new Date(session.startedAt).toISOString(),
    scholarAccount: session.scholarAccount,
  });
  await broadcastStateChanged();
  return session;
}

async function finishSession(reason = 'stopped') {
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.sessions]);
  const session = stored[KEYS.current];
  if (!session) return null;

  const endedAt = Date.now();
  const elapsedMinutes = Math.max(0, Math.round(((endedAt - session.startedAt) / 60_000) * 10) / 10);
  const completionRatio = Math.min(1, elapsedMinutes / session.durationMinutes);
  const completed = reason === 'timer' || completionRatio >= 0.8;
  const suggestedStars = completed ? (session.blockedAttempts === 0 ? 5 : 3) : completionRatio >= 0.5 ? 1 : 0;
  const recap = {
    ...session,
    endedAt,
    elapsedMinutes,
    completionRatio,
    outcome: reason,
    completed,
    suggestedStars,
    rating: null,
    reflection: '',
  };
  delete recap.lastBlockedAt;
  delete recap.lastBlockedSite;

  const sessions = Array.isArray(stored[KEYS.sessions]) ? stored[KEYS.sessions] : [];
  await chrome.storage.local.set({
    [KEYS.sessions]: [recap, ...sessions.filter((item) => item.id !== recap.id)].slice(0, MAX_SESSIONS),
    [KEYS.recap]: recap,
  });
  await chrome.storage.local.remove(KEYS.current);
  await chrome.alarms.clear(SESSION_ALARM);
  await clearBlockRules();
  await updateBadge(false, true);
  await queueScholarEvent('session.completed', {
    sessionId: recap.id,
    subject: recap.subject,
    intention: recap.intention,
    brainDump: recap.brainDump,
    plannedMinutes: recap.durationMinutes,
    focusedMinutes: recap.elapsedMinutes,
    completed: recap.completed,
    blockedAttempts: recap.blockedAttempts,
    captureCount: recap.captureCount,
    highlightCount: recap.highlightCount,
    noteCount: recap.noteCount,
    suggestedStars: recap.suggestedStars,
    startedAt: new Date(recap.startedAt).toISOString(),
    endedAt: new Date(recap.endedAt).toISOString(),
    scholarAccount: recap.scholarAccount,
  });
  await broadcastStateChanged();
  return recap;
}

async function finishExpiredSession() {
  const stored = await chrome.storage.local.get(KEYS.current);
  const session = stored[KEYS.current];
  if (session && session.endsAt <= Date.now()) return finishSession('timer');
  return null;
}

async function saveCapture(input, sender) {
  await finishExpiredSession();
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.captures]);
  const session = stored[KEYS.current];
  if (!session) throw new Error('Start a study session before saving notes or highlights.');

  const quote = cleanText(input.quote, 12_000);
  const note = cleanText(input.note, 4_000);
  if (!quote && !note) throw new Error('Nothing was selected or written.');

  const capture = {
    id: id('capture'),
    sessionId: session.id,
    subject: session.subject,
    kind: input.kind === 'note' ? 'note' : 'highlight',
    quote,
    note,
    url: cleanText(input.url || sender?.tab?.url, 4000),
    title: cleanText(input.title || sender?.tab?.title, 500),
    timestampSeconds: Number.isFinite(Number(input.timestampSeconds))
      ? Math.max(0, Math.floor(Number(input.timestampSeconds)))
      : null,
    scholarAccount: session.scholarAccount,
    createdAt: new Date().toISOString(),
  };

  const captures = Array.isArray(stored[KEYS.captures]) ? stored[KEYS.captures] : [];
  session.captureCount += 1;
  if (capture.kind === 'highlight') session.highlightCount += 1;
  if (capture.kind === 'note') session.noteCount += 1;

  await chrome.storage.local.set({
    [KEYS.captures]: [capture, ...captures].slice(0, MAX_CAPTURES),
    [KEYS.current]: session,
  });
  await queueScholarEvent('capture.created', capture);
  await broadcastStateChanged();
  return capture;
}

async function recordBlockedAttempt(site, reason = '', countAttempt = true) {
  await finishExpiredSession();
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.requests]);
  const session = stored[KEYS.current];
  const normalizedSite = normalizeSite(site) || cleanText(site, 200) || 'blocked site';

  if (session && countAttempt) {
    const now = Date.now();
    const duplicate = session.lastBlockedSite === normalizedSite && now - session.lastBlockedAt < 5000;
    if (!duplicate) session.blockedAttempts += 1;
    session.lastBlockedSite = normalizedSite;
    session.lastBlockedAt = now;
    await chrome.storage.local.set({ [KEYS.current]: session });
  }

  const cleanReason = cleanText(reason, 1000);
  if (!cleanReason) return { recorded: true, request: null };

  const request = {
    id: id('request'),
    sessionId: session?.id || null,
    subject: session?.subject || null,
    site: normalizedSite,
    reason: cleanReason,
    status: 'pending',
    createdAt: new Date().toISOString(),
    scholarAccount: session?.scholarAccount || null,
  };
  const requests = Array.isArray(stored[KEYS.requests]) ? stored[KEYS.requests] : [];
  await chrome.storage.local.set({
    [KEYS.requests]: [request, ...requests].slice(0, MAX_REQUESTS),
  });
  await queueScholarEvent('unblock.requested', request);
  await broadcastStateChanged();
  return { recorded: true, request };
}

async function saveRecap(input) {
  const stored = await chrome.storage.local.get([KEYS.recap, KEYS.sessions]);
  const recap = stored[KEYS.recap];
  if (!recap) throw new Error('No session recap is waiting.');

  recap.rating = ['done', 'mostly', 'not-yet'].includes(input.rating) ? input.rating : null;
  recap.reflection = cleanText(input.reflection, 1000);
  const sessions = Array.isArray(stored[KEYS.sessions]) ? stored[KEYS.sessions] : [];
  const updated = sessions.map((session) => (session.id === recap.id ? recap : session));
  await chrome.storage.local.set({ [KEYS.sessions]: updated });
  await chrome.storage.local.remove(KEYS.recap);
  await updateBadge(false);
  await queueScholarEvent('session.reflected', {
    sessionId: recap.id,
    rating: recap.rating,
    reflection: recap.reflection,
    scholarAccount: recap.scholarAccount,
  });
  await broadcastStateChanged();
  return recap;
}

async function dismissRecap() {
  await chrome.storage.local.remove(KEYS.recap);
  await updateBadge(false);
  await broadcastStateChanged();
}

async function getState() {
  await finishExpiredSession();
  const stored = await chrome.storage.local.get([
    KEYS.settings,
    KEYS.current,
    KEYS.sessions,
    KEYS.captures,
    KEYS.events,
    KEYS.recap,
    KEYS.scholarContext,
  ]);
  const current = stored[KEYS.current] || null;
  const captures = Array.isArray(stored[KEYS.captures]) ? stored[KEYS.captures] : [];
  const sessions = Array.isArray(stored[KEYS.sessions]) ? stored[KEYS.sessions] : [];
  const events = Array.isArray(stored[KEYS.events]) ? stored[KEYS.events] : [];
  const settings = normalizeSettings(stored[KEYS.settings] || {});
  return {
    settings: redactAlexaPairing(settings),
    current,
    pendingRecap: stored[KEYS.recap] || null,
    scholarContext: stored[KEYS.scholarContext] || normalizeScholarContext(),
    currentCaptures: current ? captures.filter((capture) => capture.sessionId === current.id).slice(0, 20) : [],
    recentSessions: sessions.slice(0, 5),
    pendingScholarEvents: events.filter((event) => !event.deliveredAt).length,
  };
}

async function getScholarState(sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  const state = await getState();
  return {
    current: state.current,
    pendingRecap: state.pendingRecap,
    pendingScholarEvents: state.pendingScholarEvents,
  };
}

function normalizedDocumentUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

async function senderIsScholarOs(sender) {
  const settings = await getSettings();
  return Boolean(
    settings.scholarOsUrl &&
      normalizedDocumentUrl(sender?.tab?.url || sender?.url) === normalizedDocumentUrl(settings.scholarOsUrl),
  );
}

async function pullScholarEvents(sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  const stored = await chrome.storage.local.get(KEYS.events);
  const events = Array.isArray(stored[KEYS.events]) ? stored[KEYS.events] : [];
  return events.filter((event) => !event.deliveredAt).reverse();
}

async function acknowledgeScholarEvents(eventIds, sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  const accepted = new Set(Array.isArray(eventIds) ? eventIds.map(String) : []);
  const stored = await chrome.storage.local.get(KEYS.events);
  const events = Array.isArray(stored[KEYS.events]) ? stored[KEYS.events] : [];
  const deliveredAt = new Date().toISOString();
  for (const event of events) {
    if (accepted.has(event.id)) event.deliveredAt = deliveredAt;
  }
  await chrome.storage.local.set({ [KEYS.events]: events });
  return { acknowledged: accepted.size };
}

async function saveScholarContext(input, sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  const context = normalizeScholarContext(input);
  await chrome.storage.local.set({ [KEYS.scholarContext]: context });
  return context;
}

function senderIsExtensionPage(sender) {
  return String(sender?.url || '').startsWith(chrome.runtime.getURL(''));
}

function requireExtensionPage(sender) {
  if (!senderIsExtensionPage(sender)) throw new Error('This private action is available only in extension settings.');
}

async function alexaBridgeRequest(path, requestOptions, sender, allowExtensionPage = false) {
  if (!(await senderIsScholarOs(sender)) && !(allowExtensionPage && senderIsExtensionPage(sender))) {
    throw new Error('ScholarOS Alexa control is not authorized from this page.');
  }
  const settings = await getSettings();
  if (!settings.alexaBridgeToken) throw new Error('Pair the Alexa bridge in extension settings first.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${settings.alexaBridgeUrl}${path}`, {
      ...requestOptions,
      headers: {
        Authorization: `Bearer ${settings.alexaBridgeToken}`,
        'Content-Type': 'application/json',
        ...(requestOptions?.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || 'The local Alexa bridge did not respond.');
    return body.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The local Alexa bridge timed out.');
    if (error instanceof TypeError) throw new Error('Start the local Alexa bridge, then try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAlexaStatus(sender) {
  return alexaBridgeRequest('/v1/status', { method: 'GET' }, sender, true);
}

async function sendAlexaCommand(input, sender) {
  const action = cleanText(input.action, 30);
  if (!['speak', 'announce', 'play', 'pause', 'next', 'previous', 'volume', 'routine'].includes(action)) {
    throw new Error('Unsupported Alexa action.');
  }
  const command = {
    action,
    deviceId: cleanText(input.deviceId, 300),
    text: cleanText(input.text, 250),
    routineId: cleanText(input.routineId, 300),
    volume: Math.round(clampNumber(input.volume, 0, 100, 40)),
  };
  return alexaBridgeRequest('/v1/command', {
    method: 'POST',
    body: JSON.stringify(command),
  }, sender, false);
}

async function saveSettings(input) {
  const previous = await getSettings();
  const enteredToken = cleanText(input.alexaBridgeToken, 500);
  const alexaBridgeToken = input.clearAlexaBridgeToken === true
    ? ''
    : enteredToken || previous.alexaBridgeToken;
  const settings = normalizeSettings({ ...input, alexaBridgeToken });
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  await applyBlockRules();
  await broadcastStateChanged();
  return redactAlexaPairing(settings);
}

async function getAllData() {
  const stored = await chrome.storage.local.get(Object.values(KEYS));
  const settings = normalizeSettings(stored[KEYS.settings] || {});
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    settings: redactAlexaPairing(settings),
    currentSession: stored[KEYS.current] || null,
    sessions: stored[KEYS.sessions] || [],
    captures: stored[KEYS.captures] || [],
    unblockRequests: stored[KEYS.requests] || [],
    scholarEvents: stored[KEYS.events] || [],
    scholarContext: stored[KEYS.scholarContext] || normalizeScholarContext(),
  };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'studyx.getState':
      return getState();
    case 'studyx.getScholarState':
      return getScholarState(sender);
    case 'studyx.startSession':
      return startSession(message.session || {});
    case 'studyx.stopSession':
      return finishSession('stopped');
    case 'studyx.saveCapture':
      return saveCapture(message.capture || {}, sender);
    case 'studyx.blockedAttempt':
      return recordBlockedAttempt(message.site);
    case 'studyx.requestUnblock':
      return recordBlockedAttempt(message.site, message.reason, false);
    case 'studyx.saveRecap':
      return saveRecap(message.recap || {});
    case 'studyx.dismissRecap':
      return dismissRecap();
    case 'studyx.getSettings':
      requireExtensionPage(sender);
      return redactAlexaPairing(await getSettings());
    case 'studyx.saveSettings':
      requireExtensionPage(sender);
      return saveSettings(message.settings || {});
    case 'studyx.getAllData':
      requireExtensionPage(sender);
      return getAllData();
    case 'studyx.clearRequests':
      requireExtensionPage(sender);
      await chrome.storage.local.set({ [KEYS.requests]: [] });
      return { cleared: true };
    case 'studyx.bridgePull':
      return pullScholarEvents(sender);
    case 'studyx.bridgeAck':
      return acknowledgeScholarEvents(message.eventIds, sender);
    case 'studyx.saveScholarContext':
      return saveScholarContext(message.context || {}, sender);
    case 'studyx.alexaStatus':
      return getAlexaStatus(sender);
    case 'studyx.alexaCommand':
      return sendAlexaCommand(message.command || {}, sender);
    default:
      throw new Error('Unknown Study Session OS message.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_ALARM) finishSession('timer').catch(console.error);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-highlight') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'studyx.captureSelection' }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'studyx-save-selection' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'studyx.captureSelection' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'studyx-save-selection',
      title: 'Save to this study session',
      contexts: ['selection'],
    });
  });
  await finishExpiredSession();
  await applyBlockRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await finishExpiredSession();
  await applyBlockRules();
  const stored = await chrome.storage.local.get(KEYS.current);
  await updateBadge(Boolean(stored[KEYS.current]));
});

ensureDefaults().catch(console.error);
