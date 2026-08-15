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

Optional environment variables:
    PVE_PUBLIC_DOMAIN - Cloudflare Tunnel domain for HTTP exec (e.g., example.com)
                    When set, uses instanceId-based URL pattern:
                    https://port-{port}-{instanceId}.{domain} for command execution via
                    cmux-execd instead of SSH+pct exec. Falls back to SSH if not set.
    PVE_NODE - Target PVE node name (auto-detected if not set)
    PVE_SSH_HOST - SSH host for fallback (derived from PVE_API_URL if not set)

Examples:
    uv run --env-file .env ./scripts/snapshot-pvelxc.py
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --standard-vcpus 4 --standard-memory 8192
"""

from __future__ import annotations

# Force unbuffered output for real-time console logging
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

import argparse
import asyncio
import http.client
import json
import os
import shlex
import shutil
import ssl
import subprocess
import tarfile
import tempfile
import textwrap
import traceback
import typing as t
import urllib.parse
import urllib.request
import uuid

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import dotenv

from snapshot import (
    TaskRegistry,
    Console,
    TimingsCollector,
    Command,
    format_package_task_label,
    format_dependency_graph,
    is_remote_package_source,
    maybe_apply_ide_package_overrides,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VSCODE_HTTP_PORT = 39378
WORKER_HTTP_PORT = 39376  # Node.js worker (PVE-LXC only); Go worker uses 39377
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

NOVNC_VERSION = "v1.7.0-beta"
NOVNC_DIR = "/usr/share/novnc"
NOVNC_MARKER_FILE = f"{NOVNC_DIR}/.cmux-novnc-version"
NOVNC_DURABLE_MARKER = "/etc/cmux/novnc-version"
NOVNC_PACKAGE_NAME = "novnc"
NOVNC_SOURCE = f"github:noVNC/{NOVNC_VERSION}"
NOVNC_ARCHIVE_URL = (
    f"https://github.com/novnc/noVNC/archive/refs/tags/{NOVNC_VERSION}.tar.gz"
)
NOVNC_PACKAGE_STATE = "purged"


def _build_novnc_shell_vars() -> str:
    return "\n".join(
        [
            f"NOVNC_VERSION={shlex.quote(NOVNC_VERSION)}",
            f"NOVNC_DIR={shlex.quote(NOVNC_DIR)}",
            f"MARKER_FILE={shlex.quote(NOVNC_MARKER_FILE)}",
            f"DURABLE_MARKER={shlex.quote(NOVNC_DURABLE_MARKER)}",
            f"NOVNC_PACKAGE_NAME={shlex.quote(NOVNC_PACKAGE_NAME)}",
            f"NOVNC_SOURCE={shlex.quote(NOVNC_SOURCE)}",
            f"NOVNC_ARCHIVE_URL={shlex.quote(NOVNC_ARCHIVE_URL)}",
            f"NOVNC_PACKAGE_STATE={shlex.quote(NOVNC_PACKAGE_STATE)}",
        ]
    )


def _build_novnc_metadata() -> dict[str, str]:
    return {
        "novncVersion": NOVNC_VERSION,
        "novncSource": NOVNC_SOURCE,
        "novncPackageState": NOVNC_PACKAGE_STATE,
    }


def _build_novnc_description_lines() -> tuple[str, str, str]:
    metadata = _build_novnc_metadata()
    return (
        f"novncVersion: {metadata['novncVersion']}",
        f"novncSource: {metadata['novncSource']}",
        f"novncPackageState: {metadata['novncPackageState']}",
    )

# Default template VMID (should be created via pve-lxc-template.sh)
DEFAULT_TEMPLATE_VMID = 9000

# Base VMID for cloned containers during template building
# Clones will use 9000, 9001, 9002, etc. (auto-increments if slot is taken)
CLONE_BASE_VMID = 9000

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


def get_ide_paths(ide_provider: str) -> tuple[str, str, str, str]:
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
    return server_root, bin_path, extensions_dir, user_data_dir


def load_ide_deps() -> dict[str, t.Any]:
    ide_deps_path = Path(__file__).resolve().parent.parent / "configs/ide-deps.json"
    try:
        return json.loads(ide_deps_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Failed to read {ide_deps_path}") from exc


def get_expected_extension_specs(ide_deps: dict[str, t.Any]) -> list[str]:
    extensions = ide_deps.get("extensions")
    if not isinstance(extensions, list):
        raise RuntimeError("configs/ide-deps.json extensions must be an array.")

    expected_specs: list[str] = []
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
        expected_specs.append(f"{publisher}.{name}@{version}")

    if not expected_specs:
        raise RuntimeError("No extensions found in configs/ide-deps.json.")

    return expected_specs


MARKETPLACE_QUERY_URL = (
    "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
)
MARKETPLACE_QUERY_ACCEPT = "application/json;api-version=3.0-preview.1"
MARKETPLACE_QUERY_FLAGS = 2359
MARKETPLACE_VSIX_ASSET_TYPE = "Microsoft.VisualStudio.Services.VSIXPackage"
_marketplace_versions_cache: dict[tuple[str, str], list[dict[str, t.Any]]] = {}


def build_generic_marketplace_vspackage_url(
    publisher: str,
    name: str,
    version: str,
) -> str:
    return (
        "https://marketplace.visualstudio.com/_apis/public/gallery/"
        f"publishers/{publisher}/vsextensions/{name}/{version}/vspackage"
    )


def detect_vscode_target_platform(
    system_name: str,
    machine_name: str,
) -> str | None:
    normalized_system = system_name.strip().lower()
    normalized_machine = machine_name.strip().lower()
    if normalized_system != "linux":
        return None

    if normalized_machine in {"x86_64", "amd64"}:
        return "linux-x64"
    if normalized_machine in {"aarch64", "arm64"}:
        return "linux-arm64"
    if normalized_machine in {"armv7l", "armv6l"}:
        return "linux-armhf"
    return None


def query_marketplace_extension_versions(
    publisher: str,
    name: str,
) -> list[dict[str, t.Any]]:
    cache_key = (publisher, name)
    cached_versions = _marketplace_versions_cache.get(cache_key)
    if cached_versions is not None:
        return cached_versions

    body = {
        "filters": [
            {
                "criteria": [
                    {
                        "filterType": 7,
                        "value": f"{publisher}.{name}",
                    }
                ],
                "pageSize": 200,
            }
        ],
        "flags": MARKETPLACE_QUERY_FLAGS,
    }
    request = urllib.request.Request(
        MARKETPLACE_QUERY_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": MARKETPLACE_QUERY_ACCEPT,
            "User-Agent": "cmux-snapshot-pvelxc/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(
            f"Failed to query marketplace metadata for {publisher}.{name}"
        ) from exc

    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise RuntimeError(
            f"Marketplace response missing results for {publisher}.{name}"
        )
    first_result = results[0]
    if not isinstance(first_result, dict):
        raise RuntimeError(
            f"Marketplace response malformed for {publisher}.{name}"
        )
    extensions = first_result.get("extensions")
    if not isinstance(extensions, list) or not extensions:
        raise RuntimeError(
            f"Marketplace returned no extension data for {publisher}.{name}"
        )
    extension_entry = extensions[0]
    if not isinstance(extension_entry, dict):
        raise RuntimeError(
            f"Marketplace extension payload malformed for {publisher}.{name}"
        )
    versions = extension_entry.get("versions")
    if not isinstance(versions, list) or not versions:
        raise RuntimeError(
            f"Marketplace returned no versions for {publisher}.{name}"
        )

    normalized_versions = [
        version_entry
        for version_entry in versions
        if isinstance(version_entry, dict)
    ]
    if not normalized_versions:
        raise RuntimeError(
            f"Marketplace version payload malformed for {publisher}.{name}"
        )

    _marketplace_versions_cache[cache_key] = normalized_versions
    return normalized_versions


def resolve_marketplace_extension_source(
    publisher: str,
    name: str,
    version: str,
    *,
    target_platform: str | None,
) -> tuple[str, str | None]:
    versions = query_marketplace_extension_versions(publisher, name)
    matching_versions = [
        version_entry
        for version_entry in versions
        if version_entry.get("version") == version
    ]
    if not matching_versions:
        raise RuntimeError(
            f"Marketplace returned no asset for {publisher}.{name}@{version}"
        )

    selected_version: dict[str, t.Any] | None = None
    preferred_platforms: list[str | None] = []
    if target_platform:
        preferred_platforms.append(target_platform)
    preferred_platforms.append(None)

    for preferred_platform in preferred_platforms:
        for version_entry in matching_versions:
            if version_entry.get("targetPlatform") == preferred_platform:
                selected_version = version_entry
                break
        if selected_version is not None:
            break

    if selected_version is None:
        selected_version = matching_versions[0]

    selected_target_platform = selected_version.get("targetPlatform")
    if not isinstance(selected_target_platform, str):
        selected_target_platform = None

    files = selected_version.get("files")
    if isinstance(files, list):
        for file_entry in files:
            if not isinstance(file_entry, dict):
                continue
            if file_entry.get("assetType") != MARKETPLACE_VSIX_ASSET_TYPE:
                continue
            source = file_entry.get("source")
            if isinstance(source, str) and source.strip():
                return source, selected_target_platform

    asset_uri = selected_version.get("assetUri")
    if isinstance(asset_uri, str) and asset_uri.strip():
        return (
            f"{asset_uri.rstrip('/')}/{MARKETPLACE_VSIX_ASSET_TYPE}",
            selected_target_platform,
        )

    raise RuntimeError(
        f"Marketplace asset source missing for {publisher}.{name}@{version}"
    )


def parse_extension_registry_specs(raw_registry: str) -> set[str]:
    """Extract installed extension specs from VS Code's extensions.json registry."""
    try:
        parsed = json.loads(raw_registry)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Failed to parse extensions registry JSON") from exc

    if not isinstance(parsed, list):
        raise RuntimeError("VS Code extension registry must be a JSON array.")

    installed_specs: set[str] = set()
    for item in parsed:
        if not isinstance(item, dict):
            continue
        identifier = item.get("identifier")
        version = item.get("version")
        if not isinstance(identifier, dict) or not isinstance(version, str):
            continue
        extension_id = identifier.get("id")
        if isinstance(extension_id, str) and extension_id.strip():
            installed_specs.add(f"{extension_id}@{version}")

    return installed_specs


def parse_cli_extension_specs(
    raw_output: str,
    *,
    expected_specs: list[str] | None = None,
) -> set[str]:
    """Extract installed extension specs from CLI output.

    HTTP exec can collapse newlines, so fall back to substring matching when the
    output arrives as a single concatenated line.
    """
    stripped = raw_output.strip()
    if not stripped:
        return set()

    if "\n" in stripped or "\r" in stripped:
        return {line.strip() for line in stripped.splitlines() if line.strip()}

    if expected_specs is None:
        return {stripped}

    return {spec for spec in expected_specs if spec in stripped}


HTTP_EXEC_COMPLETION_MARKER = "__CMUX_EXEC_COMPLETE__:"


def extract_http_exec_completion_marker(stdout: str) -> tuple[str, int | None]:
    """Remove the synthetic completion marker and recover its exit code."""
    marker_index = stdout.rfind(HTTP_EXEC_COMPLETION_MARKER)
    if marker_index == -1:
        return stdout, None

    marker_value_start = marker_index + len(HTTP_EXEC_COMPLETION_MARKER)
    marker_value_end = marker_value_start
    while marker_value_end < len(stdout) and stdout[marker_value_end] in "0123456789-":
        marker_value_end += 1

    try:
        exit_code = int(stdout[marker_value_start:marker_value_end])
    except ValueError:
        return stdout, None

    cleaned_stdout = stdout[:marker_index] + stdout[marker_value_end:]
    return cleaned_stdout, exit_code


def is_transient_http_exec_error(exc: Exception) -> bool:
    """Check if an exception indicates a transient HTTP error worth retrying.

    Matches error messages containing transient HTTP status codes (502-504, 520-524)
    in common error formats like 'HTTP exec error 502' or 'error code: 502'.
    """
    from snapshot.exec import TRANSIENT_HTTP_CODES

    message = str(exc)
    return any(
        f"HTTP exec error {code}" in message or f"error code: {code}" in message
        for code in TRANSIENT_HTTP_CODES
    )


def is_http_exec_transport_failure(exc: Exception) -> bool:
    """Check whether an exception came from an HTTP exec transport failure."""
    message = str(exc)
    return (
        "HTTP exec timed out after" in message
        or "HTTP exec connection error:" in message
    )


def is_http_exec_transport_failure_result(result: subprocess.CompletedProcess[str]) -> bool:
    """Check whether an HTTP exec result failed because the transport dropped.

    These failures should fall back to SSH/pct exec when SSH is available.
    """
    stderr = result.stderr or ""
    if result.returncode == 124 and "HTTP exec timed out after" in stderr:
        return True
    if result.returncode == 125 and "HTTP exec connection error:" in stderr:
        return True
    return False


# ---------------------------------------------------------------------------
# Git Diff Mode Configuration
# ---------------------------------------------------------------------------

# Module-level settings for git diff upload mode
_use_git_diff: bool = False


def set_git_diff_mode(use_diff: bool) -> None:
    global _use_git_diff
    _use_git_diff = use_diff


def get_git_diff_mode() -> bool:
    return _use_git_diff


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
        cf_domain: str | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.node = node
        self.verify_ssl = verify_ssl
        # Cloudflare Tunnel domain for public exec URLs (e.g., "example.com")
        # When set, uses instanceId-based URL pattern: port-{port}-{instanceId}.{cf_domain}
        # Falls back to legacy vmid-based URLs if hostname cannot be resolved.
        self.cf_domain = cf_domain
        self._http_host_ids: dict[int, str] = {}

        # Parse token: user@realm!tokenid=secret
        token_parts = api_token.split("=", 1)
        if len(token_parts) != 2:
            raise ValueError(
                "Invalid PVE_API_TOKEN format. Expected 'user@realm!tokenid=secret'"
            )
        self.token_id = token_parts[0]
        self.token_secret = token_parts[1]

        # SSH host for pct commands.
        # Only use SSH when explicitly configured via PVE_SSH_HOST; GitHub Actions
        # runners often cannot reach the PVE host over port 22, so implicit SSH
        # fallback from the API hostname is not safe here.
        self.ssh_host = ssh_host
        self._ssh_host_explicit = ssh_host is not None
        self._ssh_host_derived = False

        # Cache for cmux-execd auth tokens, keyed by vmid.
        # The execd daemon reads /root/.worker-auth-token at startup and
        # requires a Bearer token for /exec and /files. We fetch it via the
        # PVE API file endpoint and send it with every HTTP exec request.
        self._execd_auth_tokens: dict[int, str] = {}

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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

    # -----------------------------------------------------------------------
    # Execd auth token management
    # -----------------------------------------------------------------------

    def fetch_execd_auth_token(self, vmid: int) -> str | None:
        """Fetch the cmux-execd auth token for a container via PVE API.

        Attempts to read /root/.worker-auth-token from the container filesystem
        using the PVE API. This is a best-effort fallback for when the token
        wasn't pre-fetched before the execd restart.

        The primary mechanism is pre-fetching the token in
        task_restart_execd_early() before the execd restarts, because the PVE
        API file endpoint for LXC may not return file content directly.

        Returns the token string, or None if the token file doesn't exist
        or cannot be read (meaning the execd may be in no-auth mode, or the
        token must be pre-fetched by other means).
        """
        node = self.get_node()
        # Try the PVE API file endpoint. For LXC containers, this endpoint
        # may return file content as raw bytes or JSON-wrapped data.
        endpoint = (
            f"/api2/json/nodes/{node}/lxc/{vmid}/files"
            f"?path=/root/.worker-auth-token"
        )
        url = f"{self.api_url}{endpoint}"
        headers = {
            "Authorization": f"PVEAPIToken={self.token_id}={self.token_secret}",
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(
                req, context=self._ssl_context, timeout=30
            ) as response:
                data = response.read()
                # The PVE API may return raw file content or JSON.
                # Try JSON first, then fall back to raw content.
                try:
                    result = json.loads(data.decode("utf-8", errors="replace"))
                    if isinstance(result, dict):
                        token = result.get("data", {}).get("content", "")
                        if isinstance(token, str) and token.strip():
                            token = token.strip()
                            self._execd_auth_tokens[vmid] = token
                            return token
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass
                # Fall back to treating response as raw file content
                token = data.decode("utf-8", errors="replace").strip()
                if token and not token.startswith("{"):
                    self._execd_auth_tokens[vmid] = token
                    return token
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            pass
        except Exception:
            pass
        return None

    async def afetch_execd_auth_token(self, vmid: int) -> str | None:
        """Async fetch execd auth token."""
        return await asyncio.to_thread(self.fetch_execd_auth_token, vmid)

    def get_execd_auth_token(self, vmid: int) -> str | None:
        """Get the cached execd auth token, fetching it if needed.

        Returns None if no token is configured (no-auth mode).
        """
        if vmid in self._execd_auth_tokens:
            return self._execd_auth_tokens[vmid]
        return self.fetch_execd_auth_token(vmid)

    def clear_execd_auth_token(self, vmid: int) -> None:
        """Clear the cached execd auth token (e.g. after a 401)."""
        self._execd_auth_tokens.pop(vmid, None)

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
        full: bool = False,  # Linked clone by default (fast)
        node: str | None = None,
    ) -> str:
        """Clone an LXC container. Returns task UPID. Default is linked clone (full=False)."""
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
        full: bool = False,  # Linked clone by default (fast)
        node: str | None = None,
    ) -> str:
        """Async clone LXC. Default is linked clone (full=False)."""
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

    async def ashutdown_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async shutdown LXC."""
        return await asyncio.to_thread(self.shutdown_lxc, vmid, node)

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
        description: str | None = None,
        tags: str | None = None,
        node: str | None = None,
    ) -> None:
        """Update LXC container configuration."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {}
        if cores is not None:
            data["cores"] = cores
        if memory is not None:
            data["memory"] = memory
        if description is not None:
            data["description"] = description
        if tags is not None:
            data["tags"] = tags
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
        description: str | None = None,
        tags: str | None = None,
        node: str | None = None,
    ) -> None:
        """Async set LXC config."""
        await asyncio.to_thread(
            self.set_lxc_config,
            vmid,
            cores=cores,
            memory=memory,
            description=description,
            tags=tags,
            node=node,
        )

    def resize_lxc_disk(
        self,
        vmid: int,
        disk: str,
        size: str,
        node: str | None = None,
    ) -> str:
        """Resize LXC container disk. Returns task UPID."""
        node = node or self.get_node()
        data = {
            "disk": disk,
            "size": size,
        }
        result = self._request(
            "PUT",
            f"/api2/json/nodes/{node}/lxc/{vmid}/resize",
            data,
        )
        return result.get("data", "")

    async def aresize_lxc_disk(
        self,
        vmid: int,
        disk: str,
        size: str,
        node: str | None = None,
    ) -> None:
        """Async resize LXC disk and wait for completion."""
        upid = await asyncio.to_thread(
            self.resize_lxc_disk, vmid, disk, size, node=node
        )
        if upid:
            await self.await_task(upid, node=node)

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

    def find_next_vmid(self, node: str | None = None, start: int = 100) -> int:
        """Find the next available VMID starting from `start`.

        Args:
            node: PVE node name (auto-detected if not set)
            start: Starting VMID to search from (default: 100)

        Returns:
            The first available VMID >= start
        """
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

        vmid = start
        while vmid in used_vmids:
            vmid += 1
        return vmid

    async def afind_next_vmid(self, node: str | None = None, start: int = 100) -> int:
        """Async find next VMID starting from `start`."""
        return await asyncio.to_thread(self.find_next_vmid, node, start)

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

    # -----------------------------------------------------------------------
    # HTTP exec operations via cmux-execd (no SSH required)
    # -----------------------------------------------------------------------

    def _normalize_host_id(self, value: str) -> str:
        return value.strip().lower().replace("_", "-")

    def resolve_http_host_id(self, vmid: int) -> str | None:
        cached = self._http_host_ids.get(vmid)
        if cached:
            return cached
        try:
            config = self.get_lxc_config(vmid)
        except Exception:
            return None
        hostname = config.get("hostname")
        if isinstance(hostname, str) and hostname.strip():
            host_id = self._normalize_host_id(hostname)
            self._http_host_ids[vmid] = host_id
            return host_id
        return None

    def build_exec_url(self, vmid: int) -> str | None:
        """Build the HTTP exec URL for a container.

        Returns None if cf_domain is not configured.
        URL pattern (instanceId-based): https://port-{port}-{instanceId}.{cf_domain}
        """
        if not self.cf_domain:
            return None
        host_id = self.resolve_http_host_id(vmid)
        if not host_id:
            return None
        return f"https://port-39375-{host_id}.{self.cf_domain}/exec"

    def http_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str] | None:
        """Execute command inside container via HTTP exec (cmux-execd).

        Returns None if HTTP exec is not available (cf_domain not set).
        Falls back to SSH+pct exec if HTTP exec fails.

        The cmux-execd daemon runs on port 39375 inside containers and is
        exposed via Cloudflare Tunnel using instanceId-based URL pattern:
        https://port-{port}-{instanceId}.{cf_domain}
        """
        exec_url = self.build_exec_url(vmid)
        if not exec_url:
            return None

        return self._http_exec_with_auth(
            exec_url, vmid, command, timeout=timeout, check=check
        )

    def _http_exec_with_auth(
        self,
        exec_url: str,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
        _retry_on_401: bool = True,
    ) -> subprocess.CompletedProcess[str] | None:
        """Execute HTTP exec with auth token, retrying once on 401."""
        timeout_ms = int((timeout or 600) * 1000)
        body = json.dumps({
            "command": f"HOME=/root {command}",
            "timeout_ms": timeout_ms,
        }).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        # Include execd auth token if available. The execd daemon may require
        # a Bearer token (loaded from /root/.worker-auth-token at startup).
        auth_token = self.get_execd_auth_token(vmid)
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        req = urllib.request.Request(
            exec_url,
            data=body,
            headers=headers,
            method="POST",
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []
        exit_code: int | None = None

        try:
            with urllib.request.urlopen(
                req,
                timeout=timeout or 600,
            ) as response:
                # Parse streaming JSON lines response
                for line in response:
                    line_str = line.decode("utf-8").strip()
                    if not line_str:
                        continue
                    try:
                        event = json.loads(line_str)
                        if not isinstance(event, dict):
                            stderr_lines.append(f"Invalid JSON event (not a dict): {line_str}")
                            continue
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
                        stderr_lines.append(line_str)
        except urllib.error.HTTPError as e:
            # Gateway errors (502, 503, 504) and Cloudflare timeout (524) indicate
            # cmux-execd is not available or the request timed out.
            # Return None to trigger fallback to SSH+pct exec if available.
            if e.code in (502, 503, 504, 524):
                return None
            # 401 Unauthorized: the execd daemon requires an auth token but
            # our cached token is missing or stale. Clear the cache and retry
            # once with a fresh token. If the retry also fails, treat it as a
            # transport failure (return None) so callers can retry or fall back.
            if e.code == 401 and _retry_on_401:
                self.clear_execd_auth_token(vmid)
                # Re-fetch token via PVE API and retry
                self.get_execd_auth_token(vmid)
                return self._http_exec_with_auth(
                    exec_url, vmid, command,
                    timeout=timeout, check=check,
                    _retry_on_401=False,
                )
            # 401 after retry, or other client errors: treat as transport failure
            # so callers retry or fall back to SSH if available
            if e.code == 401:
                return None
            error_body = e.read().decode("utf-8", errors="replace")
            stderr_lines.append(f"HTTP exec error {e.code}: {e.reason}\n{error_body}")
            exit_code = 1
        except urllib.error.URLError as e:
            # Connection failed - HTTP exec not available
            return None
        except TimeoutError:
            stderr_lines.append(f"HTTP exec timed out after {timeout}s")
            exit_code = 124
        except (ConnectionResetError, BrokenPipeError, http.client.IncompleteRead) as e:
            # Connection dropped during streaming response - treat as timeout/failure
            # This can happen when Cloudflare Tunnel drops the connection mid-stream
            stderr_lines.append(f"HTTP exec connection error: {e}")
            exit_code = 125
        except OSError as e:
            # Other OS errors (e.g., network unreachable, connection refused)
            # Return None to trigger SSH fallback if available
            return None

        stdout, synthetic_exit_code = extract_http_exec_completion_marker(
            "".join(stdout_lines)
        )
        if exit_code is None and synthetic_exit_code is not None:
            exit_code = synthetic_exit_code

        if exit_code is None:
            stderr_lines.append(
                "HTTP exec connection error: stream ended without exit event"
            )
            exit_code = 125

        result = subprocess.CompletedProcess(
            args=command,
            returncode=exit_code,
            stdout=stdout,
            stderr="".join(stderr_lines),
        )

        if check and result.returncode != 0:
            raise RuntimeError(
                f"HTTP exec failed (exit {result.returncode}):\n"
                f"Command: {command}\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        return result

    async def ahttp_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str] | None:
        """Async HTTP exec."""
        return await asyncio.to_thread(
            self.http_exec, vmid, command, timeout=timeout, check=check
        )

    def exec_in_container(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command inside container, preferring HTTP exec over SSH.

        Tries HTTP exec first (via cmux-execd), falls back to SSH+pct exec
        only if PVE_SSH_HOST was explicitly provided.

        Raises RuntimeError if HTTP exec is not available and SSH is not configured.
        """
        # Try HTTP exec first if available
        result = self.http_exec(vmid, command, timeout=timeout, check=False)
        if result is not None:
            if self.ssh_host and is_http_exec_transport_failure_result(result):
                return self.pct_exec(vmid, command, timeout=timeout, check=check)
            if check and result.returncode != 0:
                raise RuntimeError(
                    f"Command failed (exit {result.returncode}):\n"
                    f"Command: {command}\n"
                    f"stdout: {result.stdout}\n"
                    f"stderr: {result.stderr}"
                )
            return result

        # HTTP exec not available - check if SSH fallback is configured
        if not self.ssh_host:
            raise RuntimeError(
                f"HTTP exec (cmux-execd) not available for container {vmid} and "
                f"SSH fallback not configured.\n"
                f"Options:\n"
                f"  1. Set PVE_SSH_HOST=root@<pve-host-ip> to enable SSH fallback\n"
                f"  2. Ensure cmux-execd is running in the container for HTTP exec"
            )

        # Fall back to SSH+pct exec
        return self.pct_exec(vmid, command, timeout=timeout, check=check)

    async def aexec_in_container(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async exec in container with HTTP/SSH fallback."""
        return await asyncio.to_thread(
            self.exec_in_container, vmid, command, timeout=timeout, check=check
        )

    def http_push_file(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> bool:
        """Push a file to container via HTTP exec using base64 encoding.

        Returns True if successful, False if HTTP exec is not available.
        """
        import base64

        exec_url = self.build_exec_url(vmid)
        if not exec_url:
            return False

        # Read local file and encode as base64
        with open(local_path, "rb") as f:
            file_data = f.read()
        b64_data = base64.b64encode(file_data).decode("ascii")

        # Escape the remote path for shell
        escaped_path = shlex.quote(remote_path)
        parent_dir = shlex.quote(str(Path(remote_path).parent))

        # Initialize the remote file
        init_cmd = f"mkdir -p {parent_dir} && : > {escaped_path}"
        result = self.http_exec(vmid, init_cmd, timeout=timeout, check=False)
        if result is None:
            return False

        if result.returncode != 0:
            # Fall back to SSH for payload too large errors (Cloudflare limit)
            if "413" in result.stderr or "Payload Too Large" in result.stderr:
                return False
            raise RuntimeError(
                f"HTTP file push failed (exit {result.returncode}):\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        # Append base64 in chunks to avoid shell argument limits
        chunk_size = 8192  # multiple of 4 for base64 alignment
        for offset in range(0, len(b64_data), chunk_size):
            chunk = b64_data[offset: offset + chunk_size]
            append_cmd = (
                f"printf '%s' '{chunk}' | base64 -d >> {escaped_path}"
            )
            result = self.http_exec(vmid, append_cmd, timeout=timeout, check=False)
            if result is None:
                return False
            if result.returncode != 0:
                if "413" in result.stderr or "Payload Too Large" in result.stderr:
                    return False
                raise RuntimeError(
                    f"HTTP file push failed (exit {result.returncode}):\n"
                    f"stdout: {result.stdout}\n"
                    f"stderr: {result.stderr}"
                )

        return True

    async def ahttp_push_file(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> bool:
        """Async HTTP file push."""
        return await asyncio.to_thread(
            self.http_push_file, vmid, local_path, remote_path, timeout=timeout
        )

    def push_file_to_container(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push file to container, preferring HTTP over SSH.

        Tries HTTP push first (via cmux-execd), falls back to SSH+pct push
        only if PVE_SSH_HOST was explicitly provided.

        Raises RuntimeError if HTTP push is not available and SSH is not configured.
        """
        # Try HTTP push first if available
        try:
            if self.http_push_file(vmid, local_path, remote_path, timeout=timeout):
                return
        except RuntimeError as exc:
            transport_failure = (
                "HTTP exec timed out after" in str(exc)
                or "HTTP exec connection error:" in str(exc)
                or "HTTP exec error 401" in str(exc)
            )
            if not transport_failure:
                raise

        # HTTP push not available - check if SSH fallback is configured
        if not self.ssh_host:
            raise RuntimeError(
                f"HTTP exec (cmux-execd) not available for container {vmid} and "
                f"SSH fallback not configured.\n"
                f"Options:\n"
                f"  1. Set PVE_SSH_HOST=root@<pve-host-ip> to enable SSH fallback\n"
                f"  2. Ensure cmux-execd is running in the container for HTTP exec"
            )

        # Fall back to SSH+pct push
        self.pct_push(vmid, local_path, remote_path, timeout=timeout)

    async def apush_file_to_container(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Async push file to container with HTTP/SSH fallback."""
        await asyncio.to_thread(
            self.push_file_to_container, vmid, local_path, remote_path, timeout=timeout
        )


# ---------------------------------------------------------------------------
# Manifest types and helpers
# ---------------------------------------------------------------------------


class PveTemplateVersionEntry(t.TypedDict):
    """A version entry for a preset template (schema v2)."""
    version: int
    snapshotId: str
    templateVmid: int  # The VMID of the template container
    capturedAt: str
    novncVersion: t.NotRequired[str]
    novncSource: t.NotRequired[str]
    novncPackageState: t.NotRequired[str]


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
    Each preset's 'versions' contains snapshotId and templateVmid for
    instanceId-based snapshot selection.
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
    snapshot_id: str
    template_vmid: int  # The VMID of the created template
    captured_at: str
    node: str


def _resolve_repo_relative_path(repo_root: Path, path: str) -> Path:
    out = Path(path).expanduser()
    if not out.is_absolute():
        out = (repo_root / out)
    return out.resolve()


def _serialize_template_result(result: TemplateRunResult) -> dict[str, t.Any]:
    metadata = _build_novnc_metadata()
    return {
        "presetId": result.preset.preset_id,
        "label": result.preset.label,
        "snapshotId": result.snapshot_id,
        "templateVmid": result.template_vmid,
        "capturedAt": result.captured_at,
        "node": result.node,
        "vcpus": result.preset.vcpus,
        "memoryMib": result.preset.memory_mib,
        "diskSizeMib": result.preset.disk_size_mib,
        **metadata,
    }


def _write_results_json(
    *,
    out_path: Path,
    mode: str,
    base_template_vmid: int,
    ide_provider: str,
    results_payload: list[dict[str, t.Any]],
    execd_tokens: dict[int, str] | None = None,
) -> None:
    payload = {
        "schemaVersion": 1,
        "mode": mode,
        "baseTemplateVmid": base_template_vmid,
        "ideProvider": ide_provider,
        "manifestPath": str(PVE_SNAPSHOT_MANIFEST_PATH),
        "generatedAt": _iso_timestamp(),
        "results": results_payload,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    # Persist the execd auth token of each built template next to the results
    # so the runtime smoke test can pass it to devsh via PVE_EXECD_TOKEN_FILE.
    # Clones of a template keep the template's token while the PVE host stays
    # booted (boot-id rotation only fires on host reboot), so the token cached
    # during the build is valid for the smoke containers. The token files are
    # not part of the results payload and are cleaned up by the smoke script.
    if execd_tokens:
        for result in results_payload:
            template_vmid = result.get("templateVmid")
            snapshot_id = result.get("snapshotId")
            if not template_vmid or not snapshot_id:
                continue
            token = execd_tokens.get(template_vmid)
            if token:
                token_path = out_path.parent / f"execd-token-{snapshot_id}.txt"
                token_path.write_text(token.strip() + "\n", encoding="utf-8")


def _iso_timestamp() -> str:
    return (
        datetime.now(tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _generate_instance_id(prefix: str = "pvelxc") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _generate_snapshot_id() -> str:
    return f"snapshot_{uuid.uuid4().hex[:8]}"


def _preset_id_to_tag(preset_id: str) -> str:
    return f"preset-{preset_id.replace('_', '-')}"


def _build_template_tags(preset_id: str | None) -> str:
    tags = ["cmux"]
    if preset_id:
        tags.append(_preset_id_to_tag(preset_id))
    return ";".join(tags)


def _build_template_description(
    *,
    snapshot_id: str,
    preset_id: str | None,
    captured_at: str,
    source_vmid: int,
    hostname: str | None,
) -> str:
    lines = [
        "cmux template snapshot",
        f"snapshotId: {snapshot_id}",
        f"presetId: {preset_id}" if preset_id else "presetId: unknown",
        f"capturedAt: {captured_at}",
        f"sourceVmid: {source_vmid}",
        *_build_novnc_description_lines(),
    ]
    if hostname:
        lines.append(f"hostname: {hostname}")
    return "\n".join(lines)


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


def _ensure_manifest_snapshot_ids(manifest: PveTemplateManifestEntry) -> None:
    for preset in manifest.get("presets", []):
        for version in preset.get("versions", []):
            if not version.get("snapshotId"):
                version["snapshotId"] = _generate_snapshot_id()


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
    _ensure_manifest_snapshot_ids(raw_manifest)
    return raw_manifest


def _write_manifest(manifest: PveTemplateManifestEntry) -> None:
    PVE_SNAPSHOT_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n"
    )


def _find_preset_for_vmid(manifest: PveTemplateManifestEntry, vmid: int) -> PveTemplatePresetEntry | None:
    """Find the preset entry that contains a given template VMID."""
    for preset in manifest.get("presets", []):
        for version in preset.get("versions", []):
            if version.get("templateVmid") == vmid:
                return preset
    return None


def _add_version_to_preset(
    preset_entry: PveTemplatePresetEntry,
    template_vmid: int,
    snapshot_id: str,
    captured_at: str,
) -> None:
    """Add a new version entry to an existing preset."""
    next_version = 1
    if preset_entry["versions"]:
        next_version = max(entry["version"] for entry in preset_entry["versions"]) + 1

    version_entry: PveTemplateVersionEntry = {
        "version": next_version,
        "snapshotId": snapshot_id,
        "templateVmid": template_vmid,
        "capturedAt": captured_at,
        **_build_novnc_metadata(),
    }
    preset_entry["versions"].append(version_entry)
    preset_entry["versions"].sort(key=lambda entry: entry["version"])


def _update_manifest_with_template(
    manifest: PveTemplateManifestEntry,
    preset: TemplatePresetPlan,
    template_vmid: int,
    snapshot_id: str,
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

    version_entry: PveTemplateVersionEntry = {
        "version": next_version,
        "snapshotId": snapshot_id,
        "templateVmid": template_vmid,
        "capturedAt": captured_at,
        **_build_novnc_metadata(),
    }
    preset_entry["versions"].append(version_entry)
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
        """Execute command via HTTP exec (cmux-execd) or SSH + pct exec fallback."""
        self.console.info(f"[{label}] running...")

        # Wrap command in bash explicitly to ensure pipefail support
        # This handles the case where execd may use /bin/sh (dash) which doesn't support pipefail
        # We invoke bash explicitly so the script works regardless of execd's shell
        wrapped_command = textwrap.dedent(
            f"""
            (
            {command}
            )
            cmux_exit_code=$?
            printf '\\n{HTTP_EXEC_COMPLETION_MARKER}%s\\n' "$cmux_exit_code"
            exit "$cmux_exit_code"
            """
        ).strip()
        escaped_command = wrapped_command.replace("'", "'\"'\"'")
        script = f"/bin/bash -c '{escaped_command}'"

        attempts = 0
        max_attempts = 3
        while True:
            attempts += 1
            try:
                # Use aexec_in_container which prefers HTTP exec over SSH
                result = await self.client.aexec_in_container(
                    self.vmid,
                    script,
                    timeout=timeout,
                    check=False,  # We handle errors ourselves
                )
                if is_http_exec_transport_failure_result(result):
                    if attempts < max_attempts:
                        delay = float(min(2**attempts, 8))
                        failure_message = result.stderr.strip() or (
                            "HTTP exec transport failed"
                        )
                        self.console.info(
                            f"[{label}] retrying after transport failure "
                            f"({failure_message}) "
                            f"(attempt {attempts}/{max_attempts}) in {delay}s"
                        )
                        await asyncio.sleep(delay)
                        continue
                break
            except subprocess.TimeoutExpired as e:
                raise TimeoutError(f"Command timed out after {timeout}s") from e
            except (OSError, RuntimeError) as exc:
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
        """Push a file to the container via HTTP exec or SSH + pct push."""
        await self.client.apush_file_to_container(
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


def get_git_remote_url(repo_root: Path) -> str | None:
    """Get the git remote origin URL."""
    try:
        output = _exec_git(repo_root, ["remote", "get-url", "origin"])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def get_current_branch(repo_root: Path) -> str | None:
    """Get the current branch name."""
    try:
        output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        if output:
            branch = output.strip()
            if branch != "HEAD":  # Not detached HEAD
                return branch
    except RuntimeError:
        pass
    return None


def get_upstream_branch(repo_root: Path) -> str | None:
    """Get the upstream tracking branch (e.g., 'origin/main')."""
    try:
        output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "@{upstream}"])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def get_remote_branch_commit(repo_root: Path, remote_branch: str) -> str | None:
    """Get the commit hash of a remote branch (e.g., 'origin/main')."""
    try:
        output = _exec_git(repo_root, ["rev-parse", remote_branch])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def create_full_diff_patch(repo_root: Path, base_ref: str) -> Path | None:
    """Create a git diff patch that includes ALL local changes relative to base_ref.

    This includes:
    - Unpushed commits (commits between base_ref and HEAD)
    - Staged changes
    - Unstaged changes

    Returns the path to the patch file, or None if no changes.
    """
    tmp = tempfile.NamedTemporaryFile(
        suffix=".patch", delete=False, mode="wb"
    )
    tmp_path = Path(tmp.name)
    tmp.close()

    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")

    try:
        # Create diff from base_ref to current working tree (includes everything)
        # --binary: include binary files
        # base_ref: the reference point (e.g., origin/branch)
        # No second ref means "working tree" (includes uncommitted changes)
        completed = subprocess.run(
            ["git", "diff", "--binary", base_ref],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )

        diff_output = completed.stdout

        # Also get staged changes that might not be captured by the above
        # (in case there are staged changes not yet committed)
        # This is redundant with the above, but just to be safe
        if not diff_output.strip():
            print(f"[git-diff] No differences from {base_ref}")
            tmp_path.unlink(missing_ok=True)
            return None

        tmp_path.write_bytes(diff_output)
        patch_size = tmp_path.stat().st_size
        print(f"[git-diff] Created full patch from {base_ref}: {patch_size} bytes")
        return tmp_path

    except Exception as e:
        print(f"[git-diff] Failed to create full diff patch: {e}")
        tmp_path.unlink(missing_ok=True)
        return None


def create_local_changes_patch(repo_root: Path) -> Path | None:
    """Create a git diff patch for local uncommitted changes only.

    Returns the path to the patch file, or None if no local changes.
    This captures staged + unstaged changes in the working directory.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="cmux-local-", suffix=".patch", delete=False
    )
    tmp_path = Path(tmp.name)
    tmp.close()

    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")

    try:
        # Get staged changes
        completed_staged = subprocess.run(
            ["git", "diff", "--binary", "--cached"],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )
        staged_diff = completed_staged.stdout if completed_staged.returncode == 0 else b""

        # Get unstaged changes (working directory)
        completed_unstaged = subprocess.run(
            ["git", "diff", "--binary"],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )
        unstaged_diff = completed_unstaged.stdout if completed_unstaged.returncode == 0 else b""

        # Combine diffs
        combined_diff = b""
        if staged_diff:
            combined_diff = staged_diff
        if unstaged_diff:
            if combined_diff:
                combined_diff += b"\n"
            combined_diff += unstaged_diff

        if not combined_diff.strip():
            print("[git-diff] No local uncommitted changes")
            tmp_path.unlink(missing_ok=True)
            return None

        tmp_path.write_bytes(combined_diff)
        patch_size = tmp_path.stat().st_size
        print(f"[git-diff] Created local changes patch: {patch_size} bytes")
        return tmp_path

    except Exception as e:
        print(f"[git-diff] Failed to create local changes patch: {e}")
        tmp_path.unlink(missing_ok=True)
        return None


async def upload_repo_via_diff(
    vmid: int,
    client: PveLxcClient,
    repo_root: Path,
    remote_repo_root: str,
    console: Console,
) -> bool:
    """Upload repository via git clone from GitHub + local changes patch.

    New approach:
    1. Get git remote URL and current branch name
    2. Get upstream tracking branch (e.g., origin/feature/branch)
    3. In container: git clone + checkout the tracking branch
    4. Create diff from tracking branch to local working tree (includes unpushed commits + uncommitted changes)
    5. Upload and apply the diff patch

    This is much faster than uploading full archive because:
    - The base repo comes from GitHub (fast, no upload needed)
    - Only local changes (unpushed + uncommitted) need to be uploaded as a patch

    Returns True if successful, False if fallback to full upload is needed.
    """
    # Get git remote URL
    remote_url = await asyncio.to_thread(get_git_remote_url, repo_root)
    if not remote_url:
        console.info("[git-diff] No git remote URL found, falling back to full upload")
        return False

    # Get current branch
    current_branch = await asyncio.to_thread(get_current_branch, repo_root)
    if not current_branch:
        console.info("[git-diff] Not on a branch (detached HEAD), falling back to full upload")
        return False

    # Get upstream tracking branch (e.g., origin/feature/branch)
    upstream_branch = await asyncio.to_thread(get_upstream_branch, repo_root)
    if not upstream_branch:
        # If no tracking branch, assume origin/<current_branch>
        upstream_branch = f"origin/{current_branch}"
        console.info(f"[git-diff] No upstream tracking branch, assuming {upstream_branch}")

    # Get the commit hash of the upstream branch
    upstream_commit = await asyncio.to_thread(get_remote_branch_commit, repo_root, upstream_branch)
    if not upstream_commit:
        console.info(f"[git-diff] Cannot find upstream branch {upstream_branch}, falling back to full upload")
        return False

    console.info(f"[git-diff] Remote: {remote_url}")
    console.info(f"[git-diff] Branch: {current_branch}")
    console.info(f"[git-diff] Upstream: {upstream_branch} ({upstream_commit[:12]})")

    # Step 1: Clone or fetch repo in container at the upstream branch
    # Use bash explicitly for pipefail support (dash/sh doesn't support it)
    # Extract branch name from upstream_branch (e.g., "origin/feature/foo" -> "feature/foo")
    remote_branch_name = "/".join(upstream_branch.split("/")[1:])  # "feature/foo"

    clone_cmd = textwrap.dedent(
        f"""
        bash -c 'set -euo pipefail
        REPO_DIR={shlex.quote(remote_repo_root)}
        REMOTE_URL={shlex.quote(remote_url)}
        BRANCH={shlex.quote(remote_branch_name)}
        TARGET_COMMIT={shlex.quote(upstream_commit)}

        if [ -d "$REPO_DIR/.git" ]; then
            echo "[git-diff] Existing repo found, fetching updates..."
            cd "$REPO_DIR"
            git fetch origin "$BRANCH"
            git checkout -f "$TARGET_COMMIT"
            # Snapshot builds reuse a disposable checkout in /cmux. Remove ignored
            # artifacts like node_modules so stale binaries cannot survive across runs.
            git clean -ffdx
        else
            echo "[git-diff] Cloning repository from GitHub..."
            rm -rf "$REPO_DIR"
            # Clone the specific branch
            git clone --branch "$BRANCH" --single-branch "$REMOTE_URL" "$REPO_DIR" || {{
                # If branch clone fails, try full clone
                echo "[git-diff] Branch clone failed, trying full clone..."
                git clone "$REMOTE_URL" "$REPO_DIR"
            }}
            cd "$REPO_DIR"
            git checkout -f "$TARGET_COMMIT"
            git clean -ffdx
        fi
        echo "[git-diff] Repository at commit $(git rev-parse --short HEAD)"
        '
        """
    ).strip()

    console.info(f"[git-diff] Cloning/fetching branch {remote_branch_name} from GitHub in container...")

    # Retry clone operation a few times to handle transient HTTP errors (502, etc.)
    max_clone_attempts = 3
    clone_delay = 5.0
    result = None
    for attempt in range(1, max_clone_attempts + 1):
        result = await client.aexec_in_container(vmid, clone_cmd, timeout=300, check=False)
        if result.returncode == 0:
            break
        # Check for transient errors that are worth retrying
        is_transient = any(
            err in result.stderr
            for err in ["502", "503", "504", "Bad Gateway", "Service Unavailable", "Gateway Timeout"]
        )
        if not is_transient or attempt >= max_clone_attempts:
            console.info(f"[git-diff] Clone/fetch failed: {result.stderr}")
            console.info(f"[git-diff] stdout: {result.stdout}")
            return False
        console.info(f"[git-diff] Clone attempt {attempt}/{max_clone_attempts} failed with transient error, retrying in {clone_delay}s...")
        await asyncio.sleep(clone_delay)
        clone_delay *= 2  # Exponential backoff

    if result is None or result.returncode != 0:
        return False

    for line in result.stdout.splitlines():
        if line.strip():
            console.info(f"  {line}")

    # Step 2: Create full diff patch (unpushed commits + uncommitted changes)
    # This diffs from the upstream branch to the current working tree
    patch_path = await asyncio.to_thread(create_full_diff_patch, repo_root, upstream_branch)

    if patch_path is not None:
        try:
            patch_size = patch_path.stat().st_size
            console.info(f"[git-diff] Full patch size (unpushed + uncommitted): {patch_size} bytes")

            # Upload patch file
            remote_patch_path = "/tmp/cmux-full.patch"
            if client.cf_domain:
                console.info(f"[git-diff] Uploading patch to container {vmid} via HTTP exec...")
            else:
                console.info(f"[git-diff] Uploading patch to container {vmid} via SSH...")
            await client.apush_file_to_container(vmid, str(patch_path), remote_patch_path)

            # Apply patch in container
            # Use bash explicitly for pipefail support (dash/sh doesn't support it)
            console.info("[git-diff] Applying full patch...")
            apply_cmd = textwrap.dedent(
                f"""
                bash -c 'set -euo pipefail
                cd {shlex.quote(remote_repo_root)}
                git apply --whitespace=nowarn {remote_patch_path}
                rm -f {remote_patch_path}
                echo "[git-diff] Patch applied successfully"
                '
                """
            ).strip()

            result = await client.aexec_in_container(vmid, apply_cmd, timeout=120, check=False)
            if result.returncode != 0:
                console.info(f"[git-diff] Patch apply failed: {result.stderr}")
                console.info("[git-diff] Continuing with upstream branch only (no local changes)")
            else:
                console.info("[git-diff] Full patch applied (unpushed commits + uncommitted changes)")
        finally:
            patch_path.unlink(missing_ok=True)
    else:
        console.info("[git-diff] No local changes to apply (working tree matches upstream)")

    console.info("[git-diff] Repository updated via git clone + patch")
    return True


async def upload_repo_to_container(
    vmid: int,
    client: PveLxcClient,
    repo_root: Path,
    remote_tar_path: str,
    console: Console,
) -> None:
    """Upload repository archive to container via HTTP exec or SSH + pct push."""
    console.info("Creating repository archive...")
    archive = await asyncio.to_thread(create_repo_archive, repo_root)
    try:
        if client.cf_domain:
            console.info(f"Uploading repository to container {vmid} via HTTP exec...")
        else:
            console.info(f"Uploading repository to container {vmid} via SSH...")
        await client.apush_file_to_container(vmid, str(archive), remote_tar_path)
        console.info(f"Repository uploaded to {remote_tar_path}")
    finally:
        archive.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Task registry and task definitions
# ---------------------------------------------------------------------------

dotenv.load_dotenv()

registry = TaskRegistry()
update_registry = TaskRegistry()  # Subset of tasks for --update mode


# Shell helper to wait for apt/dpkg lock before running apt commands.
# This prevents race conditions when multiple tasks try to use apt concurrently.
# Uses apt-get options to wait for locks instead of fuser (which may not be installed).
APT_WAIT_LOCK_HELPER = """
# Configure apt to wait for locks instead of failing immediately
export APT_LOCK_WAIT_OPTS="-o DPkg::Lock::Timeout=120"
"""


@registry.task(
    name="apt-bootstrap",
    description="Install core apt utilities and set up package sources",
)
async def task_apt_bootstrap(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux

        # Stop unattended-upgrades to prevent apt lock conflicts
        systemctl stop unattended-upgrades.service 2>/dev/null || true
        systemctl disable unattended-upgrades.service 2>/dev/null || true

        # Wait for any existing apt/dpkg locks to be released (up to 120s)
        while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
              fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
            echo "Waiting for apt/dpkg locks..."
            sleep 5
        done

        # Configure APT for parallel downloads
        cat > /etc/apt/apt.conf.d/99parallel << 'EOF'
        Acquire::Queue-Mode "host";
        APT::Acquire::Max-Parallel-Downloads "16";
        Acquire::http::Pipeline-Depth "10";
        Acquire::https::Pipeline-Depth "10";
        EOF

        # Update and install core utilities (with lock timeout)
        DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 update
        DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y \
            ca-certificates curl wget jq git gnupg lsb-release \
            tar unzip xz-utils zip bzip2 gzip htop lsof psmisc

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
            x11-xserver-utils xterm \
            dbus-x11 openbox xclip xsel parcellite \
            tmux \
            bubblewrap \
            gh \
            zsh \
            zsh-autosuggestions \
            ripgrep ffmpeg xdotool expect

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
    name="upgrade-novnc",
    deps=("install-base-packages",),
    description="Install managed noVNC 1.7.0-beta for improved clipboard sync",
)
@update_registry.task(
    name="upgrade-novnc",
    deps=(),  # Safe to run anytime in update mode
    description="Install managed noVNC 1.7.0-beta for improved clipboard sync",
)
async def task_upgrade_novnc(ctx: PveTaskContext) -> None:
    """
    Install managed noVNC from GitHub and remove the distro novnc package.

    The newer version includes PR #1993 which adds automatic clipboard sync
    between the browser and VNC session, improving clipboard paste reliability.
    See: https://github.com/novnc/noVNC/pull/1993
    """
    shell_vars = _build_novnc_shell_vars()
    cmd = textwrap.dedent(
        f"""
        set -eu

        {shell_vars}

        if dpkg-query -W -f='${{Status}}\n' "$NOVNC_PACKAGE_NAME" 2>/dev/null | grep -q '^install ok installed$'; then
            DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 purge -y "$NOVNC_PACKAGE_NAME"
            DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 autoremove -y
        fi

        cd /tmp
        rm -rf noVNC-* novnc-*.tar.gz novnc.tar.gz

        for attempt in 1 2 3; do
            if curl -fsSL --retry 3 --retry-delay 5 \
                "$NOVNC_ARCHIVE_URL" \
                -o novnc.tar.gz; then
                break
            fi
            if [ $attempt -eq 3 ]; then
                echo "[upgrade-novnc] ERROR: Failed to download after 3 attempts" >&2
                exit 1
            fi
            sleep 5
        done

        if [ ! -f novnc.tar.gz ] || [ ! -s novnc.tar.gz ]; then
            echo "[upgrade-novnc] ERROR: Downloaded file is missing or empty" >&2
            ls -la novnc.tar.gz 2>/dev/null || true
            exit 1
        fi

        tar xzf novnc.tar.gz
        EXTRACTED_DIR="$(ls -d noVNC-* 2>/dev/null | head -1)"

        if [ -z "$EXTRACTED_DIR" ] || [ ! -d "$EXTRACTED_DIR" ]; then
            echo "[upgrade-novnc] ERROR: Failed to extract noVNC archive" >&2
            ls -la /tmp/noVNC-* 2>/dev/null || echo "No extracted dirs found"
            exit 1
        fi

        if [ ! -f "$EXTRACTED_DIR/vnc.html" ] || [ ! -f "$EXTRACTED_DIR/core/rfb.js" ]; then
            echo "[upgrade-novnc] ERROR: Extracted archive missing expected files" >&2
            ls -la "$EXTRACTED_DIR/" 2>/dev/null || true
            exit 1
        fi

        HAD_BRIDGE=0
        if grep -q "vnc-clipboard-bridge" "$NOVNC_DIR/vnc.html" 2>/dev/null; then
            HAD_BRIDGE=1
        fi

        OLD_INDEX=""
        if [ -L "$NOVNC_DIR/index.html" ]; then
            OLD_INDEX="$(readlink -f "$NOVNC_DIR/index.html" 2>/dev/null || true)"
        fi

        install -d "$NOVNC_DIR"
        rm -rf "${{NOVNC_DIR:?}}"/*
        cp -r "$EXTRACTED_DIR"/* "$NOVNC_DIR/"

        if [ -n "$OLD_INDEX" ] && [ -f "$NOVNC_DIR/vnc.html" ]; then
            ln -sf vnc.html "$NOVNC_DIR/index.html"
        fi

        echo "$NOVNC_VERSION" > "$MARKER_FILE"
        install -Dm0644 "$MARKER_FILE" "$DURABLE_MARKER"

        rm -rf /tmp/noVNC-* /tmp/novnc.tar.gz

        if [ ! -f "$NOVNC_DIR/vnc.html" ] || [ ! -f "$NOVNC_DIR/core/rfb.js" ]; then
            echo "[upgrade-novnc] ERROR: Installation verification failed" >&2
            ls -la "$NOVNC_DIR/" 2>/dev/null || true
            exit 1
        fi

        if dpkg-query -W -f='${{Status}}\\n' "$NOVNC_PACKAGE_NAME" 2>/dev/null | grep -q '^install ok installed$'; then
            echo "[upgrade-novnc] ERROR: Distro package $NOVNC_PACKAGE_NAME is still installed" >&2
            exit 1
        fi

        echo "[upgrade-novnc] Installed managed noVNC $NOVNC_VERSION"

        if [ "$HAD_BRIDGE" = "1" ]; then
            echo "[upgrade-novnc] Note: clipboard bridge will be re-injected"
        fi
        """
    )
    verify_cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        {shell_vars}
        [ -f "$MARKER_FILE" ]
        [ "$(cat "$MARKER_FILE")" = "$NOVNC_VERSION" ]
        [ -f "$NOVNC_DIR/vnc.html" ]
        [ -f "$NOVNC_DIR/core/rfb.js" ]
        if dpkg-query -W -f='${{Status}}\\n' "$NOVNC_PACKAGE_NAME" 2>/dev/null | grep -q '^install ok installed$'; then
            echo "[upgrade-novnc] ERROR: Distro package $NOVNC_PACKAGE_NAME is still installed" >&2
            exit 1
        fi
        echo "[upgrade-novnc] verified"
        """
    )
    for attempt in range(1, 4):
        try:
            await ctx.run("upgrade-novnc", cmd)
            break
        except Exception as exc:
            if is_http_exec_transport_failure(exc):
                try:
                    await ctx.run("verify-upgrade-novnc", verify_cmd)
                    return
                except Exception as verify_exc:
                    if not is_http_exec_transport_failure(verify_exc):
                        raise verify_exc from exc
            if attempt >= 3 or not (
                is_transient_http_exec_error(exc)
                or is_http_exec_transport_failure(exc)
            ):
                raise
            delay = float(attempt * 5)
            ctx.console.info(
                f"[upgrade-novnc] retrying after transient exec error "
                f"(attempt {attempt}/3) in {delay:.1f}s"
            )
            await asyncio.sleep(delay)


@registry.task(
    name="configure-networkd-dhcp",
    deps=("install-base-packages",),
    description="Ensure systemd-networkd DHCP settings (SendHostname=yes, UseDNS=no)",
)
@update_registry.task(
    name="configure-networkd-dhcp",
    deps=(),  # Safe to run anytime in update mode
    description="Ensure systemd-networkd DHCP settings (SendHostname=yes, UseDNS=no)",
)
async def task_configure_networkd_dhcp(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail

        iface="eth0"
        net_file="$(
          networkctl status "${iface}" --no-pager 2>/dev/null \
            | awk -F': ' '/Network File/ {print $2; exit}' \
            | tr -d '\\r'
        )"
        if [ -z "${net_file}" ] && [ -f /etc/systemd/network/eth0.network ]; then
          net_file="/etc/systemd/network/eth0.network"
        fi
        if [ -z "${net_file}" ]; then
          echo "[networkd] ERROR: could not determine Network File for ${iface}" >&2
          networkctl status "${iface}" --no-pager 2>/dev/null || true
          ls -la /etc/systemd/network 2>/dev/null || true
          exit 1
        fi

        base="$(basename "${net_file}")"
        drop_dir="/etc/systemd/network/${base}.d"
        drop_file="${drop_dir}/99-cmux-dhcp.conf"
        install -d -m 0755 "${drop_dir}"
        cat > "${drop_file}" <<'EOF'
# Managed by cmux snapshot-pvelxc.py
# Ensures router DNS can resolve container hostnames and preserves custom DNS.
[DHCPv4]
SendHostname=yes
UseDNS=no
EOF

        echo "[networkd] Installed ${drop_file} (base: ${net_file})"
        """
    )
    await ctx.run("configure-networkd-dhcp", cmd)


@registry.task(
    name="ensure-docker",
    deps=("install-base-packages",),
    description="Install Docker engine and CLI plugins",
)
async def task_ensure_docker(ctx: PveTaskContext) -> None:
    install_cmd = APT_WAIT_LOCK_HELPER + textwrap.dedent(
        """
        set -euo pipefail

        echo "[docker] ensuring Docker APT repository"
        # Use DPkg::Lock::Timeout to wait for locks instead of failing immediately
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y ca-certificates curl
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
        # Retry apt-get update up to 3 times
        for i in 1 2 3; do
          DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update && break || {
            if [ $i -eq 3 ]; then
              echo "apt-get update failed after 3 attempts" >&2
              exit 1
            fi
            echo "apt-get update failed, retrying in 5s..." >&2
            sleep 5
          }
        done
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y \
          docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Disable standard Docker services to avoid race condition with cmux-dockerd.service
        # cmux-dockerd.service has fallback logic to run dockerd directly
        systemctl disable docker.service docker.socket || true
        systemctl stop docker.service docker.socket || true

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
        NVM_VERSION="v0.39.7"
        mkdir -p "${NVM_DIR}"
        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "${tmp_dir}"' EXIT
        cd "${tmp_dir}"
        curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 300 \
          "https://github.com/nvm-sh/nvm/archive/refs/tags/${NVM_VERSION}.tar.gz" \
          -o nvm.tar.gz
        tar -xzf nvm.tar.gz
        extracted_dir="$(find . -maxdepth 1 -type d -name 'nvm-*' | head -1)"
        if [ -z "${extracted_dir}" ] || [ ! -f "${extracted_dir}/nvm.sh" ]; then
          echo "[install-nvm] ERROR: extracted nvm archive is missing nvm.sh" >&2
          ls -la
          exit 1
        fi
        rm -rf "${NVM_DIR}"/*
        cp -r "${extracted_dir}"/. "${NVM_DIR}/"
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
    description="Install Bun runtime (background download to avoid Cloudflare timeout)",
)
async def task_install_bun(ctx: PveTaskContext) -> None:
    # Check if bun is already installed (base template may have it)
    check_result = await ctx.client.aexec_in_container(
        ctx.vmid,
        "command -v bun && bun --version",
        timeout=15,
        check=False,
    )
    if check_result.returncode == 0 and "bun" in check_result.stdout.lower():
        version = check_result.stdout.strip().split("\n")[-1]
        ctx.console.info(f"[install-bun] Bun already installed: {version}")
        return

    # Step 1: Detect architecture and start bun download in background
    # The background download avoids Cloudflare Tunnel's ~100s timeout
    cmd = textwrap.dedent(
        """
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
    )
    await ctx.run("start-bun-download", cmd, timeout=60)

    # Step 2: Poll for download completion
    ctx.console.info("[install-bun] Waiting for background download to complete...")
    max_wait = 600  # 10 minutes max
    poll_interval = 10
    elapsed = 0

    while elapsed < max_wait:
        try:
            result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "[ -f /tmp/bun-download-done ] && echo done || echo waiting",
                timeout=15,
                check=False,
            )
        except (RuntimeError, TimeoutError) as e:
            # Transient failure in exec connection (e.g. Cloudflare tunnel hiccup)
            ctx.console.info(f"[install-bun] Polling check failed ({e}), retrying in {poll_interval}s...")
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            continue

        if "done" in result.stdout:
            ctx.console.info("[install-bun] Download completed")
            break
        # Check for download failure
        if elapsed > 30:  # Give it some time to start
            check_result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "pgrep -f 'curl.*bun.zip' > /dev/null && echo running || echo stopped",
                timeout=15,
                check=False,
            )
            if "stopped" in check_result.stdout and "done" not in result.stdout:
                # Download process stopped but didn't complete
                log_result = await ctx.client.aexec_in_container(
                    ctx.vmid,
                    "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                    timeout=15,
                    check=False,
                )
                raise RuntimeError(f"Bun download failed:\n{log_result.stdout}")
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        if elapsed % 30 == 0:
            ctx.console.info(f"[install-bun] Still downloading... ({elapsed}s)")
    else:
        # Timeout - get the log for debugging
        try:
            log_result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                timeout=15,
                check=False,
            )
            log_content = log_result.stdout
        except Exception as e:
            log_content = f"Could not retrieve log: {e}"
        
        raise TimeoutError(f"Bun download timed out after {max_wait}s\nLog: {log_content}")

    # Step 3: Extract and install bun
    cmd = textwrap.dedent(
        """
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
    )
    await ctx.run("install-bun-binary", cmd, timeout=600)


@registry.task(
    name="install-go-toolchain",
    deps=("install-base-packages",),
    description="Install Go toolchain for building CMux helpers",
)
async def task_install_go_toolchain(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        GO_VERSION="1.25.5"
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
    cmd = APT_WAIT_LOCK_HELPER + textwrap.dedent(
        """
        set -eux
        # Use DPkg::Lock::Timeout to wait for locks instead of failing immediately
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y python3-pip
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
    deps=("apt-bootstrap", "restart-execd-early"),
    description="Install Cmux Code (VSCode fork with OpenVSIX)",
)
async def task_install_cmux_code(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_CMUX_CODE:
        ctx.console.info("Skipping install-cmux-code (IDE provider is not cmux-code)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/karlorz/vscode-1/releases/latest | jq -r '.tag_name' | sed 's|^v||')"
        if [ -z "${CODE_RELEASE}" ] || [ "${CODE_RELEASE}" = "null" ]; then
          echo "ERROR: Failed to get cmux-code release version from GitHub API" >&2
          exit 1
        fi
        echo "Installing cmux-code version: ${CODE_RELEASE}"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/cmux-code
        url="https://github.com/karlorz/vscode-1/releases/download/v${CODE_RELEASE}/vscode-server-linux-${ARCH}-web.tar.gz"
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
  "extensions.verifySignature": false,
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000
}
EOF

        # Verify binary exists after extraction
        bin_path="/app/cmux-code/bin/code-server-oss"
        if [ ! -x "${bin_path}" ]; then
          echo "ERROR: cmux-code binary not found at ${bin_path} after extraction" >&2
          echo "Checking /app/cmux-code contents:" >&2
          find /app/cmux-code -type f -name "code-server*" 2>/dev/null || echo "No code-server binaries found"
          ls -la /app/cmux-code/bin/ 2>/dev/null || echo "bin directory missing or empty"
          exit 1
        fi
        echo "cmux-code binary verified at ${bin_path}"
        """
    )
    # Write the script to a local temp file, push it to the container,
    # then execute it. This avoids shell escaping issues with large scripts.
    import tempfile
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sh", delete=False
    ) as script_file:
        script_file.write(cmd)
        script_file.flush()
        local_script_path = script_file.name

    try:
        remote_script_path = "/tmp/install-cmux-code.sh"
        await ctx.push_file(local_script_path, remote_script_path)
        # Note: Don't use 'exec' here - it replaces the shell process which can
        # cause the HTTP exec daemon to think the command completed prematurely
        install_cmd = f"chmod +x {remote_script_path} && bash {remote_script_path}"
        try:
            await ctx.run("install-cmux-code", install_cmd)
        except RuntimeError as exc:
            if not is_http_exec_transport_failure(exc):
                raise
            verify_cmd = textwrap.dedent(
                """
                set -euo pipefail
                test -x /app/cmux-code/bin/code-server-oss
                test -f /root/.vscode-server-oss/data/User/settings.json
                echo "[install-cmux-code] verified"
                """
            )
            await ctx.run("verify-install-cmux-code", verify_cmd)
    finally:
        import os
        os.unlink(local_script_path)


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
    use_diff = get_git_diff_mode()

    # Try git diff mode if enabled (clones from GitHub + applies local changes)
    if use_diff:
        ctx.console.info("[upload-repo] Git diff mode enabled (clone from GitHub + local changes)")
        diff_success = await upload_repo_via_diff(
            ctx.vmid,
            ctx.client,
            ctx.repo_root,
            ctx.remote_repo_root,
            ctx.console,
        )
        if diff_success:
            ctx.console.info("[upload-repo] Repository updated via git clone + local patch")
            return
        ctx.console.info("[upload-repo] Git diff failed, falling back to full upload")

    # Full upload mode (default or fallback)
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
    deps=("install-repo-dependencies", "restart-execd-early"),
    description="Package the cmux VS Code extension for installation",
)
@update_registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies", "restart-execd-early"),
    description="Package the cmux VS Code extension for installation",
)
async def task_package_vscode_extension(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}/packages/vscode-extension
        # Compile the extension first (bun:prepublish runs compile-bun)
        bun run compile
        # Use local vsce binary from node_modules instead of bunx
        # This avoids bunx auto-install issues through proxy
        vsce_bin="{repo}/node_modules/.bin/vsce"
        if [ ! -x "$vsce_bin" ]; then
          echo "[package-vscode-extension] vsce not found in node_modules, trying bun install..."
          bun install
          if [ ! -x "$vsce_bin" ]; then
            echo "[package-vscode-extension] ERROR: vsce still not found after bun install" >&2
            exit 1
          fi
        fi
        "$vsce_bin" package --allow-missing-repository --no-dependencies --allow-star-activation || true
        echo "[package-vscode-extension] Looking for vsix file..."
        ls -la *.vsix 2>/dev/null || true
        latest_vsix="$(ls -1t cmux-vscode-extension-*.vsix 2>/dev/null | head -n 1)"
        if [ -z "${{latest_vsix}}" ] || [ ! -f "${{latest_vsix}}" ]; then
          echo "[package-vscode-extension] ERROR: cmux VS Code extension package not found" >&2
          exit 1
        fi
        echo "[package-vscode-extension] Found: ${{latest_vsix}}"
        install -Dm0644 "${{latest_vsix}}" /tmp/cmux-vscode-extension.vsix
        echo "[package-vscode-extension] Installed to /tmp/cmux-vscode-extension.vsix"
        ls -la /tmp/cmux-vscode-extension.vsix
        """
    )
    await ctx.run("package-vscode-extension", cmd)


@registry.task(
    name="install-ide-extensions",
    deps=("install-openvscode", "install-coder", "install-cmux-code", "package-vscode-extension", "restart-execd-early", "build-worker-daemon"),
    description="Preinstall language extensions for the IDE",
)
@update_registry.task(
    name="install-ide-extensions",
    # Depends on restart-execd-early to ensure the new execd is running before this task
    deps=("package-vscode-extension", "restart-execd-early", "build-worker-daemon"),
    description="Preinstall language extensions for the IDE",
)
async def task_install_ide_extensions(ctx: PveTaskContext) -> None:
    ide_provider = get_ide_provider()
    server_root, bin_path, extensions_dir, user_data_dir = get_ide_paths(
        ide_provider
    )
    ide_deps = load_ide_deps()
    expected_specs = get_expected_extension_specs(ide_deps)
    extensions = ide_deps["extensions"]

    # Install extensions using smaller inline commands instead of a large script file.
    # This works around HTTP exec streaming issues where large scripts get truncated.

    # Step 1: Install the bundled cmux extension
    cmux_vsix = "/tmp/cmux-vscode-extension.vsix"
    repo_cmux_vsix_glob = (
        f"{ctx.remote_repo_root}/packages/vscode-extension/cmux-vscode-extension-*.vsix"
    )
    install_cmd = textwrap.dedent(
        f"""
        set -eux
        export HOME=/root
        if ls -d {extensions_dir}/cmux.* 2>/dev/null; then
            echo "[install-ide-extensions] cmux extension already present"
            exit 0
        fi
        if [ ! -f {cmux_vsix} ]; then
            latest_vsix="$(ls -1t {repo_cmux_vsix_glob} 2>/dev/null | head -n 1)"
            if [ -z "${{latest_vsix}}" ] || [ ! -f "${{latest_vsix}}" ]; then
                echo "[install-ide-extensions] ERROR: bundled cmux VSIX missing" >&2
                exit 1
            fi
            install -Dm0644 "${{latest_vsix}}" {cmux_vsix}
        fi
        echo "[install-ide-extensions] checking cmux extension"
        ls -la {cmux_vsix}
        echo "[install-ide-extensions] installing bundled cmux extension"
        {bin_path} --install-extension {cmux_vsix} --force --extensions-dir {extensions_dir} --user-data-dir {user_data_dir} </dev/null
        echo "[install-ide-extensions] cmux extension installed"
        # Verify the extension was actually installed
        if ! ls -d {extensions_dir}/cmux.* 2>/dev/null; then
            echo "[install-ide-extensions] ERROR: cmux extension not found in {extensions_dir}" >&2
            exit 1
        fi
        """
    )
    await ctx.run("install-cmux-ext", install_cmd)

    # Step 2: Install marketplace extensions one at a time through a small
    # helper script. Long multi-extension runs can terminate early over HTTP
    # exec, so keep each remote invocation short and retryable.
    target_platform_result = await ctx.run(
        "detect-extension-target-platform",
        'printf "%s|%s" "$(uname -s)" "$(uname -m)"',
        timeout=30,
    )
    system_name, machine_name = ("", "")
    if "|" in target_platform_result.stdout:
        system_name, machine_name = target_platform_result.stdout.strip().split("|", 1)
    detected_target_platform = detect_vscode_target_platform(system_name, machine_name)
    ctx.console.info(
        "[install-marketplace-exts] "
        f"detected target platform {detected_target_platform or 'universal-fallback'} "
        f"from {system_name or 'unknown'} {machine_name or 'unknown'}"
    )

    extension_specs: list[tuple[str, str, str, str, str, str | None]] = []
    for ext in extensions:
        publisher = ext.get("publisher")
        name = ext.get("name")
        version = ext.get("version")
        ext_id = f"{publisher}.{name}"
        if (
            not isinstance(publisher, str)
            or not isinstance(name, str)
            or not isinstance(version, str)
        ):
            raise RuntimeError(f"Invalid extension entry {ext!r}")
        source_url = build_generic_marketplace_vspackage_url(
            publisher,
            name,
            version,
        )
        resolved_target_platform: str | None = None
        try:
            source_url, resolved_target_platform = resolve_marketplace_extension_source(
                publisher,
                name,
                version,
                target_platform=detected_target_platform,
            )
        except Exception as exc:
            ctx.console.info(
                "[install-marketplace-exts] "
                f"WARN: failed to resolve targeted asset for {ext_id}@{version}: {exc}; "
                "falling back to generic vspackage URL"
            )
        extension_specs.append(
            (
                publisher,
                name,
                version,
                ext_id,
                source_url,
                resolved_target_platform,
            )
        )

    expected_specs_blob = "\n".join(expected_specs)
    install_extension_cmd = textwrap.dedent(
        f"""
        set -eux
        export HOME=/root
        bin_path="{bin_path}"
        extensions_dir="{extensions_dir}"
        user_data_dir="{user_data_dir}"
        mkdir -p "${{extensions_dir}}" "${{user_data_dir}}"
        publisher="$1"
        name="$2"
        version="$3"
        source_url="$4"
        ext_id="${{publisher}}.${{name}}"
        install_from_file() {{
          local package_path="$1"
          echo "[install-ide-extensions] installing ${{package_path}}"
          "${{bin_path}}" \
            --install-extension "${{package_path}}" \
            --force \
            --extensions-dir "${{extensions_dir}}" \
            --user-data-dir "${{user_data_dir}}"
        }}
        download_dir="$(mktemp -d)"
        cleanup() {{
          rm -rf "${{download_dir}}"
        }}
        trap cleanup EXIT
        destination="${{download_dir}}/${{ext_id}}.vsix"
        tmpfile="${{destination}}.download"
        curl_stderr="${{tmpfile}}.stderr"
        echo "[install-ide-extensions] fetch ${{ext_id}}@${{version}} from ${{source_url}}"
        if ! curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o "${{tmpfile}}" "${{source_url}}" 2>"${{curl_stderr}}"; then
          if [ -s "${{curl_stderr}}" ]; then
            cat "${{curl_stderr}}" >&2
          fi
          exit 1
        fi
        rm -f "${{curl_stderr}}"
        if gzip -t "${{tmpfile}}" >/dev/null 2>&1; then
          gunzip -c "${{tmpfile}}" > "${{destination}}"
          rm -f "${{tmpfile}}"
        else
          mv "${{tmpfile}}" "${{destination}}"
        fi
        install_from_file "${{destination}}"
        if ! "${{bin_path}}" --list-extensions --show-versions \
          --extensions-dir "${{extensions_dir}}" \
          --user-data-dir "${{user_data_dir}}" \
          | grep -Fqx "${{ext_id}}@${{version}}"; then
          echo "[install-ide-extensions] ERROR: expected ${{ext_id}}@${{version}} after install" >&2
          "${{bin_path}}" --list-extensions --show-versions \
            --extensions-dir "${{extensions_dir}}" \
            --user-data-dir "${{user_data_dir}}" >&2 || true
          exit 1
        fi
        rm -f "${{destination}}"
        echo "[install-ide-extensions] installed ${{ext_id}}@${{version}}"
        """
    )
    verify_extensions_cmd = textwrap.dedent(
        f"""
        set -eux
        export HOME=/root
        bin_path="{bin_path}"
        extensions_dir="{extensions_dir}"
        user_data_dir="{user_data_dir}"
        installed="$("${{bin_path}}" --list-extensions --show-versions --extensions-dir "${{extensions_dir}}" --user-data-dir "${{user_data_dir}}" || true)"
        while IFS= read -r expected; do
          [ -z "${{expected}}" ] && continue
          if ! printf '%s\n' "${{installed}}" | grep -Fqx "${{expected}}"; then
            echo "[install-ide-extensions] ERROR: missing expected extension ${{expected}}" >&2
            printf '%s\n' "${{installed}}" >&2
            exit 1
          fi
        done <<'EXPECTED_EXTENSIONS'
{expected_specs_blob}
EXPECTED_EXTENSIONS
        echo "[install-ide-extensions] completed installs"
        """
    )
    import tempfile
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sh", delete=False
    ) as script_file:
        script_file.write(install_extension_cmd)
        script_file.flush()
        local_script_path = script_file.name

    try:
        remote_script_path = "/tmp/install-marketplace-ext.sh"
        chmod_remote_script = shlex.quote(remote_script_path)
        await ctx.push_file(local_script_path, remote_script_path)
        await ctx.run(
            "install-marketplace-exts-setup",
            f"chmod +x {chmod_remote_script}",
            timeout=60,
        )
        ctx.console.info(
            f"[install-marketplace-exts] preparing {len(extension_specs)} marketplace extensions"
        )
        for (
            publisher,
            name,
            version,
            ext_id,
            source_url,
            resolved_target_platform,
        ) in extension_specs:
            task_label = ext_id.replace(".", "-")
            expected_spec = f"{ext_id}@{version}"
            verify_extension_cmd = textwrap.dedent(
                f"""
                set -euo pipefail
                export HOME=/root
                bin_path="{bin_path}"
                extensions_dir="{extensions_dir}"
                user_data_dir="{user_data_dir}"
                installed="$("${{bin_path}}" --list-extensions --show-versions \
                  --extensions-dir "${{extensions_dir}}" \
                  --user-data-dir "${{user_data_dir}}" || true)"
                if ! printf '%s\\n' "${{installed}}" | grep -Fqx "{expected_spec}"; then
                  echo "[install-ide-extensions] ERROR: missing expected extension {expected_spec}" >&2
                  printf '%s\\n' "${{installed}}" >&2
                  exit 1
                fi
                echo "[install-ide-extensions] verified {expected_spec}"
                """
            )
            if resolved_target_platform:
                ctx.console.info(
                    f"[install-marketplace-exts] using {resolved_target_platform} asset "
                    f"for {ext_id}@{version}"
                )
            run_cmd = (
                f"{chmod_remote_script} "
                f"{shlex.quote(publisher)} "
                f"{shlex.quote(name)} "
                f"{shlex.quote(version)} "
                f"{shlex.quote(source_url)}"
            )
            for attempt in range(1, 4):
                try:
                    await ctx.run(
                        f"install-ext-{task_label}",
                        run_cmd,
                        timeout=60 * 15,
                    )
                    break
                except Exception as exc:
                    if is_http_exec_transport_failure(exc):
                        try:
                            await ctx.run(
                                f"verify-ext-{task_label}",
                                verify_extension_cmd,
                                timeout=60 * 2,
                            )
                            break
                        except Exception as verify_exc:
                            if not is_http_exec_transport_failure(verify_exc):
                                raise verify_exc from exc
                    if attempt >= 3 or not (
                        is_transient_http_exec_error(exc)
                        or is_http_exec_transport_failure(exc)
                    ):
                        raise
                    delay = float(attempt * 5)
                    ctx.console.info(
                        f"[install-ext-{task_label}] retrying after transient exec error "
                        f"(attempt {attempt}/3) in {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
        await ctx.run(
            "verify-marketplace-exts",
            verify_extensions_cmd,
            timeout=60 * 5,
        )
    finally:
        import os
        os.unlink(local_script_path)


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
    name="install-agy",
    deps=("apt-bootstrap",),
    description="Install Google Antigravity CLI (agy) via official installer",
)
@update_registry.task(
    name="install-agy",
    deps=("restart-execd-early",),  # avoid execd restart cutting the big download mid-stream
    description="Install Google Antigravity CLI (agy) via official installer",
)
async def task_install_agy(ctx: PveTaskContext) -> None:
    # agy has no official npm package (the `agy` npm name is an unrelated
    # placeholder), so use Google's official installer like install-cursor-cli.
    # Installs the ~170 MB binary to /root/.local/bin/agy; idempotent.
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        if [ ! -x /root/.local/bin/agy ]; then
            curl -fsSL https://antigravity.google/cli/install.sh | bash
        fi
        /root/.local/bin/agy --version
        """
    )
    # ~170 MB download through the HTTP exec stream; give it 40 min (no retry
    # on timeout, only on transport failures, so a low cap would fail slow links)
    await ctx.run("install-agy", cmd, timeout=60 * 40)


@registry.task(
    name="install-global-cli",
    deps=("install-bun", "install-node-runtime"),
    description="Install global agent CLIs with bun",
)
async def task_install_global_cli(ctx: PveTaskContext) -> None:
    ide_deps = load_ide_deps()

    packages = ide_deps.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError("configs/ide-deps.json packages must be an object.")

    package_specs: list[tuple[str, str, str]] = []
    for name, spec in packages.items():
        if not isinstance(name, str) or not isinstance(spec, str):
            raise RuntimeError(f"Invalid package entry {name!r}: {spec!r}")
        install_spec = spec if is_remote_package_source(spec) else f"{name}@{spec}"
        package_specs.append((name, spec, install_spec))

    if not package_specs:
        raise RuntimeError("No packages found in configs/ide-deps.json.")

    # Install each package individually with retries for resilience
    max_retries = 3
    retry_delay = 5  # seconds

    for index, (name, spec, install_spec) in enumerate(package_specs, 1):
        is_remote = is_remote_package_source(spec)
        install_label = spec if is_remote else install_spec
        ctx.console.info(
            f"Installing package {index}/{len(package_specs)}: {install_label}"
        )
        last_error: Exception | None = None
        task_label = format_package_task_label(name)
        quoted_install_spec = shlex.quote(install_spec)

        for attempt in range(1, max_retries + 1):
            try:
                cmd = (
                    f"npm install -g {quoted_install_spec}"
                    if is_remote
                    else f"bun add -g {quoted_install_spec}"
                )
                await ctx.run(f"install-pkg-{task_label}", cmd)
                last_error = None
                ctx.console.info(f"Successfully installed {install_label}")
                break
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    ctx.console.info(
                        f"Attempt {attempt}/{max_retries} failed for {install_label}, "
                        f"retrying in {retry_delay}s..."
                    )
                    await asyncio.sleep(retry_delay)
                else:
                    ctx.console.info(
                        f"All {max_retries} attempts failed for {install_label}"
                    )

        if last_error is not None:
            raise RuntimeError(
                f"Failed to install {install_label} after {max_retries} attempts"
            ) from last_error

    # Verify critical binaries are installed
    verify_cmd = textwrap.dedent(
        """
        set -e
        echo "Verifying installed CLIs..."
        which claude && claude --version || echo "claude not found"
        which codex && codex --version || echo "codex not found"
        which opencode && opencode --version || echo "opencode not found"
        which gemini && gemini --version || echo "gemini not found"
        which bwrap && bwrap --version || echo "bwrap not found"
        # amp may not have --version, just check existence
        which amp || echo "amp not found"
        # grok-build CLI (grok); agy is verified by its own install-agy task
        which grok && grok --version || echo "grok not found"
        which devcontainer && devcontainer --version || echo "devcontainer not found"
        echo "CLI verification complete"
        """
    )
    await ctx.run("verify-global-cli", verify_cmd)


@registry.task(
    name="setup-claude-oauth-wrappers",
    deps=("install-global-cli",),
    description="Create wrapper scripts for claude/npx to support OAuth token injection",
)
@update_registry.task(
    name="setup-claude-oauth-wrappers",
    deps=(),  # No deps - global-cli already installed
    description="Create wrapper scripts for claude/npx to support OAuth token injection",
)
async def task_setup_claude_oauth_wrappers(ctx: PveTaskContext) -> None:
    script_path = Path(__file__).parent.parent / "configs" / "setup-claude-oauth-wrappers.sh"
    script_content = script_path.read_text()
    try:
        await ctx.run("setup-claude-oauth-wrappers", script_content)
        return
    except RuntimeError as exc:
        if not is_http_exec_transport_failure(exc):
            raise

    verify_cmd = textwrap.dedent(
        """
        set -euo pipefail
        test -f /etc/claude-code/env
        claude_path="$(command -v claude)"
        test -n "$claude_path"
        head -1 "$claude_path" | grep -q '^#!/bin/bash'
        grep -q '/etc/claude-code/env' "$claude_path"
        grep -q 'claude-real' "$claude_path"

        npx_path="$(command -v npx || true)"
        if [ -n "$npx_path" ] && [ -e "$(dirname "$npx_path")/npx-real" ]; then
            head -1 "$npx_path" | grep -q '^#!/bin/bash'
            grep -q '/etc/claude-code/env' "$npx_path"
            grep -q 'npx-real' "$npx_path"
        fi

        echo "[setup-claude-oauth-wrappers] verified"
        """
    )
    await ctx.run("verify-claude-oauth-wrappers", verify_cmd)


@registry.task(
    name="install-devsh-skill",
    deps=("install-global-cli",),
    description="Install devsh Claude Code skill from GitHub",
)
@update_registry.task(
    name="install-devsh-skill",
    deps=(),
    description="Install devsh Claude Code skill from GitHub",
)
async def task_install_devsh_skill(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(f"""\
        set -e
        SKILL_DIR="/root/.claude/skills/devsh"
        LOCAL_SKILL_PATH={repo}/.agents/skills/devsh/SKILL.md
        mkdir -p "$SKILL_DIR"
        if [ -f "$LOCAL_SKILL_PATH" ]; then
            cp "$LOCAL_SKILL_PATH" "$SKILL_DIR/SKILL.md"
            echo "Installed devsh skill from local repo to $SKILL_DIR/SKILL.md"
        else
            curl -fsSL "https://raw.githubusercontent.com/karlorz/devsh/main/.agents/skills/devsh/SKILL.md" -o "$SKILL_DIR/SKILL.md"
            echo "Installed devsh skill from GitHub to $SKILL_DIR/SKILL.md"
        fi
        head -5 "$SKILL_DIR/SKILL.md"
    """)
    await ctx.run("install-devsh-skill", cmd)


@registry.task(
    name="configure-zsh",
    deps=("upload-repo", "install-base-packages"),
    description="Install zsh configuration and default prompt",
)
async def task_configure_zsh(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
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
        """
    )
    # Install cmux-env.sh and zsh-history.sh from repo (separate command to allow f-string substitution)
    install_cmd = f"""
        cat {repo}/configs/zsh-history.sh >> /root/.zshrc
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
        install -Dm0644 {repo}/configs/profile.d/cmux-env.sh /etc/profile.d/cmux-env.sh
    """
    await ctx.run("configure-zsh", cmd + "\n" + install_cmd)


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
    name="install-vnc-clipboard-bridge",
    deps=("upload-repo", "upgrade-novnc"),
    description="Install VNC clipboard bridge for cross-origin paste support",
)
@update_registry.task(
    name="install-vnc-clipboard-bridge",
    deps=("upload-repo", "upgrade-novnc"),
    description="Install VNC clipboard bridge for cross-origin paste support",
)
async def task_install_vnc_clipboard_bridge(ctx: PveTaskContext) -> None:
    """
    Injects the VNC clipboard bridge script into /usr/share/novnc/vnc.html.

    The bridge enables clipboard paste from the parent window (cmux client) into
    the VNC session. The parent intercepts paste events when the iframe is focused
    and sends clipboard text via postMessage. This script receives those messages
    and injects the text into the VNC session using noVNC's RFB API.
    """
    repo = shlex.quote(ctx.remote_repo_root)
    shell_vars = _build_novnc_shell_vars()
    cmd = textwrap.dedent(
        f"""
        set -eux

        {shell_vars}
        VNC_HTML="$NOVNC_DIR/vnc.html"
        BRIDGE_SCRIPT="{repo}/packages/sandbox/scripts/vnc-clipboard-bridge.js"

        ensure_markers() {{
            install -d /etc/cmux
            printf '%s\n' "$NOVNC_VERSION" > "$MARKER_FILE"
            install -Dm0644 "$MARKER_FILE" "$DURABLE_MARKER"
        }}

        if [ ! -f "$VNC_HTML" ]; then
            echo "[vnc-clipboard-bridge] vnc.html not found at $VNC_HTML, skipping"
            exit 0
        fi

        if [ ! -f "$BRIDGE_SCRIPT" ]; then
            echo "[vnc-clipboard-bridge] Bridge script not found at $BRIDGE_SCRIPT" >&2
            exit 1
        fi

        # Check if already injected
        if grep -q "vnc-clipboard-bridge" "$VNC_HTML" 2>/dev/null; then
            ensure_markers
            echo "[vnc-clipboard-bridge] Already installed, marker synchronized"
            exit 0
        fi

        # Create a backup
        cp "$VNC_HTML" "$VNC_HTML.backup"

        # Inject the script before </body> using Python for reliable multiline handling
        VNC_HTML_PATH="$VNC_HTML" BRIDGE_SCRIPT_PATH="$BRIDGE_SCRIPT" python3 << 'INJECT_SCRIPT'
import os
import sys

vnc_html_path = os.environ.get("VNC_HTML_PATH", "/usr/share/novnc/vnc.html")
bridge_script_path = os.environ["BRIDGE_SCRIPT_PATH"]

with open(bridge_script_path, "r") as f:
    bridge_js = f.read()

with open(vnc_html_path, "r") as f:
    html = f.read()

# NOTE: This inject body is embedded in an outer Python f-string (shell cmd).
# Use a plain string + concat here — an f-string would re-parse JS braces as
# expressions (SyntaxError on mod.default). Outer f-string still needs {{ }}.
script_tag = '''<script type="module" id="vnc-clipboard-bridge-init">
// Expose UI to window for clipboard bridge access.
// IMPORTANT: do not use a static import of app/ui.js here.
// The head <script type=module> already imports UI and uses top-level await
// (defaults.json / mandatory.json). A second static import races the live
// binding and throws: Cannot access 'UI' before initialization.
// Dynamic import() waits until the module graph finishes evaluating.
import('./app/ui.js').then((mod) => {{
  window.UI = mod.default;
}}).catch((err) => {{
  console.warn('[vnc-clipboard-bridge] deferred UI import failed', err);
}});
</script>
<script id="vnc-clipboard-bridge">
''' + bridge_js + '''
</script>
'''

if "</body>" not in html:
    print("[vnc-clipboard-bridge] </body> tag not found in vnc.html", file=sys.stderr)
    sys.exit(1)

html = html.replace("</body>", script_tag + "</body>")

with open(vnc_html_path, "w") as f:
    f.write(html)

print("[vnc-clipboard-bridge] Successfully installed into " + vnc_html_path)
INJECT_SCRIPT

        ensure_markers
        echo "[vnc-clipboard-bridge] Marker synchronized to $MARKER_FILE and $DURABLE_MARKER"
        """
    )
    await ctx.run("install-vnc-clipboard-bridge", cmd)


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
        # Force rebuild by touching source files (git apply doesn't always update timestamps)
        touch main.go
        go build -trimpath -o /usr/local/bin/{EXECD_BINARY_NAME} .
        if [ ! -x /usr/local/bin/{EXECD_BINARY_NAME} ]; then
          echo "Failed to build {EXECD_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-execd", cmd)


@registry.task(
    name="build-worker-daemon",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build Go worker-daemon for SSH/PTY proxy (port 39377)",
)
@update_registry.task(
    name="build-worker-daemon",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build Go worker-daemon for SSH/PTY proxy (port 39377)",
)
async def task_build_worker_daemon(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/bin
        cd {repo}/packages/cloudrouter
        # Force rebuild by touching source files (git apply doesn't always update timestamps)
        touch cmd/worker/main.go
        CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/worker-daemon ./cmd/worker
        if [ ! -x /usr/local/bin/worker-daemon ]; then
          echo "Failed to build worker-daemon" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-worker-daemon", cmd)


@registry.task(
    name="restart-execd-early",
    deps=("build-execd",),
    description="Restart execd service to use newly-built binary for long-running tasks",
)
@update_registry.task(
    name="restart-execd-early",
    deps=("build-execd",),
    description="Restart execd service to use newly-built binary for long-running tasks",
)
async def task_restart_execd_early(ctx: PveTaskContext) -> None:
    """Restart execd to use the newly-built binary with streaming fixes.

    This must run after build-execd and before any long-running tasks (like
    build-rust-binaries) to ensure they use the fixed execd that properly
    streams output to completion.

    We use nohup with a small delay because the current HTTP request is being
    handled by the old execd - we need to let the restart happen after this
    request returns.

    Before restarting, we pre-fetch the execd auth token via the current
    (old) execd so the client has it cached for all post-restart requests.
    The new execd binary requires a Bearer token for /exec and /files, while
    the old binary runs in no-auth mode.
    """
    import asyncio

    # Pre-fetch the execd auth token before restarting. The old execd runs in
    # no-auth mode, so we can read the token file now. After the restart, the
    # new execd will require this token for all requests.
    try:
        token_result = await ctx.client.ahttp_exec(
            ctx.vmid,
            "cat /root/.worker-auth-token 2>/dev/null || true",
            timeout=10,
            check=False,
        )
        if token_result is not None and token_result.returncode == 0:
            token = token_result.stdout.strip()
            if token:
                ctx.client._execd_auth_tokens[ctx.vmid] = token
                ctx.console.info("[restart-execd-early] Pre-fetched execd auth token")
            else:
                ctx.console.info("[restart-execd-early] No auth token file found (no-auth mode)")
    except Exception as e:
        ctx.console.info(f"[restart-execd-early] Could not pre-fetch auth token: {e}")

    await ctx.run(
        "restart-execd-early",
        "nohup sh -c 'sleep 0.5 && systemctl restart cmux-execd.service' >/dev/null 2>&1 &",
    )
    # Wait for the background restart to complete
    await asyncio.sleep(2)


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
          --external 'node:*' \\
          --external path-to-regexp
        if [ ! -f ./apps/worker/build/index.js ]; then
          echo "Worker build output missing at ./apps/worker/build/index.js" >&2
          exit 1
        fi
        install -d ./apps/worker/build/node_modules
        # Install express-compatible path-to-regexp 0.1.x explicitly
        # bun hoisting can place dependencies differently, so we install directly
        cd ./apps/worker/build/node_modules
        # npm pack with retry logic for network resilience
        for i in 1 2 3; do
          if npm pack path-to-regexp@0.1.12 --silent; then
            break
          fi
          echo "npm pack attempt $i failed, retrying in $((i * 2))s..."
          sleep $((i * 2))
          if [ $i -eq 3 ]; then
            echo "npm pack failed after 3 attempts" >&2
            exit 1
          fi
        done
        rm -rf package path-to-regexp
        tarball="$(ls path-to-regexp-*.tgz | tail -n 1)"
        if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then
          echo "path-to-regexp tarball missing after npm pack" >&2
          exit 1
        fi
        tar -xzf "$tarball"
        mv package path-to-regexp
        rm -f "$tarball"
        if [ ! -f ./path-to-regexp/package.json ]; then
          echo "path-to-regexp package.json missing after extraction" >&2
          exit 1
        fi
        cd {repo}
        install -d /builtins
        cat <<'JSON' > /builtins/package.json
{{"name":"builtins","type":"module","version":"1.0.0"}}
JSON
        rm -rf /builtins/build
        cp -r ./apps/worker/build /builtins/build
        if [ ! -f /builtins/build/node_modules/path-to-regexp/package.json ]; then
          echo "path-to-regexp missing from /builtins/build after copy" >&2
          exit 1
        fi
        install -Dm0755 ./apps/worker/wait-for-docker.sh /usr/local/bin/wait-for-docker.sh
        """
    )
    await ctx.run("build-worker", cmd)


@registry.task(
    name="build-rust-binaries",
    deps=("upload-repo", "install-rust-toolchain", "restart-execd-early"),
    description="Build Rust binaries with a shared target dir",
)
@update_registry.task(
    name="build-rust-binaries",
    deps=("upload-repo", "restart-execd-early"),  # Rust toolchain already installed
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
        test -x {repo}/target/release/envd
        test -x {repo}/target/release/envctl
        test -x {repo}/target/release/cmux-proxy
        test -x {repo}/target/release/cmux-pty
        ls -lh \
          {repo}/target/release/envd \
          {repo}/target/release/envctl \
          {repo}/target/release/cmux-proxy \
          {repo}/target/release/cmux-pty
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
        "build-worker-daemon",
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
        "build-worker-daemon",
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

        # Stop stale services from the base template before replacing unit files.
        # Otherwise systemd can keep the old worker-daemon process attached to the
        # cmux-worker.service unit name even after the unit file is overwritten.
        systemctl stop cmux.target 2>/dev/null || true
        systemctl stop cmux-worker.service 2>/dev/null || true
        systemctl stop cmux-worker-daemon.service 2>/dev/null || true
        systemctl stop cmux-token-generator.service 2>/dev/null || true

        install -d /usr/local/lib/cmux
        install -d /etc/cmux
        install -Dm0644 {repo}/configs/systemd/cmux.target /usr/lib/systemd/system/cmux.target
        install -Dm0644 {repo}/configs/systemd/{ide_service} /usr/lib/systemd/system/cmux-ide.service
        # Remove old Go worker service from base template (conflicts with Node.js worker)
        # The Go worker now uses cmux-worker-daemon.service instead
        rm -f /etc/systemd/system/cmux-worker.service
        rm -f /etc/systemd/system/cmux.target.wants/cmux-worker.service
        rm -f /etc/systemd/system/multi-user.target.wants/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker.service /usr/lib/systemd/system/cmux-worker.service
        # Override Node.js worker port to 39376 for PVE-LXC (Go worker uses 39377)
        sed -i 's/WORKER_PORT=39377/WORKER_PORT=39376/' /usr/lib/systemd/system/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-proxy.service /usr/lib/systemd/system/cmux-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-dockerd.service /usr/lib/systemd/system/cmux-dockerd.service
        install -Dm0644 {repo}/configs/systemd/cmux-devtools.service /usr/lib/systemd/system/cmux-devtools.service
        install -Dm0644 {repo}/configs/systemd/cmux-xvfb.service /usr/lib/systemd/system/cmux-xvfb.service
        install -Dm0644 {repo}/configs/systemd/cmux-tigervnc.service /usr/lib/systemd/system/cmux-tigervnc.service
        install -Dm0644 {repo}/configs/systemd/cmux-openbox.service /usr/lib/systemd/system/cmux-openbox.service
        install -Dm0644 {repo}/configs/systemd/cmux-clipboard.service /usr/lib/systemd/system/cmux-clipboard.service
        install -Dm0644 {repo}/configs/systemd/cmux-vnc-proxy.service /usr/lib/systemd/system/cmux-vnc-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-cdp-proxy.service /usr/lib/systemd/system/cmux-cdp-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-pty.service /usr/lib/systemd/system/cmux-pty.service
        install -Dm0644 {repo}/configs/systemd/cmux-execd.service /usr/lib/systemd/system/cmux-execd.service
        install -Dm0644 {repo}/configs/systemd/cmux-token-generator.service /usr/lib/systemd/system/cmux-token-generator.service
        install -Dm0755 {repo}/configs/systemd/bin/cmux-token-init /usr/local/bin/cmux-token-init
        rm -f /etc/systemd/system/cmux-worker-daemon.service
        rm -f /etc/systemd/system/cmux.target.wants/cmux-worker-daemon.service
        rm -f /etc/systemd/system/multi-user.target.wants/cmux-worker-daemon.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker-daemon.service /usr/lib/systemd/system/cmux-worker-daemon.service
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
        ln -sf /usr/lib/systemd/system/cmux-clipboard.service /etc/systemd/system/cmux.target.wants/cmux-clipboard.service
        ln -sf /usr/lib/systemd/system/cmux-vnc-proxy.service /etc/systemd/system/cmux.target.wants/cmux-vnc-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-cdp-proxy.service /etc/systemd/system/cmux.target.wants/cmux-cdp-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-pty.service /etc/systemd/system/cmux.target.wants/cmux-pty.service
        ln -sf /usr/lib/systemd/system/cmux-execd.service /etc/systemd/system/cmux.target.wants/cmux-execd.service
        ln -sf /usr/lib/systemd/system/cmux-token-generator.service /etc/systemd/system/multi-user.target.wants/cmux-token-generator.service
        ln -sf /usr/lib/systemd/system/cmux-worker-daemon.service /etc/systemd/system/cmux.target.wants/cmux-worker-daemon.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/multi-user.target.wants/cmux-memory-setup.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/swap.target.wants/cmux-memory-setup.service
        {{ systemctl daemon-reload || true; }}
        {{ systemctl reset-failed cmux-worker.service cmux-worker-daemon.service cmux-token-generator.service || true; }}
        {{ systemctl enable cmux.target || true; }}
        {{ systemctl start cmux-token-generator.service 2>/dev/null || true; }}
        {{ systemctl start cmux-worker-daemon.service 2>/dev/null || true; }}
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
        "build-worker",
        "configure-envctl",
        "configure-openbox",
        "install-vnc-clipboard-bridge",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-devsh-skill",
        "install-systemd-units",
    ),
    description="Remove repository upload and toolchain caches prior to final validation",
)
@update_registry.task(
    name="cleanup-build-artifacts",
    deps=(
        "build-worker",
        "configure-envctl",
        "install-vnc-clipboard-bridge",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-devsh-skill",
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
        if [ ! -f /builtins/build/index.js ] && [ -f {repo}/apps/worker/build/index.js ]; then
            echo "[cleanup-build-artifacts] Restoring missing /builtins/build from repo build output"
            install -d /builtins
            rm -rf /builtins/build
            cp -r {repo}/apps/worker/build /builtins/build
        fi
        if [ ! -f /builtins/build/index.js ]; then
            echo "[cleanup-build-artifacts] ERROR: missing /builtins/build/index.js before repo cleanup" >&2
            exit 1
        fi
        if [ ! -f /builtins/build/node_modules/path-to-regexp/package.json ]; then
            cd /builtins/build/node_modules
            tarball="$(ls path-to-regexp-*.tgz 2>/dev/null | tail -n 1)"
            if [ -n "$tarball" ] && [ -f "$tarball" ]; then
                echo "[cleanup-build-artifacts] Recovering unpacked path-to-regexp runtime dependency from tarball"
                rm -rf package path-to-regexp
                tar -xzf "$tarball"
                mv package path-to-regexp
                rm -f "$tarball"
                cd /
            else
                cd /
                echo "[cleanup-build-artifacts] ERROR: missing unpacked path-to-regexp runtime dependency" >&2
                exit 1
            fi
        fi
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
        # Stop Chrome before cleaning profile locks to prevent it from recreating them
        # Chrome exits with code 21 if it sees stale lock files from snapshot
        systemctl stop cmux-devtools.service 2>/dev/null || true
        # Use killall instead of pkill -f to avoid matching the bash script itself
        # (pkill -f chrome would match this script since it contains "chrome" in cmd line)
        killall -9 google-chrome chrome chromium chromium-browser 2>/dev/null || true
        sleep 1
        # Clean Chrome profile locks to prevent crash-loop on fresh clones
        rm -f /root/.config/chrome/SingletonLock
        rm -f /root/.config/chrome/SingletonCookie
        rm -f /root/.config/chrome/SingletonSocket
        rm -f /root/.config/google-chrome/SingletonLock
        rm -f /root/.config/google-chrome/SingletonCookie
        rm -f /root/.config/google-chrome/SingletonSocket
        # Also clean any temp socket directories Chrome may have created
        rm -rf /tmp/.com.google.Chrome.*
        """
    ).strip()
    await ctx.run("cleanup-disk-artifacts", cleanup_script)


@registry.task(
    name="verify-novnc-installation",
    deps=("build-cdp-proxy", "install-vnc-clipboard-bridge"),
    description="Verify noVNC 1.7.0-beta is correctly installed with clipboard bridge",
)
@update_registry.task(
    name="verify-novnc-installation",
    deps=("build-cdp-proxy", "install-vnc-clipboard-bridge"),
    description="Verify noVNC 1.7.0-beta is correctly installed with clipboard bridge",
)
async def task_verify_novnc_installation(ctx: PveTaskContext) -> None:
    """
    Final verification that noVNC 1.7.0-beta is correctly installed.
    This task runs after all noVNC-related tasks to catch any issues.
    """
    shell_vars = _build_novnc_shell_vars()
    cmd = textwrap.dedent(
        f"""
        set -eu

        {shell_vars}

        if [ ! -f "$MARKER_FILE" ]; then
            if [ -f "$DURABLE_MARKER" ]; then
                install -Dm0644 "$DURABLE_MARKER" "$MARKER_FILE"
            else
                echo "[verify-novnc] ERROR: Version marker file not found: $MARKER_FILE" >&2
                echo "[verify-novnc] noVNC upgrade task may not have run" >&2
                ls -la "$NOVNC_DIR/" 2>/dev/null || true
                exit 1
            fi
        fi

        INSTALLED_VERSION="$(cat "$MARKER_FILE")"
        if [ "$INSTALLED_VERSION" != "$NOVNC_VERSION" ]; then
            echo "[verify-novnc] ERROR: Version mismatch" >&2
            echo "[verify-novnc]   Expected: $NOVNC_VERSION" >&2
            echo "[verify-novnc]   Found: $INSTALLED_VERSION" >&2
            exit 1
        fi

        if [ ! -f "$NOVNC_DIR/vnc.html" ]; then
            echo "[verify-novnc] ERROR: vnc.html not found" >&2
            exit 1
        fi

        if [ ! -f "$NOVNC_DIR/core/rfb.js" ]; then
            echo "[verify-novnc] ERROR: core/rfb.js not found" >&2
            exit 1
        fi

        if ! grep -q "vnc-clipboard-bridge" "$NOVNC_DIR/vnc.html" 2>/dev/null; then
            echo "[verify-novnc] ERROR: Clipboard bridge not found in vnc.html" >&2
            exit 1
        fi

        if dpkg-query -W -f='${{Status}}\n' "$NOVNC_PACKAGE_NAME" 2>/dev/null | grep -q '^install ok installed$'; then
            echo "[verify-novnc] ERROR: Distro package $NOVNC_PACKAGE_NAME is still installed" >&2
            exit 1
        fi

        echo "[verify-novnc] OK: noVNC $NOVNC_VERSION installed with clipboard bridge"
        """
    )
    try:
        await ctx.run("verify-novnc-installation", cmd)
        return
    except RuntimeError as exc:
        if is_http_exec_transport_failure(exc):
            concise_verify_cmd = textwrap.dedent(
                f"""
                set -euo pipefail
                {shell_vars}
                [ -f "$MARKER_FILE" ]
                [ "$(cat "$MARKER_FILE")" = "$NOVNC_VERSION" ]
                [ -f "$NOVNC_DIR/vnc.html" ]
                [ -f "$NOVNC_DIR/core/rfb.js" ]
                grep -q "vnc-clipboard-bridge" "$NOVNC_DIR/vnc.html"
                if dpkg-query -W -f='${{Status}}\\n' "$NOVNC_PACKAGE_NAME" 2>/dev/null | grep -q '^install ok installed$'; then
                    echo "[verify-novnc] ERROR: Distro package $NOVNC_PACKAGE_NAME is still installed" >&2
                    exit 1
                fi
                echo "[verify-novnc] verified"
                """
            )
            await ctx.run("verify-novnc-installation", concise_verify_cmd)
            return
        repairable_failures = (
            "Version marker file not found",
            "Version mismatch",
            "vnc.html not found",
            "core/rfb.js not found",
            "Clipboard bridge not found",
            "Distro package",
        )
        if not any(marker in str(exc) for marker in repairable_failures):
            raise

    ctx.console.info(
        "[verify-novnc] Repairing managed noVNC state before final retry..."
    )
    await task_upgrade_novnc(ctx)
    await task_install_vnc_clipboard_bridge(ctx)
    await ctx.run("verify-novnc-installation", cmd)


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
        for svc in cmux-ide cmux-worker cmux-worker-daemon cmux-token-generator cmux-proxy cmux-pty cmux-execd; do
          if [ -f "/usr/lib/systemd/system/${svc}.service" ]; then
            echo "  ${svc}.service: installed"
          else
            echo "  ${svc}.service: MISSING" >&2
          fi
        done
        """
    )
    await ctx.run("check-systemd-services", cmd)


@registry.task(
    name="check-worker",
    deps=("cleanup-build-artifacts",),
    description="Verify cmux-worker.service is healthy on the PVE-LXC worker port",
)
async def task_check_worker(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        for attempt in $(seq 1 30); do
          if systemctl is-active --quiet cmux-worker.service; then
            if health="$(curl -fsS http://127.0.0.1:39376/health)"; then
              printf '%s\n' "$health"
              exit 0
            fi
          fi
          sleep 2
        done
        echo "ERROR: cmux-worker service failed health check on port 39376" >&2
        systemctl status cmux-worker.service --no-pager || true
        tail -n 80 /var/log/cmux/worker.log || true
        exit 1
        """
    )
    await ctx.run("check-worker", cmd)


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
    timeout: int = 180,
    require_http_exec: bool = True,
) -> None:
    """Wait for container to be running and ready for commands.

    Uses HTTP exec (cmux-execd) when cf_domain is configured and require_http_exec=True,
    otherwise falls back to checking container status via PVE API only.

    Args:
        vmid: Container VMID to wait for
        client: PVE client instance
        console: Console for logging
        timeout: Max seconds to wait
        require_http_exec: If True and cf_domain is set, wait for cmux-execd to be ready.
            Should typically be True since base templates have cmux-execd installed.
    """
    console.info(f"Waiting for container {vmid} to be ready...")

    elapsed = 0
    container_running = False
    while elapsed < timeout:
        status = await client.aget_lxc_status(vmid)
        if status.get("status") == "running":
            if not container_running:
                container_running = True
                console.info(f"Container {vmid} is running, waiting for services...")

            # Try HTTP exec first if cf_domain is configured AND require_http_exec is True
            if client.cf_domain and require_http_exec:
                try:
                    result = await client.ahttp_exec(
                        vmid,
                        "echo ready",
                        timeout=10,
                        check=False,
                    )
                    if result is not None and result.returncode == 0 and "ready" in result.stdout:
                        console.info(f"Container {vmid} is ready (HTTP exec)")
                        return
                except Exception:
                    pass
                # HTTP exec not ready yet, keep waiting
                if elapsed > 0 and elapsed % 30 == 0:
                    console.info(f"Still waiting for cmux-execd on container {vmid}... ({elapsed}s)")
            else:
                # No cf_domain configured or require_http_exec=False
                # Just verify container is running via API
                console.info(f"Container {vmid} is running (API verified)")
                return
        await asyncio.sleep(2)
        elapsed += 2

    raise TimeoutError(f"Container {vmid} did not become ready within {timeout}s")


@dataclass
class ToolchainStatus:
    """Status of required toolchains in the container."""
    has_go: bool = False
    has_rust: bool = False
    has_bun: bool = False
    has_node: bool = False

    @property
    def all_present(self) -> bool:
        return self.has_go and self.has_rust and self.has_bun and self.has_node

    @property
    def missing(self) -> list[str]:
        missing = []
        if not self.has_go:
            missing.append("go")
        if not self.has_rust:
            missing.append("rust")
        if not self.has_bun:
            missing.append("bun")
        if not self.has_node:
            missing.append("node")
        return missing


async def detect_toolchains(
    vmid: int,
    client: PveLxcClient,
    console: Console,
) -> ToolchainStatus:
    """Detect which toolchains are installed in the container.

    Uses HTTP exec (cmux-execd) when available, falls back to SSH+pct exec.
    """
    status = ToolchainStatus()

    # Check Go
    try:
        result = await client.aexec_in_container(vmid, "which go", timeout=10, check=False)
        status.has_go = result.returncode == 0
    except Exception:
        pass

    # Check Rust
    try:
        result = await client.aexec_in_container(vmid, "which cargo", timeout=10, check=False)
        status.has_rust = result.returncode == 0
    except Exception:
        pass

    # Check Bun
    try:
        result = await client.aexec_in_container(vmid, "which bun", timeout=10, check=False)
        status.has_bun = result.returncode == 0
    except Exception:
        pass

    # Check Node
    try:
        result = await client.aexec_in_container(vmid, "which node", timeout=10, check=False)
        status.has_node = result.returncode == 0
    except Exception:
        pass

    return status


def create_dynamic_update_registry(toolchain_status: ToolchainStatus) -> TaskRegistry:
    """Create a dynamic task registry for update mode based on detected toolchains.

    If toolchains are missing, we add the installation tasks to the registry.
    This allows update mode to work on older templates that don't have all toolchains.
    """
    dynamic_registry = TaskRegistry()

    # Always include these base tasks from update_registry
    # We'll copy tasks from update_registry and optionally add toolchain installation

    # If Go is missing, we need to add install-go-toolchain task
    # If Rust is missing, we need to add install-rust-toolchain task
    # etc.

    # For now, if any toolchain is missing, use the full registry instead
    # This is simpler and ensures all dependencies are met
    if not toolchain_status.all_present:
        return registry  # Use full registry for templates missing toolchains

    return update_registry  # Use optimized update registry


async def update_existing_template(
    args: argparse.Namespace,
    *,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
) -> dict[str, t.Any]:
    """Update an existing template container by cloning, updating, and converting to new template.

    This skips heavy dependency installation (apt, rust, go, node, etc.) and only
    runs tasks that rebuild binaries and update configs from the repo.

    Flow:
    1. Check if source VMID is a template (via config template=1)
    2. If template, linked clone to new auto-allocated VMID (full clone as fallback)
    3. Start the clone and run update tasks
    4. Stop and convert to new template
    5. Return new template VMID

    Returns a result payload suitable for --results-json output.
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
        # Clone from template to new VMID (starting from CLONE_BASE_VMID)
        new_vmid = await client.afind_next_vmid(node, start=CLONE_BASE_VMID)
        hostname = _generate_instance_id()

        # Try linked clone first (faster), fall back to full clone if it fails
        try:
            console.always(f"Source {source_vmid} is a template, linked-cloning to new container {new_vmid}...")
            upid = await client.aclone_lxc(
                source_vmid,
                new_vmid,
                hostname=hostname,
                full=False,  # Linked clone (fast)
                node=node,
            )
            await client.await_task(upid, timeout=300, node=node)
            console.info(f"Linked clone complete: {source_vmid} -> {new_vmid}")
        except Exception as e:
            console.always(f"Linked clone failed ({e}), falling back to full clone...")
            upid = await client.aclone_lxc(
                source_vmid,
                new_vmid,
                hostname=hostname,
                full=True,  # Full clone (fallback)
                node=node,
            )
            await client.await_task(upid, timeout=600, node=node)
            console.info(f"Full clone complete: {source_vmid} -> {new_vmid}")

        work_vmid = new_vmid
    else:
        # Source is a regular container, work on it directly
        work_vmid = source_vmid
        hostname = config.get("hostname")
        console.info(f"Container {source_vmid} is not a template, updating directly")

    # Start the container
    status = await client.aget_lxc_status(work_vmid, node)
    if status.get("status") != "running":
        console.info(f"Starting container {work_vmid}...")
        upid = await client.astart_lxc(work_vmid, node)
        await client.await_task(upid, timeout=120, node=node)
        # Base templates created with pve-lxc-setup.sh have cmux-execd installed,
        # so we wait for HTTP exec to be ready before running provisioning tasks
        await wait_for_container_ready(work_vmid, client, console=console, require_http_exec=True)
    else:
        console.info(f"Container {work_vmid} is already running")
        # For an already-running container, the execd may already require auth.
        # Pre-fetch the auth token via the PVE API so the first exec call works.
        # If the PVE API file endpoint is unavailable for LXC, this is a no-op
        # and the token will be fetched on the first 401 retry or by
        # restart-execd-early.
        await client.afetch_execd_auth_token(work_vmid)

    # Detect which toolchains are installed
    console.always("\nDetecting installed toolchains...")
    toolchain_status = await detect_toolchains(work_vmid, client, console)

    if toolchain_status.all_present:
        console.always("All toolchains present - using optimized update registry")
        active_registry = update_registry
        registry_name = "Update Mode"
    else:
        missing = ", ".join(toolchain_status.missing)
        console.always(f"Missing toolchains: {missing} - using full registry to install them")
        active_registry = registry
        registry_name = "Full Build"

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

    # Run task graph (uses detected registry)
    console.always(f"\nRunning {registry_name} tasks...")
    await run_pve_task_graph(active_registry, ctx)

    graph = format_dependency_graph(active_registry)
    if graph:
        console.always(f"\n{registry_name} Dependency Graph")
        for line in graph.splitlines():
            console.always(line)

    summary = timings.summary()
    if summary:
        console.always("\nTiming Summary")
        for line in summary:
            console.always(line)

    # Capture diagnostics before template conversion for diffing with runtime sandboxes.
    diag_path = await _capture_networkd_diagnostics(
        vmid=work_vmid,
        client=client,
        console=console,
        repo_root=repo_root,
        stage="update-pre-template",
        preset_id="update",
    )

    # Verify critical artifacts exist before converting to template
    console.info("Verifying critical build artifacts...")
    await _verify_template_artifacts(work_vmid, client, console)

    # Hard fail if required systemd-networkd DHCP behavior regresses.
    console.info("Verifying systemd-networkd DHCP configuration...")
    await _verify_networkd_dhcp_config(
        vmid=work_vmid,
        client=client,
        console=console,
        repo_root=repo_root,
        diag_path=diag_path,
    )

    # Gracefully shutdown container before converting to template
    console.info(f"Shutting down container {work_vmid} for template conversion...")
    upid = await client.ashutdown_lxc(work_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Convert to template
    console.info(f"Converting container {work_vmid} to template...")
    await client.aconvert_to_template(work_vmid, node)

    console.always(f"\n=== Update complete: new template VMID {work_vmid} ===")

    # Update manifest with new template version
    manifest = _load_manifest()
    captured_at = _iso_timestamp()
    snapshot_id = _generate_snapshot_id()

    # Find the preset for the source VMID
    preset_entry = _find_preset_for_vmid(manifest, source_vmid)
    preset_id = preset_entry.get("presetId") if preset_entry else None
    description = _build_template_description(
        snapshot_id=snapshot_id,
        preset_id=preset_id,
        captured_at=captured_at,
        source_vmid=source_vmid,
        hostname=hostname if isinstance(hostname, str) else None,
    )
    tags = _build_template_tags(preset_id)
    await client.aset_lxc_config(
        work_vmid,
        node=node,
        description=description,
        tags=tags,
    )

    if preset_entry:
        _add_version_to_preset(preset_entry, work_vmid, snapshot_id, captured_at)
        manifest["updatedAt"] = captured_at
        manifest["node"] = node
        _write_manifest(manifest)
        console.always(f"\nManifest updated: {PVE_SNAPSHOT_MANIFEST_PATH}")
        console.always(f"  Preset: {preset_entry.get('presetId')} ({preset_entry.get('label')})")
        console.always(f"  New version added with template VMID {work_vmid}")
        console.always(f"  Snapshot ID: {snapshot_id}")
    else:
        console.always(f"\nWARNING: Source VMID {source_vmid} not found in manifest")
        console.always(f"  Manifest not updated. Manually add template {work_vmid} to the manifest if needed.")

    if is_template:
        console.always(f"\nOld template: {source_vmid}")
        console.always(f"New template: {work_vmid}")
        console.always("\nTo use the new template, clone from it:")
        console.always(f"  pct clone {work_vmid} <new-vmid>")
    else:
        console.always(f"\nContainer {work_vmid} converted to template")

    return {
        "presetId": preset_id or "unknown",
        "label": preset_entry.get("label") if preset_entry else "unknown",
        "snapshotId": snapshot_id,
        "templateVmid": work_vmid,
        "capturedAt": captured_at,
        "node": node,
        "sourceVmid": source_vmid,
        **_build_novnc_metadata(),
    }


async def _verify_template_artifacts(
    vmid: int,
    client: PveLxcClient,
    console: Console,
) -> None:
    """Verify critical build artifacts exist in the container before converting to template.

    Raises RuntimeError if critical artifacts are missing to prevent creating broken templates.
    """
    ide_provider = get_ide_provider()
    _, bin_path, _, user_data_dir = get_ide_paths(ide_provider)

    # Define critical artifacts that must exist based on IDE provider
    artifacts: list[tuple[str, str]] = []

    if ide_provider == IDE_PROVIDER_CODER:
        artifacts = [
            ("/app/code-server/bin/code-server", "code-server binary"),
            ("/root/.code-server/extensions", "code-server extensions directory"),
        ]
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        artifacts = [
            ("/app/cmux-code/bin/code-server-oss", "cmux-code binary"),
            ("/root/.vscode-server-oss/extensions", "VS Code extensions directory"),
        ]
    else:  # openvscode
        artifacts = [
            ("/app/openvscode-server/bin/openvscode-server", "openvscode-server binary"),
            ("/root/.openvscode-server/extensions", "VS Code extensions directory"),
        ]

    # Also check for common critical artifacts regardless of IDE provider
    artifacts.extend([
        ("/root/.nvm/nvm.sh", "Node Version Manager"),
        ("/usr/local/cargo/bin/cargo", "Rust/Cargo"),
        ("/usr/local/go/bin/go", "Go toolchain"),
        ("/root/.bun/bin/bun", "Bun runtime"),
        ("/builtins/build/index.js", "cmux-worker service"),
        ("/builtins/build/node_modules/path-to-regexp/package.json", "worker path-to-regexp runtime dependency"),
        ("/usr/local/bin/worker-daemon", "Go worker-daemon (SSH/PTY proxy)"),
        ("/usr/local/bin/cmux-token-init", "Auth token generator script"),
        ("/usr/local/bin/cmux-execd", "cmux-execd HTTP exec daemon binary"),
        (NOVNC_MARKER_FILE, "managed noVNC version marker"),
        (f"{NOVNC_DIR}/vnc.html", "managed noVNC vnc.html"),
        (f"{NOVNC_DIR}/core/rfb.js", "managed noVNC core/rfb.js"),
    ])

    # Verify artifacts exist
    missing: list[str] = []

    novnc_pkg_cmd = (
        f"dpkg-query -W -f='${{Status}}\\n' {shlex.quote(NOVNC_PACKAGE_NAME)} 2>/dev/null "
        "| grep -q '^install ok installed$' && echo installed || echo absent"
    )
    try:
        result = await client.aexec_in_container(vmid, novnc_pkg_cmd, timeout=30, check=False)
        if result.returncode != 0 or "installed" in result.stdout:
            missing.append(
                f"  - distro noVNC package should be absent: {NOVNC_PACKAGE_NAME}"
            )
            console.info(f"[verify] MISSING: distro noVNC package removal for {NOVNC_PACKAGE_NAME}")
        else:
            console.info(f"[verify] OK: distro noVNC package removed ({NOVNC_PACKAGE_NAME})")
    except Exception as e:
        missing.append(f"  - distro noVNC package removal check failed: {e}")
        console.info(f"[verify] ERROR checking distro noVNC package removal: {e}")

    for path, description in artifacts:
        check_cmd = f"test -e {shlex.quote(path)} && echo exists || echo missing"
        try:
            result = await client.aexec_in_container(vmid, check_cmd, timeout=30, check=False)
            if result.returncode != 0 or "missing" in result.stdout:
                missing.append(f"  - {description}: {path}")
                console.info(f"[verify] MISSING: {description} at {path}")
            else:
                console.info(f"[verify] OK: {description}")
        except Exception as e:
            missing.append(f"  - {description}: {path} (check failed: {e})")
            console.info(f"[verify] ERROR checking {description}: {e}")

    # Verify cmux-execd systemd unit files and state so the template does not
    # ship with a disabled or dead exec daemon. Unit files may live under
    # /etc/systemd/system or /usr/lib/systemd/system (wants-symlink enablement).
    # Both call sites run this before template conversion while the container
    # is still running, so is-active is valid.
    systemd_state_checks: list[tuple[str, str]] = [
        ("test -e /etc/systemd/system/cmux-execd.service -o -e /usr/lib/systemd/system/cmux-execd.service && echo present || echo not-present", "cmux-execd systemd unit file"),
        ("test -e /etc/systemd/system/cmux-token-generator.service -o -e /usr/lib/systemd/system/cmux-token-generator.service && echo present || echo not-present", "cmux-token-generator systemd unit file"),
        ("systemctl is-enabled cmux-execd.service 2>/dev/null && echo enabled || echo not-enabled", "cmux-execd systemd unit enabled"),
        ("systemctl is-active cmux-execd.service 2>/dev/null && echo active || echo not-active", "cmux-execd HTTP exec daemon active"),
    ]
    for cmd, description in systemd_state_checks:
        try:
            result = await client.aexec_in_container(vmid, cmd, timeout=30, check=False)
            if result.returncode != 0 or "not-" in result.stdout:
                missing.append(f"  - {description}")
                console.info(f"[verify] MISSING: {description}")
            else:
                console.info(f"[verify] OK: {description}")
        except Exception as e:
            missing.append(f"  - {description} (check failed: {e})")
            console.info(f"[verify] ERROR checking {description}: {e}")

    # Check for cmux extension specifically (critical for IDE functionality)
    _, _, ext_dir, _ = get_ide_paths(ide_provider)
    ext_check_cmd = f"ls {shlex.quote(ext_dir)} 2>/dev/null | grep -q cmux && echo found || echo notfound"
    try:
        result = await client.aexec_in_container(vmid, ext_check_cmd, timeout=30, check=False)
        if "notfound" in result.stdout or result.returncode != 0:
            missing.append(f"  - cmux VS Code extension: not found in {ext_dir}")
            console.info(f"[verify] MISSING: cmux VS Code extension in {ext_dir}")
        else:
            console.info("[verify] OK: cmux VS Code extension")
    except Exception as e:
        missing.append(f"  - cmux VS Code extension: check failed ({e})")
        console.info(f"[verify] ERROR checking cmux extension: {e}")

    expected_specs = get_expected_extension_specs(load_ide_deps())
    installed: set[str] = set()

    registry_cmd = f"cat {shlex.quote(ext_dir)}/extensions.json"
    try:
        registry_result = await client.aexec_in_container(
            vmid,
            registry_cmd,
            timeout=60,
            check=False,
        )
        if registry_result.returncode == 0:
            installed.update(parse_extension_registry_specs(registry_result.stdout))
            console.info(
                f"[verify] Parsed {len(installed)} extensions from {ext_dir}/extensions.json"
            )
        else:
            console.info(
                f"[verify] WARN: failed to read {ext_dir}/extensions.json: {registry_result.stderr.strip()}"
            )
    except Exception as e:
        console.info(f"[verify] WARN: failed to parse extension registry: {e}")

    if not installed:
        list_cmd = (
            f"{shlex.quote(bin_path)} --list-extensions --show-versions "
            f"--extensions-dir {shlex.quote(ext_dir)} "
            f"--user-data-dir {shlex.quote(user_data_dir)}"
        )
        try:
            result = await client.aexec_in_container(
                vmid,
                list_cmd,
                timeout=60,
                check=False,
            )
            if result.returncode != 0:
                missing.append(
                    f"  - IDE marketplace extensions: failed to list installed extensions via {bin_path}"
                )
                console.info(
                    f"[verify] ERROR listing installed extensions via {bin_path}: {result.stderr.strip()}"
                )
            else:
                installed.update(
                    parse_cli_extension_specs(
                        result.stdout,
                        expected_specs=expected_specs,
                    )
                )
                console.info(
                    f"[verify] Parsed {len(installed)} extensions from CLI output"
                )
        except Exception as e:
            missing.append(f"  - IDE marketplace extensions: check failed ({e})")
            console.info(f"[verify] ERROR checking IDE marketplace extensions: {e}")

    for spec in expected_specs:
        if spec not in installed:
            missing.append(
                f"  - IDE marketplace extension missing: {spec} in {ext_dir}"
            )
            console.info(f"[verify] MISSING: IDE marketplace extension {spec}")
        else:
            console.info(f"[verify] OK: IDE marketplace extension {spec}")

    if missing:
        error_msg = (
            "Template verification failed - critical artifacts are missing:\n"
            + "\n".join(missing)
            + "\n\nThis indicates the build tasks did not complete successfully. "
            "Refusing to create a broken template."
        )
        raise RuntimeError(error_msg)

    console.info("[verify] All critical artifacts verified successfully")


def _wrap_bash(command: str) -> str:
    """Wrap a multi-line command to run via /bin/bash -c with safe quoting."""
    escaped = command.replace("'", "'\"'\"'")
    return f"/bin/bash -c '{escaped}'"


def _read_repo_script(repo_root: Path, relative_path: str) -> str:
    path = (repo_root / relative_path).resolve()
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing script: {relative_path} (resolved: {path})") from exc


def _networkd_artifact_dir(repo_root: Path) -> Path:
    return (repo_root / "logs" / "pve-lxc-networkd").resolve()


async def _capture_networkd_diagnostics(
    *,
    vmid: int,
    client: PveLxcClient,
    console: Console,
    repo_root: Path,
    stage: str,
    preset_id: str | None = None,
) -> Path:
    """Capture networkd diagnostics from inside a container and save under logs/."""
    artifact_dir = _networkd_artifact_dir(repo_root)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    preset_label = preset_id or "unknown"
    out_path = artifact_dir / f"diag.{stage}.{preset_label}.vmid-{vmid}.{timestamp}.txt"

    diag_script = _read_repo_script(repo_root, "scripts/pve/pve-lxc-networkd-diag-inner.sh")
    content_parts: list[str] = []
    try:
        result = await client.aexec_in_container(
            vmid,
            _wrap_bash(diag_script),
            timeout=60,
            check=False,
        )
        if result.stdout:
            content_parts.append(result.stdout.rstrip("\n"))
        if result.stderr:
            content_parts.append("=== STDERR ===")
            content_parts.append(result.stderr.rstrip("\n"))
    except Exception as exc:
        content_parts.append("=== ERROR ===")
        content_parts.append(str(exc))

    out_path.write_text("\n".join(content_parts) + "\n", encoding="utf-8")
    console.info(f"[diag] Saved networkd diagnostics: {out_path}")
    return out_path


async def _verify_networkd_dhcp_config(
    *,
    vmid: int,
    client: PveLxcClient,
    console: Console,
    repo_root: Path,
    diag_path: Path | None = None,
) -> None:
    """Fail the build unless effective networkd config includes required DHCP keys."""
    verify_script = _read_repo_script(repo_root, "scripts/pve/pve-lxc-networkd-verify-inner.sh")
    result = await client.aexec_in_container(
        vmid,
        _wrap_bash(verify_script),
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        hint = f"\nDiagnostics: {diag_path}" if diag_path else ""
        error_msg = (
            "Networkd DHCP verification failed.\n"
            "Expected effective config to contain:\n"
            "  - SendHostname=yes\n"
            "  - UseDNS=no\n\n"
            f"Exit code: {result.returncode}\n"
        )
        if result.stdout.strip():
            error_msg += f"\nstdout:\n{result.stdout.rstrip()}\n"
        if result.stderr.strip():
            error_msg += f"\nstderr:\n{result.stderr.rstrip()}\n"
        error_msg += hint
        raise RuntimeError(error_msg)

    if result.stdout.strip():
        console.info(f"[verify-networkd] {result.stdout.strip()}")


async def provision_and_create_template(
    args: argparse.Namespace,
    *,
    preset: TemplatePresetPlan,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
    created_containers: list[int],
    show_dependency_graph: bool,
    source_vmid: int | None = None,
    run_tasks: bool = True,
) -> TemplateRunResult:
    """Provision a container for a preset and convert to template."""
    console.always(f"\n=== Provisioning preset {preset.preset_id} ({preset.label}) ===")
    timings = TimingsCollector()

    # Determine source VMID: use override if provided, else fall back to args
    src_vmid = source_vmid if source_vmid is not None else args.template_vmid

    node = await client.aget_node()
    # Find next available VMID starting from CLONE_BASE_VMID (9000, 9001, etc.)
    new_vmid = await client.afind_next_vmid(node, start=CLONE_BASE_VMID)
    hostname = _generate_instance_id()

    # Try linked clone first (faster), fall back to full clone if it fails
    try:
        console.info(f"Linked-cloning template {src_vmid} to new container {new_vmid}...")
        upid = await client.aclone_lxc(
            src_vmid,
            new_vmid,
            hostname=hostname,
            full=False,  # Linked clone (fast)
            node=node,
        )
        await client.await_task(upid, timeout=300, node=node)
        console.info(f"Linked clone complete: {src_vmid} -> {new_vmid}")
    except Exception as e:
        console.always(f"Linked clone failed ({e}), falling back to full clone...")
        upid = await client.aclone_lxc(
            src_vmid,
            new_vmid,
            hostname=hostname,
            full=True,  # Full clone (fallback)
            node=node,
        )
        await client.await_task(upid, timeout=600, node=node)
        console.info(f"Full clone complete: {src_vmid} -> {new_vmid}")

    created_containers.append(new_vmid)

    # Configure resources
    console.info(f"Configuring container {new_vmid} with {preset.vcpus} cores, {preset.memory_mib}MB RAM...")
    await client.aset_lxc_config(
        new_vmid,
        cores=preset.vcpus,
        memory=preset.memory_mib,
        node=node,
    )

    # Resize disk if needed
    # Get current disk size first to compare (optimization)
    config = await client.aget_lxc_config(new_vmid, node)
    rootfs = config.get("rootfs", "")
    current_size_gb = 0
    if "size=" in rootfs:
        try:
            # format: volume=local-lvm:vm-9000-disk-0,size=8G
            size_part = [p for p in rootfs.split(",") if p.startswith("size=")][0]
            size_str = size_part.split("=")[1]
            if size_str.endswith("G"):
                current_size_gb = float(size_str[:-1])
            elif size_str.endswith("M"):
                current_size_gb = float(size_str[:-1]) / 1024
        except Exception:
            pass

    target_size_gb = preset.disk_size_mib / 1024
    if target_size_gb > current_size_gb:
        console.info(f"Resizing disk for container {new_vmid} to {target_size_gb}GB (current: {current_size_gb}GB)...")
        # Ensure container is stopped/unmounted if needed (PVE handles this for live resize usually,
        # but for initial setup safety we do it before start)
        # Note: resize requires volume to be available. PVE handles online resize too.
        # Since we just cloned it and haven't started it yet, it's safe.
        await client.aresize_lxc_disk(
            new_vmid,
            "rootfs",
            f"{int(target_size_gb)}G",
            node=node,
        )
    else:
        console.info(f"Disk size {current_size_gb}GB is sufficient for target {target_size_gb}GB")

    if run_tasks:
        # Start container
        console.info(f"Starting container {new_vmid}...")
        upid = await client.astart_lxc(new_vmid, node)
        await client.await_task(upid, timeout=120, node=node)

        # Wait for container to be ready
        # Base templates created with pve-lxc-setup.sh have cmux-execd installed,
        # so we wait for HTTP exec to be ready before running provisioning tasks
        await wait_for_container_ready(new_vmid, client, console=console, require_http_exec=True)

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

        # Capture diagnostics before template conversion for diffing with runtime sandboxes.
        diag_path = await _capture_networkd_diagnostics(
            vmid=new_vmid,
            client=client,
            console=console,
            repo_root=repo_root,
            stage="build-pre-template",
            preset_id=preset.preset_id,
        )

        # Verify critical artifacts exist before converting to template
        console.info("Verifying critical build artifacts...")
        await _verify_template_artifacts(new_vmid, client, console)

        # Hard fail if required systemd-networkd DHCP behavior regresses.
        console.info("Verifying systemd-networkd DHCP configuration...")
        await _verify_networkd_dhcp_config(
            vmid=new_vmid,
            client=client,
            console=console,
            repo_root=repo_root,
            diag_path=diag_path,
        )

        # Gracefully shutdown container before converting to template
        console.info(f"Shutting down container {new_vmid} for template conversion...")
        upid = await client.ashutdown_lxc(new_vmid, node)
        await client.await_task(upid, timeout=120, node=node)

    # Convert to template (this enables fast linked-clone)
    console.info(f"Converting container {new_vmid} to template...")
    await client.aconvert_to_template(new_vmid, node)

    captured_at = _iso_timestamp()
    snapshot_id = _generate_snapshot_id()
    tags = _build_template_tags(preset.preset_id)
    description = _build_template_description(
        snapshot_id=snapshot_id,
        preset_id=preset.preset_id,
        captured_at=captured_at,
        source_vmid=src_vmid,
        hostname=hostname,
    )
    await client.aset_lxc_config(
        new_vmid,
        node=node,
        description=description,
        tags=tags,
    )

    console.always(f"[{preset.preset_id}] Container {new_vmid} converted to template")

    return TemplateRunResult(
        preset=preset,
        snapshot_id=snapshot_id,
        template_vmid=new_vmid,
        captured_at=captured_at,
        node=node,
    )


def _write_failure_artifacts(
    *,
    repo_root: Path,
    error: Exception,
    created_containers: list[int],
) -> tuple[Path, Path]:
    """Persist failure diagnostics so GitHub Actions can upload them reliably."""
    snapshot_dir = (repo_root / "logs" / "pve-lxc-snapshot").resolve()
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    error_path = snapshot_dir / "failure.txt"
    traceback_path = snapshot_dir / "failure-traceback.txt"

    error_lines = [
        f"error_type: {type(error).__name__}",
        f"error_message: {error}",
    ]
    if created_containers:
        error_lines.append(
            "created_containers: " + ", ".join(str(vmid) for vmid in created_containers)
        )
    else:
        error_lines.append("created_containers: none")
    error_path.write_text("\n".join(error_lines) + "\n", encoding="utf-8")

    traceback_path.write_text(traceback.format_exc(), encoding="utf-8")
    return error_path, traceback_path


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

    cf_domain = os.environ.get("PVE_PUBLIC_DOMAIN")

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
        ssh_host=os.environ.get("PVE_SSH_HOST"),
        cf_domain=cf_domain,
    )

    if cf_domain:
        console.info(
            "Using HTTP exec via Cloudflare Tunnel: port-{port}-{instanceId}.{cf_domain}"
        )
        if client._ssh_host_explicit:
            console.info(f"SSH fallback enabled: {client.ssh_host}")
        elif client._ssh_host_derived:
            console.info(f"SSH fallback derived from PVE_API_URL: {client.ssh_host}")
        else:
            console.info("SSH fallback disabled (set PVE_SSH_HOST to enable)")
    else:
        if client.ssh_host:
            console.info(f"Using SSH host: {client.ssh_host}")
        else:
            console.always("ERROR: No exec method configured. Set PVE_PUBLIC_DOMAIN or PVE_SSH_HOST")
            sys.exit(1)

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
        # Support both --ide-deps-channel flag and IDE_DEPS_CHANNEL env var
        ide_channel = os.environ.get("IDE_DEPS_CHANNEL") or getattr(args, "ide_deps_channel", "stable")
        console.always(
            f"Bumping IDE deps (channel: {ide_channel}) (bun run bump-ide-deps)..."
        )
        bump_result = subprocess.run(
            [bun_path, "run", "bump-ide-deps", "--channel", ide_channel],
            cwd=str(Path(args.repo_root).resolve()),
            text=True,
        )
        if bump_result.returncode != 0:
            raise RuntimeError(
                f"bun run bump-ide-deps failed with exit code {bump_result.returncode}"
            )
    repo_root = Path(args.repo_root).resolve()
    maybe_apply_ide_package_overrides(repo_root, console)

    manifest = _load_manifest()
    manifest["baseTemplateVmid"] = args.template_vmid
    preset_plans = _build_preset_plans(args)
    created_containers: list[int] = []
    results: list[TemplateRunResult] = []

    console.always(
        f"Starting template creation for presets "
        f"{', '.join(plan.preset_id for plan in preset_plans)} "
        f"from base template {args.template_vmid} "
        f"(IDE provider: {args.ide_provider})"
    )

    last_template_vmid: int | None = None
    last_template_disk_mib: int = 0

    try:
        for index, preset_plan in enumerate(preset_plans):
            # Default to using base template and running tasks
            source_vmid = args.template_vmid
            run_tasks = True

            # Optimization: Use previous template if available and disk requirement is met.
            # This allows creating "boosted" templates by cloning "standard" and just resizing resources,
            # avoiding a full rebuild of dependencies.
            # We only chain if the new disk size is >= previous disk size (can't shrink easily).
            if last_template_vmid and preset_plan.disk_size_mib >= last_template_disk_mib:
                source_vmid = last_template_vmid
                run_tasks = False
                console.info(
                    f"Optimization: Building {preset_plan.label} from previous template {last_template_vmid} "
                    f"(skips task execution)"
                )

            result = await provision_and_create_template(
                args,
                preset=preset_plan,
                source_vmid=source_vmid,
                run_tasks=run_tasks,
                console=console,
                client=client,
                repo_root=repo_root,
                created_containers=created_containers,
                show_dependency_graph=(index == 0 and run_tasks),
            )
            results.append(result)

            # Update last template for chaining
            last_template_vmid = result.template_vmid
            last_template_disk_mib = preset_plan.disk_size_mib

    except Exception as e:
        console.always(f"\nERROR: Provisioning failed: {e}")
        traceback.print_exc()
        error_path, traceback_path = _write_failure_artifacts(
            repo_root=repo_root,
            error=e,
            created_containers=created_containers,
        )
        console.always(f"Failure details: {error_path}")
        console.always(f"Failure traceback: {traceback_path}")

        # Cleanup on failure
        if args.cleanup_on_failure:
            console.always("\nCleaning up created containers...")
            for vmid in created_containers:
                try:
                    # Gracefully shutdown before deletion
                    client.shutdown_lxc(vmid)
                    # Give it a moment to shutdown
                    import time
                    time.sleep(2)
                    client.delete_lxc(vmid)
                    console.always(f"  Deleted container {vmid}")
                except Exception:
                    pass
        raise

    # Update manifest
    for result in results:
        manifest = _update_manifest_with_template(
            manifest,
            result.preset,
            result.template_vmid,
            result.snapshot_id,
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
        console.always(f"  Snapshot ID: {result.snapshot_id}")
        console.always(f"  Template VMID: {result.template_vmid}")
        console.always(f"  Node: {result.node}")
        console.always(f"  Captured: {result.captured_at}")
        console.always("")

    console.always("To use these templates:")
    console.always("  1. Linked-clone: pct clone <template-vmid> <new-vmid>")
    console.always("  2. Start clone: pct start <new-vmid>")
    console.always("  3. Enter clone: pct enter <new-vmid>")

    results_json = getattr(args, "results_json", None)
    if results_json:
        out_path = _resolve_repo_relative_path(repo_root, results_json)
        _write_results_json(
            out_path=out_path,
            mode="snapshot",
            base_template_vmid=args.template_vmid,
            ide_provider=args.ide_provider,
            results_payload=[_serialize_template_result(r) for r in results],
            execd_tokens=client._execd_auth_tokens,
        )
        console.always(f"Results JSON written: {out_path}")


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
        default=str(Path(__file__).resolve().parent.parent),
        help="Repository root (default: script repo root)",
    )
    parser.add_argument(
        "--results-json",
        dest="results_json",
        default="",
        help="Write snapshot results to a JSON file (path is relative to --repo-root unless absolute)",
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
        default=8192,
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
        default=40960,
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
        "--ide-deps-channel",
        choices=("stable", "latest", "beta"),
        default="stable",
        help="Dist-tag channel for IDE dependency bumping (default: stable, falls back to latest if missing)",
    )
    parser.add_argument(
        "--bump-ide-deps",
        dest="bump_ide_deps",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Update configs/ide-deps.json before snapshotting (uses --ide-deps-channel)",
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
    parser.add_argument(
        "--use-git-diff",
        dest="use_git_diff",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Clone from GitHub + apply local changes (default: enabled, use --no-use-git-diff for full archive upload)",
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

    # Set up git diff mode if enabled
    # Git diff mode: clone from GitHub + apply local uncommitted changes
    if getattr(args, "use_git_diff", False):
        print("[git-diff] Enabled (clone from GitHub + apply local changes)")
        set_git_diff_mode(True)
    else:
        print("[git-diff] Disabled (full archive upload)")
        set_git_diff_mode(False)

    # Pre-flight check: validate MCP server script syntax before building snapshot
    repo_root = Path(args.repo_root).resolve()
    print("[pre-flight] Validating MCP server script syntax...")
    import subprocess
    try:
        result = subprocess.run(
            [
                "bun",
                "test",
                "./src/agent-memory-protocol.test.ts",
            ],
            cwd=str(repo_root / "packages" / "shared"),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            print("[pre-flight] ERROR: MCP server script validation failed!")
            print(result.stdout)
            print(result.stderr)
            sys.exit(1)
        print("[pre-flight] MCP server script validation passed")
    except subprocess.TimeoutExpired:
        print("[pre-flight] WARNING: MCP server script validation timed out, continuing...")
    except FileNotFoundError:
        print("[pre-flight] WARNING: bun not found, skipping MCP server script validation")

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

    cf_domain = os.environ.get("PVE_PUBLIC_DOMAIN")

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
        ssh_host=os.environ.get("PVE_SSH_HOST"),
        cf_domain=cf_domain,
    )

    if cf_domain:
        console.info(
            "Using HTTP exec via Cloudflare Tunnel: port-{port}-{instanceId}.{cf_domain}"
        )
        if client._ssh_host_explicit:
            console.info(f"SSH fallback enabled: {client.ssh_host}")
        elif client._ssh_host_derived:
            console.info(f"SSH fallback derived from PVE_API_URL: {client.ssh_host}")
        else:
            console.info("SSH fallback disabled (set PVE_SSH_HOST to enable)")
    else:
        if client.ssh_host:
            console.info(f"Using SSH host: {client.ssh_host}")
        else:
            console.always("ERROR: No exec method configured. Set PVE_PUBLIC_DOMAIN or PVE_SSH_HOST")
            sys.exit(1)

    # Test connection
    try:
        version = client.get_version()
        console.always(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        console.always(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    repo_root = Path(args.repo_root).resolve()

    try:
        result = await update_existing_template(
            args,
            console=console,
            client=client,
            repo_root=repo_root,
        )
        results_json = getattr(args, "results_json", None)
        if results_json:
            out_path = _resolve_repo_relative_path(repo_root, results_json)
            _write_results_json(
                out_path=out_path,
                mode="update",
                base_template_vmid=args.update_vmid,
                ide_provider=args.ide_provider,
                results_payload=[result],
                execd_tokens=client._execd_auth_tokens,
            )
            console.always(f"Results JSON written: {out_path}")
    finally:
        if client._ssh_control_path:
            client.stop_ssh_control_master()


if __name__ == "__main__":
    main()
