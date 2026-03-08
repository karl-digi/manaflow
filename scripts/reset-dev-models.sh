#!/usr/bin/env bash
# Reset dev models table and test auto-discovery flow
# Usage: ./scripts/reset-dev-models.sh [--skip-clear]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONVEX_DIR="$PROJECT_ROOT/packages/convex"
ENV_FILE="$PROJECT_ROOT/.env"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[reset-dev-models]${NC} $1"; }
warn() { echo -e "${YELLOW}[reset-dev-models]${NC} $1"; }

run_convex() {
  (cd "$CONVEX_DIR" && bunx convex run "$1" --env-file "$ENV_FILE" 2>&1)
}

# Check if --skip-clear flag is passed
SKIP_CLEAR=false
if [[ "${1:-}" == "--skip-clear" ]]; then
  SKIP_CLEAR=true
fi

log "Starting dev model reset..."

if [[ "$SKIP_CLEAR" == "false" ]]; then
  # Step 1: Clear all models
  log "Step 1: Clearing all models..."
  CLEAR_RESULT=$(run_convex "models:clearAll")
  DELETED_COUNT=$(echo "$CLEAR_RESULT" | grep -o '"deletedCount": [0-9]*' | grep -o '[0-9]*' || echo "0")
  log "Deleted $DELETED_COUNT models"
else
  log "Skipping clear step (--skip-clear flag)"
fi

# Step 2: Check needs flags
log "Step 2: Checking needs flags..."
NEEDS_SEEDING=$(run_convex "models:needsSeeding")
NEEDS_DISCOVERY=$(run_convex "models:needsDiscovery")
log "needsSeeding: $NEEDS_SEEDING"
log "needsDiscovery: $NEEDS_DISCOVERY"

# Step 3: Run ensureCuratedModelsSeeded
log "Step 3: Running ensureCuratedModelsSeeded..."
SEED_RESULT=$(run_convex "modelDiscovery:ensureCuratedModelsSeeded")
SEEDED=$(echo "$SEED_RESULT" | grep -o '"seeded": [a-z]*' | grep -o 'true\|false' || echo "unknown")
SEED_COUNT=$(echo "$SEED_RESULT" | grep -o '"count": [0-9]*' | grep -o '[0-9]*' || echo "0")
log "Seeded: $SEEDED, Count: $SEED_COUNT"

# Step 4: Run ensureDiscoveredModels
log "Step 4: Running ensureDiscoveredModels..."
DISCOVER_RESULT=$(run_convex "modelDiscovery:ensureDiscoveredModels")
DISCOVERED=$(echo "$DISCOVER_RESULT" | grep -o '"discovered": [a-z]*' | grep -o 'true\|false' || echo "unknown")
DISCOVER_COUNT=$(echo "$DISCOVER_RESULT" | grep -o '"count": [0-9]*' | grep -o '[0-9]*' || echo "0")
log "Discovered: $DISCOVERED, Count: $DISCOVER_COUNT"

# Step 5: Verify opencode free models
log "Step 5: Verifying opencode free models..."
echo ""
log "OpenCode free models:"
run_convex "models:list" \
  | grep -E '"name": "opencode/' \
  | sed 's/.*"name": "\([^"]*\)".*/  - \1/' || echo "  (none found)"

OPENCODE_COUNT=$(run_convex "models:list" | grep -cE '"name": "opencode/' || echo "0")

echo ""
log "Done! Summary:"
echo "  - Curated models seeded: $SEED_COUNT"
echo "  - Discovered models: $DISCOVER_COUNT"
echo "  - OpenCode models available: $OPENCODE_COUNT"
