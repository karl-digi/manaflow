import { describe, expect, it } from "vitest";
import {
  buildEmptyForm,
  buildJsonConfigText,
  parseHeadersText,
  parseJsonConfigText,
  validateForm,
} from "./mcp-form-helpers";

describe("mcp-form-helpers", () => {
  it("builds and parses stdio JSON configs", () => {
    const form = {
      ...buildEmptyForm("global"),
      transportType: "stdio" as const,
      command: "npx",
      argsText: "-y\n@upstash/context7-mcp@latest",
      envVarsText: "CONTEXT7_API_KEY=token",
    };

    const json = buildJsonConfigText(form);
    expect(JSON.parse(json)).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
      env: {
        CONTEXT7_API_KEY: "token",
      },
    });

    expect(parseJsonConfigText(json)).toEqual({
      transportType: "stdio",
      command: "npx",
      argsText: "-y\n@upstash/context7-mcp@latest",
      url: "",
      headersText: "",
      envVarsText: "CONTEXT7_API_KEY=token",
    });
  });

  it("builds and parses remote JSON configs", () => {
    const form = {
      ...buildEmptyForm("global"),
      transportType: "http" as const,
      url: "https://example.com/mcp",
      headersText: "Authorization: Bearer token\nX-Test=test",
      envVarsText: "MCP_TOKEN=secret",
    };

    const json = buildJsonConfigText(form);
    expect(JSON.parse(json)).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token",
        "X-Test": "test",
      },
      env: {
        MCP_TOKEN: "secret",
      },
    });

    expect(parseJsonConfigText(json)).toEqual({
      transportType: "http",
      command: "",
      argsText: "",
      url: "https://example.com/mcp",
      headersText: "Authorization: Bearer token\nX-Test: test",
      envVarsText: "MCP_TOKEN=secret",
    });
  });

  it("parses headers with colon or equals separators", () => {
    expect(parseHeadersText("Authorization: Bearer token\nX-Test=test")).toEqual({
      headers: {
        Authorization: "Bearer token",
        "X-Test": "test",
      },
    });
  });

  it("preserves colons inside header values when equals is the separator", () => {
    expect(parseHeadersText("Authorization=Bearer token:with:colon\nX-Test=test")).toEqual({
      headers: {
        Authorization: "Bearer token:with:colon",
        "X-Test": "test",
      },
    });
  });

  it("validates transport-specific required fields", () => {
    const stdioForm = {
      ...buildEmptyForm("global"),
      name: "context7",
      displayName: "Context7",
      transportType: "stdio" as const,
      enabledClaude: true,
      command: "",
    };
    expect(validateForm(stdioForm)).toBe("Command is required.");

    const remoteForm = {
      ...buildEmptyForm("global"),
      name: "remote-api",
      displayName: "Remote API",
      transportType: "http" as const,
      enabledClaude: true,
      enabledCodex: false,
      enabledGemini: false,
      enabledOpencode: false,
      url: "not-a-url",
    };
    expect(validateForm(remoteForm)).toBe("A valid http or https URL is required.");
  });
});
