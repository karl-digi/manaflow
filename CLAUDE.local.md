<!-- # Current main task -->

# Style
- Do not use emojis in shell scripts or debug messages

# Git/PR
- All PRs should target `karlorz/cmux:main` unless explicitly requested to submit to upstream `manaflow-ai/manaflow`
- gh repo set-default karlorz/cmux
✓ Set karlorz/cmux as the default repository for the current directory

# Logs
- PVE snapshot helper writes to `logs/snapshot-pvelxc.log`

# Cloudrouter Dev Setup (local or remote workspace)
```bash
# Requires CLOUDROUTER_REFRESH_TOKEN in .env
bun install && make install-cloudrouter-dev && cloudrouter whoami
# Then: make dev (terminal 1), cloudrouter start . (terminal 2)

# Dev build automatically uses cmux-devbox-lite-dev template
cloudrouter start . -p e2b  # uses cmux-devbox-lite-dev (8 GB, dev build default)

# Force production template (if needed)
CLOUDROUTER_DEV_MODE=0 cloudrouter start . -p e2b  # uses cmux-devbox-lite (16 GB)

# Set default sandbox provider in Convex env (optional, default: pve-lxc)
# SANDBOX_PROVIDER=pve-lxc  # or: morph, e2b, modal
```

# Config for Host Machine (not Devcontainer)
- `make convex-fresh`: Fresh Convex setup and start concex service via docker compose, it will delete convex data volume
- `make convex-init`: Init Convex DB using .env
- `make convex-init-prod`: Init Convex DB using .env.production
- `make convex-clear-prod`: *Danger* Reset, Destroy prod convex
- `bun run convex:deploy`: Deploy Convex DB using .env
- `bun run convex:deploy:prod`: Deploy Convex DB using .env.production
- `make dev`: start the project with `./scripts/dev.sh`
- `make dev-electron`: start the project with electron remote debug 

# PVE LXC Sandbox Provider, main pve version 8.4, next version 9.1
- PVE API docs: https://pve.proxmox.com/pve-docs/api-viewer/
- PVE API wiki: https://pve.proxmox.com/wiki/Proxmox_VE_API
- PVE docs repo: https://github.com/proxmox/pve-docs

Required Environment Variables:
- `PVE_API_URL=https://pve.example.com`
- `PVE_API_TOKEN=root@pam!mytoken=12345678-1234-1234-1234-1234567890ab`

# Update PVE LXC snapshot
- `uv run --env-file .env ./scripts/snapshot-pvelxc.py --update --update-vmid <vmid>`

# Create PVE LXC base template (run on PVE host console)
```bash
# One-liner: download and run setup script on PVE host
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000

# Or with custom options
curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000 --memory 8192 --cores 8
```

# Rebuild PVE LXC snapshot (from dev machine)
- `uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000`
- Or with custom options
```bash
# Build snapshots from template (after base template exists on PVE)
uv run --env-file .env ./scripts/snapshot-pvelxc.py \
--template-vmid 9000 \
--standard-vcpus 4 \
--standard-memory 8192 \
--standard-disk-size 32768 \
--boosted-vcpus 6 \
--boosted-memory 8192 \
--boosted-disk-size 40960
```

# Rebuild PVE LXC snapshot use gh
- `gh workflow run "Weekly PVE LXC Snapshot" --repo karlorz/cmux --ref main`

# Rebuild Morph snapshot use gh (production)
- `gh workflow run "Daily Morph Snapshot" --repo karlorz/cmux --ref main`

# Rebuild Morph snapshot (local dev, optional)
```bash
uv run --env-file .env ./scripts/snapshot.py \
--snapshot-id snapshot_7wbqo5jd \
--standard-vcpus 4 \    
--standard-memory 8192 \
--standard-disk-size 32768 \
--boosted-vcpus 6 \
--boosted-memory 8192 \
--boosted-disk-size 32768
```

# Environment Variables (Compact Reference)

## Quick Reference by Provider

### Morph Cloud (Default)
```bash
MORPH_API_KEY=morph_...
```

### PVE LXC (Self-Hosted)
```bash
# Required
PVE_API_URL=https://pve.example.com
PVE_API_TOKEN=root@pam!mytoken=abc123...
PVE_PUBLIC_DOMAIN=example.com  # For Cloudflare Tunnel

# Optional (auto-detected)
# PVE_NODE, PVE_STORAGE, PVE_BRIDGE, PVE_GATEWAY, PVE_VERIFY_TLS
```

### Cloudflare Tunnel (on PVE Host)
```bash
CF_API_TOKEN=...     # Zone:DNS:Edit + Tunnel:Edit permissions
CF_ZONE_ID=...       # From Cloudflare dashboard
CF_ACCOUNT_ID=...    # From Cloudflare dashboard
CF_DOMAIN=example.com
```

## Minimal Local Dev (.env)
```bash
# Convex
CONVEX_DEPLOY_KEY="..."
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud

# Stack Auth
NEXT_PUBLIC_STACK_PROJECT_ID=...
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=pck_...
STACK_SECRET_SERVER_KEY=ssk_...
STACK_SUPER_SECRET_ADMIN_KEY=sk_...
STACK_DATA_VAULT_SECRET=your-32-char-secret
STACK_WEBHOOK_SECRET=whsec_...

# GitHub App
CMUX_GITHUB_APP_ID=1234567
CMUX_GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_APP_WEBHOOK_SECRET=...
INSTALL_STATE_SECRET=...

# AI & JWT
ANTHROPIC_API_KEY=sk-ant-...
CMUX_TASK_RUN_JWT_SECRET=...
BASE_APP_URL=http://localhost:9779

# Sandbox (choose one)
MORPH_API_KEY=morph_...
# OR: PVE_API_URL + PVE_API_TOKEN + PVE_PUBLIC_DOMAIN
```

## Full Reference

For complete environment variable documentation by deployment target, see:
