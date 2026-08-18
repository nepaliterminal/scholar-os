import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const project = await read('ios/ScholarOSMobile.xcodeproj/project.pbxproj');
const requiredTargets = [
  'ScholarOSMobile',
  'ScholarOSDeviceActivityMonitor',
  'ScholarOSShieldConfiguration',
  'ScholarOSShieldAction',
];

for (const target of requiredTargets) {
  assert.ok(project.includes(`PBXNativeTarget "${target}"`), `missing native target ${target}`);
}

assert.equal(
  [...project.matchAll(/TARGETED_DEVICE_FAMILY = "1,2";/g)].length,
  8,
  'every Debug and Release configuration must target iPhone and iPad',
);

const sourcesSection = project.match(
  /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//,
)?.[1];
assert.ok(sourcesSection, 'missing PBXSourcesBuildPhase section');
assert.equal(
  [...sourcesSection.matchAll(/ScholarPolicy\.swift in Sources/g)].length,
  4,
  'ScholarPolicy.swift must compile in the app and all three extensions',
);

const resourcesSection = project.match(
  /\/\* Begin PBXResourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXResourcesBuildPhase section \*\//,
)?.[1];
assert.ok(resourcesSection, 'missing PBXResourcesBuildPhase section');
assert.equal(
  [...resourcesSection.matchAll(/PrivacyInfo\.xcprivacy in Resources/g)].length,
  4,
  'the app and each extension must bundle the privacy manifest',
);

const entitlementFiles = [
  'ios/Config/App.entitlements',
  'ios/Config/Monitor.entitlements',
  'ios/Config/ShieldConfiguration.entitlements',
  'ios/Config/ShieldAction.entitlements',
];
for (const file of entitlementFiles) {
  const plist = await read(file);
  assert.match(plist, /<key>com\.apple\.developer\.family-controls<\/key>\s*<true\/>/, `${file} needs Family Controls`);
  assert.match(plist, /<string>group\.com\.subed\.scholaros<\/string>/, `${file} needs the shared App Group`);
}

const extensionPoints = new Map([
  ['ios/DeviceActivityMonitor/Info.plist', 'com.apple.deviceactivity.monitor-extension'],
  ['ios/ShieldConfiguration/Info.plist', 'com.apple.ManagedSettingsUI.shield-configuration-service'],
  ['ios/ShieldAction/Info.plist', 'com.apple.ManagedSettings.shield-action-service'],
]);
for (const [file, extensionPoint] of extensionPoints) {
  const plist = await read(file);
  assert.ok(plist.includes(`<string>${extensionPoint}</string>`), `${file} has the wrong extension point`);
}

const appPlist = await read('ios/ScholarOSMobile/Info.plist');
for (const orientation of [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
]) {
  assert.ok(appPlist.includes(`<string>${orientation}</string>`), `missing iPad orientation ${orientation}`);
}

const policy = await read('ios/PolicyCore/ScholarPolicy.swift');
assert.ok(policy.includes('static let allowedMinutes = 1...1_439'), 'daily limit must fit inside the recurring schedule');
assert.ok(policy.includes('func rolledForwardIfNeeded('), 'day context must support local-date rollover');
assert.ok(policy.includes('func validate(now: Date = .now) throws'), 'remote policy commands need semantic validation');

const shared = await read('ios/Shared/LockInShared.swift');
assert.ok(shared.includes('dailyShieldStateKey'), 'daily-limit shield needs independently owned state');
assert.ok(shared.includes('scholarShieldStateKey'), 'ScholarOS gate needs independently owned state');

const privacyManifest = await read('ios/Shared/PrivacyInfo.xcprivacy');
assert.ok(privacyManifest.includes('NSPrivacyAccessedAPICategoryUserDefaults'), 'privacy manifest must declare UserDefaults');
assert.ok(privacyManifest.includes('<string>1C8F.1</string>'), 'App Group UserDefaults requires reason 1C8F.1');
assert.match(privacyManifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/, 'native app must declare no tracking');

const nativeSources = await Promise.all([
  policy,
  shared,
  read('ios/ScholarOSMobile/ScreenTimeController.swift'),
  read('ios/ScholarOSMobile/ContentView.swift'),
]);
assert.doesNotMatch(
  nativeSources.join('\n'),
  /(?:Bearer|pairingToken|deviceToken)\s*[:=]\s*["'][^"']+["']/i,
  'native source must not embed relay or pairing credentials',
);

console.log('Validated ScholarOS iOS: four targets, iPhone/iPad settings, entitlements, extensions, and policy safeguards.');
