'use strict';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = params.get('site') || 'this site';
let session = null;
let countdownInterval = null;

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'Study Session OS did not respond.');
  return response.data;
}

function countdownText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateCountdown() {
  if (!session) return;
  const remaining = session.endsAt - Date.now();
  byId('countdown').textContent = countdownText(remaining);
  if (remaining <= 0) location.reload();
}

async function boot() {
  byId('blockedSite').textContent = site;
  try {
    const state = await send('studyx.getState');
    session = state.current;
    if (session) {
      byId('sessionSubject').textContent = session.subject;
      byId('sessionIntention').textContent = session.intention || 'Stay with the next useful step.';
      updateCountdown();
      countdownInterval = window.setInterval(updateCountdown, 1000);
    } else {
      byId('countdown').textContent = 'complete';
      byId('sessionSubject').textContent = 'a finished session';
    }
    if (!sessionStorage.getItem('studyx.blockRecorded')) {
      await send('studyx.blockedAttempt', { site });
      sessionStorage.setItem('studyx.blockRecorded', 'true');
    }
  } catch (error) {
    byId('requestStatus').textContent = error.message;
  }
}

byId('backButton').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

byId('requestButton').addEventListener('click', async () => {
  const reason = byId('requestReason').value.trim();
  if (!reason) {
    byId('requestStatus').textContent = 'Explain why this site is needed first.';
    return;
  }
  byId('requestButton').disabled = true;
  try {
    await send('studyx.requestUnblock', { site, reason });
    byId('requestStatus').textContent = 'Request saved for ScholarOS approval.';
    byId('requestReason').value = '';
  } catch (error) {
    byId('requestStatus').textContent = error.message;
  } finally {
    byId('requestButton').disabled = false;
  }
});

byId('settingsButton').addEventListener('click', () => chrome.runtime.openOptionsPage());
window.addEventListener('beforeunload', () => clearInterval(countdownInterval));
boot();
