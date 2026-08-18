'use strict';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = params.get('site') || 'this site';
const blockReason = params.get('reason') || '';
const isScholarGate = blockReason === 'scholar-gate';
const isTikTokLimit = blockReason === 'tiktok-limit' || blockReason === 'tiktok-manual' || isScholarGate;
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

function updateTikTokCountdown(blockedUntil) {
  const remaining = Number(blockedUntil) - Date.now();
  byId('countdown').textContent = countdownText(remaining);
  if (remaining <= 0) location.href = 'https://www.tiktok.com/';
}

async function updateScholarGate() {
  const status = await send('studyx.getTikTokStatus');
  if (status.blockReason !== 'scholar_gate') {
    location.href = 'https://www.tiktok.com/';
    return;
  }
  const gate = status.scholarScreenGate;
  const incomplete = Array.isArray(gate?.incompleteItems) ? gate.incompleteItems : [];
  byId('countdown').textContent = `${incomplete.length} left`;
  byId('sessionIntention').textContent = incomplete
    .slice(0, 4)
    .map((item) => item.text)
    .join(' · ') || 'Return to ScholarOS to refresh today’s list.';
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
    if (isTikTokLimit) {
      const status = await send('studyx.getTikTokStatus');
      const usedMinutes = Math.floor(status.activeSeconds / 60);
      const scrollingMinutes = Math.floor(status.scrollingSeconds / 60);
      byId('eyebrow').textContent = 'TikTok guard';
      byId('headline').textContent = isScholarGate
        ? `${status.scholarScreenGate?.label || 'ScholarOS'} comes first.`
        : blockReason === 'tiktok-manual' ? 'TikTok is paused.' : 'Daily TikTok limit reached.';
      byId('lead').textContent = isScholarGate
        ? `${status.scholarScreenGate?.reason || 'Finish today’s required items before screen time.'} ScholarOS is using the ${status.scholarScreenGate?.mode || 'current'} day page—not an inactive school or summer routine.`
        : blockReason === 'tiktok-manual'
          ? `Poke paused TikTok for a focused break. Today’s total is ${usedMinutes} minutes, including ${scrollingMinutes} minutes scrolling.`
          : `You used ${usedMinutes} of ${status.dailyLimitMinutes} minutes today, including ${scrollingMinutes} minutes scrolling.`;
      byId('intentionCard').hidden = !isScholarGate;
      if (isScholarGate) byId('intentionCard').querySelector('span').textContent = 'Before screen time';
      byId('requestPanel').hidden = true;
      byId('timeLabel').textContent = isScholarGate
        ? 'Required items'
        : status.blockReason === 'manual' ? 'Break time remaining' : 'Resets in';
      byId('backButton').textContent = 'Leave TikTok';
      if (isScholarGate) {
        await updateScholarGate();
        countdownInterval = window.setInterval(() => updateScholarGate().catch(() => {}), 2_000);
      } else {
        updateTikTokCountdown(status.blockedUntil);
        countdownInterval = window.setInterval(() => updateTikTokCountdown(status.blockedUntil), 1000);
      }
      return;
    }
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
