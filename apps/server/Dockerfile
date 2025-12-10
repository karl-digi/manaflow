# syntax=docker/dockerfile:1

# Multi-stage Dockerfile for cmux server
# Optimized for Coolify deployment

# =============================================================================
# Stage 1: Dependencies
# =============================================================================
FROM oven/bun:1 AS deps

WORKDIR /app

# Install build dependencies for native modules (utf-8-validate, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files for workspace resolution
COPY package.json bun.lock .npmrc ./

# Copy all workspace package.json files (needed for bun install)
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
COPY scripts/package.json ./scripts/

# Install all dependencies (production only, ignore optional native modules that fail)
RUN bun install --frozen-lockfile --production --ignore-scripts || \
    (echo "Retrying without scripts..." && bun install --frozen-lockfile --production --ignore-scripts)

# =============================================================================
# Stage 2: Production
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

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy workspace packages source code (needed at runtime)
COPY packages/shared ./packages/shared
COPY packages/convex ./packages/convex
COPY packages/www-openapi-client ./packages/www-openapi-client

# Copy server source code
COPY apps/server ./apps/server

# Copy root config files
COPY package.json bun.lock .npmrc ./

# Set ownership to non-root user
RUN chown -R cmux:cmux /app

# Switch to non-root user
USER cmux

# Environment variables
ENV NODE_ENV=production
ENV PORT=9776

# Expose the server port
EXPOSE 9776

# Health check - TCP-based since server is Socket.IO only
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun -e "const net = require('net'); const s = net.createConnection(9776, 'localhost'); s.on('connect', () => process.exit(0)); s.on('error', () => process.exit(1));" || exit 1

# Start the server
CMD ["bun", "run", "apps/server/src/local-dev.ts"]
