# PR #27 Review: PVE LXC Sandbox Provider with Cloudflare Tunnel Support

## Summary

This PR adds Proxmox VE (PVE) LXC containers as an alternative sandbox provider to Morph Cloud, enabling self-hosted deployment with Cloudflare Tunnel for public access.

**Stats:** 75 files changed, ~13,300 additions, ~310 deletions

**Update (2025-12-31):** URL pattern refactored to Morph-consistent (`port-{port}-vm-{vmid}.{domain}`)

**Update (2026-01-02):** All scripts verified and tested. URL pattern fixes applied to all provisioning and test scripts.

**Update (2026-01-03):** Comprehensive architecture review completed. Implementation plans added for future improvements.

---

## Review Verdict

| Category | Rating | Notes |
|----------|--------|-------|
| **Architecture** | 5/5 | Clean provider abstraction, extensible design |
| **Code Style** | 5/5 | Follows all CLAUDE.md conventions |
| **Resilience** | 4/5 | Good extension points, needs metadata persistence |
| **Testing** | 4/5 | Good integration tests, could add unit tests |
| **Documentation** | 5/5 | Comprehensive review doc and READMEs |

**Merge Recommendation:** Approve with minor changes - The PR demonstrates good architectural alignment with upstream cmux while enabling self-hosted deployment via PVE LXC. The provider abstraction is well-designed for future extensibility.

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

## Implementation Plans (Future Work)

These plans focus on **cmux-specific improvements** that apply regardless of underlying virtualization technology.

### Plan 1: Container Garbage Collection (HIGH PRIORITY)

**Problem:** No TTL enforcement or cleanup of orphaned sandboxes.

**Solution:** Extend existing `sandboxInstanceMaintenance.ts` cron to handle PVE containers.

**Files to modify:**
- `packages/convex/convex/sandboxInstanceMaintenance.ts` - Add PVE cleanup logic
- `packages/convex/convex/crons.ts` - Ensure cron covers both providers
- `apps/www/lib/utils/pve-lxc-client.ts` - Add `pruneContainers()` method

**Estimated effort:** 2-3 hours

---

### Plan 2: Clone Failure Rollback (HIGH PRIORITY)

**Problem:** If container clone succeeds but start fails, orphaned container remains.

**Location:** `apps/www/lib/utils/pve-lxc-client.ts` - `instances.start()`

**Solution:** Wrap `startContainer()` in try/catch and delete container on failure.

**Estimated effort:** 30 minutes

---

### Plan 3: Health Check Endpoint (MEDIUM PRIORITY)

**Problem:** No way to verify sandbox provider connectivity from frontend.

**Solution:** Add `GET /api/health/sandbox` endpoint returning provider status and latency.

**File:** `apps/www/lib/routes/health.route.ts`

**Estimated effort:** 1-2 hours

---

### Plan 4: Rate Limiting (MEDIUM PRIORITY)

**Problem:** No protection against rapid sandbox creation.

**Solution:** Add per-team rate limits using `hono-rate-limiter` middleware.

**File:** `apps/www/lib/middleware/rate-limit.ts`

**Estimated effort:** 1-2 hours

---

### Plan 5: Service URL IP Fallback (LOW PRIORITY)

**Problem:** Falls back from public domain to FQDN, but no IP fallback for local dev.

**Location:** `apps/www/lib/utils/pve-lxc-client.ts` - `buildServiceUrl()`

**Solution:** Add container IP as third fallback option for local development without DNS.

**Estimated effort:** 1 hour

---

### Plan 6: Unit Tests for Snapshot Parsing (LOW PRIORITY)

**Problem:** Edge cases in `parseSnapshotId()` not covered by tests.

**File:** `packages/shared/src/sandbox-presets.test.ts`

**Test cases needed:**
- Parse morph/pvelxc/pvevm snapshot IDs
- Handle backwards-compatible formats
- Return null for invalid formats

**Estimated effort:** 1 hour

---

## Implementation Priority Matrix

| Priority | Plan | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Plan 2: Clone Failure Rollback | 30min | Prevents orphaned containers |
| **P1** | Plan 1: Container GC | 2-3h | Prevents resource leaks |
| **P2** | Plan 3: Health Check Endpoint | 1-2h | Improves observability |
| **P2** | Plan 4: Rate Limiting | 1-2h | Prevents abuse |
| **P3** | Plan 5: IP Fallback | 1h | Better local dev experience |
| **P3** | Plan 6: Unit Tests | 1h | Improved reliability |

---

## Quick Reference: Beads Issues for Follow-up

```bash
# P0 - Must fix
bd create --title="PVE: Add clone failure rollback" --type=bug --priority=0

# P1 - Should fix soon
bd create --title="PVE: Add container garbage collection" --type=task --priority=1

# P2 - Nice to have
bd create --title="Sandbox: Add health check endpoint" --type=task --priority=2
bd create --title="Sandbox: Add rate limiting" --type=task --priority=2

# P3 - Future work
bd create --title="PVE: Add IP fallback for service URLs" --type=task --priority=3
bd create --title="Shared: Add unit tests for snapshot parsing" --type=task --priority=3
```

