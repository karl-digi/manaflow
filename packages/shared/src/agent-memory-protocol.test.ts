import { describe, it, expect } from "vitest";
import {
  getMemoryMcpServerScript,
  getCrossToolSymlinkCommands,
  getMemoryStartupCommand,
  getMemorySeedFiles,
  MEMORY_PROTOCOL_DIR,
  MEMORY_DAILY_DIR,
  MEMORY_KNOWLEDGE_DIR,
  MEMORY_ORCHESTRATION_DIR,
} from "./agent-memory-protocol";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("agent-memory-protocol", () => {
  it("generates valid JavaScript for MCP server script", () => {
    const script = getMemoryMcpServerScript();
    
    // Write to temp file and validate with node --check
    const tempFile = join(tmpdir(), `mcp-server-test-${Date.now()}.js`);
    try {
      writeFileSync(tempFile, script);
      // node --check validates syntax without executing
      execSync(`node --check "${tempFile}"`, { encoding: "utf-8" });
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("MCP server script contains expected tools", () => {
    const script = getMemoryMcpServerScript();
    
    const expectedTools = [
      "read_memory",
      "list_daily_logs", 
      "read_daily_log",
      "search_memory",
      "send_message",
      "get_my_messages",
      "mark_read",
      "append_daily_log",
      "update_knowledge",
      "add_task",
      "update_task",
    ];
    
    for (const tool of expectedTools) {
      expect(script).toContain(`name: '${tool}'`);
    }
  });

  describe("getCrossToolSymlinkCommands", () => {
    it("returns exactly 3 commands", () => {
      const commands = getCrossToolSymlinkCommands();
      expect(commands).toHaveLength(3);
    });

    it("first command creates directories for codex and gemini", () => {
      const commands = getCrossToolSymlinkCommands();
      expect(commands[0]).toBe("mkdir -p ~/.codex ~/.gemini");
    });

    it("second command creates symlink for AGENTS.md with guards", () => {
      const commands = getCrossToolSymlinkCommands();
      // Should check if CLAUDE.md exists before creating symlink
      expect(commands[1]).toContain("[ -f ~/.claude/CLAUDE.md ]");
      // Should use ln -sf for force symlink
      expect(commands[1]).toContain("ln -sf");
      // Should target the correct paths
      expect(commands[1]).toContain("~/.claude/CLAUDE.md");
      expect(commands[1]).toContain("~/.codex/AGENTS.md");
      // Should include || true for idempotency
      expect(commands[1]).toContain("|| true");
    });

    it("third command creates symlink for GEMINI.md with guards", () => {
      const commands = getCrossToolSymlinkCommands();
      // Should check if CLAUDE.md exists before creating symlink
      expect(commands[2]).toContain("[ -f ~/.claude/CLAUDE.md ]");
      // Should use ln -sf for force symlink
      expect(commands[2]).toContain("ln -sf");
      // Should target the correct paths
      expect(commands[2]).toContain("~/.claude/CLAUDE.md");
      expect(commands[2]).toContain("~/.gemini/GEMINI.md");
      // Should include || true for idempotency
      expect(commands[2]).toContain("|| true");
    });

    it("symlinks use consistent source path", () => {
      const commands = getCrossToolSymlinkCommands();
      // Both symlinks should point to the same source file
      const codexCmd = commands[1];
      const geminiCmd = commands[2];

      // Extract source path from "ln -sf <source> <dest>"
      const sourceRegex = /ln -sf\s+(\S+)/;
      const codexSource = codexCmd.match(sourceRegex)?.[1];
      const geminiSource = geminiCmd.match(sourceRegex)?.[1];

      expect(codexSource).toBe("~/.claude/CLAUDE.md");
      expect(geminiSource).toBe("~/.claude/CLAUDE.md");
    });
  });

  describe("getMemoryStartupCommand", () => {
    it("creates required memory directories", () => {
      const command = getMemoryStartupCommand();
      expect(command).toContain("mkdir -p");
      expect(command).toContain(MEMORY_DAILY_DIR);
      expect(command).toContain(MEMORY_KNOWLEDGE_DIR);
      expect(command).toContain(MEMORY_ORCHESTRATION_DIR);
    });
  });

  describe("getMemorySeedFiles", () => {
    it("returns required memory files", () => {
      const files = getMemorySeedFiles("test-sandbox-id");

      // Check that required files are present
      const paths = files.map((f) => f.destinationPath);
      expect(paths).toContain(`${MEMORY_PROTOCOL_DIR}/TASKS.json`);
      expect(paths).toContain(`${MEMORY_KNOWLEDGE_DIR}/MEMORY.md`);
      expect(paths).toContain(`${MEMORY_PROTOCOL_DIR}/MAILBOX.json`);
      expect(paths).toContain(`${MEMORY_PROTOCOL_DIR}/sync.sh`);
      expect(paths).toContain(`${MEMORY_PROTOCOL_DIR}/mcp-server.js`);
    });

    it("sync.sh has execute permissions", () => {
      const files = getMemorySeedFiles("test-sandbox-id");
      const syncFile = files.find(
        (f) => f.destinationPath === `${MEMORY_PROTOCOL_DIR}/sync.sh`
      );
      expect(syncFile).toBeDefined();
      expect(syncFile?.mode).toBe("755");
    });

    it("mcp-server.js has execute permissions", () => {
      const files = getMemorySeedFiles("test-sandbox-id");
      const mcpFile = files.find(
        (f) => f.destinationPath === `${MEMORY_PROTOCOL_DIR}/mcp-server.js`
      );
      expect(mcpFile).toBeDefined();
      expect(mcpFile?.mode).toBe("755");
    });

    it("includes previous knowledge when provided", () => {
      const previousKnowledge = "# Previous Knowledge\n- Important fact";
      const files = getMemorySeedFiles(
        "test-sandbox-id",
        previousKnowledge,
        undefined
      );

      const knowledgeFile = files.find((f) =>
        f.destinationPath.includes("MEMORY.md")
      );
      expect(knowledgeFile).toBeDefined();

      // Decode content and verify
      const content = Buffer.from(
        knowledgeFile?.contentBase64 ?? "",
        "base64"
      ).toString();
      expect(content).toContain("Previous Knowledge");
    });

    it("includes orchestration files when options provided", () => {
      const files = getMemorySeedFiles("test-sandbox-id", undefined, undefined, {
        headAgent: "claude/opus-4.5",
        orchestrationId: "orch_test123",
        isOrchestrationHead: true,
      });

      const paths = files.map((f) => f.destinationPath);
      expect(paths).toContain(`${MEMORY_ORCHESTRATION_DIR}/PLAN.json`);
      expect(paths).toContain(`${MEMORY_ORCHESTRATION_DIR}/AGENTS.json`);
      expect(paths).toContain(`${MEMORY_ORCHESTRATION_DIR}/EVENTS.jsonl`);
      expect(paths).toContain(
        `${MEMORY_ORCHESTRATION_DIR}/HEAD_AGENT_INSTRUCTIONS.md`
      );
    });
  });
});
