/**
 * Electron main-process helpers for reading host MCP configuration files.
 *
 * Exposes narrow, read-only access to:
 *   - ~/.claude.json   (Claude Code global config, JSON)
 *   - ~/.codex/config.toml  (Codex CLI config, TOML)
 *   - ~/.config/opencode/opencode.json (OpenCode config, JSON)
 *
 * Returns raw file contents so that the renderer/shared layer can parse and
 * merge them without pulling Node fs APIs across the context bridge.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const MCP_HOST_CONFIG_IPC_CHANNELS = {
  readClaudeJson: "cmux:mcp-host-config:read-claude-json",
  readCodexToml: "cmux:mcp-host-config:read-codex-toml",
  readOpencodeJson: "cmux:mcp-host-config:read-opencode-json",
} as const;

export interface HostMcpFileResult {
  /** true when the file was read successfully */
  ok: boolean;
  /** Raw file content (utf-8).  undefined when ok is false. */
  content?: string;
  /** Absolute path that was attempted */
  path: string;
  /** Human-readable error when ok is false */
  error?: string;
}

async function safeReadFile(filePath: string): Promise<HostMcpFileResult> {
  try {
    const content = await readFile(filePath, "utf-8");
    return { ok: true, content, path: filePath };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return { ok: false, path: filePath, error: message };
  }
}

/**
 * Read ~/.claude.json (Claude Code global config).
 */
export function readClaudeJsonConfig(): Promise<HostMcpFileResult> {
  return safeReadFile(path.join(homedir(), ".claude.json"));
}

/**
 * Read ~/.codex/config.toml (Codex CLI config).
 */
export function readCodexTomlConfig(): Promise<HostMcpFileResult> {
  return safeReadFile(path.join(homedir(), ".codex", "config.toml"));
}

/**
 * Read ~/.config/opencode/opencode.json (OpenCode config).
 */
export function readOpencodeJsonConfig(): Promise<HostMcpFileResult> {
  return safeReadFile(path.join(homedir(), ".config", "opencode", "opencode.json"));
}
