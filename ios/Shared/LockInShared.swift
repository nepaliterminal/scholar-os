import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

enum LockInShared {
    static let appGroup = "group.com.subed.scholaros"
    static let selectionKey = "screen-time.selection"
    static let policyKey = "screen-time.policy"
    static let dayContextKey = "scholaros.day-context"
    static let shieldSnapshotKey = "screen-time.shield-snapshot"
    static let dailyShieldStateKey = "screen-time.shield.daily-limit"
    static let scholarShieldStateKey = "screen-time.shield.scholar-gate"
}

extension DeviceActivityName {
    static let scholarOSDaily = Self("scholaros.daily-usage")
}

extension DeviceActivityEvent.Name {
    static let selectedAppsLimit = Self("scholaros.selected-apps-limit")
}

extension ManagedSettingsStore.Name {
    static let dailyLimit = Self("scholaros.daily-limit")
    static let scholarGate = Self("scholaros.scholar-gate")
}

enum SharedStore {
    private static var defaults: UserDefaults {
        UserDefaults(suiteName: LockInShared.appGroup) ?? .standard
    }

    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func save<T: Encodable>(_ value: T, key: String) throws {
        let data = try JSONEncoder().encode(value)
        defaults.set(data, forKey: key)
    }

    private static func remove(key: String) {
        defaults.removeObject(forKey: key)
    }

    static var selection: FamilyActivitySelection {
        get { load(FamilyActivitySelection.self, key: LockInShared.selectionKey) ?? .init() }
        set { try? save(newValue, key: LockInShared.selectionKey) }
    }

    static var policy: ScreenTimePolicy {
        get { load(ScreenTimePolicy.self, key: LockInShared.policyKey) ?? .standard }
        set { try? save(newValue, key: LockInShared.policyKey) }
    }

    static var dayContext: ScholarDayContext {
        get { load(ScholarDayContext.self, key: LockInShared.dayContextKey) ?? .today(mode: .summer) }
        set { try? save(newValue, key: LockInShared.dayContextKey) }
    }

    static var shieldSnapshot: ShieldSnapshot {
        get {
            let daily = load(ShieldReasonState.self, key: LockInShared.dailyShieldStateKey)
            let scholar = load(ShieldReasonState.self, key: LockInShared.scholarShieldStateKey)
            let legacy = load(ShieldSnapshot.self, key: LockInShared.shieldSnapshotKey)
            return .resolving(daily: daily, scholar: scholar, legacy: legacy)
        }
        set {
            setShieldState(.dailyLimit, detail: newValue.dailyLimitDetail, updatedAt: newValue.updatedAt)
            setShieldState(.scholarGate, detail: newValue.scholarGateDetail, updatedAt: newValue.updatedAt)
            remove(key: LockInShared.shieldSnapshotKey)
        }
    }

    static func setShield(_ reason: ShieldReason, detail: String?) {
        setShieldState(reason, detail: detail, updatedAt: .now)
        removeLegacyShieldSnapshotWhenFullyMigrated()
    }

    private static func setShieldState(_ reason: ShieldReason, detail: String?, updatedAt: Date) {
        let key = switch reason {
        case .dailyLimit: LockInShared.dailyShieldStateKey
        case .scholarGate: LockInShared.scholarShieldStateKey
        }

        try? save(ShieldReasonState(detail: detail, updatedAt: updatedAt), key: key)
    }

    private static func removeLegacyShieldSnapshotWhenFullyMigrated() {
        guard load(ShieldReasonState.self, key: LockInShared.dailyShieldStateKey) != nil,
              load(ShieldReasonState.self, key: LockInShared.scholarShieldStateKey) != nil else {
            return
        }
        remove(key: LockInShared.shieldSnapshotKey)
    }
}

enum ShieldController {
    static func apply(selection: FamilyActivitySelection, to store: ManagedSettingsStore) {
        store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
        store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
        store.shield.applicationCategories = selection.categoryTokens.isEmpty
            ? nil
            : .specific(selection.categoryTokens)
        store.shield.webDomainCategories = selection.categoryTokens.isEmpty
            ? nil
            : .specific(selection.categoryTokens)
    }
}
