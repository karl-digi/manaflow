#!/usr/bin/env python3
"""
Clone and resize/reconfigure a PVE LXC container or template.

This script safely modifies LXC containers by:
1. Cloning the source container to a new VMID (preserves original)
2. Applying configuration changes (CPU, memory)
3. Resizing disk if requested
4. Optionally converting to template

Required environment variables:
    PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
    PVE_API_TOKEN - API token in format: user@realm!tokenid=secret

Optional environment variables:
    PVE_NODE - Target PVE node name (auto-detected if not set)

Examples:
    # Clone and resize disk to 64GB
    uv run --env-file .env ./scripts/pve/pve-lxc-resize.py --source 9001 --disk-size 65536

    # Clone with new CPU/memory config
    uv run --env-file .env ./scripts/pve/pve-lxc-resize.py --source 9001 --vcpus 8 --memory 16384

    # Clone, resize, and convert to template
    uv run --env-file .env ./scripts/pve/pve-lxc-resize.py --source 9001 --disk-size 65536 --to-template

    # Specify target VMID instead of auto-allocating
    uv run --env-file .env ./scripts/pve/pve-lxc-resize.py --source 9001 --target 9010 --disk-size 65536
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import ssl
import sys
import typing as t
import urllib.parse
import urllib.request

import dotenv


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
                "Invalid PVE_API_TOKEN format. Expected 'user@realm!tokenid=secret'"
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
        full: bool = False,
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
        full: bool = False,
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
        """Find the next available VMID starting from `start`."""
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


def parse_disk_size(rootfs: str) -> float:
    """Parse current disk size from rootfs config string.

    Args:
        rootfs: Config string like "volume=local-lvm:vm-9000-disk-0,size=8G"

    Returns:
        Size in GB as float
    """
    if "size=" not in rootfs:
        return 0
    try:
        size_part = [p for p in rootfs.split(",") if p.startswith("size=")][0]
        size_str = size_part.split("=")[1]
        if size_str.endswith("G"):
            return float(size_str[:-1])
        elif size_str.endswith("M"):
            return float(size_str[:-1]) / 1024
        elif size_str.endswith("T"):
            return float(size_str[:-1]) * 1024
    except Exception:
        pass
    return 0


async def clone_and_resize(args: argparse.Namespace) -> int:
    """Clone a container and apply configuration changes.

    Returns the new VMID.
    """
    # Validate environment
    api_url = os.environ.get("PVE_API_URL")
    api_token = os.environ.get("PVE_API_TOKEN")

    if not api_url or not api_token:
        print("ERROR: PVE_API_URL and PVE_API_TOKEN must be set")
        print("")
        print("Example:")
        print("  export PVE_API_URL=https://pve.example.com:8006")
        print("  export PVE_API_TOKEN=root@pam!cmux=your-secret")
        sys.exit(1)

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
    )

    # Test connection
    try:
        version = client.get_version()
        print(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        print(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    node = client.get_node()
    print(f"Using node: {node}")

    source_vmid = args.source

    # Verify source exists
    try:
        config = await client.aget_lxc_config(source_vmid, node)
        status = await client.aget_lxc_status(source_vmid, node)
        is_template = config.get("template", 0) == 1
        print(f"Source container {source_vmid}: {'template' if is_template else 'container'}, status={status.get('status', 'unknown')}")
    except Exception as e:
        print(f"ERROR: Source container {source_vmid} not found: {e}")
        sys.exit(1)

    # Determine target VMID
    if args.target:
        new_vmid = args.target
        # Check if target already exists
        try:
            await client.aget_lxc_status(new_vmid, node)
            print(f"ERROR: Target VMID {new_vmid} already exists")
            sys.exit(1)
        except Exception:
            pass  # Expected - target should not exist
    else:
        new_vmid = await client.afind_next_vmid(node, start=args.vmid_start)

    hostname = args.hostname or f"cmux-{new_vmid}"

    # Clone the container
    print(f"\nCloning {source_vmid} -> {new_vmid} (hostname: {hostname})...")
    clone_type = "full" if args.full_clone else "linked"
    print(f"  Clone type: {clone_type}")

    try:
        upid = await client.aclone_lxc(
            source_vmid,
            new_vmid,
            hostname=hostname,
            full=args.full_clone,
            node=node,
        )
        await client.await_task(upid, timeout=600, node=node)
        print(f"  Clone complete: {source_vmid} -> {new_vmid}")
    except Exception as e:
        if not args.full_clone:
            print(f"  Linked clone failed ({e}), trying full clone...")
            upid = await client.aclone_lxc(
                source_vmid,
                new_vmid,
                hostname=hostname,
                full=True,
                node=node,
            )
            await client.await_task(upid, timeout=600, node=node)
            print(f"  Full clone complete: {source_vmid} -> {new_vmid}")
        else:
            raise

    # Apply CPU/memory configuration
    if args.vcpus or args.memory:
        print(f"\nConfiguring container {new_vmid}...")
        if args.vcpus:
            print(f"  vCPUs: {args.vcpus}")
        if args.memory:
            print(f"  Memory: {args.memory} MiB")
        await client.aset_lxc_config(
            new_vmid,
            cores=args.vcpus,
            memory=args.memory,
            node=node,
        )

    # Resize disk if requested
    if args.disk_size:
        new_config = await client.aget_lxc_config(new_vmid, node)
        rootfs = new_config.get("rootfs", "")
        current_size_gb = parse_disk_size(rootfs)
        target_size_gb = args.disk_size / 1024

        print(f"\nDisk resize:")
        print(f"  Current size: {current_size_gb:.1f} GB")
        print(f"  Target size: {target_size_gb:.1f} GB")

        if target_size_gb > current_size_gb:
            print(f"  Resizing disk to {int(target_size_gb)}G...")
            await client.aresize_lxc_disk(
                new_vmid,
                "rootfs",
                f"{int(target_size_gb)}G",
                node=node,
            )
            print("  Disk resize complete")
        elif target_size_gb < current_size_gb:
            print("  WARNING: Cannot shrink disk (target < current), skipping resize")
        else:
            print("  Disk size unchanged, skipping resize")

    # Convert to template if requested
    if args.to_template:
        # Need to ensure container is stopped first
        status = await client.aget_lxc_status(new_vmid, node)
        if status.get("status") == "running":
            print(f"\nStopping container {new_vmid} for template conversion...")
            upid = await client.ashutdown_lxc(new_vmid, node)
            await client.await_task(upid, timeout=120, node=node)

        print(f"\nConverting container {new_vmid} to template...")
        await client.aconvert_to_template(new_vmid, node)
        print("  Conversion complete")

    # Print summary
    print("\n" + "=" * 50)
    print("Summary")
    print("=" * 50)
    print(f"Source VMID: {source_vmid}")
    print(f"New VMID: {new_vmid}")
    print(f"Hostname: {hostname}")
    if args.vcpus:
        print(f"vCPUs: {args.vcpus}")
    if args.memory:
        print(f"Memory: {args.memory} MiB")
    if args.disk_size:
        print(f"Disk: {args.disk_size / 1024:.0f} GB")
    if args.to_template:
        print(f"Type: template")
    else:
        print(f"Type: container")

    print(f"\nTo start: pct start {new_vmid}")
    print(f"To enter: pct enter {new_vmid}")
    if not args.to_template:
        print(f"To convert to template: pct template {new_vmid}")

    return new_vmid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clone and resize/reconfigure a PVE LXC container or template",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Clone and resize disk to 64GB
  %(prog)s --source 9001 --disk-size 65536

  # Clone with new CPU/memory config
  %(prog)s --source 9001 --vcpus 8 --memory 16384

  # Clone, resize, and convert to template
  %(prog)s --source 9001 --disk-size 65536 --to-template

  # Specify target VMID instead of auto-allocating
  %(prog)s --source 9001 --target 9010 --disk-size 65536

  # Full clone (independent copy, slower but no backing dependency)
  %(prog)s --source 9001 --disk-size 65536 --full-clone
""",
    )
    parser.add_argument(
        "--source",
        type=int,
        required=True,
        help="Source VMID to clone from (can be template or container)",
    )
    parser.add_argument(
        "--target",
        type=int,
        help="Target VMID for the clone (auto-allocated if not specified)",
    )
    parser.add_argument(
        "--vmid-start",
        type=int,
        default=9000,
        help="Starting VMID for auto-allocation (default: 9000)",
    )
    parser.add_argument(
        "--hostname",
        help="Hostname for the new container (default: cmux-<vmid>)",
    )
    parser.add_argument(
        "--vcpus",
        type=int,
        help="Number of vCPUs for the new container",
    )
    parser.add_argument(
        "--memory",
        type=int,
        help="Memory in MiB for the new container",
    )
    parser.add_argument(
        "--disk-size",
        type=int,
        help="Disk size in MiB (only increases, cannot shrink)",
    )
    parser.add_argument(
        "--full-clone",
        action="store_true",
        help="Perform full clone instead of linked clone (slower but independent)",
    )
    parser.add_argument(
        "--to-template",
        action="store_true",
        help="Convert the cloned container to a template",
    )
    return parser.parse_args()


def main() -> None:
    dotenv.load_dotenv()
    args = parse_args()

    try:
        asyncio.run(clone_and_resize(args))
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
