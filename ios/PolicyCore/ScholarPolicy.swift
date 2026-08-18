import Foundation

enum ScholarDayMode: String, Codable, CaseIterable, Identifiable {
    case school
    case summer
    case party

    var id: String { rawValue }

    var title: String {
        switch self {
        case .school: "School day"
        case .summer: "Summer day"
        case .party: "Party day"
        }
    }

    var symbol: String {
        switch self {
        case .school: "backpack.fill"
        case .summer: "sun.max.fill"
        case .party: "party.popper.fill"
        }
    }

    var explanation: String {
        switch self {
        case .school:
            "School routines and marked school tasks can gate distracting apps."
        case .summer:
            "Bus times, classes, backpack checks, and school-only routines are ignored."
        case .party:
            "Only the few tasks explicitly marked before screen time can gate apps."
        }
    }

    var defaultChecklist: [ScholarChecklistItem] {
        switch self {
        case .school:
            [
                .init(title: "Get ready for the day", isDone: false, gatesScreenTime: true),
                .init(title: "Pack school bag", isDone: false, gatesScreenTime: true),
                .init(title: "Finish today’s ScholarOS work", isDone: false, gatesScreenTime: true),
                .init(title: "Catch the 8:40 bus", isDone: false, gatesScreenTime: false)
            ]
        case .summer:
            [
                .init(title: "Morning routine", isDone: false, gatesScreenTime: true),
                .init(title: "One important summer goal", isDone: false, gatesScreenTime: true),
                .init(title: "Go outside", isDone: false, gatesScreenTime: false)
            ]
        case .party:
            [
                .init(title: "Get ready", isDone: false, gatesScreenTime: true),
                .init(title: "Help with one thing", isDone: false, gatesScreenTime: false),
                .init(title: "Enjoy the party", isDone: false, gatesScreenTime: false)
            ]
        }
    }
}

struct ScholarChecklistItem: Codable, Equatable, Identifiable {
    var id = UUID()
    var title: String
    var isDone: Bool
    var gatesScreenTime: Bool
}

struct ScholarScreenGate: Equatable {
    let shouldBlock: Bool
    let incompleteTitles: [String]

    var reason: String {
        guard shouldBlock else { return "All before-screen-time tasks are complete." }
        if incompleteTitles.count == 1 {
            return "Finish \(incompleteTitles[0]) before opening distracting apps."
        }
        return "Finish \(incompleteTitles.count) before-screen-time tasks first."
    }
}

struct ScholarDayContext: Codable, Equatable {
    var localDate: String
    var mode: ScholarDayMode
    var checklist: [ScholarChecklistItem]
    var updatedAt: Date

    var screenGate: ScholarScreenGate {
        let unfinished = checklist
            .filter { $0.gatesScreenTime && !$0.isDone }
            .map(\.title)
        return .init(shouldBlock: !unfinished.isEmpty, incompleteTitles: unfinished)
    }

    static func localDateString(
        for date: Date,
        calendar: Calendar = .current
    ) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            locale: Locale(identifier: "en_US_POSIX"),
            parts.year ?? 0,
            parts.month ?? 0,
            parts.day ?? 0
        )
    }

    static func today(
        mode: ScholarDayMode,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> Self {
        .init(
            localDate: localDateString(for: now, calendar: calendar),
            mode: mode,
            checklist: mode.defaultChecklist,
            updatedAt: now
        )
    }

    func rolledForwardIfNeeded(
        now: Date = .now,
        calendar: Calendar = .current
    ) -> Self {
        guard localDate != Self.localDateString(for: now, calendar: calendar) else {
            return self
        }
        return .today(mode: mode, now: now, calendar: calendar)
    }
}

struct ScreenTimePolicy: Codable, Equatable {
    static let allowedMinutes = 1...1_439

    var dailyLimitMinutes: Int
    var isEnabled: Bool
    var updatedAt: Date

    init(dailyLimitMinutes: Int, isEnabled: Bool = true, updatedAt: Date = .now) {
        self.dailyLimitMinutes = min(
            max(dailyLimitMinutes, Self.allowedMinutes.lowerBound),
            Self.allowedMinutes.upperBound
        )
        self.isEnabled = isEnabled
        self.updatedAt = updatedAt
    }

    static let standard = Self(dailyLimitMinutes: 30, isEnabled: false)

    private enum CodingKeys: String, CodingKey {
        case dailyLimitMinutes
        case isEnabled
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let minutes = try values.decode(Int.self, forKey: .dailyLimitMinutes)
        dailyLimitMinutes = min(
            max(minutes, Self.allowedMinutes.lowerBound),
            Self.allowedMinutes.upperBound
        )
        // A stored policy from the first native prototype existed only after the
        // user tapped Save, so preserve its active meaning during migration.
        isEnabled = try values.decodeIfPresent(Bool.self, forKey: .isEnabled) ?? true
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .distantPast
    }
}

enum ShieldReason: String, Codable {
    case dailyLimit
    case scholarGate
}

struct ShieldReasonState: Codable, Equatable {
    let detail: String?
    let updatedAt: Date
}

struct ShieldSnapshot: Codable, Equatable {
    var dailyLimitDetail: String?
    var scholarGateDetail: String?
    var updatedAt: Date

    var isBlocked: Bool { dailyLimitDetail != nil || scholarGateDetail != nil }

    var reason: ShieldReason? {
        if dailyLimitDetail != nil { return .dailyLimit }
        if scholarGateDetail != nil { return .scholarGate }
        return nil
    }

    var detail: String {
        dailyLimitDetail
            ?? scholarGateDetail
            ?? "No Screen Time shield is active."
    }

    static let clear = Self(dailyLimitDetail: nil, scholarGateDetail: nil, updatedAt: .now)

    static func resolving(
        daily: ShieldReasonState?,
        scholar: ShieldReasonState?,
        legacy: ShieldSnapshot?
    ) -> Self {
        let dailyDetail = daily == nil ? legacy?.dailyLimitDetail : daily?.detail
        let scholarDetail = scholar == nil ? legacy?.scholarGateDetail : scholar?.detail
        let timestamps = [
            daily?.updatedAt,
            scholar?.updatedAt,
            daily == nil || scholar == nil ? legacy?.updatedAt : nil
        ].compactMap { $0 }

        return Self(
            dailyLimitDetail: dailyDetail,
            scholarGateDetail: scholarDetail,
            updatedAt: timestamps.max() ?? .now
        )
    }
}

struct ScholarGateDirective: Codable, Equatable {
    var shouldBlock: Bool
    var incompleteTaskIDs: [String]
}

struct RemotePolicyCommand: Codable, Equatable {
    var commandID: String
    var issuedAt: Date
    var expiresAt: Date
    var dayMode: ScholarDayMode
    var dailyLimitMinutes: Int
    var scholarGate: ScholarGateDirective

    func validate(now: Date = .now) throws {
        let normalizedCommandID = commandID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedCommandID.isEmpty, normalizedCommandID.utf8.count <= 128 else {
            throw RemotePolicyValidationError.missingCommandID
        }
        guard expiresAt > issuedAt, expiresAt > now else {
            throw RemotePolicyValidationError.expired
        }
        guard issuedAt <= now.addingTimeInterval(5 * 60) else {
            throw RemotePolicyValidationError.issuedInFuture
        }
        guard expiresAt.timeIntervalSince(issuedAt) <= 15 * 60 else {
            throw RemotePolicyValidationError.validityWindowTooLong
        }
        guard ScreenTimePolicy.allowedMinutes.contains(dailyLimitMinutes) else {
            throw RemotePolicyValidationError.invalidDailyLimit
        }

        let taskIDs = scholarGate.incompleteTaskIDs
        let normalizedTaskIDs = taskIDs.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard taskIDs.count <= 100,
              normalizedTaskIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 200 }),
              Set(normalizedTaskIDs).count == normalizedTaskIDs.count else {
            throw RemotePolicyValidationError.invalidTaskIDs
        }
        guard scholarGate.shouldBlock || taskIDs.isEmpty else {
            throw RemotePolicyValidationError.conflictingGateState
        }
    }
}

struct RemoteCommandReceipt: Codable, Equatable {
    let commandID: String
    let expiresAt: Date
    let reservedAt: Date
}

struct RemoteCommandReplayGuard: Codable, Equatable {
    private(set) var receipts: [RemoteCommandReceipt] = []

    mutating func reserve(_ command: RemotePolicyCommand, now: Date = .now) throws {
        try command.validate(now: now)
        let commandID = command.commandID.trimmingCharacters(in: .whitespacesAndNewlines)
        receipts.removeAll { $0.expiresAt <= now }
        guard !receipts.contains(where: { $0.commandID == commandID }) else {
            throw RemotePolicyValidationError.duplicateCommand
        }
        receipts.append(.init(
            commandID: commandID,
            expiresAt: command.expiresAt,
            reservedAt: now
        ))
        receipts = Array(receipts.suffix(100))
    }
}

enum RemotePolicyValidationError: Error, Equatable {
    case missingCommandID
    case expired
    case issuedInFuture
    case validityWindowTooLong
    case invalidDailyLimit
    case invalidTaskIDs
    case conflictingGateState
    case duplicateCommand
}
