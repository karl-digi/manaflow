import { describe, expect, it } from "vitest";
import {
  parseCodexAuthJson,
  isCodexTokenExpired,
  isCodexTokenExpiring,
  getCodexTokenExpiresAtMs,
  CODEX_OAUTH_TOKEN_ENDPOINT,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_SCOPE,
  type CodexAuthJson,
} from "./codex-token";

function makeAuth(overrides: Partial<CodexAuthJson> = {}): CodexAuthJson {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    id_token: "test-id-token",
    account_id: "acc_123",
    email: "test@example.com",
    expired: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    last_refresh: Math.floor(Date.now() / 1000),
    type: "codex",
    ...overrides,
  };
}

describe("parseCodexAuthJson", () => {
  it("parses valid auth JSON", () => {
    const auth = makeAuth();
    const result = parseCodexAuthJson(JSON.stringify(auth));
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe("test-access-token");
    expect(result?.refresh_token).toBe("test-refresh-token");
  });

  it("returns null for invalid JSON", () => {
    expect(parseCodexAuthJson("not-json")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(parseCodexAuthJson(JSON.stringify({ access_token: "x" }))).toBeNull();
  });

  it("accepts minimal valid structure", () => {
    const minimal = { access_token: "a", refresh_token: "r" };
    const result = parseCodexAuthJson(JSON.stringify(minimal));
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe("a");
    expect(result?.refresh_token).toBe("r");
    expect(result?.expired).toBeUndefined();
  });

  it("returns null for empty string", () => {
    expect(parseCodexAuthJson("")).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(parseCodexAuthJson("{}")).toBeNull();
  });

  it("parses nested envelope format (real ~/.codex/auth.json)", () => {
    const envelope = {
      auth_mode: "chatgpt",
      last_refresh: "2026-02-27T10:54:24.071540Z",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: "nested-access",
        refresh_token: "nested-refresh",
        id_token: "nested-id",
        account_id: "acc_nested",
      },
    };
    const result = parseCodexAuthJson(JSON.stringify(envelope));
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe("nested-access");
    expect(result?.refresh_token).toBe("nested-refresh");
    expect(result?.id_token).toBe("nested-id");
    expect(result?.account_id).toBe("acc_nested");
  });

  it("parses nested envelope without optional fields", () => {
    const envelope = {
      tokens: {
        access_token: "min-access",
        refresh_token: "min-refresh",
      },
    };
    const result = parseCodexAuthJson(JSON.stringify(envelope));
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe("min-access");
    expect(result?.refresh_token).toBe("min-refresh");
  });

  it("extracts expired from JWT exp claim in envelope format", () => {
    // Create a JWT with exp=1773212377 (Mar 11, 2026)
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({ exp: 1773212377, iat: 1772348377 }));
    const signature = "test-signature";
    const jwt = `${header}.${payload}.${signature}`;

    const envelope = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: jwt,
        refresh_token: "rt_test",
        id_token: "id_test",
      },
    };
    const result = parseCodexAuthJson(JSON.stringify(envelope));
    expect(result).not.toBeNull();
    expect(result?.expired).toBe(1773212377);
    expect(getCodexTokenExpiresAtMs(result!)).toBe(1773212377000);
  });

  it("handles envelope format with invalid JWT gracefully", () => {
    const envelope = {
      tokens: {
        access_token: "not-a-valid-jwt",
        refresh_token: "rt_test",
      },
    };
    const result = parseCodexAuthJson(JSON.stringify(envelope));
    expect(result).not.toBeNull();
    expect(result?.expired).toBeUndefined();
  });

  it("handles envelope format with JWT missing exp claim", () => {
    const header = btoa(JSON.stringify({ alg: "RS256" }));
    const payload = btoa(JSON.stringify({ iat: 1772348377 })); // no exp
    const jwt = `${header}.${payload}.sig`;

    const envelope = {
      tokens: {
        access_token: jwt,
        refresh_token: "rt_test",
      },
    };
    const result = parseCodexAuthJson(JSON.stringify(envelope));
    expect(result).not.toBeNull();
    expect(result?.expired).toBeUndefined();
  });
});

describe("isCodexTokenExpired", () => {
  it("returns false for future expiry", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) + 7200,
    });
    expect(isCodexTokenExpired(auth)).toBe(false);
  });

  it("returns true for past expiry", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) - 60,
    });
    expect(isCodexTokenExpired(auth)).toBe(true);
  });

  it("returns false when expired field is undefined", () => {
    const auth = makeAuth({ expired: undefined });
    expect(isCodexTokenExpired(auth)).toBe(false);
  });
});

describe("isCodexTokenExpiring", () => {
  it("returns true when token expires within lead time", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    });
    // Default lead time is 24 hours, so 1 hour from now is "expiring"
    expect(isCodexTokenExpiring(auth)).toBe(true);
  });

  it("returns false when token expires well beyond lead time", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) + 48 * 3600, // 48 hours
    });
    expect(isCodexTokenExpiring(auth)).toBe(false);
  });

  it("returns true for already expired tokens", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) - 60,
    });
    expect(isCodexTokenExpiring(auth)).toBe(true);
  });

  it("respects custom lead time", () => {
    const auth = makeAuth({
      expired: Math.floor(Date.now() / 1000) + 600, // 10 minutes from now
    });
    // 5-minute lead time: 10 minutes away is NOT expiring
    expect(isCodexTokenExpiring(auth, 5 * 60 * 1000)).toBe(false);
    // 15-minute lead time: 10 minutes away IS expiring
    expect(isCodexTokenExpiring(auth, 15 * 60 * 1000)).toBe(true);
  });

  it("returns false when expired field is undefined", () => {
    const auth = makeAuth({ expired: undefined });
    expect(isCodexTokenExpiring(auth)).toBe(false);
  });
});

describe("getCodexTokenExpiresAtMs", () => {
  it("converts epoch seconds to milliseconds", () => {
    const epochSec = Math.floor(Date.now() / 1000) + 3600;
    const auth = makeAuth({ expired: epochSec });
    expect(getCodexTokenExpiresAtMs(auth)).toBe(epochSec * 1000);
  });

  it("returns null when expired is undefined", () => {
    const auth = makeAuth({ expired: undefined });
    expect(getCodexTokenExpiresAtMs(auth)).toBeNull();
  });
});

describe("constants", () => {
  it("has correct OAuth endpoint", () => {
    expect(CODEX_OAUTH_TOKEN_ENDPOINT).toBe(
      "https://auth.openai.com/oauth/token"
    );
  });

  it("has correct client ID", () => {
    expect(CODEX_OAUTH_CLIENT_ID).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
  });

  it("has correct scope", () => {
    expect(CODEX_OAUTH_SCOPE).toBe("openid profile email");
  });
});
