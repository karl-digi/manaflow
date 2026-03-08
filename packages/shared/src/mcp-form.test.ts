import { describe, expect, it } from "vitest";
import {
  EXISTING_SECRET_PLACEHOLDER,
  buildEmptyMcpFormState,
  buildMcpTransportPayload,
  formatMcpEnvVarsText,
  formatMcpHeadersText,
  getScopedMcpProjectFullName,
  isValidMcpProjectFullName,
  parseMcpArgsText,
  parseMcpEnvVarsText,
  parseMcpHeadersText,
} from "./mcp-form";

describe("mcp-form", () => {
  it("builds an empty form state for the selected scope", () => {
    expect(buildEmptyMcpFormState("workspace")).toEqual({
      name: "",
      displayName: "",
      transportType: "stdio",
      command: "",
      argsText: "",
      url: "",
      headersText: "",
      envVarsText: "",
      description: "",
      enabledClaude: true,
      enabledCodex: true,
      enabledGemini: true,
      enabledOpencode: true,
      scope: "workspace",
      projectFullName: "",
    });
  });

  it("formats env vars and headers for form textareas", () => {
    expect(formatMcpEnvVarsText({ TOKEN: "secret" })).toBe("TOKEN=secret");
    expect(formatMcpEnvVarsText({ TOKEN: "secret" }, true)).toBe(
      `TOKEN=${EXISTING_SECRET_PLACEHOLDER}`,
    );
    expect(formatMcpHeadersText({ Authorization: "Bearer token", "X-Test": "test" })).toBe(
      "Authorization: Bearer token\nX-Test: test",
    );
  });

  it("parses args text into a list", () => {
    expect(parseMcpArgsText("-y\n  @upstash/context7-mcp@latest\n\n")).toEqual([
      "-y",
      "@upstash/context7-mcp@latest",
    ]);
  });

  it("parses env vars and preserves values when trimming is disabled", () => {
    expect(
      parseMcpEnvVarsText(`TOKEN=${EXISTING_SECRET_PLACEHOLDER}\nRAW=  padded value  `, {
        placeholderValue: EXISTING_SECRET_PLACEHOLDER,
        trimValue: false,
      }),
    ).toEqual({
      entries: {
        RAW: "  padded value  ",
      },
      hasChanges: true,
    });
  });

  it("parses indented env vars without trimming trailing value whitespace", () => {
    expect(
      parseMcpEnvVarsText("  RAW=  padded value  ", {
        trimValue: false,
      }),
    ).toEqual({
      entries: {
        RAW: "  padded value  ",
      },
      hasChanges: true,
    });
  });

  it("parses headers with colon or equals separators", () => {
    expect(parseMcpHeadersText("Authorization: Bearer token\nX-Test=test")).toEqual({
      entries: {
        Authorization: "Bearer token",
        "X-Test": "test",
      },
      hasChanges: true,
    });
  });

  it("preserves colons inside header values when equals is the separator", () => {
    expect(parseMcpHeadersText("Authorization=Bearer token:with:colon\nX-Test=test")).toEqual({
      entries: {
        Authorization: "Bearer token:with:colon",
        "X-Test": "test",
      },
      hasChanges: true,
    });
  });

  it("builds stdio and remote transport payloads", () => {
    expect(
      buildMcpTransportPayload({
        transportType: "stdio",
        command: " npx ",
        argsText: "-y\ncontext7",
        url: "",
        headersText: "",
      }),
    ).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "context7"],
    });

    expect(
      buildMcpTransportPayload({
        transportType: "http",
        command: "",
        argsText: "",
        url: " https://example.com/mcp ",
        headersText: "Authorization=Bearer token:with:colon",
      }),
    ).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token:with:colon",
      },
    });
  });

  it("validates and scopes workspace project names", () => {
    expect(isValidMcpProjectFullName("owner/repo")).toBe(true);
    expect(isValidMcpProjectFullName("https://github.com/owner/repo")).toBe(false);
    expect(getScopedMcpProjectFullName("global", "owner/repo")).toBeUndefined();
    expect(getScopedMcpProjectFullName("workspace", " owner/repo ")).toBe("owner/repo");
  });
});
