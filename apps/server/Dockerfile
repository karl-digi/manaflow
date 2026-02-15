# syntax=docker/dockerfile:1

# Multi-stage Dockerfile for cmux server
# Optimized for Coolify deployment

# =============================================================================
# Stage 1: Install dependencies
# =============================================================================
FROM oven/bun:1 AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Copy package files for workspace resolution
COPY package.json bun.lock .npmrc ./
COPY apps/server/package.json ./apps/server/
COPY apps/www/package.json ./apps/www/
COPY apps/client/package.json ./apps/client/
COPY apps/worker/package.json ./apps/worker/
COPY apps/edge-router/package.json ./apps/edge-router/
COPY apps/preview-proxy/package.json ./apps/preview-proxy/
COPY packages/shared/package.json ./packages/shared/
COPY packages/convex/package.json ./packages/convex/
COPY packages/www-openapi-client/package.json ./packages/www-openapi-client/
COPY packages/morphcloud-openapi-client/package.json ./packages/morphcloud-openapi-client/
COPY packages/cmux/package.json ./packages/cmux/
COPY packages/vscode-extension/package.json ./packages/vscode-extension/
COPY packages/host-screenshot-collector/package.json ./packages/host-screenshot-collector/
COPY packages/e2b-client/package.json ./packages/e2b-client/
COPY packages/pve-lxc-client/package.json ./packages/pve-lxc-client/
COPY scripts/package.json ./scripts/

# Install production dependencies
# Explicitly disable frozen lockfile to avoid version mismatch errors
ENV BUN_FROZEN_LOCKFILE=false
RUN rm -f bun.lock && bun install --production --ignore-scripts

# Extract all non-workspace dependencies from server and convex packages
# These need to be hoisted for proper module resolution
RUN jq -r '.dependencies | keys[] | select(startswith("@cmux") | not)' \
    apps/server/package.json packages/convex/package.json 2>/dev/null | \
    sort -u > /tmp/deps-to-hoist.txt

# =============================================================================
# Stage 2: Build native Rust module
# =============================================================================
FROM rust:1.85-slim-bookworm AS rust-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    pkg-config \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js for napi-rs CLI
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy native module source
COPY apps/server/native/core/Cargo.toml apps/server/native/core/Cargo.lock* ./apps/server/native/core/
COPY apps/server/native/core/src ./apps/server/native/core/src
COPY apps/server/native/core/.cargo ./apps/server/native/core/.cargo

# Build native module
WORKDIR /app/apps/server/native/core
RUN npm install @napi-rs/cli
# Pin crates to versions compatible with stable Rust 1.85
# - home 0.5.12 requires Rust 1.88
# - human_format 1.2.1 uses unstable let-chains feature
RUN cargo update home --precise 0.5.11 && \
    cargo update human_format --precise 1.1.0
RUN npx napi build --platform --release

# =============================================================================
# Stage 3: Production
# =============================================================================
FROM oven/bun:1-slim AS production

WORKDIR /app

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 cmux \
    && useradd --uid 1001 --gid cmux --shell /bin/bash --create-home cmux

# Copy node_modules and hoisting list from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /tmp/deps-to-hoist.txt /tmp/deps-to-hoist.txt

# Copy workspace packages source code
COPY packages/shared ./packages/shared
COPY packages/convex ./packages/convex
COPY packages/www-openapi-client ./packages/www-openapi-client
COPY packages/e2b-client ./packages/e2b-client

# Copy server source code
COPY apps/server ./apps/server

# Copy compiled native module from rust-builder
COPY --from=rust-builder /app/apps/server/native/core/*.node ./apps/server/native/core/

# Copy root config files
COPY package.json bun.lock .npmrc ./

# Re-link @cmux workspace packages to local source
# This is necessary for subpath exports like @cmux/convex/api to resolve
RUN rm -rf node_modules/@cmux && mkdir -p node_modules/@cmux \
    && ln -s ../../packages/shared node_modules/@cmux/shared \
    && ln -s ../../packages/convex node_modules/@cmux/convex \
    && ln -s ../../packages/www-openapi-client node_modules/@cmux/www-openapi-client \
    && ln -s ../../packages/e2b-client node_modules/@cmux/e2b-client

# Auto-hoist packages from .bun/ cache to node_modules root
# Bun's --production install puts packages in nested .bun/ directory
# Handles both scoped (@org/pkg) and non-scoped packages
# Uses sort -V -r to pick highest version when multiple versions exist
RUN while read pkg; do \
      [ -z "$pkg" ] && continue; \
      if echo "$pkg" | grep -q '^@'; then \
        # Scoped package: @org/name -> search pattern @org+name@version
        SCOPE=$(echo "$pkg" | cut -d'/' -f1); \
        NAME=$(echo "$pkg" | cut -d'/' -f2); \
        SEARCH_PATTERN="${SCOPE}+${NAME}@"; \
        PKG_PATH=$(find node_modules/.bun -type d -path "*${SEARCH_PATTERN}*/node_modules/${SCOPE}/${NAME}" 2>/dev/null | sort -V -r | head -1); \
        if [ -n "$PKG_PATH" ] && [ ! -e "node_modules/${SCOPE}/${NAME}" ]; then \
          mkdir -p "node_modules/${SCOPE}"; \
          ln -s "../${PKG_PATH#node_modules/}" "node_modules/${SCOPE}/${NAME}"; \
        fi; \
      else \
        # Non-scoped package: sort -V -r picks highest version
        PKG_PATH=$(find node_modules/.bun -type d -name "$pkg" -path "*${pkg}@*/node_modules/${pkg}" 2>/dev/null | sort -V -r | head -1); \
        if [ -n "$PKG_PATH" ] && [ ! -e "node_modules/$pkg" ]; then \
          ln -s "${PKG_PATH#node_modules/}" "node_modules/$pkg"; \
        fi; \
      fi; \
    done < /tmp/deps-to-hoist.txt && rm /tmp/deps-to-hoist.txt

# Set ownership to non-root user
RUN chown -R cmux:cmux /app

USER cmux

ENV NODE_ENV=production
ENV PORT=9776

EXPOSE 9776

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun -e "const net = require('net'); const s = net.createConnection(9776, 'localhost'); s.on('connect', () => process.exit(0)); s.on('error', () => process.exit(1));" || exit 1

CMD ["bun", "run", "apps/server/src/local-dev.ts"]
