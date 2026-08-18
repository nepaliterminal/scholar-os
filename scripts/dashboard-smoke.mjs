import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardPath = resolve(here, '../index.html');
const dashboardUrl = pathToFileURL(dashboardPath).href;
const dashboardSource = await readFile(dashboardPath, 'utf8');
assert.equal(dashboardSource.includes('sms:'), false, 'Poke sync must not export dashboard data through SMS');
assert.equal(dashboardSource.includes('mailto:'), false, 'Poke sync must not export dashboard data through email');
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
    lockInText: document.querySelector('#lockInConnection').innerText,
    alexaControlsDisabled: document.querySelector('#alexaSpeakBtn').disabled,
    scholarTask: document.querySelector('#scholarNextTask').innerText,
    autopilotDisabled: document.querySelector('#scholarAutopilotBtn').disabled,
    dayMode: document.querySelector('#todayDayMode').innerText,
    dayTitle: document.querySelector('#todayDayTitle').innerText,
  })`);
  assert.equal(initial.overlayHidden, true);
  assert.equal(initial.account, 'Smoke Test');
  assert.ok(initial.subjectCount >= 1);
  assert.match(initial.connectionText, /Extension not detected/);
  assert.match(initial.alexaText, /Extension not detected/);
  assert.match(initial.lockInText, /Extension not detected/);
  assert.equal(initial.alexaControlsDisabled, true);
  assert.ok(initial.scholarTask.length > 2);
  assert.equal(initial.autopilotDisabled, true);
  assert.ok(initial.dayMode.length > 2);
  assert.ok(initial.dayTitle.length > 2);

  const dayPages = await evaluate(`(() => {
    const chooseDate = date => {
      document.querySelector('#dayPlanDate').value = date;
      document.querySelector('#dayPlanDate').dispatchEvent(new Event('change', { bubbles: true }));
    };
    const chooseMode = mode => document.querySelector('[data-day-mode="' + mode + '"]').click();
    const setTitle = title => {
      document.querySelector('#dayPageTitle').value = title;
      document.querySelector('#dayPageTitle').dispatchEvent(new Event('input', { bubbles: true }));
    };

    chooseDate('2026-08-22');
    chooseMode('party');
    setTitle('Birthday at the park');
    document.querySelector('#dayPageNotes').value = 'Bring the blue gift bag.';
    document.querySelector('#dayPageNotes').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#dayItemInput').value = 'Bring sunscreen';
    document.querySelector('#dayItemAddBtn').click();
    document.querySelector('[data-day-check="0"]').click();

    chooseMode('school');
    setTitle('Saturday school event');
    chooseMode('party');
    const restoredPartyTitle = document.querySelector('#dayPageTitle').value;
    const restoredPartyNotes = document.querySelector('#dayPageNotes').value;
    const restoredPartyChecklist = [...document.querySelectorAll('[data-day-item-text]')].map(input => input.value).join(' | ');
    const restoredPartyDone = document.querySelector('[data-day-check="0"]').checked;

    chooseDate('2026-08-23');
    chooseMode('summer');
    setTitle('Pool day');
    chooseDate('2026-08-22');
    chooseMode('school');
    const restoredSchoolTitle = document.querySelector('#dayPageTitle').value;
    const stored = JSON.parse(localStorage.getItem('scholaros.g6.data.Smoke Test'));
    return {
      restoredPartyTitle,
      restoredPartyNotes,
      restoredPartyChecklist,
      restoredPartyDone,
      restoredSchoolTitle,
      otherDateTitle: stored.dayPlans['2026-08-23'].pages.summer.title,
      dateCount: Object.keys(stored.dayPlans).length,
      snapshotMode: window.ScholarOS.getSnapshot().day.mode,
    };
  })()`);
  assert.equal(dayPages.restoredPartyTitle, 'Birthday at the park');
  assert.equal(dayPages.restoredPartyNotes, 'Bring the blue gift bag.');
  assert.match(dayPages.restoredPartyChecklist, /Bring sunscreen/);
  assert.equal(dayPages.restoredPartyDone, true);
  assert.equal(dayPages.restoredSchoolTitle, 'Saturday school event');
  assert.equal(dayPages.otherDateTitle, 'Pool day');
  assert.ok(dayPages.dateCount >= 3);
  assert.ok(['school', 'summer', 'party'].includes(dayPages.snapshotMode));

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
      { id: 'evt_smoke_request', version: 1, type: 'unblock.requested', occurredAt: new Date().toISOString(), payload: { id: 'request_smoke', sessionId: 'session_smoke', scholarAccount: 'Smoke Test', subject: 'Science', site: 'example.com', reason: 'Teacher link', status: 'pending', createdAt: new Date().toISOString() } },
      { id: 'evt_smoke_request_resolved', version: 1, type: 'unblock.resolved', occurredAt: new Date().toISOString(), payload: { id: 'request_smoke', sessionId: 'session_smoke', scholarAccount: 'Smoke Test', site: 'example.com', status: 'denied', resolvedAt: new Date().toISOString(), allowedUntil: null } }
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
    };
  })()`);

  assert.deepEqual(integration.firstAck, ['evt_smoke_completed']);
  assert.deepEqual(integration.replayAck, ['evt_smoke_completed']);
  assert.equal(integration.relatedAck.length, 4);
  assert.deepEqual(integration.wrongAccountAck, []);
  assert.equal(integration.stars, 5, 'a replayed completion must not duplicate study stars');
  assert.equal(integration.sessions, 1, 'a replayed completion must not duplicate history');
  assert.match(integration.sessionResult, /Science/);
  assert.match(integration.captureResult, /A useful fact/);
  assert.match(integration.requestResult, /Teacher link/);
  assert.match(integration.requestResult, /denied/);
  assert.equal(integration.weekTotal, '25 min');
  assert.equal(integration.completionRate, '100%');
  assert.equal(integration.focusStreak, '1 day');
  assert.match(integration.subjectAnalytics, /Science/);

  const pokeCompanion = await evaluate(`(async () => {
    studyExtensionAvailable = true;
    let requestedSnapshot = null;
    const respond = event => {
      if (event.source !== window || event.data?.source !== 'scholar-os' || event.data.type !== 'SCHOLAROS_LOCKIN_REQUEST') return;
      requestedSnapshot = event.data.snapshot;
      window.postMessage({
        source: 'studyx-extension',
        version: 1,
        type: 'STUDYX_LOCKIN_RESULT',
        requestId: event.data.requestId,
        ok: true,
        data: {
          connected: true,
          enforcementReady: true,
          effectiveBlockedDomainCount: 0,
          temporaryExceptionCount: 0,
          focusMode: { active: false, endsAt: null },
          report: { focusMinutes: 25, sessionCount: 1, completedTasks: 0, temporaryAccessRequests: 0 },
          companion: {
            connected: true,
            lastSeenAt: Date.now(),
            secondsSinceSync: 1,
            pendingCommandCount: 0,
            extensionVersion: '0.7.0',
            identityShared: false,
            privateHistoryShared: false,
          },
        },
      }, '*');
    };
    window.addEventListener('message', respond);
    await document.querySelector('#reportBtn').onclick();
    window.removeEventListener('message', respond);
    return {
      button: document.querySelector('#reportBtn').innerText,
      note: document.querySelector('#reportNote').innerText,
      status: document.querySelector('#lockInPokeStatus').innerText,
      legacyBuilderPresent: typeof window.buildReport === 'function',
      requestedMode: requestedSnapshot?.day?.mode || null,
      requestedDate: requestedSnapshot?.day?.date || null,
    };
  })()`);
  assert.match(pokeCompanion.button, /Sync Poke now/);
  assert.match(pokeCompanion.note, /Poke is synced/);
  assert.match(pokeCompanion.note, /Profile name is private/);
  assert.match(pokeCompanion.status, /Poke companion synced/);
  assert.equal(pokeCompanion.legacyBuilderPresent, false);
  assert.ok(['school', 'summer', 'party'].includes(pokeCompanion.requestedMode));
  assert.equal(pokeCompanion.requestedDate, new Date().toISOString().slice(0, 10));

  const scholarMode = await evaluate(`(async () => {
    const rankedTask = nextScholarTask();
    document.querySelector('#memoryType').value = 'flashcard';
    document.querySelector('#memoryPrompt').value = 'What planet is known as the Red Planet?';
    document.querySelector('#memoryDetails').value = 'Mars';
    saveStudyMemory();
    document.querySelector('#memoryType').value = 'note';
    document.querySelector('#memoryPrompt').value = 'Orbit note';
    document.querySelector('#memoryDetails').value = 'Planets orbit the Sun.';
    saveStudyMemory();

    studyExtensionAvailable = true;
    alexaBridgeState = { connected: false, devices: [], routines: [], error: '' };
    studyExtensionState.current = null;
    const respond = event => {
      if (event.source !== window || event.data?.source !== 'scholar-os' || event.data.command !== 'startSession') return;
      const session = {
        id: 'session_autopilot',
        subject: event.data.payload.session.subject,
        intention: event.data.payload.session.intention,
        durationMinutes: event.data.payload.session.durationMinutes,
        startedAt: Date.now(),
        endsAt: Date.now() + event.data.payload.session.durationMinutes * 60000,
      };
      window.postMessage({ source: 'studyx-extension', version: 1, type: 'STUDYX_COMMAND_RESULT', commandId: event.data.commandId, ok: true, data: session }, '*');
    };
    window.addEventListener('message', respond);
    await startScholarAutopilot();
    window.removeEventListener('message', respond);
    const stored = JSON.parse(localStorage.getItem('scholaros.g6.data.Smoke Test'));
    return {
      rankedTitle: rankedTask?.title,
      rankedReason: rankedTask?.why,
      rankedDuration: rankedTask?.duration,
      memoryRendered: document.querySelector('#memoryList').innerText,
      flashcards: stored.flashcards.length,
      notes: stored.studyNotes.length,
      answerMatched: answerMatches('It is Mars', 'Mars'),
      morning: scholarMorningText(),
      hint: scholarHint(rankedTask, 2),
      autopilotIntention: studyExtensionState.current?.intention,
      autopilotStatus: document.querySelector('#scholarModeStatus').innerText,
    };
  })()`);
  assert.ok(scholarMode.rankedTitle);
  assert.match(scholarMode.rankedReason, /priority|due|overdue|to-do/i);
  assert.ok([15, 25, 45].includes(scholarMode.rankedDuration));
  assert.match(scholarMode.memoryRendered, /Red Planet/);
  assert.match(scholarMode.memoryRendered, /Orbit note/);
  assert.equal(scholarMode.flashcards, 1);
  assert.equal(scholarMode.notes, 1);
  assert.equal(scholarMode.answerMatched, true);
  assert.ok(scholarMode.morning.length <= 250);
  assert.match(scholarMode.hint, /Without looking for the answer/);
  assert.equal(scholarMode.autopilotIntention, scholarMode.rankedTitle);
  assert.match(scholarMode.autopilotStatus, /Focus protection is on/);

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
    const screenshotTarget = process.env.SCHOLAROS_SCREENSHOT_TARGET || '.alexa-home-actions';
    await evaluate(`document.querySelector(${JSON.stringify(screenshotTarget)}).scrollIntoView({ block: 'start' })`);
    await delay(100);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(process.env.SCHOLAROS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }

  console.log(JSON.stringify({
    dashboardLoaded: true,
    accountMigration: true,
    eventSyncRendered: true,
    analyticsRendered: true,
    dayPagesSeparated: true,
    privatePokeCompanion: true,
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
