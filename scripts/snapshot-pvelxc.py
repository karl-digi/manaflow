#!/usr/bin/env python3
"""
Provision Proxmox VE LXC containers from an existing base template, perform
parallelized environment setup that mirrors the Morph snapshot workflow, and
create snapshots for multiple presets (standard + boosted).

This is the PVE LXC equivalent of snapshot.py for self-hosted cmux sandboxes.

The flow:
1. Clone LXC container per preset from the provided base template
2. Start containers and wait for network
3. Execute dependency graph tasks concurrently via pct exec
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
import tarfile
import tempfile
import textwrap
import traceback
import typing as t
import urllib.parse
import urllib.request

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import dotenv

from snapshot import (
    TaskRegistry,
    Console,
    TimingsCollector,
    Command,
    format_dependency_graph,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VSCODE_HTTP_PORT = 39378
WORKER_HTTP_PORT = 39377
PROXY_HTTP_PORT = 39379
VNC_HTTP_PORT = 39380
CDP_HTTP_PORT = 39381
XTERM_HTTP_PORT = 39383
EXEC_HTTP_PORT = 39375
CDP_PROXY_BINARY_NAME = "cmux-cdp-proxy"
VNC_PROXY_BINARY_NAME = "cmux-vnc-proxy"
EXECD_BINARY_NAME = "cmux-execd"

PVE_SNAPSHOT_MANIFEST_PATH = (
    Path(__file__).resolve().parent.parent / "packages/shared/src/pve-lxc-snapshots.json"
)
CURRENT_MANIFEST_SCHEMA_VERSION = 2

# Default template VMID (should be created via pve-lxc-template.sh)
DEFAULT_TEMPLATE_VMID = 9000

# ---------------------------------------------------------------------------
# IDE Provider Configuration
# ---------------------------------------------------------------------------

IDE_PROVIDER_CODER = "coder"
IDE_PROVIDER_OPENVSCODE = "openvscode"
IDE_PROVIDER_CMUX_CODE = "cmux-code"
DEFAULT_IDE_PROVIDER = IDE_PROVIDER_CMUX_CODE

# Module-level IDE provider setting (set from args before task graph runs)
_ide_provider: str = DEFAULT_IDE_PROVIDER


def set_ide_provider(provider: str) -> None:
    global _ide_provider
    _ide_provider = provider


def get_ide_provider() -> str:
    return _ide_provider


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
        ssh_host: str | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.node = node
        self.verify_ssl = verify_ssl

        # Parse token: user@realm!tokenid=secret
        token_parts = api_token.split("=", 1)
        if len(token_parts) != 2:
            raise ValueError(
                "Invalid PVE_API_TOKEN format. Expected 'user@realm!tokenid=secret'"
            )
        self.token_id = token_parts[0]
        self.token_secret = token_parts[1]

        # SSH host for pct commands (derived from API URL if not provided)
        if ssh_host:
            self.ssh_host = ssh_host
        else:
            # Extract hostname from API URL: https://host.example.com:8006 -> host.example.com
            parsed = urllib.parse.urlparse(api_url)
            hostname = parsed.hostname or "localhost"
            self.ssh_host = f"root@{hostname}"

        # SSH ControlMaster socket path for connection multiplexing
        # This allows multiple SSH sessions to share a single TCP connection
        self._ssh_control_path: str | None = None

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

    async def aget_lxc_config(
        self, vmid: int, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get LXC config."""
        return await asyncio.to_thread(self.get_lxc_config, vmid, node)

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

    def convert_to_template(
        self,
        vmid: int,
        node: str | None = None,
    ) -> None:
        """Convert an LXC container to a template.

        The container must be stopped and have no snapshots.
        Once converted, the container becomes read-only and can only
        be used as a source for cloning.
        """
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/template",
        )
        # Check for error message in response
        if result.get("message"):
            raise RuntimeError(f"Failed to convert to template: {result['message']}")

    async def aconvert_to_template(
        self,
        vmid: int,
        node: str | None = None,
    ) -> None:
        """Async convert to template."""
        await asyncio.to_thread(self.convert_to_template, vmid, node)

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

    # -----------------------------------------------------------------------
    # SSH-based operations for pct commands
    # -----------------------------------------------------------------------

    def start_ssh_control_master(self) -> None:
        """Start SSH ControlMaster for connection multiplexing.

        This creates a persistent SSH connection that subsequent SSH commands
        can reuse, avoiding the overhead and connection limits of opening
        many separate TCP connections.
        """
        if self._ssh_control_path:
            return  # Already started

        # Create control socket in temp directory
        control_dir = tempfile.mkdtemp(prefix="pve_ssh_")
        self._ssh_control_path = os.path.join(control_dir, "control.sock")

        # Start ControlMaster in background
        cmd = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ControlMaster=yes",
            "-o", f"ControlPath={self._ssh_control_path}",
            "-o", "ControlPersist=600",  # Keep alive for 10 minutes
            "-N",  # No command, just open connection
            "-f",  # Go to background
            self.ssh_host,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            self._ssh_control_path = None
            raise RuntimeError(
                f"Failed to start SSH ControlMaster: {result.stderr}"
            )

    def stop_ssh_control_master(self) -> None:
        """Stop SSH ControlMaster and clean up."""
        if not self._ssh_control_path:
            return

        # Send exit command to control master
        cmd = [
            "ssh",
            "-o", f"ControlPath={self._ssh_control_path}",
            "-O", "exit",
            self.ssh_host,
        ]
        subprocess.run(cmd, capture_output=True, timeout=10)

        # Clean up control directory
        control_dir = os.path.dirname(self._ssh_control_path)
        try:
            shutil.rmtree(control_dir, ignore_errors=True)
        except Exception:
            pass
        self._ssh_control_path = None

    def ssh_exec(
        self,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command on PVE host via SSH."""
        ssh_cmd = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
        ]
        # Use ControlMaster if available
        if self._ssh_control_path:
            ssh_cmd.extend([
                "-o", f"ControlPath={self._ssh_control_path}",
            ])
        ssh_cmd.extend([self.ssh_host, command])

        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=timeout or 600,
        )
        if check and result.returncode != 0:
            raise RuntimeError(
                f"SSH command failed (exit {result.returncode}):\n"
                f"Command: {command}\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )
        return result

    async def assh_exec(
        self,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async SSH exec."""
        return await asyncio.to_thread(
            self.ssh_exec, command, timeout=timeout, check=check
        )

    def pct_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command inside container via SSH + pct exec."""
        # Escape single quotes in command for remote shell
        escaped_cmd = command.replace("'", "'\"'\"'")
        remote_cmd = f"pct exec {vmid} -- bash -lc '{escaped_cmd}'"
        return self.ssh_exec(remote_cmd, timeout=timeout, check=check)

    async def apct_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async pct exec."""
        return await asyncio.to_thread(
            self.pct_exec, vmid, command, timeout=timeout, check=check
        )

    def pct_push(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push a file to container via SSH + pct push.

        First SCPs file to PVE host, then uses pct push to push into container.
        """
        import uuid
        tmp_name = f"/tmp/pct_push_{vmid}_{uuid.uuid4().hex[:8]}"

        # SCP local file to PVE host (uses ControlMaster if available)
        scp_cmd = [
            "scp",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
        ]
        if self._ssh_control_path:
            scp_cmd.extend(["-o", f"ControlPath={self._ssh_control_path}"])
        scp_cmd.extend([local_path, f"{self.ssh_host}:{tmp_name}"])

        result = subprocess.run(
            scp_cmd,
            capture_output=True,
            text=True,
            timeout=timeout or 300,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"SCP failed (exit {result.returncode}): {result.stderr}"
            )

        # Push from PVE host to container
        try:
            self.ssh_exec(
                f"pct push {vmid} {tmp_name} {remote_path}",
                timeout=timeout,
            )
        finally:
            # Clean up temp file on PVE host
            try:
                self.ssh_exec(f"rm -f {tmp_name}", timeout=30, check=False)
            except Exception:
                pass

    async def apct_push(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Async pct push."""
        await asyncio.to_thread(
            self.pct_push, vmid, local_path, remote_path, timeout=timeout
        )


# ---------------------------------------------------------------------------
# Manifest types and helpers
# ---------------------------------------------------------------------------


class PveTemplateVersionEntry(t.TypedDict):
    """A version entry for a preset template (schema v2)."""
    version: int
    templateVmid: int  # The VMID of the template container
    capturedAt: str


class PveTemplatePresetEntry(t.TypedDict):
    """A preset entry in the manifest (schema v2)."""
    presetId: str
    label: str
    cpu: str
    memory: str
    disk: str
    versions: list[PveTemplateVersionEntry]
    description: t.NotRequired[str]


class PveTemplateManifestEntry(t.TypedDict):
    """The manifest file structure (schema v2).

    Schema v2 uses templates instead of snapshots for linked-clone support.
    Each preset's 'versions' contains templateVmid (the template container)
    instead of vmid+snapshotName.
    """
    schemaVersion: int
    updatedAt: str
    baseTemplateVmid: int  # The base template used to create preset templates
    node: str
    presets: list[PveTemplatePresetEntry]


@dataclass(slots=True, frozen=True)
class TemplatePresetPlan:
    """Configuration for a preset to be created."""
    preset_id: str
    label: str
    cpu_display: str
    memory_display: str
    disk_display: str
    vcpus: int
    memory_mib: int
    disk_size_mib: int


@dataclass(slots=True)
class TemplateRunResult:
    """Result of creating a preset template."""
    preset: TemplatePresetPlan
    template_vmid: int  # The VMID of the created template
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


def _build_preset_plans(args: argparse.Namespace) -> tuple[TemplatePresetPlan, ...]:
    standard_plan = TemplatePresetPlan(
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
    boosted_plan = TemplatePresetPlan(
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


def _load_manifest() -> PveTemplateManifestEntry:
    if not PVE_SNAPSHOT_MANIFEST_PATH.exists():
        return {
            "schemaVersion": CURRENT_MANIFEST_SCHEMA_VERSION,
            "updatedAt": _iso_timestamp(),
            "baseTemplateVmid": DEFAULT_TEMPLATE_VMID,
            "node": "",
            "presets": [],
        }
    try:
        raw_manifest = json.loads(PVE_SNAPSHOT_MANIFEST_PATH.read_text())
    except Exception as exc:
        raise RuntimeError(
            f"Failed to read PVE template manifest at {PVE_SNAPSHOT_MANIFEST_PATH}: {exc}"
        ) from exc
    return raw_manifest


def _write_manifest(manifest: PveTemplateManifestEntry) -> None:
    PVE_SNAPSHOT_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n"
    )


def _update_manifest_with_template(
    manifest: PveTemplateManifestEntry,
    preset: TemplatePresetPlan,
    template_vmid: int,
    captured_at: str,
    node: str,
) -> PveTemplateManifestEntry:
    """Update manifest with a new template version for a preset."""
    manifest["node"] = node
    manifest["updatedAt"] = captured_at

    preset_entry: PveTemplatePresetEntry | None = None
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
            "templateVmid": template_vmid,
            "capturedAt": captured_at,
        }
    )
    preset_entry["versions"].sort(key=lambda entry: entry["version"])

    return manifest


# ---------------------------------------------------------------------------
# PVE Task Context - executes via pct exec
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class PveExecResponse:
    """Response from pct exec command."""
    exit_code: int
    stdout: str
    stderr: str


@dataclass(slots=True)
class PveTaskContext:
    """Execution context for PVE LXC tasks using SSH + pct exec."""

    vmid: int
    client: PveLxcClient
    repo_root: Path
    remote_repo_root: str
    remote_repo_tar: str
    console: Console
    timings: TimingsCollector
    environment_prelude: str = field(default="", init=False)

    def __post_init__(self) -> None:
        exports = textwrap.dedent(
            """
            export RUSTUP_HOME=/usr/local/rustup
            export CARGO_HOME=/usr/local/cargo
            export NVM_DIR=/root/.nvm
            export GOPATH=/usr/local/go-workspace
            export GOMODCACHE="${GOPATH}/pkg/mod"
            export GOCACHE=/usr/local/go-cache
            export PATH="/root/.local/bin:/usr/local/cargo/bin:/usr/local/go/bin:${GOPATH}/bin:/usr/local/bin:$PATH"
            """
        ).strip()
        self.environment_prelude = exports

    async def run(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None = None,
    ) -> PveExecResponse:
        """Run a command inside the LXC container via SSH + pct exec."""
        command_with_env = self._apply_environment(command)
        return await self._run_pct_exec(label, command_with_env, timeout=timeout)

    def _apply_environment(self, command: Command) -> str:
        """Apply environment prelude to command."""
        if isinstance(command, str):
            cmd_str = command
        else:
            cmd_str = " ".join(shlex.quote(str(part)) for part in command)
        if self.environment_prelude:
            return f"{self.environment_prelude}\n{cmd_str}"
        return cmd_str

    async def _run_pct_exec(
        self,
        label: str,
        command: str,
        *,
        timeout: float | None = None,
    ) -> PveExecResponse:
        """Execute command via SSH + pct exec."""
        self.console.info(f"[{label}] running...")

        # Wrap command in bash with pipefail
        script = f"set -euo pipefail\n{command}"

        attempts = 0
        max_attempts = 3
        while True:
            attempts += 1
            try:
                result = await self.client.apct_exec(
                    self.vmid,
                    script,
                    timeout=timeout,
                    check=False,  # We handle errors ourselves
                )
                break
            except subprocess.TimeoutExpired as e:
                raise TimeoutError(f"Command timed out after {timeout}s") from e
            except OSError as exc:
                if attempts < max_attempts:
                    delay = float(min(2**attempts, 8))
                    self.console.info(
                        f"[{label}] retrying after exec failure ({exc}) (attempt {attempts}/{max_attempts}) in {delay}s"
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

        # Log output
        for line in result.stdout.splitlines():
            self.console.info(f"[{label}] {line}")
        for line in result.stderr.splitlines():
            self.console.info(f"[{label}][stderr] {line}")

        if result.returncode != 0:
            error_parts = [f"{label} failed with exit code {result.returncode}"]
            if result.stdout.strip():
                error_parts.append(f"stdout:\n{result.stdout.rstrip()}")
            if result.stderr.strip():
                error_parts.append(f"stderr:\n{result.stderr.rstrip()}")
            raise RuntimeError("\n".join(error_parts))

        return PveExecResponse(
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    async def push_file(
        self,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push a file to the container via SSH + pct push."""
        await self.client.apct_push(
            self.vmid, local_path, remote_path, timeout=timeout
        )


# ---------------------------------------------------------------------------
# Git / repo helpers
# ---------------------------------------------------------------------------


def _exec_git(repo_root: Path, args: list[str]) -> str | None:
    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")
    git_candidates = [env.get("GIT_EXE"), env.get("GIT_BINARY"), "git"]
    errors: list[str] = []
    for candidate in git_candidates:
        if not candidate:
            continue
        try:
            completed = subprocess.run(
                [candidate, *args],
                cwd=str(repo_root),
                env=env,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError:
            errors.append(f"{candidate}: not found")
            continue
        if completed.returncode == 0:
            return completed.stdout
        errors.append(
            completed.stderr.strip() or f"{candidate}: exit code {completed.returncode}"
        )
    if errors:
        raise RuntimeError(f"git command {' '.join(args)} failed: {'; '.join(errors)}")
    return None


def list_repo_files(repo_root: Path) -> list[Path]:
    output = _exec_git(
        repo_root,
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    )
    if output is None:
        files: list[Path] = []
        for path in repo_root.rglob("*"):
            if path.is_file() and ".git" not in path.parts:
                files.append(path.relative_to(repo_root))
        return files
    entries = [entry for entry in output.split("\0") if entry]
    return [Path(entry) for entry in entries]


def create_repo_archive(repo_root: Path) -> Path:
    files = list_repo_files(repo_root)
    tmp = tempfile.NamedTemporaryFile(prefix="cmux-repo-", suffix=".tar", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    with tarfile.open(tmp_path, "w") as tar:
        for rel_path in files:
            full_path = repo_root / rel_path
            if not full_path.exists():
                continue
            tar.add(full_path, arcname=str(rel_path))
    return tmp_path


async def upload_repo_to_container(
    vmid: int,
    client: PveLxcClient,
    repo_root: Path,
    remote_tar_path: str,
    console: Console,
) -> None:
    """Upload repository archive to container via SSH + pct push."""
    console.info("Creating repository archive...")
    archive = await asyncio.to_thread(create_repo_archive, repo_root)
    try:
        console.info(f"Uploading repository to container {vmid} via SSH...")
        await client.apct_push(vmid, str(archive), remote_tar_path)
        console.info(f"Repository uploaded to {remote_tar_path}")
    finally:
        archive.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Task registry and task definitions
# ---------------------------------------------------------------------------

dotenv.load_dotenv()

registry = TaskRegistry()
update_registry = TaskRegistry()  # Subset of tasks for --update mode


@registry.task(
    name="apt-bootstrap",
    description="Install core apt utilities and set up package sources",
)
async def task_apt_bootstrap(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux

        # Configure APT for parallel downloads
        cat > /etc/apt/apt.conf.d/99parallel << 'EOF'
        Acquire::Queue-Mode "host";
        APT::Acquire::Max-Parallel-Downloads "16";
        Acquire::http::Pipeline-Depth "10";
        Acquire::https::Pipeline-Depth "10";
        EOF

        # Update and install core utilities
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            ca-certificates curl wget jq git gnupg lsb-release \
            tar unzip xz-utils zip bzip2 gzip htop lsof

        # Setup GitHub CLI repository
        install -m 0755 -d /usr/share/keyrings
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
            | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
        arch="$(dpkg --print-architecture)"
        echo "deb [arch=${arch} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
            > /etc/apt/sources.list.d/github-cli.list

        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("apt-bootstrap", cmd)


@registry.task(
    name="install-base-packages",
    deps=("apt-bootstrap",),
    description="Install build-essential tooling and utilities",
)
async def task_install_base_packages(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux

        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            build-essential make pkg-config g++ libssl-dev \
            ruby-full perl software-properties-common \
            tigervnc-standalone-server tigervnc-common \
            xvfb \
            x11-xserver-utils xterm novnc \
            dbus-x11 openbox \
            tmux \
            gh \
            zsh \
            zsh-autosuggestions \
            ripgrep

        # Download and install Chrome
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
            ;;
          arm64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb"
            ;;
          *)
            echo "Unsupported architecture: ${arch}" >&2
            exit 1
            ;;
        esac
        cd /tmp
        curl -fsSL -o chrome.deb "${chrome_url}"
        DEBIAN_FRONTEND=noninteractive apt-get install -y ./chrome.deb || true
        DEBIAN_FRONTEND=noninteractive apt-get install -yf
        rm -f chrome.deb

        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("install-base-packages", cmd)


@registry.task(
    name="ensure-docker",
    deps=("install-base-packages",),
    description="Install Docker engine and CLI plugins",
)
async def task_ensure_docker(ctx: PveTaskContext) -> None:
    install_cmd = textwrap.dedent(
        """
        set -euo pipefail

        echo "[docker] ensuring Docker APT repository"
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
        os_release="/etc/os-release"
        if [ ! -f "$os_release" ]; then
          echo "Missing /etc/os-release; unable to determine distribution" >&2
          exit 1
        fi
        . "$os_release"
        distro_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-stable}}"
        distro_id="${ID:-debian}"
        case "$distro_id" in
          ubuntu|Ubuntu|UBUNTU)
            repo_id="ubuntu"
            ;;
          debian|Debian|DEBIAN)
            repo_id="debian"
            ;;
          *)
            echo "Unrecognized distro id '$distro_id'; defaulting to debian" >&2
            repo_id="debian"
            ;;
        esac
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\\n' \
          "$(dpkg --print-architecture)" "$repo_id" "$distro_codename" \
          > /etc/apt/sources.list.d/docker.list

        echo "[docker] installing engine and CLI plugins"
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
          docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        systemctl enable docker.service || true
        systemctl enable docker.socket || true
        systemctl start docker.service || true

        for attempt in $(seq 1 30); do
          if docker info >/dev/null 2>&1; then
            echo "[docker] daemon is ready"
            break
          fi
          if [ "$attempt" -eq 30 ]; then
            echo "[docker] daemon failed to start within expected window" >&2
            # Don't fail - Docker may need container restart for full functionality
            exit 0
          fi
          sleep 2
        done

        docker --version || true
        docker compose version || true
        docker buildx version || true
        """
    )
    await ctx.run("ensure-docker-install", install_cmd)


@registry.task(
    name="install-node-runtime",
    deps=("install-base-packages",),
    description="Install Node.js runtime and pnpm via corepack",
)
async def task_install_node(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        NODE_VERSION="24.9.0"
        arch="$(uname -m)"
        case "${arch}" in
          x86_64) node_arch="x64" ;;
          aarch64|arm64) node_arch="arm64" ;;
          *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
        esac
        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "${tmp_dir}"' EXIT
        cd "${tmp_dir}"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
        grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -
        tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1
        cd /
        ln -sf /usr/local/bin/node /usr/bin/node
        ln -sf /usr/local/bin/npm /usr/bin/npm
        ln -sf /usr/local/bin/npx /usr/bin/npx
        ln -sf /usr/local/bin/corepack /usr/bin/corepack
        npm install -g node-gyp
        corepack enable
        corepack prepare pnpm@10.14.0 --activate
        """
    )
    await ctx.run("install-node-runtime", cmd)


@registry.task(
    name="install-nvm",
    deps=("install-node-runtime",),
    description="Install nvm for runtime use",
)
async def task_install_nvm(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export NVM_DIR="/root/.nvm"
        mkdir -p "${NVM_DIR}"
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh" | bash
        cat <<'PROFILE' > /etc/profile.d/nvm.sh
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
        PROFILE
        bash -lc 'source /etc/profile.d/nvm.sh && nvm --version'
        """
    )
    await ctx.run("install-nvm", cmd)


@registry.task(
    name="install-bun",
    deps=("install-base-packages",),
    description="Install Bun runtime",
)
async def task_install_bun(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        curl -fsSL https://bun.sh/install | bash
        install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
        ln -sf /usr/local/bin/bun /usr/local/bin/bunx
        bun --version
        bunx --version
        """
    )
    await ctx.run("install-bun", cmd)


@registry.task(
    name="install-go-toolchain",
    deps=("install-base-packages",),
    description="Install Go toolchain for building CMux helpers",
)
async def task_install_go_toolchain(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        GO_VERSION="1.24.3"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            GO_ARCH="amd64"
            ;;
          aarch64|arm64)
            GO_ARCH="arm64"
            ;;
          *)
            echo "Unsupported architecture for Go: ${ARCH}" >&2
            exit 1
            ;;
        esac
        TMP_DIR="$(mktemp -d)"
        trap 'rm -rf "${TMP_DIR}"' EXIT
        cd "${TMP_DIR}"
        curl -fsSLo go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
        rm -rf /usr/local/go
        tar -C /usr/local -xzf go.tar.gz
        install -d /usr/local/bin
        install -d -m 0755 /usr/local/go-workspace/bin
        install -d -m 0755 /usr/local/go-workspace/pkg/mod
        install -d -m 0755 /usr/local/go-workspace/pkg/sumdb
        install -d -m 0755 /usr/local/go-cache
        ln -sf /usr/local/go/bin/go /usr/local/bin/go
        ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
        /usr/local/go/bin/go version
        """
    )
    await ctx.run("install-go-toolchain", cmd)


@registry.task(
    name="install-uv-python",
    deps=("ensure-docker",),
    description="Install uv CLI and provision default Python runtime",
)
async def task_install_uv_python(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip
        python3 -m pip install --break-system-packages uv
        export PATH="${HOME}/.local/bin:/usr/local/cargo/bin:${PATH}"
        uv python install --default
        PIP_VERSION="$(curl -fsSL https://pypi.org/pypi/pip/json | jq -r '.info.version')"
        python3 -m pip install --break-system-packages --upgrade "pip==${PIP_VERSION}"
        ln -sf /usr/bin/python3 /usr/bin/python
        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("install-uv-python", cmd)


@registry.task(
    name="install-rust-toolchain",
    deps=("install-base-packages",),
    description="Install Rust toolchain via rustup",
)
async def task_install_rust_toolchain(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        install -d -m 0755 "${RUSTUP_HOME}" "${CARGO_HOME}"
        install -d -m 0755 "${CARGO_HOME}/bin"
        export PATH="${CARGO_HOME}/bin:${PATH}"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            RUST_HOST_TARGET="x86_64-unknown-linux-gnu"
            ;;
          aarch64|arm64)
            RUST_HOST_TARGET="aarch64-unknown-linux-gnu"
            ;;
          *)
            echo "Unsupported architecture: ${ARCH}" >&2
            exit 1
            ;;
        esac
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
          sh -s -- -y --no-modify-path --profile minimal
        source "${CARGO_HOME}/env"
        rustup component add rustfmt
        rustup target add "${RUST_HOST_TARGET}"
        rustup default stable
        """
    )
    await ctx.run("install-rust-toolchain", cmd)


@registry.task(
    name="install-openvscode",
    deps=("apt-bootstrap",),
    description="Install OpenVSCode server",
)
async def task_install_openvscode(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_OPENVSCODE:
        ctx.console.info("Skipping install-openvscode (IDE provider is not openvscode)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest | jq -r '.tag_name' | sed 's|^openvscode-server-v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/openvscode-server
        url="https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${CODE_RELEASE}/openvscode-server-v${CODE_RELEASE}-linux-${ARCH}.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}"
        tar xf /tmp/openvscode-server.tar.gz -C /app/openvscode-server --strip-components=1
        rm -f /tmp/openvscode-server.tar.gz
        """
    )
    await ctx.run("install-openvscode", cmd)


@registry.task(
    name="install-coder",
    deps=("apt-bootstrap",),
    description="Install Coder (code-server)",
)
async def task_install_coder(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_CODER:
        ctx.console.info("Skipping install-coder (IDE provider is not coder)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODER_RELEASE="$(curl -fsSL https://api.github.com/repos/coder/code-server/releases/latest | jq -r '.tag_name' | sed 's|^v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="amd64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/code-server
        url="https://github.com/coder/code-server/releases/download/v${CODER_RELEASE}/code-server-${CODER_RELEASE}-linux-${ARCH}.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/code-server.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/code-server.tar.gz "${url}"
        tar xf /tmp/code-server.tar.gz -C /app/code-server --strip-components=1
        rm -f /tmp/code-server.tar.gz

        mkdir -p /root/.config/code-server
        cat > /root/.config/code-server/config.yaml << 'EOF'
bind-addr: 0.0.0.0:39378
auth: none
cert: false
EOF

        mkdir -p /root/.code-server/User
        cat > /root/.code-server/User/settings.json << 'EOF'
{
  "workbench.startupEditor": "none"
}
EOF
        """
    )
    await ctx.run("install-coder", cmd)


@registry.task(
    name="install-cmux-code",
    deps=("apt-bootstrap",),
    description="Install Cmux Code (VSCode fork with OpenVSIX)",
)
async def task_install_cmux_code(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_CMUX_CODE:
        ctx.console.info("Skipping install-cmux-code (IDE provider is not cmux-code)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/manaflow-ai/vscode-1/releases/latest | jq -r '.tag_name' | sed 's|^v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/cmux-code
        url="https://github.com/manaflow-ai/vscode-1/releases/download/v${CODE_RELEASE}/vscode-server-linux-${ARCH}-web.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/cmux-code.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/cmux-code.tar.gz "${url}"
        tar xf /tmp/cmux-code.tar.gz -C /app/cmux-code --strip-components=1
        rm -f /tmp/cmux-code.tar.gz

        mkdir -p /root/.vscode-server-oss/data/User
        cat > /root/.vscode-server-oss/data/User/settings.json << 'EOF'
{
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.verifySignature": false
}
EOF
        """
    )
    await ctx.run("install-cmux-code", cmd)


@registry.task(
    name="upload-repo",
    deps=("apt-bootstrap",),
    description="Upload repository to the container",
)
@update_registry.task(
    name="upload-repo",
    deps=(),  # No deps in update mode - tools already installed
    description="Upload repository to the container",
)
async def task_upload_repo(ctx: PveTaskContext) -> None:
    await upload_repo_to_container(
        ctx.vmid, ctx.client, ctx.repo_root, ctx.remote_repo_tar, ctx.console
    )
    extract_cmd = textwrap.dedent(
        f"""
        rm -rf {shlex.quote(ctx.remote_repo_root)}
        mkdir -p {shlex.quote(ctx.remote_repo_root)}
        tar -xf {shlex.quote(ctx.remote_repo_tar)} -C {shlex.quote(ctx.remote_repo_root)}
        rm -f {shlex.quote(ctx.remote_repo_tar)}
        """
    )
    await ctx.run("extract-repo", extract_cmd)


@registry.task(
    name="install-repo-dependencies",
    deps=("upload-repo", "install-bun", "install-node-runtime"),
    description="Install workspace dependencies via bun",
)
@update_registry.task(
    name="install-repo-dependencies",
    deps=("upload-repo",),  # bun/node already installed
    description="Install workspace dependencies via bun",
)
async def task_install_repo_dependencies(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        f"""
        export PATH="/usr/local/bin:$PATH"
        cd {shlex.quote(ctx.remote_repo_root)}
        bun install --frozen-lockfile
        """
    )
    await ctx.run("install-repo-dependencies", cmd)


@registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies",),
    description="Package the cmux VS Code extension for installation",
)
@update_registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies",),
    description="Package the cmux VS Code extension for installation",
)
async def task_package_vscode_extension(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}/packages/vscode-extension
        bun run package
        latest_vsix="$(ls -1t cmux-vscode-extension-*.vsix 2>/dev/null | head -n 1)"
        if [ -z "${{latest_vsix}}" ] || [ ! -f "${{latest_vsix}}" ]; then
          echo "cmux VS Code extension package not found" >&2
          exit 1
        fi
        install -Dm0644 "${{latest_vsix}}" /tmp/cmux-vscode-extension.vsix
        """
    )
    await ctx.run("package-vscode-extension", cmd)


@registry.task(
    name="install-ide-extensions",
    deps=("install-openvscode", "install-coder", "install-cmux-code", "package-vscode-extension"),
    description="Preinstall language extensions for the IDE",
)
@update_registry.task(
    name="install-ide-extensions",
    deps=("package-vscode-extension",),  # IDEs already installed
    description="Preinstall language extensions for the IDE",
)
async def task_install_ide_extensions(ctx: PveTaskContext) -> None:
    ide_provider = get_ide_provider()
    if ide_provider == IDE_PROVIDER_CODER:
        server_root = "/app/code-server"
        bin_path = f"{server_root}/bin/code-server"
        extensions_dir = "/root/.code-server/extensions"
        user_data_dir = "/root/.code-server"
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        server_root = "/app/cmux-code"
        bin_path = f"{server_root}/bin/code-server-oss"
        extensions_dir = "/root/.vscode-server-oss/extensions"
        user_data_dir = "/root/.vscode-server-oss/data"
    else:
        server_root = "/app/openvscode-server"
        bin_path = f"{server_root}/bin/openvscode-server"
        extensions_dir = "/root/.openvscode-server/extensions"
        user_data_dir = "/root/.openvscode-server/data"

    ide_deps_path = Path(__file__).resolve().parent.parent / "configs/ide-deps.json"
    try:
        ide_deps_raw = ide_deps_path.read_text(encoding="utf-8")
        ide_deps = json.loads(ide_deps_raw)
    except Exception as exc:
        raise RuntimeError(f"Failed to read {ide_deps_path}") from exc

    extensions = ide_deps.get("extensions")
    if not isinstance(extensions, list):
        raise RuntimeError("configs/ide-deps.json extensions must be an array.")

    extension_lines: list[str] = []
    for ext in extensions:
        if not isinstance(ext, dict):
            raise RuntimeError(f"Invalid extension entry {ext!r}")
        publisher = ext.get("publisher")
        name = ext.get("name")
        version = ext.get("version")
        if (
            not isinstance(publisher, str)
            or not isinstance(name, str)
            or not isinstance(version, str)
        ):
            raise RuntimeError(f"Invalid extension entry {ext!r}")
        extension_lines.append(f"{publisher}|{name}|{version}")

    if not extension_lines:
        raise RuntimeError("No extensions found in configs/ide-deps.json.")

    extensions_blob = "\n".join(extension_lines)

    cmd = textwrap.dedent(
        f"""
        set -eux
        export HOME=/root
        server_root="{server_root}"
        bin_path="{bin_path}"
        if [ ! -x "${{bin_path}}" ]; then
          echo "IDE binary not found at ${{bin_path}}" >&2
          exit 1
        fi
        extensions_dir="{extensions_dir}"
        user_data_dir="{user_data_dir}"
        mkdir -p "${{extensions_dir}}" "${{user_data_dir}}"
        cmux_vsix="/tmp/cmux-vscode-extension.vsix"
        if [ ! -f "${{cmux_vsix}}" ]; then
          echo "cmux extension package missing at ${{cmux_vsix}}" >&2
          exit 1
        fi
        install_from_file() {{
          local package_path="$1"
          "${{bin_path}}" \\
            --install-extension "${{package_path}}" \\
            --force \\
            --extensions-dir "${{extensions_dir}}" \\
            --user-data-dir "${{user_data_dir}}"
        }}
        install_from_file "${{cmux_vsix}}"
        rm -f "${{cmux_vsix}}"
        download_dir="$(mktemp -d)"
        cleanup() {{
          rm -rf "${{download_dir}}"
        }}
        trap cleanup EXIT
        download_extension() {{
          local publisher="$1"
          local name="$2"
          local version="$3"
          local destination="$4"
          local tmpfile="${{destination}}.download"
          local curl_stderr="${{tmpfile}}.stderr"
          local url="https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${{publisher}}/vsextensions/${{name}}/${{version}}/vspackage"
          local attempt=1
          local max_attempts=3
          while [ "${{attempt}}" -le "${{max_attempts}}" ]; do
            if curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o "${{tmpfile}}" "${{url}}" 2>"${{curl_stderr}}"; then
              rm -f "${{curl_stderr}}"
              break
            fi
            echo "Download attempt ${{attempt}}/${{max_attempts}} failed for ${{publisher}}.${{name}}@${{version}}; retrying..." >&2
            if [ -s "${{curl_stderr}}" ]; then
              cat "${{curl_stderr}}" >&2
            fi
            rm -f "${{tmpfile}}"
            attempt=$((attempt + 1))
            sleep $((attempt * 2))
          done
          if [ "${{attempt}}" -gt "${{max_attempts}}" ]; then
            echo "Failed to download ${{publisher}}.${{name}}@${{version}} after ${{max_attempts}} attempts" >&2
            if [ -s "${{curl_stderr}}" ]; then
              cat "${{curl_stderr}}" >&2
            fi
            rm -f "${{curl_stderr}}"
            return 1
          fi
          if gzip -t "${{tmpfile}}" >/dev/null 2>&1; then
            gunzip -c "${{tmpfile}}" > "${{destination}}"
            rm -f "${{tmpfile}}"
          else
            mv "${{tmpfile}}" "${{destination}}"
          fi
        }}
        set +e
        while IFS='|' read -r publisher name version; do
          [ -z "${{publisher}}" ] && continue
          download_extension "${{publisher}}" "${{name}}" "${{version}}" "${{download_dir}}/${{publisher}}.${{name}}.vsix" &
        done <<'EXTENSIONS'
{extensions_blob}
EXTENSIONS
        wait
        set -e
        set -- "${{download_dir}}"/*.vsix
        for vsix in "$@"; do
          if [ -f "${{vsix}}" ]; then
            install_from_file "${{vsix}}"
          fi
        done
        """
    )
    await ctx.run("install-ide-extensions", cmd)


@registry.task(
    name="install-cursor-cli",
    deps=("apt-bootstrap",),
    description="Install Cursor CLI",
)
async def task_install_cursor(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        curl https://cursor.com/install -fsS | bash
        /root/.local/bin/cursor-agent --version
        """
    )
    await ctx.run("install-cursor-cli", cmd)


@registry.task(
    name="install-global-cli",
    deps=("install-bun", "install-node-runtime"),
    description="Install global agent CLIs with bun",
)
async def task_install_global_cli(ctx: PveTaskContext) -> None:
    ide_deps_path = Path(__file__).resolve().parent.parent / "configs/ide-deps.json"
    try:
        ide_deps_raw = ide_deps_path.read_text(encoding="utf-8")
        ide_deps = json.loads(ide_deps_raw)
    except Exception as exc:
        raise RuntimeError(f"Failed to read {ide_deps_path}") from exc

    packages = ide_deps.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError("configs/ide-deps.json packages must be an object.")

    package_args: list[str] = []
    for name, version in packages.items():
        if not isinstance(name, str) or not isinstance(version, str):
            raise RuntimeError(f"Invalid package entry {name!r}: {version!r}")
        package_args.append(f"{name}@{version}")

    if not package_args:
        raise RuntimeError("No packages found in configs/ide-deps.json.")

    bun_line = "bun add -g " + " ".join(package_args)
    cmd = textwrap.dedent(
        f"""
        {bun_line}
        """
    )
    await ctx.run("install-global-cli", cmd)


@registry.task(
    name="setup-claude-oauth-wrappers",
    deps=("install-global-cli",),
    description="Create wrapper scripts for claude/npx/bunx to support OAuth token injection",
)
@update_registry.task(
    name="setup-claude-oauth-wrappers",
    deps=(),  # No deps - global-cli already installed
    description="Create wrapper scripts for claude/npx/bunx to support OAuth token injection",
)
async def task_setup_claude_oauth_wrappers(ctx: PveTaskContext) -> None:
    script_path = Path(__file__).parent.parent / "configs" / "setup-claude-oauth-wrappers.sh"
    script_content = script_path.read_text()
    await ctx.run("setup-claude-oauth-wrappers", script_content)


@registry.task(
    name="configure-zsh",
    deps=("install-base-packages",),
    description="Install zsh configuration and default prompt",
)
async def task_configure_zsh(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        r"""
        set -eux
        zsh_path="$(command -v zsh)"
        if [ -z "${zsh_path}" ]; then
          echo "zsh not found" >&2
          exit 1
        fi
        current_shell="$(getent passwd root | cut -d: -f7 || true)"
        if [ "${current_shell}" != "${zsh_path}" ]; then
          if command -v chsh >/dev/null 2>&1; then
            chsh -s "${zsh_path}" root
          else
            usermod -s "${zsh_path}" root
          fi
        fi
        mkdir -p /root
        autosuggestions="/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
        cat > /root/.zshrc <<EOF
export SHELL="${zsh_path}"
export PATH="/usr/local/bin:/usr/local/cargo/bin:\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
export XDG_RUNTIME_DIR="/run/user/0"
export NVM_DIR="\$HOME/.nvm"
if [ -s /etc/profile.d/nvm.sh ]; then
  . /etc/profile.d/nvm.sh
fi

alias code='/usr/local/bin/code'
alias c='code'
alias g='git'

autoload -Uz colors vcs_info
colors
setopt PROMPT_SUBST

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:git*:*' formats '%F{yellow}git:%b%f'
zstyle ':vcs_info:git*:*' actionformats '%F{yellow}git:%b*%f'

precmd() {
  vcs_info
}

PROMPT='%F{cyan}%n%f %F{green}%~%f\${vcs_info_msg_0_:+ \${vcs_info_msg_0_}} %# '
EOF
        if [ -f "${autosuggestions}" ]; then
          cat >> /root/.zshrc <<'EOF'

if [ -f "${autosuggestions}" ]; then
  source "${autosuggestions}"
  bindkey '^ ' autosuggest-accept
fi
EOF
        fi
        cat >> /root/.zshrc <<'EOF'
HISTFILE=~/.zsh_history
setopt HIST_IGNORE_DUPS HIST_VERIFY
EOF
        cat > /root/.zprofile <<'EOF'
[[ -f ~/.zshrc ]] && source ~/.zshrc
EOF
        mkdir -p /etc/profile.d
        cat <<'EOF' > /etc/profile.d/cmux-paths.sh
export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME=/usr/local/cargo
export PATH="/usr/local/bin:/usr/local/cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"
EOF
        if ! grep -q "alias g='git'" /root/.bashrc 2>/dev/null; then
          echo "alias g='git'" >> /root/.bashrc
        fi
        """
    )
    await ctx.run("configure-zsh", cmd)


@registry.task(
    name="configure-openbox",
    deps=("upload-repo", "install-base-packages"),
    description="Install openbox configuration for desktop menu",
)
async def task_configure_openbox(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -eux
        mkdir -p /root/.config/openbox
        install -Dm0644 {repo}/configs/openbox/menu.xml /root/.config/openbox/menu.xml
        """
    )
    await ctx.run("configure-openbox", cmd)


@registry.task(
    name="install-service-scripts",
    deps=("upload-repo", "install-base-packages"),
    description="Install VNC startup script (includes Chrome DevTools)",
)
@update_registry.task(
    name="install-service-scripts",
    deps=("upload-repo",),  # base packages already installed
    description="Install VNC startup script (includes Chrome DevTools)",
)
async def task_install_service_scripts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -d /usr/local/lib/cmux
        install -m 0755 {repo}/configs/systemd/bin/cmux-start-chrome /usr/local/lib/cmux/cmux-start-chrome
        install -m 0755 {repo}/configs/systemd/bin/cmux-manage-dockerd /usr/local/lib/cmux/cmux-manage-dockerd
        install -m 0755 {repo}/configs/systemd/bin/cmux-stop-dockerd /usr/local/lib/cmux/cmux-stop-dockerd
        install -m 0755 {repo}/configs/systemd/bin/cmux-configure-memory /usr/local/sbin/cmux-configure-memory
        """
    )
    await ctx.run("install-service-scripts", cmd)


@registry.task(
    name="build-cdp-proxy",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build and install Chrome DevTools and VNC proxy binaries",
)
@update_registry.task(
    name="build-cdp-proxy",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build and install Chrome DevTools and VNC proxy binaries",
)
async def task_build_cdp_proxy(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/lib/cmux
        cd {repo}/scripts/cdp-proxy
        go build -trimpath -o /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} .
        if [ ! -x /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} ]; then
          echo "Failed to build {CDP_PROXY_BINARY_NAME}" >&2
          exit 1
        fi
        cd {repo}/scripts/vnc-proxy
        go build -trimpath -o /usr/local/lib/cmux/{VNC_PROXY_BINARY_NAME} .
        if [ ! -x /usr/local/lib/cmux/{VNC_PROXY_BINARY_NAME} ]; then
          echo "Failed to build {VNC_PROXY_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-cdp-proxy", cmd)


@registry.task(
    name="build-execd",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build cmux-execd HTTP exec daemon",
)
@update_registry.task(
    name="build-execd",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build cmux-execd HTTP exec daemon",
)
async def task_build_execd(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/bin
        cd {repo}/scripts/execd
        go build -trimpath -o /usr/local/bin/{EXECD_BINARY_NAME} .
        if [ ! -x /usr/local/bin/{EXECD_BINARY_NAME} ]; then
          echo "Failed to build {EXECD_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-execd", cmd)


@registry.task(
    name="build-worker",
    deps=("install-repo-dependencies",),
    description="Build worker bundle and install helper scripts",
)
@update_registry.task(
    name="build-worker",
    deps=("install-repo-dependencies",),
    description="Build worker bundle and install helper scripts",
)
async def task_build_worker(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}
        bun build ./apps/worker/src/index.ts \\
          --target node \\
          --outdir ./apps/worker/build \\
          --external @cmux/convex \\
          --external 'node:*'
        if [ ! -f ./apps/worker/build/index.js ]; then
          echo "Worker build output missing at ./apps/worker/build/index.js" >&2
          exit 1
        fi
        install -d /builtins
        cat <<'JSON' > /builtins/package.json
{{"name":"builtins","type":"module","version":"1.0.0"}}
JSON
        rm -rf /builtins/build
        cp -r ./apps/worker/build /builtins/build
        install -Dm0755 ./apps/worker/wait-for-docker.sh /usr/local/bin/wait-for-docker.sh
        """
    )
    await ctx.run("build-worker", cmd)


@registry.task(
    name="build-rust-binaries",
    deps=("upload-repo", "install-rust-toolchain"),
    description="Build Rust binaries with a shared target dir",
)
@update_registry.task(
    name="build-rust-binaries",
    deps=("upload-repo",),  # Rust toolchain already installed
    description="Build Rust binaries with a shared target dir",
)
async def task_build_rust_binaries(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        export CARGO_TARGET_DIR={repo}/target
        export PATH="${{CARGO_HOME}}/bin:$PATH"
        export CARGO_BUILD_JOBS="$(nproc)"
        cargo build --locked --release --manifest-path {repo}/crates/cmux-env/Cargo.toml
        cargo build --locked --release --manifest-path {repo}/crates/cmux-proxy/Cargo.toml
        cargo build --locked --release --manifest-path {repo}/crates/cmux-pty/Cargo.toml
        """
    )
    await ctx.run("build-rust-binaries", cmd, timeout=60 * 30)


@registry.task(
    name="link-rust-binaries",
    deps=("build-rust-binaries",),
    description="Symlink built Rust binaries into /usr/local/bin",
)
@update_registry.task(
    name="link-rust-binaries",
    deps=("build-rust-binaries",),
    description="Symlink built Rust binaries into /usr/local/bin",
)
async def task_link_rust_binaries(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -m 0755 {repo}/target/release/envd /usr/local/bin/envd
        install -m 0755 {repo}/target/release/envctl /usr/local/bin/envctl
        install -m 0755 {repo}/target/release/cmux-proxy /usr/local/bin/cmux-proxy
        install -m 0755 {repo}/target/release/cmux-pty /usr/local/bin/cmux-pty
        """
    )
    await ctx.run("link-rust-binaries", cmd)


@registry.task(
    name="install-systemd-units",
    deps=(
        "upload-repo",
        "install-ide-extensions",
        "install-service-scripts",
        "build-worker",
        "build-cdp-proxy",
        "build-execd",
        "link-rust-binaries",
        "configure-zsh",
    ),
    description="Install cmux systemd units and helpers",
)
@update_registry.task(
    name="install-systemd-units",
    deps=(
        "install-ide-extensions",
        "install-service-scripts",
        "build-worker",
        "build-cdp-proxy",
        "build-execd",
        "link-rust-binaries",
    ),
    description="Install cmux systemd units and helpers",
)
async def task_install_systemd_units(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    ide_provider = get_ide_provider()

    if ide_provider == IDE_PROVIDER_CODER:
        ide_service = "cmux-coder.service"
        ide_configure_script = "configure-coder"
        ide_env_file = "ide.env.coder"
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        ide_service = "cmux-cmux-code.service"
        ide_configure_script = "configure-cmux-code"
        ide_env_file = "ide.env.cmux-code"
    else:
        ide_service = "cmux-openvscode.service"
        ide_configure_script = "configure-openvscode"
        ide_env_file = "ide.env.openvscode"

    cmd = textwrap.dedent(
        f"""
        set -euo pipefail

        install -d /usr/local/lib/cmux
        install -d /etc/cmux
        install -Dm0644 {repo}/configs/systemd/cmux.target /usr/lib/systemd/system/cmux.target
        install -Dm0644 {repo}/configs/systemd/{ide_service} /usr/lib/systemd/system/cmux-ide.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker.service /usr/lib/systemd/system/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-proxy.service /usr/lib/systemd/system/cmux-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-dockerd.service /usr/lib/systemd/system/cmux-dockerd.service
        install -Dm0644 {repo}/configs/systemd/cmux-devtools.service /usr/lib/systemd/system/cmux-devtools.service
        install -Dm0644 {repo}/configs/systemd/cmux-xvfb.service /usr/lib/systemd/system/cmux-xvfb.service
        install -Dm0644 {repo}/configs/systemd/cmux-tigervnc.service /usr/lib/systemd/system/cmux-tigervnc.service
        install -Dm0644 {repo}/configs/systemd/cmux-openbox.service /usr/lib/systemd/system/cmux-openbox.service
        install -Dm0644 {repo}/configs/systemd/cmux-vnc-proxy.service /usr/lib/systemd/system/cmux-vnc-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-cdp-proxy.service /usr/lib/systemd/system/cmux-cdp-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-pty.service /usr/lib/systemd/system/cmux-pty.service
        install -Dm0644 {repo}/configs/systemd/cmux-execd.service /usr/lib/systemd/system/cmux-execd.service
        install -Dm0644 {repo}/configs/systemd/cmux-memory-setup.service /usr/lib/systemd/system/cmux-memory-setup.service
        install -Dm0755 {repo}/configs/systemd/bin/{ide_configure_script} /usr/local/lib/cmux/{ide_configure_script}
        install -Dm0644 {repo}/configs/systemd/{ide_env_file} /etc/cmux/ide.env
        install -Dm0755 {repo}/configs/systemd/bin/code /usr/local/bin/code
        touch /usr/local/lib/cmux/dockerd.flag
        mkdir -p /var/log/cmux
        mkdir -p /root/workspace
        mkdir -p /etc/systemd/system/multi-user.target.wants
        mkdir -p /etc/systemd/system/cmux.target.wants
        mkdir -p /etc/systemd/system/swap.target.wants
        ln -sf /usr/lib/systemd/system/cmux.target /etc/systemd/system/multi-user.target.wants/cmux.target
        ln -sf /usr/lib/systemd/system/cmux-ide.service /etc/systemd/system/cmux.target.wants/cmux-ide.service
        ln -sf /usr/lib/systemd/system/cmux-worker.service /etc/systemd/system/cmux.target.wants/cmux-worker.service
        ln -sf /usr/lib/systemd/system/cmux-proxy.service /etc/systemd/system/cmux.target.wants/cmux-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-dockerd.service /etc/systemd/system/cmux.target.wants/cmux-dockerd.service
        ln -sf /usr/lib/systemd/system/cmux-devtools.service /etc/systemd/system/cmux.target.wants/cmux-devtools.service
        ln -sf /usr/lib/systemd/system/cmux-tigervnc.service /etc/systemd/system/cmux.target.wants/cmux-tigervnc.service
        ln -sf /usr/lib/systemd/system/cmux-openbox.service /etc/systemd/system/cmux.target.wants/cmux-openbox.service
        ln -sf /usr/lib/systemd/system/cmux-vnc-proxy.service /etc/systemd/system/cmux.target.wants/cmux-vnc-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-cdp-proxy.service /etc/systemd/system/cmux.target.wants/cmux-cdp-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-pty.service /etc/systemd/system/cmux.target.wants/cmux-pty.service
        ln -sf /usr/lib/systemd/system/cmux-execd.service /etc/systemd/system/cmux.target.wants/cmux-execd.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/multi-user.target.wants/cmux-memory-setup.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/swap.target.wants/cmux-memory-setup.service
        {{ systemctl daemon-reload || true; }}
        {{ systemctl enable cmux.target || true; }}
        chown root:root /usr/local
        chown root:root /usr/local/bin
        chmod 0755 /usr/local
        chmod 0755 /usr/local/bin
        {{ systemctl restart ssh || true; }}
        {{ systemctl is-active --quiet ssh || true; }}
        {{ systemctl start cmux.target 2>/dev/null || true; }}
        """
    )
    await ctx.run("install-systemd-units", cmd)


@registry.task(
    name="install-prompt-wrapper",
    deps=("upload-repo",),
    description="Install prompt-wrapper helper",
)
@update_registry.task(
    name="install-prompt-wrapper",
    deps=("upload-repo",),
    description="Install prompt-wrapper helper",
)
async def task_install_prompt_wrapper(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -m 0755 {repo}/prompt-wrapper.sh /usr/local/bin/prompt-wrapper
        """
    )
    await ctx.run("install-prompt-wrapper", cmd)


@registry.task(
    name="install-tmux-conf",
    deps=("upload-repo",),
    description="Install tmux configuration",
)
@update_registry.task(
    name="install-tmux-conf",
    deps=("upload-repo",),
    description="Install tmux configuration",
)
async def task_install_tmux_conf(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0644 {repo}/configs/tmux.conf /etc/tmux.conf
        """
    )
    await ctx.run("install-tmux-conf", cmd)


@registry.task(
    name="install-collect-scripts",
    deps=("upload-repo",),
    description="Install worker helper scripts",
)
@update_registry.task(
    name="install-collect-scripts",
    deps=("upload-repo",),
    description="Install worker helper scripts",
)
async def task_install_collect_scripts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0755 {repo}/apps/worker/scripts/collect-relevant-diff.sh /usr/local/bin/cmux-collect-relevant-diff.sh
        install -Dm0755 {repo}/apps/worker/scripts/collect-crown-diff.sh /usr/local/bin/cmux-collect-crown-diff.sh
        """
    )
    await ctx.run("install-collect-scripts", cmd)


@registry.task(
    name="configure-envctl",
    deps=("link-rust-binaries", "configure-zsh"),
    description="Configure envctl defaults",
)
@update_registry.task(
    name="configure-envctl",
    deps=("link-rust-binaries",),
    description="Configure envctl defaults",
)
async def task_configure_envctl(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        envctl --version
        envctl install-hook bash
        envctl install-hook zsh
        cat <<'PROFILE' > /root/.profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        cat <<'PROFILE' > /root/.bash_profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        mkdir -p /run/user/0
        chmod 700 /run/user/0
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.bashrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.bashrc
        fi
        if ! grep -q 'cmux-paths.sh' /root/.bashrc 2>/dev/null; then
          echo '[ -f /etc/profile.d/cmux-paths.sh ] && . /etc/profile.d/cmux-paths.sh' >> /root/.bashrc
        fi
        if ! grep -q 'nvm.sh' /root/.bashrc 2>/dev/null; then
          echo '[ -f /etc/profile.d/nvm.sh ] && . /etc/profile.d/nvm.sh' >> /root/.bashrc
        fi
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.zshrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.zshrc
        fi
        """
    )
    await ctx.run("configure-envctl", cmd)


@registry.task(
    name="cleanup-build-artifacts",
    deps=(
        "configure-envctl",
        "configure-openbox",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-systemd-units",
    ),
    description="Remove repository upload and toolchain caches prior to final validation",
)
@update_registry.task(
    name="cleanup-build-artifacts",
    deps=(
        "configure-envctl",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-systemd-units",
    ),
    description="Remove repository upload and toolchain caches prior to final validation",
)
async def task_cleanup_build_artifacts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    tar_path = shlex.quote(ctx.remote_repo_tar)
    cleanup_script = textwrap.dedent(
        f"""
        set -euo pipefail
        rm -rf {repo}
        rm -f {tar_path}
        if [ -d /usr/local/cargo ]; then
            rm -rf /usr/local/cargo/registry
            rm -rf /usr/local/cargo/git
            install -d -m 0755 /usr/local/cargo/registry
            install -d -m 0755 /usr/local/cargo/git
        fi
        if [ -d /usr/local/rustup ]; then
            rm -rf /usr/local/rustup/tmp
            rm -rf /usr/local/rustup/downloads
            install -d -m 0755 /usr/local/rustup/tmp
            install -d -m 0755 /usr/local/rustup/downloads
        fi
        if [ -d /root/.cache ]; then
            rm -rf /root/.cache/go-build
            rm -rf /root/.cache/pip
            rm -rf /root/.cache/uv
            rm -rf /root/.cache/bun
        fi
        if [ -d /root/.bun ]; then
            rm -rf /root/.bun/install/cache
        fi
        rm -rf /root/.npm
        rm -rf /root/.pnpm-store
        rm -rf /root/go
        rm -rf /usr/local/go-workspace/bin
        rm -rf /usr/local/go-workspace/pkg/mod
        rm -rf /usr/local/go-workspace/pkg/sumdb
        rm -rf /usr/local/go-cache
        install -d -m 0755 /root/.cache
        install -d -m 0755 /root/.cache/go-build
        install -d -m 0755 /root/.cache/pip
        install -d -m 0755 /root/.cache/uv
        install -d -m 0755 /root/.cache/bun
        install -d -m 0755 /usr/local/go-workspace
        install -d -m 0755 /usr/local/go-workspace/bin
        install -d -m 0755 /usr/local/go-workspace/pkg/mod
        install -d -m 0755 /usr/local/go-workspace/pkg/sumdb
        install -d -m 0755 /usr/local/go-cache
        if [ -d /var/cache/apt ]; then
            rm -rf /var/cache/apt/archives/*.deb
            rm -rf /var/cache/apt/archives/partial
            install -d -m 0755 /var/cache/apt/archives/partial
        fi
        if [ -d /var/lib/apt/lists ]; then
            find /var/lib/apt/lists -mindepth 1 -maxdepth 1 -type f -delete
            rm -rf /var/lib/apt/lists/partial
            install -d -m 0755 /var/lib/apt/lists/partial
        fi
        """
    ).strip()
    await ctx.run("cleanup-disk-artifacts", cleanup_script)


# ---------------------------------------------------------------------------
# Verification tasks
# ---------------------------------------------------------------------------


@registry.task(
    name="check-cargo",
    deps=("install-rust-toolchain", "cleanup-build-artifacts"),
    description="Verify cargo is installed and working",
)
async def task_check_cargo(ctx: PveTaskContext) -> None:
    await ctx.run("check-cargo", "PATH=/usr/local/cargo/bin:$PATH cargo --version")


@registry.task(
    name="check-node",
    deps=("install-node-runtime", "cleanup-build-artifacts"),
    description="Verify node is installed and working",
)
async def task_check_node(ctx: PveTaskContext) -> None:
    await ctx.run("check-node", "node --version")


@registry.task(
    name="check-bun",
    deps=("install-bun", "cleanup-build-artifacts"),
    description="Verify bun is installed and working",
)
async def task_check_bun(ctx: PveTaskContext) -> None:
    await ctx.run("check-bun", "bun --version && bunx --version")


@registry.task(
    name="check-uv",
    deps=("install-uv-python", "cleanup-build-artifacts"),
    description="Verify uv is installed and working",
)
async def task_check_uv(ctx: PveTaskContext) -> None:
    await ctx.run("check-uv", "uv --version && uvx --version")


@registry.task(
    name="check-gh",
    deps=("install-base-packages", "cleanup-build-artifacts"),
    description="Verify GitHub CLI is installed and working",
)
async def task_check_gh(ctx: PveTaskContext) -> None:
    await ctx.run("check-gh", "gh --version")


@registry.task(
    name="check-envctl",
    deps=("configure-envctl", "cleanup-build-artifacts"),
    description="Verify envctl is installed and working",
)
async def task_check_envctl(ctx: PveTaskContext) -> None:
    await ctx.run("check-envctl", "envctl --version && command -v envd")


@registry.task(
    name="check-systemd-services",
    deps=("install-systemd-units", "cleanup-build-artifacts"),
    description="Verify systemd services are configured",
)
async def task_check_systemd_services(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        echo "Checking cmux.target..."
        systemctl list-unit-files cmux.target
        echo "Checking installed services..."
        for svc in cmux-ide cmux-worker cmux-proxy cmux-pty cmux-execd; do
          if [ -f "/usr/lib/systemd/system/${svc}.service" ]; then
            echo "  ${svc}.service: installed"
          else
            echo "  ${svc}.service: MISSING" >&2
          fi
        done
        """
    )
    await ctx.run("check-systemd-services", cmd)


# ---------------------------------------------------------------------------
# Task graph execution for PVE
# ---------------------------------------------------------------------------


import time


async def _run_task_with_timing(ctx: PveTaskContext, task: t.Any) -> None:
    """Run a task and record timing."""
    start = time.perf_counter()
    await task.func(ctx)
    duration = time.perf_counter() - start
    ctx.timings.add(f"task:{task.name}", duration)
    ctx.console.info(f"[OK] {task.name} completed in {duration:.2f}s")


async def run_pve_task_graph(registry: TaskRegistry, ctx: PveTaskContext) -> None:
    """Execute all tasks in the registry respecting dependencies."""
    remaining = registry.tasks
    completed: set[str] = set()

    while remaining:
        ready = [
            name
            for name, task in remaining.items()
            if all(dep in completed for dep in task.dependencies)
        ]
        if not ready:
            unresolved = ", ".join(remaining)
            raise RuntimeError(f"Dependency cycle detected: {unresolved}")

        tasks_to_run = [remaining[name] for name in ready]
        for task in tasks_to_run:
            ctx.console.info(f"-> starting task {task.name}")

        start = time.perf_counter()
        await asyncio.gather(
            *(_run_task_with_timing(ctx, task) for task in tasks_to_run)
        )
        duration = time.perf_counter() - start
        layer_label = f"layer:{'+'.join(ready)}"
        ctx.timings.add(layer_label, duration)
        ctx.console.info(
            f"[OK] Layer completed in {duration:.2f}s (tasks: {', '.join(ready)})"
        )

        for task in tasks_to_run:
            completed.add(task.name)
            remaining.pop(task.name, None)


# ---------------------------------------------------------------------------
# Main provisioning flow
# ---------------------------------------------------------------------------


async def wait_for_container_ready(
    vmid: int,
    client: PveLxcClient,
    *,
    console: Console,
    timeout: int = 120,
) -> None:
    """Wait for container to be running and ready for commands via SSH."""
    console.info(f"Waiting for container {vmid} to be ready...")

    elapsed = 0
    while elapsed < timeout:
        status = await client.aget_lxc_status(vmid)
        if status.get("status") == "running":
            # Try to run a simple command via SSH + pct exec
            try:
                result = await client.apct_exec(
                    vmid,
                    "echo ready",
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


async def update_existing_template(
    args: argparse.Namespace,
    *,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
) -> int:
    """Update an existing template container by cloning, updating, and converting to new template.

    This skips heavy dependency installation (apt, rust, go, node, etc.) and only
    runs tasks that rebuild binaries and update configs from the repo.

    Flow:
    1. Check if source VMID is a template (via config template=1)
    2. If template, full clone to new auto-allocated VMID
    3. Start the clone and run update tasks
    4. Stop and convert to new template
    5. Return new template VMID

    Returns the new template VMID (or original VMID if it was a regular container).
    """
    source_vmid = args.update_vmid
    console.always(f"\n=== Update mode: source container {source_vmid} ===")
    timings = TimingsCollector()

    node = await client.aget_node()

    # Check if container exists
    try:
        config = await client.aget_lxc_config(source_vmid, node)
        console.info(f"Container {source_vmid} config loaded")
    except Exception as e:
        console.always(f"ERROR: Container {source_vmid} not found: {e}")
        sys.exit(1)

    # Check if source is a template (template=1 in config)
    is_template = config.get("template", 0) == 1
    console.info(f"Container {source_vmid} is_template: {is_template}")

    if is_template:
        # Clone from template to new VMID
        new_vmid = await client.afind_next_vmid(node)
        hostname = f"cmux-update-{new_vmid}"
        console.always(f"Source {source_vmid} is a template, cloning to new container {new_vmid}...")

        upid = await client.aclone_lxc(
            source_vmid,
            new_vmid,
            hostname=hostname,
            full=True,
            node=node,
        )
        await client.await_task(upid, timeout=600, node=node)
        console.info(f"Clone complete: {source_vmid} -> {new_vmid}")

        work_vmid = new_vmid
    else:
        # Source is a regular container, work on it directly
        work_vmid = source_vmid
        console.info(f"Container {source_vmid} is not a template, updating directly")

    # Start the container
    status = await client.aget_lxc_status(work_vmid, node)
    if status.get("status") != "running":
        console.info(f"Starting container {work_vmid}...")
        upid = await client.astart_lxc(work_vmid, node)
        await client.await_task(upid, timeout=120, node=node)
        await wait_for_container_ready(work_vmid, client, console=console)
    else:
        console.info(f"Container {work_vmid} is already running")

    # Create task context
    ctx = PveTaskContext(
        vmid=work_vmid,
        client=client,
        repo_root=repo_root,
        remote_repo_root="/cmux",
        remote_repo_tar="/tmp/cmux-repo.tar",
        console=console,
        timings=timings,
    )

    # Run update task graph (uses update_registry instead of full registry)
    console.always("\nRunning update tasks (skipping dependency installation)...")
    await run_pve_task_graph(update_registry, ctx)

    graph = format_dependency_graph(update_registry)
    if graph:
        console.always("\nUpdate Mode Dependency Graph")
        for line in graph.splitlines():
            console.always(line)

    summary = timings.summary()
    if summary:
        console.always("\nTiming Summary")
        for line in summary:
            console.always(line)

    # Stop container before converting to template
    console.info(f"Stopping container {work_vmid} for template conversion...")
    upid = await client.astop_lxc(work_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Convert to template
    console.info(f"Converting container {work_vmid} to template...")
    await client.aconvert_to_template(work_vmid, node)

    console.always(f"\n=== Update complete: new template VMID {work_vmid} ===")

    if is_template:
        console.always(f"\nOld template: {source_vmid}")
        console.always(f"New template: {work_vmid}")
        console.always("\nTo use the new template, update manifest or clone from it:")
        console.always(f"  pct clone {work_vmid} <new-vmid>")
    else:
        console.always(f"\nContainer {work_vmid} converted to template")

    return work_vmid


async def provision_and_create_template(
    args: argparse.Namespace,
    *,
    preset: TemplatePresetPlan,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
    created_containers: list[int],
    show_dependency_graph: bool,
) -> TemplateRunResult:
    """Provision a container for a preset and convert to template."""
    console.always(f"\n=== Provisioning preset {preset.preset_id} ({preset.label}) ===")
    timings = TimingsCollector()

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

    # Create task context
    ctx = PveTaskContext(
        vmid=new_vmid,
        client=client,
        repo_root=repo_root,
        remote_repo_root="/cmux",
        remote_repo_tar="/tmp/cmux-repo.tar",
        console=console,
        timings=timings,
    )

    # Run task graph
    await run_pve_task_graph(registry, ctx)

    if show_dependency_graph:
        graph = format_dependency_graph(registry)
        if graph:
            console.always("\nDependency Graph")
            for line in graph.splitlines():
                console.always(line)

    summary = timings.summary()
    if summary:
        console.always("\nTiming Summary")
        for line in summary:
            console.always(line)

    # Stop container before converting to template
    console.info(f"Stopping container {new_vmid} for template conversion...")
    upid = await client.astop_lxc(new_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Convert to template (this enables fast linked-clone)
    console.info(f"Converting container {new_vmid} to template...")
    await client.aconvert_to_template(new_vmid, node)

    captured_at = _iso_timestamp()

    console.always(f"[{preset.preset_id}] Container {new_vmid} converted to template")

    return TemplateRunResult(
        preset=preset,
        template_vmid=new_vmid,
        captured_at=captured_at,
        node=node,
    )


async def provision_and_snapshot(args: argparse.Namespace) -> None:
    """Main provisioning flow."""
    # Set IDE provider before running tasks
    set_ide_provider(args.ide_provider)

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
        ssh_host=os.environ.get("PVE_SSH_HOST"),
    )

    console.info(f"Using SSH host: {client.ssh_host}")

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

    # Bump IDE deps if requested
    if getattr(args, "bump_ide_deps", False):
        bun_path = shutil.which("bun")
        if bun_path is None:
            raise RuntimeError(
                "bun not found on host; install bun or rerun with --no-bump-ide-deps."
            )
        console.always("Bumping IDE deps to latest (bun run bump-ide-deps)...")
        bump_result = subprocess.run(
            [bun_path, "run", "bump-ide-deps"],
            cwd=str(Path(args.repo_root).resolve()),
            text=True,
        )
        if bump_result.returncode != 0:
            raise RuntimeError(
                f"bun run bump-ide-deps failed with exit code {bump_result.returncode}"
            )

    manifest = _load_manifest()
    manifest["baseTemplateVmid"] = args.template_vmid
    repo_root = Path(args.repo_root).resolve()
    preset_plans = _build_preset_plans(args)
    created_containers: list[int] = []
    results: list[TemplateRunResult] = []

    console.always(
        f"Starting template creation for presets "
        f"{', '.join(plan.preset_id for plan in preset_plans)} "
        f"from base template {args.template_vmid} "
        f"(IDE provider: {args.ide_provider})"
    )

    # Start SSH ControlMaster for connection multiplexing
    # This prevents "Connection closed" errors when running many parallel tasks
    console.info("Starting SSH ControlMaster for connection multiplexing...")
    client.start_ssh_control_master()

    try:
        for index, preset_plan in enumerate(preset_plans):
            result = await provision_and_create_template(
                args,
                preset=preset_plan,
                console=console,
                client=client,
                repo_root=repo_root,
                created_containers=created_containers,
                show_dependency_graph=(index == 0),
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
    finally:
        # Always clean up SSH ControlMaster
        client.stop_ssh_control_master()

    # Update manifest
    for result in results:
        manifest = _update_manifest_with_template(
            manifest,
            result.preset,
            result.template_vmid,
            result.captured_at,
            result.node,
        )
    _write_manifest(manifest)

    # Summary
    console.always("\n" + "=" * 60)
    console.always("PVE LXC Template Summary")
    console.always("=" * 60)
    console.always(f"Manifest updated: {PVE_SNAPSHOT_MANIFEST_PATH}")
    console.always("")

    for result in results:
        console.always(f"Preset: {result.preset.preset_id}")
        console.always(f"  Template VMID: {result.template_vmid}")
        console.always(f"  Node: {result.node}")
        console.always(f"  Captured: {result.captured_at}")
        console.always("")

    console.always("To use these templates:")
    console.always("  1. Linked-clone: pct clone <template-vmid> <new-vmid>")
    console.always("  2. Start clone: pct start <new-vmid>")
    console.always("  3. Enter clone: pct enter <new-vmid>")


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
    parser.add_argument(
        "--ide-provider",
        choices=(IDE_PROVIDER_CODER, IDE_PROVIDER_OPENVSCODE, IDE_PROVIDER_CMUX_CODE),
        default=DEFAULT_IDE_PROVIDER,
        help=f"IDE provider to install (default: {DEFAULT_IDE_PROVIDER})",
    )
    parser.add_argument(
        "--bump-ide-deps",
        dest="bump_ide_deps",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Update configs/ide-deps.json to latest versions before snapshotting",
    )
    parser.add_argument(
        "--print-deps",
        action="store_true",
        help="Print dependency graph and exit",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Update mode: update an existing template container in-place (skips dependency installation)",
    )
    parser.add_argument(
        "--update-vmid",
        type=int,
        help="VMID of existing container to update (required with --update)",
    )
    return parser.parse_args()


def main() -> None:
    dotenv.load_dotenv()
    args = parse_args()
    if getattr(args, "print_deps", False):
        # Print appropriate registry based on mode
        target_registry = update_registry if getattr(args, "update", False) else registry
        graph = format_dependency_graph(target_registry)
        if graph:
            print(graph)
        return

    # Validate update mode arguments
    if getattr(args, "update", False):
        if not getattr(args, "update_vmid", None):
            print("ERROR: --update-vmid is required when using --update mode")
            sys.exit(1)
        try:
            asyncio.run(run_update_mode(args))
        except Exception:
            traceback.print_exc()
            sys.exit(1)
    else:
        try:
            asyncio.run(provision_and_snapshot(args))
        except Exception:
            traceback.print_exc()
            sys.exit(1)


async def run_update_mode(args: argparse.Namespace) -> None:
    """Run update mode to update an existing container."""
    # Set IDE provider before running tasks
    set_ide_provider(args.ide_provider)

    console = Console()

    # Validate environment
    api_url = os.environ.get("PVE_API_URL")
    api_token = os.environ.get("PVE_API_TOKEN")

    if not api_url or not api_token:
        console.always("ERROR: PVE_API_URL and PVE_API_TOKEN must be set")
        sys.exit(1)

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
        ssh_host=os.environ.get("PVE_SSH_HOST"),
    )

    console.info(f"Using SSH host: {client.ssh_host}")

    # Test connection
    try:
        version = client.get_version()
        console.always(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        console.always(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    repo_root = Path(args.repo_root).resolve()

    # Start SSH ControlMaster
    console.info("Starting SSH ControlMaster for connection multiplexing...")
    client.start_ssh_control_master()

    try:
        await update_existing_template(
            args,
            console=console,
            client=client,
            repo_root=repo_root,
        )
    finally:
        client.stop_ssh_control_master()


if __name__ == "__main__":
    main()
