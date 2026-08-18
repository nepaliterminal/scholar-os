# Study Session OS — Chrome Extension

A dependency-free Manifest V3 extension that combines focus sessions, distraction blocking, highlights, notes, YouTube cleanup, reflection, and the ScholarOS dashboard.

## What works

- Start a persistent 5–180 minute session with a subject, intention, and optional brain dump.
- Redirect configured distraction sites only while a session is active.
- Blur or hide YouTube thumbnails and optionally remove Shorts, the home feed, and “Up next.” Thumbnail blur leaves the video grid visible by default.
- Select text on a page to save a highlight or attach a note.
- Save page notes even when no text is selected.
- Include the current playback time with captures made on YouTube.
- Track highlights, notes, and blocked navigation attempts in the live popup.
- Create an honest recap with focused time, completion rating, reflection, and suggested ScholarOS stars.
- Require a reason for school-related access, then approve a five-minute exception or deny it from ScholarOS.
- Restore blocking automatically when an approved exception expires or the focus session ends.
- Start and stop sessions directly from ScholarOS.
- Use ScholarOS classes as subject suggestions in the extension.
- Sync completed sessions, captures, access requests, and earned study stars into the active ScholarOS account.
- Queue versioned, idempotent events while ScholarOS is closed, then acknowledge them after the dashboard saves them.
- Relay explicit Alexa commands from the authorized ScholarOS page to the authenticated localhost bridge.
- Start and end an ownership-bound LockIn session so the configured domain list is enforced system-wide.
- Mirror approved temporary site access into that same LockIn session and expose sanitized seven-day totals to ScholarOS.
- Start Scholar Mode's ranked task and focus duration through the authenticated ScholarOS command bridge.
- Export all local extension data as JSON.

PDF-specific capture, AI-generated flashcards, and daily cross-browser screen-time budgets remain deferred. ScholarOS now provides local manual/voice flashcards and per-session access decisions without a cloud AI service.

## Install for local development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `extension` directory.
5. Pin **Study Session OS** to the toolbar.
6. Reload any already-open webpages so the capture toolbar can be injected.

The extension connects to the hosted ScholarOS dashboard by default:

```text
https://nepaliterminal.github.io/scholar-os/
```

For local dashboard development, enable **Allow access to file URLs** on the extension’s **Details** page and set the exact local `index.html` URL in the extension settings.

The bridge will not mark events delivered until the ScholarOS page explicitly acknowledges their IDs.

## Use it

1. Open the popup and choose a subject, intention, duration, and optional brain dump.
2. Start the session. The badge shows `ON`, blocking rules activate, and YouTube cleanup begins.
3. Select text on any normal webpage. Use the floating toolbar to save a highlight or note. You can also use `Command+Shift+H` on macOS or the selection context menu.
4. Open the popup to capture a page note or view live counters.
5. Let the timer finish or end early, then complete the recap.

Configure blocked domains, YouTube behavior, the ScholarOS URL, and the private Alexa and LockIn bridges from the settings page.

Do not add `youtube.com` to **Blocked websites** if you want to use the thumbnail shield. A blocked domain is redirected completely during a session; the separate YouTube settings control blur/hide behavior while keeping the site available.

## Privacy and permissions

Study data stays in `chrome.storage.local` and the selected ScholarOS profile's local browser storage unless the user exports it or explicitly presses an Alexa or Daily Report action.

- `storage`: persistent session, capture, settings, and outbox data.
- `alarms`: restoreable session-end scheduling.
- `declarativeNetRequest`: privacy-preserving website redirects without reading request contents.
- `contextMenus`: save selected text from the right-click menu.
- `tabs` and website access: send capture and session-state messages to normal webpages.

The extension records only explicit captures, session metadata, configured blocked domains, and the count/domain of blocked attempts. It does not store general browsing history.

Temporary site allowances are scoped to the active focus session, expire after at most 30 minutes (the ScholarOS UI grants five), and are cleared when the session ends. The extension stores the reason and decision with the local request history so the gate remains understandable.

The Alexa pairing token is stored only in the extension's private `chrome.storage.local` area so it can authenticate after restart. ScholarOS never receives it, exports redact it, and Alexa commands are accepted only from the exact configured dashboard. Amazon credentials remain solely in the separate local `alexainit` process. Device/routine names and spoken text are not added to extension exports or ScholarOS storage.

The LockIn bearer token uses the same private-storage and export-redaction boundary. LockIn accepts the bridge only on loopback, with bearer authentication, from a Chrome-extension origin. The extension records the returned LockIn session ID privately and supplies it for stop and temporary-access calls, so it cannot mutate a separately started LockIn session. If LockIn is offline, browser focus still starts and the dashboard reports that the system shield is disconnected.

## Validate

No installation step is needed. With Node.js available:

```bash
npm run check
```

## Project boundaries

- The extension owns active focus sessions and in-browser capture.
- ScholarOS remains the planner and final authority for classes, assignments, and stars.
- Alexa commands travel through the authenticated `alexainit` localhost bridge only after an explicit click in ScholarOS.
- Amazon credentials remain only in the separate `alexainit` process; they never enter this extension.
- LockIn commands travel through the authenticated `lockinmcp` localhost bridge; its token never enters ScholarOS.

The bridge event contract is documented in [`docs/scholaros-bridge.md`](docs/scholaros-bridge.md).
