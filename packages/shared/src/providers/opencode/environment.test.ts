import { describe, expect, it } from "vitest";
import { getOpencodeEnvironment } from "./environment";

const BASE_CONTEXT = {
  taskRunId: "run_test",
  prompt: "test prompt",
  taskRunJwt: "jwt_test",
  callbackUrl: "http://localhost:9779",
};

type OpencodeConfig = {
  mcp: Record<
    string,
    {
      type: "local" | "remote";
      command?: string[];
      url?: string;
      headers?: Record<string, string>;
      environment?: Record<string, string>;
      enabled: boolean;
    }
  >;
};

async function decodeOpencodeConfig(args?: {
  agentName?: string;
  mcpServerConfigs?: Array<
    | {
        name: string;
        type: "stdio";
        command: string;
        args: string[];
        envVars?: Record<string, string>;
      }
    | {
        name: string;
        type: "http" | "sse";
        url: string;
        headers?: Record<string, string>;
        envVars?: Record<string, string>;
      }
  >;
}) {
  const result = await getOpencodeEnvironment({
    ...BASE_CONTEXT,
    ...args,
  });
  const configFile = result.files.find(
    (file) => file.destinationPath === "$HOME/.config/opencode/opencode.json",
  );
  expect(configFile).toBeDefined();
  return JSON.parse(
    Buffer.from(configFile!.contentBase64, "base64").toString("utf-8"),
  ) as OpencodeConfig;
}

describe("getOpencodeEnvironment", () => {
  it("includes managed devsh-memory MCP when no custom servers are configured", async () => {
    const config = await decodeOpencodeConfig();

    expect(config.mcp["devsh-memory"]).toEqual({
      type: "local",
      command: ["npx", "-y", "devsh-memory-mcp@latest"],
      enabled: true,
    });
  });

  it("includes --agent in managed devsh-memory MCP args when agentName is provided", async () => {
    const config = await decodeOpencodeConfig({
      agentName: "opencode/sonnet-4",
    });

    expect(config.mcp["devsh-memory"]).toEqual({
      type: "local",
      command: ["npx", "-y", "devsh-memory-mcp@latest", "--agent", "opencode/sonnet-4"],
      enabled: true,
    });
  });

  it("merges custom MCP servers with managed devsh-memory", async () => {
    const config = await decodeOpencodeConfig({
      agentName: "opencode/sonnet-4",
      mcpServerConfigs: [
        {
          name: "context7",
          type: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          envVars: {
            CONTEXT7_API_KEY: "token",
          },
        },
        {
          name: "remote-api",
          type: "http",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer secret",
          },
          envVars: {
            MCP_SESSION: "session-token",
          },
        },
      ],
    });

    expect(config.mcp.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp@latest"],
      enabled: true,
      environment: {
        CONTEXT7_API_KEY: "token",
      },
    });
    expect(config.mcp["remote-api"]).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer secret",
      },
      enabled: true,
      environment: {
        MCP_SESSION: "session-token",
      },
    });
    expect(config.mcp["devsh-memory"]).toEqual({
      type: "local",
      command: ["npx", "-y", "devsh-memory-mcp@latest", "--agent", "opencode/sonnet-4"],
      enabled: true,
    });
  });
});
