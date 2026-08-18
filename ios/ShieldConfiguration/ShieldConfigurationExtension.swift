import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        makeConfiguration(applicationName: application.localizedDisplayName)
    }

    override func configuration(
        shielding application: Application,
        in category: ActivityCategory
    ) -> ShieldConfiguration {
        makeConfiguration(applicationName: application.localizedDisplayName)
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        makeConfiguration(applicationName: webDomain.domain)
    }

    override func configuration(
        shielding webDomain: WebDomain,
        in category: ActivityCategory
    ) -> ShieldConfiguration {
        makeConfiguration(applicationName: webDomain.domain)
    }

    private func makeConfiguration(applicationName: String?) -> ShieldConfiguration {
        let snapshot = SharedStore.shieldSnapshot
        let day = SharedStore.dayContext
        let title: String
        let subtitle: String

        switch snapshot.reason {
        case .dailyLimit:
            title = "Daily limit reached"
            subtitle = snapshot.detail
        case .scholarGate:
            title = "Locked for your \(day.mode.title.lowercased())"
            subtitle = day.screenGate.reason
        case nil:
            title = "This app is blocked"
            subtitle = "Open LockIn to review today’s rule."
        }

        return ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialDark,
            backgroundColor: UIColor(red: 0.08, green: 0.07, blue: 0.10, alpha: 1),
            icon: UIImage(systemName: "lock.shield.fill"),
            title: .init(text: title, color: .white),
            subtitle: .init(text: subtitle, color: UIColor.white.withAlphaComponent(0.74)),
            primaryButtonLabel: .init(text: "Stay locked in", color: .white),
            primaryButtonBackgroundColor: UIColor(red: 0.96, green: 0.29, blue: 0.12, alpha: 1),
            secondaryButtonLabel: .init(text: "Not now", color: UIColor.white.withAlphaComponent(0.7))
        )
    }
}
