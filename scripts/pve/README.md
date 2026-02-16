# Proxmox VE Scripts for cmux

Scripts for managing Proxmox VE LXC containers as sandbox providers for cmux.

## Overview

These scripts support the cmux PVE LXC sandbox provider, a self-hosted alternative to Morph Cloud sandboxes using Proxmox VE with LXC containers and Cloudflare Tunnel for public access.

## Prerequisites

- Proxmox VE 8.x node
- API token with appropriate permissions
- Domain with Cloudflare DNS (for public access via Cloudflare Tunnel)
- `jq` and `curl` installed on your local machine

## Environment Variables

The scripts automatically load environment variables from the project root `.env` file.
You can also export them manually or override the `.env` values by exporting before running.

### Backend (apps/www)

```bash
# Required
PVE_API_URL="https://pve.example.com"
PVE_API_TOKEN="root@pam!cmux=<your-token-secret>"
PVE_PUBLIC_DOMAIN="example.com"   # Domain for Cloudflare Tunnel URLs

# Optional (auto-detected)
PVE_NODE="pve"                    # Target node (first online node)
PVE_STORAGE="local-lvm"           # Storage (most available space)
PVE_BRIDGE="vmbr0"                # Network bridge
PVE_GATEWAY=""                    # Gateway IP (from bridge config)
PVE_VERIFY_TLS="false"            # Self-signed cert support
```

### Cloudflare Tunnel (on PVE Host)

```bash
CF_API_TOKEN="..."                # Zone:DNS:Edit + Tunnel:Edit permissions
CF_ZONE_ID="..."                  # From Cloudflare dashboard
CF_ACCOUNT_ID="..."               # From Cloudflare dashboard
CF_DOMAIN="example.com"
```

### Config Files (PVE Host)

Default paths written by `pve-tunnel-setup.sh`:

- Cloudflare Tunnel config: `/etc/cloudflared/config.yml`
- Caddy config: `/etc/caddy/Caddyfile.cmux`
- Cloudflare systemd unit: `/etc/systemd/system/cloudflared.service`
- Caddy systemd unit: `/etc/systemd/system/caddy-cmux.service`

Overrides are available via `CLOUDFLARED_CONFIG_DIR` and `CADDY_CONFIG_DIR`.

The `.env` file is auto-loaded from the project root (`/path/to/cmux/.env`).
If `PVE_API_URL` is already set in your environment, the `.env` file will not override it.

## URL Pattern

PVE LXC uses an instanceId-based URL pattern for service access via Cloudflare Tunnel:

| Service | Port | URL Pattern |
|---------|------|-------------|
| VSCode | 39378 | `https://port-39378-{instanceId}.{domain}` |
| Go Worker (SSH proxy) | 39377 | `https://port-39377-{instanceId}.{domain}` |
| Node.js Worker (Socket.IO) | 39376 | `https://port-39376-{instanceId}.{domain}` |
| Xterm | 39383 | `https://port-39383-{instanceId}.{domain}` |
| Exec | 39375 | `https://port-39375-{instanceId}.{domain}` |
| VNC | 39380 | `https://port-39380-{instanceId}.{domain}` |

## Scripts

### pve-api.sh
Core API helper functions. Source this in other scripts.

```bash
source ./pve-api.sh

# Test connection
pve_test_connection

# List nodes
pve_list_nodes

# LXC operations
pve_list_lxc
pve_lxc_status <vmid>
pve_lxc_start <vmid>
pve_lxc_stop <vmid>
```

### pve-test-connection.sh
Test API connectivity and authentication.

```bash
./pve-test-connection.sh
```

### pve-lxc-setup.sh
One-liner template creation for PVE host. Run this directly on your Proxmox node.

```bash
# Download and run on PVE host
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000

# With custom options
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000 --memory 8192 --cores 8
```

### pve-lxc-template.sh
Manage LXC templates for cmux sandboxes.

```bash
# List available OS templates
./pve-lxc-template.sh list

# Create a new cmux base container
./pve-lxc-template.sh create 9000 --memory 8192 --cores 8

# Generate configuration script
./pve-lxc-template.sh configure 9000

# Convert container to template
./pve-lxc-template.sh convert 9000

# Show container info
./pve-lxc-template.sh info 9000
```

### pve-instance.sh
Manage LXC container instances.

```bash
# List all containers
./pve-instance.sh list

# Start/stop containers
./pve-instance.sh start 100
./pve-instance.sh stop 100

# Clone from template
./pve-instance.sh clone 101 --hostname sandbox-001

# Show detailed status
./pve-instance.sh status 100

# Delete container
./pve-instance.sh delete 100
```

### pve-tunnel-setup.sh
Deploy Cloudflare Tunnel and Caddy for public access to containers.

```bash
# Initial setup (run on PVE host)
./pve-tunnel-setup.sh setup

# Check status
./pve-tunnel-setup.sh status

# Update configuration
./pve-tunnel-setup.sh update
```

## Quick Start

### 1. Create Base Template (on PVE host)

```bash
# One-liner: download and run setup script on PVE host console
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000
```

### 2. Deploy Cloudflare Tunnel (on PVE host)

```bash
# Set Cloudflare credentials
export CF_API_TOKEN="your-cloudflare-api-token"
export CF_ZONE_ID="your-zone-id"
export CF_ACCOUNT_ID="your-account-id"
export CF_DOMAIN="example.com"

# Run setup
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-tunnel-setup.sh | bash -s -- setup
```

### 3. Build Snapshots (from dev machine)

```bash
uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000
```

### 4. Configure Backend

Add to your `.env` file:

```bash
PVE_API_URL="https://your-pve-host"
PVE_API_TOKEN="root@pam!cmux=your-token-secret"
PVE_PUBLIC_DOMAIN="example.com"
```

### 5. Test Connection

```bash
./scripts/pve/pve-test-connection.sh
```

## Integration with cmux

These scripts support the PVE LXC provider implementation:

| File | Purpose |
|------|---------|
| `apps/www/lib/utils/pve-lxc-client.ts` | PVE API client (~900 lines) |
| `packages/sandbox/src/pve_lxc.rs` | Rust sandbox daemon |
| `scripts/snapshot-pvelxc.py` | Snapshot build script |

The provider auto-detects based on environment variables. Set `SANDBOX_PROVIDER=pve-lxc` to force PVE.

## Troubleshooting

### Connection Issues
```bash
# Check SSL certificate
curl -k -v "${PVE_API_URL}/api2/json/version"

# Verify token format
echo "Token: ${PVE_API_TOKEN%%=*}=***"
```

### Cloudflare Tunnel Issues
```bash
# Check tunnel status on PVE host
systemctl status cloudflared

# Check Caddy status
systemctl status caddy-cmux

# Test URL routing
curl -v https://port-39378-pvelxc-abc123.example.com
```

### Common Errors

- **401 Unauthorized**: Check API token format and permissions
- **Connection refused**: Verify Cloudflare Tunnel is running
- **DNS resolution failed**: Check wildcard DNS (*.example.com) points to Cloudflare

## Experimental Scripts

The `experimental/` directory contains scripts for features not yet production-ready:

- `experimental/pve-criu.sh` - CRIU checkpoint/restore (experimental, not required for cmux)

Note: CRIU checkpoint/restore is marked experimental in PVE documentation and is NOT required for cmux operation. The PVE LXC provider uses container stop/start for pause/resume.

## Related Documentation

- [Proxmox VE API Documentation](https://pve.proxmox.com/pve-docs/api-viewer/)
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
