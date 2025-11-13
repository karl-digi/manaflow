import { serverLogger } from "./fileLogger";
import { getOctokit } from "./octokit";

export async function markPrReady(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<{ success: boolean; error?: string }> {
  const octokit = getOctokit(token);

  try {
    // First, check if the PR exists and get its current state
    const prCheck = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });

    // Check if PR is already ready (not a draft)
    if (!prCheck.data.draft) {
      serverLogger.info(
        `[markPrReady] PR #${number} is already ready for review`
      );
      return { success: true };
    }

    // Mark the draft PR as ready for review using GraphQL mutation
    // The REST API endpoint seems to have issues, using GraphQL instead
    const mutation = `
      mutation($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            id
            isDraft
          }
        }
      }
    `;

    await octokit.graphql(mutation, {
      pullRequestId: prCheck.data.node_id,
    });

    serverLogger.info(
      `[markPrReady] Successfully marked PR #${number} as ready for review`
    );
    return { success: true };
  } catch (error) {
    let errorMessage = "Unknown error";
    let errorDetails = {};

    if (error instanceof Error) {
      errorMessage = error.message;

      // Extract detailed error information from Octokit errors
      if (
        "response" in error &&
        error.response &&
        typeof error.response === "object"
      ) {
        const response = error.response as {
          status?: number;
          data?: { message?: string; errors?: unknown[] };
          url?: string;
        };

        errorDetails = {
          status: response.status,
          message: response.data?.message,
          errors: response.data?.errors,
          url: response.url,
        };

        if (response.status === 404) {
          errorMessage = `[markPrReady-catch] Pull request #${number} not found in ${owner}/${repo}. The PR may have been deleted or you may not have access.`;
        } else if (response.status === 422) {
          // Check specific 422 error cases
          const dataMessage = response.data?.message || "";
          if (dataMessage.includes("already ready")) {
            serverLogger.info(
              `[markPrReady] PR #${number} is already ready for review (422)`
            );
            return { success: true };
          }
          errorMessage = `Invalid operation: ${dataMessage}`;
        } else if (response.status === 403) {
          errorMessage =
            "Permission denied. Check if the token has proper permissions for this repository.";
        } else if (response.status === 401) {
          errorMessage =
            "Authentication failed. Check if the GitHub token is valid.";
        }
      }

      // Check for GraphQL-specific errors
      if ("errors" in error && Array.isArray(error.errors)) {
        const graphqlErrors = error.errors as Array<{ message?: string }>;
        const messages = graphqlErrors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ");
        if (messages) {
          errorMessage = `GraphQL error: ${messages}`;
        }
      }
    }

    serverLogger.error(`[markPrReady] Failed to mark PR #${number} as ready:`, {
      owner,
      repo,
      number,
      error: errorMessage,
      details: errorDetails,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
