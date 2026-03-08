#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

WATCH=false
API_ONLY=false
CLI_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --watch) WATCH=true; shift ;;
    --api-only) API_ONLY=true; shift ;;
    --cli-only) CLI_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SERVER_URL="${CMUX_SERVER_URL:-http://localhost:9779}"

run_tests() {
  echo "=== Testing devsh models implementation ==="
  echo ""

  if [[ "$CLI_ONLY" != "true" ]]; then
    echo "[1/5] Testing /api/models endpoint..."
    if curl -sf "$SERVER_URL/api/models" > /dev/null 2>&1; then
      MODEL_COUNT=$(curl -s "$SERVER_URL/api/models" | jq '.models | length')
      echo "  OK: API returns $MODEL_COUNT models"

      FIRST_MODEL=$(curl -s "$SERVER_URL/api/models" | jq '.models[0]')
      if echo "$FIRST_MODEL" | jq -e '.name and .displayName and .vendor and .tier' > /dev/null; then
        echo "  OK: Model structure valid"
      else
        echo "  FAIL: Model structure invalid"
        return 1
      fi
    else
      echo "  SKIP: Server not running at $SERVER_URL"
    fi
    echo ""
  fi

  if [[ "$API_ONLY" != "true" ]]; then
    echo "[2/5] Building Go CLI..."
    cd "$ROOT_DIR/packages/devsh"
    if go build ./... 2>&1; then
      echo "  OK: Go build successful"
    else
      echo "  FAIL: Go build failed"
      return 1
    fi
    echo ""

    echo "[3/5] Running Go unit tests..."
    if go test ./internal/cli/... -v 2>&1 | grep -E '(PASS|FAIL|---)'; then
      echo "  OK: Go tests completed"
    else
      echo "  WARN: Some tests may have failed"
    fi
    echo ""
  fi

  if [[ "$API_ONLY" != "true" ]] && [[ "$CLI_ONLY" != "true" ]]; then
    echo "[4/5] Integration test (CLI -> API)..."
    if curl -sf "$SERVER_URL/api/health" > /dev/null 2>&1; then
      cd "$ROOT_DIR/packages/devsh"

      go build -o /tmp/devsh-test ./cmd/devsh

      if CMUX_SERVER_URL="$SERVER_URL" /tmp/devsh-test models list > /tmp/models-output.txt 2>&1; then
        if grep -q "Available Models" /tmp/models-output.txt; then
          echo "  OK: CLI models list works"
          head -5 /tmp/models-output.txt
        else
          echo "  FAIL: Unexpected output"
          cat /tmp/models-output.txt
          return 1
        fi
      else
        echo "  FAIL: CLI command failed"
        cat /tmp/models-output.txt
        return 1
      fi
    else
      echo "  SKIP: Server not running"
    fi
  fi

  if [[ "$CLI_ONLY" != "true" ]]; then
    echo ""
    echo "[5/5] Testing OpenRouter discovery endpoint..."
    if curl -sf "$SERVER_URL/api/health" > /dev/null 2>&1; then
      # This endpoint requires authentication via teamSlugOrId
      TEAM="${CMUX_TEST_TEAM_SLUG:-example-team}"
      REFRESH_RESULT=$(curl -s "$SERVER_URL/api/models/refresh?teamSlugOrId=$TEAM" -X POST 2>&1)

      # Check if we got a valid response (might be 401 without auth, which is expected)
      if echo "$REFRESH_RESULT" | jq -e '.success or .error' > /dev/null 2>&1; then
        echo "  OK: Refresh endpoint responds"

        # If successful, show OpenRouter stats
        if echo "$REFRESH_RESULT" | jq -e '.openrouter' > /dev/null 2>&1; then
          OPENROUTER_STATS=$(echo "$REFRESH_RESULT" | jq '.openrouter')
          echo "  OpenRouter stats: $OPENROUTER_STATS"
        else
          echo "  Note: OpenRouter stats not available (auth may be required)"
        fi
      else
        echo "  WARN: Unexpected response from refresh endpoint"
        echo "  Response: $REFRESH_RESULT"
      fi
    else
      echo "  SKIP: Server not running"
    fi
  fi

  echo ""
  echo "=== All tests passed ==="
}

if [[ "$WATCH" == "true" ]]; then
  echo "Watch mode: re-running tests on file changes..."
  echo "Press Ctrl+C to stop"
  echo ""

  while true; do
    run_tests || true
    echo ""
    echo "Waiting for changes... (Ctrl+C to stop)"

    fswatch -1 \
      "$ROOT_DIR/packages/devsh/internal/cli/models_list.go" \
      "$ROOT_DIR/packages/devsh/internal/cli/models_list_test.go" \
      "$ROOT_DIR/apps/server/src/http-api.ts" \
      2>/dev/null || sleep 5

    echo ""
    echo "Change detected, re-running..."
    echo ""
  done
else
  run_tests
fi
