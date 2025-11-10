import {
  CONNECT_GITHUB_ACTION,
  DEFAULT_GITHUB_CONNECT_MESSAGE,
  type GithubCredentialErrorCode,
} from "@cmux/shared";

type GithubAccessTokenErrorMessage =
  | "GitHub account not found"
  | "GitHub access token not found";

const MESSAGE_BY_CODE: Record<GithubCredentialErrorCode, string> = {
  GITHUB_ACCOUNT_MISSING:
    "Connect your GitHub account to cmux so we can access your repositories.",
  GITHUB_TOKEN_MISSING:
    "Reconnect your GitHub account to refresh the access token cmux uses.",
};

export function buildGithubCredentialErrorResponse(
  reason: GithubAccessTokenErrorMessage | string,
) {
  const code: GithubCredentialErrorCode =
    reason === "GitHub account not found"
      ? "GITHUB_ACCOUNT_MISSING"
      : "GITHUB_TOKEN_MISSING";

  return {
    code,
    action: CONNECT_GITHUB_ACTION,
    message: MESSAGE_BY_CODE[code] ?? DEFAULT_GITHUB_CONNECT_MESSAGE,
    reason,
  };
}
