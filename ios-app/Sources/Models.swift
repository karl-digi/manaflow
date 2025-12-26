import Foundation

struct Conversation: Identifiable {
    let id = UUID()
    let name: String
    let avatar: String // SF Symbol or initials
    let lastMessage: String
    let timestamp: Date
    let unreadCount: Int
    let isOnline: Bool
    var messages: [Message]
}

struct Message: Identifiable {
    let id = UUID()
    let content: String
    let timestamp: Date
    let isFromMe: Bool
    let status: MessageStatus
}

enum MessageStatus {
    case sending
    case sent
    case delivered
    case read
}

// MARK: - Fake Data

extension Date {
    static func minutesAgo(_ minutes: Int) -> Date {
        Calendar.current.date(byAdding: .minute, value: -minutes, to: .now)!
    }
    static func hoursAgo(_ hours: Int) -> Date {
        Calendar.current.date(byAdding: .hour, value: -hours, to: .now)!
    }
    static func daysAgo(_ days: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: -days, to: .now)!
    }
}

let fakeConversations: [Conversation] = [
    Conversation(
        name: "Claude",
        avatar: "brain.head.profile",
        lastMessage: "I've finished implementing the authentication system. Ready for review!",
        timestamp: .minutesAgo(2),
        unreadCount: 3,
        isOnline: true,
        messages: [
            Message(content: "Hey Claude, can you help me with the auth system?", timestamp: .minutesAgo(30), isFromMe: true, status: .read),
            Message(content: "Of course! I'll start working on it now. What authentication method would you prefer - JWT or session-based?", timestamp: .minutesAgo(28), isFromMe: false, status: .read),
            Message(content: "JWT please, with refresh tokens", timestamp: .minutesAgo(25), isFromMe: true, status: .read),
            Message(content: "Got it. I'll implement JWT with refresh token rotation for security.", timestamp: .minutesAgo(23), isFromMe: false, status: .read),
            Message(content: "I've finished implementing the authentication system. Ready for review!", timestamp: .minutesAgo(2), isFromMe: false, status: .delivered),
        ]
    ),
    Conversation(
        name: "Sarah Chen",
        avatar: "person.circle.fill",
        lastMessage: "The deploy looks good 🚀",
        timestamp: .minutesAgo(15),
        unreadCount: 0,
        isOnline: true,
        messages: [
            Message(content: "Hey, did you push the changes?", timestamp: .minutesAgo(45), isFromMe: false, status: .read),
            Message(content: "Yes, just deployed to staging", timestamp: .minutesAgo(30), isFromMe: true, status: .read),
            Message(content: "The deploy looks good 🚀", timestamp: .minutesAgo(15), isFromMe: false, status: .read),
        ]
    ),
    Conversation(
        name: "Dev Team",
        avatar: "person.3.fill",
        lastMessage: "Mike: standup in 5",
        timestamp: .hoursAgo(1),
        unreadCount: 12,
        isOnline: false,
        messages: [
            Message(content: "Good morning everyone!", timestamp: .hoursAgo(3), isFromMe: false, status: .read),
            Message(content: "Morning! Ready for the sprint review?", timestamp: .hoursAgo(2), isFromMe: true, status: .read),
            Message(content: "Mike: standup in 5", timestamp: .hoursAgo(1), isFromMe: false, status: .read),
        ]
    ),
    Conversation(
        name: "Alex Rivera",
        avatar: "person.circle.fill",
        lastMessage: "Thanks for the code review!",
        timestamp: .hoursAgo(3),
        unreadCount: 0,
        isOnline: false,
        messages: [
            Message(content: "Can you review my PR when you get a chance?", timestamp: .hoursAgo(5), isFromMe: false, status: .read),
            Message(content: "Sure, looking now", timestamp: .hoursAgo(4), isFromMe: true, status: .read),
            Message(content: "Left some comments, mostly minor stuff", timestamp: .hoursAgo(3), isFromMe: true, status: .read),
            Message(content: "Thanks for the code review!", timestamp: .hoursAgo(3), isFromMe: false, status: .read),
        ]
    ),
    Conversation(
        name: "Mom",
        avatar: "heart.circle.fill",
        lastMessage: "Don't forget dinner Sunday! 🍝",
        timestamp: .daysAgo(1),
        unreadCount: 1,
        isOnline: false,
        messages: [
            Message(content: "Hi sweetie, how's work?", timestamp: .daysAgo(2), isFromMe: false, status: .read),
            Message(content: "Good! Busy with the new project", timestamp: .daysAgo(2), isFromMe: true, status: .read),
            Message(content: "Don't forget dinner Sunday! 🍝", timestamp: .daysAgo(1), isFromMe: false, status: .delivered),
        ]
    ),
]
