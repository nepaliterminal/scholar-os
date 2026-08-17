'use strict';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = params.get('site') || 'this site';
let session = null;
let countdownInterval = null;
let requestPollInterval = null;
let requestId = sessionStorage.getItem(`studyx.requestId.${site}`) || '';

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

async function checkRequestStatus() {
  if (!requestId) return;
  try {
    const request = await send('studyx.getUnblockStatus', { requestId });
    if (request.status === 'pending') {
      byId('requestStatus').textContent = 'Waiting for a decision in ScholarOS…';
      byId('requestButton').disabled = true;
      return;
    }
    clearInterval(requestPollInterval);
    requestPollInterval = null;
    sessionStorage.removeItem(`studyx.requestId.${site}`);
    if (request.status === 'approved') {
      const until = request.allowedUntil
        ? new Date(request.allowedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'a short time';
      byId('requestStatus').textContent = `Approved until ${until}. The block returns automatically.`;
      byId('openSiteButton').hidden = false;
    } else {
      byId('requestStatus').textContent = 'Request denied. Return to your focus intention.';
      byId('requestButton').disabled = false;
      requestId = '';
    }
  } catch (error) {
    byId('requestStatus').textContent = error.message;
  }
}

function startRequestPolling() {
  clearInterval(requestPollInterval);
  checkRequestStatus();
  requestPollInterval = window.setInterval(checkRequestStatus, 2000);
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
    if (requestId) startRequestPolling();
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
    const result = await send('studyx.requestUnblock', { site, reason });
    requestId = result.request?.id || '';
    if (requestId) sessionStorage.setItem(`studyx.requestId.${site}`, requestId);
    byId('requestStatus').textContent = 'Waiting for a decision in ScholarOS…';
    byId('requestReason').value = '';
    if (requestId) startRequestPolling();
  } catch (error) {
    byId('requestStatus').textContent = error.message;
  } finally {
    byId('requestButton').disabled = Boolean(requestId);
  }
});

byId('settingsButton').addEventListener('click', () => chrome.runtime.openOptionsPage());
byId('openSiteButton').addEventListener('click', () => { location.href = `https://${site}`; });
window.addEventListener('beforeunload', () => {
  clearInterval(countdownInterval);
  clearInterval(requestPollInterval);
});
boot();
