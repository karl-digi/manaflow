// Polls Convex every 30 seconds to find and process open issues
import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

let isPolling = false;
let pollInterval: NodeJS.Timeout | null = null;

interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
}

async function processOpenIssues() {
  if (isPolling) {
    console.log("[issue-solver] Already processing, skipping this tick");
    return;
  }

  isPolling = true;

  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      console.log("[issue-solver] NEXT_PUBLIC_CONVEX_URL not set");
      return;
    }

    const convex = new ConvexHttpClient(convexUrl);

    // Get open issues that have GitHub links and repo config
    const openIssues = await convex.query(api.issues.listIssues, {
      status: "open",
      limit: 10,
    });

    // Filter to issues ready for processing (have repo config)
    const readyIssues = openIssues.filter(
      (issue) => issue.githubRepo && issue.gitRemote && issue.gitBranch
    );

    if (readyIssues.length === 0) {
      // No issues to process - this is normal, don't log spam
      return;
    }

    console.log(`[issue-solver] Found ${readyIssues.length} ready issues`);

    // Pick the first one (highest priority)
    const issue = readyIssues[0];

    // Mark issue as in_progress before starting work
    await convex.mutation(api.issues.updateIssue, {
      issueId: issue._id as Id<"issues">,
      status: "in_progress",
    });

    console.log(`[issue-solver] Processing issue ${issue.shortId}: ${issue.title}`);

    // Build the task message for the coding agent
    const taskMessage = `Fix issue ${issue.shortId}: ${issue.title}

${issue.githubIssueUrl ? `GitHub Issue: ${issue.githubIssueUrl}\n\n` : ""}${issue.description || "No description provided."}

Please analyze this issue and implement a fix. When done, create a PR for review.`;

    // Build repo config from issue fields
    const repoConfig: RepoConfig = {
      fullName: issue.githubRepo!,
      gitRemote: issue.gitRemote!,
      branch: issue.gitBranch!,
      installationId: issue.installationId,
    };

    // Create a post for the task
    const postId = await convex.mutation(api.posts.createPost, {
      content: taskMessage,
      author: "User",
    });

    console.log(`[issue-solver] Created post ${postId}, starting workflow`);

    // Start the workflow
    const workflowId = await start(handleReplyToPost, [postId, taskMessage, repoConfig]);

    console.log(`[issue-solver] Started workflow ${workflowId} for issue ${issue.shortId}`);
  } catch (error) {
    console.error("[issue-solver] Error processing issues:", error);
  } finally {
    isPolling = false;
  }
}

export function startIssueSolverPolling() {
  if (pollInterval) {
    console.log("[issue-solver] Polling already started");
    return;
  }

  console.log(`[issue-solver] Starting polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on startup
  processOpenIssues();

  // Then poll every 30 seconds
  pollInterval = setInterval(processOpenIssues, POLL_INTERVAL_MS);
}

export function stopIssueSolverPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[issue-solver] Polling stopped");
  }
}
