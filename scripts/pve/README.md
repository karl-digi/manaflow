# Proxmox VE Scripts for cmux

Scripts for managing Proxmox VE LXC containers as sandbox providers for cmux.

## Overview

These scripts support the cmux cost reduction roadmap by providing a self-hosted alternative to Morph Cloud sandboxes using Proxmox VE with LXC containers and CRIU for RAM state snapshots.

## Prerequisites

- Proxmox VE 8.x node
- API token with appropriate permissions
- `jq` and `curl` installed on your local machine
- CRIU installed on the Proxmox node (for checkpoint/restore)

## Environment Variables

The scripts automatically load environment variables from the project root `.env` file.
You can also export them manually or override the `.env` values by exporting before running.

```bash
# Required (add to .env or export)
PVE_API_URL="https://pve.example.com:8006"
PVE_API_TOKEN="root@pam!cmux=<your-token-secret>"

# Optional
PVE_NODE="pve"                    # Target node (auto-detected if not set)
PVE_STORAGE="local"               # Storage for templates
PVE_TEMPLATE_VMID="9000"          # Default template VMID
PVE_LXC_MEMORY="4096"             # Default memory in MB
PVE_LXC_CORES="4"                 # Default CPU cores
PVE_LXC_DISK="32"                 # Default disk size in GB
PVE_SSH_HOST="root@pve.example.com"  # SSH host for pct commands (auto-derived from PVE_API_URL)
```

The `.env` file is auto-loaded from the project root (`/path/to/cmux/.env`).
If `PVE_API_URL` is already set in your environment, the `.env` file will not override it.

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

### pve-criu.sh
CRIU checkpoint/restore for RAM state preservation (critical for Morph parity).

```bash
# Check CRIU availability
./pve-criu.sh status

# Checkpoint (pause with RAM state)
./pve-criu.sh checkpoint 100

# Restore (resume from checkpoint)
./pve-criu.sh restore 100

# Test checkpoint/restore cycle
./pve-criu.sh test 100

# Disk snapshots (no RAM state)
./pve-criu.sh snapshot 100 pre-upgrade
./pve-criu.sh list 100
./pve-criu.sh rollback 100 pre-upgrade
```

## Quick Start

1. **Set up environment variables** (add to project root `.env` file)
   ```bash
   # In /path/to/cmux/.env
   PVE_API_URL="https://your-pve-host:8006"
   PVE_API_TOKEN="root@pam!cmux=your-token-secret"
   ```

2. **Test connection**
   ```bash
   ./pve-test-connection.sh
   ```

3. **Create base template**
   ```bash
   # Create container
   ./pve-lxc-template.sh create 9000

   # Configure (fully autonomous - auto-starts, installs deps via SSH)
   ./pve-lxc-template.sh configure 9000

   # Convert to template (auto-stops container)
   ./pve-lxc-template.sh convert 9000
   ```

   Note: The `configure` command uses SSH to execute `pct` commands on the PVE host.
   Ensure SSH key-based auth is set up for `root@<pve-host>` (derived from `PVE_API_URL`).

4. **Create sandbox instance**
   ```bash
   ./pve-instance.sh clone 101 --hostname my-sandbox
   ./pve-instance.sh start 101
   ```

5. **Test CRIU checkpoint/restore**
   ```bash
   ./pve-criu.sh test 101
   ```

## CRIU Notes

CRIU (Checkpoint/Restore In Userspace) is essential for RAM state preservation. This gives cmux the ability to pause sandboxes and resume them with all running processes intact, matching Morph Cloud's capability.

### Installing CRIU on Proxmox Node

```bash
apt-get install criu
criu check --all
```

### Container Requirements for CRIU

- Containers should have `features=nesting=1` for Docker support
- Some applications may not checkpoint cleanly (test your workload)
- Unprivileged containers may have limitations

### Checkpoint vs Snapshot

| Feature | Checkpoint (CRIU) | Snapshot (Disk) |
|---------|-------------------|-----------------|
| RAM State | Yes | No |
| Process Resume | Yes | No |
| Speed | Fast (~100-500ms) | Medium |
| Storage | More space | Less space |
| Use Case | Pause/Resume | Backup/Rollback |

## Integration with cmux

These scripts are designed to support the `ProxmoxProvider` implementation in cmux:

```typescript
// packages/sandbox/src/pve_lxc.rs (Rust)
// or packages/shared/src/sandbox-providers/proxmox.ts (TypeScript)

interface ProxmoxProvider {
  startInstance(config): Promise<Instance>;
  stopInstance(id): Promise<void>;
  pauseInstance(id): Promise<void>;   // Uses CRIU checkpoint
  resumeInstance(id): Promise<void>;  // Uses CRIU restore
}
```

## Troubleshooting

### Connection Issues
```bash
# Check SSL certificate
curl -k -v "${PVE_API_URL}/api2/json/version"

# Verify token format
echo "Token: ${PVE_API_TOKEN%%=*}=***"
```

### CRIU Issues
```bash
# Check CRIU on node
ssh root@pve-node "criu check --all"

# Check container features
pct config <vmid> | grep features
```

### Common Errors

- **401 Unauthorized**: Check API token format and permissions
- **CRIU not available**: Install CRIU on the Proxmox node
- **Checkpoint failed**: Some processes may block checkpointing

## Related Documentation

- [Proxmox VE API Documentation](https://pve.proxmox.com/pve-docs/api-viewer/)
- [CRIU Documentation](https://criu.org/Main_Page)
- [cmux Cost Reduction Roadmap](../../docs/cmux-costreduce-roadmap.md)
