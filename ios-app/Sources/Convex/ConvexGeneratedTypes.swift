import Foundation

// Convenience aliases for generated Convex API types

typealias ConversationsPage = ConversationsListPagedWithLatestReturn
typealias ConvexConversation = ConversationsListPagedWithLatestReturnPageItem
typealias MessagesPage = ConversationMessagesListByConversationReturn
typealias ConvexMessage = ConversationMessagesListByConversationReturnMessagesItem
typealias ConvexContentBlock = ConversationMessagesListByConversationReturnMessagesItemContentItem
typealias ConvexToolCall = ConversationMessagesListByConversationReturnMessagesItemToolCallsItem

extension ConversationsListPagedWithLatestReturnPageItem: Identifiable {
    var id: String { conversation._id.rawValue }
}

extension ConversationsListPagedWithLatestReturnPageItem {
    var _id: ConvexId<ConvexTableConversations> { conversation._id }
    var providerId: String { conversation.providerId }
    var cwd: String { conversation.cwd }
    var status: ConversationsListPagedWithLatestReturnPageItemConversationStatusEnum { conversation.status }
    var lastMessageAt: Double? { conversation.lastMessageAt }
    var updatedAt: Double { conversation.updatedAt }
    var createdAt: Double { conversation.createdAt }

    /// Display name for the conversation - uses title if available, otherwise falls back to provider name
    var displayName: String {
        if let title, !title.isEmpty {
            return title
        }
        if let conversationTitle = conversation.title, !conversationTitle.isEmpty {
            return conversationTitle
        }
        return providerDisplayName
    }

    var providerDisplayName: String {
        switch providerId {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "gemini": return "Gemini"
        case "opencode": return "OpenCode"
        default: return providerId.capitalized
        }
    }

    var providerIcon: String {
        switch providerId {
        case "claude": return "brain.head.profile"
        case "codex": return "chevron.left.forwardslash.chevron.right"
        case "gemini": return "sparkles"
        case "opencode": return "terminal"
        default: return "cpu"
        }
    }

    var displayTimestamp: Date {
        let timestamp = latestMessageAt
        return Date(timeIntervalSince1970: timestamp / 1000)
    }

    var previewSubtitle: String {
        if let text = preview.text, !text.isEmpty {
            return text
        }
        switch preview.kind {
        case .image:
            return "image"
        case .resource:
            return "attachment"
        case .text, .empty:
            return "no messages yet"
        }
    }

    var isActive: Bool {
        status == .active
    }
}

extension ConversationsListPagedWithLatestReturnPageItemConversation {
    func updating(pinned: Bool? = nil, isArchived: Bool? = nil) -> Self {
        ConversationsListPagedWithLatestReturnPageItemConversation(
            _id: _id,
            _creationTime: _creationTime,
            userId: userId,
            isArchived: isArchived ?? self.isArchived,
            pinned: pinned ?? self.pinned,
            sandboxInstanceId: sandboxInstanceId,
            title: title,
            clientConversationId: clientConversationId,
            modelId: modelId,
            permissionMode: permissionMode,
            stopReason: stopReason,
            namespaceId: namespaceId,
            isolationMode: isolationMode,
            modes: modes,
            agentInfo: agentInfo,
            acpSandboxId: acpSandboxId,
            initializedOnSandbox: initializedOnSandbox,
            lastMessageAt: lastMessageAt,
            lastAssistantVisibleAt: lastAssistantVisibleAt,
            teamId: teamId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            status: status,
            sessionId: sessionId,
            providerId: providerId,
            cwd: cwd
        )
    }
}

extension ConversationsListPagedWithLatestReturnPageItem {
    func updating(
        conversation: ConversationsListPagedWithLatestReturnPageItemConversation? = nil,
        unread: Bool? = nil,
        lastReadAt: Double? = nil
    ) -> Self {
        ConversationsListPagedWithLatestReturnPageItem(
            conversation: conversation ?? self.conversation,
            preview: preview,
            unread: unread ?? self.unread,
            lastReadAt: lastReadAt ?? self.lastReadAt,
            latestMessageAt: latestMessageAt,
            title: title
        )
    }
}

extension ConversationMessagesListByConversationReturnMessagesItem: Identifiable {
    var id: String { _id.rawValue }
}

extension ConversationMessagesListByConversationReturnMessagesItem {
    var isFromUser: Bool {
        role == .user
    }

    var hasUserVisibleContent: Bool {
        for block in content {
            switch block.type {
            case .text:
                if let text = block.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return true
                }
            case .image, .audio, .resourceLink, .resource:
                return true
            }
        }
        return false
    }

    var isUnreadCandidate: Bool {
        role == .assistant && hasUserVisibleContent
    }

    var textContent: String {
        content
            .filter { $0.type == .text }
            .compactMap { $0.text }
            .joined(separator: "\n")
    }

    var displayTimestamp: Date {
        let timestamp = createdAt
        return Date(timeIntervalSince1970: timestamp / 1000)
    }
}
