# devbox-e2b

E2B-based sandbox environment for cmux. This provides an alternative to Morph Cloud using E2B's sandbox infrastructure.

## Overview

This directory contains scripts and configuration for creating and managing E2B sandbox templates that can run cmux workspaces.

## Prerequisites

- E2B account and API key
- Node.js 20+
- Docker (for building custom templates)

## Environment Setup

Set your E2B API key:

```bash
export E2B_API_KEY="your-api-key"
```

## Creating a Custom Template

E2B templates are built from Dockerfiles. To create a custom cmux template:

1. Build the template:
   ```bash
   cd apps/devbox-e2b
   e2b template build --name cmux-devbox
   ```

2. The template will be available in your E2B dashboard and can be used by setting the `templateId` when creating sandboxes.

## Template Features

The cmux E2B template includes:
- Ubuntu 22.04 base
- Node.js 20
- Bun runtime
- Git and GitHub CLI
- OpenVSCode Server on port 39378
- Worker daemon on port 39377
- Chrome with CDP support (headless)
- Docker support

## Port Mapping

| Service | Port |
|---------|------|
| VSCode | 39378 |
| Worker | 39377 |
| Chrome CDP | 9222 |
| User App | 10000 |

## Scripts

- `scripts/setup_template.sh` - Setup script run inside the template
- `e2b.Dockerfile` - Dockerfile for building the custom template
- `e2b.toml` - E2B template configuration

## Differences from Morph

| Feature | Morph | E2B |
|---------|-------|-----|
| Snapshots | Full VM snapshot | Docker-based templates |
| Pause/Resume | Native | Not supported (extended timeout instead) |
| SSH Access | Native | Via E2B CLI |
| Networking | HTTP services | Port-based host URLs |
