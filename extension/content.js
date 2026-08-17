'use strict';

(() => {
  if (window.top !== window) return;

  let currentSession = null;
  let settings = null;
  let selectedRange = null;
  let toolbarHost = null;
  let toolbarRoot = null;
  let shieldStyle = null;

  async function send(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Study Session OS did not respond.');
    return response.data;
  }

  function normalizedUrl(value) {
    try {
      const url = new URL(value);
      url.search = '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function isScholarOsPage() {
    return Boolean(settings?.scholarOsUrl && normalizedUrl(location.href) === normalizedUrl(settings.scholarOsUrl));
  }

  function postToScholarOs(message) {
    if (!isScholarOsPage()) return;
    window.postMessage(
      { source: 'studyx-extension', version: 1, ...message },
      location.origin === 'null' ? '*' : location.origin,
    );
  }

  function postStudyState(state) {
    postToScholarOs({
      type: 'STUDYX_STATE',
      state: {
        current: state.current,
        pendingRecap: state.pendingRecap,
        pendingScholarEvents: state.pendingScholarEvents,
      },
    });
  }

  async function refreshState() {
    try {
      const state = await send('studyx.getState');
      currentSession = state.current;
      settings = state.settings;
      applyYouTubeShield();
      if (!currentSession) hideToolbar();
      announceBridge();
      postStudyState(state);
    } catch {
      currentSession = null;
    }
  }

  function applyYouTubeShield() {
    if (!shieldStyle) {
      shieldStyle = document.createElement('style');
      shieldStyle.id = 'studyx-youtube-shield';
    }
    if (!shieldStyle.isConnected) (document.head || document.documentElement).append(shieldStyle);

    const isYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);
    if (!isYouTube || !currentSession || !settings || settings.youtubeShield === 'off') {
      shieldStyle.textContent = '';
      document.documentElement.removeAttribute('data-studyx-shield');
      return;
    }

    document.documentElement.setAttribute('data-studyx-shield', settings.youtubeShield);
    const thumbnailSelectors = [
      'ytd-thumbnail img',
      'ytd-rich-item-renderer #thumbnail img',
      'ytd-video-renderer #thumbnail img',
      'ytd-compact-video-renderer #thumbnail img',
      'yt-thumbnail-view-model img',
      '.ytThumbnailViewModelImage img',
      'yt-lockup-view-model img',
      'ytd-playlist-video-renderer #thumbnail img',
      'a#thumbnail img',
    ].join(',');

    let css = '';
    if (settings.youtubeShield === 'blur') {
      css += `
        ${thumbnailSelectors} {
          filter: blur(15px) saturate(.35) !important;
          transform: scale(1.04) !important;
          transition: filter .16s ease !important;
        }
        ${thumbnailSelectors.split(',').map((selector) => `${selector.trim()}:hover`).join(',')} {
          filter: blur(3px) saturate(.75) !important;
        }
      `;
    }
    if (settings.youtubeShield === 'hide') {
      css += `
        ${thumbnailSelectors} { opacity: 0 !important; }
        ytd-thumbnail, yt-thumbnail-view-model {
          background: #ece7df !important;
          border-radius: 10px !important;
        }
      `;
    }
    if (settings.hideYouTubeShorts) {
      css += `
        ytd-rich-section-renderer:has(a[href^="/shorts/"]),
        ytd-reel-shelf-renderer,
        ytd-guide-entry-renderer:has(a[href="/shorts"]),
        ytd-mini-guide-entry-renderer:has(a[href="/shorts"]) { display: none !important; }
      `;
    }
    if (settings.hideYouTubeRecommendations) {
      css += `
        ytd-watch-flexy #secondary,
        ytd-browse[page-subtype="home"] #primary,
        ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer { display: none !important; }
      `;
    }
    shieldStyle.textContent = css;
  }

  function keepYouTubeShieldMounted() {
    if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return;
    const observer = new MutationObserver(() => {
      if (shieldStyle && !shieldStyle.isConnected) applyYouTubeShield();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', applyYouTubeShield);
  }

  function createToolbar() {
    if (toolbarHost) return;
    toolbarHost = document.createElement('div');
    toolbarHost.id = 'studyx-capture-toolbar-host';
    toolbarHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;';
    toolbarRoot = toolbarHost.attachShadow({ mode: 'closed' });
    toolbarRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .panel {
          width: 286px; padding: 8px; border: 1px solid #d9cbb7; border-radius: 13px;
          color: #40362c; background: #fffdf8; box-shadow: 0 12px 34px rgb(43 35 28 / 24%);
          font: 13px/1.35 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .actions { display: flex; align-items: center; gap: 6px; }
        button {
          border: 0; border-radius: 9px; padding: 7px 9px; color: #735033; background: #eee2d1;
          font: 700 11px inherit; cursor: pointer;
        }
        button:hover { background: #e3d1b8; }
        button.primary { color: #fff; background: #9c6f44; }
        button.primary:hover { background: #735033; }
        button.close { margin-left: auto; padding: 5px 8px; color: #8b7a66; background: transparent; font-size: 16px; }
        .composer { display: none; margin-top: 7px; }
        .composer.open { display: grid; gap: 6px; }
        textarea {
          width: 100%; min-height: 68px; padding: 8px; resize: vertical; outline: 0;
          border: 1px solid #d9cbb7; border-radius: 8px; color: #40362c; background: #fff;
          font: 12px/1.4 inherit;
        }
        textarea:focus { border-color: #9c6f44; }
        .composer-footer { display: flex; justify-content: flex-end; }
        .status { display: none; margin: 2px 3px 0; color: #6e8b62; font-size: 10px; font-weight: 700; }
        .status.visible { display: block; }
      </style>
      <div class="panel" role="dialog" aria-label="Save to Study Session OS">
        <div class="actions">
          <button class="primary" data-action="highlight">Save highlight</button>
          <button data-action="note">Add note</button>
          <button class="close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="composer">
          <textarea maxlength="4000" placeholder="What matters about this?"></textarea>
          <div class="composer-footer"><button class="primary" data-action="save-note">Save note</button></div>
        </div>
        <div class="status" role="status"></div>
      </div>
    `;
    document.documentElement.append(toolbarHost);

    toolbarRoot.querySelector('[data-action="highlight"]').addEventListener('click', () => saveSelection('highlight'));
    toolbarRoot.querySelector('[data-action="note"]').addEventListener('click', () => {
      toolbarRoot.querySelector('.composer').classList.add('open');
      toolbarRoot.querySelector('textarea').focus();
    });
    toolbarRoot.querySelector('[data-action="save-note"]').addEventListener('click', () => saveSelection('note'));
    toolbarRoot.querySelector('[data-action="close"]').addEventListener('click', hideToolbar);
    toolbarRoot.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  function currentSelectionRange() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const text = selection.toString().trim();
    if (text.length < 2) return null;
    return selection.getRangeAt(0).cloneRange();
  }

  function positionToolbar(range, centered = false) {
    createToolbar();
    const rect = range?.getBoundingClientRect();
    const width = 286;
    const left = centered
      ? Math.max(12, window.innerWidth - width - 20)
      : Math.max(12, Math.min(window.innerWidth - width - 12, (rect?.left || 20) + (rect?.width || 0) / 2 - width / 2));
    const preferredTop = centered ? 20 : (rect?.bottom || 20) + 10;
    const top = Math.max(12, Math.min(window.innerHeight - 190, preferredTop));
    toolbarHost.style.left = `${left}px`;
    toolbarHost.style.top = `${top}px`;
    toolbarHost.style.display = 'block';
    toolbarRoot.querySelector('.composer').classList.toggle('open', centered);
    toolbarRoot.querySelector('.status').classList.remove('visible');
    toolbarRoot.querySelector('textarea').value = '';
    if (centered) toolbarRoot.querySelector('textarea').focus();
  }

  function hideToolbar() {
    if (toolbarHost) toolbarHost.style.display = 'none';
    selectedRange = null;
  }

  function decorateRange(range) {
    if (!range || range.collapsed) return;
    try {
      const mark = document.createElement('mark');
      mark.dataset.studyxHighlight = 'true';
      mark.style.cssText = 'background:#f7df75;color:inherit;border-radius:2px;padding:0 1px;';
      range.surroundContents(mark);
    } catch {
      // Complex selections spanning multiple elements are still saved, but not visually wrapped.
    }
  }

  function youtubeTimestamp() {
    if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return null;
    const video = document.querySelector('video');
    return video && Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : null;
  }

  async function saveSelection(kind) {
    const quote = selectedRange?.toString().trim() || '';
    const note = toolbarRoot.querySelector('textarea').value.trim();
    if (kind === 'note' && !note) {
      toolbarRoot.querySelector('textarea').focus();
      return;
    }
    if (!quote && !note) return;

    const status = toolbarRoot.querySelector('.status');
    status.textContent = 'Saving…';
    status.classList.add('visible');
    try {
      await send('studyx.saveCapture', {
        capture: {
          kind,
          quote,
          note,
          url: location.href,
          title: document.title,
          timestampSeconds: youtubeTimestamp(),
        },
      });
      if (kind === 'highlight') decorateRange(selectedRange);
      status.textContent = kind === 'highlight' ? 'Saved to this study session.' : 'Note saved to this session.';
      window.setTimeout(hideToolbar, 900);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function showSelectionToolbar(saveImmediately = false) {
    if (!currentSession) return;
    selectedRange = currentSelectionRange();
    if (!selectedRange) return;
    positionToolbar(selectedRange);
    if (saveImmediately) saveSelection('highlight');
  }

  function openNoteComposer() {
    if (!currentSession) return;
    selectedRange = currentSelectionRange();
    positionToolbar(selectedRange, true);
  }

  async function pullBridgeEvents() {
    if (!isScholarOsPage()) return;
    try {
      const events = await send('studyx.bridgePull');
      postToScholarOs({ type: 'STUDYX_EVENTS', events });
    } catch {
      // The configured ScholarOS page is the only page allowed to pull the outbox.
    }
  }

  function announceBridge() {
    postToScholarOs({ type: 'STUDYX_BRIDGE_AVAILABLE' });
  }

  async function handleScholarCommand(message) {
    const commandId = String(message.commandId || '').slice(0, 100);
    if (!commandId) return;
    try {
      let data;
      switch (message.command) {
        case 'getState':
          data = await send('studyx.getScholarState');
          break;
        case 'startSession':
          data = await send('studyx.startSession', { session: message.payload?.session || {} });
          break;
        case 'stopSession':
          data = await send('studyx.stopSession');
          break;
        case 'openOptions':
          await chrome.runtime.openOptionsPage();
          data = { opened: true };
          break;
        default:
          throw new Error('Unsupported ScholarOS command.');
      }
      postToScholarOs({ type: 'STUDYX_COMMAND_RESULT', commandId, ok: true, data });
      await refreshState();
    } catch (error) {
      postToScholarOs({
        type: 'STUDYX_COMMAND_RESULT',
        commandId,
        ok: false,
        error: error?.message || String(error),
      });
    }
  }

  async function handleScholarAlexaRequest(message) {
    const requestId = String(message.requestId || '').slice(0, 100);
    if (!requestId) return;
    try {
      const data = message.operation === 'status'
        ? await send('studyx.alexaStatus')
        : await send('studyx.alexaCommand', { command: message.command || {} });
      postToScholarOs({ type: 'STUDYX_ALEXA_RESULT', requestId, ok: true, data });
    } catch (error) {
      postToScholarOs({
        type: 'STUDYX_ALEXA_RESULT',
        requestId,
        ok: false,
        error: error?.message || String(error),
      });
    }
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !isScholarOsPage() || event.data?.source !== 'scholar-os') return;
    if (event.data.type === 'SCHOLAROS_READY' && event.data.context) {
      try {
        await send('studyx.saveScholarContext', { context: event.data.context });
      } catch {
        // Pulling below will also fail if this page is no longer authorized.
      }
    }
    if (event.data.type === 'SCHOLAROS_READY' || event.data.type === 'SCHOLAROS_PULL') {
      await pullBridgeEvents();
    }
    if (event.data.type === 'SCHOLAROS_ACK') {
      const eventIds = Array.isArray(event.data.eventIds) ? event.data.eventIds : [];
      try {
        await send('studyx.bridgeAck', { eventIds });
        await refreshState();
      } catch {
        // Leave events pending so the next sync can retry safely.
      }
    }
    if (event.data.type === 'SCHOLAROS_CONTEXT') {
      try {
        await send('studyx.saveScholarContext', { context: event.data.context || {} });
      } catch {
        // Only the exact dashboard URL configured in settings may update context.
      }
    }
    if (event.data.type === 'SCHOLAROS_COMMAND') await handleScholarCommand(event.data);
    if (event.data.type === 'SCHOLAROS_ALEXA_REQUEST') await handleScholarAlexaRequest(event.data);
  });

  document.addEventListener('mouseup', (event) => {
    if (toolbarHost?.contains(event.target)) return;
    window.setTimeout(() => showSelectionToolbar(false), 0);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideToolbar();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'studyx.stateChanged') {
      refreshState().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === 'studyx.captureSelection') {
      showSelectionToolbar(true);
      sendResponse({ ok: true });
    }
    if (message?.type === 'studyx.openNoteComposer') {
      openNoteComposer();
      sendResponse({ ok: true });
    }
    return false;
  });

  keepYouTubeShieldMounted();
  refreshState();
})();
