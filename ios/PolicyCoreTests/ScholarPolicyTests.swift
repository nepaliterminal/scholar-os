import Foundation
import Testing
@testable import ScholarPolicy

@Suite("ScholarOS day policy")
struct ScholarPolicyTests {
    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    @Test("Summer defaults never introduce school-only tasks")
    func summerIgnoresSchoolRoutines() {
        let titles = ScholarDayMode.summer.defaultChecklist
            .map { $0.title.joinedWords }
            .joined(separator: " ")
        #expect(!titles.contains("bus"))
        #expect(!titles.contains("class"))
        #expect(!titles.contains("backpack"))
        #expect(!titles.contains("school"))
    }

    @Test("Only explicitly gated unfinished tasks block")
    func explicitGateOnly() {
        var context = ScholarDayContext.today(
            mode: .party,
            now: date("2026-08-18T12:00:00Z"),
            calendar: utcCalendar
        )
        #expect(context.screenGate.incompleteTitles == ["Get ready"])

        context.checklist[0].isDone = true
        #expect(!context.screenGate.shouldBlock)

        context.checklist[1].gatesScreenTime = true
        #expect(context.screenGate.incompleteTitles == ["Help with one thing"])
    }

    @Test("A new local date resets tasks but preserves mode")
    func dayRollover() {
        var context = ScholarDayContext.today(
            mode: .summer,
            now: date("2026-08-18T12:00:00Z"),
            calendar: utcCalendar
        )
        context.checklist[0].isDone = true

        let sameDay = context.rolledForwardIfNeeded(
            now: date("2026-08-18T23:59:00Z"),
            calendar: utcCalendar
        )
        #expect(sameDay.checklist[0].isDone)

        let nextDay = context.rolledForwardIfNeeded(
            now: date("2026-08-19T00:01:00Z"),
            calendar: utcCalendar
        )
        #expect(nextDay.mode == .summer)
        #expect(nextDay.localDate == "2026-08-19")
        #expect(nextDay.checklist.allSatisfy { !$0.isDone })
    }

    @Test("The same instant rolls over according to the device time zone")
    func localTimeZoneRollover() {
        var newYork = Calendar(identifier: .gregorian)
        newYork.timeZone = TimeZone(identifier: "America/New_York")!
        var kathmandu = Calendar(identifier: .gregorian)
        kathmandu.timeZone = TimeZone(identifier: "Asia/Kathmandu")!
        let instant = date("2026-08-18T01:00:00Z")

        #expect(ScholarDayContext.localDateString(for: instant, calendar: newYork) == "2026-08-17")
        #expect(ScholarDayContext.localDateString(for: instant, calendar: kathmandu) == "2026-08-18")
    }

    @Test("Daily limits are clamped inside a monitorable day")
    func dailyLimitClamping() {
        #expect(ScreenTimePolicy(dailyLimitMinutes: -5).dailyLimitMinutes == 1)
        #expect(ScreenTimePolicy(dailyLimitMinutes: 30).dailyLimitMinutes == 30)
        #expect(ScreenTimePolicy(dailyLimitMinutes: 1_440).dailyLimitMinutes == 1_439)
    }

    @Test("Monitoring starts off, while legacy saved policies stay active")
    func monitoringStateMigration() throws {
        #expect(!ScreenTimePolicy.standard.isEnabled)
        #expect(ScreenTimePolicy(dailyLimitMinutes: 30).isEnabled)

        let legacyJSON = #"{"dailyLimitMinutes":45,"updatedAt":0}"#.data(using: .utf8)!
        let migrated = try JSONDecoder().decode(ScreenTimePolicy.self, from: legacyJSON)
        #expect(migrated.dailyLimitMinutes == 45)
        #expect(migrated.isEnabled)

        let disabled = ScreenTimePolicy(dailyLimitMinutes: 20, isEnabled: false)
        let roundTrip = try JSONDecoder().decode(
            ScreenTimePolicy.self,
            from: JSONEncoder().encode(disabled)
        )
        #expect(!roundTrip.isEnabled)
    }

    @Test("Day context survives persistence")
    func codableRoundTrip() throws {
        let original = ScholarDayContext.today(
            mode: .school,
            now: date("2026-08-18T12:00:00Z"),
            calendar: utcCalendar
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(ScholarDayContext.self, from: data)
        #expect(decoded == original)
    }
}

@Suite("Independent shield state")
struct ShieldSnapshotTests {
    private let old = Date(timeIntervalSince1970: 100)
    private let newer = Date(timeIntervalSince1970: 200)

    @Test("A cleared migrated reason does not resurrect its legacy value")
    func partialMigration() {
        let legacy = ShieldSnapshot(
            dailyLimitDetail: "Old daily limit",
            scholarGateDetail: "Old task gate",
            updatedAt: old
        )
        let resolved = ShieldSnapshot.resolving(
            daily: ShieldReasonState(detail: nil, updatedAt: newer),
            scholar: nil,
            legacy: legacy
        )

        #expect(resolved.dailyLimitDetail == nil)
        #expect(resolved.scholarGateDetail == "Old task gate")
        #expect(resolved.reason == .scholarGate)
        #expect(resolved.updatedAt == newer)
    }

    @Test("Independent states override every legacy reason")
    func fullyMigrated() {
        let legacy = ShieldSnapshot(
            dailyLimitDetail: "Old daily limit",
            scholarGateDetail: "Old task gate",
            updatedAt: old
        )
        let resolved = ShieldSnapshot.resolving(
            daily: ShieldReasonState(detail: "New daily limit", updatedAt: newer),
            scholar: ShieldReasonState(detail: nil, updatedAt: newer),
            legacy: legacy
        )

        #expect(resolved.dailyLimitDetail == "New daily limit")
        #expect(resolved.scholarGateDetail == nil)
        #expect(resolved.reason == .dailyLimit)
    }

    @Test("The daily limit has display priority when both reasons are active")
    func reasonPriority() {
        let resolved = ShieldSnapshot.resolving(
            daily: ShieldReasonState(detail: "Daily", updatedAt: old),
            scholar: ShieldReasonState(detail: "Scholar", updatedAt: newer),
            legacy: nil
        )

        #expect(resolved.reason == .dailyLimit)
        #expect(resolved.detail == "Daily")
        #expect(resolved.updatedAt == newer)
    }
}

@Suite("Remote Poke policy payload")
struct RemotePolicyCommandTests {
    private let now = Date(timeIntervalSince1970: 1_787_076_000)

    private func command() -> RemotePolicyCommand {
        .init(
            commandID: "command-1",
            issuedAt: now.addingTimeInterval(-10),
            expiresAt: now.addingTimeInterval(5 * 60),
            dayMode: .summer,
            dailyLimitMinutes: 30,
            scholarGate: .init(shouldBlock: true, incompleteTaskIDs: ["task-1"])
        )
    }

    @Test("A short-lived coherent command is accepted")
    func validCommand() throws {
        try command().validate(now: now)
    }

    @Test("Expired and overlong commands are rejected")
    func timeBounds() {
        var expired = command()
        expired.expiresAt = now.addingTimeInterval(-1)
        #expect(throws: RemotePolicyValidationError.expired) {
            try expired.validate(now: now)
        }

        var overlong = command()
        overlong.expiresAt = overlong.issuedAt.addingTimeInterval(16 * 60)
        #expect(throws: RemotePolicyValidationError.validityWindowTooLong) {
            try overlong.validate(now: now)
        }
    }

    @Test("Contradictory gate and duplicate task IDs are rejected")
    func gateCoherence() {
        var contradictory = command()
        contradictory.scholarGate.shouldBlock = false
        #expect(throws: RemotePolicyValidationError.conflictingGateState) {
            try contradictory.validate(now: now)
        }

        var duplicate = command()
        duplicate.scholarGate.incompleteTaskIDs = ["task-1", " task-1 "]
        #expect(throws: RemotePolicyValidationError.invalidTaskIDs) {
            try duplicate.validate(now: now)
        }
    }

    @Test("Command receipts are reserved before mutation and reject replay")
    func replayGuard() throws {
        var guardState = RemoteCommandReplayGuard()
        let valid = command()
        try guardState.reserve(valid, now: now)
        #expect(guardState.receipts.map(\.commandID) == [valid.commandID])
        var whitespaceReplay = valid
        whitespaceReplay.commandID = "  \(valid.commandID)  "
        #expect(throws: RemotePolicyValidationError.duplicateCommand) {
            try guardState.reserve(whitespaceReplay, now: now)
        }

        var later = command()
        later.commandID = "command-2"
        later.issuedAt = valid.expiresAt
        later.expiresAt = valid.expiresAt.addingTimeInterval(5 * 60)
        try guardState.reserve(later, now: valid.expiresAt)
        #expect(guardState.receipts.map(\.commandID) == [later.commandID])
    }

    @Test("Oversized command and task identifiers are rejected")
    func boundedIdentifiers() {
        var oversizedCommand = command()
        oversizedCommand.commandID = String(repeating: "x", count: 129)
        #expect(throws: RemotePolicyValidationError.missingCommandID) {
            try oversizedCommand.validate(now: now)
        }

        var tooManyTasks = command()
        tooManyTasks.scholarGate.incompleteTaskIDs = (0...100).map { "task-\($0)" }
        #expect(throws: RemotePolicyValidationError.invalidTaskIDs) {
            try tooManyTasks.validate(now: now)
        }
    }
}

private extension String {
    var joinedWords: String {
        lowercased().replacingOccurrences(of: " ", with: "")
    }
}
