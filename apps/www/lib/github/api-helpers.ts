import { GithubApiError } from "./errors";

export type RequestErrorShape = {
  status?: number;
  message?: string;
  documentation_url?: string;
};

export function isRequestErrorShape(error: unknown): error is RequestErrorShape {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeShape = error as Record<string, unknown>;
  return (
    "status" in maybeShape ||
    "message" in maybeShape ||
    "documentation_url" in maybeShape
  );
}

export function toGithubApiError(error: unknown): GithubApiError {
  if (error instanceof GithubApiError) {
    return error;
  }

  if (isRequestErrorShape(error)) {
    const status = typeof error.status === "number" ? error.status : 500;
    const message =
      typeof error.message === "string"
        ? error.message
        : "Unexpected GitHub API error";
    const documentationUrl =
      typeof error.documentation_url === "string"
        ? error.documentation_url
        : undefined;

    return new GithubApiError(message, { status, documentationUrl });
  }

  return new GithubApiError("Unexpected GitHub API error", {
    status: 500,
  });
}

export function buildAuthCandidates(
  token: string | null | undefined,
): (string | undefined)[] {
  const candidates: (string | undefined)[] = [];
  if (typeof token === "string" && token.trim().length > 0) {
    candidates.push(token);
  }
  candidates.push(undefined);
  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex((value) => value === candidate) === index,
  );
}

export function shouldRetryWithAlternateAuth(error: unknown): boolean {
  if (!isRequestErrorShape(error)) {
    return false;
  }

  return [401, 403, 404].includes(error.status ?? 0);
}
