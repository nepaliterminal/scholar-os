import SwiftUI

@main
struct ScholarOSMobileApp: App {
    @StateObject private var controller = ScreenTimeController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(controller)
        }
    }
}
