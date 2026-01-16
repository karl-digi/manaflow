# syntax=docker/dockerfile:1

# Multi-stage Dockerfile for cmux server
# Optimized for Coolify deployment

# =============================================================================
# Stage 1: Install all dependencies (for proper hoisting in monorepo)
# =============================================================================
FROM oven/bun:1 AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
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
COPY scripts/package.json ./scripts/

# Install ALL dependencies (not --production) to ensure proper hoisting
# Bun's --production flag breaks hoisting in monorepos
RUN bun install --frozen-lockfile --ignore-scripts || \
    (echo "Retrying without scripts..." && bun install --frozen-lockfile --ignore-scripts)

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

# Copy node_modules from deps stage (properly hoisted)
COPY --from=deps /app/node_modules ./node_modules

# Copy workspace packages source code
COPY packages/shared ./packages/shared
COPY packages/convex ./packages/convex
COPY packages/www-openapi-client ./packages/www-openapi-client

# Copy server source code
COPY apps/server ./apps/server

# Copy root config files
COPY package.json bun.lock .npmrc ./

# Re-link @cmux workspace packages to local source
# This is necessary for subpath exports like @cmux/convex/api to resolve
RUN rm -rf node_modules/@cmux && mkdir -p node_modules/@cmux \
    && ln -s ../../packages/shared node_modules/@cmux/shared \
    && ln -s ../../packages/convex node_modules/@cmux/convex \
    && ln -s ../../packages/www-openapi-client node_modules/@cmux/www-openapi-client

# Set ownership to non-root user
RUN chown -R cmux:cmux /app

USER cmux

ENV NODE_ENV=production
ENV PORT=9776

EXPOSE 9776

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun -e "const net = require('net'); const s = net.createConnection(9776, 'localhost'); s.on('connect', () => process.exit(0)); s.on('error', () => process.exit(1));" || exit 1

CMD ["bun", "run", "apps/server/src/local-dev.ts"]
