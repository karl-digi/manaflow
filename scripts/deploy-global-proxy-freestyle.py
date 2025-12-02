#!/usr/bin/env python3
"""Deploy global-proxy to a Freestyle VM.

This script creates a persistent Freestyle VM that builds and runs global-proxy.
The VM is configured with:
- persistence: { type: "persistent" } - won't be evicted
- recreate: true - auto-recreates if deleted
- idleTimeoutSeconds: null - never suspends due to inactivity

The source code is uploaded directly and built on the VM.

Usage:
    python scripts/deploy-global-proxy-freestyle.py

Environment variables:
    FREESTYLE_API_KEY: Required. Your Freestyle API key.
    FREESTYLE_API_BASE_URL: Optional. Defaults to https://api.freestyle.sh
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import sys
import tarfile
from pathlib import Path

from freestyle_client import ApiClient, Configuration, VMApi
from freestyle_client.models.create_vm_request import CreateVmRequest
from freestyle_client.models.exec_await_request import ExecAwaitRequest
from freestyle_client.models.freestyle_file import FreestyleFile
from freestyle_client.models.port_mapping import PortMapping
from freestyle_client.models.systemd_config import SystemdConfig
from freestyle_client.models.systemd_restart_policy_kind import SystemdRestartPolicyKind
from freestyle_client.models.systemd_unit_mode import SystemdUnitMode
from freestyle_client.models.systemd_unit_spec import SystemdUnitSpec
from freestyle_client.models.vm_persistence import VmPersistence
from freestyle_client.models.vm_persistence_one_of2 import VmPersistenceOneOf2

FREESTYLE_API_KEY = os.environ.get("FREESTYLE_API_KEY")
FREESTYLE_API_BASE_URL = os.environ.get(
    "FREESTYLE_API_BASE_URL", "https://api.freestyle.sh"
)

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
GLOBAL_PROXY_DIR = PROJECT_ROOT / "apps" / "global-proxy"


def create_source_tarball() -> str:
    """Create a base64-encoded tarball of the global-proxy source code."""
    print("[Build] Creating source tarball...")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # Add Cargo.toml
        tar.add(GLOBAL_PROXY_DIR / "Cargo.toml", arcname="global-proxy/Cargo.toml")
        # Add Cargo.lock
        tar.add(GLOBAL_PROXY_DIR / "Cargo.lock", arcname="global-proxy/Cargo.lock")
        # Add src directory
        for src_file in (GLOBAL_PROXY_DIR / "src").rglob("*"):
            if src_file.is_file():
                arcname = "global-proxy/src/" + str(src_file.relative_to(GLOBAL_PROXY_DIR / "src"))
                tar.add(src_file, arcname=arcname)

    tarball_bytes = buf.getvalue()
    print(f"[Build] Tarball size: {len(tarball_bytes)} bytes")
    return base64.b64encode(tarball_bytes).decode("ascii")


def run_command(vm_api: VMApi, vm_id: str, command: str, *, timeout_ms: int = 300000) -> bool:
    """Run a command on the VM and print output. Returns True on success."""
    print(f"[VM] Running: {command}")
    result = vm_api.exec_await(
        vm_id,
        ExecAwaitRequest.model_validate({"command": command, "timeoutMs": timeout_ms}),
    )
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.status_code != 0:
        print(f"[VM] Command failed with exit code {result.status_code}", file=sys.stderr)
        return False
    return True


def create_global_proxy_vm(
    *,
    dry_run: bool = False,
) -> None:
    """Create a Freestyle VM running global-proxy."""
    if not FREESTYLE_API_KEY:
        print(
            "FREESTYLE_API_KEY is required. Export it before running this script.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Create source tarball
    source_tarball_b64 = create_source_tarball()

    # Environment variables for the global-proxy service
    # Using port 3000 which is Freestyle's default exposed port
    env_vars = {
        "PORT": "3000",
        "GLOBAL_PROXY_BACKEND_SCHEME": "https",
        "GLOBAL_PROXY_MORPH_DOMAIN_SUFFIX": ".http.cloud.morph.so",
        "GLOBAL_PROXY_WORKSPACE_DOMAIN_SUFFIX": ".vm.freestyle.sh",
        "GLOBAL_PROXY_FREESTYLE_DOMAIN_SUFFIX": ".vm.freestyle.sh",
        "RUST_LOG": "global_proxy=info,hyper=warn",
    }

    # Systemd service configuration
    systemd_config = SystemdConfig(
        services=[
            SystemdUnitSpec.model_validate({
                "name": "global-proxy",
                "mode": SystemdUnitMode.SERVICE,
                "exec": ["/usr/local/bin/global-proxy"],
                "env": env_vars,
                "workdir": "/",
                "enable": True,
                "restartPolicy": {
                    "policy": SystemdRestartPolicyKind.ALWAYS,
                    "restartSec": 5,
                },
            }),
        ],
    )

    # Port mapping: external 443 -> internal 3000
    # Freestyle only allows external ports 443 and 8081
    ports = [
        PortMapping.model_validate({"port": 443, "targetPort": 3000}),
    ]

    # Persistence configuration - type: "persistent"
    persistence = VmPersistence(VmPersistenceOneOf2(type="persistent"))

    # Build script
    build_script = """#!/bin/bash
set -e

echo "=== Installing Rust ==="
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

echo "=== Extracting source ==="
cd /tmp
base64 -d /root/source.tar.gz.b64 > source.tar.gz
tar xzf source.tar.gz

echo "=== Building global-proxy ==="
cd /tmp/global-proxy
cargo build --release

echo "=== Installing binary ==="
cp /tmp/global-proxy/target/release/global-proxy /usr/local/bin/
chmod +x /usr/local/bin/global-proxy

echo "=== Cleanup ==="
rm -rf /tmp/global-proxy /tmp/source.tar.gz /root/source.tar.gz.b64

echo "=== Done ==="
ls -la /usr/local/bin/global-proxy
"""

    additional_files = {
        "/root/source.tar.gz.b64": FreestyleFile(content=source_tarball_b64),
        "/root/build-global-proxy.sh": FreestyleFile(content=build_script),
    }

    # Create the VM request
    request = CreateVmRequest.model_validate({
        "idleTimeoutSeconds": None,
        "ports": [p.to_dict() for p in ports],
        "persistence": persistence.to_dict(),
        "recreate": True,
        "systemd": systemd_config.to_dict(),
        "additionalFiles": {k: v.to_dict() for k, v in additional_files.items()},
        "waitForReadySignal": False,
    })

    if dry_run:
        print("[Deploy] Dry run - would create VM with config:")
        # Don't print the full tarball
        print(f"  Source tarball size: {len(source_tarball_b64)} bytes (base64)")
        return

    print(f"[Deploy] Creating VM on {FREESTYLE_API_BASE_URL}...")

    config = Configuration(host=FREESTYLE_API_BASE_URL)

    with ApiClient(config) as api_client:
        api_client.set_default_header("Authorization", f"Bearer {FREESTYLE_API_KEY}")
        vm_api = VMApi(api_client)

        result = vm_api.create_vm(request)

        print("[Deploy] VM created!")
        print(f"  ID: {result.id}")
        if result.domains:
            print(f"  Domains: {', '.join(result.domains)}")

        # Install build dependencies
        print("\n[Deploy] Installing build dependencies...")
        if not run_command(vm_api, result.id, "apt-get update"):
            print("[Deploy] Warning: apt-get update failed", file=sys.stderr)

        if not run_command(vm_api, result.id, "apt-get install -y curl build-essential pkg-config libssl-dev"):
            print("[Deploy] Failed to install dependencies", file=sys.stderr)
            sys.exit(1)

        # Run build script
        print("\n[Deploy] Building global-proxy (this may take a few minutes)...")
        if not run_command(vm_api, result.id, "chmod +x /root/build-global-proxy.sh"):
            sys.exit(1)

        # Build with longer timeout (10 minutes)
        if not run_command(vm_api, result.id, "/root/build-global-proxy.sh", timeout_ms=600000):
            print("[Deploy] Build failed", file=sys.stderr)
            sys.exit(1)

        # Start the service
        print("\n[Deploy] Starting global-proxy service...")
        if not run_command(vm_api, result.id, "systemctl daemon-reload"):
            print("[Deploy] Warning: daemon-reload failed", file=sys.stderr)

        if not run_command(vm_api, result.id, "systemctl start global-proxy"):
            print("[Deploy] Failed to start service", file=sys.stderr)
            # Try to get more info
            run_command(vm_api, result.id, "journalctl -u global-proxy -n 50")
            sys.exit(1)

        # Check service status
        print("\n[Deploy] Checking service status...")
        run_command(vm_api, result.id, "systemctl status global-proxy")

        print(f"\n{'='*50}")
        print("[Deploy] Global proxy deployed successfully!")
        print(f"  VM ID: {result.id}")
        if result.domains:
            print(f"  URL: https://{result.domains[0]}")
        print(f"{'='*50}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deploy global-proxy to a Freestyle VM"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the VM configuration without creating it",
    )

    args = parser.parse_args()

    create_global_proxy_vm(
        dry_run=bool(args.dry_run),
    )


if __name__ == "__main__":
    main()
