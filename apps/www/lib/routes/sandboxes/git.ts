import { fetchGithubUserInfoForRequest } from "@/lib/utils/githubUserInfo";
import type { SandboxInstance } from "@/lib/utils/sandbox-instance";
import { api } from "@cmux/convex/api";

import type { ConvexClient } from "./snapshot";
import { singleQuote } from "./shell";

type ConnectedAccountUser = {
  getConnectedAccount(
    provider: "github"
  ): Promise<{
    getAccessToken: () => Promise<{ accessToken?: string | null }>;
  } | null>;
} | null;

/**
 * Instance type for sandbox operations.
 * Now uses the unified SandboxInstance interface to support both Morph and PVE LXC.
 */
export type MorphInstance = SandboxInstance;

export const fetchGitIdentityInputs = (
  convex: ConvexClient,
  githubAccessToken: string
) =>
  Promise.all([
    convex.query(api.users.getCurrentBasic, {}),
    fetchGithubUserInfoForRequest(githubAccessToken),
  ] as const);

export const configureGitIdentity = async (
  instance: MorphInstance,
  identity: { name: string; email: string }
) => {
  const gitCfgRes = await instance.exec(
    `bash -lc "git config --global user.name ${singleQuote(identity.name)} && git config --global user.email ${singleQuote(identity.email)} && git config --global init.defaultBranch main && git config --global push.autoSetupRemote true && echo NAME:$(git config --global --get user.name) && echo EMAIL:$(git config --global --get user.email) || true"`
  );
  if (gitCfgRes.exit_code !== 0) {
    console.error(
      `[sandboxes.start] GIT CONFIG: Failed to configure git identity, exit=${gitCfgRes.exit_code}`
    );
  }
};

export const configureGithubAccess = async (
  instance: MorphInstance,
  token: string,
  maxRetries = 5
) => {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Remove entire gh config directory to ensure completely clean state
      // This prevents stale entries from accumulating across refreshes
      // We explicitly set GH_CONFIG_DIR and HOME to ensure gh uses the correct paths
      // regardless of what profile scripts might set (bash -l sources ~/.profile etc.)
      // NOTE: The \\$ escapes are critical - they prevent the outer shell (cmux-execd's bash -c)
      // from expanding variables before bash -l runs. Without this, $GH_CONFIG_DIR expands to empty.
      //
      // We also explicitly configure git's credential helper. We've seen cases where
      // `gh auth setup-git` succeeds but does not persist credential helper config,
      // which breaks non-interactive git operations (e.g. OpenVSCode's git integration).
      const ghAuthRes = await instance.exec(
        `bash -lc "export GH_CONFIG_DIR=/root/.config/gh HOME=/root && rm -rf \\"\\$GH_CONFIG_DIR\\" && mkdir -p \\"\\$GH_CONFIG_DIR\\" && printf %s ${singleQuote(token)} | gh auth login --with-token && gh auth setup-git && git config --global --replace-all credential.helper \\"!\\$(command -v gh) auth git-credential\\" && git config --global --replace-all credential.https://github.com.helper \\"!\\$(command -v gh) auth git-credential\\" && git config --global --replace-all credential.https://gist.github.com.helper \\"!\\$(command -v gh) auth git-credential\\" 2>&1"`
      );

      if (ghAuthRes.exit_code === 0) {
        return;
      }

      const errorMessage =
        ghAuthRes.stderr || ghAuthRes.stdout || "Unknown error";
      const maskedError = errorMessage.replace(/:[^@]*@/g, ":***@");
      lastError = new Error(`GitHub auth failed: ${maskedError.slice(0, 500)}`);

      console.error(
        `[sandboxes.start] GIT AUTH: Attempt ${attempt}/${maxRetries} failed: exit=${ghAuthRes.exit_code} stderr=${maskedError.slice(0, 200)}`
      );

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[sandboxes.start] GIT AUTH: Attempt ${attempt}/${maxRetries} threw error:`,
        error
      );

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    `[sandboxes.start] GIT AUTH: GitHub authentication failed after ${maxRetries} attempts`
  );
  throw new Error(
    `GitHub authentication failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`
  );
};

/**
 * Fetches a fresh GitHub access token for the authenticated user.
 * Shared helper for refreshing GitHub CLI auth inside sandboxes.
 */
export async function getFreshGitHubToken(
  user: ConnectedAccountUser
): Promise<{ token: string } | { error: string; status: 401 }> {
  if (!user) {
    return { error: "Unauthorized", status: 401 };
  }
  const githubAccount = await user.getConnectedAccount("github");
  if (!githubAccount) {
    return { error: "GitHub account not connected", status: 401 };
  }
  const { accessToken: githubAccessToken } =
    await githubAccount.getAccessToken();
  if (!githubAccessToken) {
    return { error: "Failed to get GitHub access token", status: 401 };
  }
  return { token: githubAccessToken };
}
