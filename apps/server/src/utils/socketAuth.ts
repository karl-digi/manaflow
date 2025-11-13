function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SocketAuthContext {
  accessToken?: string;
  authHeaderJson?: string;
}

export function parseAccessTokenFromHeaderJson(headerJson: string): string | undefined {
  try {
    const parsed = JSON.parse(headerJson);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const camel = parsed["accessToken"];
    if (typeof camel === "string" && camel.length > 0) {
      return camel;
    }
    const snake = parsed["access_token"];
    if (typeof snake === "string" && snake.length > 0) {
      return snake;
    }
  } catch {
    // Ignore parse errors; caller will fall back to other auth sources.
  }
  return undefined;
}

export function extractAuthContextFromPayload(
  payload: unknown
): SocketAuthContext | null {
  if (!isRecord(payload)) {
    return null;
  }
  const auth = payload.auth;
  if (!isRecord(auth)) {
    return null;
  }
  const headerJson = auth["x-stack-auth"];
  if (typeof headerJson !== "string" || headerJson.length === 0) {
    return null;
  }
  const accessToken = parseAccessTokenFromHeaderJson(headerJson);
  return {
    accessToken,
    authHeaderJson: headerJson,
  };
}
