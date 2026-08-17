# ScholarOS

ScholarOS is a local-first student dashboard with a connected Chrome extension for protected focus sessions, study capture, and reflection.

## What is connected

- Start or end a Study Session OS focus timer from the ScholarOS home screen.
- Use ScholarOS classes as subject suggestions in both the dashboard and extension.
- Keep the active timer synchronized across the dashboard and extension popup.
- Sync completed sessions, focused minutes, highlights, notes, and access requests into the correct ScholarOS account.
- Show seven-day focus analytics, completion rate, focus streak, average session time, blocked distractions, and subject trends.
- Award the extension's suggested study stars once per completed session, even after reloads or event retries.
- Include today's focus minutes in the ScholarOS daily report.

The integration is local-first. The extension keeps a durable event outbox in `chrome.storage.local`; ScholarOS saves an event before acknowledging it, so closing either interface does not lose study activity.

## Run ScholarOS locally

Open `index.html` in Chrome and select or create a ScholarOS account.

## Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Disable an older unpacked copy if Chrome is loading it from another folder; do not run both copies at once.
4. Click **Load unpacked** and choose this repository's `extension` folder. Switching folders creates a separate local extension store, so keep the old copy disabled until you are sure you no longer need its session history.
5. Open [ScholarOS on GitHub Pages](https://nepaliterminal.github.io/scholar-os/) and reload it. Its Study Session card should say **Extension connected**.

The extension is initially configured for:

```text
https://nepaliterminal.github.io/scholar-os/
```

For local development, enable **Allow access to file URLs**, copy the exact local `index.html` URL into **Extension settings → ScholarOS dashboard URL**, save, and reload the file. Only the configured dashboard can read or acknowledge extension events.

## Validate

Node.js is the only requirement:

```bash
npm run check
```

The detailed extension behavior and bridge contract are in [`extension/README.md`](extension/README.md) and [`extension/docs/scholaros-bridge.md`](extension/docs/scholaros-bridge.md).
