#!/usr/bin/env node
/**
 * devsh-memory-mcp CLI
 *
 * Standalone MCP server for devsh/cmux agent memory.
 *
 * Usage:
 *   devsh-memory-mcp                    # Use default memory directory
 *   devsh-memory-mcp --dir /path/to/memory
 *   devsh-memory-mcp --agent my-agent-name
 *
 * Claude Desktop config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "devsh-memory": {
 *         "command": "npx",
 *         "args": ["devsh-memory-mcp"]
 *       }
 *     }
 *   }
 */

import { runServer } from "./index.js";

function parseArgs(): { memoryDir?: string; agentName?: string } {
  const args = process.argv.slice(2);
  const result: { memoryDir?: string; agentName?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      result.memoryDir = args[i + 1];
      i++;
    } else if (args[i] === "--agent" && args[i + 1]) {
      result.agentName = args[i + 1];
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
devsh-memory-mcp - MCP server for devsh/cmux agent memory

Usage:
  devsh-memory-mcp [options]

Options:
  --dir <path>      Memory directory (default: /root/lifecycle/memory)
  --agent <name>    Agent name for messaging (default: from CMUX_AGENT_NAME env)
  --help, -h        Show this help message

Example Claude Desktop config:
  {
    "mcpServers": {
      "devsh-memory": {
        "command": "npx",
        "args": ["devsh-memory-mcp", "--dir", "/path/to/memory"]
      }
    }
  }
`);
      process.exit(0);
    }
  }

  return result;
}

async function main() {
  const config = parseArgs();

  // Log to stderr so stdout stays clean for MCP protocol
  console.error(`[devsh-memory-mcp] Starting server...`);
  if (config.memoryDir) {
    console.error(`[devsh-memory-mcp] Memory directory: ${config.memoryDir}`);
  }
  if (config.agentName) {
    console.error(`[devsh-memory-mcp] Agent name: ${config.agentName}`);
  }

  await runServer(config);
}

main().catch((err) => {
  console.error("[devsh-memory-mcp] Fatal error:", err);
  process.exit(1);
});
