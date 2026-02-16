#!/usr/bin/env bun
/**
 * Test script for PVE LXC Client with Cloudflare Tunnel
 *
 * This tests the CF tunnel connectivity and LXC exec method.
 *
 * Usage:
 *   # Test with CF Tunnel (requires PVE_PUBLIC_DOMAIN)
 *   bun run scripts/pve/test-pve-cf-tunnel.ts --vmid 200
 *
 *   # Test with FQDN (local network)
 *   bun run scripts/pve/test-pve-cf-tunnel.ts --vmid 200 --use-fqdn
 *
 *   # Create a new container from template and test
 *   bun run scripts/pve/test-pve-cf-tunnel.ts --create --template 105
 *
 * Required environment variables:
 *   PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
 *   PVE_API_TOKEN - API token in format: user@realm!tokenid=secret
 *   PVE_PUBLIC_DOMAIN - Public domain for CF tunnel (e.g., example.com)
 *   PVE_NODE - (optional) Node name, will auto-detect if not set
 */

import { PveLxcClient } from "../../apps/www/lib/utils/pve-lxc-client";
import { parseArgs } from "node:util";

interface TestResult {
  name: string;
  success: boolean;
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.success ? "[OK]" : "[FAIL]";
  const duration = result.duration ? ` (${result.duration}ms)` : "";
  console.log(`${icon} ${result.name}: ${result.message}${duration}`);
}

async function testHttpExec(
  label: string,
  host: string,
  command: string
): Promise<TestResult> {
  const execUrl = host.startsWith("https://")
    ? `${host}/exec`
    : `http://${host}:39375/exec`;

  log(`Testing HTTP exec via ${execUrl}`);
  const start = Date.now();

  try {
    const response = await fetch(execUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `HOME=/root ${command}`,
        timeout_ms: 30000,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      return {
        name: label,
        success: false,
        message: `HTTP ${response.status}: ${await response.text()}`,
        duration,
      };
    }

    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);

    let stdout = "";
    let exitCode = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "stdout" && event.data) {
          stdout += event.data + "\n";
        } else if (event.type === "exit") {
          exitCode = event.code ?? 0;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      name: label,
      success: exitCode === 0,
      message: stdout.trim() || "(no output)",
      duration,
    };
  } catch (error) {
    const duration = Date.now() - start;
    return {
      name: label,
      success: false,
      message: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

async function testClientExec(
  client: PveLxcClient,
  vmid: number,
  command: string
): Promise<TestResult> {
  log(`Testing client.execInContainer for VMID ${vmid}`);
  const start = Date.now();

  try {
    const result = await client.execInContainer(vmid, command);
    const duration = Date.now() - start;

    return {
      name: `Client exec (vmid=${vmid})`,
      success: result.exit_code === 0,
      message:
        result.exit_code === 0
          ? result.stdout.trim() || "(no output)"
          : `Exit ${result.exit_code}: ${result.stderr}`,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - start;
    return {
      name: `Client exec (vmid=${vmid})`,
      success: false,
      message: error instanceof Error ? error.message : String(error),
      duration,
    };
  }
}

async function main() {
  console.log("==========================================");
  console.log("  PVE LXC CF Tunnel & Exec Test");
  console.log("==========================================\n");

  // Parse arguments
  const { values } = parseArgs({
    options: {
      vmid: { type: "string", short: "v" },
      "use-fqdn": { type: "boolean", default: false },
      create: { type: "boolean", default: false },
      template: { type: "string", short: "t", default: "105" },
      cleanup: { type: "boolean", default: false },
      "instance-id": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/pve/test-pve-cf-tunnel.ts [options]

Options:
  --vmid, -v <id>     Test with existing container VMID
  --instance-id <id>  Instance ID/hostname for instanceId-based URLs
  --use-fqdn          Use FQDN instead of CF tunnel URL
  --create            Create a new container from template
  --template, -t <id> Template VMID for --create (default: 105)
  --cleanup           Delete container after test (only with --create)
  --help, -h          Show this help

Environment:
  PVE_API_URL         Proxmox API endpoint
  PVE_API_TOKEN       API token
  PVE_PUBLIC_DOMAIN   Public domain for CF tunnel
  PVE_NODE            (optional) Node name
`);
    process.exit(0);
  }

  // Check environment
  const apiUrl = process.env.PVE_API_URL;
  const apiToken = process.env.PVE_API_TOKEN;
  const publicDomain = process.env.PVE_PUBLIC_DOMAIN;
  const node = process.env.PVE_NODE;

  console.log("Configuration:");
  console.log(`  PVE_API_URL: ${apiUrl || "<not set>"}`);
  console.log(`  PVE_API_TOKEN: ${apiToken ? "<set>" : "<not set>"}`);
  console.log(`  PVE_PUBLIC_DOMAIN: ${publicDomain || "<not set>"}`);
  console.log(`  PVE_NODE: ${node || "<auto-detect>"}`);
  console.log(`  --use-fqdn: ${values["use-fqdn"]}`);
  console.log(`  --instance-id: ${values["instance-id"] || "<not set>"}`);
  console.log("");

  if (!apiUrl || !apiToken) {
    console.error("ERROR: PVE_API_URL and PVE_API_TOKEN are required");
    process.exit(1);
  }

  // Create client
  log("Creating PVE LXC client...");
  const client = new PveLxcClient({
    apiUrl,
    apiToken,
    node,
    publicDomain,
  });

  let vmid: number | undefined;
  let instanceId: string | undefined = values["instance-id"];
  let createdInstance = false;

  // Create new container if requested
  if (values.create) {
    const templateVmid = parseInt(values.template ?? "105", 10);
    console.log("\n--- Creating new container from template ---");
    log(`Template VMID: ${templateVmid}`);

    try {
      const instance = await client.instances.start({
        snapshotId: String(templateVmid),
        templateVmid,
        metadata: { app: "cmux-test" },
      });
      vmid = instance.vmid;
      instanceId = instance.id;
      createdInstance = true;

      logResult({
        name: "Create container",
        success: true,
        message: `Created VMID ${vmid} (hostname=${instance.networking.hostname}, fqdn=${instance.networking.fqdn})`,
      });

      console.log("Services:");
      for (const svc of instance.networking.httpServices) {
        console.log(`  ${svc.name}: ${svc.url}`);
      }
    } catch (error) {
      logResult({
        name: "Create container",
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  } else if (values.vmid) {
    vmid = parseInt(values.vmid, 10);
    if (isNaN(vmid)) {
      console.error("ERROR: Invalid VMID");
      process.exit(1);
    }
  } else {
    console.error("ERROR: Either --vmid or --create is required");
    process.exit(1);
  }

  if (!instanceId && vmid !== undefined) {
    try {
      const instance = await client.instances.get({
        instanceId: `pvelxc-${vmid}`,
        vmid,
      });
      instanceId = instance.networking.hostname;
    } catch (error) {
      console.warn(
        "WARN: Failed to resolve hostname from PVE, using fallback instance ID",
        error
      );
      instanceId = `pvelxc-${vmid}`;
    }
  }

  const hostname = instanceId ?? `pvelxc-${vmid}`;

  // Wait for container to be ready
  if (createdInstance) {
    log("Waiting for container to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Test 1: Direct HTTP exec via CF Tunnel
  if (publicDomain && !values["use-fqdn"] && instanceId) {
    console.log("\n--- Test 1: HTTP exec via CF Tunnel ---");
    const cfExecUrl = `https://port-39375-${instanceId}.${publicDomain}`;
    logResult(await testHttpExec("CF Tunnel exec", cfExecUrl, "echo hello"));
    logResult(await testHttpExec("CF Tunnel hostname", cfExecUrl, "hostname"));
    logResult(await testHttpExec("CF Tunnel uname", cfExecUrl, "uname -a"));
  }

  // Test 2: Direct HTTP exec via FQDN (local network)
  if (values["use-fqdn"] || !publicDomain) {
    console.log("\n--- Test 2: HTTP exec via FQDN ---");
    const fqdn = `${hostname}.lan`;
    logResult(await testHttpExec("FQDN exec", fqdn, "echo hello"));
    logResult(await testHttpExec("FQDN hostname", fqdn, "hostname"));
    logResult(await testHttpExec("FQDN uname", fqdn, "uname -a"));
  }

  // Test 3: Client execInContainer (auto-detects URL)
  console.log("\n--- Test 3: Client execInContainer ---");
  logResult(await testClientExec(client, vmid, "echo hello"));
  logResult(await testClientExec(client, vmid, "hostname"));
  logResult(await testClientExec(client, vmid, "whoami"));

  // Test 4: More complex commands
  console.log("\n--- Test 4: Complex commands ---");
  logResult(await testClientExec(client, vmid, "ls -la /root/workspace || echo 'workspace not found'"));
  logResult(await testClientExec(client, vmid, "which bun node git || echo 'some tools missing'"));
  logResult(await testClientExec(client, vmid, "ps aux | head -5"));

  // Test 5: Service connectivity (instanceId-based URL pattern)
  if (publicDomain && !values["use-fqdn"] && instanceId) {
    console.log("\n--- Test 5: Service URLs (instanceId-based pattern) ---");
    const vscodeUrl = `https://port-39378-${instanceId}.${publicDomain}`;
    const nodeWorkerUrl = `https://port-39376-${instanceId}.${publicDomain}`;  // Node.js worker (Socket.IO)
    const goWorkerUrl = `https://port-39377-${instanceId}.${publicDomain}`;    // Go worker (SSH proxy)

    try {
      const vscodeRes = await fetch(vscodeUrl, {
        signal: AbortSignal.timeout(10000),
      });
      logResult({
        name: "VSCode service",
        success: vscodeRes.ok || vscodeRes.status === 401,
        message: `HTTP ${vscodeRes.status} at ${vscodeUrl}`,
      });
    } catch (error) {
      logResult({
        name: "VSCode service",
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const nodeWorkerRes = await fetch(`${nodeWorkerUrl}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      logResult({
        name: "Node.js Worker service (Socket.IO)",
        success: nodeWorkerRes.ok,
        message: `HTTP ${nodeWorkerRes.status} at ${nodeWorkerUrl}/health`,
      });
    } catch (error) {
      logResult({
        name: "Node.js Worker service (Socket.IO)",
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const goWorkerRes = await fetch(`${goWorkerUrl}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      logResult({
        name: "Go Worker service (SSH proxy)",
        success: goWorkerRes.ok,
        message: `HTTP ${goWorkerRes.status} at ${goWorkerUrl}/health`,
      });
    } catch (error) {
      logResult({
        name: "Go Worker service (SSH proxy)",
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Cleanup if requested
  if (values.cleanup && createdInstance) {
    console.log("\n--- Cleanup ---");
    try {
      await client.deleteContainer(vmid);
      logResult({
        name: "Delete container",
        success: true,
        message: `Deleted VMID ${vmid}`,
      });
    } catch (error) {
      logResult({
        name: "Delete container",
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Summary
  console.log("\n==========================================");
  console.log("  Summary");
  console.log("==========================================\n");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${results.length}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.name}: ${r.message}`);
    }
  }

  if (createdInstance && !values.cleanup) {
    console.log(`\nContainer VMID ${vmid} was created and left running.`);
    console.log(`To cleanup: bun run scripts/pve/test-pve-cf-tunnel.ts --vmid ${vmid} --cleanup`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
