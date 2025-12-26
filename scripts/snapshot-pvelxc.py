#!/usr/bin/env python3
"""
Provision Proxmox VE LXC containers from an existing base template, perform
parallelized environment setup that mirrors the Morph snapshot workflow, and
create snapshots for multiple presets (standard + boosted).

This is the PVE LXC equivalent of snapshot.py for self-hosted cmux sandboxes.

The flow:
1. Clone LXC container per preset from the provided base template
2. Start containers and wait for SSH/network
3. Execute dependency graph tasks concurrently via SSH/exec
4. Run in-container sanity checks (cargo/node/bun/uv/envd/envctl + service curls)
5. Snapshot the configured container and record in pve-lxc-snapshots.json

Required environment variables:
    PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
    PVE_API_TOKEN - API token in format: user@realm!tokenid=secret

Examples:
    uv run --env-file .env ./scripts/snapshot-pvelxc.py
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --standard-vcpus 4 --standard-memory 6144
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import shutil
import ssl
import subprocess
import sys
import textwrap
import traceback
import typing as t
import urllib.parse
import urllib.request

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import dotenv

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VSCODE_HTTP_PORT = 39378
WORKER_HTTP_PORT = 39377
PROXY_HTTP_PORT = 39379
VNC_HTTP_PORT = 39380
CDP_HTTP_PORT = 39381
XTERM_HTTP_PORT = 39383

PVE_SNAPSHOT_MANIFEST_PATH = (
    Path(__file__).resolve().parent.parent / "packages/shared/src/pve-lxc-snapshots.json"
)
CURRENT_MANIFEST_SCHEMA_VERSION = 1

# Default template VMID (should be created via pve-lxc-template.sh)
DEFAULT_TEMPLATE_VMID = 9000

# ---------------------------------------------------------------------------
# Console and timing helpers
# ---------------------------------------------------------------------------


class Console:
    """Simple console output wrapper."""

    def __init__(self, verbose: bool = True) -> None:
        self._verbose = verbose

    def info(self, message: str) -> None:
        if self._verbose:
            print(f"[INFO] {message}", flush=True)

    def always(self, message: str) -> None:
        print(message, flush=True)


@dataclass
class TimingsCollector:
    """Collect task execution timings."""

    _timings: dict[str, float] = field(default_factory=dict)

    def record(self, task_name: str, duration: float) -> None:
        self._timings[task_name] = duration

    def summary(self) -> list[str]:
        if not self._timings:
            return []
        lines = ["Task Timings:"]
        for name, duration in sorted(self._timings.items(), key=lambda x: -x[1]):
            lines.append(f"  {name}: {duration:.2f}s")
        return lines


# ---------------------------------------------------------------------------
# PVE API Client
# ---------------------------------------------------------------------------


class PveLxcClient:
    """Proxmox VE API client for LXC container management."""

    def __init__(
        self,
        api_url: str,
        api_token: str,
        node: str | None = None,
        verify_ssl: bool = False,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.node = node
        self.verify_ssl = verify_ssl

        # Parse token: user@realm!tokenid=secret
        token_parts = api_token.split("=", 1)
        if len(token_parts) != 2:
            raise ValueError(
                f"Invalid PVE_API_TOKEN format. Expected 'user@realm!tokenid=secret'"
            )
        self.token_id = token_parts[0]
        self.token_secret = token_parts[1]

        # Create SSL context
        self._ssl_context: ssl.SSLContext | None = None
        if not verify_ssl:
            self._ssl_context = ssl.create_default_context()
            self._ssl_context.check_hostname = False
            self._ssl_context.verify_mode = ssl.CERT_NONE

    def _request(
        self,
        method: str,
        endpoint: str,
        data: dict[str, t.Any] | None = None,
    ) -> dict[str, t.Any]:
        """Make authenticated API request."""
        url = f"{self.api_url}{endpoint}"
        headers = {
            "Authorization": f"PVEAPIToken={self.token_id}={self.token_secret}",
        }

        body: bytes | None = None
        if data:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            body = urllib.parse.urlencode(data).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(
                req,
                context=self._ssl_context,
                timeout=60,
            ) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"PVE API error {e.code}: {e.reason}\n{error_body}"
            ) from e

    async def _arequest(
        self,
        method: str,
        endpoint: str,
        data: dict[str, t.Any] | None = None,
    ) -> dict[str, t.Any]:
        """Async wrapper for API request."""
        return await asyncio.to_thread(self._request, method, endpoint, data)

    def get_version(self) -> dict[str, t.Any]:
        """Get PVE version info."""
        return self._request("GET", "/api2/json/version")

    def get_node(self) -> str:
        """Get the target node (auto-detect if not set)."""
        if self.node:
            return self.node
        result = self._request("GET", "/api2/json/nodes")
        nodes = result.get("data", [])
        if not nodes:
            raise RuntimeError("No nodes found in PVE cluster")
        self.node = nodes[0]["node"]
        return self.node

    async def aget_node(self) -> str:
        """Async get node."""
        return await asyncio.to_thread(self.get_node)

    def list_lxc(self, node: str | None = None) -> list[dict[str, t.Any]]:
        """List LXC containers on a node."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc")
        return result.get("data", [])

    async def alist_lxc(self, node: str | None = None) -> list[dict[str, t.Any]]:
        """Async list LXC containers."""
        return await asyncio.to_thread(self.list_lxc, node)

    def get_lxc_status(self, vmid: int, node: str | None = None) -> dict[str, t.Any]:
        """Get LXC container status."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/status/current")
        return result.get("data", {})

    async def aget_lxc_status(
        self, vmid: int, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get LXC status."""
        return await asyncio.to_thread(self.get_lxc_status, vmid, node)

    def get_lxc_config(self, vmid: int, node: str | None = None) -> dict[str, t.Any]:
        """Get LXC container config."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/config")
        return result.get("data", {})

    def clone_lxc(
        self,
        source_vmid: int,
        new_vmid: int,
        *,
        hostname: str | None = None,
        full: bool = True,
        node: str | None = None,
    ) -> str:
        """Clone an LXC container. Returns task UPID."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {
            "newid": new_vmid,
            "full": 1 if full else 0,
        }
        if hostname:
            data["hostname"] = hostname
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{source_vmid}/clone",
            data,
        )
        return result.get("data", "")

    async def aclone_lxc(
        self,
        source_vmid: int,
        new_vmid: int,
        *,
        hostname: str | None = None,
        full: bool = True,
        node: str | None = None,
    ) -> str:
        """Async clone LXC."""
        return await asyncio.to_thread(
            self.clone_lxc, source_vmid, new_vmid,
            hostname=hostname, full=full, node=node
        )

    def start_lxc(self, vmid: int, node: str | None = None) -> str:
        """Start LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/start",
        )
        return result.get("data", "")

    async def astart_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async start LXC."""
        return await asyncio.to_thread(self.start_lxc, vmid, node)

    def stop_lxc(self, vmid: int, node: str | None = None) -> str:
        """Stop LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/stop",
        )
        return result.get("data", "")

    async def astop_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async stop LXC."""
        return await asyncio.to_thread(self.stop_lxc, vmid, node)

    def shutdown_lxc(self, vmid: int, node: str | None = None) -> str:
        """Gracefully shutdown LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/shutdown",
        )
        return result.get("data", "")

    def delete_lxc(self, vmid: int, node: str | None = None) -> str:
        """Delete LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "DELETE",
            f"/api2/json/nodes/{node}/lxc/{vmid}",
        )
        return result.get("data", "")

    async def adelete_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async delete LXC."""
        return await asyncio.to_thread(self.delete_lxc, vmid, node)

    def set_lxc_config(
        self,
        vmid: int,
        *,
        cores: int | None = None,
        memory: int | None = None,
        node: str | None = None,
    ) -> None:
        """Update LXC container configuration."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {}
        if cores is not None:
            data["cores"] = cores
        if memory is not None:
            data["memory"] = memory
        if data:
            self._request(
                "PUT",
                f"/api2/json/nodes/{node}/lxc/{vmid}/config",
                data,
            )

    async def aset_lxc_config(
        self,
        vmid: int,
        *,
        cores: int | None = None,
        memory: int | None = None,
        node: str | None = None,
    ) -> None:
        """Async set LXC config."""
        await asyncio.to_thread(
            self.set_lxc_config, vmid, cores=cores, memory=memory, node=node
        )

    def create_snapshot(
        self,
        vmid: int,
        snapname: str,
        *,
        description: str | None = None,
        node: str | None = None,
    ) -> str:
        """Create LXC snapshot. Returns task UPID."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {"snapname": snapname}
        if description:
            data["description"] = description
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/snapshot",
            data,
        )
        return result.get("data", "")

    async def acreate_snapshot(
        self,
        vmid: int,
        snapname: str,
        *,
        description: str | None = None,
        node: str | None = None,
    ) -> str:
        """Async create snapshot."""
        return await asyncio.to_thread(
            self.create_snapshot, vmid, snapname, description=description, node=node
        )

    def list_snapshots(
        self, vmid: int, node: str | None = None
    ) -> list[dict[str, t.Any]]:
        """List snapshots for LXC container."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/snapshot")
        return result.get("data", [])

    def get_task_status(self, upid: str, node: str | None = None) -> dict[str, t.Any]:
        """Get task status."""
        node = node or self.get_node()
        # URL-encode the UPID since it contains special characters
        encoded_upid = urllib.parse.quote(upid, safe="")
        result = self._request("GET", f"/api2/json/nodes/{node}/tasks/{encoded_upid}/status")
        return result.get("data", {})

    async def aget_task_status(
        self, upid: str, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get task status."""
        return await asyncio.to_thread(self.get_task_status, upid, node)

    async def await_task(
        self,
        upid: str,
        *,
        timeout: int = 600,
        poll_interval: float = 2.0,
        node: str | None = None,
    ) -> dict[str, t.Any]:
        """Wait for a task to complete."""
        node = node or await self.aget_node()
        elapsed = 0.0
        while elapsed < timeout:
            status = await self.aget_task_status(upid, node)
            if status.get("status") == "stopped":
                exitstatus = status.get("exitstatus", "")
                if exitstatus == "OK":
                    return status
                raise RuntimeError(f"Task failed: {exitstatus}")
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        raise TimeoutError(f"Task {upid} timed out after {timeout}s")

    def find_next_vmid(self, node: str | None = None) -> int:
        """Find the next available VMID."""
        node = node or self.get_node()
        containers = self.list_lxc(node)
        used_vmids = {c["vmid"] for c in containers}

        # Also check QEMU VMs
        try:
            result = self._request("GET", f"/api2/json/nodes/{node}/qemu")
            vms = result.get("data", [])
            used_vmids.update(v["vmid"] for v in vms)
        except Exception:
            pass

        vmid = 100
        while vmid in used_vmids:
            vmid += 1
        return vmid

    async def afind_next_vmid(self, node: str | None = None) -> int:
        """Async find next VMID."""
        return await asyncio.to_thread(self.find_next_vmid, node)


# ---------------------------------------------------------------------------
# Manifest types and helpers
# ---------------------------------------------------------------------------


class PveSnapshotVersionEntry(t.TypedDict):
    version: int
    vmid: int
    snapshotName: str
    capturedAt: str


class PveSnapshotPresetEntry(t.TypedDict):
    presetId: str
    label: str
    cpu: str
    memory: str
    disk: str
    versions: list[PveSnapshotVersionEntry]
    description: t.NotRequired[str]


class PveSnapshotManifestEntry(t.TypedDict):
    schemaVersion: int
    updatedAt: str
    templateVmid: int
    node: str
    presets: list[PveSnapshotPresetEntry]


@dataclass(slots=True, frozen=True)
class SnapshotPresetPlan:
    preset_id: str
    label: str
    cpu_display: str
    memory_display: str
    disk_display: str
    vcpus: int
    memory_mib: int
    disk_size_mib: int


@dataclass(slots=True)
class SnapshotRunResult:
    preset: SnapshotPresetPlan
    vmid: int
    snapshot_name: str
    captured_at: str
    node: str


def _iso_timestamp() -> str:
    return (
        datetime.now(tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _format_cpu_display(vcpus: int) -> str:
    return f"{vcpus} vCPU"


def _format_memory_display(memory_mib: int) -> str:
    memory_gb = max(memory_mib // 1024, 1)
    return f"{memory_gb} GB RAM"


def _format_disk_display(disk_size_mib: int) -> str:
    disk_gb = max(disk_size_mib // 1024, 1)
    return f"{disk_gb} GB SSD"


def _preset_id_from_resources(
    vcpus: int,
    memory_mib: int,
    disk_size_mib: int,
) -> str:
    memory_gb = max(memory_mib // 1024, 1)
    disk_gb = max(disk_size_mib // 1024, 1)
    return f"{vcpus}vcpu_{memory_gb}gb_{disk_gb}gb"


def _build_preset_plans(args: argparse.Namespace) -> tuple[SnapshotPresetPlan, ...]:
    standard_plan = SnapshotPresetPlan(
        preset_id=_preset_id_from_resources(
            args.standard_vcpus, args.standard_memory, args.standard_disk_size
        ),
        label="Standard workspace",
        cpu_display=_format_cpu_display(args.standard_vcpus),
        memory_display=_format_memory_display(args.standard_memory),
        disk_display=_format_disk_display(args.standard_disk_size),
        vcpus=args.standard_vcpus,
        memory_mib=args.standard_memory,
        disk_size_mib=args.standard_disk_size,
    )
    boosted_plan = SnapshotPresetPlan(
        preset_id=_preset_id_from_resources(
            args.boosted_vcpus, args.boosted_memory, args.boosted_disk_size
        ),
        label="Performance workspace",
        cpu_display=_format_cpu_display(args.boosted_vcpus),
        memory_display=_format_memory_display(args.boosted_memory),
        disk_display=_format_disk_display(args.boosted_disk_size),
        vcpus=args.boosted_vcpus,
        memory_mib=args.boosted_memory,
        disk_size_mib=args.boosted_disk_size,
    )
    return (standard_plan, boosted_plan)


def _load_manifest(console: Console) -> PveSnapshotManifestEntry:
    if not PVE_SNAPSHOT_MANIFEST_PATH.exists():
        return {
            "schemaVersion": CURRENT_MANIFEST_SCHEMA_VERSION,
            "updatedAt": _iso_timestamp(),
            "templateVmid": DEFAULT_TEMPLATE_VMID,
            "node": "",
            "presets": [],
        }
    try:
        raw_manifest = json.loads(PVE_SNAPSHOT_MANIFEST_PATH.read_text())
    except Exception as exc:
        raise RuntimeError(
            f"Failed to read PVE snapshot manifest at {PVE_SNAPSHOT_MANIFEST_PATH}: {exc}"
        ) from exc
    return raw_manifest


def _write_manifest(manifest: PveSnapshotManifestEntry) -> None:
    PVE_SNAPSHOT_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n"
    )


def _update_manifest_with_snapshot(
    manifest: PveSnapshotManifestEntry,
    preset: SnapshotPresetPlan,
    vmid: int,
    snapshot_name: str,
    captured_at: str,
    node: str,
) -> PveSnapshotManifestEntry:
    manifest["node"] = node
    manifest["updatedAt"] = captured_at

    preset_entry: PveSnapshotPresetEntry | None = None
    for candidate in manifest["presets"]:
        if candidate.get("presetId") == preset.preset_id:
            preset_entry = candidate
            break

    if preset_entry is None:
        preset_entry = {
            "presetId": preset.preset_id,
            "label": preset.label,
            "cpu": preset.cpu_display,
            "memory": preset.memory_display,
            "disk": preset.disk_display,
            "versions": [],
        }
        manifest["presets"].append(preset_entry)
    else:
        preset_entry["label"] = preset.label
        preset_entry["cpu"] = preset.cpu_display
        preset_entry["memory"] = preset.memory_display
        preset_entry["disk"] = preset.disk_display

    next_version = 1
    if preset_entry["versions"]:
        next_version = max(entry["version"] for entry in preset_entry["versions"]) + 1

    preset_entry["versions"].append(
        {
            "version": next_version,
            "vmid": vmid,
            "snapshotName": snapshot_name,
            "capturedAt": captured_at,
        }
    )
    preset_entry["versions"].sort(key=lambda entry: entry["version"])

    return manifest


# ---------------------------------------------------------------------------
# Container execution helpers
# ---------------------------------------------------------------------------


async def run_in_container(
    vmid: int,
    command: str,
    *,
    console: Console,
    timeout: int = 300,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Execute a command inside an LXC container via pct exec."""
    # pct exec <vmid> -- <command>
    full_command = ["pct", "exec", str(vmid), "--", "bash", "-c", command]

    console.info(f"[{vmid}] Running: {command[:80]}...")

    try:
        result = await asyncio.to_thread(
            subprocess.run,
            full_command,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            console.always(f"[{vmid}] Command failed: {result.stderr}")
            raise RuntimeError(f"Command failed with exit code {result.returncode}")
        return result
    except subprocess.TimeoutExpired as e:
        raise TimeoutError(f"Command timed out after {timeout}s") from e


async def wait_for_container_ready(
    vmid: int,
    client: PveLxcClient,
    *,
    console: Console,
    timeout: int = 120,
) -> None:
    """Wait for container to be running and network ready."""
    console.info(f"Waiting for container {vmid} to be ready...")

    elapsed = 0
    while elapsed < timeout:
        status = await client.aget_lxc_status(vmid)
        if status.get("status") == "running":
            # Try to run a simple command
            try:
                result = await run_in_container(
                    vmid,
                    "echo ready",
                    console=console,
                    timeout=10,
                    check=False,
                )
                if result.returncode == 0 and "ready" in result.stdout:
                    console.info(f"Container {vmid} is ready")
                    return
            except Exception:
                pass
        await asyncio.sleep(2)
        elapsed += 2

    raise TimeoutError(f"Container {vmid} did not become ready within {timeout}s")


# ---------------------------------------------------------------------------
# Provisioning tasks
# ---------------------------------------------------------------------------


async def provision_container(
    vmid: int,
    console: Console,
    repo_root: Path,
) -> None:
    """Run all provisioning tasks on the container."""

    # Basic setup
    console.info(f"[{vmid}] Running apt update and installing base packages...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            export DEBIAN_FRONTEND=noninteractive

            # Configure APT for parallel downloads
            cat > /etc/apt/apt.conf.d/99parallel << 'EOF'
            Acquire::Queue-Mode "host";
            APT::Acquire::Max-Parallel-Downloads "16";
            EOF

            apt-get update
            apt-get install -y \
                ca-certificates curl wget jq git gnupg lsb-release \
                tar unzip xz-utils zip bzip2 gzip htop lsof \
                build-essential make pkg-config g++ libssl-dev \
                ruby-full perl software-properties-common \
                tigervnc-standalone-server tigervnc-common \
                xvfb x11-xserver-utils xterm novnc \
                dbus-x11 openbox tmux zsh ripgrep
        """),
        console=console,
        timeout=600,
    )

    # Install Node.js
    console.info(f"[{vmid}] Installing Node.js...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            NODE_VERSION="24.9.0"
            arch="$(uname -m)"
            case "${arch}" in
              x86_64) node_arch="x64" ;;
              aarch64|arm64) node_arch="arm64" ;;
              *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
            esac
            tmp_dir="$(mktemp -d)"
            cd "${tmp_dir}"
            curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
            tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1
            rm -rf "${tmp_dir}"
            ln -sf /usr/local/bin/node /usr/bin/node
            ln -sf /usr/local/bin/npm /usr/bin/npm
            ln -sf /usr/local/bin/npx /usr/bin/npx
            node --version
        """),
        console=console,
        timeout=300,
    )

    # Install Bun
    console.info(f"[{vmid}] Installing Bun...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            curl -fsSL https://bun.sh/install | bash
            install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
            ln -sf /usr/local/bin/bun /usr/local/bin/bunx
            bun --version
        """),
        console=console,
        timeout=120,
    )

    # Install uv (Python)
    console.info(f"[{vmid}] Installing Python and uv...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            apt-get update
            apt-get install -y python3-pip
            python3 -m pip install --break-system-packages uv
            uv --version
            ln -sf /usr/bin/python3 /usr/bin/python
        """),
        console=console,
        timeout=300,
    )

    # Install Rust
    console.info(f"[{vmid}] Installing Rust toolchain...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            export RUSTUP_HOME=/usr/local/rustup
            export CARGO_HOME=/usr/local/cargo
            install -d -m 0755 "${RUSTUP_HOME}" "${CARGO_HOME}"
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
              sh -s -- -y --no-modify-path --profile minimal
            source "${CARGO_HOME}/env"
            rustup component add rustfmt
            rustup default stable
            cargo --version
        """),
        console=console,
        timeout=600,
    )

    # Install Go
    console.info(f"[{vmid}] Installing Go toolchain...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            GO_VERSION="1.24.3"
            ARCH="$(uname -m)"
            case "${ARCH}" in
              x86_64) GO_ARCH="amd64" ;;
              aarch64|arm64) GO_ARCH="arm64" ;;
              *) echo "Unsupported architecture" >&2; exit 1 ;;
            esac
            TMP_DIR="$(mktemp -d)"
            cd "${TMP_DIR}"
            curl -fsSLo go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
            rm -rf /usr/local/go
            tar -C /usr/local -xzf go.tar.gz
            ln -sf /usr/local/go/bin/go /usr/local/bin/go
            ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
            rm -rf "${TMP_DIR}"
            go version
        """),
        console=console,
        timeout=300,
    )

    # Install Docker (if nesting is enabled)
    console.info(f"[{vmid}] Installing Docker...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux
            export DEBIAN_FRONTEND=noninteractive
            apt-get update
            apt-get install -y ca-certificates curl

            # Add Docker GPG key and repo
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
            chmod a+r /etc/apt/keyrings/docker.asc

            . /etc/os-release
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

            apt-get update
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

            systemctl enable docker.service || true
            docker --version || echo "Docker installed but may need container restart for systemd"
        """),
        console=console,
        timeout=600,
        check=False,  # Docker may not fully work in LXC without proper features
    )

    # Configure shell and paths
    console.info(f"[{vmid}] Configuring shell environment...")
    await run_in_container(
        vmid,
        textwrap.dedent("""
            set -eux

            # Set zsh as default shell
            chsh -s $(which zsh) root || true

            # Configure paths
            cat > /etc/profile.d/cmux-paths.sh << 'EOF'
            export RUSTUP_HOME=/usr/local/rustup
            export CARGO_HOME=/usr/local/cargo
            export PATH="/usr/local/bin:/usr/local/cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/go/bin:$PATH"
            EOF

            # Create workspace directory
            mkdir -p /root/workspace

            echo "Shell environment configured"
        """),
        console=console,
        timeout=60,
    )

    console.info(f"[{vmid}] Provisioning complete")


# ---------------------------------------------------------------------------
# Main provisioning flow
# ---------------------------------------------------------------------------


async def provision_and_snapshot_for_preset(
    args: argparse.Namespace,
    *,
    preset: SnapshotPresetPlan,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
    created_containers: list[int],
) -> SnapshotRunResult:
    """Provision and snapshot a container for a preset."""
    console.always(f"\n=== Provisioning preset {preset.preset_id} ({preset.label}) ===")

    node = await client.aget_node()
    new_vmid = await client.afind_next_vmid(node)
    hostname = f"cmux-{preset.preset_id.replace('_', '-')}"

    console.info(f"Cloning template {args.template_vmid} to new container {new_vmid}...")

    # Clone from template
    upid = await client.aclone_lxc(
        args.template_vmid,
        new_vmid,
        hostname=hostname,
        full=True,
        node=node,
    )
    await client.await_task(upid, timeout=600, node=node)
    created_containers.append(new_vmid)

    # Configure resources
    console.info(f"Configuring container {new_vmid} with {preset.vcpus} cores, {preset.memory_mib}MB RAM...")
    await client.aset_lxc_config(
        new_vmid,
        cores=preset.vcpus,
        memory=preset.memory_mib,
        node=node,
    )

    # Start container
    console.info(f"Starting container {new_vmid}...")
    upid = await client.astart_lxc(new_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Wait for container to be ready
    await wait_for_container_ready(new_vmid, client, console=console)

    # Run provisioning tasks
    await provision_container(new_vmid, console, repo_root)

    # Stop container before snapshotting
    console.info(f"Stopping container {new_vmid} for snapshot...")
    upid = await client.astop_lxc(new_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Create snapshot
    snapshot_name = f"cmux-{preset.preset_id}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    console.info(f"Creating snapshot {snapshot_name}...")
    upid = await client.acreate_snapshot(
        new_vmid,
        snapshot_name,
        description=f"cmux {preset.label} preset",
        node=node,
    )
    await client.await_task(upid, timeout=300, node=node)

    captured_at = _iso_timestamp()

    console.always(f"[{preset.preset_id}] Container {new_vmid} snapshot '{snapshot_name}' created")

    return SnapshotRunResult(
        preset=preset,
        vmid=new_vmid,
        snapshot_name=snapshot_name,
        captured_at=captured_at,
        node=node,
    )


async def provision_and_snapshot(args: argparse.Namespace) -> None:
    """Main provisioning flow."""
    console = Console()

    # Validate environment
    api_url = os.environ.get("PVE_API_URL")
    api_token = os.environ.get("PVE_API_TOKEN")

    if not api_url or not api_token:
        console.always("ERROR: PVE_API_URL and PVE_API_TOKEN must be set")
        console.always("")
        console.always("Example:")
        console.always("  export PVE_API_URL=https://pve.example.com:8006")
        console.always("  export PVE_API_TOKEN=root@pam!cmux=your-secret")
        sys.exit(1)

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
    )

    # Test connection
    try:
        version = client.get_version()
        console.always(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        console.always(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    node = client.get_node()
    console.always(f"Using node: {node}")

    # Verify template exists
    try:
        template_status = client.get_lxc_status(args.template_vmid)
        console.always(f"Template container {args.template_vmid}: {template_status.get('status', 'unknown')}")
    except Exception as e:
        console.always(f"ERROR: Template container {args.template_vmid} not found: {e}")
        console.always("")
        console.always("Create a template first:")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh create {args.template_vmid}")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh configure {args.template_vmid}")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh convert {args.template_vmid}")
        sys.exit(1)

    manifest = _load_manifest(console)
    manifest["templateVmid"] = args.template_vmid
    repo_root = Path(args.repo_root).resolve()
    preset_plans = _build_preset_plans(args)
    created_containers: list[int] = []
    results: list[SnapshotRunResult] = []

    console.always(
        f"Starting snapshot runs for presets "
        f"{', '.join(plan.preset_id for plan in preset_plans)} "
        f"from template {args.template_vmid}"
    )

    try:
        for preset_plan in preset_plans:
            result = await provision_and_snapshot_for_preset(
                args,
                preset=preset_plan,
                console=console,
                client=client,
                repo_root=repo_root,
                created_containers=created_containers,
            )
            results.append(result)
    except Exception as e:
        console.always(f"\nERROR: Provisioning failed: {e}")
        traceback.print_exc()

        # Cleanup on failure
        if args.cleanup_on_failure:
            console.always("\nCleaning up created containers...")
            for vmid in created_containers:
                try:
                    client.stop_lxc(vmid)
                    client.delete_lxc(vmid)
                    console.always(f"  Deleted container {vmid}")
                except Exception:
                    pass
        raise

    # Update manifest
    for result in results:
        manifest = _update_manifest_with_snapshot(
            manifest,
            result.preset,
            result.vmid,
            result.snapshot_name,
            result.captured_at,
            result.node,
        )
    _write_manifest(manifest)

    # Summary
    console.always("\n" + "=" * 60)
    console.always("PVE LXC Snapshot Summary")
    console.always("=" * 60)
    console.always(f"Manifest updated: {PVE_SNAPSHOT_MANIFEST_PATH}")
    console.always("")

    for result in results:
        console.always(f"Preset: {result.preset.preset_id}")
        console.always(f"  VMID: {result.vmid}")
        console.always(f"  Snapshot: {result.snapshot_name}")
        console.always(f"  Node: {result.node}")
        console.always(f"  Captured: {result.captured_at}")
        console.always("")

    console.always("To use these containers:")
    console.always("  1. Start: pct start <vmid>")
    console.always("  2. Enter: pct enter <vmid>")
    console.always("  3. Rollback to snapshot: pct rollback <vmid> <snapname>")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provision PVE LXC containers with parallel setup"
    )
    parser.add_argument(
        "--template-vmid",
        type=int,
        default=DEFAULT_TEMPLATE_VMID,
        help=f"Template VMID to clone from (default: {DEFAULT_TEMPLATE_VMID})",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (default: current directory)",
    )
    parser.add_argument(
        "--standard-vcpus",
        "--vcpus",
        dest="standard_vcpus",
        type=int,
        default=4,
        help="vCPU count for the standard preset",
    )
    parser.add_argument(
        "--standard-memory",
        "--memory",
        dest="standard_memory",
        type=int,
        default=6144,
        help="Memory (MiB) for the standard preset",
    )
    parser.add_argument(
        "--standard-disk-size",
        "--disk-size",
        dest="standard_disk_size",
        type=int,
        default=32768,
        help="Disk size (MiB) for the standard preset",
    )
    parser.add_argument(
        "--boosted-vcpus",
        type=int,
        default=6,
        help="vCPU count for the boosted preset",
    )
    parser.add_argument(
        "--boosted-memory",
        type=int,
        default=8192,
        help="Memory (MiB) for the boosted preset",
    )
    parser.add_argument(
        "--boosted-disk-size",
        type=int,
        default=32768,
        help="Disk size (MiB) for the boosted preset",
    )
    parser.add_argument(
        "--cleanup-on-failure",
        action="store_true",
        default=True,
        help="Delete created containers on failure",
    )
    parser.add_argument(
        "--no-cleanup-on-failure",
        action="store_false",
        dest="cleanup_on_failure",
        help="Keep created containers on failure for debugging",
    )
    return parser.parse_args()


def main() -> None:
    dotenv.load_dotenv()
    args = parse_args()
    try:
        asyncio.run(provision_and_snapshot(args))
    except Exception as exc:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
