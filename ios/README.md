# LockIn iPhone and iPad companion

This Xcode project is the native Screen Time enforcement layer for LockIn and ScholarOS.

It currently includes:

- individual Family Controls authorization;
- Apple’s privacy-preserving app picker for TikTok or other distracting apps;
- a repeating Device Activity monitor with a configurable daily allowance;
- independent Managed Settings stores for the daily limit and ScholarOS checklist gate;
- school, summer, and party day context with per-item **Required before screen time** controls;
- a custom LockIn shield instead of the default blocked screen;
- shared App Group state for the app and all three Screen Time extensions;
- a durable monitoring switch, so turning protection off stays off across launches;
- an Apple privacy manifest in every executable bundle for App Group preferences.

## Open it

```bash
open ios/ScholarOSMobile.xcodeproj
```

In Xcode, select the `ScholarOSMobile` target, open **Signing & Capabilities**, choose your team, and ensure both **Family Controls** and **App Groups** are present for the app and each extension. The expected App Group is:

```text
group.com.subed.scholaros
```

Change the bundle IDs and App Group if `com.subed` is not available in your Apple account. Make the same App Group change in every entitlement file and `Shared/LockInShared.swift`.

## Put the development build on an iPad

1. In **Xcode → Settings → Accounts**, add the Apple Account that owns your development team.
2. Connect the iPad to the Mac, unlock it, accept **Trust This Computer**, and enable **Settings → Privacy & Security → Developer Mode** if iPadOS asks for it.
3. Open `ScholarOSMobile.xcodeproj`. Select the blue project, then the `ScholarOSMobile` target. Under **Signing & Capabilities**, enable **Automatically manage signing** and select your team.
4. Repeat the team selection for `ScholarOSDeviceActivityMonitor`, `ScholarOSShieldConfiguration`, and `ScholarOSShieldAction`. All four targets need Family Controls and the same App Group.
5. If the existing IDs are unavailable, choose one unique base ID and keep each extension below it, for example `com.yourname.scholaros`, `.monitor`, `.shieldconfiguration`, and `.shieldaction`. Register and use one matching App Group in all four entitlement files and `LockInShared.appGroup`.
6. In Xcode's top toolbar, choose the `ScholarOSMobile` scheme and the connected iPad—not a simulator—then press **Run** (`⌘R`). Automatic signing registers the device and creates development provisioning profiles.
7. On the iPad, open LockIn, approve Screen Time access, select TikTok in Apple's picker, choose today's ScholarOS mode, and tap **Save and activate**.

The main app embeds all three extensions, so you install only the `ScholarOSMobile` scheme. You do not run the extensions separately.

If Xcode says the Family Controls or App Groups capability is unavailable to the selected team, that is a provisioning/account limitation rather than a source error. Apple permits ordinary device testing with a personal Apple Account, but this project needs those additional capabilities. Use an Apple Developer Program team that can create the required development profiles. App Store or TestFlight distribution also requires Apple to approve the Family Controls distribution entitlement for the app and each Screen Time extension.

If the app opens but blocking does not happen, check these in order:

1. The run destination is the physical iPad; Simulator can only preview the shield.
2. Screen Time authorization says **Approved** inside LockIn.
3. TikTok appears as at least one private selection and **Save and activate** succeeded.
4. The app and all extensions have the identical App Group entitlement in their signed profiles.
5. **Optional Poke sync** may remain unconfigured; it does not disable local Screen Time enforcement.

## Apple account requirement

The sources and simulator build can be inspected without paying. Running the complete Screen Time flow on an iPhone or iPad requires code signing and the Family Controls capability. Distribution normally requires an Apple Developer Program membership and Apple’s Family Controls distribution entitlement approval.

The iOS simulator does not provide real Screen Time usage and cannot enforce a Family Controls shield against another app. In Simulator, LockIn shows an explicit warning and a **Preview blocked screen** button for visual review. Authorize, select TikTok, and test real threshold enforcement on a physical iPhone or iPad.

The **Optional Poke sync** card is unrelated to local enforcement. A physical iPhone or iPad can enforce its saved Screen Time policy without the cloud adapter; the adapter is only for future remote policy changes from Poke.

## Poke boundary

The local enforcement engine is implemented. The UI intentionally labels cloud transport as unconfigured. Poke should send a small signed policy/day-context command to LockIn’s backend; the Apple-device companion should fetch and verify it. Raw Screen Time history and Apple’s opaque app-selection tokens should remain on the device.

Recommended remote payload:

```json
{
  "commandId": "unique-id",
  "issuedAt": "2026-08-18T12:00:00Z",
  "expiresAt": "2026-08-18T12:05:00Z",
  "dayMode": "summer",
  "dailyLimitMinutes": 30,
  "scholarGate": {
    "shouldBlock": true,
    "incompleteTaskIds": ["task-id"]
  }
}
```

Do not place an MCP bearer token directly in the app bundle. Use short-lived device credentials stored in the Keychain when the cloud adapter is added.

The pure policy core already validates a 15-minute maximum command window, bounded identifiers, coherent gate state, and a durable pre-mutation replay receipt. A future adapter must additionally authenticate the signed envelope, verify that its target device ID matches this installation, reserve the command ID before applying it, and persist the final result. These policy checks do not authenticate a network response by themselves.

## Native validation

From the ScholarOS repository root:

```bash
npm run check:ios
```

This validates all targets, entitlements, iPhone/iPad settings, extension point identifiers, privacy-manifest coverage, remote-command safeguards, and the pure Swift policy tests. A full unsigned device build can be checked with:

```bash
xcodebuild \
  -project ios/ScholarOSMobile.xcodeproj \
  -scheme ScholarOSMobile \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```
