'use strict';

const byId = (id) => document.getElementById(id);
const views = ['loadingView', 'startView', 'activeView', 'recapView'];
let state = null;
let timerInterval = null;
let selectedRating = null;

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'Study Session OS did not respond.');
  return response.data;
}

function showView(id) {
  for (const view of views) byId(view).classList.toggle('hidden', view !== id);
}

function showMessage(message, kind = 'error') {
  const target = byId(kind === 'success' ? 'successBanner' : 'errorBanner');
  const other = byId(kind === 'success' ? 'errorBanner' : 'successBanner');
  other.classList.add('hidden');
  target.textContent = message;
  target.classList.remove('hidden');
  window.setTimeout(() => target.classList.add('hidden'), 5000);
}

function formatMinutes(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? `${number} min` : `${number.toFixed(1)} min`;
}

function formatWhen(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function clearChildren(element) {
  while (element.firstChild) element.firstChild.remove();
}

function renderRecentSessions() {
  const container = byId('recentSessions');
  clearChildren(container);
  const sessions = state.recentSessions || [];
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Your completed sessions will appear here.';
    container.append(empty);
    return;
  }

  for (const session of sessions.slice(0, 3)) {
    const item = document.createElement('div');
    item.className = 'recent-item';
    const subject = document.createElement('strong');
    subject.textContent = session.subject;
    const duration = document.createElement('span');
    duration.textContent = formatMinutes(session.elapsedMinutes);
    const when = document.createElement('span');
    when.textContent = formatWhen(session.endedAt);
    item.append(subject, duration, when);
    container.append(item);
  }
}

function renderStart() {
  showView('startView');
  const settings = state.settings;
  byId('durationInput').value = settings.defaultDuration;
  document.querySelectorAll('.duration-chip').forEach((chip) => {
    chip.classList.toggle('selected', Number(chip.dataset.minutes) === settings.defaultDuration);
  });
  const youtubeExtras = [
    settings.hideYouTubeShorts ? 'Shorts hidden' : '',
    settings.hideYouTubeRecommendations ? 'recommendations hidden' : '',
  ].filter(Boolean);
  byId('protectionSummary').textContent = `${settings.blockedSites.length} blocked sites · YouTube ${settings.youtubeShield}${youtubeExtras.length ? ` · ${youtubeExtras.join(', ')}` : ''}`;
  byId('syncCount').textContent = state.pendingScholarEvents
    ? `${state.pendingScholarEvents} awaiting ScholarOS`
    : 'ScholarOS up to date';

  const subjects = [...new Set([
    ...(state.scholarContext?.classes || []),
    ...(state.recentSessions || []).map((session) => session.subject),
  ].filter(Boolean))];
  const suggestions = byId('subjectSuggestions');
  clearChildren(suggestions);
  for (const subject of subjects) {
    const option = document.createElement('option');
    option.value = subject;
    suggestions.append(option);
  }
  renderRecentSessions();
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimer() {
  if (!state?.current) return;
  const remaining = state.current.endsAt - Date.now();
  byId('timerText').textContent = formatCountdown(remaining);
  const total = state.current.durationMinutes * 60_000;
  const elapsed = Math.max(0, total - Math.max(0, remaining));
  byId('progressBar').style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
  if (remaining <= 0) refresh();
}

function renderCaptures() {
  const container = byId('currentCaptures');
  clearChildren(container);
  const captures = state.currentCaptures || [];
  if (!captures.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No captures yet. Select useful text while you study.';
    container.append(empty);
    return;
  }

  for (const capture of captures.slice(0, 3)) {
    const item = document.createElement('div');
    item.className = 'capture-item';
    const kind = document.createElement('span');
    kind.className = 'capture-kind';
    kind.textContent = capture.kind === 'note' ? '✎' : '▰';
    const text = document.createElement('strong');
    text.textContent = capture.note || capture.quote;
    const source = document.createElement('span');
    source.textContent = capture.title || 'Untitled page';
    item.append(kind, text, source);
    container.append(item);
  }
}

function renderActive() {
  showView('activeView');
  const session = state.current;
  byId('activeSubject').textContent = session.subject;
  byId('activeIntention').textContent = session.intention || 'Stay with the next useful step.';
  byId('highlightCount').textContent = session.highlightCount;
  byId('noteCount').textContent = session.noteCount;
  byId('blockedCount').textContent = session.blockedAttempts;
  renderCaptures();
  updateTimer();
  clearInterval(timerInterval);
  timerInterval = window.setInterval(updateTimer, 1000);
}

function renderRecap() {
  showView('recapView');
  clearInterval(timerInterval);
  const recap = state.pendingRecap;
  byId('recapTitle').textContent = `${recap.subject} complete`;
  byId('recapStats').textContent = `${formatMinutes(recap.elapsedMinutes)} focused · ${recap.captureCount} captures · ${recap.blockedAttempts} redirects`;
  byId('starSuggestion').textContent = recap.suggestedStars
    ? `⭐ Suggested ScholarOS reward: ${recap.suggestedStars} stars`
    : 'Session recorded—honest restarts still count as progress.';
  selectedRating = null;
  document.querySelectorAll('[data-rating]').forEach((button) => button.classList.remove('selected'));
  byId('reflectionInput').value = '';
}

async function refresh() {
  try {
    state = await send('studyx.getState');
    if (state.pendingRecap) renderRecap();
    else if (state.current) renderActive();
    else renderStart();
  } catch (error) {
    showView('startView');
    showMessage(error.message);
  }
}

document.querySelectorAll('.duration-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    byId('durationInput').value = chip.dataset.minutes;
    document.querySelectorAll('.duration-chip').forEach((item) => item.classList.toggle('selected', item === chip));
  });
});

byId('durationInput').addEventListener('input', () => {
  document.querySelectorAll('.duration-chip').forEach((chip) => {
    chip.classList.toggle('selected', Number(chip.dataset.minutes) === Number(byId('durationInput').value));
  });
});

byId('startForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('startButton');
  button.disabled = true;
  button.textContent = 'Starting…';
  try {
    await send('studyx.startSession', {
      session: {
        subject: byId('subjectInput').value,
        intention: byId('intentionInput').value,
        brainDump: byId('brainDumpInput').value,
        durationMinutes: Number(byId('durationInput').value),
      },
    });
    await refresh();
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Start focus session';
  }
});

byId('stopButton').addEventListener('click', async () => {
  if (!confirm('End this focus session early? Your work will still be saved.')) return;
  try {
    await send('studyx.stopSession');
    await refresh();
  } catch (error) {
    showMessage(error.message);
  }
});

byId('captureNoteButton').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active page was found.');
    await chrome.tabs.sendMessage(tab.id, { type: 'studyx.openNoteComposer' });
    window.close();
  } catch {
    showMessage('Notes cannot be added on this browser page. Open a normal website and try again.');
  }
});

document.querySelectorAll('[data-rating]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedRating = button.dataset.rating;
    document.querySelectorAll('[data-rating]').forEach((item) => item.classList.toggle('selected', item === button));
  });
});

byId('saveRecapButton').addEventListener('click', async () => {
  try {
    await send('studyx.saveRecap', {
      recap: {
        rating: selectedRating,
        reflection: byId('reflectionInput').value,
      },
    });
    showMessage('Reflection saved for ScholarOS.', 'success');
    await refresh();
  } catch (error) {
    showMessage(error.message);
  }
});

byId('dismissRecapButton').addEventListener('click', async () => {
  try {
    await send('studyx.dismissRecap');
    await refresh();
  } catch (error) {
    showMessage(error.message);
  }
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') refresh();
});

refresh();
