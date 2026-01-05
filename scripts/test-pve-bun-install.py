#!/usr/bin/env python3
"""Test background download bun installation on PVE LXC container.

This script tests the new bun installation approach that uses:
1. Background download (nohup curl) to avoid Cloudflare Tunnel ~100s timeout
2. Polling for completion with short HTTP requests
3. Extract and install after download completes

Usage:
    uv run --env-file .env ./scripts/test-pve-bun-install.py
"""

import asyncio
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
import uuid
from typing import Any


async def main():
    """Main entry point."""
    # Get PVE config from environment
    api_url = os.environ["PVE_API_URL"]
    api_token = os.environ["PVE_API_TOKEN"]
    public_domain = os.environ.get("PVE_PUBLIC_DOMAIN") or os.environ.get("PVE_CF_DOMAIN")

    if not public_domain:
        print("ERROR: PVE_PUBLIC_DOMAIN or PVE_CF_DOMAIN not set", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to {api_url}")
    print(f"Using domain: {public_domain}")

    # Use a temporary VMID for testing
    template_vmid = int(os.environ.get("PVE_TEST_TEMPLATE_VMID", "9000"))
    test_vmid = int(os.environ.get("PVE_TEST_VMID", "9999"))
    node = os.environ.get("PVE_NODE", "karl-ws")

    instance_id = os.environ.get("PVE_TEST_INSTANCE_ID")
    if not instance_id:
        instance_id = f"pvelxc-{uuid.uuid4().hex[:8]}"

    print(f"Template VMID: {template_vmid}")
    print(f"Test VMID: {test_vmid}")
    print(f"Instance ID: {instance_id}")
    print(f"Node: {node}")

    # PVE API headers (don't set Content-Type in base headers - set per request)
    headers = {
        "Authorization": f"PVEAPIToken={api_token}",
    }

    # SSL context that doesn't verify certs
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    def pve_api(method: str, endpoint: str, data: dict[str, Any] | None = None) -> Any:
        """Call PVE API."""
        url = f"{api_url}/api2/json{endpoint}"

        # PVE API uses form-encoded data, not JSON
        req_headers = headers.copy()
        req_data = None
        if data:
            req_headers["Content-Type"] = "application/x-www-form-urlencoded"
            req_data = urllib.parse.urlencode(data).encode("utf-8")

        req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)

        try:
            with urllib.request.urlopen(req, context=ssl_context, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            print(f"PVE API Error {e.code}: {error_body}")
            raise

    def normalize_host_id(value: str) -> str:
        return value.strip().lower().replace("_", "-")

    def run_http_exec(host_id: str, command: str, timeout: int = 120) -> tuple[int, str, str]:
        """Run command via HTTP exec using streaming JSON response."""
        exec_url = f"https://port-39375-{normalize_host_id(host_id)}.{public_domain}/exec"

        timeout_ms = timeout * 1000
        body = json.dumps({
            "command": f"HOME=/root {command}",
            "timeout_ms": timeout_ms,
        }).encode("utf-8")

        req = urllib.request.Request(
            exec_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []
        exit_code: int | None = None

        try:
            # Don't use custom ssl_context for exec URL - Cloudflare handles HTTPS
            with urllib.request.urlopen(req, timeout=timeout) as response:
                # Parse streaming JSON lines response
                for line in response:
                    line_str = line.decode("utf-8").strip()
                    if not line_str:
                        continue
                    try:
                        event = json.loads(line_str)
                        event_type = event.get("type")
                        if event_type == "stdout":
                            stdout_lines.append(event.get("data", ""))
                        elif event_type == "stderr":
                            stderr_lines.append(event.get("data", ""))
                        elif event_type == "exit":
                            exit_code = event.get("code", 0)
                        elif event_type == "error":
                            stderr_lines.append(event.get("message", "Unknown error"))
                            exit_code = 1
                    except json.JSONDecodeError:
                        # Non-JSON line, append to stderr for debugging
                        stderr_lines.append(line_str)

                # Default to 0 if no exit event received (matches snapshot-pvelxc.py behavior)
                if exit_code is None:
                    exit_code = 0

                return (exit_code, "".join(stdout_lines), "".join(stderr_lines))
        except urllib.error.HTTPError as e:
            return -1, "", f"HTTP {e.code}: {e.reason}"
        except urllib.error.URLError as e:
            return -1, "", f"URL Error: {e.reason}"
        except Exception as e:
            return -1, "", str(e)

    success = False

    try:
        # Check if test container already exists and delete it
        print(f"\nChecking for existing test container {test_vmid}...")
        try:
            pve_api("GET", f"/nodes/{node}/lxc/{test_vmid}/status/current")
            print(f"Deleting existing container {test_vmid}...")
            pve_api("DELETE", f"/nodes/{node}/lxc/{test_vmid}")
            await asyncio.sleep(3)
        except Exception:
            pass

        # Clone template with instance ID hostname
        print(f"\nCloning template {template_vmid} to {test_vmid} with hostname {instance_id}...")
        result = pve_api(
            "POST",
            f"/nodes/{node}/lxc/{template_vmid}/clone",
            {
                "newid": test_vmid,
                "full": 0,  # Linked clone
                "hostname": instance_id,
            }
        )

        # Wait for clone task to complete
        if "data" in result:
            upid = result["data"]
            print(f"Waiting for clone task {upid} to complete...")
            for i in range(120):  # 2 minutes timeout
                try:
                    task_status = pve_api("GET", f"/nodes/{node}/tasks/{upid}/status")
                    status = task_status.get("data", {}).get("status")
                    if status == "stopped":
                        exit_status = task_status.get("data", {}).get("exitstatus")
                        if exit_status == "OK":
                            print("Clone task completed successfully")
                            break
                        else:
                            raise RuntimeError(f"Clone task failed with status: {exit_status}")
                    elif i % 10 == 0 and i > 0:
                        print(f"  Still cloning... ({i}s elapsed, status: {status})")
                except Exception as e:
                    if i > 5:  # Allow a few retries at the start
                        print(f"  Error checking task status: {e}")
                await asyncio.sleep(1)
            else:
                raise RuntimeError("Clone task did not complete in 120 seconds")

        await asyncio.sleep(3)

        # Start container
        print(f"Starting container {test_vmid}...")
        try:
            # PVE start/stop commands don't need any body data
            pve_api("POST", f"/nodes/{node}/lxc/{test_vmid}/status/start")
        except urllib.error.HTTPError as e:
            error_msg = str(e.read().decode() if e.fp else "")
            if "already running" in error_msg:
                print("Container already running")
            else:
                raise

        await asyncio.sleep(5)

        # Wait for container to be ready
        print(f"Waiting for container {test_vmid} to be ready (HTTP exec available)...")
        for i in range(60):
            exit_code, stdout, stderr = run_http_exec(instance_id, "echo ready", timeout=5)
            if exit_code == 0:
                print(f"Container {test_vmid} is ready")
                break
            if i % 10 == 0 and i > 0:
                print(f"  Still waiting... ({i}s elapsed)")
            await asyncio.sleep(1)
        else:
            raise RuntimeError(f"Container {test_vmid} failed to become ready after 60s")

        print("\n" + "="*70)
        print("Testing BACKGROUND DOWNLOAD bun installation approach")
        print("(This avoids Cloudflare Tunnel ~100s timeout)")
        print("="*70 + "\n")

        # Step 1: Detect architecture and start background download
        print("Step 1: Detect arch and start background download...")
        start = time.time()
        cmd = """
set -eux
arch="$(uname -m)"
case "${arch}" in
  x86_64) bun_arch="x64" ;;
  aarch64|arm64) bun_arch="aarch64" ;;
  *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
esac

# Get latest bun version
BUN_VERSION="$(curl -fsSL https://api.github.com/repos/oven-sh/bun/releases/latest | jq -r '.tag_name' | sed 's/^bun-v//')"
echo "Installing bun v${BUN_VERSION} for ${bun_arch}..."

# Save arch for installation step
echo "${bun_arch}" > /tmp/bun-arch

# Download in background to avoid Cloudflare timeout
url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip"
nohup sh -c "curl -fsSL --retry 3 --retry-delay 5 -o /tmp/bun.zip '${url}' && touch /tmp/bun-download-done" > /tmp/bun-download.log 2>&1 &
echo "Background download started (PID: $!)"
"""
        exit_code, stdout, stderr = run_http_exec(instance_id, cmd, timeout=60)
        elapsed = time.time() - start
        print(f"  Completed in {elapsed:.1f}s")
        print(f"  Exit code: {exit_code}")
        if stdout:
            for line in stdout.strip().split("\n")[-5:]:
                print(f"  > {line}")
        if stderr and exit_code != 0:
            print(f"  Stderr: {stderr[:500]}")
        if exit_code != 0:
            raise RuntimeError(f"Step 1 failed with exit code {exit_code}")
        print("  [OK] Step 1 PASSED - Background download started")

        # Step 2: Poll for download completion
        print("\nStep 2: Polling for download completion...")
        poll_start = time.time()
        max_wait = 300  # 5 minutes max
        poll_interval = 10
        elapsed = 0

        while elapsed < max_wait:
            exit_code, stdout, stderr = run_http_exec(
                instance_id,
                "[ -f /tmp/bun-download-done ] && echo done || echo waiting",
                timeout=15
            )
            if "done" in stdout:
                poll_elapsed = time.time() - poll_start
                print(f"  Download completed after {poll_elapsed:.1f}s of polling")
                break

            # Check for download failure after initial delay
            if elapsed > 30:
                _, stdout2, _ = run_http_exec(
                    instance_id,
                    "pgrep -f 'curl.*bun.zip' > /dev/null && echo running || echo stopped",
                    timeout=15
                )
                if "stopped" in stdout2 and "done" not in stdout:
                    # Download process stopped but didn't complete
                    _, log_output, _ = run_http_exec(
                        instance_id,
                        "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                        timeout=15
                    )
                    raise RuntimeError(f"Bun download failed:\n{log_output}")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            if elapsed % 30 == 0:
                print(f"  Still downloading... ({elapsed}s)")
        else:
            # Timeout - get the log for debugging
            exit_code, log_output, _ = run_http_exec(
                instance_id,
                "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                timeout=15
            )
            raise TimeoutError(f"Bun download timed out after {max_wait}s\nLog: {log_output}")

        print("  [OK] Step 2 PASSED - Download completed")

        # Step 3: Extract and install bun
        print("\nStep 3: Extract and install bun...")
        start = time.time()
        cmd = """
set -eux
bun_arch="$(cat /tmp/bun-arch)"
cd /tmp
unzip -o bun.zip
install -m 0755 "bun-linux-${bun_arch}/bun" /usr/local/bin/bun
ln -sf /usr/local/bin/bun /usr/local/bin/bunx

# Cleanup
rm -rf /tmp/bun.zip /tmp/bun-linux-* /tmp/bun-arch /tmp/bun-download-done /tmp/bun-download.log

# Verify
bun --version
bunx --version
"""
        exit_code, stdout, stderr = run_http_exec(instance_id, cmd, timeout=60)
        elapsed = time.time() - start
        print(f"  Completed in {elapsed:.1f}s")
        print(f"  Exit code: {exit_code}")
        if stdout:
            print(f"  Output:\n{stdout}")
        if stderr and exit_code != 0:
            print(f"  Stderr: {stderr[:200]}")
        if exit_code != 0:
            raise RuntimeError(f"Step 3 failed with exit code {exit_code}")
        print("  [OK] Step 3 PASSED - Bun installed")

        # Step 4: Final verification
        print("\nStep 4: Final verification...")
        exit_code, stdout, stderr = run_http_exec(
            instance_id,
            "which bun && bun --version && which bunx && bunx --version",
            timeout=10
        )
        print(f"  Exit code: {exit_code}")
        if stdout:
            print(f"  Verification output:\n{stdout}")

        if exit_code == 0:
            print("\n" + "="*70)
            print("[OK] BACKGROUND DOWNLOAD bun installation test PASSED")
            print("="*70)
            print("\nAll steps completed successfully without Cloudflare timeout!")
            print("Key insight: Each HTTP request completes in <60s, avoiding ~100s CF limit")
            success = True
        else:
            print("\n" + "="*70)
            print("[FAIL] Background download bun installation test FAILED")
            print("="*70)
            success = False

    except Exception as e:
        print(f"\n{'='*70}")
        print(f"ERROR: {e}")
        print('='*70)
        import traceback
        traceback.print_exc()
        success = False

    finally:
        # Cleanup: stop and delete test container
        print(f"\nCleaning up test container {test_vmid}...")
        try:
            pve_api("POST", f"/nodes/{node}/lxc/{test_vmid}/status/stop")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"Note: Stop may have failed (container might already be stopped): {e}")

        try:
            pve_api("DELETE", f"/nodes/{node}/lxc/{test_vmid}")
            print(f"[OK] Test container {test_vmid} deleted")
        except Exception as e:
            print(f"Warning: Failed to delete test container: {e}")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
