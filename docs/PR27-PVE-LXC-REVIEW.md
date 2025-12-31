# PR #27 Review: PVE LXC Sandbox Provider with Cloudflare Tunnel Support

## Summary

This PR adds Proxmox VE (PVE) LXC containers as an alternative sandbox provider to Morph Cloud, enabling self-hosted deployment with Cloudflare Tunnel for public access.

**Stats:** 75 files changed, ~13,300 additions, ~310 deletions

**Update (2025-12-31):** URL pattern refactored to Morph-consistent (`port-{port}-vm-{vmid}.{domain}`)

---

## URL Pattern (Morph-Consistent)

### Pattern Comparison

| Provider | Pattern | Example |
|----------|---------|---------|
| **Morph Cloud** | `port-{port}-morphvm_{id}.http.cloud.morph.so` | `port-39378-morphvm_mmcz8L6eoJHtLqFz3.http.cloud.morph.so` |
| **PVE LXC/VM** | `port-{port}-vm-{vmid}.{domain}` | `port-39378-vm-200.alphasolves.com` |

### Service URLs

| Service | Port | URL Pattern |
|---------|------|-------------|
| VSCode | 39378 | `https://port-39378-vm-{vmid}.{domain}` |
| Worker | 39377 | `https://port-39377-vm-{vmid}.{domain}` |
| Xterm | 39383 | `https://port-39383-vm-{vmid}.{domain}` |
| Exec | 39375 | `https://port-39375-vm-{vmid}.{domain}` |
| VNC | 39380 | `https://port-39380-vm-{vmid}.{domain}` |
| Preview | 5173 | `https://port-5173-vm-{vmid}.{domain}` |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          PVE LXC SANDBOX ARCHITECTURE                            │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌───────────────────────┐      ┌──────────────────────┐                        │
│  │   apps/www (Hono)     │      │   apps/client        │                        │
│  │   Backend API         │◄────►│   Frontend SPA       │                        │
│  └──────────┬────────────┘      └──────────────────────┘                        │
│             │                                                                    │
│  ┌──────────▼────────────┐                                                      │
│  │  sandbox-provider     │ ← Detects Morph or PVE based on env vars             │
│  │  sandbox-instance     │ ← Unified interface for both providers               │
│  └──────────┬────────────┘                                                      │
│             │                                                                    │
│  ┌──────────┴────────────────────────────────────────────────────┐              │
│  │                    PROVIDER LAYER                              │              │
│  │  ┌──────────────────┐         ┌────────────────────────────┐│              │
│  │  │  MorphCloudClient│         │   PveLxcClient            ││              │
│  │  │  (morphcloud npm)│         │   (pve-lxc-client.ts)     ││              │
│  │  └──────────────────┘         └────────────────────────────┘│              │
│  └────────────────────────────────────────────────────────────────┘              │
│                                     │                                            │
│                    ┌────────────────▼────────────────┐                          │
│                    │     Proxmox VE Host             │                          │
│                    │  ┌────────────────────────────┐ │                          │
│                    │  │  LXC Container (cmux-XXX)  │ │                          │
│                    │  │                            │ │                          │
│                    │  │  ┌──────────────────────┐  │ │                          │
│                    │  │  │  apps/server         │  │ │  ← Claude Code/Codex/  │
│                    │  │  │  (CLI executor)      │  │ │    task runtime        │
│                    │  │  │  ├─ Socket.IO        │  │ │                        │
│                    │  │  │  ├─ Express server   │  │ │                        │
│                    │  │  │  └─ AI SDK (Vercel) │  │ │                        │
│                    │  │  └──────────────────────┘  │ │                        │
│                    │  │                            │ │                        │
│                    │  │  ├─ cmux-execd (39375)    │ │                          │
│                    │  │  ├─ worker (39377)        │ │                          │
│                    │  │  ├─ vscode (39378)        │ │                          │
│                    │  │  ├─ vnc (39380)           │ │                          │
│                    │  │  └─ xterm (39383)         │ │                          │
│                    │  └────────────────────────────┘ │                          │
│                    │           │                      │                          │
│                    │  ┌────────▼──────────┐          │                          │
│                    │  │ Cloudflare Tunnel │          │                          │
│                    │  │ + Caddy (routing) │          │                          │
│                    │  └───────────────────┘          │                          │
│                    └─────────────────────────────────┘                          │
│                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### apps/server Deployment (Task Execution Orchestrator)

**Critical Clarification**: `apps/server` is **NOT an external service**. It runs **embedded inside each sandbox** (both Morph and PVE LXC):

#### Deployment Architecture

| Aspect | Morph Cloud | PVE LXC (PR #27) |
|--------|------------|-----------------|
| **Location** | Inside Morph VM snapshot | Inside LXC container snapshot |
| **Port** | 9776 | 9776 |
| **Per-Instance** | One per Morph VM | One per LXC container |
| **Communication** | Socket.IO + Express | Socket.IO + Express |
| **Snapshot Baking** | Pre-baked in Morph image | Built by `scripts/snapshot-pvelxc.py` |

#### What apps/server Does

`apps/server` is the **central task execution orchestrator** inside each sandbox:

1. **Agent Spawning & Task Management**
   - Initiates Claude Code, Codex CLI, and other agent lifecycles via `spawnAgent`
   - Creates task runs in Convex database
   - Generates Git branches and sets up execution environments
   - Manages VSCode container startup and configuration

2. **Git Operations & Worktree Management**
   - Creates/manages Git worktrees for task isolation
   - Computes diffs between Git references
   - Handles branch checkouts within containers
   - Persists worktree metadata to Convex

3. **Real-time Communication** (Socket.IO WebSocket)
   - Communicates with frontend via Socket.IO on port 9776
   - Receives control plane commands (exec, file-changes)
   - Emits events: `vscode-spawned`, `file-changes`, `terminal-failed`
   - URL pattern: `port-9776-vm-{vmid}.{domain}` (via Cloudflare Tunnel in PVE)

4. **Worker Coordination**
   - Receives `worker:file-changes` events from running agents
   - Processes file changes and updates Convex in real-time
   - Monitors terminal state and handles failures
   - Orchestrates diff computation for UI updates

#### Frontend Communication Flow

```
┌─────────────────┐
│  apps/client    │ (Frontend SPA on port 5173)
└────────┬────────┘
         │
         ├─► HTTP/REST to apps/www (/api/sandboxes/start)
         │   Port: 9779
         │   Purpose: Create/manage sandbox lifecycle
         │
         └─► Socket.IO to apps/server inside sandbox
             URL: port-9776-vm-{vmid}.{domain}
             Purpose: Real-time task execution
```

**Why apps/server is inside the sandbox**: Enables true isolation, allows each task to have its own agent runtime environment, and eliminates the need for a separate execution server farm.

---

## File Changes Categorized

### 1. Core Provider Abstraction (Backend)

| File | Purpose |
|------|---------|
| `apps/www/lib/utils/sandbox-provider.ts` | Provider detection/selection logic |
| `apps/www/lib/utils/sandbox-instance.ts` | Unified SandboxInstance interface |
| `apps/www/lib/utils/pve-lxc-client.ts` | PVE API client (~900 lines) |
| `apps/www/lib/utils/pve-lxc-defaults.ts` | PVE snapshot preset re-exports |
| `apps/www/lib/routes/config.route.ts` | `/api/config/sandbox` endpoint |
| `apps/www/lib/routes/sandboxes.route.ts` | Updated sandbox start logic |
| `apps/www/lib/routes/sandboxes/snapshot.ts` | Snapshot resolution for both providers |
| `apps/www/lib/utils/www-env.ts` | New PVE env vars schema |

### 2. Shared Types & Presets

| File | Purpose |
|------|---------|
| `packages/shared/src/sandbox-presets.ts` | Unified preset types, capabilities |
| `packages/shared/src/pve-lxc-snapshots.ts` | PVE snapshot schema & manifest |
| `packages/shared/src/pve-lxc-snapshots.json` | PVE snapshot data |
| `packages/shared/src/pve-lxc-snapshots.test.ts` | Tests for snapshot manifests |
| `packages/shared/src/morph-snapshots.ts` | Updated for unified ID format |

### 3. Rust Sandbox Daemon

| File | Purpose |
|------|---------|
| `packages/sandbox/src/pve_lxc.rs` | PVE LXC provider implementation (~1200 lines) |
| `packages/sandbox/src/models.rs` | Extended model types |
| `packages/sandbox/Cargo.toml` | New dependencies |

### 4. Frontend Changes

| File | Purpose |
|------|---------|
| `apps/client/src/components/RepositoryAdvancedOptions.tsx` | Dynamic preset loading from API |
| `apps/client/src/components/RepositoryPicker.tsx` | Updated snapshot selection |
| `apps/client/src/lib/toProxyWorkspaceUrl.ts` | Added `toVncViewerUrl()` for PVE |
| Various route files | Updated to handle PVE service URLs |

### 5. PVE Shell Scripts

| File | Purpose |
|------|---------|
| `scripts/pve/pve-lxc-setup.sh` | One-liner template creation on PVE host |
| `scripts/pve/pve-lxc-template.sh` | Template management |
| `scripts/pve/pve-tunnel-setup.sh` | Cloudflare Tunnel + Caddy deployment |
| `scripts/pve/pve-api.sh` | API helper functions |
| `scripts/pve/pve-instance.sh` | Instance lifecycle management |
| `scripts/pve/pve-criu.sh` | CRIU checkpoint/restore (for hibernation) |
| `scripts/pve/README.md` | Documentation |
| `scripts/snapshot-pvelxc.py` | Python script for snapshot builds (~4100 lines) |

### 6. Configuration & Tests

| File | Purpose |
|------|---------|
| `scripts/pve/test-pve-lxc-client.ts` | Client integration tests |
| `scripts/pve/test-pve-cf-tunnel.ts` | Tunnel connectivity tests |
| `configs/systemd/cmux-execd.service` | Systemd service for cmux-execd |

---

## Design Analysis

### Strengths

1. **Clean Provider Abstraction**
   - `SandboxProvider` type union (`morph | pve-lxc | pve-vm`)
   - `SandboxInstance` interface with wrapper functions
   - Auto-detection with explicit override via `SANDBOX_PROVIDER`

2. **Unified Snapshot ID Format**
   - Format: `{provider}_{presetId}_v{version}` (e.g., `pvelxc_4vcpu_6gb_32gb_v1`)
   - Enables consistent API across providers
   - Backwards compatible parsing

3. **Minimal Environment Variables**
   - Only `PVE_API_URL` + `PVE_API_TOKEN` required
   - Node, storage, gateway auto-detected
   - `PVE_PUBLIC_DOMAIN` for Cloudflare Tunnel URLs

4. **Linked Clone Performance**
   - Uses copy-on-write clones from templates
   - Fast container provisioning (<5s typical)

5. **Comprehensive Tooling**
   - Shell scripts for PVE host setup
   - Python script for snapshot management
   - TypeScript tests for integration

### Gaps & Missing Design Elements

#### High Priority

1. **No Instance Metadata Persistence**
   - `PveLxcClient` uses in-memory `Map<vmid, metadata>` (line 234)
   - Lost on server restart
   - **Fix:** Store metadata in Convex or PVE description field

2. **Missing Container Cleanup/GC**
   - No TTL enforcement for containers
   - No automatic cleanup of orphaned containers
   - **Fix:** Add `pruneContainers()` with TTL check + Convex reconciliation

3. **CRIU Hibernation Not Integrated**
   - `pve-criu.sh` exists but not used in `PveLxcClient`
   - `pause()` just calls `stop()` (no RAM state preservation)
   - **Impact:** Feature parity with Morph hibernation incomplete

4. **Error Recovery for Failed Clones**
   - If `linkedCloneFromTemplate` succeeds but `startContainer` fails, container left in stopped state
   - **Fix:** Add rollback logic to delete failed containers

#### Medium Priority

5. **No Health Check Endpoint**
   - Can't verify PVE connectivity from frontend
   - **Fix:** Add `GET /api/health/sandbox` endpoint

6. **Missing Rate Limiting**
   - No protection against rapid container creation
   - **Fix:** Add rate limiting per team/user

7. **Service URL Fallback Chain Incomplete**
   - Falls back from public domain to FQDN, but no IP fallback
   - If DNS not configured, errors out
   - **Fix:** Add container IP fallback for local dev

8. **Frontend Terminal Not PVE-Aware**
   - `toMorphXtermBaseUrl()` only handles Morph URLs
   - **Fix:** Add `toPveLxcXtermBaseUrl()` or generalize URL building

#### Low Priority

9. **PVE VM Provider Stub**
   - `pve-vm` type declared but not implemented
   - `SANDBOX_PROVIDER_CAPABILITIES["pve-vm"]` defined
   - **Plan:** Defer to future PR

10. **No Snapshot Versioning UI**
    - API returns versions but UI only uses latest
    - **Future:** Allow selecting specific snapshot versions

11. **Tunnel Setup Not Automated**
    - `pve-tunnel-setup.sh` requires manual execution on PVE host
    - **Future:** Consider Ansible/Terraform automation

---

## Environment Variables Summary

### Required for PVE LXC

| Variable | Format | Example |
|----------|--------|---------|
| `PVE_API_URL` | URL | `https://pve.example.com` |
| `PVE_API_TOKEN` | `USER@REALM!TOKENID=SECRET` | `root@pam!cmux=abc123...` |
| `PVE_PUBLIC_DOMAIN` | Domain | `example.com` |

### Optional (Auto-Detected)

| Variable | Default | Notes |
|----------|---------|-------|
| `PVE_NODE` | First online node | Auto-detected from cluster |
| `PVE_STORAGE` | Storage with `rootdir` | Auto-detected by space |
| `PVE_BRIDGE` | `vmbr0` | Network bridge |
| `PVE_IP_POOL_CIDR` | `10.100.0.0/24` | Container IP range |
| `PVE_GATEWAY` | Bridge gateway | Auto-detected |
| `PVE_VERIFY_TLS` | `false` | Self-signed cert support |

### Cloudflare Tunnel (on PVE Host)

| Variable | Description |
|----------|-------------|
| `CF_API_TOKEN` | Cloudflare API token (Zone:DNS:Edit + Tunnel:Edit) |
| `CF_ZONE_ID` | Zone ID from Cloudflare dashboard |
| `CF_ACCOUNT_ID` | Account ID from Cloudflare dashboard |
| `CF_DOMAIN` | Domain (e.g., `example.com`) |

---

## Testing Recommendations

1. **Unit Tests**
   - [ ] `parseSnapshotId()` edge cases
   - [ ] `resolveSnapshotId()` for both providers
   - [ ] `getActiveSandboxProvider()` auto-detection logic

2. **Integration Tests**
   - [ ] PVE API connectivity (`test-pve-lxc-client.ts`)
   - [ ] Cloudflare Tunnel routing (`test-pve-cf-tunnel.ts`)
   - [ ] Container lifecycle: create → exec → stop → delete

3. **E2E Tests**
   - [ ] Frontend environment creation with PVE preset
   - [ ] VSCode/terminal access via Cloudflare Tunnel
   - [ ] Task execution in PVE container

---

## Deployment Checklist

### On PVE Host

1. Create base template: `curl ... | bash -s -- 9000`
2. Deploy Cloudflare Tunnel: `./pve-tunnel-setup.sh setup`
3. Verify services: `./pve-tunnel-setup.sh status`

### On Backend (apps/www)

1. Set `PVE_API_URL`, `PVE_API_TOKEN`, `PVE_PUBLIC_DOMAIN`
2. (Optional) Set `SANDBOX_PROVIDER=pve-lxc` to force PVE
3. Deploy to Vercel

### Build Snapshots

```bash
uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000
```

---

## Recommendations for Next Steps

1. **Add metadata persistence** - Highest priority, prevents data loss
2. **Implement container GC** - Prevents resource leaks
3. **Add health check endpoint** - Improves observability
4. **Generalize terminal URL builder** - Fixes frontend for PVE
5. **Write missing unit tests** - Improves reliability

---

## URL Pattern Refactoring Implementation Plan

### Files Modified

#### 1. `scripts/pve/pve-tunnel-setup.sh` (Caddy Configuration)

Updated `configure_caddy()` function to use Morph-consistent pattern with single rule:

```caddyfile
# Single rule handles all services: port-{port}-vm-{vmid}.{domain}
@service header_regexp match Host ^port-(\d+)-vm-(\d+)\.
handle @service {
    reverse_proxy cmux-{re.match.2}.${domain_suffix}:{re.match.1}
}
```

#### 2. `apps/www/lib/utils/pve-lxc-client.ts`

Updated `buildPublicServiceUrl()` method:

```typescript
// Morph-consistent pattern
return `https://port-${port}-vm-${vmid}.${this.publicDomain}`;
```

### Benefits

1. **Single Caddy rule** - No hardcoded service names, any port works automatically
2. **Morph-consistent** - Same `port-{port}-vm-{id}` structure
3. **Easy to identify** - `vm-{vmid}` makes it easy to identify in PVE host management
4. **Extensible** - New ports work without config changes

### Migration Steps

1. Update Caddy configuration on PVE host
2. Reload Caddy service: `systemctl reload caddy-cmux`
3. Update TypeScript client code (already done)
4. Redeploy backend
5. Test new URLs

