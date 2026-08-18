# ScholarOS bridge contract

The extension maintains a durable outbox in `chrome.storage.local`. This prevents session completions or captures from disappearing when the ScholarOS dashboard is closed.

## Authorization

Only the configured dashboard URL may retrieve or acknowledge events. The default is the hosted dashboard:

```text
https://nepaliterminal.github.io/scholar-os/
```

For `file://` usage, Chrome must be configured to allow this extension access to file URLs.

## Page handshake

ScholarOS announces that it is ready:

```js
window.postMessage({
  source: 'scholar-os',
  type: 'SCHOLAROS_READY',
  context: {
    account: 'Alex',
    classes: ['Math', 'Science'],
    stars: 42
  }
}, '*');
```

The authorized dashboard context is stored locally so the extension can suggest current ScholarOS classes. New sessions are tagged with the active account. Events for a different account remain unacknowledged until that profile is open.

The extension replies on the page with:

```js
{
  source: 'studyx-extension',
  type: 'STUDYX_EVENTS',
  version: 1,
  events: []
}
```

After committing events to ScholarOS, the page acknowledges their unique IDs:

```js
window.postMessage({
  source: 'scholar-os',
  type: 'SCHOLAROS_ACK',
  eventIds: ['evt_...']
}, '*');
```

Acknowledgment happens only after ScholarOS saves the change. Replayed event IDs must be treated idempotently so sessions cannot award stars twice.

## Live state and commands

The extension posts `STUDYX_BRIDGE_AVAILABLE` when it detects the configured dashboard and posts `STUDYX_STATE` whenever session state changes. State includes the current session, pending recap, and pending event count.

ScholarOS can send a `SCHOLAROS_COMMAND` with a unique `commandId`. Version 1 supports `getState`, `startSession`, `stopSession`, `resolveUnblock`, and `openOptions`. `resolveUnblock` accepts a request ID, an `approve`/`deny` decision, and a clamped 1–30 minute duration. Approval is valid only for the active session and ScholarOS account. The extension answers with `STUDYX_COMMAND_RESULT` using the same ID. Commands are accepted only from the exact configured dashboard URL.

The `getState` result sent to ScholarOS is explicitly reduced to the active session, pending recap, and pending-event count. Extension settings—especially the Alexa and LockIn pairing tokens—are never included.

## Alexa relay

ScholarOS can send `SCHOLAROS_ALEXA_REQUEST` with a unique `requestId` and either a `status` operation or an allowlisted command. The extension answers with `STUDYX_ALEXA_RESULT`. It authenticates to the bridge itself, so neither the request nor the reply contains the pairing token.

The Alexa bridge must use a loopback HTTP URL and a bearer pairing token stored in the extension's private storage. The website never connects to localhost directly. Device and routine identifiers exposed by the bridge are opaque hashes; names and command text remain memory-only in the open ScholarOS tab. Alexa requests are never added to the durable ScholarOS event outbox.

## LockIn relay

ScholarOS sends `SCHOLAROS_LOCKIN_REQUEST` with a unique `requestId` for sanitized status and seven-day analytics. The extension answers with `STUDYX_LOCKIN_RESULT`. The website never connects to LockIn directly and never receives the LockIn bearer token, raw domain lists, filesystem paths, or top-requested-domain details. The extension may connect over loopback or an authenticated HTTPS tunnel when Chrome restricts loopback access.

Starting a normal ScholarOS focus session causes the extension to request an `enter_focus_mode` action from LockIn. The returned LockIn session ID stays in private extension storage. Stop and temporary-access actions must present that same ID, which keeps them scoped to the session the extension owns. If the LockIn call fails, browser focus continues and the website status card reports the disconnected system layer.

The extension also posts a sanitized companion snapshot to `/bridge/v1/companion/sync` every 30 seconds and receives pending Poke commands. Supported commands are `start_session`, `stop_session`, `resolve_access_request`, `set_tiktok_policy`, and `block_tiktok`. Each command ID is stored after processing and acknowledged through `/bridge/v1/companion/ack`, so a lost acknowledgement does not repeat the browser mutation. The snapshot includes aggregate TikTok foreground and scrolling seconds plus the active ScholarOS day mode, current-mode checklist, ignored contexts, and deterministic before-screen-time gate. Tokens, TikTok content, arbitrary tab data, browsing history, and captured page text are excluded.

The ScholarOS gate is valid only when its date matches the device's current local date. It is derived solely from incomplete current-mode checklist items explicitly marked `beforeScreenTime`; Poke cannot add its own reasons. A mode change creates a new context ID and invalidates the previous gate. Manual and daily-limit TikTok blocks are evaluated separately.

## Event envelope

```json
{
  "id": "evt_unique_id",
  "version": 1,
  "type": "session.completed",
  "occurredAt": "2026-08-17T16:00:00.000Z",
  "payload": {},
  "deliveredAt": null
}
```

## Version 1 events

- `session.started` — subject, intention, brain dump, duration, start time, and ScholarOS account.
- `session.completed` — planned/focused time, capture counts, blocked attempts, completion state, and suggested stars.
- `session.reflected` — done/mostly/not-yet rating and one-sentence reflection.
- `capture.created` — explicit highlight or note with source URL and optional YouTube timestamp.
- `unblock.requested` — blocked domain, reason, subject, and session ID.
- `unblock.resolved` — approved/denied state and the temporary allowance expiry, if approved.

ScholarOS should decide whether to accept `suggestedStars`; the extension never directly changes the ScholarOS balance.
