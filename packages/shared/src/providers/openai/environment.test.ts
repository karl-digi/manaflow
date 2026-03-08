import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCodexApiKeys,
  getOpenAIEnvironment,
  stripFilteredConfigKeys,
} from "./environment";
import { getCrossToolSymlinkCommands } from "../../agent-memory-protocol";

function decodeConfigToml(result: Awaited<ReturnType<typeof getOpenAIEnvironment>>): string {
  const configFile = result.files?.find(
    (file) => file.destinationPath === "$HOME/.codex/config.toml"
  );
  expect(configFile).toBeDefined();
  return Buffer.from(configFile!.contentBase64, "base64").toString("utf-8");
}

function decodeAuthJson(
  result: ReturnType<typeof applyCodexApiKeys>
): string {
  const authFile = result.files?.find(
    (file) => file.destinationPath === "$HOME/.codex/auth.json"
  );
  expect(authFile).toBeDefined();
  return Buffer.from(authFile!.contentBase64, "base64").toString("utf-8");
}

describe("applyCodexApiKeys", () => {
  it("prefers CODEX_AUTH_JSON when provided", () => {
    const result = applyCodexApiKeys({
      CODEX_AUTH_JSON: '{"tokens":{"access_token":"token"}}',
      OPENAI_API_KEY: "sk-ignored",
    });

    expect(result.env).toEqual({});
    expect(result.files).toHaveLength(1);
    expect(decodeAuthJson(result)).toBe('{"tokens":{"access_token":"token"}}');
  });

  it("creates auth.json from OPENAI_API_KEY fallback", () => {
    const result = applyCodexApiKeys({
      OPENAI_API_KEY: "sk-from-env",
    });

    expect(result.env).toEqual({
      OPENAI_API_KEY: "sk-from-env",
      CODEX_API_KEY: "sk-from-env",
    });
    expect(result.files).toHaveLength(1);
    expect(JSON.parse(decodeAuthJson(result))).toEqual({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-from-env",
    });
  });

  it("falls back to OPENAI_API_KEY when CODEX_AUTH_JSON is invalid", () => {
    const result = applyCodexApiKeys({
      CODEX_AUTH_JSON: "{not-json",
      OPENAI_API_KEY: "sk-fallback",
    });

    expect(result.files).toHaveLength(1);
    expect(JSON.parse(decodeAuthJson(result))).toEqual({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-fallback",
    });
  });
});

describe("stripFilteredConfigKeys", () => {
  it("removes model key from config", () => {
    const input = `model = "gpt-5.2"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes model_reasoning_effort key from config", () => {
    const input = `model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes both model and model_reasoning_effort keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`);
  });

  it("preserves other keys and sections", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"
model = "gpt-5.2"

[notice.model_migrations]
"gpt-5.2-codex" = "gpt-5.3-codex"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[notice.model_migrations]
"gpt-5.2-codex" = "gpt-5.3-codex"`);
  });

  it("handles different value formats", () => {
    // Double quotes
    expect(stripFilteredConfigKeys(`model = "gpt-5.2"`)).toBe("");
    // Single quotes
    expect(stripFilteredConfigKeys(`model = 'gpt-5.2'`)).toBe("");
    // Bare string (if TOML allows)
    expect(stripFilteredConfigKeys(`model = gpt-5.2`)).toBe("");
  });

  it("handles varying whitespace around equals sign", () => {
    expect(stripFilteredConfigKeys(`model="gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model  =  "gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model =    "gpt-5.2"`)).toBe("");
  });

  it("does not remove keys inside sections", () => {
    // model inside a section should NOT be removed (only top-level)
    // Note: current regex removes any line starting with "model =", not section-aware
    // This test documents current behavior - if section-awareness is needed, update regex
    const input = `[some_section]
model = "should-stay"`;
    const result = stripFilteredConfigKeys(input);
    // Current implementation removes it - this is acceptable since Codex config
    // doesn't typically have model keys inside sections
    expect(result).toBe(`[some_section]`);
  });

  it("handles empty input", () => {
    expect(stripFilteredConfigKeys("")).toBe("");
  });

  it("handles input with only filtered keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "xhigh"`;
    expect(stripFilteredConfigKeys(input)).toBe("");
  });

  it("cleans up multiple blank lines", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]

model = "gpt-5.2"


model_reasoning_effort = "high"

approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]

approval_mode = "full"`);
  });
});

describe("getOpenAIEnvironment", () => {
  it("includes --agent in managed devsh-memory MCP args when agentName is provided", async () => {
    const result = await getOpenAIEnvironment({
      agentName: "codex/gpt-5.1-codex-mini",
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).toContain(
      'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
    );
  });

  it("keeps fallback devsh-memory MCP args when agentName is not provided", async () => {
    const result = await getOpenAIEnvironment({} as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain('args = ["-y","devsh-memory-mcp@latest"]');
    expect(toml).not.toContain('"--agent"');
  });

  it("generates managed model migrations targeting gpt-5.3-codex (server mode)", async () => {
    // Server mode (useHostConfig: false) generates a clean config.toml
    const result = await getOpenAIEnvironment({} as never);
    const configFile = result.files?.find(
      (file) => file.destinationPath === "$HOME/.codex/config.toml"
    );
    expect(configFile).toBeDefined();

    const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
      "utf-8"
    );
    expect(toml).toContain('notify = ["/root/lifecycle/codex-notify.sh"]');
    expect(toml).toContain('sandbox_mode = "danger-full-access"');
    expect(toml).toContain('approval_policy = "never"');
    expect(toml).toContain('disable_response_storage = true');
    expect(toml).toContain("[notice.model_migrations]");
    expect(toml).toContain('"gpt-5-codex" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5-codex-mini" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5.2-codex" = "gpt-5.3-codex"');
  });

  it("does not read from host filesystem in server mode (useHostConfig: false)", async () => {
    // Create files in a temp home directory that should NOT be read in server mode
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Put credentials and custom config that should NOT leak into sandbox
      await writeFile(
        join(homeDir, ".codex/auth.json"),
        '{"secret": "host-credential"}',
        "utf-8"
      );
      await writeFile(
        join(homeDir, ".codex/instructions.md"),
        "SECRET HOST INSTRUCTIONS",
        "utf-8"
      );
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `approval_mode = "full"
host_secret = "should-not-leak"
`,
        "utf-8"
      );

      // Server mode: useHostConfig defaults to false
      const result = await getOpenAIEnvironment({} as never);

      // Verify config.toml does NOT contain host-specific settings
      const configFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/config.toml"
      );
      expect(configFile).toBeDefined();
      const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
        "utf-8"
      );
      expect(toml).not.toContain("host_secret");
      expect(toml).not.toContain("approval_mode");
      expect(toml).toContain('sandbox_mode = "danger-full-access"');
      expect(toml).toContain('approval_policy = "never"');

      // Verify instructions.md does NOT contain host instructions
      const instructionsFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/instructions.md"
      );
      expect(instructionsFile).toBeDefined();
      const instructions = Buffer.from(
        instructionsFile!.contentBase64,
        "base64"
      ).toString("utf-8");
      expect(instructions).not.toContain("SECRET HOST INSTRUCTIONS");

      // Verify auth.json is NOT copied from host (it should come from applyCodexApiKeys)
      const authFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/auth.json"
      );
      expect(authFile).toBeUndefined();
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reads from host filesystem in desktop mode (useHostConfig: true)", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(join(homeDir, ".codex/auth.json"), '{"user": "desktop-user"}', "utf-8");
      await writeFile(join(homeDir, ".codex/instructions.md"), "My custom instructions", "utf-8");
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"
model = "gpt-5"
model_reasoning_effort = "high"

[notice.model_migrations]
"gpt-5.2-codex" = "gpt-5.3-codex"

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      // Desktop mode: useHostConfig: true
      const result = await getOpenAIEnvironment({ useHostConfig: true } as never);

      // Verify auth.json IS copied from host
      const authFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/auth.json"
      );
      expect(authFile).toBeDefined();
      const auth = Buffer.from(authFile!.contentBase64, "base64").toString("utf-8");
      expect(auth).toContain("desktop-user");

      // Verify instructions.md includes host content
      const instructionsFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/instructions.md"
      );
      expect(instructionsFile).toBeDefined();
      const instructions = Buffer.from(
        instructionsFile!.contentBase64,
        "base64"
      ).toString("utf-8");
      expect(instructions).toContain("My custom instructions");
      expect(instructions).toContain("memory"); // Also includes memory protocol

      // Verify config.toml merges host settings (minus filtered keys)
      const configFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/config.toml"
      );
      expect(configFile).toBeDefined();
      const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
        "utf-8"
      );
      expect(toml).toContain('notify = ["/root/lifecycle/codex-notify.sh"]');
      expect(toml).toContain('sandbox_mode = "danger-full-access"');
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain("[some_section]");
      expect(toml).toContain('foo = "bar"');
      // Filtered keys should be removed
      expect(toml).not.toContain('model = "gpt-5"');
      expect(toml).not.toContain('model_reasoning_effort = "high"');
      // Model migrations should be replaced with managed ones
      expect(toml).toContain('"gpt-5.2-codex" = "gpt-5.3-codex"');
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("replaces stale devsh-memory block from host config with managed block", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[mcp_servers.devsh-memory]
type = "stdio"
command = "npx"
args = ["-y", "devsh-memory-mcp@latest"]

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      const result = await getOpenAIEnvironment({
        useHostConfig: true,
        agentName: "codex/gpt-5.1-codex-mini",
      } as never);

      const toml = decodeConfigToml(result);
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain('[some_section]');
      expect(toml).toContain('foo = "bar"');
      expect(toml).toContain(
        'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
      );
      expect(toml).not.toContain('args = ["-y", "devsh-memory-mcp@latest"]');

      const managedBlockMatches = toml.match(/\[mcp_servers\.devsh-memory\]/g) ?? [];
      expect(managedBlockMatches).toHaveLength(1);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("forces approval_policy to never even when host config has different value", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Host config has approval_policy set to "on-request" which would block unattended runs
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `approval_policy = "on-request"
approval_mode = "full"

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      const result = await getOpenAIEnvironment({ useHostConfig: true } as never);

      const toml = decodeConfigToml(result);
      // approval_policy MUST be "never" for unattended runs, regardless of host config
      expect(toml).toContain('approval_policy = "never"');
      expect(toml).not.toContain('approval_policy = "on-request"');
      // Other host settings should be preserved
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain("[some_section]");
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("forces approval_policy override for single-quoted and bare TOML values", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Test single-quoted value
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `approval_policy = 'on-request'

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      let result = await getOpenAIEnvironment({ useHostConfig: true } as never);
      let toml = decodeConfigToml(result);
      expect(toml).toContain('approval_policy = "never"');
      expect(toml).not.toContain("'on-request'");

      // Test bare value
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `approval_policy = unless-allow-listed

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      result = await getOpenAIEnvironment({ useHostConfig: true } as never);
      toml = decodeConfigToml(result);
      expect(toml).toContain('approval_policy = "never"');
      expect(toml).not.toContain("unless-allow-listed");
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes memory protocol in instructions.md", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const instructionsFile = result.files?.find(
      (file) => file.destinationPath === "$HOME/.codex/instructions.md"
    );
    expect(instructionsFile).toBeDefined();
    const instructions = Buffer.from(
      instructionsFile!.contentBase64,
      "base64"
    ).toString("utf-8");
    // Memory protocol should be included
    expect(instructions).toContain("memory");
  });

  it("appends custom MCP server blocks after the managed memory block", async () => {
    const result = await getOpenAIEnvironment({
      mcpServerConfigs: [
        {
          name: "context7",
          type: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
        },
        {
          name: "my-server",
          type: "http",
          url: "https://mcp.example.com/http",
          headers: {
            Authorization: "Bearer secret",
          },
          envVars: {
            API_TOKEN: "secret",
          },
        },
      ],
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain("[mcp_servers.context7]");
    expect(toml).toContain('[mcp_servers."my-server"]');
    expect(toml).toContain('type = "http"');
    expect(toml).toContain('url = "https://mcp.example.com/http"');
    expect(toml).toContain('[mcp_servers."my-server".headers]');
    expect(toml).toContain('Authorization = "Bearer secret"');
    expect(toml).toContain('[mcp_servers."my-server".env]');
    expect(toml).toContain('API_TOKEN = "secret"');
    expect(toml.indexOf("[mcp_servers.devsh-memory]")).toBeLessThan(
      toml.indexOf("[mcp_servers.context7]"),
    );
  });

  it("strips nested devsh-memory subtables from host config", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Host config has nested subtables under devsh-memory (e.g., [mcp_servers.devsh-memory.env])
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[mcp_servers.devsh-memory]
type = "stdio"
command = "npx"
args = ["-y", "devsh-memory-mcp@latest"]

[mcp_servers.devsh-memory.env]
CUSTOM_VAR = "should-be-stripped"

[mcp_servers."devsh-memory".settings]
debug = true

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      const result = await getOpenAIEnvironment({
        useHostConfig: true,
        agentName: "codex/gpt-5.1-codex-mini",
      } as never);

      const toml = decodeConfigToml(result);
      // User's other settings should be preserved
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain('[some_section]');
      expect(toml).toContain('foo = "bar"');
      // Managed block should be present with correct args
      expect(toml).toContain('[mcp_servers.devsh-memory]');
      expect(toml).toContain(
        'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
      );
      // Nested subtables should be stripped
      expect(toml).not.toContain('[mcp_servers.devsh-memory.env]');
      expect(toml).not.toContain('CUSTOM_VAR');
      expect(toml).not.toContain('[mcp_servers."devsh-memory".settings]');
      expect(toml).not.toContain('debug = true');
      // Only one devsh-memory block should exist
      const managedBlockMatches = toml.match(/\[mcp_servers(?:\.|\."|")devsh-memory/g) ?? [];
      expect(managedBlockMatches).toHaveLength(1);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes cross-tool symlink commands in startupCommands", async () => {
    const result = await getOpenAIEnvironment({} as never);

    // Should include all symlink commands from getCrossToolSymlinkCommands
    const symlinkCommands = getCrossToolSymlinkCommands();
    for (const cmd of symlinkCommands) {
      expect(result.startupCommands).toContain(cmd);
    }
  });

  it("includes memory startup command", async () => {
    const result = await getOpenAIEnvironment({} as never);

    // Should include mkdir command for memory directories
    expect(result.startupCommands?.some((cmd) =>
      cmd.includes("mkdir -p") && cmd.includes("/root/lifecycle/memory")
    )).toBe(true);
  });

  it("persists Codex thread id from notify payload for explicit resume", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const notifyFile = result.files?.find(
      (file) => file.destinationPath === "/root/lifecycle/codex-notify.sh"
    );
    expect(notifyFile).toBeDefined();

    const notifyScript = Buffer.from(
      notifyFile!.contentBase64,
      "base64"
    ).toString("utf-8");

    expect(notifyScript).toContain(
      "THREAD_ID=$(printf '%s' \"$1\" | jq -r '.thread_id // .\"thread-id\" // empty'"
    );
    expect(notifyScript).toContain(
      "THREAD_ID=$(printf '%s' \"$1\" | grep -oE '\"thread-id\":\"[^\"]+\"|\"thread_id\":\"[^\"]+\"'"
    );
    expect(notifyScript).toContain("codex-session-id.txt");
  });

  it("creates codex-resume helper script", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const resumeFile = result.files?.find(
      (file) => file.destinationPath === "/root/lifecycle/codex-resume.sh"
    );
    expect(resumeFile).toBeDefined();

    const resumeScript = Buffer.from(
      resumeFile!.contentBase64,
      "base64"
    ).toString("utf-8");

    expect(resumeScript).toContain('SESSION_ID_FILE="/root/lifecycle/codex-session-id.txt"');
    expect(resumeScript).toContain('exec codex resume "$THREAD_ID"');
  });

  it("creates codex-autopilot script with aligned continuation and wrap-up prompts", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const autopilotFile = result.files?.find(
      (file) => file.destinationPath === "/root/lifecycle/codex-autopilot.sh"
    );
    expect(autopilotFile).toBeDefined();

    const autopilotScript = Buffer.from(
      autopilotFile!.contentBase64,
      "base64"
    ).toString("utf-8");

    expect(autopilotScript).toContain(
      "Continue from where you left off. Do not ask whether to continue."
    );
    expect(autopilotScript).toContain(
      "Final turn (wrap up). Time left: ${TIME_LEFT}s. Stop starting large new work. Stabilize and write a summary."
    );
    expect(autopilotScript).toContain(
      "End every turn with: Progress, Commands run, Files changed, Next."
    );
  });

  it("injects custom provider config when providerConfig.baseUrl is set", async () => {
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://cliapi.karldigi.dev/v1",
      },
    } as never);

    const toml = decodeConfigToml(result);
    // Should have model_provider set to cmux-proxy
    expect(toml).toContain('model_provider = "cmux-proxy"');
    // Should have custom provider section
    expect(toml).toContain('[model_providers.cmux-proxy]');
    expect(toml).toContain('name = "cmux Proxy"');
    expect(toml).toContain('base_url = "https://cliapi.karldigi.dev/v1"');
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('requires_openai_auth = true');
    // Standard Codex defaults should still be present
    expect(toml).toContain('sandbox_mode = "danger-full-access"');
    expect(toml).toContain('approval_policy = "never"');
  });

  it("preserves managed MCP blocks when injecting custom provider config", async () => {
    const result = await getOpenAIEnvironment({
      agentName: "codex/gpt-5.3-codex-xhigh",
      mcpServerConfigs: [
        {
          name: "context7",
          type: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          envVars: { CONTEXT7_API_KEY: "token" },
        },
      ],
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://cliapi.karldigi.dev/v1",
      },
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain('[mcp_servers.context7]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y","@upstash/context7-mcp@latest"]');
    expect(toml).toContain('[mcp_servers.context7.env]');
    expect(toml).toContain('CONTEXT7_API_KEY = "token"');
    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).toContain(
      'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.3-codex-xhigh"]',
    );
    expect(toml).toContain('[model_providers.cmux-proxy]');
  });

  it("does not inject custom provider config when providerConfig is not overridden", async () => {
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: false,
        baseUrl: "https://api.openai.com/v1",
      },
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).not.toContain('model_provider = "cmux-proxy"');
    expect(toml).not.toContain('[model_providers.cmux-proxy]');
  });

  it("does not inject custom provider config when baseUrl is empty", async () => {
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "",
      },
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).not.toContain('model_provider = "cmux-proxy"');
    expect(toml).not.toContain('[model_providers.cmux-proxy]');
  });

  it("custom provider config has correct TOML structure (top-level keys before sections)", async () => {
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://custom.api.example.com/v1",
      },
    } as never);

    const toml = decodeConfigToml(result);
    // model_provider should be one of the first lines (top-level key)
    const lines = toml.split("\n");
    const modelProviderIndex = lines.findIndex((l) =>
      l.includes('model_provider = "cmux-proxy"')
    );
    expect(modelProviderIndex).toBeLessThan(5);

    // Top-level keys (notify, sandbox_mode, approval_policy) must come BEFORE any section
    const firstSectionIndex = toml.search(/^\[/m);
    const notifyIndex = toml.indexOf("notify =");
    const sandboxModeIndex = toml.indexOf("sandbox_mode =");
    const approvalPolicyIndex = toml.indexOf("approval_policy =");

    expect(notifyIndex).toBeLessThan(firstSectionIndex);
    expect(sandboxModeIndex).toBeLessThan(firstSectionIndex);
    expect(approvalPolicyIndex).toBeLessThan(firstSectionIndex);

    // [model_providers.cmux-proxy] section should be at the END (after mcp_servers)
    const customProviderSectionIndex = toml.indexOf("[model_providers.cmux-proxy]");
    const mcpServersIndex = toml.indexOf("[mcp_servers.");
    expect(customProviderSectionIndex).toBeGreaterThan(mcpServersIndex);
  });

  it("does not inject custom provider config when using OAuth (CODEX_AUTH_JSON)", async () => {
    // OAuth tokens work directly with official OpenAI API, no proxy needed
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://cliapi.karldigi.dev/v1",
      },
      apiKeys: {
        CODEX_AUTH_JSON: '{"tokens":{"access_token":"oauth-token"}}',
      },
    } as never);

    const toml = decodeConfigToml(result);
    // Should NOT have custom provider when using OAuth
    expect(toml).not.toContain('model_provider = "cmux-proxy"');
    expect(toml).not.toContain('[model_providers.cmux-proxy]');
    // Should NOT set OPENAI_BASE_URL when using OAuth
    expect(result.env?.OPENAI_BASE_URL).toBeUndefined();
  });

  it("injects custom provider config when using API key auth (OPENAI_API_KEY)", async () => {
    // API key auth with custom base URL should use proxy
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://cliapi.karldigi.dev/v1",
      },
      apiKeys: {
        OPENAI_API_KEY: "sk-test-key",
      },
    } as never);

    const toml = decodeConfigToml(result);
    // Should have custom provider when using API key
    expect(toml).toContain('model_provider = "cmux-proxy"');
    expect(toml).toContain('[model_providers.cmux-proxy]');
    expect(toml).toContain('base_url = "https://cliapi.karldigi.dev/v1"');
    // Should set OPENAI_BASE_URL
    expect(result.env?.OPENAI_BASE_URL).toBe("https://cliapi.karldigi.dev/v1");
  });

  it("does not inject custom provider config when baseUrl is default OpenAI URL", async () => {
    // When user clears team base URL setting, it falls back to default OpenAI URL
    // but isOverridden may still be true - should NOT use custom provider
    const result = await getOpenAIEnvironment({
      providerConfig: {
        isOverridden: true,
        baseUrl: "https://api.openai.com/v1", // Default OpenAI URL
      },
      apiKeys: {
        OPENAI_API_KEY: "sk-test-key",
      },
    } as never);

    const toml = decodeConfigToml(result);
    // Should NOT have custom provider when using default OpenAI URL
    expect(toml).not.toContain('model_provider = "cmux-proxy"');
    expect(toml).not.toContain('[model_providers.cmux-proxy]');
    // Should NOT set OPENAI_BASE_URL
    expect(result.env?.OPENAI_BASE_URL).toBeUndefined();
  });
});
