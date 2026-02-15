# cmux-devbox-lite

Lightweight E2B template for cmux sandboxes **without Docker-in-Docker**.

## Features

- **VSCode** (cmux-code fork with OpenVSIX marketplace)
- **VNC Desktop** (XFCE4 with noVNC web access)
- **JupyterLab** (with common data science packages)
- **Chrome CDP** (headless browser automation)
- **Go Worker Daemon** (API on port 39377)
- **SSH Server** (token-based auth on port 10000)

## What's NOT Included

- Docker daemon
- Docker-in-Docker support
- Container orchestration

## When to Use

Use the **lite** template when you:

- Don't need to run containers inside your sandbox
- Want faster boot times
- Want lower resource overhead
- Are doing code editing, testing, or browser automation

Use the **docker** template when you:

- Need to run Docker containers
- Are developing containerized applications
- Need docker-compose support

## Building

```bash
# Development build (smaller resources, publishes to cmux-devbox-lite-dev)
bun run build:dev

# Production build (full resources, publishes to cmux-devbox-lite)
bun run build:prod
```

> **Note:** Dev and prod builds publish to **different template names** to prevent
> accidentally overwriting production templates with smaller resources during local iteration.

## Manual Build

```bash
cd packages/cloudrouter
e2b template build --config e2b.lite.toml
```

## Template Resources

| Mode | Template Name | vCPUs | Memory | Disk |
|------|---------------|-------|--------|------|
| Dev  | cmux-devbox-lite-dev | 4 | 8 GB | 20 GB |
| Prod | cmux-devbox-lite | 4 | 16 GB | 20 GB |

## Ports

| Port  | Service |
|-------|---------|
| 39377 | Worker API |
| 39378 | VSCode |
| 39380 | VNC (noVNC) |
| 8888  | JupyterLab |
| 9222  | Chrome CDP |
| 10000 | SSH |

## Authentication

All services use the same auth token (generated at boot):

- **Worker API**: Bearer token
- **VSCode**: `?tkn=TOKEN` query param
- **VNC**: `?tkn=TOKEN` query param
- **Jupyter**: `?token=TOKEN` query param
- **SSH**: Token as username
