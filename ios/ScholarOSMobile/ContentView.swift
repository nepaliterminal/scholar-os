import Combine
import FamilyControls
import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var controller: ScreenTimeController

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    if controller.isSimulator {
                        simulatorCard
                    }
                    authorizationCard
                    appSelectionCard
                    dayContextCard
                    dailyLimitCard
                    pokeCard
                    controls
                }
                .padding(20)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .background(Color.lockInBackground.ignoresSafeArea())
            .navigationTitle("LockIn")
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(
                isPresented: $controller.isPickerPresented,
                selection: $controller.selection
            )
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                controller.refresh()
            }
            .sheet(isPresented: $controller.isShieldPreviewPresented) {
                SimulatorShieldPreview(
                    dayContext: controller.dayContext,
                    dailyLimitMinutes: controller.dailyLimitMinutes
                )
            }
        }
        .tint(.lockInOrange)
    }

    private var simulatorCard: some View {
        LockInSection(title: "Simulator preview", symbol: "rectangle.on.rectangle.slash") {
            Label(
                "Apple does not report app usage or enforce Screen Time shields in iOS Simulator.",
                systemImage: "exclamationmark.triangle.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.orange)

            Text("This is an Apple platform limitation, not a Poke connection error. Use the preview below to inspect LockIn’s blocked screen; use a signed physical iPhone or iPad to block TikTok.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Preview blocked screen") {
                controller.isShieldPreviewPresented = true
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("SCREEN TIME COMPANION", systemImage: "lock.shield.fill")
                .font(.caption.bold())
                .foregroundStyle(Color.lockInOrange)
            Text("Poke decides.\nYour device enforces.")
                .font(.system(.largeTitle, design: .rounded, weight: .black))
                .minimumScaleFactor(0.8)
            Text("The phone keeps app selection tokens private and applies Apple’s native Screen Time shield when a limit or ScholarOS rule is reached.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .lockInCard()
    }

    private var authorizationCard: some View {
        LockInSection(title: "1. Screen Time access", symbol: "checkmark.seal.fill") {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(controller.authorizationTitle).font(.headline)
                    Text("Apple asks once on this iPhone or iPad.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(controller.isSimulator ? "Device only" : "Authorize") {
                    Task { await controller.requestAuthorization() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(controller.isSimulator)
            }
        }
    }

    private var appSelectionCard: some View {
        LockInSection(title: "2. Choose TikTok", symbol: "square.grid.2x2.fill") {
            Button {
                controller.isPickerPresented = true
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text(controller.selectedItemCount == 0
                         ? "Select apps or websites"
                         : "\(controller.selectedItemCount) private selection(s)")
                    Spacer()
                    Image(systemName: "chevron.right")
                }
                .font(.headline)
            }
            .disabled(controller.isSimulator)
            Text("Pick TikTok in Apple’s private picker. LockIn receives an opaque token, not your app-use history.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var dayContextCard: some View {
        LockInSection(title: "3. Today in ScholarOS", symbol: controller.dayContext.mode.symbol) {
            Picker("Day mode", selection: Binding(
                get: { controller.dayContext.mode },
                set: { controller.switchMode(to: $0) }
            )) {
                ForEach(ScholarDayMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Text(controller.dayContext.mode.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(spacing: 10) {
                ForEach(controller.dayContext.checklist) { item in
                    ChecklistRow(item: item) { updated in
                        controller.updateChecklistItem(updated)
                    }
                }
            }

            Label(
                controller.dayContext.screenGate.reason,
                systemImage: controller.dayContext.screenGate.shouldBlock
                    ? "lock.fill"
                    : "lock.open.fill"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(controller.dayContext.screenGate.shouldBlock ? Color.lockInOrange : Color.green)
        }
    }

    private var dailyLimitCard: some View {
        LockInSection(title: "4. Daily scrolling limit", symbol: "timer") {
            Stepper(value: $controller.dailyLimitMinutes, in: ScreenTimePolicy.allowedMinutes, step: 5) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Daily allowance")
                    Spacer()
                    Text("\(controller.dailyLimitMinutes) min")
                        .font(.title3.bold())
                        .foregroundStyle(Color.lockInOrange)
                }
            }
            Text("Apple counts foreground use on-device. The monitor applies the daily-limit shield after this threshold.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Label(
                controller.isMonitoringEnabled ? "Monitoring active" : "Monitoring off",
                systemImage: controller.isMonitoringEnabled
                    ? "checkmark.circle.fill"
                    : "pause.circle.fill"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(controller.isMonitoringEnabled ? Color.green : Color.secondary)
        }
    }

    private var pokeCard: some View {
        LockInSection(title: "Optional Poke sync", symbol: "bolt.horizontal.circle.fill") {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(.yellow)
                    .frame(width: 10, height: 10)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Not connected — local blocking is independent")
                        .font(.subheadline.bold())
                    Text("A physical iPhone or iPad can enforce the saved policy without Poke. Future LockIn MCP transport will let Poke change that policy remotely without receiving raw Screen Time history.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 12) {
            Button(controller.isSimulator ? "Preview blocked screen" : "Save and activate") {
                controller.savePolicy()
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(Color.lockInOrange, in: RoundedRectangle(cornerRadius: 15))
            .foregroundStyle(.white)

            Text(controller.message)
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if !controller.isSimulator, controller.isMonitoringEnabled {
                Button("Turn off monitoring", role: .destructive) {
                    controller.clearAllShields()
                }
                .font(.footnote)
            }
        }
        .padding(.bottom, 24)
    }
}

private struct SimulatorShieldPreview: View {
    @Environment(\.dismiss) private var dismiss
    let dayContext: ScholarDayContext
    let dailyLimitMinutes: Int

    private var explanation: String {
        if dayContext.screenGate.shouldBlock {
            return dayContext.screenGate.reason
        }
        return "Today’s \(dailyLimitMinutes)-minute scrolling allowance is finished."
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.05, blue: 0.08),
                    Color(red: 0.14, green: 0.07, blue: 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 22) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 68, weight: .bold))
                    .foregroundStyle(Color.lockInOrange)

                VStack(spacing: 10) {
                    Text("Locked for your \(dayContext.mode.title.lowercased())")
                        .font(.system(size: 27, weight: .black, design: .rounded))
                        .multilineTextAlignment(.center)
                    Text(explanation)
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.72))
                }

                Button("Stay locked in") {
                    dismiss()
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(Color.lockInOrange, in: RoundedRectangle(cornerRadius: 15))

                Text("SIMULATOR VISUAL PREVIEW")
                    .font(.caption2.bold())
                    .tracking(1.4)
                    .foregroundStyle(.white.opacity(0.42))
            }
            .foregroundStyle(.white)
            .padding(28)
        }
        .presentationDetents([.large])
    }
}

private struct ChecklistRow: View {
    let item: ScholarChecklistItem
    let onChange: (ScholarChecklistItem) -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    var copy = item
                    copy.isDone.toggle()
                    onChange(copy)
                } label: {
                    Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                }
                .accessibilityLabel(item.isDone
                    ? "Mark \(item.title) incomplete"
                    : "Mark \(item.title) complete")
                Text(item.title)
                    .strikethrough(item.isDone)
                    .foregroundStyle(item.isDone ? .secondary : .primary)
                Spacer()
            }
            Toggle("Required before screen time", isOn: Binding(
                get: { item.gatesScreenTime },
                set: { value in
                    var copy = item
                    copy.gatesScreenTime = value
                    onChange(copy)
                }
            ))
            .font(.caption)
        }
        .padding(12)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct LockInSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: symbol)
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .lockInCard()
    }
}

private extension View {
    func lockInCard() -> some View {
        background(Color.lockInCard, in: RoundedRectangle(cornerRadius: 22))
            .overlay {
                RoundedRectangle(cornerRadius: 22)
                    .stroke(Color.primary.opacity(0.07), lineWidth: 1)
            }
    }
}

private extension Color {
    static let lockInOrange = Color(red: 0.96, green: 0.29, blue: 0.12)
    static let lockInBackground = Color(uiColor: .systemGroupedBackground)
    static let lockInCard = Color(uiColor: .secondarySystemGroupedBackground)
}
