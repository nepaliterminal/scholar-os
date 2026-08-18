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
- Control Alexa devices, media, volume, study announcements, and saved routines through a private localhost bridge.
- Use Scholar Mode to rank the next task, explain the choice, choose a focus length, and start extension protection from one button.
- Ask Alexa for the next task, a backpack/deadline morning check, a focus announcement, or a progressively more specific “unstuck” hint.
- Save browser-dictated study notes and flashcards locally, turn extension captures into card drafts, and have Alexa speak quiz prompts.
- Approve a reasoned website-access request for five minutes—or deny it—from ScholarOS; blocking returns automatically.
- Pair the local LockIn service so a ScholarOS session applies the same domain shield system-wide, with ownership-safe stop and temporary-access actions.
- View LockIn readiness, active system blocks, and private seven-day focus totals from the ScholarOS Study Sessions hub.
- Let Poke read a sanitized ScholarOS/dashboard snapshot and queue explicit Study Session OS start, stop, and access-request decisions.

The integration is local-first. The extension keeps a durable event outbox in `chrome.storage.local`; ScholarOS saves an event before acknowledging it, so closing either interface does not lose study activity.

Alexa is opt-in per action. Amazon credentials never enter this repository, the extension, or the website. Echo/routine names, opaque device IDs, custom spoken text, and Alexa action history are kept only in the open ScholarOS tab and are not added to dashboard storage or analytics.

The current Alexa bridge is intentionally outbound-only: Alexa can speak a quiz, plan, or hint, while dictation and spoken quiz answers use Chrome's microphone and stay local. Receiving open-ended speech directly from an Echo would require deploying and linking a separate public Alexa custom skill; ScholarOS does not quietly poll Alexa voice history.

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

## Connect Alexa privately

The companion bridge lives in `/Users/subed/alexainit` on this Mac.

1. Run `npm run bridge` in that folder and keep it open.
2. In a second terminal in the same folder, run `npm run bridge:pair`; the token is copied to the clipboard without being printed.
3. Paste the token directly into **Study Session OS → Extension settings → Alexa** and select **Test Alexa connection**. Never paste the token into chat or source code.
4. Reload ScholarOS and open **Alexa Controls**.
5. After the first successful test, run `npm run bridge:install` so the private bridge returns after login without an open terminal.

The Amazon session and bridge token remain in gitignored, owner-only local files. Environment overrides are available, but secrets are not bundled into the website. See `/Users/subed/alexainit/README.md` for the complete boundary.

## Connect LockIn privately

The local enforcement service lives in `/Users/subed/lockinmcp` on this Mac.

1. Build and start LockIn with `npm run build` and `npm start` in that folder.
2. In a second terminal there, run `npm run pair:extension`. The bridge-scoped token is copied directly to the clipboard and is not printed; it cannot invoke LockIn's MCP tools.
3. Paste it into **Study Session OS → Extension settings → LockIn**, then select **Test LockIn connection**. Use `http://127.0.0.1:3847` when Chrome permits loopback access, or the active LockIn HTTPS tunnel base URL without `/mcp`. Never paste the token into chat or source code.
4. Reload ScholarOS. The LockIn card will show system blocking readiness and seven-day totals.

Once paired, starting or ending focus in either the ScholarOS dashboard or extension also starts or ends the exact LockIn session created for it. A five-minute access approval temporarily relaxes both browser and system blocking. The extension stores the session ownership privately so it cannot end an unrelated LockIn session.

The paired extension synchronizes with LockIn every 30 seconds. The Study Sessions LockIn card shows whether the Poke companion snapshot is fresh and whether the optional identity/history fields are shared. Poke can read classes, assignments, stars, pending access requests, and an authoritative context for today's School, Summer, or Party page; profile identity, completed-session history, and free-form day notes remain private by default. The day context names routines that must be ignored, so a Summer Day cannot use bus times or school routines as blocking reasons. Checklist items are optional by default; turning on **Before screen time** for an item lets ScholarOS gate TikTok until that active-mode item is complete. Poke commands are allowlisted, device-bound, and acknowledged after execution; it cannot read arbitrary tabs, browsing history, page text, or pairing tokens.

## Inspect the iPhone and iPad Screen Time companion

The native Xcode project is in [`ios/ScholarOSMobile.xcodeproj`](ios/ScholarOSMobile.xcodeproj). It includes Family Controls onboarding, private TikTok/app selection, daily usage monitoring, School/Summer/Party checklist gates, and a custom LockIn shield through three Screen Time extensions.

```bash
open ios/ScholarOSMobile.xcodeproj
```

See [`ios/README.md`](ios/README.md) for signing, App Group, physical-device, and future Poke transport details. Real Screen Time enforcement must be tested on a signed physical iPhone or iPad; the simulator does not provide actual usage data.

## Validate

The dashboard and extension checks require Node.js:

```bash
npm run check
```

On a Mac with Xcode's command-line tools, run the native policy tests too:

```bash
npm run check:ios
```

The detailed extension behavior and bridge contract are in [`extension/README.md`](extension/README.md) and [`extension/docs/scholaros-bridge.md`](extension/docs/scholaros-bridge.md).
