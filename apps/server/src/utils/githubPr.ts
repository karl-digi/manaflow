import { markPrReady as markPrReadyImpl } from "./markPrReady";
import { getOctokit } from "./octokit";

export type PrBasic = {
  number: number;
  html_url: string;
  state: string; // "open" | "closed"
  draft?: boolean;
};

export type PrDetail = {
  number: number;
  html_url: string;
  state: string;
  draft?: boolean;
  merged_at: string | null;
  node_id: string;
  mergeable: boolean | null;
  mergeable_state: string;
};

export function parseRepoFromUrl(url: string): {
  owner?: string;
  repo?: string;
  number?: number;
} {
  const m = url.match(/github\.com\/(.*?)\/(.*?)\/pull\/(\d+)/i);
  if (!m) return {};
  return {
    owner: m[1],
    repo: m[2],
    number: parseInt(m[3] || "", 10) || undefined,
  };
}

export async function fetchPrByHead(
  token: string,
  owner: string,
  repo: string,
  headOwner: string,
  branchName: string
): Promise<PrBasic | null> {
  const octokit = getOctokit(token);
  const head = `${headOwner}:${branchName}`;
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "all",
    head,
    per_page: 10,
  });
  if (!Array.isArray(data) || data.length === 0) return null;
  const pr = data[0];
  return {
    number: pr.number,
    html_url: pr.html_url,
    state: pr.state,
    draft: pr.draft ?? undefined,
  };
}

export async function fetchPrDetail(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<PrDetail> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: number,
  });
  return {
    number: data.number,
    html_url: data.html_url,
    state: data.state,
    draft: data.draft ?? undefined,
    merged_at: data.merged_at,
    node_id: data.node_id,
    mergeable: data.mergeable,
    mergeable_state: data.mergeable_state,
  };
}

export async function createReadyPr(
  token: string,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body: string
): Promise<PrBasic> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
    draft: false,
  });
  return {
    number: data.number,
    html_url: data.html_url,
    state: data.state,
    draft: data.draft ?? undefined,
  };
}

export async function createDraftPr(
  token: string,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body: string
): Promise<PrBasic> {
  const octokit = getOctokit(token);
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
    draft: true,
  });
  return {
    number: data.number,
    html_url: data.html_url,
    state: data.state,
    draft: data.draft ?? undefined,
  };
}

// Re-export markPrReady but maintain backward compatibility with the void return type
export async function markPrReady(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<void> {
  const result = await markPrReadyImpl(token, owner, repo, number);
  if (!result.success) {
    throw new Error(result.error || "Failed to mark PR as ready");
  }
}

export async function reopenPr(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<void> {
  const octokit = getOctokit(token);
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: number,
    state: "open",
  });
}

export function validatePrMergeability(detail: PrDetail): void {
  // Check if PR has merge conflicts or other blocking issues
  // mergeable can be null if GitHub is still calculating, false if conflicts exist, true if mergeable
  if (detail.mergeable === false) {
    throw new Error("Pull request has merge conflicts that must be resolved before merging");
  }

  // mergeable_state provides more specific information about why a PR cannot be merged
  // Common states: clean, dirty (conflicts), unstable (failing checks), blocked, behind, draft, unknown
  if (detail.mergeable_state === "dirty") {
    throw new Error("Pull request has merge conflicts that must be resolved before merging");
  }

  if (detail.mergeable_state === "blocked") {
    throw new Error("Pull request is blocked by required status checks, reviews, or branch protection rules");
  }

  // Note: We allow "behind" state as it can still be merged if there are no conflicts
  // GitHub will automatically merge or update as needed
}

export async function mergePr(
  token: string,
  owner: string,
  repo: string,
  number: number,
  method: "squash" | "rebase" | "merge",
  commitTitle?: string,
  commitMessage?: string
): Promise<{
  merged: boolean;
  sha?: string;
  message?: string;
  html_url?: string;
}> {
  // Fetch PR details to check mergeability before attempting merge
  const prDetail = await fetchPrDetail(token, owner, repo, number);

  // Validate that the PR can be merged (no conflicts, not blocked, etc.)
  validatePrMergeability(prDetail);

  const octokit = getOctokit(token);
  const { data } = await octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number: number,
    merge_method: method,
    commit_title: commitTitle,
    commit_message: commitMessage,
  });
  return {
    merged: data.merged ?? false,
    sha: data.sha,
    message: data.message,
    html_url: (data as unknown as { html_url?: string }).html_url,
  };
}
