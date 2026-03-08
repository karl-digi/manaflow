# cmux (Legacy - Web App Bundler)

> **DEPRECATED**: This package is the legacy TypeScript web app bundler. For the primary devsh CLI (cloud VM control with browser automation), see [`packages/devsh`](../devsh/README.md) (Go).

A single-executable web app multiplexer with built-in Convex backend. cmux allows you to run multiple coding agent CLIs in parallel across different tasks, each with their own isolated environment.

## Features

- 🌐 Web-based UI for managing tasks
- 🐳 Docker integration for isolated environments

## Installation

```bash
npm install -g cmux
```

Or download the binary directly from the releases page.

## Usage

Simply run:

```bash
cmux
```

This will:

1. Start a local Convex backend on port 9777
2. Start the web server on port 9776
3. Open your browser to http://localhost:9776

### Options

```bash
cmux --port 8080  # Use a different port
cmux --help       # Show all options
```

## First Run

On first run, cmux will extract its bundled files to `~/.cmux/`. This includes:

- The Convex backend binary and database
- Web application static files
- Configuration files

## Development

cmux is part of the cmux project. See the main repository for development instructions.

## License

MIT
