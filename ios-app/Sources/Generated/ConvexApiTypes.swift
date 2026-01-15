import ConvexMobile
import Foundation

// Generated from /Users/lawrencechen/fun/cmux-wt-swift-autogen/packages/convex/convex/_generated/api.d.ts

// Functions: tasks.get

enum TasksGetItemCrownEvaluationStatusEnum: String, Decodable {
  case pending = "pending"
  case inProgress = "in_progress"
  case succeeded = "succeeded"
  case error = "error"
}

enum TasksGetItemMergeStatusEnum: String, Decodable {
  case none = "none"
  case prDraft = "pr_draft"
  case prOpen = "pr_open"
  case prApproved = "pr_approved"
  case prChangesRequested = "pr_changes_requested"
  case prMerged = "pr_merged"
  case prClosed = "pr_closed"
}

enum TasksGetItemScreenshotStatusEnum: String, Decodable {
  case pending = "pending"
  case running = "running"
  case completed = "completed"
  case failed = "failed"
  case skipped = "skipped"
}

struct TasksGetItemImagesItem: Decodable {
  let fileName: String?
  let storageId: String
  let altText: String
}

struct TasksGetItem: Decodable {
  let hasUnread: Bool
  let _id: String
  @ConvexFloat var _creationTime: Double
  @OptionalConvexFloat var createdAt: Double?
  @OptionalConvexFloat var updatedAt: Double?
  let isArchived: Bool?
  let pinned: Bool?
  let isPreview: Bool?
  let isLocalWorkspace: Bool?
  let isCloudWorkspace: Bool?
  let description: String?
  let pullRequestTitle: String?
  let pullRequestDescription: String?
  let projectFullName: String?
  let baseBranch: String?
  let worktreePath: String?
  let generatedBranchName: String?
  @OptionalConvexFloat var lastActivityAt: Double?
  let environmentId: String?
  let crownEvaluationStatus: TasksGetItemCrownEvaluationStatusEnum?
  let crownEvaluationError: String?
  let mergeStatus: TasksGetItemMergeStatusEnum?
  let images: [TasksGetItemImagesItem]?
  let screenshotStatus: TasksGetItemScreenshotStatusEnum?
  let screenshotRunId: String?
  let screenshotRequestId: String?
  @OptionalConvexFloat var screenshotRequestedAt: Double?
  @OptionalConvexFloat var screenshotCompletedAt: Double?
  let screenshotError: String?
  let screenshotStorageId: String?
  let screenshotMimeType: String?
  let screenshotFileName: String?
  let screenshotCommitSha: String?
  let latestScreenshotSetId: String?
  let teamId: String
  let userId: String
  let text: String
  let isCompleted: Bool
}

struct TasksGetArgs {
  let projectFullName: String?
  let archived: Bool?
  let excludeLocalWorkspaces: Bool?
  let teamSlugOrId: String

  func asDictionary() -> [String: Any] {
    var result: [String: Any] = [:]
    if let value = projectFullName { result["projectFullName"] = value }
    if let value = archived { result["archived"] = value }
    if let value = excludeLocalWorkspaces { result["excludeLocalWorkspaces"] = value }
    result["teamSlugOrId"] = teamSlugOrId
    return result
  }
}

typealias TasksGetReturn = [TasksGetItem]
