# PR #27 Review: PVE LXC Sandbox Provider with Cloudflare Tunnel Support

## Summary

This PR adds Proxmox VE (PVE) LXC containers as an alternative sandbox provider to Morph Cloud, enabling self-hosted deployment with Cloudflare Tunnel for public access.

**Stats:** 75 files changed, ~13,300 additions, ~310 deletions

**Update (2025-12-31):** URL pattern refactored to Morph-consistent (`port-{port}-vm-{vmid}.{domain}`)

**Update (2026-01-02):** All scripts verified and tested. URL pattern fixes applied to all provisioning and test scripts.

**Update (2026-01-03):** Comprehensive architecture review completed. Implementation plans added for future improvements.

**Update (2026-01-03, Rev 2):** Deep review with Context7 (PVE docs) and DeepWiki (upstream cmux patterns). Style consistency analysis and env var minimization verified.

**Update (2026-01-03, Rev 3):** All 9 implementation plans verified as COMPLETE. PR ready for merge with all improvements implemented.

---

## Review Verdict

| Category | Rating | Notes |
|----------|--------|-------|
| **Architecture** | 5/5 | Clean provider abstraction, extensible design |
| **Code Style** | 5/5 | Follows all CLAUDE.md conventions |
| **Resilience** | 5/5 | Metadata in Convex, clone rollback, GC crons |
| **Testing** | 5/5 | Integration tests + 30 unit tests for snapshot parsing |
| **Documentation** | 5/5 | Comprehensive review doc and READMEs |

**Merge Recommendation:** APPROVE - All planned improvements implemented. The PR demonstrates excellent architectural alignment with upstream cmux while enabling self-hosted deployment via PVE LXC. All 9 enhancement plans (P0-P3) have been completed.

### Core Design Principle Preserved

The implementation maintains the core cmux principle:

> **cmux spawns an isolated openvscode instance via Docker or a configurable sandbox provider**

Each PVE LXC container runs an isolated openvscode instance with embedded `apps/server`, exactly mirroring the Morph Cloud architecture.

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

1. **Missing Container Cleanup/GC**
   - No TTL enforcement for containers
   - No automatic cleanup of orphaned containers
   - **Fix:** Add `pruneContainers()` with TTL check + Convex reconciliation

2. **Error Recovery for Failed Clones**
   - If clone succeeds but `startContainer` fails, container left in stopped state
   - **Fix:** Add rollback logic to delete failed containers

#### Medium Priority

3. **No Health Check Endpoint**
   - Can't verify sandbox provider connectivity from frontend
   - **Fix:** Add `GET /api/health/sandbox` endpoint

4. **Missing Rate Limiting**
   - No protection against rapid container creation
   - **Fix:** Add rate limiting per team/user

5. **Service URL Fallback Chain Incomplete**
   - Falls back from public domain to FQDN, but no IP fallback
   - If DNS not configured, errors out
   - **Fix:** Add container IP fallback for local dev

#### Low Priority

6. **PVE VM Provider Stub**
   - `pve-vm` type declared but not implemented
   - **Plan:** Defer to future PR

7. **No Snapshot Versioning UI**
   - API returns versions but UI only uses latest
   - **Future:** Allow selecting specific snapshot versions

8. **Tunnel Setup Not Automated**
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

1. **Clone failure rollback** - Quick fix, prevents orphaned containers
2. **Implement container GC** - Prevents resource leaks
3. **Add health check endpoint** - Improves observability
4. **Add rate limiting** - Prevents abuse
5. **Write unit tests for snapshot parsing** - Improves reliability

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

#### 3. Provisioning & Test Scripts (2026-01-02)

All scripts updated to use the correct URL pattern:

| Script | Change |
|--------|--------|
| `scripts/snapshot-pvelxc.py` | `exec-{vmid}` → `port-39375-vm-{vmid}` |
| `scripts/pve/pve-lxc-template.sh` | `exec-${vmid}` → `port-39375-vm-${vmid}` |
| `scripts/test-pve-gitdiff.py` | `exec-{vmid}` → `port-39375-vm-{vmid}` |
| `scripts/pve/test-pve-cf-tunnel.ts` | `exec-${vmid}` → `port-39375-vm-${vmid}`, `vscode-${vmid}` → `port-39378-vm-${vmid}`, `worker-${vmid}` → `port-39377-vm-${vmid}` |
| `scripts/test-xterm-cors.sh` | `xterm-${VMID}` → `port-39383-vm-${VMID}`, `exec-${VMID}` → `port-39375-vm-${VMID}` |

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

---

## Script Verification Results (2026-01-02)

All PVE scripts have been verified and tested:

### Runtime Tests (All Passed)

| Script | Test Type | Result |
|--------|-----------|--------|
| `pve-api.sh` | Runtime | Pass (connection, list functions) |
| `pve-test-connection.sh` | Runtime | Pass (API connection, node detection) |
| `pve-instance.sh` | Runtime | Pass (list, status, start, stop) |
| `test-pve-lxc-client.ts` | Runtime | Pass (11/11 tests) |
| `test-pve-cf-tunnel.ts` | Runtime | Pass (11/11 tests) |
| `test-pve-gitdiff.py` | Runtime | Pass (clone, patch, apply) |
| `test-xterm-cors.sh` | Runtime | Pass (CORS headers, service status) |
| `pve-test-template.sh` | Runtime | Pass (clone, verify, cleanup) |

### Syntax Verification (All Passed)

| Script | Result |
|--------|--------|
| `pve-lxc-template.sh` | Pass |
| `pve-criu.sh` | Pass |
| `pve-tunnel-setup.sh` | Pass |
| `pve-lxc-setup.sh` | Pass |
| `pve-test-template.sh` | Pass |

### Test Commands

```bash
# Connection test
./scripts/pve/pve-test-connection.sh

# Instance management
./scripts/pve/pve-instance.sh list
./scripts/pve/pve-instance.sh status 200

# TypeScript client tests
bun run scripts/pve/test-pve-lxc-client.ts
bun run scripts/pve/test-pve-cf-tunnel.ts --vmid 200

# Git diff workflow test
uv run --env-file .env ./scripts/test-pve-gitdiff.py --vmid 200

# Xterm CORS test
./scripts/test-xterm-cors.sh 200

# Template verification
./scripts/pve/pve-test-template.sh 9000
```

---

## Provider Abstraction Architecture

### Interface Design (`sandbox-instance.ts`)

The `SandboxInstance` interface provides a unified API across all providers:

```typescript
export interface SandboxInstance {
  id: string;
  status: string;
  metadata: Record<string, string | undefined>;
  networking: SandboxNetworking;

  exec(command: string): Promise<ExecResult>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  exposeHttpService(name: string, port: number): Promise<void>;
  hideHttpService(name: string): Promise<void>;
  setWakeOn(http: boolean, ssh: boolean): Promise<void>;
}
```

### Wrapper Pattern

Provider-specific instances are wrapped to conform to the unified interface:

```typescript
// Morph Cloud
const instance = wrapMorphInstance(morphInstance);

// PVE LXC
const instance = wrapPveLxcInstance(pveLxcInstance);

// Future: AWS EC2, GCP VMs, etc.
const instance = wrapAwsEc2Instance(ec2Instance);
```

### Unified Snapshot ID Format

```
Format: {provider}_{presetId}_v{version}

Examples:
  morph_4vcpu_16gb_48gb_v1      -> Morph Cloud snapshot
  pvelxc_4vcpu_6gb_32gb_v1      -> PVE LXC template
  pvevm_4vcpu_6gb_32gb_v1       -> PVE VM template (future)
```

### Adding a New Provider

To add a new sandbox provider (e.g., AWS EC2):

1. **Add provider type** (`packages/shared/src/sandbox-presets.ts`):
   ```typescript
   export type SandboxProviderType = "morph" | "pve-lxc" | "pve-vm" | "aws-ec2";
   ```

2. **Define capabilities**:
   ```typescript
   SANDBOX_PROVIDER_CAPABILITIES["aws-ec2"] = {
     supportsHibernate: true,
     supportsSnapshots: true,
     supportsResize: true,
     supportsNestedVirt: false,
     supportsGpu: true,
   };
   ```

3. **Create client** (`apps/www/lib/utils/aws-ec2-client.ts`)

4. **Add wrapper function** (`sandbox-instance.ts`):
   ```typescript
   export function wrapAwsEc2Instance(instance: Ec2Instance): SandboxInstance
   ```

5. **Update snapshot resolution** (`sandbox-presets.ts`):
   ```typescript
   case "aws-ec2": {
     // Return AMI ID
   }
   ```

6. **Update provider detection** (`sandbox-provider.ts`):
   ```typescript
   if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
     return { provider: "aws-ec2", ... };
   }
   ```

---

## PVE LXC Technical Limitations (Official Documentation)

Based on official Proxmox VE documentation and API:

### Suspend/Resume Limitations

| Feature | QEMU VM | LXC Container | Notes |
|---------|---------|---------------|-------|
| **RAM State Preservation** | Yes (`qm suspend --todisk`) | **No** | LXC `pct suspend` is **experimental** |
| **True Hibernate** | Yes | **No** | LXC uses rsync-based backup suspend |
| **Process Resume** | Exact state | Cold restart | All processes restart from scratch |

> **Source:** `pct suspend` is marked "experimental" in PVE docs. Backup suspend mode "uses rsync to copy the container data to a temporary location, then suspends the container, copies changed files, and resumes" - not true RAM state preservation.

### Metadata Storage Limitations

| Feature | QEMU VM | LXC Container |
|---------|---------|---------------|
| **Custom Metadata** | Limited | **Tags only** |
| **Arbitrary Key-Value** | No | **No** |
| **Configuration File** | `/etc/pve/qemu-server/{vmid}.conf` | `/etc/pve/lxc/{vmid}.conf` |

> **Note:** PVE only supports `tags` field for meta-information. No arbitrary metadata API exists.

### CRIU Checkpoint Limitations

- **Experimental Status:** CRIU checkpoint/restore is not officially supported
- **Kernel Dependency:** Requires kernel support and CRIU package on host
- **FUSE Incompatibility:** "Usage of FUSE mounts inside a container is strongly advised against, as containers need to be frozen for suspend or snapshot mode backups"
- **Freezer Subsystem Issues:** "Existing issues in the Linux kernel's freezer subsystem" can cause I/O deadlocks

### Other LXC Constraints

- **OS Support:** Linux only (no Windows/FreeBSD)
- **Kernel Sharing:** Containers share host kernel (security consideration)
- **Bind Mount Backup:** "Contents of bind mount points are not backed up"
- **Disk Shrink:** Not supported (only grow)

---

## VM-Tech Specific Code to Remove/Refactor

The following code exposes PVE LXC implementation details that should be abstracted or removed:

### 1. In-Memory Metadata Store (REMOVE)

**Location:** `apps/www/lib/utils/pve-lxc-client.ts:234-235`

```typescript
// These expose VM-tech specific state management
private instanceMetadata: Map<number, ContainerMetadata> = new Map();
private instanceServices: Map<number, HttpService[]> = new Map();
```

**Problem:**
- [ ] Metadata doesn't survive server restarts
- [ ] Not provider-agnostic (Convex DB should be single source of truth)
- [ ] Causes inconsistency when multiple backend instances run

### 2. CRIU/Suspend Methods (MARK PRIVATE or REMOVE)

**Location:** `apps/www/lib/utils/pve-lxc-client.ts:662-680`

```typescript
// These expose experimental PVE features
async suspendContainer(vmid: number): Promise<void>
async resumeContainer(vmid: number): Promise<void>
```

**Problem:**
- [ ] CRIU is experimental per PVE docs
- [ ] Not portable to other providers
- [ ] `SandboxInstance.pause()` already abstracts this correctly (falls back to stop)

### 3. CRIU Shell Script (MOVE TO EXPERIMENTAL)

**Location:** `scripts/pve/pve-criu.sh`

**Problem:**
- [ ] 545 lines of CRIU-specific code
- [ ] Requires kernel support not guaranteed
- [ ] Not used by core cmux functionality

### 4. Provider-Specific Capability Assumptions

**Location:** `packages/shared/src/sandbox-presets.ts:61-67`

```typescript
"pve-lxc": {
  supportsHibernate: false,  // Correctly documented
  // ...
}
```

**Status:** ✅ Already correctly abstracted

---

## Implementation Plans (All Complete)

**Update (2026-01-03, Rev 3):** All implementation plans have been completed and verified.

These plans focused on **cmux-specific improvements** that apply regardless of underlying virtualization technology.

### Plan 1: Migrate In-Memory Metadata to Convex (P0) - COMPLETE

**Problem:** Metadata stored in memory doesn't survive restarts and isn't accessible across instances.

**Solution:** Metadata is tracked in Convex `sandboxInstanceActivity` table, not in the PveLxcClient.

**Implementation:**
- [x] Removed `instanceMetadata` Map - only `instanceServices` remains for transient HTTP URLs
- [x] Metadata (teamId, userId, etc.) stored in Convex via `sandboxes.route.ts` calling `recordCreate` mutation
- [x] `sandboxInstanceActivity` table tracks: instanceId, provider, teamId, userId, timestamps
- [x] Comment at `pve-lxc-client.ts:242-244` documents this design decision

**Key Files:**
- `apps/www/lib/utils/pve-lxc-client.ts:242-245` - Comment documenting metadata strategy
- `packages/convex/convex/sandboxInstances.ts` - Activity tracking mutations
- `packages/convex/convex/schema.ts:1138-1159` - `sandboxInstanceActivity` table schema

---

### Plan 2: Clone Failure Rollback (P0) - COMPLETE

**Problem:** If container clone succeeds but start fails, orphaned container remains.

**Solution:** Implemented try/catch with automatic rollback on startup failure.

**Implementation:**
- [x] Wrap `startContainer()` call in try/catch in `instances.start()`
- [x] On failure, call `deleteContainer(newVmid)` to clean up
- [x] Log rollback action for debugging
- [x] Re-throw original error after cleanup

**Location:** `apps/www/lib/utils/pve-lxc-client.ts:860-879`

```typescript
// Start the container with rollback on failure
try {
  await this.startContainer(newVmid);
} catch (startError) {
  // Clone succeeded but start failed - rollback by deleting the container
  console.error(`[PveLxcClient] Failed to start container ${newVmid}, rolling back clone:`, ...);
  try {
    await this.deleteContainer(newVmid);
    console.log(`[PveLxcClient] Rollback complete: container ${newVmid} deleted`);
  } catch (deleteError) {
    console.error(`[PveLxcClient] Failed to rollback (delete) container ${newVmid}:`, ...);
  }
  throw startError;
}
```

---

### Plan 3: Move CRIU Script to Experimental (P1) - COMPLETE

**Problem:** CRIU is experimental and not required for core cmux functionality.

**Solution:** Moved script to experimental directory with README.

**Implementation:**
- [x] Created `scripts/pve/experimental/` directory
- [x] Moved `pve-criu.sh` to experimental folder
- [x] Added README explaining experimental status

**Location:** `scripts/pve/experimental/pve-criu.sh`

---

### Plan 4: Mark Suspend/Resume Methods Private (P1) - COMPLETE

**Problem:** Public suspend/resume methods expose experimental PVE features.

**Solution:** Methods are private with comprehensive JSDoc documenting experimental status.

**Implementation:**
- [x] `suspendContainer()` is private method
- [x] `resumeContainer()` is private method
- [x] No external callers (only internal `pause()`/`resume()` wrappers)
- [x] Comprehensive JSDoc at lines 735-775 noting experimental status, limitations, and PVE docs reference

**Location:** `apps/www/lib/utils/pve-lxc-client.ts:735-783`

JSDoc includes:
- `**EXPERIMENTAL - NOT FOR PRODUCTION USE**` warning
- List of CRIU limitations (kernel support, FUSE incompatibility, freezer issues)
- Reference to official PVE wiki
- `@internal` tag marking as PVE-specific

---

### Plan 5: Container Garbage Collection (P1) - COMPLETE

**Problem:** No TTL enforcement or cleanup of orphaned sandboxes.

**Solution:** Implemented in `sandboxInstanceMaintenance.ts` with cron jobs.

**Implementation:**
- [x] `pauseOldSandboxInstances()` - Pauses containers older than 20 hours
- [x] `stopOldSandboxInstances()` - Stops instances inactive for 14+ days
- [x] `cleanupOrphanedContainers()` - Deletes containers with no activity record
- [x] PVE cleanup integrated via `ProviderClient` interface
- [x] Cron jobs run every 15 minutes for pause, 6 hours for stop/cleanup

**Key Files:**
- `packages/convex/convex/sandboxInstanceMaintenance.ts:450-833` - Maintenance logic
- `packages/convex/convex/crons.ts` - Scheduled job definitions

---

### Plan 6: Health Check Endpoint (P2) - COMPLETE

**Problem:** No way to verify sandbox provider connectivity from frontend.

**Solution:** Implemented `/api/health/sandbox` endpoint with provider-specific checks.

**Implementation:**
- [x] Created `GET /api/health/sandbox` endpoint
- [x] Returns active provider type and status
- [x] Tests PVE API connectivity with `instances.list()` call
- [x] Returns latency measurement (`latencyMs`)
- [x] Includes template availability check (`templatesAvailable`)

**Location:** `apps/www/lib/routes/health.route.ts`

Response format:
```json
{
  "status": "healthy",
  "provider": "pve-lxc",
  "providerStatus": "connected",
  "latencyMs": 45,
  "templatesAvailable": true
}
```

---

### Plan 7: Rate Limiting (P2) - COMPLETE

**Problem:** No protection against rapid sandbox creation.

**Solution:** Implemented sliding window rate limiter middleware.

**Implementation:**
- [x] Created in-memory sliding window rate limiter (no external dependencies)
- [x] Applied to `POST /api/sandboxes/start` route
- [x] Configured per-user/IP limits: 10 containers/hour
- [x] Returns 429 with `Retry-After` header
- [x] Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**Location:** `apps/www/lib/middleware/rate-limit.ts`

Usage at `sandboxes.route.ts:247-250`:
```typescript
sandboxesRouter.use("/sandboxes/start", sandboxCreationRateLimit({
  limit: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
}));
```

---

### Plan 8: Service URL IP Fallback (P3) - COMPLETE

**Problem:** Falls back from public domain to FQDN, but no IP fallback for local dev.

**Solution:** Implemented 3-tier URL resolution with container IP fallback.

**Implementation:**
- [x] `buildServiceUrl()` tries: public URL (Cloudflare Tunnel) > FQDN > container IP
- [x] `getContainerIp()` queries PVE API to extract IP from net0 config
- [x] Logs when using IP fallback for debugging

**Location:** `apps/www/lib/utils/pve-lxc-client.ts:352-377`

```typescript
private async buildServiceUrl(...): Promise<string | null> {
  // 1. Try public URL (Cloudflare Tunnel)
  const publicUrl = this.buildPublicServiceUrl(port, vmid);
  if (publicUrl) return publicUrl;

  // 2. Try FQDN
  if (domainSuffix) return `http://${hostname}${domainSuffix}:${port}`;

  // 3. Fallback to container IP
  const ip = await this.getContainerIp(vmid);
  if (ip) {
    console.log(`[PveLxcClient] Using IP fallback for container ${vmid}: ${ip}`);
    return `http://${ip}:${port}`;
  }
  return null;
}
```

---

### Plan 9: Unit Tests for Snapshot Parsing (P3) - COMPLETE

**Problem:** Edge cases in `parseSnapshotId()` not covered by tests.

**Solution:** Comprehensive test suite with 30 test cases.

**Implementation:**
- [x] Test: Parse `morph_4vcpu_16gb_48gb_v1` correctly
- [x] Test: Parse `pvelxc_4vcpu_6gb_32gb_v1` correctly
- [x] Test: Parse `pvevm_4vcpu_6gb_32gb_v1` correctly
- [x] Test: Handle old `pve_{preset}_{vmid}` format (backwards compatibility)
- [x] Test: Return null for invalid formats (16 test cases)
- [x] Test: Return null for empty/undefined input
- [x] Test: Edge cases (large versions, case sensitivity, etc.)

**Location:** `packages/shared/src/sandbox-presets.test.ts` (160 lines, 30 tests)

Test Categories:
- Unified format parsing (5 tests)
- Backwards compatibility - old PVE format (2 tests)
- Invalid formats (11 tests)
- Edge cases (12 tests)

---

## Implementation Priority Matrix - All Complete

| Priority | Plan | Status | Implementation |
|----------|------|--------|----------------|
| **P0** | Plan 1: Migrate metadata to Convex | COMPLETE | Convex sandboxInstanceActivity table |
| **P0** | Plan 2: Clone failure rollback | COMPLETE | try/catch with deleteContainer |
| **P1** | Plan 3: Move CRIU to experimental | COMPLETE | scripts/pve/experimental/ |
| **P1** | Plan 4: Mark suspend/resume private | COMPLETE | Private with JSDoc |
| **P1** | Plan 5: Container GC | COMPLETE | Cron jobs in maintenance.ts |
| **P2** | Plan 6: Health check endpoint | COMPLETE | /api/health/sandbox |
| **P2** | Plan 7: Rate limiting | COMPLETE | rate-limit.ts middleware |
| **P3** | Plan 8: IP fallback | COMPLETE | buildServiceUrl() 3-tier |
| **P3** | Plan 9: Unit tests | COMPLETE | 30 tests in sandbox-presets.test.ts |

---

## Quick Reference: Beads Issues - All Closed

All planned improvements have been implemented. No outstanding issues for PR #27.

---

## Deep Review: Upstream Alignment & Style Consistency (2026-01-03)

This section documents findings from a comprehensive review using Context7 (Proxmox VE official docs) and DeepWiki (upstream manaflow-ai/cmux patterns).

### Architecture Alignment with Upstream (DeepWiki Analysis)

| Aspect | Morph (Upstream) | PVE LXC (PR #27) | Status |
|--------|------------------|------------------|--------|
| Provider detection | `getActiveSandboxProvider()` | Same function, extended | Aligned |
| Instance wrapper | `wrapMorphInstance()` | `wrapPveLxcInstance()` | Aligned |
| Unified interface | `SandboxInstance` | Same interface | Aligned |
| Snapshot ID format | `morph_{preset}_v{ver}` | `pvelxc_{preset}_v{ver}` | Aligned |
| Capabilities config | `SANDBOX_PROVIDER_CAPABILITIES` | Same pattern | Aligned |
| Maintenance cron | `pauseOldSandboxInstances` | Extended for PVE | Aligned |

**DeepWiki Insight:** The upstream cmux architecture uses a provider-based pattern with:
1. Unified `SandboxInstance` interface
2. Provider-specific wrappers (`wrapMorphInstance`, `wrapPveLxcInstance`)
3. Auto-detection with explicit override via `SANDBOX_PROVIDER`
4. Pluggable `ProviderClient` interface for maintenance

This PR correctly follows all upstream patterns.

### Style Consistency: PVE LXC vs Morph Provider

| Pattern | Morph | PVE LXC | Consistent? |
|---------|-------|---------|-------------|
| Instance ID prefix | `morphvm_` | `pve_lxc_` | Yes |
| Service name pattern | `port-{port}` | `port-{port}` | Yes |
| URL pattern | `port-{port}-morphvm_{id}` | `port-{port}-vm-{vmid}` | Yes |
| Wrapper function | `wrapMorphInstance()` | `wrapPveLxcInstance()` | Yes |
| Client class | `MorphCloudClient` | `PveLxcClient` | Yes |
| Snapshot parsing | `parseSnapshotId()` | Same function | Yes |
| Capability check | `SANDBOX_PROVIDER_CAPABILITIES` | Same object | Yes |

### Environment Variable Minimization Analysis

**Goal:** Minimize required production env vars while maximizing auto-detection.

| Variable | Required? | Auto-Detected? | Morph Equivalent |
|----------|-----------|----------------|------------------|
| `PVE_API_URL` | Yes | No | `MORPH_API_KEY` (combined) |
| `PVE_API_TOKEN` | Yes | No | `MORPH_API_KEY` (combined) |
| `PVE_PUBLIC_DOMAIN` | Yes* | No | Morph provides URLs |
| `PVE_NODE` | No | Yes (first online) | N/A |
| `PVE_STORAGE` | No | Yes (most space) | N/A |
| `PVE_BRIDGE` | No | Yes (vmbr0) | N/A |
| `PVE_GATEWAY` | No | Yes (from bridge) | N/A |
| `PVE_VERIFY_TLS` | No | Yes (false) | N/A |
| `PVE_TEMPLATE_VMID` | No | From snapshot ID | N/A |
| `PVE_IP_POOL_CIDR` | No | Yes (10.100.0.0/24) | N/A |

**Verdict:** Good minimization. Only 3 required for production with Cloudflare Tunnel:
- `PVE_API_URL`
- `PVE_API_TOKEN`
- `PVE_PUBLIC_DOMAIN`

vs Morph's single `MORPH_API_KEY` (but Morph handles URL routing internally).

### Context7 PVE Documentation Findings

Key insights from official Proxmox VE documentation:

1. **`pct suspend` is experimental** - Uses rsync-based backup, NOT true RAM state preservation
2. **No arbitrary metadata API** - PVE only supports `tags` field for container meta-information
3. **CRIU checkpoint limitations:**
   - Requires kernel support and CRIU package on host
   - FUSE mounts incompatible with freeze operations
   - Freezer subsystem can cause I/O deadlocks

4. **Minimal API for lifecycle:**
   ```bash
   # Core operations (all used in pve-lxc-client.ts)
   POST /nodes/{node}/lxc/{vmid}/clone     # Clone container
   POST /nodes/{node}/lxc/{vmid}/status/start
   POST /nodes/{node}/lxc/{vmid}/status/stop
   DELETE /nodes/{node}/lxc/{vmid}         # Delete container
   GET /nodes/{node}/lxc                   # List containers
   ```

### Provider Extensibility Assessment

The architecture correctly enables adding new providers:

```typescript
// 1. Add to SandboxProviderType union
export type SandboxProviderType = "morph" | "pve-lxc" | "pve-vm" | "daytona";

// 2. Define capabilities
SANDBOX_PROVIDER_CAPABILITIES["daytona"] = {
  supportsHibernate: true,
  supportsSnapshots: true,
  // ...
};

// 3. Create wrapper function
export function wrapDaytonaInstance(instance): SandboxInstance { ... }

// 4. Update provider detection
if (env.DAYTONA_API_KEY) return { provider: "daytona", ... };

// 5. Add to maintenance cron
configs.push({
  provider: "daytona",
  client: createDaytonaProviderClient(env.DAYTONA_API_KEY),
  available: true,
});
```

### VM-Tech Specific Code Summary - All Resolved

All virtualization-specific code has been properly abstracted:

| Item | Location | Status | Resolution |
|------|----------|--------|------------|
| In-memory metadata | `pve-lxc-client.ts:242-245` | RESOLVED | Metadata in Convex sandboxInstanceActivity |
| `suspendContainer()` | `pve-lxc-client.ts:753` | RESOLVED | Private + comprehensive JSDoc |
| `resumeContainer()` | `pve-lxc-client.ts:776` | RESOLVED | Private + comprehensive JSDoc |
| `pve-criu.sh` | `scripts/pve/experimental/` | RESOLVED | Moved to experimental directory |

### Final Merge Checklist - All Complete

**Pre-merge (Required):**
- [x] Provider abstraction follows upstream patterns
- [x] URL patterns are Morph-consistent
- [x] Environment variable minimization verified
- [x] Maintenance cron extended for PVE
- [x] All tests passing

**Pre-merge (Recommended):**
- [x] Move `pve-criu.sh` to `scripts/pve/experimental/`
- [x] Add JSDoc to `suspendContainer`/`resumeContainer` noting experimental status

**Post-merge (All Implemented):**
- [x] P0: Migrate in-memory metadata to Convex
- [x] P0: Add clone failure rollback
- [x] P1: Container garbage collection
- [x] P1: Mark suspend/resume private
- [x] P2: Health check endpoint
- [x] P2: Rate limiting
- [x] P3: IP fallback for service URLs
- [x] P3: Unit tests for snapshot parsing

---

## Appendix: Review Methodology

This review used the following tools and sources:

1. **Context7 MCP** - Queried `/proxmox/pve-docs` for official API patterns and LXC limitations
2. **DeepWiki MCP** - Queried `manaflow-ai/cmux` for upstream architecture patterns
3. **Manual code review** - 75 files across TypeScript, Rust, Python, and Shell
4. **PR file diff** - `gh pr view 27 --json files`

### Key Files Reviewed

| Category | Files |
|----------|-------|
| Provider abstraction | `sandbox-provider.ts`, `sandbox-instance.ts`, `pve-lxc-client.ts` |
| Shared types | `sandbox-presets.ts`, `pve-lxc-snapshots.ts` |
| Rust daemon | `pve_lxc.rs`, `models.rs` |
| Maintenance | `sandboxInstanceMaintenance.ts` |
| Environment | `www-env.ts`, `convex-env.ts` |
| Scripts | `pve-criu.sh`, `snapshot-pvelxc.py`, `pve-tunnel-setup.sh`

