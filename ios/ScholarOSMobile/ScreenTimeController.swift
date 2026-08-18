import Combine
import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

@MainActor
final class ScreenTimeController: ObservableObject {
    @Published var authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    @Published var selection = SharedStore.selection
    @Published var dayContext = SharedStore.dayContext.rolledForwardIfNeeded()
    @Published var dailyLimitMinutes = ScreenTimePolicy(
        dailyLimitMinutes: SharedStore.policy.dailyLimitMinutes
    ).dailyLimitMinutes
    @Published private(set) var isMonitoringEnabled = SharedStore.policy.isEnabled
    @Published var isPickerPresented = false
    @Published var isShieldPreviewPresented = false
#if targetEnvironment(simulator)
    @Published var message = "Simulator preview only. Apple Screen Time enforcement requires a physical iPhone or iPad."
#else
    @Published var message = "Choose TikTok, authorize Screen Time, then save the policy."
#endif

    private let activityCenter = DeviceActivityCenter()
    private let dailyLimitStore = ManagedSettingsStore(named: .dailyLimit)
    private let scholarGateStore = ManagedSettingsStore(named: .scholarGate)

    init() {
        // Persist a fresh checklist immediately when the calendar day changes,
        // even before the user edits a task or saves the Screen Time policy.
        SharedStore.dayContext = dayContext
#if !targetEnvironment(simulator)
        if isMonitoringEnabled {
            message = "Monitoring is active: \(dailyLimitMinutes) minutes per day plus ScholarOS task rules."
        }
#endif
    }

    var isSimulator: Bool {
#if targetEnvironment(simulator)
        true
#else
        false
#endif
    }

    var selectedItemCount: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    var authorizationTitle: String {
        switch authorizationStatus {
        case .notDetermined: "Not requested"
        case .denied: "Denied"
        case .approved: "Approved"
        default: "Approved with access"
        }
    }

    private var hasAuthorization: Bool {
        switch authorizationStatus {
        case .approved:
            true
        case .notDetermined, .denied:
            false
        default:
            true
        }
    }

    func refresh() {
        authorizationStatus = AuthorizationCenter.shared.authorizationStatus
        isMonitoringEnabled = SharedStore.policy.isEnabled
        dayContext = SharedStore.dayContext.rolledForwardIfNeeded()
        SharedStore.dayContext = dayContext
        if !hasAuthorization || !isMonitoringEnabled {
            activityCenter.stopMonitoring([.scholarOSDaily])
            dailyLimitStore.clearAllSettings()
            SharedStore.setShield(.dailyLimit, detail: nil)
        }
        reconcileScholarGate()
    }

    func requestAuthorization() async {
#if targetEnvironment(simulator)
        message = "Apple does not provide real Screen Time authorization in Simulator. Use the preview or run on your iPhone or iPad."
        return
#else
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            message = "Screen Time access is approved. Select TikTok next."
        } catch {
            authorizationStatus = AuthorizationCenter.shared.authorizationStatus
            message = "Screen Time authorization failed: \(error.localizedDescription)"
        }
#endif
    }

    func switchMode(to mode: ScholarDayMode) {
        guard mode != dayContext.mode else { return }
        dayContext = .today(mode: mode)
        persistDayContextAndReconcile()
    }

    func updateChecklistItem(_ item: ScholarChecklistItem) {
        guard let index = dayContext.checklist.firstIndex(where: { $0.id == item.id }) else { return }
        dayContext.checklist[index] = item
        persistDayContextAndReconcile()
    }

    func savePolicy() {
#if targetEnvironment(simulator)
        message = "Simulator cannot activate Family Controls. Preview the shield here, then test enforcement on a signed physical iPhone or iPad."
        isShieldPreviewPresented = true
#else
        guard hasAuthorization else {
            message = "Approve Screen Time access before saving."
            return
        }
        guard selectedItemCount > 0 else {
            message = "Select TikTok (or another app) before saving."
            return
        }

        let policy = ScreenTimePolicy(dailyLimitMinutes: dailyLimitMinutes)
        dailyLimitMinutes = policy.dailyLimitMinutes
        isMonitoringEnabled = true
        SharedStore.selection = selection
        SharedStore.policy = policy
        SharedStore.dayContext = dayContext

        do {
            try startDailyMonitoring()
            reconcileScholarGate()
            message = "Policy is active: \(dailyLimitMinutes) minutes per day plus ScholarOS task rules."
        } catch {
            message = "The policy was saved, but monitoring could not start: \(error.localizedDescription)"
        }
#endif
    }

    func clearAllShields() {
        activityCenter.stopMonitoring([.scholarOSDaily])
        dailyLimitStore.clearAllSettings()
        scholarGateStore.clearAllSettings()
        SharedStore.shieldSnapshot = .clear
        var policy = SharedStore.policy
        policy.isEnabled = false
        policy.updatedAt = .now
        SharedStore.policy = policy
        isMonitoringEnabled = false
        message = "Monitoring and both LockIn shields are off."
    }

    private func persistDayContextAndReconcile() {
        dayContext.updatedAt = .now
        SharedStore.dayContext = dayContext
        reconcileScholarGate()
    }

    private func reconcileScholarGate() {
        guard hasAuthorization, isMonitoringEnabled else {
            scholarGateStore.clearAllSettings()
            SharedStore.setShield(.scholarGate, detail: nil)
            return
        }

        let gate = dayContext.screenGate
        if gate.shouldBlock, selectedItemCount > 0 {
            ShieldController.apply(selection: selection, to: scholarGateStore)
            SharedStore.setShield(.scholarGate, detail: gate.reason)
        } else {
            scholarGateStore.clearAllSettings()
            SharedStore.setShield(.scholarGate, detail: nil)
        }
    }

    private func startDailyMonitoring() throws {
        // A changed selection must replace, rather than accumulate with, a shield
        // applied by the previous policy. includesPastActivity can re-trigger the
        // new policy immediately on supported systems when its threshold was met.
        dailyLimitStore.clearAllSettings()
        SharedStore.setShield(.dailyLimit, detail: nil)

        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59, second: 59),
            repeats: true
        )

        let threshold = DateComponents(minute: dailyLimitMinutes)
        let event: DeviceActivityEvent
        if #available(iOS 17.4, *) {
            event = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: selection.webDomainTokens,
                threshold: threshold,
                includesPastActivity: true
            )
        } else {
            event = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: selection.webDomainTokens,
                threshold: threshold
            )
        }

        activityCenter.stopMonitoring([.scholarOSDaily])
        try activityCenter.startMonitoring(
            .scholarOSDaily,
            during: schedule,
            events: [.selectedAppsLimit: event]
        )
    }
}
