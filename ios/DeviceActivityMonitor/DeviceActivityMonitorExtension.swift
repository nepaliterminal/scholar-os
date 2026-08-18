import DeviceActivity
import ManagedSettings

final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let dailyLimitStore = ManagedSettingsStore(named: .dailyLimit)
    private let scholarGateStore = ManagedSettingsStore(named: .scholarGate)

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity == .scholarOSDaily else { return }
        guard SharedStore.policy.isEnabled else {
            dailyLimitStore.clearAllSettings()
            scholarGateStore.clearAllSettings()
            SharedStore.shieldSnapshot = .clear
            return
        }
        dailyLimitStore.clearAllSettings()
        SharedStore.setShield(.dailyLimit, detail: nil)

        // DeviceActivity wakes this extension at the new daily interval, so the
        // checklist rolls over even when the user does not open the main app.
        let dayContext = SharedStore.dayContext.rolledForwardIfNeeded()
        SharedStore.dayContext = dayContext
        if dayContext.screenGate.shouldBlock {
            ShieldController.apply(selection: SharedStore.selection, to: scholarGateStore)
            SharedStore.setShield(.scholarGate, detail: dayContext.screenGate.reason)
        } else {
            scholarGateStore.clearAllSettings()
            SharedStore.setShield(.scholarGate, detail: nil)
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity == .scholarOSDaily else { return }
        dailyLimitStore.clearAllSettings()
        SharedStore.setShield(.dailyLimit, detail: nil)
    }

    override func eventDidReachThreshold(
        _ event: DeviceActivityEvent.Name,
        activity: DeviceActivityName
    ) {
        super.eventDidReachThreshold(event, activity: activity)
        guard activity == .scholarOSDaily, event == .selectedAppsLimit else { return }
        guard SharedStore.policy.isEnabled else {
            dailyLimitStore.clearAllSettings()
            SharedStore.setShield(.dailyLimit, detail: nil)
            return
        }

        ShieldController.apply(selection: SharedStore.selection, to: dailyLimitStore)
        let minutes = SharedStore.policy.dailyLimitMinutes
        SharedStore.setShield(
            .dailyLimit,
            detail: "Today’s \(minutes)-minute scrolling allowance is finished."
        )
    }
}
