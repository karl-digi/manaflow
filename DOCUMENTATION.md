# Cmux Documentation

**The Open-Source Task Management System for AI Coding Agents**

> "Linear for Claude Code" - A multiplexer that spawns multiple coding agent CLIs in parallel across different tasks.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
  - [Local Mode Installation](#local-mode-installation)
  - [Cloud Mode Setup](#cloud-mode-setup)
- [Core Concepts](#core-concepts)
  - [What is Cmux?](#what-is-cmux)
  - [Local vs Cloud Mode](#local-vs-cloud-mode)
- [Core Features](#core-features)
  - [Multiplexing Behavior](#multiplexing-behavior)
  - [Session Management](#session-management)
  - [Supported Models & Providers](#supported-models--providers)
  - [Project/Workspace Structure](#projectworkspace-structure)
- [CLI Reference](#cli-reference)
  - [Commands](#commands)
  - [Flags & Options](#flags--options)
- [Configuration & Settings](#configuration--settings)
  - [API Keys Configuration](#api-keys-configuration)
  - [Workspace Settings](#workspace-settings)
  - [Container Settings](#container-settings)
  - [Environment Configuration](#environment-configuration)
- [Local vs Cloud Mode Deep Dive](#local-vs-cloud-mode-deep-dive)
  - [Feature Parity Matrix](#feature-parity-matrix)
  - [Data Flow Diagrams](#data-flow-diagrams)
  - [Storage & Persistence](#storage--persistence)
  - [Security Considerations](#security-considerations)
- [Integrations](#integrations)
  - [Git Integration](#git-integration)
  - [GitHub Integration](#github-integration)
  - [Docker Integration](#docker-integration)
  - [Model Providers](#model-providers)
- [Troubleshooting](#troubleshooting)
  - [Common Errors](#common-errors)
  - [Diagnostic Commands](#diagnostic-commands)
  - [Known Issues](#known-issues)
- [Guides & Recipes](#guides--recipes)
  - [Local Development Setup](#local-development-setup)
  - [Adding a New Agent Provider](#adding-a-new-agent-provider)
  - [Custom Environment Templates](#custom-environment-templates)
- [Architecture Reference](#architecture-reference)
  - [Project Structure](#project-structure)
  - [Technology Stack](#technology-stack)
  - [API Endpoints](#api-endpoints)
- [Versioning & Changelog](#versioning--changelog)

---

## Overview

### What is Cmux?

Cmux is an open-source task management system for AI coding agents. It allows you to:

- **Run multiple coding agents in parallel** on different tasks (Claude Code, Codex, Gemini, Cursor, Amp, OpenCode, etc.)
- **Provide isolated workspace environments** using Docker containers (local mode) or cloud sandboxes (cloud mode)
- **Track task execution** and compare outputs from different agents
- **Manage git workflows** with automatic worktree creation, branching, and PR generation
- **Monitor progress** through a web-based UI with real-time updates and diffs

### Key Use Cases

1. **Agent Comparison**: Test the same task across multiple AI coding agents to find the best solution
2. **Parallel Development**: Work on multiple features/fixes simultaneously in isolated environments
3. **Automated Workflows**: Set up tasks that automatically create PRs when completed
4. **Team Collaboration**: Share task results and compare agent performance across your team

### Supported Platforms

- **OS**: macOS, Linux
- **Execution Modes**: Local (Docker), Cloud (Morph, Daytona)
- **Agents**: Claude Code, Codex, Gemini, Cursor, Amp, OpenCode, and custom agents

---

## Quick Start

### Local Mode Installation

**Requirements:**
- Node.js 18+ (Node 24+ recommended)
- Docker Desktop (running)
- Git 2.30+
- GitHub account (for authentication)

**Installation:**

```bash
# Install cmux globally
npm install -g cmux

# Or using bun
bun install -g cmux

# Or using yarn
yarn global add cmux
```

**First Run:**

```bash
# Start cmux (optionally provide a repository path)
cmux [path/to/repository]

# Or just
cmux
```

On first run, Cmux will:
1. Check Docker installation and daemon status
2. Extract the bundled Convex backend to `~/.cmux/`
3. Start the Convex backend on port 9777
4. Start the web server on port 9776
5. Open your browser to http://localhost:9776

**Quick Setup:**
1. Add your API keys in the Settings panel (Anthropic, OpenAI, etc.)
2. Connect a GitHub repository
3. Create your first task and select agents to run
4. Watch the agents work in parallel!

### Cloud Mode Setup

**Requirements:**
- Cmux account (sign up at https://cmux.app)
- API keys for your preferred model providers
- GitHub account for repository access

**Setup Steps:**

1. **Create an Account:**
   - Visit https://cmux.app and sign up
   - Choose your authentication method (GitHub, Google, etc.)

2. **Configure Cloud Environments:**
   - Navigate to Settings → Environments
   - Create environment templates with:
     - Base image (e.g., `ubuntu:24.04`)
     - Development scripts (install tools, configure environment)
     - Exposed ports
     - Environment variables

3. **Add API Keys:**
   - Go to Settings → API Keys
   - Add keys for Anthropic, OpenAI, Google, etc.
   - Keys are encrypted and stored securely

4. **Connect Repository:**
   - Link your GitHub repository
   - Grant necessary permissions for PR creation

5. **Create Cloud Workspace:**
   - Create a new task
   - Select "Cloud Mode" when spawning agents
   - Choose your environment template
   - Agents will run in provisioned cloud sandboxes

**Account Management:**
- **Regions**: Currently supports US regions (expandable)
- **Quotas**: Check your plan for concurrent workspace limits
- **Billing**: Free tier available; see pricing page for details

---

## Core Concepts

### What is Cmux?

Cmux (pronounced "see-mux") is a **multiplexer for AI coding agents**. Think of it as:
- **Linear** for managing coding tasks
- **tmux** for managing multiple agent sessions
- **GitHub Actions** for automated git workflows

**Core Philosophy:**
- **Isolation**: Each agent runs in its own environment with its own git branch
- **Parallelism**: Run multiple agents simultaneously to compare approaches
- **Automation**: Automatic branch creation, PR generation, and cleanup
- **Transparency**: See exactly what each agent is doing in real-time

### Local vs Cloud Mode

Cmux supports two execution modes with different tradeoffs:

#### Local Mode (Docker-based)

**How it Works:**
- Spawns Docker containers on your local machine
- Each task run gets its own container with VS Code serve-web
- Uses git worktrees for branch isolation
- Containers are managed through Docker Engine API

**Advantages:**
- ✅ Full control over execution environment
- ✅ No external dependencies or cloud costs
- ✅ Faster startup for simple tasks
- ✅ Works completely offline (except model API calls)
- ✅ Direct access to container filesystem

**Disadvantages:**
- ❌ Limited by local machine resources
- ❌ Requires Docker Desktop (can be resource-heavy)
- ❌ Manual container cleanup needed
- ❌ Slower with many concurrent tasks

**Implementation Details:**
- Class: `DockerVSCodeInstance` (server/src/vscode/DockerVSCodeInstance.ts)
- Image: `cmux-worker` (built from apps/worker/)
- Port allocation: Dynamic (39375-39380+ per container)
- Storage: Local Docker volumes + git worktrees

#### Cloud Mode (Morph/Daytona-based)

**How it Works:**
- Provisions cloud sandboxes via API (Morph, Daytona)
- Each task run gets a fresh cloud environment
- Uses branch-based git workflow (no worktrees)
- Environments can be pre-configured with snapshots

**Advantages:**
- ✅ Scales to many concurrent tasks
- ✅ No local resource constraints
- ✅ Pre-configured environments with snapshots
- ✅ Automatic cleanup and lifecycle management
- ✅ Access from anywhere

**Disadvantages:**
- ❌ Requires internet connection
- ❌ May incur cloud costs
- ❌ Slightly slower startup (provisioning time)
- ❌ Less direct control over environment

**Implementation Details:**
- Class: `CmuxVSCodeInstance` (server/src/vscode/CmuxVSCodeInstance.ts)
- Providers: Morph (primary), Daytona (in development)
- API: www service handles provisioning
- Storage: Cloud provider storage + git branches

---

## Core Features

### Multiplexing Behavior

**Task Execution Flow:**

```
User creates task
    ↓
Selects multiple agents (e.g., Claude, Codex, Gemini)
    ↓
System spawns agents in parallel
    ↓
Each agent gets:
    - Isolated git branch/worktree
    - Own workspace (Docker container or cloud sandbox)
    - Socket.IO connection for real-time communication
    ↓
Agents work simultaneously
    ↓
Results aggregated and compared
```

**Routing Strategy:**
- Each agent runs in complete isolation
- No shared state between agents
- Git branches ensure code isolation
- Socket.IO channels for separate communication streams

**Execution Isolation:**
- **Filesystem**: Separate git worktree or branched repository
- **Network**: Unique port mappings per container
- **Process**: Isolated Docker container or cloud sandbox
- **Git**: Separate branch for each task run

**Completion Detection:**
- File watching for changes (local mode)
- Terminal idle detection (configurable timeout)
- Explicit completion signals from agents
- Manual marking by user

### Session Management

**Session Lifecycle:**

1. **Creation**:
   - Task run record created in Convex database
   - Unique branch name generated: `cmux-<descriptive>-<hash>`
   - Git worktree created (local) or branch checked out (cloud)
   - Workspace provisioned (Docker container or cloud sandbox)
   - Agent command executed with task prompt

2. **Active**:
   - Real-time terminal output streamed via Socket.IO
   - File changes monitored and tracked
   - Git commits tracked automatically
   - Status updates sent to UI

3. **Completion**:
   - Agent signals completion or timeout reached
   - Final diff generated
   - Results saved to database
   - Container stopped (if configured) or kept alive

4. **Cleanup**:
   - Scheduled cleanup based on container settings
   - Idle containers stopped after review period
   - Docker containers removed (optional)
   - Worktrees deleted when no longer needed

**Session Persistence:**
- Container mappings stored in Convex database
- Containers can be kept alive with `keepAlive` flag
- Last accessed time tracked for idle detection
- Cleanup runs every 30 seconds (configurable)

**Container Limits:**
- Maximum concurrent containers: 5 (default, configurable)
- Review period: 60 minutes (default)
- Auto-cleanup: Enabled by default
- Minimum containers to keep: 0 (always cleanup when limit reached)

### Supported Models & Providers

Cmux supports 31+ model configurations across 8 providers:

#### Anthropic (Claude Code)
- `claude/haiku-4.5` - Fast, cost-effective
- `claude/sonnet-4.5` - Balanced performance (recommended)
- `claude/sonnet-4` - Previous generation
- `claude/opus-4` - Most capable
- `claude/opus-4.1` - Latest flagship

**Environment Variable:** `ANTHROPIC_API_KEY`

#### OpenAI (Codex)
- `codex/gpt-5` (variants: high/medium/low/minimal reasoning)
- `codex/gpt-5-codex-*` - Codex-optimized variants
- `codex/o3` - Reasoning model
- `codex/o4-mini` - Lightweight
- `codex/gpt-4.1` - Latest GPT-4

**Environment Variable:** `OPENAI_API_KEY`

#### Google (Gemini)
- `gemini/2.5-flash` - Fast responses
- `gemini/2.5-pro` - Best quality

**Environment Variable:** `GEMINI_API_KEY`

#### Cursor
- `cursor/opus-4.1` - Claude Opus via Cursor
- `cursor/gpt-5` - GPT-5 via Cursor
- `cursor/sonnet-4` - Claude Sonnet via Cursor
- `cursor/sonnet-4-thinking` - With reasoning

**Environment Variable:** `CURSOR_API_KEY`

#### Amp
- `amp/gpt-5` - GPT-5 via Amp

**Environment Variable:** `AMP_API_KEY`

#### OpenCode
Multiple models including:
- Grok variants
- Kimi
- Qwen (coder/plus/turbo)
- Custom models

**Environment Variable:** `OPENCODE_API_KEY`

#### Qwen (OpenRouter & Model Studio)
- Various Qwen model variants via different providers

**Environment Variables:** `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`

#### Custom Agents

You can add custom agents by extending the provider configuration. See [Adding a New Agent Provider](#adding-a-new-agent-provider) for details.

### Project/Workspace Structure

#### Local Mode (Git Worktrees)

```
~/.cmux/
├── worktrees/
│   └── <repository-name>/
│       ├── main/                    # Main worktree (tracking main branch)
│       ├── cmux-add-feature-a1b2/   # Task run 1 worktree
│       ├── cmux-fix-bug-c3d4/       # Task run 2 worktree
│       └── ...
├── convex-backend/                  # Self-hosted Convex
├── static/                          # Web UI assets
└── cmux.log                         # Application logs
```

**Branch Naming Convention:**
- Format: `cmux-<descriptive-slug>-<unique-hash>`
- Descriptive slug: Derived from task description (e.g., "add-authentication")
- Hash: Short hash of task description + timestamp
- Collision avoidance: Automatic suffix added if branch exists

#### Cloud Mode (Branch-based)

```
Repository (on cloud provider):
├── main                             # Main branch
├── cmux-add-feature-a1b2           # Task run 1 branch
├── cmux-fix-bug-c3d4               # Task run 2 branch
└── ...

Cloud Sandbox:
/workspace/
├── repository/                      # Cloned repository (on task branch)
├── .vscode/                         # VS Code settings
└── ...
```

#### Docker Container Structure (Local Mode)

```
Container: cmux-<taskRunId>

Filesystem:
/root/
├── workspace/                       # Repository root (git worktree)
├── prompt/                          # Directory for image files from prompts
├── .config/                         # VS Code configuration
│   └── Code/
│       └── User/
│           └── settings.json
├── .local/                          # CLI binaries
│   └── bin/
│       ├── cursor-agent
│       ├── claude-code
│       └── ...
└── .bashrc                          # Shell configuration

Exposed Ports:
- 39375 → VS Code serve-web
- 39378 → Worker Socket.IO server
- 39377 → Extension server
- 39376 → Proxy server
- 39379 → VNC (optional)
- 39380+ → Additional application ports
```

---

## CLI Reference

### Commands

#### `cmux [path] [options]`

Main command to start the Cmux server.

**Arguments:**
- `[path]` - Optional path to a git repository (will be set as default workspace)

**Options:**
- `-p, --port <port>` - Port to listen on (default: 9776)
- `-c, --cors <origin>` - CORS configuration (default: true)
- `--no-autokill-ports` - Disable automatic port killing before startup

**Examples:**

```bash
# Start with default settings
cmux

# Start with a specific repository
cmux ~/projects/my-repo

# Start on custom port
cmux --port 8080

# Start with CORS disabled
cmux --cors false

# Start without killing existing processes on port
cmux --no-autokill-ports
```

**First Run Behavior:**
1. Checks Docker installation and daemon status
2. Extracts bundled Convex binary to `~/.cmux/convex-backend/`
3. Extracts static web assets to `~/.cmux/static/`
4. Starts self-hosted Convex backend on port 9777
5. Starts Express + Socket.IO server on port 9776
6. Opens browser to http://localhost:9776
7. If `[path]` provided, sets as default repository

#### `cmux uninstall`

Remove Cmux data and display uninstall instructions.

**What it does:**
- Removes `~/.cmux/` directory
- Displays instructions to uninstall the npm package
- Shows instructions to remove Docker images

**Example:**

```bash
cmux uninstall
```

### Flags & Options

| Flag | Description | Default | Type |
|------|-------------|---------|------|
| `-p, --port <port>` | HTTP server port | 9776 | number |
| `-c, --cors <origin>` | CORS configuration | true | boolean/string |
| `--no-autokill-ports` | Skip port cleanup | false | boolean |
| `[path]` | Repository path | current directory | string |

**Environment Variables:**

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | For Claude agents |
| `OPENAI_API_KEY` | OpenAI API key for Codex models | For Codex agents |
| `GEMINI_API_KEY` | Google API key for Gemini models | For Gemini agents |
| `CURSOR_API_KEY` | Cursor API key | For Cursor agents |
| `AMP_API_KEY` | Amp API key | For Amp agents |
| `OPENCODE_API_KEY` | OpenCode API key | For OpenCode agents |
| `OPENROUTER_API_KEY` | OpenRouter API key | For OpenRouter models |
| `DEBUG` | Enable debug logging | No |
| `PORT` | Override default port | No |

---

## Configuration & Settings

### API Keys Configuration

API keys are stored in Convex and can be scoped per-team or per-user.

**Storage Location:**
- Database: Convex `apiKeys` table
- Encryption: AES-256 in cloud mode, plaintext in local database

**Adding API Keys (UI):**
1. Open Cmux web interface
2. Navigate to Settings → API Keys
3. Click "Add API Key"
4. Select provider and enter key
5. Save

**Adding API Keys (Environment Variables):**

```bash
# Add to ~/.bashrc, ~/.zshrc, or equivalent
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
```

**Schema:**

```typescript
{
  provider: string;           // e.g., "anthropic", "openai"
  key: string;                // Encrypted API key
  teamId?: Id<"teams">;      // Optional team scope
  userId?: string;            // Optional user scope
  createdAt: number;
  updatedAt: number;
}
```

### Workspace Settings

Configure per-repository workspace behavior.

**Settings:**

| Setting | Description | Default | Type |
|---------|-------------|---------|------|
| `worktreePath` | Custom path for git worktrees | `~/.cmux/worktrees/<repo>` | string |
| `autoPrEnabled` | Auto-create PR for winning agent | false | boolean |
| `nextLocalWorkspaceSequence` | Counter for unique workspace naming | 1 | number |

**Configuration (UI):**
1. Open repository settings
2. Navigate to Workspace tab
3. Modify settings
4. Save changes

**Configuration (Database):**

```typescript
// Stored in Convex `workspaceSettings` table
{
  repositoryId: Id<"repositories">;
  worktreePath?: string;
  autoPrEnabled?: boolean;
  nextLocalWorkspaceSequence?: number;
}
```

### Container Settings

Configure Docker container behavior (local mode only).

**Settings:**

| Setting | Description | Default | Type |
|---------|-------------|---------|------|
| `maxRunningContainers` | Maximum concurrent containers | 5 | number |
| `reviewPeriodMinutes` | Idle time before cleanup consideration | 60 | number |
| `autoCleanupEnabled` | Enable automatic cleanup | true | boolean |
| `stopImmediatelyOnCompletion` | Stop containers immediately after completion | false | boolean |
| `minContainersToKeep` | Minimum containers to keep running | 0 | number |

**Configuration (UI):**
1. Open Settings → Containers
2. Adjust settings
3. Save changes

**Configuration (Database):**

```typescript
// Stored in Convex `containerSettings` table
{
  teamId?: Id<"teams">;
  maxRunningContainers?: number;
  reviewPeriodMinutes?: number;
  autoCleanupEnabled?: boolean;
  stopImmediatelyOnCompletion?: boolean;
  minContainersToKeep?: number;
}
```

**Cleanup Logic:**
- Runs every 30 seconds
- Checks containers exceeding review period
- Stops idle containers if limit exceeded
- Respects `minContainersToKeep` setting
- Skips containers with `keepAlive` flag

### Environment Configuration

Configure cloud environment templates (cloud mode only).

**Environment Structure:**

```typescript
{
  name: string;                    // Display name
  description?: string;            // Description
  morphSnapshotId?: string;        // Morph snapshot ID
  devScript?: string;              // Script run on creation
  maintenanceScript?: string;      // Script run periodically
  exposedPorts?: number[];         // Ports to expose
  teamId?: Id<"teams">;           // Team scope
}
```

**Creating Environment Template (UI):**
1. Navigate to Settings → Environments
2. Click "Create Environment"
3. Configure:
   - **Name**: Descriptive name (e.g., "Node.js 24 + Python")
   - **Snapshot ID**: Morph snapshot ID (optional)
   - **Dev Script**: Installation/setup commands
   - **Maintenance Script**: Health check commands
   - **Exposed Ports**: Ports to expose (e.g., 3000, 8080)
4. Save template

**Example Dev Script:**

```bash
#!/bin/bash
# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Install global tools
npm install -g pnpm bun

# Install Claude Code
curl -sSL https://claude.ai/cli/install.sh | sh
```

**Environment Variables:**
- Stored encrypted in StackAuth DataBook
- Accessed via `process.env` in sandbox
- Can include API keys and secrets

---

## Local vs Cloud Mode Deep Dive

### Feature Parity Matrix

| Feature | Local Mode | Cloud Mode | Notes |
|---------|-----------|-----------|-------|
| **Execution** |
| Docker containers | ✅ | ❌ | Local only |
| Cloud sandboxes | ❌ | ✅ | Cloud only |
| Concurrent tasks | Limited (5 default) | Scalable | Based on resources |
| **Git Integration** |
| Worktrees | ✅ | ❌ | Local only |
| Branches | ✅ | ✅ | Both modes |
| Automatic PR creation | ✅ | ✅ | Both modes |
| **Storage** |
| Local filesystem | ✅ | ❌ | Direct access |
| Cloud storage | ❌ | ✅ | API access |
| **Persistence** |
| Container lifecycle | Manual/scheduled | Automatic | Cleanup behavior |
| Database (Convex) | Local | Cloud | Deployment target |
| **Security** |
| Isolation | Docker containers | VM/containers | Provider-dependent |
| API key storage | Local database | Encrypted cloud | Encryption level |
| Network access | Full | Configurable | Depends on provider |
| **Cost** |
| Infrastructure | Free (uses local) | Varies | Provider pricing |
| Resource limits | Machine-dependent | Plan-dependent | Scalability |
| **Performance** |
| Startup time | ~5-10s | ~30-60s | Provisioning overhead |
| Execution speed | Full speed | Network-dependent | Latency factors |
| **Monitoring** |
| Real-time logs | ✅ | ✅ | Socket.IO streaming |
| File watching | ✅ | ✅ | Both modes |
| Terminal output | ✅ | ✅ | Both modes |
| **Configuration** |
| Environment templates | ❌ | ✅ | Cloud only |
| Custom Docker images | ✅ | ❌ | Local only |
| **Offline Support** |
| Works offline | ✅ (except API) | ❌ | Internet required |

### Data Flow Diagrams

#### Local Mode Data Flow

```
┌─────────────────┐
│   User (UI)     │
└────────┬────────┘
         │ HTTP/WebSocket
         ▼
┌─────────────────┐
│  Express +      │
│  Socket.IO      │
│  (port 9776)    │
└────────┬────────┘
         │
         ├─────────────────────┐
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│  Convex         │   │  Dockerode      │
│  (port 9777)    │   │  (Docker API)   │
└─────────────────┘   └────────┬────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Container 1    │   │  Container 2    │   │  Container N    │
│  cmux-task1     │   │  cmux-task2     │   │  cmux-taskN     │
│  ┌───────────┐  │   │  ┌───────────┐  │   │  ┌───────────┐  │
│  │ VS Code   │  │   │  │ VS Code   │  │   │  │ VS Code   │  │
│  │ Server    │  │   │  │ Server    │  │   │  │ Server    │  │
│  └─────┬─────┘  │   │  └─────┬─────┘  │   │  └─────┬─────┘  │
│        │        │   │        │        │   │        │        │
│  ┌─────▼─────┐  │   │  ┌─────▼─────┐  │   │  ┌─────▼─────┐  │
│  │  Worker   │  │   │  │  Worker   │  │   │  │  Worker   │  │
│  │ Socket.IO │  │   │  │ Socket.IO │  │   │  │ Socket.IO │  │
│  └─────┬─────┘  │   │  └─────┬─────┘  │   │  └─────┬─────┘  │
│        │        │   │        │        │   │        │        │
│  ┌─────▼─────┐  │   │  ┌─────▼─────┐  │   │  ┌─────▼─────┐  │
│  │Agent CLI  │  │   │  │Agent CLI  │  │   │  │Agent CLI  │  │
│  │(claude)   │  │   │  │(codex)    │  │   │  │(gemini)   │  │
│  └───────────┘  │   │  └───────────┘  │   │  └───────────┘  │
│                 │   │                 │   │                 │
│  /root/workspace│   │  /root/workspace│   │  /root/workspace│
│  (worktree)     │   │  (worktree)     │   │  (worktree)     │
└─────────────────┘   └─────────────────┘   └─────────────────┘
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                               ▼
                    ┌─────────────────┐
                    │  Git Worktrees  │
                    │  ~/.cmux/       │
                    │  worktrees/     │
                    └─────────────────┘
```

#### Cloud Mode Data Flow

```
┌─────────────────┐
│   User (UI)     │
└────────┬────────┘
         │ HTTPS/WebSocket
         ▼
┌─────────────────┐
│  Cmux Cloud     │
│  (cmux.app)     │
└────────┬────────┘
         │
         ├─────────────────────┐
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│  Convex Cloud   │   │  WWW Service    │
│  (Database)     │   │  (API)          │
└─────────────────┘   └────────┬────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Morph Sandbox 1 │   │ Morph Sandbox 2 │   │ Morph Sandbox N │
│ (task1)         │   │ (task2)         │   │ (taskN)         │
│  ┌───────────┐  │   │  ┌───────────┐  │   │  ┌───────────┐  │
│  │   Repo    │  │   │  │   Repo    │  │   │  │   Repo    │  │
│  │  (branch) │  │   │  │  (branch) │  │   │  │  (branch) │  │
│  └───────────┘  │   │  └───────────┘  │   │  └───────────┘  │
│  ┌───────────┐  │   │  ┌───────────┐  │   │  ┌───────────┐  │
│  │Agent CLI  │  │   │  │Agent CLI  │  │   │  │Agent CLI  │  │
│  │(claude)   │  │   │  │(codex)    │  │   │  │(gemini)   │  │
│  └───────────┘  │   │  └───────────┘  │   │  └───────────┘  │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                               ▼
                    ┌─────────────────┐
                    │  GitHub Repo    │
                    │  (branches)     │
                    └─────────────────┘
```

### Storage & Persistence

#### Local Mode Storage

**File Locations:**

```
~/.cmux/
├── convex-backend/              # Self-hosted Convex
│   ├── convex.json
│   ├── convex/                  # Convex functions
│   └── .convex/                 # Convex data
│       └── local.db             # SQLite database
├── static/                      # Web UI assets
├── worktrees/                   # Git worktrees
│   └── <repository-name>/
│       ├── main/
│       └── cmux-*/
└── cmux.log                     # Application logs

/var/lib/docker/                 # Docker data
└── volumes/
    └── cmux-*/                  # Container volumes
```

**Persistence Strategy:**
- Convex data in local SQLite database
- Git worktrees persist until manually deleted
- Docker volumes cleaned up with containers
- Logs rotated automatically

**Backup Recommendations:**
- `~/.cmux/convex-backend/.convex/local.db` - Database
- `~/.cmux/worktrees/` - Working code (optional, can rebuild from git)

#### Cloud Mode Storage

**Storage Locations:**
- Convex data in cloud Convex deployment
- Git repositories on cloud provider (Morph, Daytona)
- API keys encrypted in StackAuth DataBook
- Container state managed by cloud provider

**Persistence Strategy:**
- Database automatically backed up by Convex
- Sandboxes destroyed after completion
- Git branches persist in repository
- Cleanup triggered by lifecycle policies

**Data Residency:**
- Primary region: US (configurable)
- Convex: AWS us-east-1
- Morph: Configurable regions

### Security Considerations

#### Local Mode Security

**Isolation:**
- Docker container isolation (namespace, cgroups)
- Separate git worktrees prevent code conflicts
- Network isolation via Docker networks
- Process isolation within containers

**API Key Storage:**
- Stored in plaintext in local Convex SQLite
- File permissions: 0600 (user read/write only)
- Environment variables in container scope only
- Not committed to git repositories

**Network Security:**
- Server binds to localhost only by default
- CORS configurable (default: allow all)
- No external network exposure required
- Docker networks isolated per task

**Access Control:**
- No built-in authentication (runs locally)
- File system permissions enforce access
- Docker socket requires sudo or docker group

**Recommendations:**
- Keep Docker daemon updated
- Use firewall to block port 9776 from external access
- Store API keys in environment variables (not config files)
- Regular cleanup of stopped containers

#### Cloud Mode Security

**Isolation:**
- VM or container-level isolation by provider
- Separate sandboxes per task run
- Network policies enforced by provider
- Storage encryption at rest

**API Key Storage:**
- AES-256 encryption via StackAuth DataBook
- Keys never logged or displayed in UI
- Transmitted over HTTPS only
- Scoped to team or user

**Authentication & Authorization:**
- StackAuth for user authentication
- OAuth for GitHub integration
- JWT tokens for API access
- Role-based access control (RBAC)

**Network Security:**
- All traffic over HTTPS (TLS 1.3)
- WebSocket over secure connection
- Cloud provider network policies
- No direct sandbox access (API only)

**Compliance:**
- SOC 2 Type II (cloud provider dependent)
- GDPR compliant (data residency options)
- Encryption in transit and at rest

**Recommendations:**
- Enable 2FA on Cmux account
- Use team API keys (not personal)
- Regularly rotate API keys
- Review access logs periodically
- Use environment variables for secrets (not hardcoded)

---

## Integrations

### Git Integration

Cmux has deep git integration for managing code across parallel agent tasks.

**Managed by:** `RepositoryManager` class (server/src/git/RepositoryManager.ts)

**Features:**

1. **Worktree Management** (Local Mode):
   - Automatic creation of git worktrees for each task
   - Cleanup of abandoned worktrees
   - Collision-resistant branch naming

2. **Branch Management**:
   - Automatic branch creation with descriptive names
   - Branch tracking and synchronization
   - Merge base detection for accurate diffs

3. **Commit Tracking**:
   - Real-time commit monitoring
   - Automatic commit parsing and attribution
   - Diff generation per commit

4. **Operation Queuing**:
   - Thread-safe git operations via queue
   - Prevents race conditions
   - Ensures operation ordering

**API:**

```typescript
class RepositoryManager {
  // Worktree operations
  createWorktree(branchName: string): Promise<string>
  deleteWorktree(worktreePath: string): Promise<void>
  listWorktrees(): Promise<Worktree[]>

  // Branch operations
  createBranch(branchName: string, baseBranch?: string): Promise<void>
  deleteBranch(branchName: string, force?: boolean): Promise<void>
  switchBranch(branchName: string): Promise<void>

  // Commit operations
  getCommits(branchName: string, limit?: number): Promise<Commit[]>
  getDiff(branchName: string, baseBranch?: string): Promise<string>

  // Repository info
  getCurrentBranch(): Promise<string>
  getRemoteUrl(): Promise<string>
  getMergeBase(branch1: string, branch2: string): Promise<string>
}
```

**Configuration:**

| Setting | Description | Default |
|---------|-------------|---------|
| `worktreePath` | Base path for worktrees | `~/.cmux/worktrees/<repo>` |
| `mainBranch` | Main branch name | `main` (auto-detected) |
| `remoteUrl` | Git remote URL | Auto-detected from repo |

**Common Operations:**

```bash
# List all worktrees
git worktree list

# View branches created by cmux
git branch | grep cmux-

# Clean up merged branches
git branch --merged main | grep cmux- | xargs git branch -d

# View diff for a cmux branch
git diff main...cmux-add-feature-a1b2
```

**Troubleshooting:**

- **Error: "worktree already exists"**
  - Solution: Delete existing worktree with `git worktree remove <path>`

- **Error: "branch already exists"**
  - Solution: Cmux automatically adds suffix; manual intervention needed if persists

- **Worktrees out of sync**
  - Solution: Run `git worktree prune` to clean up

### GitHub Integration

**Managed by:** `octokit` client and GitHub CLI integration

**Features:**

1. **Authentication**:
   - GitHub CLI authentication (`gh auth login`)
   - OAuth token retrieval from keychain
   - Fallback to environment variable (`GITHUB_TOKEN`)

2. **Pull Request Management**:
   - Automatic PR creation from completed tasks
   - Draft PR support
   - PR state synchronization
   - Auto-merge option for "crowned" solutions

3. **Repository Operations**:
   - Repository cloning and initialization
   - Branch push/pull
   - Webhook registration for events

4. **Team Collaboration**:
   - Multi-user task assignments
   - PR review workflows
   - Comment integration

**API:**

```typescript
// PR creation
async function createPullRequest(params: {
  repositoryId: Id<"repositories">;
  branchName: string;
  title: string;
  body: string;
  draft?: boolean;
}): Promise<PullRequest>

// PR update
async function updatePullRequest(params: {
  pullRequestId: Id<"pullRequests">;
  state?: "open" | "closed" | "merged";
  draft?: boolean;
}): Promise<void>

// Webhook setup
async function registerWebhook(
  repositoryId: Id<"repositories">,
  events: string[]
): Promise<Webhook>
```

**Configuration:**

- **Repository Settings** (UI → Repository → GitHub):
  - Enable auto-PR creation
  - Set PR template
  - Configure branch protection

**Auto-PR Flow:**

1. Task marked complete by agent
2. User "crowns" winning solution (or auto-crown if only one)
3. Cmux creates PR with:
   - Title from task description
   - Body with agent details and summary
   - Draft mode (user can convert to ready)
4. PR link displayed in UI
5. Optional: Auto-merge after checks pass

**Troubleshooting:**

- **Error: "GitHub CLI not authenticated"**
  - Solution: Run `gh auth login` in terminal

- **Error: "Permission denied"**
  - Solution: Grant Cmux app permissions on GitHub settings

- **Webhooks not working**
  - Solution: Check firewall allows incoming connections to port 9776

### Docker Integration

**Managed by:** `dockerode` library wrapper

**Features:**

1. **Container Lifecycle**:
   - Image building from `apps/worker/Dockerfile`
   - Container creation with auto-generated names
   - Start/stop/restart operations
   - Automatic cleanup scheduling

2. **Port Management**:
   - Dynamic port allocation (39375-39380+)
   - Port conflict detection and resolution
   - Mapping cache for fast lookups

3. **Event Monitoring**:
   - Real-time container events via Docker API
   - State synchronization with database
   - Crash detection and recovery

4. **Resource Limits**:
   - Configurable CPU/memory limits
   - Concurrent container limits
   - Automatic scaling down when idle

**API:**

```typescript
class DockerVSCodeInstance {
  // Lifecycle
  async create(config: ContainerConfig): Promise<Container>
  async start(): Promise<void>
  async stop(): Promise<void>
  async remove(): Promise<void>

  // Status
  async isRunning(): Promise<boolean>
  async getState(): Promise<ContainerState>

  // Port mapping
  async getMappedPort(containerPort: number): Promise<number>

  // Logs
  async getLogs(tail?: number): Promise<string>
}
```

**Image: `cmux-worker`**

Based on `ubuntu:24.04` with:
- Node.js 24
- VS Code Server
- Common CLI tools (git, gh, curl, etc.)
- Agent CLIs (installed at runtime)

**Building the Image:**

```bash
cd apps/worker
docker build -t cmux-worker .
```

**Container Configuration:**

```typescript
{
  Image: "cmux-worker:latest",
  name: `cmux-${taskRunId}`,
  ExposedPorts: {
    "39375/tcp": {},  // VS Code
    "39378/tcp": {},  // Worker
    // ... more ports
  },
  HostConfig: {
    PortBindings: {
      "39375/tcp": [{ HostPort: "0" }],  // Auto-assign
      // ... more ports
    },
    AutoRemove: false,  // Manual cleanup
    Memory: 4 * 1024 * 1024 * 1024,  // 4GB
    CpuQuota: 100000,  // 100% of one core
  },
  Env: [
    "TASK_RUN_ID=...",
    "ANTHROPIC_API_KEY=...",
    // ... more env vars
  ],
}
```

**Troubleshooting:**

- **Error: "Docker daemon not running"**
  - Solution: Start Docker Desktop or `sudo systemctl start docker`

- **Error: "Cannot connect to Docker socket"**
  - Solution: Add user to docker group: `sudo usermod -aG docker $USER`

- **Container stuck in "Removing" state**
  - Solution: Force remove with `docker rm -f cmux-<taskRunId>`

- **Port already allocated**
  - Solution: Enable `--no-autokill-ports` or manually kill process using port

### Model Providers

See [Supported Models & Providers](#supported-models--providers) for the full list.

**Adding a New Provider:**

See [Adding a New Agent Provider](#adding-a-new-agent-provider) guide.

---

## Troubleshooting

### Common Errors

#### Git Errors

**Error: "git: fatal: unsupported ssl backend"**

**Cause:** Git built without SSL support or missing SSL libraries

**Solution:**
```bash
# On Ubuntu/Debian
sudo apt-get install libcurl4-openssl-dev

# Rebuild git with OpenSSL
cd /path/to/git-source
make configure
./configure --with-openssl
make
sudo make install
```

**Error: "worktree already exists for branch"**

**Cause:** Previous worktree not cleaned up properly

**Solution:**
```bash
# List worktrees
git worktree list

# Remove the conflicting worktree
git worktree remove ~/.cmux/worktrees/<repo>/cmux-<branch>

# Or prune all stale worktrees
git worktree prune
```

**Error: "branch name too long"**

**Cause:** Task description generates very long branch name

**Solution:**
- Keep task descriptions concise (< 50 characters)
- Cmux will truncate automatically in future versions

#### Docker Errors

**Error: "Docker daemon not running"**

**Cause:** Docker Desktop not started or docker service stopped

**Solution:**
```bash
# macOS: Start Docker Desktop from Applications

# Linux: Start docker service
sudo systemctl start docker

# Verify
docker ps
```

**Error: "Cannot connect to Docker socket"**

**Cause:** User doesn't have permission to access Docker socket

**Solution:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, or run:
newgrp docker

# Verify
docker ps
```

**Error: "Port already allocated"**

**Cause:** Port 9776 or 9777 already in use

**Solution:**
```bash
# Find process using port
lsof -i :9776
lsof -i :9777

# Kill process
kill -9 <PID>

# Or use different port
cmux --port 8080
```

**Error: "Container keeps restarting"**

**Cause:** Entry point script failing or worker crashing

**Solution:**
```bash
# View container logs
docker logs cmux-<taskRunId>

# Enter container for debugging
docker exec -it cmux-<taskRunId> bash

# Check worker process
ps aux | grep node
```

#### Provider Errors

**Error: "API key not found for provider"**

**Cause:** API key not configured in settings or environment

**Solution:**
1. Check Settings → API Keys
2. Add missing API key
3. Or set environment variable:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

**Error: "Provider not properly configured"**

**Cause:** Agent CLI not installed or misconfigured

**Solution:**
```bash
# For Claude Code
curl -sSL https://claude.ai/cli/install.sh | sh

# For Cursor
# Install Cursor IDE and CLI

# Verify installation
which claude
which cursor-agent
```

**Error: "Agent command timed out"**

**Cause:** Agent didn't start within timeout period

**Solution:**
- Increase timeout in provider configuration
- Check agent CLI is working: `claude --version`
- Check container logs for errors

#### Memory/Performance Errors

**Error: "EventEmitter memory leak detected"**

**Cause:** Too many listeners registered (common with long-running tasks)

**Warning:** This is usually harmless but indicates potential cleanup issue

**Solution:**
- Restart Cmux server
- Check for stuck containers: `docker ps`
- Clean up old task runs from UI

**Error: "File watcher limit reached"**

**Cause:** Too many files being watched by file watcher

**Solution:**
```bash
# Increase inotify limit (Linux)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# macOS: No limit, but check for too many open files
ulimit -n 10000
```

**Container slow or unresponsive**

**Cause:** Resource limits or too many concurrent containers

**Solution:**
1. Check container settings → Reduce `maxRunningContainers`
2. Increase Docker resource limits in Docker Desktop
3. Enable `stopImmediatelyOnCompletion` in settings

#### Process Persistence After Ctrl-C

**Issue:** Processes linger after stopping Cmux with Ctrl-C

**Cause:** Signal handlers not properly cleaning up child processes

**Solution:**
```bash
# Find lingering processes
ps aux | grep cmux
ps aux | grep convex

# Kill manually
pkill -f cmux
pkill -f convex

# Or use process manager
npm install -g pm2
pm2 start cmux
pm2 stop cmux  # Clean shutdown
```

**Prevention:**
- Use `cmux uninstall` before stopping permanently
- Enable auto-cleanup in container settings

### Diagnostic Commands

**Check Cmux Status:**
```bash
# Check if server is running
curl http://localhost:9776/api/health

# View logs
tail -f ~/.cmux/cmux.log

# Check Convex status
curl http://localhost:9777
```

**Check Docker Status:**
```bash
# List running containers
docker ps

# List all cmux containers
docker ps -a | grep cmux

# View container logs
docker logs cmux-<taskRunId>

# Inspect container
docker inspect cmux-<taskRunId>

# Check resource usage
docker stats
```

**Check Git Status:**
```bash
# List worktrees
git worktree list

# Check for broken worktrees
git worktree prune --dry-run

# List cmux branches
git branch -a | grep cmux

# Check for merged branches
git branch --merged main | grep cmux
```

**Check Ports:**
```bash
# Check if ports are in use
lsof -i :9776
lsof -i :9777

# Check Docker port mappings
docker port cmux-<taskRunId>
```

**Check API Keys:**
```bash
# Check environment variables
env | grep -E "(ANTHROPIC|OPENAI|GEMINI|CURSOR)_API_KEY"

# Verify API key works (example for Anthropic)
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

**Performance Diagnostics:**
```bash
# Check system resources
top
htop

# Check disk usage
df -h
du -sh ~/.cmux

# Check Docker resource usage
docker stats

# Check file descriptor limits
ulimit -a

# Check open files
lsof | wc -l
```

### Known Issues

From `TODOS.md` and issue tracker:

#### High Priority

1. **Git SSL Backend Errors**
   - Status: In progress
   - Workaround: Rebuild git with OpenSSL support
   - Fix: Bundle compatible git binary or detect issue at startup

2. **Worktrees Intermittently Broken**
   - Status: Investigating
   - Cause: Race conditions in concurrent git operations
   - Workaround: Operation queue implemented; issue rare but not eliminated

3. **EventEmitter Memory Leak Warnings**
   - Status: Known issue
   - Cause: Long-running tasks register many listeners
   - Impact: Warning only; no actual memory leak
   - Fix: Increase max listeners or improve cleanup

4. **Processes Persist After Ctrl-C**
   - Status: In progress
   - Cause: Signal handlers need improvement
   - Workaround: Manual cleanup with `pkill` or `pm2`

#### Medium Priority

5. **Branch Names Too Long**
   - Status: Backlog
   - Cause: Descriptive slug + hash creates long names
   - Workaround: Keep task descriptions short
   - Fix: Implement smart truncation

6. **Container Port Conflicts**
   - Status: Fixed in dev
   - Feature: Auto-kill processes on startup (configurable)

7. **First-Run Extraction Failures**
   - Status: Investigating
   - Cause: Permission issues or path problems
   - Workaround: Manually create ~/.cmux directory

8. **File Watcher Limit Warnings**
   - Status: Documented
   - Workaround: Increase ulimit/inotify limits
   - Fix: Optimize file watching to watch fewer files

#### Low Priority

9. **Diff Generation Slow for Large Repos**
   - Status: Backlog
   - Workaround: Limit diff to relevant files only
   - Fix: Implement streaming diffs

10. **Stale Containers After Crash**
    - Status: Backlog
    - Workaround: Manual cleanup with `docker ps -a | grep cmux`
    - Fix: Implement startup scan for orphaned containers

---

## Guides & Recipes

### Local Development Setup

**Complete Local Development Setup:**

1. **Install Prerequisites:**
   ```bash
   # Install Node.js 24 (using nvm)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 24
   nvm use 24

   # Install Docker Desktop
   # macOS: Download from https://www.docker.com/products/docker-desktop
   # Linux:
   sudo apt-get update
   sudo apt-get install docker.io docker-compose
   sudo systemctl start docker
   sudo usermod -aG docker $USER

   # Install Git
   sudo apt-get install git

   # Install GitHub CLI
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
   sudo apt-get update
   sudo apt-get install gh
   ```

2. **Install Cmux:**
   ```bash
   npm install -g cmux
   ```

3. **Configure API Keys:**
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export ANTHROPIC_API_KEY="sk-ant-api03-..."
   export OPENAI_API_KEY="sk-..."
   export GEMINI_API_KEY="..."

   # Reload shell
   source ~/.bashrc
   ```

4. **Authenticate GitHub:**
   ```bash
   gh auth login
   # Follow prompts to authenticate
   ```

5. **Start Cmux:**
   ```bash
   # Navigate to your project
   cd ~/projects/my-app

   # Start cmux
   cmux
   ```

6. **Configure Settings:**
   - Open http://localhost:9776
   - Go to Settings
   - Add API keys (if not using env vars)
   - Configure container settings:
     - Max containers: 3-5 (based on your machine)
     - Review period: 30-60 minutes
     - Enable auto-cleanup
   - Configure workspace settings:
     - Set custom worktree path (optional)
     - Enable auto-PR (optional)

7. **Create First Task:**
   - Click "New Task"
   - Enter description: "Add a README file with project setup instructions"
   - Select agents: Claude Sonnet 4.5, Codex GPT-5
   - Click "Run Task"
   - Watch agents work in parallel!

8. **Monitor and Compare:**
   - View real-time terminal output
   - Check file changes in diff viewer
   - Compare solutions side-by-side
   - Crown winner to create PR

### Adding a New Agent Provider

**Step-by-Step Guide:**

1. **Understand the Agent Config Interface:**

```typescript
interface AgentConfig {
  name: string;                    // Display name (e.g., "Claude Sonnet 4.5")
  command: string;                 // Executable command (e.g., "claude")
  args: string[];                  // CLI arguments
  apiKeys?: AgentConfigApiKeys;    // Required API keys
  environment?: (ctx) => EnvironmentResult;  // Setup function
  applyApiKeys?: (keys) => EnvironmentResult;  // Key injection
  waitForString?: string;          // Terminal ready signal
  enterKeySequence?: string;       // Custom enter key (default: "\n")
  checkRequirements?: () => Promise<string[]>;  // Validation
  completionDetector?: (taskRunId) => Promise<void>;  // Done detection
}
```

2. **Create Provider Configuration:**

Edit `packages/shared/src/config/providers.ts`:

```typescript
import { AgentConfig } from "../types";

export const MY_PROVIDER_CONFIGS: Record<string, AgentConfig> = {
  "my-provider/model-1": {
    name: "My Provider Model 1",
    command: "my-cli",
    args: ["--model", "model-1", "--interactive"],
    apiKeys: {
      MY_PROVIDER_API_KEY: {
        envVar: "MY_PROVIDER_API_KEY",
        displayName: "My Provider API Key",
        required: true,
      },
    },
    environment: async (ctx) => {
      // Setup code - runs before agent starts
      // Install CLI, configure environment, etc.

      // Example: Install CLI from npm
      await ctx.exec("npm", ["install", "-g", "my-provider-cli"]);

      return { success: true };
    },
    applyApiKeys: (keys) => {
      // Inject API keys as environment variables
      return {
        success: true,
        environment: {
          MY_PROVIDER_API_KEY: keys.MY_PROVIDER_API_KEY || "",
        },
      };
    },
    waitForString: "Ready for input",  // String to wait for before sending prompt
    enterKeySequence: "\n",
    checkRequirements: async () => {
      // Check if CLI is installed
      try {
        await exec("which my-cli");
        return [];  // No errors
      } catch {
        return ["my-cli is not installed. Run: npm install -g my-provider-cli"];
      }
    },
    completionDetector: async (taskRunId) => {
      // Optional: Custom completion detection
      // Default: Uses terminal idle detection

      // Example: Check for specific file
      const completionFile = `/root/workspace/.cmux-complete`;
      // ... implement check logic
    },
  },

  "my-provider/model-2": {
    // Additional model configuration...
  },
};
```

3. **Register Provider in Main Config:**

Edit `packages/shared/src/config/agents.ts`:

```typescript
import { MY_PROVIDER_CONFIGS } from "./providers";

export const AGENT_CONFIGS = {
  ...CLAUDE_CONFIGS,
  ...CODEX_CONFIGS,
  ...GEMINI_CONFIGS,
  ...MY_PROVIDER_CONFIGS,  // Add your provider
} as const;
```

4. **Add Provider to UI:**

Edit `apps/client/src/components/AgentSelector.tsx`:

```typescript
const PROVIDER_GROUPS = [
  { label: "Anthropic (Claude)", prefix: "claude/" },
  { label: "OpenAI (Codex)", prefix: "codex/" },
  { label: "Google (Gemini)", prefix: "gemini/" },
  { label: "My Provider", prefix: "my-provider/" },  // Add here
];
```

5. **Test Your Provider:**

```bash
# Rebuild cmux
cd /path/to/cmux
bun install
bun run build

# Start cmux
cmux

# Create test task with your provider
# Check that:
# - Provider appears in agent selector
# - API key prompt shown if not configured
# - CLI installs correctly in container
# - Agent executes and completes task
```

6. **Handle Special Cases:**

**Custom Terminal Detection:**
```typescript
completionDetector: async (taskRunId) => {
  // Check for specific output pattern
  const logs = await getTaskRunLogs(taskRunId);
  if (logs.includes("Task completed successfully")) {
    await markTaskRunComplete(taskRunId);
  }
}
```

**Multi-Step Setup:**
```typescript
environment: async (ctx) => {
  // Install dependencies
  await ctx.exec("apt-get", ["update"]);
  await ctx.exec("apt-get", ["install", "-y", "python3", "python3-pip"]);

  // Install Python package
  await ctx.exec("pip3", ["install", "my-provider-cli"]);

  // Verify installation
  const result = await ctx.exec("my-cli", ["--version"]);
  if (!result.success) {
    return { success: false, error: "Installation failed" };
  }

  return { success: true };
}
```

**Custom API Key Validation:**
```typescript
checkRequirements: async () => {
  const apiKey = process.env.MY_PROVIDER_API_KEY;
  if (!apiKey) {
    return ["MY_PROVIDER_API_KEY environment variable not set"];
  }

  // Validate key format
  if (!apiKey.startsWith("mp-")) {
    return ["Invalid API key format. Must start with 'mp-'"];
  }

  // Test API key (optional)
  try {
    const response = await fetch("https://api.myprovider.com/v1/verify", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return ["API key is invalid or expired"];
    }
  } catch (error) {
    return ["Failed to verify API key. Check network connection."];
  }

  return [];  // No errors
}
```

### Custom Environment Templates

**Creating Custom Cloud Environments:**

1. **Create Base Snapshot (Morph):**

   ```bash
   # SSH into a fresh Morph sandbox
   morph ssh my-sandbox

   # Install your tools and dependencies
   apt-get update
   apt-get install -y build-essential python3 python3-pip
   pip3 install tensorflow pytorch
   npm install -g typescript ts-node

   # Configure environment
   git config --global user.name "Cmux Agent"
   git config --global user.email "agent@cmux.local"

   # Create snapshot
   morph snapshot create my-custom-environment
   # Note the snapshot ID: morph-snapshot-abc123
   ```

2. **Create Environment in Cmux:**

   Navigate to Settings → Environments → Create Environment:

   **Basic Info:**
   - Name: `Node.js + Python ML`
   - Description: `Environment with Node.js 24, Python 3.11, and ML libraries`

   **Configuration:**
   - Snapshot ID: `morph-snapshot-abc123`

   **Dev Script:**
   ```bash
   #!/bin/bash
   set -e

   # Update packages
   apt-get update

   # Install additional tools
   apt-get install -y vim curl wget

   # Install Claude Code
   curl -sSL https://claude.ai/cli/install.sh | sh

   # Verify installations
   node --version
   python3 --version
   claude --version

   echo "Environment ready!"
   ```

   **Maintenance Script:**
   ```bash
   #!/bin/bash
   # Health check script (runs periodically)

   # Check disk space
   df -h | grep -E '^/dev/' | awk '{if ($5+0 > 90) exit 1}'

   # Check memory
   free -m | awk 'NR==2{if ($3/$2 > 0.95) exit 1}'

   # Check process count
   ps aux | wc -l | awk '{if ($1 > 500) exit 1}'

   echo "Health check passed"
   ```

   **Exposed Ports:**
   - `3000` - React dev server
   - `8000` - Python app
   - `5432` - PostgreSQL (if installed)

3. **Use Environment in Tasks:**

   When creating a task:
   - Select "Cloud Mode"
   - Choose your custom environment from dropdown
   - Agents will provision sandboxes from your template

4. **Advanced: Environment Variables:**

   For secrets and API keys:

   - Go to Settings → Environments → (Your Environment) → Variables
   - Add environment variables:
     - `DATABASE_URL` = `postgresql://...`
     - `REDIS_URL` = `redis://...`
     - `SECRET_KEY` = `...`
   - Variables are encrypted and injected at runtime

5. **Example: Full-Stack Development Environment:**

```bash
#!/bin/bash
set -e

echo "Setting up full-stack development environment..."

# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Install Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Install Python 3.11
apt-get install -y python3.11 python3.11-venv python3-pip

# Install PostgreSQL client
apt-get install -y postgresql-client

# Install Redis client
apt-get install -y redis-tools

# Install Docker (for running services)
curl -fsSL https://get.docker.com | sh

# Install global npm packages
npm install -g pnpm yarn typescript ts-node
npm install -g @anthropic-ai/claude-code

# Install Python packages
pip3 install pipenv poetry

# Configure Git
git config --global user.name "Cmux Agent"
git config --global user.email "agent@cmux.local"
git config --global init.defaultBranch main

# Create workspace structure
mkdir -p /workspace/{backend,frontend,shared}

# Start services (docker-compose)
if [ -f /workspace/docker-compose.yml ]; then
  cd /workspace
  docker-compose up -d
fi

echo "Environment setup complete!"
```

---

## Architecture Reference

### Project Structure

```
cmux/
├── apps/
│   ├── client/                  # React frontend (Vite + Electron)
│   │   ├── src/
│   │   │   ├── main.tsx         # Entry point
│   │   │   ├── routes/          # TanStack Router routes
│   │   │   ├── components/      # React components
│   │   │   ├── hooks/           # Custom hooks
│   │   │   └── lib/             # Utilities
│   │   ├── electron/            # Electron main process
│   │   └── package.json
│   ├── server/                  # Backend server (Express + Socket.IO)
│   │   ├── src/
│   │   │   ├── server.ts        # Main entry point
│   │   │   ├── routes/          # Express routes
│   │   │   ├── sockets/         # Socket.IO handlers
│   │   │   ├── vscode/          # VSCode instance managers
│   │   │   ├── git/             # Git operations
│   │   │   └── docker/          # Docker integration
│   │   └── package.json
│   ├── worker/                  # Docker container worker
│   │   ├── Dockerfile           # Container image definition
│   │   ├── src/
│   │   │   ├── worker.ts        # Socket.IO worker server
│   │   │   └── terminal.ts      # Terminal management
│   │   └── package.json
│   └── www/                     # Next.js public site + API
│       ├── app/                 # Next.js app router
│       └── server/              # Hono API
├── packages/
│   ├── cmux/                    # CLI package (published to npm)
│   │   ├── src/
│   │   │   ├── cli.ts           # CLI entry point
│   │   │   ├── extract.ts       # First-run extraction
│   │   │   └── spawn.ts         # Server spawning
│   │   └── package.json
│   ├── shared/                  # Shared code (types, config, utils)
│   │   ├── src/
│   │   │   ├── types/           # TypeScript types
│   │   │   ├── config/          # Agent configurations
│   │   │   └── utils/           # Shared utilities
│   │   └── package.json
│   └── convex/                  # Convex backend (database + functions)
│       ├── schema.ts            # Database schema
│       ├── functions/           # Convex functions (queries/mutations)
│       └── convex.json
├── bun.lock                     # Lock file (Bun)
├── package.json                 # Root package.json (workspaces)
├── README.md                    # Main README
├── DOCUMENTATION.md             # This file
└── CLAUDE.md                    # Development guide
```

### Technology Stack

**Frontend:**
- **Framework:** React 19
- **Router:** TanStack Router
- **State Management:** TanStack Query + Convex React
- **UI Components:** Shadcn UI
- **Styling:** Tailwind CSS
- **Build:** Vite
- **Desktop:** Electron (optional)

**Backend:**
- **Runtime:** Node.js 24
- **Server:** Express
- **Real-time:** Socket.IO
- **Docker:** Dockerode
- **Git:** simple-git
- **GitHub:** Octokit

**Database:**
- **Primary:** Convex (self-hosted + cloud)
- **Schema:** TypeScript-first
- **Real-time:** Convex subscriptions

**CLI:**
- **Framework:** Commander.js
- **Package Manager:** Bun (recommended), npm, yarn

**Worker:**
- **Base Image:** ubuntu:24.04
- **Runtime:** Node.js 24
- **Tools:** Git, GitHub CLI, VS Code Server, Agent CLIs

**Authentication:**
- **Local:** None (runs locally)
- **Cloud:** Stack Auth (OAuth)

**Deployment:**
- **Local:** Self-extracting binary with bundled Convex
- **Cloud:** Vercel (www), Convex Cloud (database), Morph/Daytona (sandboxes)

**Development:**
- **Language:** TypeScript 5.9
- **Package Manager:** Bun
- **Testing:** Vitest
- **Linting:** ESLint + Prettier
- **Monorepo:** Bun workspaces

### API Endpoints

#### HTTP API (Express)

**Base URL:** `http://localhost:9776/api`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/repositories` | GET | List repositories |
| `/repositories/:id` | GET | Get repository details |
| `/tasks` | GET | List tasks |
| `/tasks` | POST | Create task |
| `/tasks/:id` | GET | Get task details |
| `/task-runs/:id` | GET | Get task run details |
| `/task-runs/:id/logs` | GET | Get task run logs |
| `/task-runs/:id/diff` | GET | Get task run diff |

**Example: Create Task**

```bash
curl -X POST http://localhost:9776/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryId": "abc123",
    "description": "Add user authentication",
    "agents": ["claude/sonnet-4.5", "codex/gpt-5"]
  }'
```

#### Socket.IO API

**Connection:** `ws://localhost:9776` or `wss://cmux.app`

**Events (Client → Server):**

| Event | Payload | Description |
|-------|---------|-------------|
| `create-local-workspace` | `{ taskRunId, config }` | Create Docker container |
| `create-cloud-workspace` | `{ taskRunId, config }` | Create cloud sandbox |
| `send-command` | `{ taskRunId, command }` | Send command to terminal |
| `stop-workspace` | `{ taskRunId }` | Stop workspace |
| `remove-workspace` | `{ taskRunId }` | Remove workspace |
| `get-terminal-output` | `{ taskRunId }` | Request terminal output |

**Events (Server → Client):**

| Event | Payload | Description |
|-------|---------|-------------|
| `workspace-created` | `{ taskRunId, url }` | Workspace ready |
| `workspace-error` | `{ taskRunId, error }` | Workspace creation failed |
| `terminal-output` | `{ taskRunId, output }` | Terminal output chunk |
| `workspace-status` | `{ taskRunId, status }` | Status update |
| `file-changed` | `{ taskRunId, files }` | File change detected |
| `task-complete` | `{ taskRunId }` | Task completed |

**Example: Send Command**

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:9776");

socket.emit("send-command", {
  taskRunId: "task123",
  command: "npm install\n",
});

socket.on("terminal-output", ({ taskRunId, output }) => {
  console.log(`[${taskRunId}]`, output);
});
```

#### Convex API

**Queries:**

```typescript
// Get all tasks
const tasks = useQuery(api.tasks.list, { repositoryId });

// Get task details
const task = useQuery(api.tasks.get, { taskId });

// Get task runs
const taskRuns = useQuery(api.taskRuns.listByTask, { taskId });

// Get repository
const repository = useQuery(api.repositories.get, { repositoryId });
```

**Mutations:**

```typescript
// Create task
const createTask = useMutation(api.tasks.create);
await createTask({
  repositoryId,
  description: "Add feature",
  agents: ["claude/sonnet-4.5"],
});

// Crown winner
const crownWinner = useMutation(api.taskRuns.crownWinner);
await crownWinner({ taskRunId });

// Create PR
const createPR = useMutation(api.pullRequests.create);
await createPR({ taskRunId });
```

**Actions:**

```typescript
// Spawn agents
const spawnAgents = useAction(api.agents.spawnAll);
await spawnAgents({ taskId });

// Generate diff
const generateDiff = useAction(api.git.generateDiff);
const diff = await generateDiff({ taskRunId });
```

---

## Versioning & Changelog

### Current Version

**v0.1.0** (Beta) - 2025-01-06

### Semantic Versioning

Cmux follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality additions
- **PATCH** version for backwards-compatible bug fixes

### Release Channels

- **Stable:** `npm install -g cmux`
- **Beta:** `npm install -g cmux@beta`
- **Canary:** `npm install -g cmux@canary`

### Version Compatibility

| Cmux Version | Node Version | Docker Version | Convex Version |
|--------------|--------------|----------------|----------------|
| 0.1.x | 18+ (24+ recommended) | 20+ | 1.0+ |

### Deprecation Policy

- **Deprecation Notice:** 1 minor version before removal
- **Breaking Changes:** Only in major versions
- **Security Fixes:** Backported to previous minor version

### Known Issues by Version

**v0.1.0:**
- Git SSL backend errors on some systems
- Worktrees intermittently broken (rare)
- EventEmitter memory leak warnings (harmless)
- Processes may persist after Ctrl-C

### Upgrade Guide

**From v0.0.x to v0.1.x:**

1. Backup your Convex database:
   ```bash
   cp -r ~/.cmux/convex-backend ~/.cmux/convex-backend.backup
   ```

2. Stop Cmux:
   ```bash
   pkill -f cmux
   ```

3. Upgrade package:
   ```bash
   npm install -g cmux@latest
   ```

4. Start Cmux (migrations run automatically):
   ```bash
   cmux
   ```

5. Verify upgrade:
   - Check Settings → About for version number
   - Verify all repositories are visible
   - Test creating a new task

**Breaking Changes:**
- None (first release)

### Changelog

See [GitHub Releases](https://github.com/cmux/cmux/releases) for detailed changelog.

**v0.1.0** (2025-01-06)
- Initial beta release
- Local mode with Docker containers
- Cloud mode with Morph integration
- Support for Claude, Codex, Gemini, Cursor, and more
- Git worktree management
- Automatic PR creation
- Real-time task monitoring
- Web-based UI

---

## Additional Resources

### Documentation

- **GitHub Repository:** https://github.com/cmux/cmux
- **Website:** https://cmux.app
- **Issues:** https://github.com/cmux/cmux/issues
- **Discussions:** https://github.com/cmux/cmux/discussions

### Community

- **Discord:** https://discord.gg/cmux
- **Twitter:** https://twitter.com/cmux_dev

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

### License

MIT License - see [LICENSE](LICENSE) for details.

---

## FAQ

**Q: Is Cmux free?**

A: Yes, Cmux is open-source and free to use. Cloud mode may incur infrastructure costs from cloud providers (Morph, Daytona).

**Q: Can I use Cmux offline?**

A: Local mode works offline except for AI model API calls. Cloud mode requires internet connection.

**Q: How many agents can I run simultaneously?**

A: Local mode default is 5 concurrent containers (configurable). Cloud mode depends on your plan.

**Q: Do I need to install all agent CLIs?**

A: No, Cmux installs agent CLIs automatically in containers when needed.

**Q: Is my code safe?**

A: Local mode: Code stays on your machine. Cloud mode: Code in sandboxes is isolated and deleted after use. API keys are encrypted.

**Q: Can I use custom Docker images?**

A: Yes, you can modify the Dockerfile in `apps/worker/` and rebuild the image.

**Q: How do I clean up old task runs?**

A: Use the UI to delete tasks, or enable auto-cleanup in container settings.

**Q: Can I use Cmux with private repositories?**

A: Yes, authenticate with GitHub CLI (`gh auth login`) to access private repos.

**Q: What happens if a task run fails?**

A: You can view logs, retry the task, or manually fix issues in the worktree/branch.

**Q: Can I integrate Cmux into CI/CD?**

A: Not yet, but planned for future releases.

---

*Last updated: 2025-01-06*
*Version: 0.1.0*
