#!/usr/bin/env python3
"""
Test script for PVE LXC git-diff functionality.
This tests the git clone + patch approach in isolation without running full snapshot.

Usage:
    uv run --env-file .env ./scripts/test-pve-gitdiff.py --instance-id <pvelxc-id>
    uv run --env-file .env ./scripts/test-pve-gitdiff.py --vmid <running-container-vmid>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import subprocess
import ssl
import sys
import tempfile
import textwrap
import typing as t
import urllib.parse
import urllib.request
from pathlib import Path

import dotenv


def _exec_git(repo_root: Path, args: list[str]) -> str | None:
    """Execute git command in repo."""
    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")
    completed = subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode == 0:
        return completed.stdout
    return None


def get_git_remote_url(repo_root: Path) -> str | None:
    """Get the git remote origin URL."""
    output = _exec_git(repo_root, ["remote", "get-url", "origin"])
    return output.strip() if output else None


def get_current_branch(repo_root: Path) -> str | None:
    """Get the current branch name."""
    output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
    if output:
        branch = output.strip()
        if branch != "HEAD":
            return branch
    return None


def get_upstream_branch(repo_root: Path) -> str | None:
    """Get the upstream tracking branch."""
    output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "@{upstream}"])
    return output.strip() if output else None


def get_remote_branch_commit(repo_root: Path, remote_branch: str) -> str | None:
    """Get commit hash of remote branch."""
    output = _exec_git(repo_root, ["rev-parse", remote_branch])
    return output.strip() if output else None


def create_full_diff_patch(repo_root: Path, base_ref: str) -> Path | None:
    """Create diff patch including unpushed commits + uncommitted changes."""
    tmp = tempfile.NamedTemporaryFile(suffix=".patch", delete=False, mode="wb")
    tmp_path = Path(tmp.name)
    tmp.close()

    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")

    completed = subprocess.run(
        ["git", "diff", "--binary", base_ref],
        cwd=str(repo_root),
        env=env,
        capture_output=True,
        check=False,
    )

    if not completed.stdout.strip():
        print(f"[test] No differences from {base_ref}")
        tmp_path.unlink(missing_ok=True)
        return None

    tmp_path.write_bytes(completed.stdout)
    print(f"[test] Created patch: {tmp_path.stat().st_size} bytes")
    return tmp_path


class PveExecClient:
    """Simple client for HTTP exec via Cloudflare Tunnel."""

    def __init__(self, cf_domain: str):
        self.cf_domain = cf_domain

    def _normalize_host_id(self, value: str) -> str:
        return value.strip().lower().replace("_", "-")

    def build_exec_url(
        self,
        *,
        instance_id: str | None = None,
        vmid: int | None = None,
    ) -> str:
        if instance_id:
            host_id = self._normalize_host_id(instance_id)
            return f"https://port-39375-{host_id}.{self.cf_domain}/exec"
        if vmid is None:
            raise ValueError("instance_id or vmid is required to build exec URL")
        return f"https://port-39375-vm-{vmid}.{self.cf_domain}/exec"

    def http_exec(
        self,
        *,
        instance_id: str | None = None,
        vmid: int | None = None,
        command: str,
        timeout: float = 300,
    ) -> tuple[int, str, str]:
        """Execute command via HTTP exec. Returns (exit_code, stdout, stderr)."""
        exec_url = self.build_exec_url(instance_id=instance_id, vmid=vmid)
        timeout_ms = int(timeout * 1000)
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
            with urllib.request.urlopen(req, timeout=timeout) as response:
                for line in response:
                    line_str = line.decode("utf-8").strip()
                    if not line_str:
                        continue
                    try:
                        event = json.loads(line_str)
                        if event.get("type") == "stdout":
                            stdout_lines.append(event.get("data", ""))
                        elif event.get("type") == "stderr":
                            stderr_lines.append(event.get("data", ""))
                        elif event.get("type") == "exit":
                            exit_code = event.get("code", 0)
                        elif event.get("type") == "error":
                            stderr_lines.append(event.get("message", "Unknown error"))
                            exit_code = 1
                    except json.JSONDecodeError:
                        stderr_lines.append(line_str)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            return 1, "", f"HTTP error {e.code}: {e.reason}\n{error_body}"
        except urllib.error.URLError as e:
            return 1, "", f"URL error: {e}"

        return exit_code or 0, "".join(stdout_lines), "".join(stderr_lines)


async def test_git_diff(
    *,
    instance_id: str | None,
    vmid: int | None,
    cf_domain: str,
    repo_root: Path,
) -> None:
    """Test the git-diff upload approach."""
    client = PveExecClient(cf_domain)
    remote_repo_root = "/tmp/cmux-test"
    target_label = instance_id or (f"vmid {vmid}" if vmid is not None else "unknown")

    print(f"\n=== Testing git-diff upload for container {target_label} ===\n")

    # Step 1: Get git info
    remote_url = get_git_remote_url(repo_root)
    if not remote_url:
        print("[FAIL] No git remote URL found")
        return

    current_branch = get_current_branch(repo_root)
    if not current_branch:
        print("[FAIL] Not on a branch (detached HEAD)")
        return

    upstream_branch = get_upstream_branch(repo_root)
    if not upstream_branch:
        upstream_branch = f"origin/{current_branch}"
        print(f"[WARN] No upstream tracking branch, assuming {upstream_branch}")

    upstream_commit = get_remote_branch_commit(repo_root, upstream_branch)
    if not upstream_commit:
        print(f"[FAIL] Cannot find upstream branch {upstream_branch}")
        return

    print(f"[OK] Remote: {remote_url}")
    print(f"[OK] Branch: {current_branch}")
    print(f"[OK] Upstream: {upstream_branch} ({upstream_commit[:12]})")

    # Step 2: Test HTTP exec connectivity
    print("\n--- Testing HTTP exec connectivity ---")
    exit_code, stdout, stderr = client.http_exec(
        instance_id=instance_id,
        vmid=vmid,
        command="echo 'HTTP exec works!'"
    )
    if exit_code != 0:
        print(f"[FAIL] HTTP exec failed: {stderr}")
        return
    print(f"[OK] HTTP exec works: {stdout.strip()}")

    # Step 3: Test git clone with retries
    print("\n--- Testing git clone with retries ---")
    remote_branch_name = "/".join(upstream_branch.split("/")[1:])

    clone_cmd = textwrap.dedent(
        f"""
        bash -c 'set -euo pipefail
        REPO_DIR={shlex.quote(remote_repo_root)}
        REMOTE_URL={shlex.quote(remote_url)}
        BRANCH={shlex.quote(remote_branch_name)}
        TARGET_COMMIT={shlex.quote(upstream_commit)}

        rm -rf "$REPO_DIR"
        echo "[test] Cloning repository from GitHub..."
        git clone --branch "$BRANCH" --single-branch "$REMOTE_URL" "$REPO_DIR" || {{
            echo "[test] Branch clone failed, trying full clone..."
            git clone "$REMOTE_URL" "$REPO_DIR"
        }}
        cd "$REPO_DIR"
        git checkout -f "$TARGET_COMMIT"
        git clean -fd
        echo "[test] Repository at commit $(git rev-parse --short HEAD)"
        '
        """
    ).strip()

    max_attempts = 3
    delay = 5.0
    for attempt in range(1, max_attempts + 1):
        print(f"[test] Clone attempt {attempt}/{max_attempts}...")
        exit_code, stdout, stderr = client.http_exec(
            instance_id=instance_id,
            vmid=vmid,
            command=clone_cmd,
            timeout=300,
        )

        if exit_code == 0:
            print(f"[OK] Clone succeeded on attempt {attempt}")
            for line in stdout.splitlines():
                print(f"  {line}")
            break

        # Check for transient errors
        is_transient = any(
            err in stderr
            for err in ["502", "503", "504", "Bad Gateway", "Service Unavailable", "Gateway Timeout"]
        )

        if not is_transient or attempt >= max_attempts:
            print(f"[FAIL] Clone failed: {stderr}")
            print(f"  stdout: {stdout}")
            return

        print(f"[WARN] Transient error, retrying in {delay}s...")
        await asyncio.sleep(delay)
        delay *= 2

    # Step 4: Create and test patch
    print("\n--- Testing patch creation and upload ---")
    patch_path = create_full_diff_patch(repo_root, upstream_branch)

    if patch_path is None:
        print("[OK] No local changes to patch (working tree matches upstream)")
    else:
        # Test patch upload via base64
        import base64
        with open(patch_path, "rb") as f:
            patch_data = f.read()
        patch_size = len(patch_data)
        b64_data = base64.b64encode(patch_data).decode("ascii")

        print(f"[test] Patch size: {patch_size} bytes, base64: {len(b64_data)} bytes")

        remote_patch_path = "/tmp/cmux-test.patch"
        upload_cmd = f"mkdir -p /tmp && echo '{b64_data}' | base64 -d > {remote_patch_path}"

        print("[test] Uploading patch via base64...")
        exit_code, stdout, stderr = client.http_exec(
            instance_id=instance_id,
            vmid=vmid,
            command=upload_cmd,
            timeout=120,
        )

        if exit_code != 0:
            print(f"[FAIL] Patch upload failed: {stderr}")
            patch_path.unlink(missing_ok=True)
            return
        print("[OK] Patch uploaded")

        # Apply patch
        apply_cmd = textwrap.dedent(
            f"""
            bash -c 'set -euo pipefail
            cd {shlex.quote(remote_repo_root)}
            git apply --whitespace=nowarn {remote_patch_path}
            rm -f {remote_patch_path}
            echo "[test] Patch applied successfully"
            '
            """
        ).strip()

        print("[test] Applying patch...")
        exit_code, stdout, stderr = client.http_exec(
            instance_id=instance_id,
            vmid=vmid,
            command=apply_cmd,
            timeout=120,
        )

        if exit_code != 0:
            print(f"[WARN] Patch apply failed: {stderr}")
        else:
            print(f"[OK] Patch applied: {stdout.strip()}")

        patch_path.unlink(missing_ok=True)

    # Step 5: Verify final state
    print("\n--- Verifying final state ---")
    verify_cmd = f"cd {shlex.quote(remote_repo_root)} && git log -1 --oneline && ls -la"
    exit_code, stdout, stderr = client.http_exec(
        instance_id=instance_id,
        vmid=vmid,
        command=verify_cmd,
        timeout=30,
    )

    if exit_code != 0:
        print(f"[FAIL] Verification failed: {stderr}")
    else:
        print("[OK] Final state:")
        for line in stdout.splitlines():
            print(f"  {line}")

    # Cleanup
    print("\n--- Cleanup ---")
    cleanup_cmd = f"rm -rf {shlex.quote(remote_repo_root)}"
    client.http_exec(instance_id=instance_id, vmid=vmid, command=cleanup_cmd, timeout=30)
    print("[OK] Cleanup done")

    print("\n=== Test completed successfully ===")


def main():
    dotenv.load_dotenv()

    parser = argparse.ArgumentParser(description="Test PVE git-diff upload")
    parser.add_argument("--vmid", type=int, help="VMID of running container (legacy URL pattern)")
    parser.add_argument("--instance-id", help="Instance ID/hostname for instanceId-based URLs")
    parser.add_argument("--repo-root", default=".", help="Repository root (default: current directory)")
    args = parser.parse_args()

    cf_domain = os.environ.get("PVE_CF_DOMAIN") or os.environ.get("PVE_PUBLIC_DOMAIN")
    if not cf_domain:
        print("ERROR: PVE_CF_DOMAIN or PVE_PUBLIC_DOMAIN must be set")
        sys.exit(1)

    if not args.vmid and not args.instance_id:
        print("ERROR: --instance-id or --vmid is required")
        sys.exit(1)

    print(f"Using Cloudflare domain: {cf_domain}")
    print(f"Testing with container: {args.instance_id or args.vmid}")

    repo_root = Path(args.repo_root).resolve()
    asyncio.run(
        test_git_diff(
            instance_id=args.instance_id,
            vmid=args.vmid,
            cf_domain=cf_domain,
            repo_root=repo_root,
        )
    )


if __name__ == "__main__":
    main()
