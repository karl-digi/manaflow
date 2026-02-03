#!/usr/bin/env bun
import { program } from "commander";
import { execSync } from "node:child_process";
import {
  isLoggedIn,
  storeRefreshToken,
  deleteRefreshToken,
  clearAccessTokenCache,
  getDefaultTeam,
  setDefaultTeam,
  clearDefaultTeam,
  STACK_PROJECT_ID,
  IS_DEV,
  initiateCliAuth,
  pollCliAuth,
  getAuthConfirmUrl,
} from "./auth.js";
import {
  getMe,
  createInstance,
  listInstances,
  getInstance,
  execCommand,
  stopInstance,
  pauseInstance,
  resumeInstance,
  updateTtl,
  getWorkerAuthToken,
  getWorkerStatus,
  getWorkerServices,
  getCdpInfo,
  runBrowserAgent,
  takeScreenshot,
  workerExec,
  workerReadFile,
  workerWriteFile,
} from "./api.js";

// =============================================================================
// Helpers
// =============================================================================

function openUrl(url: string): void {
  if (process.platform === "darwin") {
    execSync(`open "${url}"`);
  } else if (process.platform === "linux") {
    execSync(`xdg-open "${url}"`);
  } else {
    console.log(`Open this URL: ${url}`);
  }
}

async function requireTeam(teamOption?: string): Promise<string> {
  if (teamOption) {
    return teamOption;
  }

  const defaultTeam = getDefaultTeam();
  if (defaultTeam) {
    return defaultTeam;
  }

  // Try to get from user profile
  try {
    const profile = await getMe();
    if (profile.teamSlug) {
      return profile.teamSlug;
    }
  } catch {
    // Ignore
  }

  throw new Error(
    "No team specified. Use --team or run 'cmux config set-team <team>' to set a default."
  );
}

async function getInstanceWithWorker(
  id: string,
  teamSlugOrId: string
): Promise<{ instance: Awaited<ReturnType<typeof getInstance>>; workerUrl: string; token: string }> {
  const instance = await getInstance(id, teamSlugOrId);
  if (!instance.workerUrl) {
    throw new Error("Instance does not have a worker URL");
  }
  const token = await getWorkerAuthToken(id, teamSlugOrId);
  return { instance, workerUrl: instance.workerUrl, token };
}

// =============================================================================
// CLI Commands
// =============================================================================

program
  .name("cmux")
  .description("CLI for managing E2B cloud development sandboxes")
  .version("0.1.0");

// Login command - uses Stack Auth CLI device flow
program
  .command("login")
  .description("Login to cmux (opens browser)")
  .action(async () => {
    if (isLoggedIn()) {
      console.log("Already logged in. Run 'cmux logout' first to re-authenticate.");
      process.exit(1);
    }

    console.log("Starting authentication...\n");

    try {
      // Step 1: Initiate CLI auth flow
      const { polling_code, login_code } = await initiateCliAuth();

      // Step 2: Open browser
      const authUrl = getAuthConfirmUrl(login_code);
      console.log("Opening browser to complete authentication...");
      console.log(`If browser doesn't open, visit:\n  ${authUrl}\n`);

      openUrl(authUrl);

      // Step 3: Poll for completion
      console.log("Waiting for authentication... (press Ctrl+C to cancel)");

      const maxAttempts = 120; // 10 minutes at 5 second intervals
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const pollResult = await pollCliAuth(polling_code);

        switch (pollResult.status) {
          case "success":
            if (!pollResult.refresh_token) {
              console.error("\nAuthentication succeeded but no refresh token returned");
              process.exit(1);
            }

            // Store the refresh token
            storeRefreshToken(pollResult.refresh_token);
            clearAccessTokenCache();

            console.log("\n\nLogin successful!");

            // Fetch user profile
            try {
              const profile = await getMe();
              console.log(`Logged in as: ${profile.email || profile.name || profile.userId}`);
              if (profile.teamSlug && !getDefaultTeam()) {
                setDefaultTeam(profile.teamSlug);
                console.log(`Default team set to: ${profile.teamSlug}`);
              }
            } catch (err) {
              console.error("Warning: Could not fetch user profile:", err);
            }

            process.exit(0);
            break;

          case "expired":
            console.error("\nAuthentication expired. Please try again.");
            process.exit(1);
            break;

          default:
            // Still pending, show progress
            process.stdout.write(".");
        }
      }

      console.error("\nAuthentication timed out. Please try again.");
      process.exit(1);
    } catch (err) {
      console.error("Login failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Logout command
program
  .command("logout")
  .description("Logout and clear credentials")
  .action(() => {
    deleteRefreshToken();
    clearAccessTokenCache();
    clearDefaultTeam();
    console.log("Logged out successfully.");
  });

// Status command (also aliased as whoami)
program
  .command("status")
  .alias("whoami")
  .description("Show authentication status")
  .action(async () => {
    console.log(`Mode: ${IS_DEV ? "development" : "production"}`);
    console.log(`Stack Project ID: ${STACK_PROJECT_ID}`);

    if (!isLoggedIn()) {
      console.log("Status: Not logged in");
      console.log("\nRun 'cmux login' to authenticate.");
      return;
    }

    console.log("Status: Logged in");

    try {
      const profile = await getMe();
      console.log(`User: ${profile.email || profile.name || profile.userId}`);
      if (profile.teamSlug) {
        console.log(`Team: ${profile.teamDisplayName || profile.teamSlug}`);
      }
    } catch (err) {
      console.error("Warning: Could not fetch user profile:", err);
    }

    const defaultTeam = getDefaultTeam();
    if (defaultTeam) {
      console.log(`Default team: ${defaultTeam}`);
    }
  });

// Auth command group (alternative to root-level login/logout/status)
const authCmd = program.command("auth").description("Authentication commands");

authCmd
  .command("login")
  .description("Login to cmux (opens browser)")
  .action(async () => {
    if (isLoggedIn()) {
      console.log("Already logged in. Run 'cmux logout' first to re-authenticate.");
      process.exit(1);
    }

    console.log("Starting authentication...\n");

    try {
      const { polling_code, login_code } = await initiateCliAuth();
      const authUrl = getAuthConfirmUrl(login_code);
      console.log("Opening browser to complete authentication...");
      console.log(`If browser doesn't open, visit:\n  ${authUrl}\n`);
      openUrl(authUrl);

      console.log("Waiting for authentication... (press Ctrl+C to cancel)");

      const maxAttempts = 120;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const pollResult = await pollCliAuth(polling_code);

        if (pollResult.status === "success") {
          if (!pollResult.refresh_token) {
            console.error("\nAuthentication succeeded but no refresh token returned");
            process.exit(1);
          }
          storeRefreshToken(pollResult.refresh_token);
          clearAccessTokenCache();
          console.log("\n\nLogin successful!");
          try {
            const profile = await getMe();
            console.log(`Logged in as: ${profile.email || profile.name || profile.userId}`);
            if (profile.teamSlug && !getDefaultTeam()) {
              setDefaultTeam(profile.teamSlug);
              console.log(`Default team set to: ${profile.teamSlug}`);
            }
          } catch {
            // Ignore
          }
          process.exit(0);
        } else if (pollResult.status === "expired") {
          console.error("\nAuthentication expired. Please try again.");
          process.exit(1);
        } else {
          process.stdout.write(".");
        }
      }
      console.error("\nAuthentication timed out. Please try again.");
      process.exit(1);
    } catch (err) {
      console.error("Login failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

authCmd
  .command("logout")
  .description("Logout and clear credentials")
  .action(() => {
    deleteRefreshToken();
    clearAccessTokenCache();
    clearDefaultTeam();
    console.log("Logged out successfully.");
  });

authCmd
  .command("whoami")
  .description("Show current user")
  .action(async () => {
    if (!isLoggedIn()) {
      console.log("Not logged in. Run 'cmux login' to authenticate.");
      process.exit(1);
    }

    try {
      const profile = await getMe();
      console.log(`User: ${profile.email || profile.name || profile.userId}`);
      if (profile.teamSlug) {
        console.log(`Team: ${profile.teamDisplayName || profile.teamSlug}`);
      }
    } catch (err) {
      console.error("Failed to get user profile:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Create command (with start/new aliases)
program
  .command("create")
  .alias("start")
  .alias("new")
  .description("Create a new sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .option("-n, --name <name>", "Instance name")
  .option("--ttl <seconds>", "TTL in seconds", "3600")
  .option("--open", "Open VSCode after creation")
  .action(async (options) => {
    const teamSlugOrId = await requireTeam(options.team);

    console.log("Creating sandbox...");

    try {
      const instance = await createInstance({
        teamSlugOrId,
        name: options.name,
        ttlSeconds: parseInt(options.ttl, 10),
      });

      console.log("\nInstance created:");
      console.log(`  ID: ${instance.id}`);
      console.log(`  Status: ${instance.status}`);

      // Wait a moment for services to start, then fetch auth token
      let token: string | null = null;
      if (instance.status === "running") {
        console.log("  Fetching auth token...");
        // Give services a moment to start
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          token = await getWorkerAuthToken(instance.id, teamSlugOrId);
        } catch {
          console.log("  (Auth token not yet available)");
        }
      }

      // Construct authenticated URLs
      if (instance.vscodeUrl) {
        const vscodeUrl = token ? `${instance.vscodeUrl}?tkn=${token}` : instance.vscodeUrl;
        console.log(`  VSCode: ${vscodeUrl}`);
      }
      if (instance.vncUrl) {
        const vncUrl = token
          ? `${instance.vncUrl}?password=${token.substring(0, 8)}`
          : instance.vncUrl;
        console.log(`  VNC: ${vncUrl}`);
      }
      if (instance.workerUrl) {
        console.log(`  Worker: ${instance.workerUrl}`);
      }
      if (token) {
        console.log(`  Auth Token: ${token.substring(0, 8)}...`);
      }

      if (options.open && instance.vscodeUrl) {
        const vscodeUrl = token ? `${instance.vscodeUrl}?tkn=${token}` : instance.vscodeUrl;
        console.log("\nOpening VSCode...");
        openUrl(vscodeUrl);
      }
    } catch (err) {
      console.error("Failed to create instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// List command
program
  .command("list")
  .alias("ls")
  .description("List sandboxs")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const instances = await listInstances(teamSlugOrId);

      if (options.json) {
        console.log(JSON.stringify(instances, null, 2));
        return;
      }

      if (instances.length === 0) {
        console.log("No instances found.");
        return;
      }

      console.log("Instances:");
      for (const inst of instances) {
        console.log(`  ${inst.id} - ${inst.status}${inst.name ? ` (${inst.name})` : ""}`);
      }
    } catch (err) {
      console.error("Failed to list instances:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Get command
program
  .command("get <id>")
  .description("Get sandbox details")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--json", "Output as JSON")
  .option("--with-auth", "Include auth token in URLs")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const instance = await getInstance(id, teamSlugOrId);

      // Fetch auth token if requested
      let token: string | null = null;
      if (options.withAuth && instance.status === "running") {
        try {
          token = await getWorkerAuthToken(id, teamSlugOrId);
        } catch {
          // Token not available yet
        }
      }

      // Construct authenticated URLs
      const vscodeUrl = instance.vscodeUrl
        ? token
          ? `${instance.vscodeUrl}?tkn=${token}`
          : instance.vscodeUrl
        : undefined;
      const vncUrl = instance.vncUrl
        ? token
          ? `${instance.vncUrl}?password=${token.substring(0, 8)}`
          : instance.vncUrl
        : undefined;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ...instance,
              vscodeUrl,
              vncUrl,
              authToken: token,
            },
            null,
            2
          )
        );
        return;
      }

      console.log(`Instance: ${instance.id}`);
      console.log(`  Status: ${instance.status}`);
      console.log(`  Provider: ${instance.provider}`);
      if (instance.name) {
        console.log(`  Name: ${instance.name}`);
      }
      if (vscodeUrl) {
        console.log(`  VSCode: ${vscodeUrl}`);
      }
      if (vncUrl) {
        console.log(`  VNC: ${vncUrl}`);
      }
      if (instance.workerUrl) {
        console.log(`  Worker: ${instance.workerUrl}`);
      }
      if (token) {
        console.log(`  Auth Token: ${token.substring(0, 8)}...`);
      }
    } catch (err) {
      console.error("Failed to get instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Exec command
program
  .command("exec <id> <command...>")
  .description("Execute a command in a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, command: string[], options) => {
    const teamSlugOrId = await requireTeam(options.team);
    const commandStr = command.join(" ");

    try {
      const result = await execCommand(id, teamSlugOrId, commandStr);

      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }

      process.exit(result.exit_code);
    } catch (err) {
      console.error("Failed to execute command:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Stop command
program
  .command("stop <id>")
  .alias("kill")
  .description("Stop a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      await stopInstance(id, teamSlugOrId);
      console.log(`Instance ${id} stopped.`);
    } catch (err) {
      console.error("Failed to stop instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Pause command
program
  .command("pause <id>")
  .description("Pause a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      await pauseInstance(id, teamSlugOrId);
      console.log(`Instance ${id} paused.`);
    } catch (err) {
      console.error("Failed to pause instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Resume command
program
  .command("resume <id>")
  .description("Resume a paused sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      await resumeInstance(id, teamSlugOrId);
      console.log(`Instance ${id} resumed.`);
    } catch (err) {
      console.error("Failed to resume instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// TTL command
program
  .command("ttl <id> <seconds>")
  .description("Update TTL for a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, seconds: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);
    const ttlSeconds = parseInt(seconds, 10);

    if (isNaN(ttlSeconds) || ttlSeconds < 0) {
      console.error("Invalid TTL. Must be a positive number of seconds.");
      process.exit(1);
    }

    try {
      await updateTtl(id, teamSlugOrId, ttlSeconds);
      console.log(`Instance ${id} TTL updated to ${ttlSeconds} seconds.`);
    } catch (err) {
      console.error("Failed to update TTL:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Open command
program
  .command("open <id>")
  .description("Open sandbox in browser (with auth)")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--vnc", "Open VNC instead of VSCode")
  .option("--no-auth", "Open without auth token")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const instance = await getInstance(id, teamSlugOrId);

      // Fetch auth token
      let token: string | null = null;
      if (options.auth !== false && instance.status === "running") {
        try {
          token = await getWorkerAuthToken(id, teamSlugOrId);
        } catch {
          console.warn("Warning: Could not fetch auth token. Opening without authentication.");
        }
      }

      const baseUrl = options.vnc ? instance.vncUrl : instance.vscodeUrl;
      if (!baseUrl) {
        console.error(`No ${options.vnc ? "VNC" : "VSCode"} URL available for this instance.`);
        process.exit(1);
      }

      // Construct authenticated URL
      let url = baseUrl;
      if (token) {
        if (options.vnc) {
          // VNC uses password query param (first 8 chars of token)
          url = `${baseUrl}?password=${token.substring(0, 8)}`;
        } else {
          // VSCode uses tkn query param
          url = `${baseUrl}?tkn=${token}`;
        }
      }

      console.log(`Opening ${options.vnc ? "VNC" : "VSCode"}: ${url}`);
      openUrl(url);
    } catch (err) {
      console.error("Failed to open instance:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Services command
program
  .command("services <id>")
  .description("List running services in a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      const services = await getWorkerServices(workerUrl, token);

      if (options.json) {
        console.log(JSON.stringify(services, null, 2));
        return;
      }

      console.log("Services:");
      console.log(`  VSCode:  ${services.vscode.running ? "running" : "stopped"} (port ${services.vscode.port})`);
      console.log(`  Chrome:  ${services.chrome.running ? "running" : "stopped"} (port ${services.chrome.port})`);
      console.log(`  VNC:     ${services.vnc.running ? "running" : "stopped"} (port ${services.vnc.port})`);
      console.log(`  noVNC:   ${services.novnc.running ? "running" : "stopped"} (port ${services.novnc.port})`);
      console.log(`  Worker:  ${services.worker.running ? "running" : "stopped"} (port ${services.worker.port})`);
    } catch (err) {
      console.error("Failed to get services:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Worker status command
program
  .command("worker-status <id>")
  .description("Get worker status for a sandbox")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      const status = await getWorkerStatus(workerUrl, token);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log("Worker Status:");
      console.log(`  Provider: ${status.provider}`);
      console.log(`  Processes: ${status.processes}`);
      console.log(`  Memory: ${status.memory}`);
      console.log(`  Disk: ${status.disk}`);
      console.log(`  CDP Available: ${status.cdpAvailable ? "yes" : "no"}`);
      console.log(`  VNC Available: ${status.vncAvailable ? "yes" : "no"}`);
    } catch (err) {
      console.error("Failed to get worker status:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// CDP info command
program
  .command("cdp <id>")
  .description("Get Chrome CDP connection info")
  .option("-t, --team <team>", "Team slug or ID")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      const cdpInfo = await getCdpInfo(workerUrl, token);

      if (options.json) {
        console.log(JSON.stringify(cdpInfo, null, 2));
        return;
      }

      console.log("Chrome CDP Info:");
      console.log(`  WebSocket URL: ${cdpInfo.wsUrl}`);
      console.log(`  HTTP Endpoint: ${cdpInfo.httpEndpoint}`);
    } catch (err) {
      console.error("Failed to get CDP info:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Browser agent command
program
  .command("browser <id>")
  .description("Run browser agent with a prompt")
  .option("-t, --team <team>", "Team slug or ID")
  .option("-p, --prompt <prompt>", "Prompt for the browser agent")
  .option("--screenshot <path>", "Save screenshot after completion")
  .option("--timeout <ms>", "Timeout in milliseconds", "120000")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    if (!options.prompt) {
      console.error("Prompt is required. Use --prompt <prompt>");
      process.exit(1);
    }

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);

      console.log("Running browser agent...");
      const result = await runBrowserAgent(workerUrl, token, options.prompt, {
        timeout: parseInt(options.timeout, 10),
        screenshotPath: options.screenshot,
      });

      if (result.error) {
        console.error("Browser agent error:", result.error);
        process.exit(1);
      }

      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }

      process.exit(result.exit_code || 0);
    } catch (err) {
      console.error("Failed to run browser agent:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Screenshot command
program
  .command("screenshot <id>")
  .description("Take a screenshot of the browser")
  .option("-t, --team <team>", "Team slug or ID")
  .option("-o, --output <path>", "Output path", "/tmp/screenshot.png")
  .option("--base64", "Output base64 instead of saving to file")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      const result = await takeScreenshot(workerUrl, token, options.output);

      if (!result.success) {
        console.error("Screenshot failed:", result.error);
        process.exit(1);
      }

      if (options.base64 && result.base64) {
        console.log(result.base64);
      } else {
        console.log(`Screenshot saved to: ${result.path}`);
      }
    } catch (err) {
      console.error("Failed to take screenshot:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Read file command
program
  .command("cat <id> <path>")
  .description("Read a file from the devbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, path: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      const content = await workerReadFile(workerUrl, token, path);
      console.log(content);
    } catch (err) {
      console.error("Failed to read file:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Write file command
program
  .command("write <id> <path> <content>")
  .description("Write a file to the devbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, path: string, content: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { workerUrl, token } = await getInstanceWithWorker(id, teamSlugOrId);
      await workerWriteFile(workerUrl, token, path, content);
      console.log(`File written to: ${path}`);
    } catch (err) {
      console.error("Failed to write file:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// PTY command - interactive shell
program
  .command("shell <id>")
  .alias("pty")
  .description("Open an interactive shell in the devbox")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const { instance, token } = await getInstanceWithWorker(id, teamSlugOrId);

      if (!instance.workerUrl) {
        console.error("Instance does not have a worker URL");
        process.exit(1);
      }

      // Connect to PTY WebSocket
      const wsUrl = instance.workerUrl.replace("https://", "wss://").replace("http://", "ws://");
      const ptyUrl = `${wsUrl}/pty?token=${token}&cols=${process.stdout.columns || 80}&rows=${process.stdout.rows || 24}`;

      console.log("Connecting to PTY...");

      const WebSocket = (await import("ws")).default;
      const ws = new WebSocket(ptyUrl);

      ws.on("open", () => {
        console.log("Connected. Press Ctrl+D to exit.\n");

        // Set terminal to raw mode
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        // Send stdin to WebSocket
        process.stdin.on("data", (data) => {
          ws.send(JSON.stringify({ type: "data", data: data.toString() }));
        });

        // Handle terminal resize
        process.stdout.on("resize", () => {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: process.stdout.columns,
              rows: process.stdout.rows,
            })
          );
        });
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "data") {
            process.stdout.write(msg.data);
          } else if (msg.type === "exit") {
            console.log(`\nShell exited with code ${msg.code}`);
            process.exit(msg.code);
          }
        } catch {
          // Ignore parse errors
        }
      });

      ws.on("close", () => {
        console.log("\nConnection closed.");
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.exit(0);
      });

      ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.exit(1);
      });
    } catch (err) {
      console.error("Failed to open shell:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Auth token command - get worker auth token for an instance
program
  .command("auth-token <id>")
  .description("Get the worker auth token for an instance")
  .option("-t, --team <team>", "Team slug or ID")
  .action(async (id: string, options) => {
    const teamSlugOrId = await requireTeam(options.team);

    try {
      const token = await getWorkerAuthToken(id, teamSlugOrId);
      console.log(token);
    } catch (err) {
      console.error("Failed to get auth token:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Config commands
const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set-team <team>")
  .description("Set the default team")
  .action((team: string) => {
    setDefaultTeam(team);
    console.log(`Default team set to: ${team}`);
  });

configCmd
  .command("clear-team")
  .description("Clear the default team")
  .action(() => {
    clearDefaultTeam();
    console.log("Default team cleared.");
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    console.log(`Mode: ${IS_DEV ? "development" : "production"}`);
    console.log(`Stack Project ID: ${STACK_PROJECT_ID}`);
    const defaultTeam = getDefaultTeam();
    console.log(`Default team: ${defaultTeam || "(not set)"}`);
  });

// Parse arguments
program.parse();
