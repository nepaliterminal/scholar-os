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

ScholarOS can send a `SCHOLAROS_COMMAND` with a unique `commandId`. Version 1 supports `getState`, `startSession`, `stopSession`, and `openOptions`. The extension answers with `STUDYX_COMMAND_RESULT` using the same ID. Commands are accepted only from the exact configured dashboard URL.

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

ScholarOS should decide whether to accept `suggestedStars`; the extension never directly changes the ScholarOS balance.
