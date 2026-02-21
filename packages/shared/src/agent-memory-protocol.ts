/**
 * Agent Memory Protocol - Spike S2b
 *
 * Two-tier memory architecture with priority tiering:
 * - Layer 1 (daily/): Ephemeral daily logs - auto-dated, session-specific
 * - Layer 2 (knowledge/): Curated long-term memory with P0/P1/P2 priority tiers
 *   - P0 Core: Never expires - project fundamentals, safety rules, invariants
 *   - P1 Active: 90-day TTL - ongoing work, current strategies, recent decisions
 *   - P2 Reference: 30-day TTL - debug notes, one-time findings, temporary context
 *
 * Seeds memory directory with:
 * - TASKS.json, MAILBOX.json at root
 * - knowledge/MEMORY.md for permanent insights (P0/P1/P2 sections)
 * - daily/{date}.md for session-specific notes
 *
 * IMPORTANT: Memory is stored at /root/lifecycle/memory/ (OUTSIDE the git workspace)
 * to avoid polluting the user's repository with untracked files. This follows the
 * pattern used by Claude hooks, Codex, and OpenCode which all use /root/lifecycle/.
 */

import type { AuthFile } from "./worker-schemas";

// Memory protocol directory path (absolute, outside git workspace)
// Using /root/lifecycle/ to match existing patterns (Claude hooks, Codex, OpenCode)
// This prevents git pollution - memory files won't appear in `git status`
export const MEMORY_PROTOCOL_DIR = "/root/lifecycle/memory";

// Subdirectories for two-tier memory architecture
export const MEMORY_DAILY_DIR = `${MEMORY_PROTOCOL_DIR}/daily`;
export const MEMORY_KNOWLEDGE_DIR = `${MEMORY_PROTOCOL_DIR}/knowledge`;

/**
 * Get today's date string in YYYY-MM-DD format for daily log files.
 */
export function getTodayDateString(): string {
  const iso = new Date().toISOString();
  return iso.slice(0, iso.indexOf("T"));
}

/**
 * Seed content for TASKS.json
 */
export function getTasksSeedContent(sandboxId: string): string {
  const seed = {
    version: 1,
    tasks: [],
    metadata: {
      sandboxId,
      createdAt: new Date().toISOString(),
    },
  };
  return JSON.stringify(seed, null, 2);
}

/**
 * Seed content for knowledge/MEMORY.md (Layer 2 - permanent insights with priority tiers)
 */
export function getKnowledgeSeedContent(): string {
  return `# Project Knowledge

> Curated insights organized by priority. Add date tags for TTL tracking.

## P0 - Core (Never Expires)
<!-- Fundamental project facts, configuration, invariants -->
<!-- Examples: "Uses bun, not npm", "Port 3001 for auth service" -->

## P1 - Active (90-day TTL)
<!-- Ongoing work context, current strategies, recent decisions -->
<!-- Review entries older than 90 days: promote to P0 or remove -->

## P2 - Reference (30-day TTL)
<!-- Temporary findings, debug notes, one-off context -->
<!-- Review entries older than 30 days: promote to P1 or remove -->

---
*Priority guide: P0 = permanent truth, P1 = active context, P2 = temporary reference*
*Format: - [YYYY-MM-DD] Your insight here*
`;
}

/**
 * Seed content for daily/{date}.md (Layer 1 - ephemeral logs)
 * @param date - Date string in YYYY-MM-DD format
 */
export function getDailyLogSeedContent(date: string): string {
  return `# Daily Log: ${date}

> Session-specific observations. Temporary notes go here.

---
`;
}

/**
 * Seed content for MAILBOX.json
 */
export function getMailboxSeedContent(): string {
  const seed = {
    version: 1,
    messages: [],
  };
  return JSON.stringify(seed, null, 2);
}

/**
 * Memory protocol instructions for agents.
 * This text should be included in each agent's instruction file.
 *
 * @param agentNameEnvVar - The environment variable name for agent name (default: $CMUX_AGENT_NAME)
 */
export function getMemoryProtocolInstructions(
  agentNameEnvVar: string = "$CMUX_AGENT_NAME"
): string {
  return `## cmux Agent Memory Protocol

You have access to persistent memory at \`${MEMORY_PROTOCOL_DIR}/\`:

> Note: Memory is stored outside the git workspace to avoid polluting your repository.

### Memory Structure

- \`${MEMORY_KNOWLEDGE_DIR}/MEMORY.md\` - Long-term insights (curated)
- \`${MEMORY_DAILY_DIR}/{date}.md\` - Daily logs (ephemeral)
- \`${MEMORY_PROTOCOL_DIR}/TASKS.json\` - Task registry
- \`${MEMORY_PROTOCOL_DIR}/MAILBOX.json\` - Inter-agent messages

### On Start
1. Read \`knowledge/MEMORY.md\` for permanent project insights
2. Read \`TASKS.json\` to see existing tasks and their statuses
3. Optionally scan recent \`daily/\` logs for recent context

### During Work
- Append observations to \`daily/{today}.md\` (create if doesn't exist)
- Update task statuses in TASKS.json

### On Completion
- **Daily log**: Append what you did today to \`daily/{today}.md\`
- **Knowledge**: Promote KEY learnings to \`knowledge/MEMORY.md\` (only permanent insights)
- Update TASKS.json with final statuses

### What Goes Where?

| Type | Location | Priority | Example |
|------|----------|----------|---------|
| Project fundamentals | \`knowledge/MEMORY.md\` | P0 | "This project uses bun, not npm" |
| Current work context | \`knowledge/MEMORY.md\` | P1 | "Auth refactor in progress" |
| Temporary findings | \`knowledge/MEMORY.md\` | P2 | "Sandbox morphvm_abc for testing" |
| Today's work | \`daily/{date}.md\` | - | "Fixed bug in auth.ts line 42" |
| Debug notes | \`daily/{date}.md\` | - | "Tested endpoint with curl" |

### Priority Guidelines

- **Date-tag format**: \`- [YYYY-MM-DD] Your insight here\`
- **P0 Core**: Rare, highly stable truths. Never expires. Examples: tooling choices, critical ports, invariants.
- **P1 Active**: Current focus areas. Review after 90 days - promote to P0 if still relevant, or remove.
- **P2 Reference**: One-off findings. Review after 30 days - promote to P1 if still useful, or remove.
- **Daily logs**: Raw session notes. Do not promote everything - only curate what's worth keeping.

### Inter-Agent Messaging
- Your agent name: ${agentNameEnvVar}
- Check \`${MEMORY_PROTOCOL_DIR}/MAILBOX.json\` for messages addressed to you
- To message another agent: append to the messages array with format:
  \`\`\`json
  {"from": "your-agent", "to": "target-agent", "message": "...", "timestamp": "ISO-8601"}
  \`\`\`
`;
}

/**
 * Get the startup command to create the memory directory structure.
 * Creates both daily/ and knowledge/ subdirectories for two-tier architecture.
 */
export function getMemoryStartupCommand(): string {
  return `mkdir -p ${MEMORY_DAILY_DIR} ${MEMORY_KNOWLEDGE_DIR}`;
}

/**
 * Generate the memory sync bash script that reads memory files and POSTs them to Convex.
 * This script is called by provider stop hooks before crown/complete.
 *
 * Features:
 * - Best-effort sync (|| true for all commands)
 * - Client-side truncation with head -c 500000
 * - Uses jq for safe JSON construction
 * - Logs to /root/lifecycle/memory-sync.log
 */
export function getMemorySyncScript(): string {
  return `#!/bin/bash
# Memory sync script - syncs agent memory files to Convex
# Called by stop hooks before crown/complete

set -euo pipefail

LOG_FILE="/root/lifecycle/memory-sync.log"
MEMORY_DIR="${MEMORY_PROTOCOL_DIR}"
MAX_SIZE=500000

log() {
  echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"
}

# Best-effort wrapper - never fail the stop hook
sync_memory() {
  log "Starting memory sync"

  # Check required env vars
  if [ -z "\${CMUX_CALLBACK_URL:-}" ] || [ -z "\${CMUX_TASK_RUN_JWT:-}" ]; then
    log "Missing required env vars (CMUX_CALLBACK_URL or CMUX_TASK_RUN_JWT), skipping sync"
    return 0
  fi

  # Check if jq is available
  if ! command -v jq >/dev/null 2>&1; then
    log "jq not found, skipping sync"
    return 0
  fi

  # Build JSON array of files
  files_json="[]"

  # Sync knowledge/MEMORY.md
  if [ -f "$MEMORY_DIR/knowledge/MEMORY.md" ]; then
    content=$(head -c $MAX_SIZE "$MEMORY_DIR/knowledge/MEMORY.md" | jq -Rs .)
    files_json=$(echo "$files_json" | jq --argjson c "$content" '. + [{"memoryType": "knowledge", "content": ($c), "fileName": "knowledge/MEMORY.md"}]')
    log "Added knowledge/MEMORY.md"
  fi

  # Sync daily logs (find all .md files in daily/)
  if [ -d "$MEMORY_DIR/daily" ]; then
    for daily_file in "$MEMORY_DIR/daily"/*.md; do
      if [ -f "$daily_file" ]; then
        filename=$(basename "$daily_file")
        date_str="\${filename%.md}"
        content=$(head -c $MAX_SIZE "$daily_file" | jq -Rs .)
        files_json=$(echo "$files_json" | jq --argjson c "$content" --arg d "$date_str" --arg f "daily/$filename" '. + [{"memoryType": "daily", "content": ($c), "fileName": ($f), "date": ($d)}]')
        log "Added daily/$filename"
      fi
    done
  fi

  # Sync TASKS.json
  if [ -f "$MEMORY_DIR/TASKS.json" ]; then
    content=$(head -c $MAX_SIZE "$MEMORY_DIR/TASKS.json" | jq -Rs .)
    files_json=$(echo "$files_json" | jq --argjson c "$content" '. + [{"memoryType": "tasks", "content": ($c), "fileName": "TASKS.json"}]')
    log "Added TASKS.json"
  fi

  # Sync MAILBOX.json
  if [ -f "$MEMORY_DIR/MAILBOX.json" ]; then
    content=$(head -c $MAX_SIZE "$MEMORY_DIR/MAILBOX.json" | jq -Rs .)
    files_json=$(echo "$files_json" | jq --argjson c "$content" '. + [{"memoryType": "mailbox", "content": ($c), "fileName": "MAILBOX.json"}]')
    log "Added MAILBOX.json"
  fi

  # Check if we have any files to sync
  file_count=$(echo "$files_json" | jq 'length')
  if [ "$file_count" -eq 0 ]; then
    log "No memory files found to sync"
    return 0
  fi

  # Build final payload
  payload=$(jq -n --argjson files "$files_json" '{"files": $files}')
  log "Syncing $file_count files to Convex"

  # POST to Convex
  response=$(curl -s -w "\\n%{http_code}" -X POST "\${CMUX_CALLBACK_URL}/api/memory/sync" \\
    -H "Content-Type: application/json" \\
    -H "x-cmux-token: \${CMUX_TASK_RUN_JWT}" \\
    -d "$payload" 2>>"$LOG_FILE")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    log "Memory sync successful: $body"
  else
    log "Memory sync failed with HTTP $http_code: $body"
  fi
}

# Run sync with best-effort error handling
sync_memory 2>>"$LOG_FILE" || {
  echo "[$(date -Iseconds)] Memory sync failed but continuing" >> "$LOG_FILE"
}

exit 0
`;
}

/**
 * Get the AuthFile for the memory sync script.
 * This is deployed to /root/lifecycle/memory/sync.sh with execute permissions.
 */
export function getMemorySyncScriptFile(): AuthFile {
  const Buffer = globalThis.Buffer;
  return {
    destinationPath: `${MEMORY_PROTOCOL_DIR}/sync.sh`,
    contentBase64: Buffer.from(getMemorySyncScript()).toString("base64"),
    mode: "755",
  };
}

/**
 * Generate the MCP server script that exposes memory files as tools.
 * This runs as a stdio-based MCP server that Claude can query programmatically.
 *
 * Tools provided:
 * - read_memory(type): Read memory file content (knowledge, tasks, mailbox)
 * - list_daily_logs(): List available daily log dates
 * - read_daily_log(date): Read a specific daily log
 * - search_memory(query): Search across all memory files
 */
export function getMemoryMcpServerScript(): string {
  return `#!/usr/bin/env node
/**
 * cmux Memory MCP Server
 * Exposes agent memory files as MCP tools for programmatic access.
 * Uses stdio transport for simplicity in sandbox environments.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MEMORY_DIR = '${MEMORY_PROTOCOL_DIR}';
const KNOWLEDGE_DIR = path.join(MEMORY_DIR, 'knowledge');
const DAILY_DIR = path.join(MEMORY_DIR, 'daily');

// Simple JSON-RPC over stdio implementation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result, error) {
  const response = {
    jsonrpc: '2.0',
    id
  };
  if (error) {
    response.error = { code: -32000, message: error };
  } else {
    response.result = result;
  }
  console.log(JSON.stringify(response));
}

function readFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return null;
  }
}

function listDailyLogs() {
  try {
    if (!fs.existsSync(DAILY_DIR)) {
      return [];
    }
    const files = fs.readdirSync(DAILY_DIR);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
      .sort()
      .reverse();
  } catch (err) {
    return [];
  }
}

function searchMemory(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  // Search knowledge
  const knowledge = readFile(path.join(KNOWLEDGE_DIR, 'MEMORY.md'));
  if (knowledge && knowledge.toLowerCase().includes(lowerQuery)) {
    const lines = knowledge.split('\\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        results.push({
          source: 'knowledge/MEMORY.md',
          line: i + 1,
          content: lines[i].trim()
        });
      }
    }
  }

  // Search tasks
  const tasks = readFile(path.join(MEMORY_DIR, 'TASKS.json'));
  if (tasks && tasks.toLowerCase().includes(lowerQuery)) {
    results.push({
      source: 'TASKS.json',
      content: 'Match found in tasks file'
    });
  }

  // Search mailbox
  const mailbox = readFile(path.join(MEMORY_DIR, 'MAILBOX.json'));
  if (mailbox && mailbox.toLowerCase().includes(lowerQuery)) {
    results.push({
      source: 'MAILBOX.json',
      content: 'Match found in mailbox file'
    });
  }

  // Search daily logs
  const dailyLogs = listDailyLogs();
  for (const date of dailyLogs.slice(0, 7)) { // Only search last 7 days
    const logContent = readFile(path.join(DAILY_DIR, date + '.md'));
    if (logContent && logContent.toLowerCase().includes(lowerQuery)) {
      const lines = logContent.split('\\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            source: 'daily/' + date + '.md',
            line: i + 1,
            content: lines[i].trim()
          });
        }
      }
    }
  }

  return results;
}

// MCP protocol handlers
const tools = [
  {
    name: 'read_memory',
    description: 'Read a memory file. Type can be "knowledge", "tasks", or "mailbox".',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['knowledge', 'tasks', 'mailbox'],
          description: 'The type of memory to read'
        }
      },
      required: ['type']
    }
  },
  {
    name: 'list_daily_logs',
    description: 'List available daily log dates (newest first).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'read_daily_log',
    description: 'Read a specific daily log by date (YYYY-MM-DD format).',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The date in YYYY-MM-DD format'
        }
      },
      required: ['date']
    }
  },
  {
    name: 'search_memory',
    description: 'Search across all memory files for a query string.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        }
      },
      required: ['query']
    }
  }
];

function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cmux-memory', version: '1.0.0' }
      });

    case 'tools/list':
      return sendResponse(id, { tools });

    case 'tools/call':
      const { name, arguments: args } = params;

      switch (name) {
        case 'read_memory': {
          const typeToPath = {
            knowledge: path.join(KNOWLEDGE_DIR, 'MEMORY.md'),
            tasks: path.join(MEMORY_DIR, 'TASKS.json'),
            mailbox: path.join(MEMORY_DIR, 'MAILBOX.json')
          };
          const content = readFile(typeToPath[args.type]);
          if (content === null) {
            return sendResponse(id, { content: [{ type: 'text', text: 'File not found or empty.' }] });
          }
          return sendResponse(id, { content: [{ type: 'text', text: content }] });
        }

        case 'list_daily_logs': {
          const dates = listDailyLogs();
          return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(dates, null, 2) }] });
        }

        case 'read_daily_log': {
          const content = readFile(path.join(DAILY_DIR, args.date + '.md'));
          if (content === null) {
            return sendResponse(id, { content: [{ type: 'text', text: 'Daily log not found for date: ' + args.date }] });
          }
          return sendResponse(id, { content: [{ type: 'text', text: content }] });
        }

        case 'search_memory': {
          const results = searchMemory(args.query);
          if (results.length === 0) {
            return sendResponse(id, { content: [{ type: 'text', text: 'No matches found for: ' + args.query }] });
          }
          return sendResponse(id, { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] });
        }

        default:
          return sendResponse(id, null, 'Unknown tool: ' + name);
      }

    default:
      return sendResponse(id, null, 'Unknown method: ' + method);
  }
}

// Read JSON-RPC messages line by line
rl.on('line', (line) => {
  try {
    const request = JSON.parse(line);
    handleRequest(request);
  } catch (err) {
    // Ignore parse errors
  }
});

// Send initialized notification
process.stderr.write('[cmux-memory] MCP server started\\n');
`;
}

/**
 * Get the AuthFile for the MCP server script.
 * This is deployed to /root/lifecycle/memory/mcp-server.js with execute permissions.
 */
export function getMemoryMcpServerFile(): AuthFile {
  const Buffer = globalThis.Buffer;
  return {
    destinationPath: `${MEMORY_PROTOCOL_DIR}/mcp-server.js`,
    contentBase64: Buffer.from(getMemoryMcpServerScript()).toString("base64"),
    mode: "755",
  };
}

/**
 * Get auth files for memory protocol seed content.
 * These files are written to the sandbox at startup.
 * Files are placed at /root/lifecycle/memory/ (outside git workspace).
 *
 * Two-tier structure:
 * - TASKS.json, MAILBOX.json at root
 * - knowledge/MEMORY.md for permanent insights
 * - daily/{date}.md for session-specific notes
 * - sync.sh for memory sync to Convex
 *
 * @param sandboxId - The sandbox/task run ID for metadata
 * @param previousKnowledge - Optional previous knowledge content from earlier runs (for cross-run seeding)
 */
export function getMemorySeedFiles(
  sandboxId: string,
  previousKnowledge?: string
): AuthFile[] {
  const Buffer = globalThis.Buffer;
  const today = getTodayDateString();

  // Use previous knowledge if provided and non-empty, otherwise use default template
  const knowledgeContent =
    previousKnowledge && previousKnowledge.trim().length > 0
      ? previousKnowledge
      : getKnowledgeSeedContent();

  return [
    {
      destinationPath: `${MEMORY_PROTOCOL_DIR}/TASKS.json`,
      contentBase64: Buffer.from(getTasksSeedContent(sandboxId)).toString(
        "base64"
      ),
      mode: "644",
    },
    {
      destinationPath: `${MEMORY_KNOWLEDGE_DIR}/MEMORY.md`,
      contentBase64: Buffer.from(knowledgeContent).toString("base64"),
      mode: "644",
    },
    {
      destinationPath: `${MEMORY_DAILY_DIR}/${today}.md`,
      contentBase64: Buffer.from(getDailyLogSeedContent(today)).toString(
        "base64"
      ),
      mode: "644",
    },
    {
      destinationPath: `${MEMORY_PROTOCOL_DIR}/MAILBOX.json`,
      contentBase64: Buffer.from(getMailboxSeedContent()).toString("base64"),
      mode: "644",
    },
    // Include sync script for memory sync to Convex
    getMemorySyncScriptFile(),
    // Include MCP server for programmatic memory access (S6)
    getMemoryMcpServerFile(),
  ];
}
