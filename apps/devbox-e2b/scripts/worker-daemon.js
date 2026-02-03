#!/usr/bin/env node
/**
 * Worker Daemon for E2B cmux sandbox
 *
 * HTTP server that provides API endpoints for sandbox operations.
 * Runs on port 39377.
 *
 * Features:
 * - Authentication via Bearer token
 * - Command execution
 * - PTY sessions via WebSocket
 * - Browser agent control via Chrome CDP
 * - File operations
 */

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 39377;
const CDP_PORT = process.env.CDP_PORT || 9222;

// Auth token file path
const AUTH_TOKEN_PATH = "/home/user/.worker-auth-token";
const VSCODE_TOKEN_PATH = "/home/user/.vscode-token";
// File to track which boot this token was generated for
const TOKEN_BOOT_ID_PATH = "/home/user/.token-boot-id";

// Current auth token (will be regenerated if boot_id changes)
let AUTH_TOKEN = null;

/**
 * Get current kernel boot ID
 * This changes on every fresh boot, even when resuming from snapshot
 */
function getCurrentBootId() {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Get saved boot ID from when token was last generated
 */
function getSavedBootId() {
  try {
    return fs.readFileSync(TOKEN_BOOT_ID_PATH, "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Generate fresh auth token and save with current boot ID
 */
function generateFreshAuthToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const bootId = getCurrentBootId();
  try {
    // Write to both worker and vscode token files
    fs.writeFileSync(AUTH_TOKEN_PATH, token, { mode: 0o644 });
    fs.writeFileSync(VSCODE_TOKEN_PATH, token, { mode: 0o644 });
    // Record which boot this token is for
    if (bootId) {
      fs.writeFileSync(TOKEN_BOOT_ID_PATH, bootId, { mode: 0o644 });
    }
    console.log(`[worker-daemon] Fresh auth token generated: ${token.substring(0, 8)}...`);
  } catch (e) {
    console.error("[worker-daemon] Failed to save auth token:", e.message);
  }
  return token;
}

/**
 * Get existing token from file
 */
function getExistingToken() {
  try {
    return fs.readFileSync(AUTH_TOKEN_PATH, "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Check if token needs regeneration and regenerate if needed
 * Called on every authenticated request to ensure fresh boot detection
 */
function ensureValidToken() {
  const currentBootId = getCurrentBootId();
  const savedBootId = getSavedBootId();

  // If boot ID changed or missing, regenerate token
  if (!currentBootId || !savedBootId || currentBootId !== savedBootId) {
    console.log(`[worker-daemon] Boot ID changed (${savedBootId?.substring(0, 8) || 'none'} -> ${currentBootId?.substring(0, 8) || 'none'}), regenerating token`);
    AUTH_TOKEN = generateFreshAuthToken();
    return AUTH_TOKEN;
  }

  // Use existing token if boot ID matches
  if (!AUTH_TOKEN) {
    AUTH_TOKEN = getExistingToken() || generateFreshAuthToken();
  }
  return AUTH_TOKEN;
}

// Initialize auth token on startup
AUTH_TOKEN = ensureValidToken();

/**
 * Verify authentication
 * Also checks for boot ID changes and regenerates token if needed
 */
function verifyAuth(req) {
  // Always ensure token is valid for current boot
  ensureValidToken();

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return false;
  }

  // Support both "Bearer <token>" and just "<token>"
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return token === AUTH_TOKEN;
}

/**
 * Execute a shell command and return the result
 */
async function execCommand(command, timeout = 60000, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      timeout,
      env: { ...process.env, ...env, FORCE_COLOR: "0" },
      cwd: process.env.WORKSPACE || "/home/user/workspace",
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exit_code: code || 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exit_code: 1,
      });
    });
  });
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Get Chrome CDP WebSocket URL
 */
async function getCdpWebSocketUrl() {
  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    if (!response.ok) {
      throw new Error(`CDP version endpoint returned ${response.status}`);
    }
    const data = await response.json();
    return data.webSocketDebuggerUrl;
  } catch (e) {
    console.error("[worker-daemon] Failed to get CDP WebSocket URL:", e.message);
    return null;
  }
}

/**
 * Run browser agent with prompt
 */
async function runBrowserAgent(prompt, options = {}) {
  const { timeout = 120000, screenshotPath } = options;

  // Build environment
  const env = {};
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  env.CDP_ENDPOINT = `http://localhost:${CDP_PORT}`;
  env.BROWSER_AGENT_PROMPT = prompt;
  if (screenshotPath) {
    env.BROWSER_AGENT_SCREENSHOT_PATH = screenshotPath;
  }

  // Run browser agent (plain JS, no ts-node needed)
  const result = await execCommand(
    `node /usr/local/bin/browser-agent-runner.js`,
    timeout,
    env
  );

  return result;
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check - no auth required
  if (reqPath === "/health") {
    sendJson(res, { status: "ok", provider: "e2b", authenticated: false });
    return;
  }

  // Auth token endpoint - returns the token (only accessible locally or initially)
  if (reqPath === "/auth-token") {
    // Only allow from localhost or if no token has been retrieved yet
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1") {
      sendJson(res, { token: AUTH_TOKEN });
      return;
    }
    sendJson(res, { error: "Forbidden" }, 403);
    return;
  }

  // All other endpoints require authentication
  if (!verifyAuth(req)) {
    sendJson(res, { error: "Unauthorized" }, 401);
    return;
  }

  try {
    let body = {};
    if (req.method === "POST") {
      body = await parseBody(req);
    }

    switch (reqPath) {
      case "/exec": {
        // Execute a command
        if (!body.command) {
          sendJson(res, { error: "command required" }, 400);
          return;
        }
        const result = await execCommand(body.command, body.timeout, body.env);
        sendJson(res, result);
        break;
      }

      case "/read-file": {
        // Read a file
        if (!body.path) {
          sendJson(res, { error: "path required" }, 400);
          return;
        }
        try {
          const content = fs.readFileSync(body.path, "utf-8");
          sendJson(res, { content });
        } catch (e) {
          sendJson(res, { error: e.message }, 404);
        }
        break;
      }

      case "/write-file": {
        // Write a file
        if (!body.path || body.content === undefined) {
          sendJson(res, { error: "path and content required" }, 400);
          return;
        }
        try {
          fs.writeFileSync(body.path, body.content);
          sendJson(res, { success: true });
        } catch (e) {
          sendJson(res, { error: e.message }, 500);
        }
        break;
      }

      case "/status": {
        // Get sandbox status
        const processes = await execCommand("ps aux --no-headers | wc -l");
        const memory = await execCommand("free -m | awk '/^Mem:/ {print $3 \"/\" $2}'");
        const disk = await execCommand("df -h / | awk 'NR==2 {print $3 \"/\" $2}'");
        const cdpUrl = await getCdpWebSocketUrl();
        sendJson(res, {
          provider: "e2b",
          processes: parseInt(processes.stdout) || 0,
          memory: memory.stdout,
          disk: disk.stdout,
          cdpAvailable: !!cdpUrl,
          vncAvailable: true,
        });
        break;
      }

      case "/cdp-info": {
        // Get Chrome CDP connection info
        const cdpUrl = await getCdpWebSocketUrl();
        if (!cdpUrl) {
          sendJson(res, { error: "Chrome CDP not available" }, 503);
          return;
        }
        sendJson(res, {
          wsUrl: cdpUrl,
          httpEndpoint: `http://localhost:${CDP_PORT}`,
        });
        break;
      }

      case "/browser-agent": {
        // Run browser agent with prompt
        if (!body.prompt) {
          sendJson(res, { error: "prompt required" }, 400);
          return;
        }
        const result = await runBrowserAgent(body.prompt, {
          timeout: body.timeout,
          screenshotPath: body.screenshotPath,
        });
        sendJson(res, result);
        break;
      }

      case "/screenshot": {
        // Take a screenshot using Chrome CDP
        const cdpUrl = await getCdpWebSocketUrl();
        if (!cdpUrl) {
          sendJson(res, { error: "Chrome not available" }, 503);
          return;
        }

        // Use Chrome screenshot capability
        const targetPath = body.path || "/tmp/screenshot.png";
        const result = await execCommand(
          `google-chrome --headless --screenshot=${targetPath} --window-size=1920,1080 --no-sandbox about:blank 2>/dev/null`,
          30000
        );

        if (result.exit_code === 0 && fs.existsSync(targetPath)) {
          const imageData = fs.readFileSync(targetPath).toString("base64");
          sendJson(res, { success: true, path: targetPath, base64: imageData });
        } else {
          sendJson(res, { error: "Screenshot failed", details: result.stderr }, 500);
        }
        break;
      }

      case "/services": {
        // List running services
        const vscode = await execCommand("pgrep -f openvscode-server");
        const chrome = await execCommand("pgrep -f 'chrome.*remote-debugging'");
        const vnc = await execCommand("pgrep -f vncserver");
        const novnc = await execCommand("pgrep -f novnc_proxy");

        sendJson(res, {
          vscode: { running: vscode.exit_code === 0, port: 39378 },
          chrome: { running: chrome.exit_code === 0, port: 9222 },
          vnc: { running: vnc.exit_code === 0, port: 5901 },
          novnc: { running: novnc.exit_code === 0, port: 39380 },
          worker: { running: true, port: PORT },
        });
        break;
      }

      default:
        sendJson(res, { error: "Not found" }, 404);
    }
  } catch (err) {
    console.error("[worker-daemon] Error:", err.message);
    sendJson(res, { success: false, error: err.message }, 500);
  }
}

// Create HTTP server
const server = http.createServer(handleRequest);

// Create WebSocket server for PTY sessions
const wss = new WebSocketServer({ server, path: "/pty" });

// Track active PTY sessions
const ptySessions = new Map();

wss.on("connection", (ws, req) => {
  // Verify auth from query string or headers
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get("token") || req.headers.authorization?.replace("Bearer ", "");

  if (token !== AUTH_TOKEN) {
    ws.close(4401, "Unauthorized");
    return;
  }

  console.log("[worker-daemon] PTY WebSocket connection established");

  // Parse options from query string
  const cols = parseInt(url.searchParams.get("cols")) || 80;
  const rows = parseInt(url.searchParams.get("rows")) || 24;
  const shell = url.searchParams.get("shell") || process.env.SHELL || "/bin/bash";
  const cwd = url.searchParams.get("cwd") || "/home/user/workspace";

  // Spawn PTY process
  let pty;
  try {
    // Try to use node-pty if available, otherwise fallback to script command
    try {
      const nodePty = require("node-pty");
      pty = nodePty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (e) {
      // Fallback to script command for PTY emulation
      console.log("[worker-daemon] node-pty not available, using script fallback");
      pty = spawn("script", ["-q", "-c", shell, "/dev/null"], {
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLUMNS: cols.toString(), LINES: rows.toString() },
      });
      pty.resize = () => {}; // No-op for fallback
    }
  } catch (e) {
    console.error("[worker-daemon] Failed to spawn PTY:", e.message);
    ws.close(4500, "Failed to spawn PTY");
    return;
  }

  const sessionId = crypto.randomBytes(8).toString("hex");
  ptySessions.set(sessionId, { pty, ws });

  // Send session ID to client
  ws.send(JSON.stringify({ type: "session", id: sessionId }));

  // Forward PTY output to WebSocket
  if (pty.onData) {
    // node-pty style
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });
  } else if (pty.stdout) {
    // spawn style
    pty.stdout.on("data", (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });
    pty.stderr.on("data", (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });
  }

  // Handle WebSocket messages
  ws.on("message", (msg) => {
    try {
      const message = JSON.parse(msg.toString());

      switch (message.type) {
        case "data":
          // Send data to PTY
          if (pty.write) {
            pty.write(message.data);
          } else if (pty.stdin) {
            pty.stdin.write(message.data);
          }
          break;

        case "resize":
          // Resize PTY
          if (pty.resize) {
            pty.resize(message.cols || 80, message.rows || 24);
          }
          break;
      }
    } catch (e) {
      console.error("[worker-daemon] PTY message error:", e.message);
    }
  });

  // Handle PTY exit
  const onExit = (code) => {
    console.log(`[worker-daemon] PTY exited with code ${code}`);
    ptySessions.delete(sessionId);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code }));
      ws.close();
    }
  };

  if (pty.onExit) {
    pty.onExit(({ exitCode }) => onExit(exitCode));
  } else if (pty.on) {
    pty.on("close", onExit);
    pty.on("exit", onExit);
  }

  // Handle WebSocket close
  ws.on("close", () => {
    console.log("[worker-daemon] PTY WebSocket closed");
    ptySessions.delete(sessionId);
    if (pty.kill) {
      pty.kill();
    } else if (pty.destroy) {
      pty.destroy();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[worker-daemon] Listening on port ${PORT}`);
  console.log(`[worker-daemon] Auth token: ${AUTH_TOKEN.substring(0, 8)}...`);
  console.log(`[worker-daemon] PTY WebSocket available at ws://localhost:${PORT}/pty`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[worker-daemon] Shutting down...");
  // Close all PTY sessions
  for (const [, session] of ptySessions) {
    if (session.pty.kill) {
      session.pty.kill();
    }
    if (session.ws.close) {
      session.ws.close();
    }
  }
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[worker-daemon] Shutting down...");
  server.close(() => process.exit(0));
});
