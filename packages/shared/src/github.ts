export const CONNECT_GITHUB_ACTION = "connect_github" as const;

export type GithubCredentialErrorCode =
  | "GITHUB_ACCOUNT_MISSING"
  | "GITHUB_TOKEN_MISSING";

export const GITHUB_CREDENTIALS_REQUIRED_MARKER =
  "[GITHUB_CREDENTIALS_REQUIRED]" as const;

export const DEFAULT_GITHUB_CONNECT_MESSAGE =
  "Connect your GitHub account to cmux so we can access your repositories.";
