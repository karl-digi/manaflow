# PR #27 Review: PVE LXC Sandbox Provider (Refactor Notes)

## Logic Design (Current)

### Provider Abstraction
- `apps/www` exposes a unified sandbox interface for Morph and PVE LXC.
- Provider detection is driven by env vars (Morph API key vs PVE API URL/token).
- The frontend requests presets and defaults from `/api/config/sandbox` and uses the unified response.

### Snapshot Identity
- **Canonical snapshot ID** is always `snapshot_<rand>` regardless of provider.
- Provider context (`snapshotProvider`) is required to resolve a snapshot ID.
- PVE LXC snapshots are **templates** (linked-clone source), not live snapshots.

### PVE LXC Constraints
- **No arbitrary metadata API**: PVE LXC only supports tags. Metadata is stored in Convex.
- **Instance identity**: runtime container hostname must be DNS-safe and stable.
- **Template + linked-clone**: fast provisioning via template VMIDs.

### Instance ID and URLs
- **Instance ID = hostname** for PVE LXC (e.g., `pvelxc-<rand>`).
- **Public URL pattern**: `https://port-{port}-{instanceId}.{publicDomain}`.
- Legacy URL pattern (`port-{port}-vm-{vmid}`) remains as compatibility during migration.

### Cloudflare Tunnel + Caddy
- Cloudflare Tunnel exposes wildcard subdomains.
- Caddy routes `port-{port}-{instanceId}` to `{instanceId}.{domainSuffix}:{port}`.
- Legacy routing for `port-{port}-vm-{vmid}` remains during migration.

---

## Refactor Plan (Current)

### 1) Snapshot Schema + Resolution
- Update PVE LXC snapshot manifest to include `snapshotId: snapshot_<rand>`.
- Preserve `templateVmid` per version for PVE API operations.
- Update shared helpers to resolve `snapshotId` using `snapshotProvider`.
- Keep legacy formats for backward compatibility.

### 2) Environment Snapshot IDs
- Replace `morphSnapshotId` with `snapshotId` + `snapshotProvider`.
- Add fallback reads for legacy data during migration.
- Update environment routes, Convex schema, and client types.

### 3) PVE Instance ID + URL Routing
- Generate `instanceId` as DNS-safe (`pvelxc-<rand>`).
- Set PVE container hostname to `instanceId`.
- Store `instanceId -> vmid -> snapshotId` mapping in Convex.
- Update Caddy config and scripts to support instanceId-based URLs.
- Keep legacy `vmid` URLs during transition.

### 4) UI + Utilities
- Derive Morph URLs only for Morph instance IDs.
- Display-friendly conversions may use underscore for UI, but never for hostnames or URLs.

