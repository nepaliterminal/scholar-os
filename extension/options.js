'use strict';

const byId = (id) => document.getElementById(id);
let allData = null;

function settingsFromForm(extra = {}) {
  return {
    settingsVersion: 4,
    defaultDuration: Number(byId('defaultDuration').value),
    blockedSites: cleanSiteLines(),
    youtubeShield: byId('youtubeShield').value,
    hideYouTubeShorts: byId('hideYouTubeShorts').checked,
    hideYouTubeRecommendations: byId('hideYouTubeRecommendations').checked,
    scholarOsUrl: byId('scholarOsUrl').value.trim(),
    alexaBridgeUrl: byId('alexaBridgeUrl').value.trim(),
    alexaBridgeToken: byId('alexaBridgeToken').value.trim(),
    ...extra,
  };
}

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'Study Session OS did not respond.');
  return response.data;
}

function showMessage(text, isError = false) {
  const element = byId('message');
  element.textContent = text;
  element.classList.toggle('error', isError);
  element.classList.remove('hidden');
  window.setTimeout(() => element.classList.add('hidden'), 5000);
}

function cleanSiteLines() {
  return byId('blockedSites').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function updateSiteCount() {
  const sites = cleanSiteLines();
  const count = sites.length;
  byId('siteCount').textContent = `${count} site${count === 1 ? '' : 's'}`;
  const blocksYouTube = sites.some((value) => {
    let site = value.toLowerCase().trim();
    try {
      if (site.includes('://')) site = new URL(site).hostname;
    } catch {
      return false;
    }
    site = site.replace(/^\*\./, '').replace(/^www\./, '').split('/')[0].split(':')[0];
    return site === 'youtube.com' || site.endsWith('.youtube.com');
  });
  byId('youtubeConflict').classList.toggle('hidden', !blocksYouTube);
}

function renderRequests(requests) {
  const container = byId('requestList');
  container.replaceChildren();
  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No access requests yet.';
    container.append(empty);
    return;
  }
  for (const request of requests) {
    const item = document.createElement('article');
    item.className = 'request-item';
    const header = document.createElement('header');
    const site = document.createElement('strong');
    site.textContent = request.site;
    const time = document.createElement('time');
    time.dateTime = request.createdAt;
    time.textContent = new Date(request.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const reason = document.createElement('p');
    reason.textContent = request.reason;
    header.append(site, time);
    item.append(header, reason);
    container.append(item);
  }
}

async function load() {
  try {
    const [settings, exportedData] = await Promise.all([
      send('studyx.getSettings'),
      send('studyx.getAllData'),
    ]);
    allData = exportedData;
    byId('defaultDuration').value = settings.defaultDuration;
    byId('blockedSites').value = settings.blockedSites.join('\n');
    byId('youtubeShield').value = settings.youtubeShield;
    byId('hideYouTubeShorts').checked = settings.hideYouTubeShorts;
    byId('hideYouTubeRecommendations').checked = settings.hideYouTubeRecommendations;
    byId('scholarOsUrl').value = settings.scholarOsUrl;
    byId('alexaBridgeUrl').value = settings.alexaBridgeUrl;
    byId('alexaBridgeToken').value = '';
    byId('alexaBridgeToken').placeholder = settings.alexaBridgePaired
      ? 'Pairing saved privately'
      : 'Run npm run bridge:pair in alexainit';
    byId('alexaBridgeStatus').textContent = settings.alexaBridgePaired
      ? 'A private pairing token is saved. Enter a new token only to replace it.'
      : 'Not paired yet.';
    updateSiteCount();
    renderRequests(allData.unblockRequests || []);
  } catch (error) {
    showMessage(error.message, true);
  }
}

byId('blockedSites').addEventListener('input', updateSiteCount);

byId('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('saveButton');
  button.disabled = true;
  try {
    const settings = await send('studyx.saveSettings', {
      settings: settingsFromForm(),
    });
    byId('alexaBridgeToken').value = '';
    byId('alexaBridgeToken').placeholder = settings.alexaBridgePaired ? 'Pairing saved privately' : 'Run npm run bridge:pair in alexainit';
    byId('blockedSites').value = settings.blockedSites.join('\n');
    updateSiteCount();
    showMessage('Settings saved. Active sessions use the new rules immediately.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

byId('clearRequests').addEventListener('click', async () => {
  if (!confirm('Clear the saved access-request history?')) return;
  try {
    await send('studyx.clearRequests');
    renderRequests([]);
    showMessage('Access-request history cleared.');
  } catch (error) {
    showMessage(error.message, true);
  }
});

byId('testAlexaBridge').addEventListener('click', async () => {
  const target = byId('alexaBridgeStatus');
  target.textContent = 'Testing local bridge…';
  try {
    await send('studyx.saveSettings', {
      settings: settingsFromForm(),
    });
    byId('alexaBridgeToken').value = '';
    byId('alexaBridgeToken').placeholder = 'Pairing saved privately';
    const status = await send('studyx.alexaStatus');
    target.textContent = `Connected · ${status.devices.length} device(s) · ${status.routines.length} routine(s)`;
  } catch (error) {
    target.textContent = error.message;
  }
});

byId('forgetAlexaPairing').addEventListener('click', async () => {
  if (!confirm('Forget the saved Alexa bridge pairing on this Chrome profile?')) return;
  const target = byId('alexaBridgeStatus');
  try {
    await send('studyx.saveSettings', { settings: settingsFromForm({ clearAlexaBridgeToken: true, alexaBridgeToken: '' }) });
    byId('alexaBridgeToken').value = '';
    byId('alexaBridgeToken').placeholder = 'Run npm run bridge:pair in alexainit';
    target.textContent = 'Pairing forgotten. Amazon login data on the local bridge was not changed.';
  } catch (error) {
    target.textContent = error.message;
  }
});

byId('exportButton').addEventListener('click', async () => {
  try {
    const data = await send('studyx.getAllData');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `study-session-os-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showMessage(error.message, true);
  }
});

load();
