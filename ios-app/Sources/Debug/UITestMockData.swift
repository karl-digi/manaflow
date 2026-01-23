import Foundation
import ConvexMobile

enum UITestMockData {
    static func conversations() -> [ConvexConversation] {
        let now = Date().timeIntervalSince1970 * 1000
        let earlier = now - 90_000
        let teamId = "uitest_team"

        let claude = makeConversation(
            id: "uitest_conversation_claude",
            title: "Claude",
            providerId: "claude",
            previewText: "Mocked conversation for UI tests.",
            teamId: teamId,
            createdAt: earlier,
            updatedAt: now
        )

        let alex = makeConversation(
            id: "uitest_conversation_alex",
            title: "Alex Rivera",
            providerId: "codex",
            previewText: "Short thread layout fixture.",
            teamId: teamId,
            createdAt: earlier - 90_000,
            updatedAt: earlier
        )

        return [claude, alex]
    }

    static func messages(for conversationId: String) -> [ConvexMessage] {
        let now = Date().timeIntervalSince1970 * 1000
        let earlier = now - 60_000
        let first = earlier - 30_000
        let idPrefix = conversationId.replacingOccurrences(of: "uitest_conversation_", with: "uitest_msg_")
        if let messageCount = messageCountOverride(), messageCount > 3 {
            let startWithAssistant = startWithAssistant(messageCount: messageCount)
            let baseTime = now - Double(messageCount) * 900
            return (0..<messageCount).map { index in
                let isAssistant = startWithAssistant ? index % 2 == 0 : index % 2 == 1
                let role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum = isAssistant ? .assistant : .user
                let text = isAssistant ? "Assistant message \(index + 1)" : "User message \(index + 1)"
                let createdAt = baseTime + Double(index) * 900
                return makeMessage(
                    id: "\(idPrefix)_\(index + 1)",
                    conversationId: conversationId,
                    role: role,
                    text: text,
                    createdAt: createdAt
                )
            }
        }

        let messages: [(String, ConversationMessagesListByConversationReturnMessagesItemRoleEnum, String, Double)] = [
            ("\(idPrefix)_1", .assistant, "Here’s a quick plan for the task.", first),
            ("\(idPrefix)_2", .user, "Sounds good—can you expand?", earlier),
            ("\(idPrefix)_3", .assistant, "Absolutely. I’ll outline the steps and edge cases.", now)
        ]

        return messages.map { entry in
            makeMessage(
                id: entry.0,
                conversationId: conversationId,
                role: entry.1,
                text: entry.2,
                createdAt: entry.3
            )
        }
    }

    private static func messageCountOverride() -> Int? {
        guard let raw = ProcessInfo.processInfo.environment["CMUX_UITEST_MESSAGE_COUNT"],
              let count = Int(raw) else {
            return nil
        }
        return max(3, min(200, count))
    }

    private static func startWithAssistant(messageCount: Int) -> Bool {
        guard let raw = ProcessInfo.processInfo.environment["CMUX_UITEST_ENDS_WITH_USER"] else {
            return messageCount % 2 == 1
        }
        let lower = raw.lowercased()
        let endsWithUser = lower == "1" || lower == "true"
        if endsWithUser {
            return messageCount % 2 == 0
        }
        return messageCount % 2 == 1
    }

    private static func makeConversation(
        id: String,
        title: String,
        providerId: String,
        previewText: String,
        teamId: String,
        createdAt: Double,
        updatedAt: Double
    ) -> ConvexConversation {
        let conversation = ConversationsListPagedWithLatestReturnPageItemConversation(
            _id: ConvexId(rawValue: id),
            _creationTime: createdAt,
            userId: "uitest_user",
            isArchived: false,
            pinned: false,
            sandboxInstanceId: nil,
            title: title,
            clientConversationId: nil,
            modelId: nil,
            permissionMode: nil,
            stopReason: nil,
            namespaceId: nil,
            isolationMode: .none,
            modes: nil,
            agentInfo: nil,
            acpSandboxId: nil,
            initializedOnSandbox: true,
            lastMessageAt: updatedAt,
            lastAssistantVisibleAt: nil,
            teamId: teamId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            status: .active,
            sessionId: "session_\(id)",
            providerId: providerId,
            cwd: "/workspace"
        )

        let preview = ConversationsListPagedWithLatestReturnPageItemPreview(
            text: previewText,
            kind: .text
        )

        return ConversationsListPagedWithLatestReturnPageItem(
            conversation: conversation,
            preview: preview,
            unread: false,
            lastReadAt: nil,
            latestMessageAt: updatedAt,
            title: title
        )
    }

    private static func makeMessage(
        id: String,
        conversationId: String,
        role: ConversationMessagesListByConversationReturnMessagesItemRoleEnum,
        text: String,
        createdAt: Double
    ) -> ConvexMessage {
        let content = ConversationMessagesListByConversationReturnMessagesItemContentItem(
            name: nil,
            text: text,
            description: nil,
            mimeType: nil,
            title: nil,
            resource: nil,
            data: nil,
            uri: nil,
            size: nil,
            annotations: nil,
            type: .text
        )

        return ConversationMessagesListByConversationReturnMessagesItem(
            _id: ConvexId(rawValue: id),
            _creationTime: createdAt,
            clientMessageId: nil,
            deliveryStatus: .sent,
            deliveryError: nil,
            deliverySwapAttempted: nil,
            toolCalls: nil,
            reasoning: nil,
            acpSeq: nil,
            createdAt: createdAt,
            role: role,
            content: [content],
            conversationId: ConvexId(rawValue: conversationId)
        )
    }
}
