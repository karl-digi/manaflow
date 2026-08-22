import { describe, expect, it } from "bun:test";
import {
  DEFAULT_HOOKSCRIPT_VOLUME,
  EXECD_TOKEN_DESCRIPTION_MARKER,
  EXECD_TOKEN_ENV_KEY,
  generateExecdAuthToken,
  isValidExecdAuthToken,
  parseExecdAuthTokenFromConfig,
  upsertDescriptionToken,
  upsertRuntimeEnv,
} from "./execd-auth";

const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("generateExecdAuthToken", () => {
  it("returns 64 lowercase hex characters", () => {
    const token = generateExecdAuthToken();
    expect(token).toHaveLength(64);
    expect(isValidExecdAuthToken(token)).toBe(true);
  });

  it("returns a different token on each call", () => {
    expect(generateExecdAuthToken()).not.toBe(generateExecdAuthToken());
  });
});

describe("upsertRuntimeEnv", () => {
  it("appends the token when env is empty", () => {
    expect(upsertRuntimeEnv("", TOKEN)).toBe(`${EXECD_TOKEN_ENV_KEY}=${TOKEN}`);
  });

  it("preserves existing entries and replaces every token entry", () => {
    const env = `EXISTING=value\x00${EXECD_TOKEN_ENV_KEY}=old\x00B=2\x00${EXECD_TOKEN_ENV_KEY}=older`;
    expect(upsertRuntimeEnv(env, TOKEN)).toBe(
      `EXISTING=value\x00B=2\x00${EXECD_TOKEN_ENV_KEY}=${TOKEN}`,
    );
  });

  it("does not treat a similarly prefixed key as the token entry", () => {
    const env = `${EXECD_TOKEN_ENV_KEY}_EXTRA=x\x00${EXECD_TOKEN_ENV_KEY}=old`;
    expect(upsertRuntimeEnv(env, TOKEN)).toBe(
      `${EXECD_TOKEN_ENV_KEY}_EXTRA=x\x00${EXECD_TOKEN_ENV_KEY}=${TOKEN}`,
    );
  });
});

describe("upsertDescriptionToken", () => {
  it("appends a marker line to an existing description", () => {
    expect(upsertDescriptionToken("cmux template snapshot", TOKEN)).toBe(
      `cmux template snapshot\n${EXECD_TOKEN_DESCRIPTION_MARKER}${TOKEN}`,
    );
  });

  it("replaces every existing marker line", () => {
    const desc = `keep me\n${EXECD_TOKEN_DESCRIPTION_MARKER}${OTHER}\nstill here`;
    expect(upsertDescriptionToken(desc, TOKEN)).toBe(
      `keep me\nstill here\n${EXECD_TOKEN_DESCRIPTION_MARKER}${TOKEN}`,
    );
  });
});

describe("parseExecdAuthTokenFromConfig", () => {
  it("prefers the runtime env token over the description marker", () => {
    expect(
      parseExecdAuthTokenFromConfig({
        env: `EXISTING=value\x00${EXECD_TOKEN_ENV_KEY}=${TOKEN}`,
        description: `${EXECD_TOKEN_DESCRIPTION_MARKER}${OTHER}`,
        hookscript: DEFAULT_HOOKSCRIPT_VOLUME,
      }),
    ).toBe(TOKEN);
  });

  it("falls back to the description marker", () => {
    expect(
      parseExecdAuthTokenFromConfig({
        description: `cmux template snapshot\n${EXECD_TOKEN_DESCRIPTION_MARKER}${TOKEN}`,
      }),
    ).toBe(TOKEN);
  });

  it("returns undefined when no valid token is present", () => {
    expect(
      parseExecdAuthTokenFromConfig({
        description: "cmux template snapshot",
        env: "EXISTING=value",
      }),
    ).toBeUndefined();
  });
});
