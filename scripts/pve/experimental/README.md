# Experimental PVE Scripts

This directory contains experimental scripts for Proxmox VE that are **not officially supported** and may have limitations.

## pve-criu.sh - CRIU Checkpoint/Restore

**Status:** Experimental

CRIU (Checkpoint/Restore In Userspace) allows saving and restoring the state of a running container, including RAM state. However, it has significant limitations in PVE LXC:

### Limitations (per PVE Official Docs)

1. **Experimental status** - `pct suspend` is marked experimental in PVE documentation
2. **Kernel dependency** - Requires kernel support and CRIU package installed on host
3. **FUSE incompatibility** - Containers with FUSE mounts cannot be checkpointed
4. **Freezer subsystem issues** - Linux kernel freezer can cause I/O deadlocks
5. **Not all processes checkpoint** - Some applications may not checkpoint cleanly

### When to Use

- Testing/development environments where RAM state preservation is desired
- Containers without FUSE mounts or complex process trees
- When you've verified CRIU works for your specific workload

### When NOT to Use

- Production deployments (use stop/start instead)
- Containers with Docker/FUSE
- Critical workloads where reliability is paramount

### Alternative

For production use, cmux uses regular stop/start for PVE LXC containers. The `SandboxInstance.pause()` method correctly falls back to `stop()` since true hibernate is not reliably supported.

### Usage

```bash
# Check CRIU availability
./pve-criu.sh status

# Checkpoint (suspend with RAM)
./pve-criu.sh checkpoint 200

# Restore
./pve-criu.sh restore 200

# Test checkpoint/restore cycle
./pve-criu.sh test 200
```

### References

- [PVE LXC Documentation](https://pve.proxmox.com/wiki/Linux_Container)
- [CRIU Project](https://criu.org/)
