'use strict';

const KEYS = Object.freeze({
  settings: 'studyx.settings',
  current: 'studyx.currentSession',
  sessions: 'studyx.sessions',
  captures: 'studyx.captures',
  requests: 'studyx.unblockRequests',
  allowances: 'studyx.siteAllowances',
  events: 'studyx.scholarEvents',
  recap: 'studyx.pendingRecap',
  scholarContext: 'studyx.scholarContext',
  scholarSnapshot: 'studyx.scholarSnapshot',
  lockInSession: 'studyx.lockInSession',
  companionDeviceId: 'studyx.companionDeviceId',
  processedCompanionCommands: 'studyx.processedCompanionCommands',
  tiktokUsage: 'studyx.tiktokUsage',
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
  lockInBridgeUrl: 'http://127.0.0.1:3847',
  lockInBridgeToken: '',
  pokeShareIdentity: false,
  pokeSharePrivateHistory: false,
  tiktokTrackingEnabled: true,
  tiktokDailyLimitMinutes: 30,
  settingsVersion: 7,
});

const SESSION_ALARM = 'studyx.session.end';
const ACCESS_ALARM = 'studyx.allowances.expire';
const COMPANION_ALARM = 'studyx.lockin.companion.sync';
const LEGACY_LOCAL_SCHOLAR_OS_URL = 'file:///Users/subed/notion1/scholar-os/index.html';
const BLOCK_RULE_START = 1000;
const BLOCK_RULE_END = 1999;
const TIKTOK_RULE_ID = 3000;
const TIKTOK_SAMPLE_SECONDS = 5;
const TIKTOK_MAX_SAMPLE_SECONDS = 10;
const MAX_SESSIONS = 200;
const MAX_CAPTURES = 1500;
const MAX_EVENTS = 500;
const MAX_REQUESTS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let tiktokActivityTail = Promise.resolve();
let defaultsPromise = null;

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

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextLocalMidnight(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function normalizeTikTokUsage(input = {}, now = Date.now()) {
  const today = localDateKey(now);
  const sameDay = cleanText(input.date, 20) === today;
  const manualBlockedUntil = Number(input.manualBlockedUntil) > now
    ? Math.round(Number(input.manualBlockedUntil))
    : null;
  return {
    date: today,
    activeSeconds: sameDay ? Math.max(0, Math.round(Number(input.activeSeconds) || 0)) : 0,
    scrollingSeconds: sameDay ? Math.max(0, Math.round(Number(input.scrollingSeconds) || 0)) : 0,
    lastSampleAt: sameDay ? Math.max(0, Math.round(Number(input.lastSampleAt) || 0)) : 0,
    limitReachedAt: sameDay && Number(input.limitReachedAt) > 0
      ? Math.round(Number(input.limitReachedAt))
      : null,
    manualBlockedUntil,
    updatedAt: Math.max(0, Math.round(Number(input.updatedAt) || now)),
  };
}

function isTikTokUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
  } catch {
    return false;
  }
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
  let lockInBridgeUrl = cleanText(input.lockInBridgeUrl || defaults.lockInBridgeUrl, 500);
  try {
    const parsed = new URL(lockInBridgeUrl);
    const loopbackHttp = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (
      (!loopbackHttp && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      lockInBridgeUrl = defaults.lockInBridgeUrl;
    } else {
      lockInBridgeUrl = parsed.origin;
    }
  } catch {
    lockInBridgeUrl = defaults.lockInBridgeUrl;
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
    lockInBridgeUrl,
    lockInBridgeToken: cleanText(input.lockInBridgeToken, 500),
    pokeShareIdentity: input.pokeShareIdentity === true,
    pokeSharePrivateHistory: input.pokeSharePrivateHistory === true,
    tiktokTrackingEnabled: input.tiktokTrackingEnabled !== false,
    tiktokDailyLimitMinutes: Math.round(clampNumber(
      input.tiktokDailyLimitMinutes,
      5,
      1_440,
      defaults.tiktokDailyLimitMinutes,
    )),
    settingsVersion: defaults.settingsVersion,
  };
}

function redactPrivatePairings(settings) {
  return {
    ...settings,
    alexaBridgeToken: '',
    alexaBridgePaired: Boolean(settings.alexaBridgeToken),
    lockInBridgeToken: '',
    lockInBridgePaired: Boolean(settings.lockInBridgeToken),
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

function normalizeScholarSnapshot(input) {
  if (!input || typeof input !== 'object') return null;
  const classes = Array.isArray(input.classes) ? input.classes : [];
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  const studySessions = Array.isArray(input.studySessions) ? input.studySessions : [];
  const checklist = Array.isArray(input.day?.checklist) ? input.day.checklist : [];
  const ignoredContexts = Array.isArray(input.day?.ignoredContexts) ? input.day.ignoredContexts : [];
  const normalizedChecklist = checklist.slice(0, 100).map((item) => ({
    id: cleanText(item?.id, 200),
    text: cleanText(item?.text, 300),
    done: item?.done === true,
    beforeScreenTime: item?.beforeScreenTime === true,
  })).filter((item) => item.text);
  const gatedItems = normalizedChecklist.filter((item) => item.beforeScreenTime);
  const incompleteItems = gatedItems.filter((item) => !item.done);
  const dayLabel = cleanText(input.day?.label, 100);
  const gateSubject = dayLabel.toLowerCase() || 'ScholarOS';
  return {
    generatedAt: cleanText(input.generatedAt, 50),
    account: cleanText(input.account, 100) || null,
    classes: classes.slice(0, 100).map((item) => ({
      name: cleanText(item?.name, 100),
      program: cleanText(item?.program, 100),
      schedule: cleanText(item?.schedule, 200),
      period: typeof item?.period === 'number' ? item.period : cleanText(item?.period, 50),
      grade: cleanText(item?.grade, 50),
      target: cleanText(item?.target, 100),
    })).filter((item) => item.name),
    assignments: assignments.slice(0, 500).map((item) => ({
      name: cleanText(item?.name, 300),
      cls: cleanText(item?.cls, 100),
      type: cleanText(item?.type, 100),
      due: cleanText(item?.due, 30),
      priority: cleanText(item?.priority, 50),
      status: cleanText(item?.status, 50),
    })).filter((item) => item.name),
    stars: Math.max(0, Math.round(clampNumber(input.stars, 0, 1_000_000, 0))),
    studySessions: studySessions.slice(-100).map((item) => ({
      subject: cleanText(item?.subject, 100),
      intention: cleanText(item?.intention, 500),
      focusedMinutes: Math.max(0, Number(item?.focusedMinutes) || 0),
      completed: item?.completed === true,
      endedAt: typeof item?.endedAt === 'number' ? Math.max(0, item.endedAt) : cleanText(item?.endedAt, 50),
    })),
    day: {
      date: cleanText(input.day?.date, 30),
      mode: ['school', 'summer', 'party'].includes(input.day?.mode) ? input.day.mode : null,
      source: ['manual', 'inferred'].includes(input.day?.source) ? input.day.source : 'inferred',
      label: dayLabel,
      description: cleanText(input.day?.description, 500),
      title: cleanText(input.day?.title, 300),
      notes: cleanText(input.day?.notes, 2_000),
      updatedAt: cleanText(input.day?.updatedAt, 50),
      contextId: cleanText(input.day?.contextId, 300),
      ignoredContexts: ignoredContexts
        .map((value) => cleanText(value, 100))
        .filter(Boolean)
        .slice(0, 30),
      checklist: normalizedChecklist,
      screenGate: {
        target: 'tiktok',
        shouldBlock: incompleteItems.length > 0,
        gatedItemCount: gatedItems.length,
        completedGatedItemCount: gatedItems.length - incompleteItems.length,
        incompleteItems: incompleteItems.map((item) => ({ id: item.id, text: item.text })),
        reason: incompleteItems.length
          ? `${incompleteItems.length} ${gateSubject} item${incompleteItems.length === 1 ? '' : 's'} must be completed before screen time.`
          : null,
      },
    },
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(KEYS.settings);
  return normalizeSettings(stored[KEYS.settings] || {});
}

async function performEnsureDefaults() {
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    try {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch {
      // Older or policy-managed browsers may reject this hardening call. Message
      // boundaries still redact secrets, so startup must continue either way.
    }
  }
  const stored = await chrome.storage.local.get([
    KEYS.settings,
    KEYS.sessions,
    KEYS.captures,
    KEYS.requests,
    KEYS.allowances,
    KEYS.events,
    KEYS.scholarContext,
    KEYS.scholarSnapshot,
    KEYS.companionDeviceId,
    KEYS.processedCompanionCommands,
    KEYS.tiktokUsage,
  ]);
  const updates = {};
  updates[KEYS.settings] = normalizeSettings(stored[KEYS.settings] || {});
  if (!Array.isArray(stored[KEYS.sessions])) updates[KEYS.sessions] = [];
  if (!Array.isArray(stored[KEYS.captures])) updates[KEYS.captures] = [];
  if (!Array.isArray(stored[KEYS.requests])) updates[KEYS.requests] = [];
  if (!Array.isArray(stored[KEYS.allowances])) updates[KEYS.allowances] = [];
  if (!Array.isArray(stored[KEYS.events])) updates[KEYS.events] = [];
  if (!stored[KEYS.scholarContext]) updates[KEYS.scholarContext] = normalizeScholarContext();
  if (!stored[KEYS.scholarSnapshot]) updates[KEYS.scholarSnapshot] = null;
  if (!UUID_PATTERN.test(String(stored[KEYS.companionDeviceId] || ''))) {
    updates[KEYS.companionDeviceId] = crypto.randomUUID();
  }
  if (!Array.isArray(stored[KEYS.processedCompanionCommands])) {
    updates[KEYS.processedCompanionCommands] = [];
  }
  updates[KEYS.tiktokUsage] = normalizeTikTokUsage(stored[KEYS.tiktokUsage] || {});
  await chrome.storage.local.set(updates);
  await chrome.alarms.create(COMPANION_ALARM, { periodInMinutes: 0.5 });
}

function ensureDefaults() {
  if (!defaultsPromise) {
    defaultsPromise = performEnsureDefaults().catch((error) => {
      defaultsPromise = null;
      throw error;
    });
  }
  return defaultsPromise;
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

async function getTikTokStatus() {
  const [settings, stored] = await Promise.all([
    getSettings(),
    chrome.storage.local.get([KEYS.tiktokUsage, KEYS.scholarSnapshot]),
  ]);
  const now = Date.now();
  const usage = normalizeTikTokUsage(stored[KEYS.tiktokUsage] || {}, now);
  const autoBlocked = settings.tiktokTrackingEnabled &&
    usage.activeSeconds >= settings.tiktokDailyLimitMinutes * 60;
  const manualBlocked = Number(usage.manualBlockedUntil) > now;
  const scholarDay = stored[KEYS.scholarSnapshot]?.day;
  const scholarGateBlocked = scholarDay?.date === localDateKey(now) &&
    ['school', 'summer', 'party'].includes(scholarDay?.mode) &&
    scholarDay?.screenGate?.target === 'tiktok' &&
    scholarDay?.screenGate?.shouldBlock === true &&
    Array.isArray(scholarDay?.screenGate?.incompleteItems) &&
    scholarDay.screenGate.incompleteItems.length > 0;
  const blockedUntil = manualBlocked
    ? usage.manualBlockedUntil
    : autoBlocked || scholarGateBlocked ? nextLocalMidnight(now) : null;
  return {
    date: usage.date,
    activeSeconds: usage.activeSeconds,
    scrollingSeconds: Math.min(usage.activeSeconds, usage.scrollingSeconds),
    dailyLimitMinutes: settings.tiktokDailyLimitMinutes,
    trackingEnabled: settings.tiktokTrackingEnabled,
    limitReached: autoBlocked,
    blocked: autoBlocked || manualBlocked || scholarGateBlocked,
    blockReason: manualBlocked
      ? 'manual'
      : autoBlocked
        ? 'daily_limit'
        : scholarGateBlocked ? 'scholar_gate' : null,
    blockedUntil,
    scholarScreenGate: scholarGateBlocked ? {
      contextId: cleanText(scholarDay.contextId, 300),
      mode: scholarDay.mode,
      label: scholarDay.label,
      title: scholarDay.title,
      reason: scholarDay.screenGate.reason,
      incompleteItems: scholarDay.screenGate.incompleteItems,
    } : null,
    updatedAt: usage.updatedAt,
  };
}

async function applyTikTokRule() {
  const status = await getTikTokStatus();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const hasRule = existing.some((rule) => rule.id === TIKTOK_RULE_ID);
  if (!status.blocked) {
    if (hasRule) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [TIKTOK_RULE_ID] });
    }
    return status;
  }
  const reason = status.blockReason === 'manual'
    ? 'tiktok-manual'
    : status.blockReason === 'scholar_gate' ? 'scholar-gate' : 'tiktok-limit';
  const rule = {
    id: TIKTOK_RULE_ID,
    priority: 2,
    action: {
      type: 'redirect',
      redirect: {
        url: `${chrome.runtime.getURL('blocked.html')}?site=tiktok.com&reason=${reason}`,
      },
    },
    condition: {
      urlFilter: '||tiktok.com^',
      resourceTypes: ['main_frame'],
    },
  };
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: hasRule ? [TIKTOK_RULE_ID] : [],
    addRules: [rule],
  });
  return status;
}

async function recordTikTokActivity(input, sender) {
  if (!sender?.tab?.active || !isTikTokUrl(sender.tab.url) || input?.visible !== true) {
    return { counted: false, ...(await getTikTokStatus()) };
  }
  // Chrome can mark one tab active in every window, and a document can remain
  // visible when the entire browser is behind another app. Require both the
  // currently focused Chrome window and its active TikTok tab.
  try {
    const focusedWindow = await chrome.windows.getLastFocused();
    if (!focusedWindow?.focused || focusedWindow.id !== sender.tab.windowId) {
      return { counted: false, ...(await getTikTokStatus()) };
    }
    const foregroundTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!foregroundTabs.some((tab) => tab.id === sender.tab.id)) {
      return { counted: false, ...(await getTikTokStatus()) };
    }
  } catch {
    return { counted: false, ...(await getTikTokStatus()) };
  }
  const settings = await getSettings();
  if (!settings.tiktokTrackingEnabled) return { counted: false, ...(await getTikTokStatus()) };

  const now = Date.now();
  const stored = await chrome.storage.local.get(KEYS.tiktokUsage);
  const usage = normalizeTikTokUsage(stored[KEYS.tiktokUsage] || {}, now);
  const reportedSampleSeconds = Number(input?.sampleSeconds);
  const elapsedSeconds = Number.isFinite(reportedSampleSeconds)
    ? Math.min(TIKTOK_MAX_SAMPLE_SECONDS, Math.max(0, Math.round(reportedSampleSeconds)))
    : usage.lastSampleAt > 0
      ? Math.min(TIKTOK_MAX_SAMPLE_SECONDS, Math.max(0, Math.round((now - usage.lastSampleAt) / 1_000)))
      : TIKTOK_SAMPLE_SECONDS;
  if (elapsedSeconds > 0) {
    usage.activeSeconds += elapsedSeconds;
    if (input?.scrolling === true) usage.scrollingSeconds += elapsedSeconds;
  }
  usage.scrollingSeconds = Math.min(usage.activeSeconds, usage.scrollingSeconds);
  usage.lastSampleAt = now;
  usage.updatedAt = now;
  if (!usage.limitReachedAt && usage.activeSeconds >= settings.tiktokDailyLimitMinutes * 60) {
    usage.limitReachedAt = now;
  }
  await chrome.storage.local.set({ [KEYS.tiktokUsage]: usage });
  const status = await applyTikTokRule();
  if (status.blocked && Number.isInteger(sender.tab.id) && typeof chrome.tabs.update === 'function') {
    const reason = status.blockReason === 'manual'
      ? 'tiktok-manual'
      : status.blockReason === 'scholar_gate' ? 'scholar-gate' : 'tiktok-limit';
    await chrome.tabs.update(sender.tab.id, {
      url: `${chrome.runtime.getURL('blocked.html')}?site=tiktok.com&reason=${reason}`,
    }).catch(() => {});
  }
  return { counted: elapsedSeconds > 0, ...status };
}

function enqueueTikTokActivity(input, sender) {
  const operation = tiktokActivityTail.then(() => recordTikTokActivity(input, sender));
  tiktokActivityTail = operation.then(() => undefined, () => undefined);
  return operation;
}

async function redirectOpenTikTokTabs(reason) {
  if (typeof chrome.tabs.update !== 'function') return;
  const tabs = await chrome.tabs.query({
    url: ['*://tiktok.com/*', '*://*.tiktok.com/*'],
  }).catch(() => []);
  await Promise.allSettled(tabs
    .filter((tab) => Number.isInteger(tab.id))
    .map((tab) => chrome.tabs.update(tab.id, {
      url: `${chrome.runtime.getURL('blocked.html')}?site=tiktok.com&reason=${reason}`,
    })));
}

async function setTikTokPolicy(input = {}) {
  const previous = await getSettings();
  const settings = normalizeSettings({
    ...previous,
    tiktokTrackingEnabled: input.trackingEnabled !== false,
    tiktokDailyLimitMinutes: input.dailyLimitMinutes,
  });
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  const status = await applyTikTokRule();
  if (status.blocked) {
    const reason = status.blockReason === 'manual'
      ? 'tiktok-manual'
      : status.blockReason === 'scholar_gate' ? 'scholar-gate' : 'tiktok-limit';
    await redirectOpenTikTokTabs(reason);
  }
  await broadcastStateChanged();
  return status;
}

async function blockTikTokNow(input = {}) {
  const durationMinutes = Math.round(clampNumber(input.durationMinutes, 1, 1_440, 60));
  const now = Date.now();
  const stored = await chrome.storage.local.get(KEYS.tiktokUsage);
  const usage = normalizeTikTokUsage(stored[KEYS.tiktokUsage] || {}, now);
  usage.manualBlockedUntil = now + durationMinutes * 60_000;
  usage.updatedAt = now;
  await chrome.storage.local.set({ [KEYS.tiktokUsage]: usage });
  const status = await applyTikTokRule();
  await redirectOpenTikTokTabs('tiktok-manual');
  return { ...status, durationMinutes };
}

async function applyBlockRules() {
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.allowances]);
  const session = stored[KEYS.current];
  await clearBlockRules();
  await applyTikTokRule();
  await chrome.alarms.clear(ACCESS_ALARM);
  if (!session || session.endsAt <= Date.now()) return;

  const now = Date.now();
  const savedAllowances = Array.isArray(stored[KEYS.allowances]) ? stored[KEYS.allowances] : [];
  const allowances = savedAllowances.filter((allowance) => (
    allowance &&
    allowance.sessionId === session.id &&
    Number(allowance.expiresAt) > now &&
    normalizeSite(allowance.site)
  ));
  if (allowances.length !== savedAllowances.length) {
    await chrome.storage.local.set({ [KEYS.allowances]: allowances });
  }
  const nextExpiry = Math.min(...allowances.map((allowance) => Number(allowance.expiresAt)));
  if (Number.isFinite(nextExpiry)) await chrome.alarms.create(ACCESS_ALARM, { when: nextExpiry });
  const allowedSites = new Set(allowances.map((allowance) => normalizeSite(allowance.site)));

  const settings = await getSettings();
  const rules = settings.blockedSites.filter((site) => !allowedSites.has(site)).map((site, index) => ({
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
  try {
    await startLockInProtection(session, settings);
  } catch {
    // Browser focus still works when LockIn is offline or already running a
    // separately-owned session. Its status card explains how to reconnect.
    await chrome.storage.local.remove(KEYS.lockInSession);
  }
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
  const stored = await chrome.storage.local.get([KEYS.current, KEYS.sessions, KEYS.lockInSession]);
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
  await chrome.storage.local.set({ [KEYS.allowances]: [] });
  await chrome.alarms.clear(SESSION_ALARM);
  await chrome.alarms.clear(ACCESS_ALARM);
  await clearBlockRules();
  try {
    await stopLockInProtection(stored[KEYS.lockInSession]);
  } catch {
    // The LockIn focus timer is still bounded by the original session end.
  }
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

async function resolveUnblock(input, sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  return resolveUnblockAuthorized(input);
}

async function resolveUnblockAuthorized(input) {
  await finishExpiredSession();
  const requestId = cleanText(input.requestId, 200);
  const decision = input.decision === 'approve' ? 'approved' : input.decision === 'deny' ? 'denied' : '';
  if (!requestId || !decision) throw new Error('Choose approve or deny for a valid access request.');

  const stored = await chrome.storage.local.get([
    KEYS.current,
    KEYS.requests,
    KEYS.allowances,
    KEYS.scholarContext,
  ]);
  const requests = Array.isArray(stored[KEYS.requests]) ? stored[KEYS.requests] : [];
  const request = requests.find((item) => item?.id === requestId);
  if (!request) throw new Error('This access request is no longer available.');
  if (request.status !== 'pending') throw new Error(`This request was already ${request.status}.`);
  const activeAccount = stored[KEYS.scholarContext]?.account || null;
  if (request.scholarAccount && request.scholarAccount !== activeAccount) {
    throw new Error('Open the ScholarOS profile that created this request.');
  }

  const session = stored[KEYS.current];
  if (decision === 'approved' && (!session || request.sessionId !== session.id)) {
    throw new Error('That focus session has ended, so this request cannot be approved.');
  }

  const resolvedAt = new Date().toISOString();
  const minutes = Math.round(clampNumber(input.minutes, 1, 30, 5));
  const allowedUntil = decision === 'approved'
    ? Math.min(session.endsAt, Date.now() + minutes * 60_000)
    : null;
  if (decision === 'approved') {
    await temporarilyUnblockInLockIn(session, request.site, minutes);
  }
  request.status = decision;
  request.resolvedAt = resolvedAt;
  request.allowedUntil = allowedUntil ? new Date(allowedUntil).toISOString() : null;

  const allowances = Array.isArray(stored[KEYS.allowances]) ? stored[KEYS.allowances] : [];
  if (decision === 'approved') {
    allowances.push({
      requestId,
      sessionId: session.id,
      site: request.site,
      expiresAt: allowedUntil,
      scholarAccount: request.scholarAccount || null,
    });
  }
  await chrome.storage.local.set({
    [KEYS.requests]: requests,
    [KEYS.allowances]: allowances,
  });
  await applyBlockRules();
  await queueScholarEvent('unblock.resolved', {
    id: request.id,
    sessionId: request.sessionId,
    site: request.site,
    status: request.status,
    resolvedAt,
    allowedUntil: request.allowedUntil,
    scholarAccount: request.scholarAccount,
  });
  await broadcastStateChanged();
  return {
    id: request.id,
    site: request.site,
    status: request.status,
    allowedUntil: request.allowedUntil,
  };
}

async function getUnblockStatus(requestId, sender) {
  requireExtensionPage(sender);
  const stored = await chrome.storage.local.get(KEYS.requests);
  const requests = Array.isArray(stored[KEYS.requests]) ? stored[KEYS.requests] : [];
  const request = requests.find((item) => item?.id === cleanText(requestId, 200));
  if (!request) throw new Error('Access request not found.');
  return {
    id: request.id,
    site: request.site,
    status: request.status,
    allowedUntil: request.allowedUntil || null,
  };
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
    settings: redactPrivatePairings(settings),
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

async function saveScholarSnapshot(input, sender) {
  if (!(await senderIsScholarOs(sender))) throw new Error('ScholarOS bridge origin is not authorized.');
  const snapshot = normalizeScholarSnapshot(input);
  if (!snapshot) throw new Error('ScholarOS snapshot is invalid.');
  await chrome.storage.local.set({ [KEYS.scholarSnapshot]: snapshot });
  const tiktokStatus = await applyTikTokRule();
  if (tiktokStatus.blockReason === 'scholar_gate') {
    await redirectOpenTikTokTabs('scholar-gate');
  }
  void syncCompanion();
  return { saved: true, screenGate: snapshot.day.screenGate };
}

function senderIsExtensionPage(sender) {
  return String(sender?.url || '').startsWith(chrome.runtime.getURL(''));
}

function requireExtensionPage(sender) {
  if (!senderIsExtensionPage(sender)) throw new Error('This private action is available only in extension settings.');
}

async function lockInBridgeRequest(path, requestOptions = {}, settings = null) {
  const privateSettings = settings || await getSettings();
  if (!privateSettings.lockInBridgeToken) {
    throw new Error('Pair LockIn in extension settings first.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const request = {
      ...requestOptions,
      headers: {
        Authorization: `Bearer ${privateSettings.lockInBridgeToken}`,
        'Content-Type': 'application/json',
        ...(requestOptions?.headers || {}),
      },
      signal: controller.signal,
    };
    const target = new URL(privateSettings.lockInBridgeUrl);
    if (target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      request.targetAddressSpace = 'loopback';
    }
    const response = await fetch(`${privateSettings.lockInBridgeUrl}${path}`, request);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || 'The local LockIn bridge did not respond.');
    return body.data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The local LockIn bridge timed out.');
    if (error instanceof TypeError) {
      throw new Error('Start LockIn, or use its active HTTPS tunnel URL if Chrome blocks localhost.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCompanionDeviceId(storedValue = '') {
  let deviceId = String(storedValue || '');
  if (!UUID_PATTERN.test(deviceId)) {
    deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ [KEYS.companionDeviceId]: deviceId });
  }
  return deviceId;
}

async function buildCompanionSnapshot() {
  const stored = await chrome.storage.local.get([
    KEYS.current,
    KEYS.sessions,
    KEYS.requests,
    KEYS.scholarContext,
    KEYS.scholarSnapshot,
    KEYS.companionDeviceId,
  ]);
  const deviceId = await getCompanionDeviceId(stored[KEYS.companionDeviceId]);
  const context = stored[KEYS.scholarContext] || normalizeScholarContext();
  const current = stored[KEYS.current];
  const sessions = Array.isArray(stored[KEYS.sessions]) ? stored[KEYS.sessions] : [];
  const requests = Array.isArray(stored[KEYS.requests]) ? stored[KEYS.requests] : [];
  const tiktok = await getTikTokStatus();
  const settings = await getSettings();
  const dashboard = normalizeScholarSnapshot(stored[KEYS.scholarSnapshot]);
  if (dashboard) {
    if (!settings.pokeShareIdentity) dashboard.account = null;
    if (!settings.pokeSharePrivateHistory) {
      dashboard.studySessions = [];
      delete dashboard.day.notes;
    }
  }
  return {
    deviceId,
    extensionVersion: chrome.runtime.getManifest?.().version || '0.7.0',
    scholarContext: {
      account: settings.pokeShareIdentity ? cleanText(context.account, 100) || null : null,
      classes: (Array.isArray(context.classes) ? context.classes : [])
        .map((value) => cleanText(value, 100))
        .filter(Boolean)
        .slice(0, 100),
      stars: Math.max(0, Math.round(Number(context.stars) || 0)),
    },
    browser: {
      currentSession: current ? {
        id: cleanText(current.id, 200),
        subject: cleanText(current.subject, 100),
        intention: cleanText(current.intention, 500),
        durationMinutes: Math.max(1, Math.round(Number(current.durationMinutes) || 1)),
        startedAt: Math.max(0, Math.round(Number(current.startedAt) || 0)),
        endsAt: Math.max(0, Math.round(Number(current.endsAt) || 0)),
        blockedAttempts: Math.max(0, Math.round(Number(current.blockedAttempts) || 0)),
      } : null,
      pendingAccessRequests: requests
        .filter((request) => request?.status === 'pending')
        .slice(0, 100)
        .map((request) => ({
          id: cleanText(request.id, 200),
          sessionId: cleanText(request.sessionId, 200) || null,
          subject: cleanText(request.subject, 100) || null,
          site: cleanText(request.site, 253),
          reason: cleanText(request.reason, 1000),
          createdAt: cleanText(request.createdAt, 50),
        })),
      recentSessions: sessions
        .filter((session) => Number.isFinite(Number(session?.endedAt)))
        .filter(() => settings.pokeSharePrivateHistory)
        .slice(0, 20)
        .map((session) => ({
          id: cleanText(session.id, 200),
          subject: cleanText(session.subject, 100),
          intention: cleanText(session.intention, 500),
          durationMinutes: Math.max(0, Number(session.durationMinutes) || 0),
          elapsedMinutes: Math.max(0, Number(session.elapsedMinutes) || 0),
          completed: session.completed === true,
          blockedAttempts: Math.max(0, Math.round(Number(session.blockedAttempts) || 0)),
          endedAt: Math.max(0, Math.round(Number(session.endedAt) || 0)),
        })),
      tiktok,
    },
    dashboard,
  };
}

async function acknowledgeCompanionCommand(processed) {
  const stored = await chrome.storage.local.get(KEYS.companionDeviceId);
  const body = {
    commandId: processed.id,
    deviceId: await getCompanionDeviceId(stored[KEYS.companionDeviceId]),
    status: processed.status,
    result: processed.result,
  };
  if (processed.error) body.error = processed.error;
  return lockInBridgeRequest('/bridge/v1/companion/ack', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function runCompanionCommand(command) {
  const commandId = cleanText(command?.id, 100);
  if (!UUID_PATTERN.test(commandId)) return;
  const stored = await chrome.storage.local.get([
    KEYS.processedCompanionCommands,
    KEYS.companionDeviceId,
  ]);
  const deviceId = await getCompanionDeviceId(stored[KEYS.companionDeviceId]);
  if (command?.targetDeviceId !== deviceId) return;
  const processedCommands = Array.isArray(stored[KEYS.processedCompanionCommands])
    ? structuredClone(stored[KEYS.processedCompanionCommands])
    : [];
  const previous = processedCommands.find((item) => item?.id === commandId);
  if (previous) {
    await acknowledgeCompanionCommand(previous).catch(() => {});
    return;
  }

  let processed;
  const now = Date.now();
  const createdAt = Number(command?.createdAt);
  const expiresAt = Number(command?.expiresAt);
  const validCommandWindow = Number.isFinite(createdAt) &&
    Number.isFinite(expiresAt) &&
    createdAt <= now + 5 * 60_000 &&
    expiresAt > now &&
    expiresAt > createdAt &&
    expiresAt - createdAt <= 15 * 60_000;
  const deliverableStatus = command?.status === 'pending' || command?.status === 'delivered';
  const deliveredAt = Number(command?.deliveredAt);
  const leaseExpiresAt = Number(command?.leaseExpiresAt);
  const validDeliveryLease = command?.status !== 'delivered' || (
    Number.isFinite(deliveredAt) &&
    Number.isFinite(leaseExpiresAt) &&
    deliveredAt <= now + 5 * 60_000 &&
    leaseExpiresAt > now &&
    leaseExpiresAt > deliveredAt &&
    leaseExpiresAt <= expiresAt
  );
  if (!deliverableStatus || !validCommandWindow || !validDeliveryLease) {
    processed = {
      id: commandId,
      status: 'failed',
      result: null,
      error: 'The Poke companion command expired or was not deliverable.',
    };
  } else try {
    // Reserve the command ID durably before the browser mutation. If Chrome is
    // terminated in the narrow gap that follows, lease redelivery acknowledges
    // this failure receipt instead of repeating a possibly completed mutation.
    const reservation = {
      id: commandId,
      status: 'failed',
      result: null,
      error: 'Command processing was interrupted and was not replayed.',
    };
    await chrome.storage.local.set({
      [KEYS.processedCompanionCommands]: [...processedCommands, reservation].slice(-100),
    });

    let result;
    if (command.type === 'start_session') {
      const session = await startSession(command.payload || {});
      result = {
        sessionId: session.id,
        subject: session.subject,
        intention: session.intention,
        durationMinutes: session.durationMinutes,
        startedAt: session.startedAt,
        endsAt: session.endsAt,
      };
    } else if (command.type === 'stop_session') {
      const recap = await finishSession('poke');
      result = recap ? {
        stopped: true,
        sessionId: recap.id,
        elapsedMinutes: recap.elapsedMinutes,
        completed: recap.completed,
      } : { stopped: false, reason: 'No browser focus session was active.' };
    } else if (command.type === 'resolve_access_request') {
      result = await resolveUnblockAuthorized(command.payload || {});
    } else if (command.type === 'set_tiktok_policy') {
      result = await setTikTokPolicy(command.payload || {});
    } else if (command.type === 'block_tiktok') {
      result = await blockTikTokNow(command.payload || {});
    } else {
      throw new Error('Unsupported Poke companion command.');
    }
    processed = { id: commandId, status: 'completed', result, error: null };
  } catch (error) {
    processed = {
      id: commandId,
      status: 'failed',
      result: null,
      error: cleanText(error?.message || error, 500) || 'Command failed.',
    };
  }
  const completedReceipts = processedCommands.filter((item) => item?.id !== commandId);
  completedReceipts.push(processed);
  await chrome.storage.local.set({
    [KEYS.processedCompanionCommands]: completedReceipts.slice(-100),
  });
  await acknowledgeCompanionCommand(processed).catch(() => {});
}

let companionSyncPromise = null;

async function performCompanionSync() {
  const settings = await getSettings();
  if (!settings.lockInBridgeToken) return { connected: false, commandsProcessed: 0 };
  const first = await lockInBridgeRequest('/bridge/v1/companion/sync', {
    method: 'POST',
    body: JSON.stringify(await buildCompanionSnapshot()),
  }, settings);
  const commands = Array.isArray(first?.commands) ? first.commands : [];
  for (const command of commands) await runCompanionCommand(command);
  if (commands.length > 0) {
    await lockInBridgeRequest('/bridge/v1/companion/sync', {
      method: 'POST',
      body: JSON.stringify(await buildCompanionSnapshot()),
    }, settings);
  }
  return { connected: true, commandsProcessed: commands.length };
}

function syncCompanion() {
  if (!companionSyncPromise) {
    companionSyncPromise = performCompanionSync().finally(() => {
      companionSyncPromise = null;
    });
  }
  return companionSyncPromise;
}

async function getLockInStatus(sender) {
  if (!(await senderIsScholarOs(sender)) && !senderIsExtensionPage(sender)) {
    throw new Error('ScholarOS LockIn status is not authorized from this page.');
  }
  const companionSync = await syncCompanion().catch(() => ({ connected: false, commandsProcessed: 0 }));
  const [status, report, settings] = await Promise.all([
    lockInBridgeRequest('/bridge/v1/status', { method: 'GET' }),
    lockInBridgeRequest('/bridge/v1/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'get_focus_report', days: 7 }),
    }),
    getSettings(),
  ]);
  return {
    ...status,
    companion: {
      connected: companionSync.connected === true && status.companion?.connected === true,
      lastSeenAt: status.companion?.lastSeenAt != null && Number.isFinite(Number(status.companion.lastSeenAt))
        ? Number(status.companion.lastSeenAt)
        : null,
      secondsSinceSync: status.companion?.secondsSinceSync != null && Number.isFinite(Number(status.companion.secondsSinceSync))
        ? Math.max(0, Math.round(Number(status.companion.secondsSinceSync)))
        : null,
      pendingCommandCount: Math.max(0, Math.round(Number(status.companion?.pendingCommandCount) || 0)),
      extensionVersion: cleanText(status.companion?.extensionVersion, 30) || null,
      identityShared: settings.pokeShareIdentity === true,
      privateHistoryShared: settings.pokeSharePrivateHistory === true,
    },
    report: {
      periodDays: 7,
      focusMinutes: Math.max(0, Math.round(Number(report?.focusMinutes) || 0)),
      sessionCount: Math.max(0, Math.round(Number(report?.sessionCount) || 0)),
      completedTasks: Math.max(0, Math.round(Number(report?.completedTasks) || 0)),
      temporaryAccessRequests: Math.max(0, Math.round(Number(report?.temporaryAccessRequests) || 0)),
    },
  };
}

async function startLockInProtection(session, settings) {
  await chrome.storage.local.remove(KEYS.lockInSession);
  if (!settings.lockInBridgeToken || settings.blockedSites.length === 0) return null;
  const result = await lockInBridgeRequest('/bridge/v1/action', {
    method: 'POST',
    body: JSON.stringify({
      action: 'enter_focus_mode',
      domains: settings.blockedSites,
      durationMinutes: session.durationMinutes,
      taskDescription: cleanText(session.intention || session.subject, 500) || 'ScholarOS focus session',
    }),
  }, settings);
  const lockInSessionId = cleanText(result?.sessionId, 100);
  if (!lockInSessionId) throw new Error('LockIn did not return a focus session ID.');
  const ownership = {
    studySessionId: session.id,
    lockInSessionId,
    startedAt: Date.now(),
  };
  await chrome.storage.local.set({ [KEYS.lockInSession]: ownership });
  return ownership;
}

async function stopLockInProtection(ownership) {
  try {
    if (!ownership?.lockInSessionId) return;
    await lockInBridgeRequest('/bridge/v1/action', {
      method: 'POST',
      body: JSON.stringify({
        action: 'exit_focus_mode',
        sessionId: ownership.lockInSessionId,
      }),
    });
  } finally {
    await chrome.storage.local.remove(KEYS.lockInSession);
  }
}

async function temporarilyUnblockInLockIn(session, site, minutes) {
  const stored = await chrome.storage.local.get(KEYS.lockInSession);
  const ownership = stored[KEYS.lockInSession];
  if (!ownership || ownership.studySessionId !== session.id || !ownership.lockInSessionId) return;
  await lockInBridgeRequest('/bridge/v1/action', {
    method: 'POST',
    body: JSON.stringify({
      action: 'temporarily_unblock_domains',
      domains: [site],
      durationMinutes: minutes,
      sessionId: ownership.lockInSessionId,
    }),
  });
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
  if (input.clearLockInBridgeToken === true && previous.lockInBridgeToken) {
    const stored = await chrome.storage.local.get(KEYS.lockInSession);
    const ownership = stored[KEYS.lockInSession];
    if (ownership?.lockInSessionId) {
      try {
        await lockInBridgeRequest('/bridge/v1/action', {
          method: 'POST',
          body: JSON.stringify({
            action: 'exit_focus_mode',
            sessionId: ownership.lockInSessionId,
          }),
        }, previous);
        await chrome.storage.local.remove(KEYS.lockInSession);
      } catch {
        throw new Error('End the active focus session before forgetting the LockIn pairing.');
      }
    }
  }
  const enteredToken = cleanText(input.alexaBridgeToken, 500);
  const alexaBridgeToken = input.clearAlexaBridgeToken === true
    ? ''
    : enteredToken || previous.alexaBridgeToken;
  const enteredLockInToken = cleanText(input.lockInBridgeToken, 500);
  const lockInBridgeToken = input.clearLockInBridgeToken === true
    ? ''
    : enteredLockInToken || previous.lockInBridgeToken;
  const settings = normalizeSettings({
    ...input,
    alexaBridgeToken,
    lockInBridgeToken,
  });
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  await applyBlockRules();
  const tiktokStatus = await getTikTokStatus();
  if (tiktokStatus.blocked) {
    const reason = tiktokStatus.blockReason === 'manual'
      ? 'tiktok-manual'
      : tiktokStatus.blockReason === 'scholar_gate' ? 'scholar-gate' : 'tiktok-limit';
    await redirectOpenTikTokTabs(reason);
  }
  await broadcastStateChanged();
  return redactPrivatePairings(settings);
}

async function getAllData() {
  const stored = await chrome.storage.local.get(Object.values(KEYS));
  const settings = normalizeSettings(stored[KEYS.settings] || {});
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    settings: redactPrivatePairings(settings),
    currentSession: stored[KEYS.current] || null,
    sessions: stored[KEYS.sessions] || [],
    captures: stored[KEYS.captures] || [],
    unblockRequests: stored[KEYS.requests] || [],
    siteAllowances: stored[KEYS.allowances] || [],
    scholarEvents: stored[KEYS.events] || [],
    scholarContext: stored[KEYS.scholarContext] || normalizeScholarContext(),
    tiktokUsage: normalizeTikTokUsage(stored[KEYS.tiktokUsage] || {}),
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
    case 'studyx.tiktokActivity':
      return enqueueTikTokActivity(message.activity || {}, sender);
    case 'studyx.requestUnblock':
      return recordBlockedAttempt(message.site, message.reason, false);
    case 'studyx.resolveUnblock':
      return resolveUnblock(message.request || {}, sender);
    case 'studyx.getUnblockStatus':
      return getUnblockStatus(message.requestId, sender);
    case 'studyx.saveRecap':
      return saveRecap(message.recap || {});
    case 'studyx.dismissRecap':
      return dismissRecap();
    case 'studyx.getSettings':
      requireExtensionPage(sender);
      return redactPrivatePairings(await getSettings());
    case 'studyx.getTikTokStatus':
      requireExtensionPage(sender);
      return getTikTokStatus();
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
    case 'studyx.saveScholarSnapshot':
      return saveScholarSnapshot(message.snapshot || {}, sender);
    case 'studyx.alexaStatus':
      return getAlexaStatus(sender);
    case 'studyx.alexaCommand':
      return sendAlexaCommand(message.command || {}, sender);
    case 'studyx.lockInStatus':
      return getLockInStatus(sender);
    case 'studyx.syncCompanion':
      requireExtensionPage(sender);
      return syncCompanion();
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
  if (alarm.name === ACCESS_ALARM) applyBlockRules().catch(console.error);
  if (alarm.name === COMPANION_ALARM) {
    applyTikTokRule().catch(() => {});
    syncCompanion().catch(() => {});
  }
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
  await syncCompanion().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await finishExpiredSession();
  await applyBlockRules();
  const stored = await chrome.storage.local.get(KEYS.current);
  await updateBadge(Boolean(stored[KEYS.current]));
  await syncCompanion().catch(() => {});
});

ensureDefaults()
  .then(async () => {
    await applyTikTokRule();
    await syncCompanion();
  })
  .catch(console.error);
