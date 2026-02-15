#!/usr/bin/env bash
# Build script for E2B Lite Template
# Usage: ./scripts/setup-e2b-template-lite.sh [--prod|--dev]
#
# This creates a lightweight E2B template WITHOUT Docker-in-Docker.
# Useful for tasks that don't require running containers inside the sandbox.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
BUILD_MODE="prod"
while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            BUILD_MODE="prod"
            shift
            ;;
        --dev)
            BUILD_MODE="dev"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--prod|--dev]"
            echo ""
            echo "Options:"
            echo "  --prod  Build template in production mode (default)"
            echo "  --dev   Build template in development mode (smaller resources)"
            echo ""
            echo "This script builds the cmux-devbox-lite E2B template."
            echo "The lite template does NOT include Docker-in-Docker, making it:"
            echo "  - Faster to boot"
            echo "  - Smaller image size"
            echo "  - Lower resource overhead"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

log_info "Building E2B Lite Template (mode: $BUILD_MODE)"

# Check for required tools
if ! command -v bun &> /dev/null; then
    log_error "bun is not installed. Please install bun first."
    exit 1
fi

if ! command -v e2b &> /dev/null; then
    log_warn "E2B CLI not found, will use bunx e2b"
    E2B_CMD="bunx e2b"
else
    E2B_CMD="e2b"
fi

# Navigate to cmux-devbox-lite package
cd "$PROJECT_ROOT/packages/cloudrouter/cmux-devbox-lite"

log_info "Installing dependencies..."
bun install

log_info "Building template with SDK v2..."
if [ "$BUILD_MODE" = "prod" ]; then
    bun run build:prod
else
    bun run build:dev
fi

log_success "E2B Lite Template build complete!"
log_info ""

# Show correct template name based on build mode
if [ "$BUILD_MODE" = "prod" ]; then
    TEMPLATE_NAME="cmux-devbox-lite"
else
    TEMPLATE_NAME="cmux-devbox-lite-dev"
fi

log_info "Template Details:"
log_info "  - Name: $TEMPLATE_NAME"
log_info "  - Mode: $BUILD_MODE"
log_info "  - Features: VSCode, VNC, JupyterLab, Worker Daemon"
log_info "  - Excludes: Docker-in-Docker"
log_info ""
log_info "To use this template:"
log_info "  cloudrouter start --template $TEMPLATE_NAME"
log_info ""
if [ "$BUILD_MODE" = "dev" ]; then
    log_warn "This is a DEV template (smaller resources)."
    log_warn "cloudrouter defaults to 'cmux-devbox-lite' (prod)."
    log_warn "Use: cloudrouter start --template $TEMPLATE_NAME"
fi
