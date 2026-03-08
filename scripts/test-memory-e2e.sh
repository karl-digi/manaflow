#!/usr/bin/env bash
# E2E Test: Agent Memory Protocol Full Flow
#
# Tests the complete memory flow:
# 1. Create a task via CLI
# 2. Wait for completion (or timeout)
# 3. Verify memory via CLI (devsh task memory)
# 4. Verify memory via HTTP API
#
# Usage:
#   ./scripts/test-memory-e2e.sh                     # Run with defaults
#   ./scripts/test-memory-e2e.sh --repo owner/repo   # Specify repository
#   ./scripts/test-memory-e2e.sh --skip-spawn        # Use existing task
#   ./scripts/test-memory-e2e.sh --task-id <id>      # Test specific task
#
# Required Environment:
#   - Authenticated devsh CLI (devsh auth login)
#   - CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL (for API tests)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/logs/memory-e2e-test.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
SKIP_SPAWN=false
TASK_ID=""
REPO=""
AGENT="claude/haiku-4.5"
WAIT_TIMEOUT=300  # 5 minutes
POLL_INTERVAL=10  # seconds

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo|-r)
      REPO="$2"
      shift 2
      ;;
    --task-id|-t)
      TASK_ID="$2"
      SKIP_SPAWN=true
      shift 2
      ;;
    --skip-spawn)
      SKIP_SPAWN=true
      shift
      ;;
    --agent|-a)
      AGENT="$2"
      shift 2
      ;;
    --timeout)
      WAIT_TIMEOUT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --repo, -r <owner/repo>  Repository for test task"
      echo "  --task-id, -t <id>       Use existing task ID"
      echo "  --skip-spawn             Skip spawning new task"
      echo "  --agent, -a <agent>      Agent to use (default: claude/haiku-4.5)"
      echo "  --timeout <seconds>      Wait timeout (default: 300)"
      echo "  -h, --help               Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Logging functions
log() {
  local level="$1"
  shift
  local timestamp
  timestamp="$(date -Iseconds)"
  echo "[${timestamp}] [${level}] $*" >> "${LOG_FILE}"
  case "${level}" in
    INFO) echo -e "${BLUE}[INFO]${NC} $*" ;;
    PASS) echo -e "${GREEN}[PASS]${NC} $*" ;;
    FAIL) echo -e "${RED}[FAIL]${NC} $*" ;;
    WARN) echo -e "${YELLOW}[WARN]${NC} $*" ;;
    *) echo "[$level] $*" ;;
  esac
}

info() { log INFO "$@"; }
pass() { log PASS "$@"; }
fail() { log FAIL "$@"; }
warn() { log WARN "$@"; }

# Test result tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

record_pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  pass "$@"
}

record_fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  fail "$@"
}

record_skip() {
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  warn "SKIP: $*"
}

# Get CLI binary path
get_cli_binary() {
  if command -v devsh >/dev/null 2>&1; then
    echo "devsh"
  elif [[ -f "$HOME/.local/bin/devsh" ]]; then
    echo "$HOME/.local/bin/devsh"
  else
    echo ""
  fi
}

# Wait for task to complete
wait_for_task_completion() {
  local task_id="$1"
  local timeout="$2"
  local cli_bin="$3"
  local start_time
  start_time=$(date +%s)

  info "Waiting for task ${task_id} to complete (timeout: ${timeout}s)..."

  while true; do
    local now
    now=$(date +%s)
    local elapsed=$((now - start_time))

    if [[ $elapsed -ge $timeout ]]; then
      warn "Timeout waiting for task completion after ${elapsed}s"
      return 1
    fi

    # Get task status
    local task_json
    task_json=$("${cli_bin}" task list --json 2>/dev/null || echo "[]")

    local status
    status=$(echo "${task_json}" | jq -r --arg id "${task_id}" '.[] | select(.id == $id) | .status // "unknown"' 2>/dev/null || echo "unknown")

    if [[ "${status}" == "completed" ]] || [[ "${status}" == "stopped" ]]; then
      info "Task completed with status: ${status}"
      return 0
    fi

    if [[ "${status}" == "failed" ]] || [[ "${status}" == "error" ]]; then
      warn "Task failed with status: ${status}"
      return 0  # Still test memory even on failure
    fi

    info "Task status: ${status}, waiting... (${elapsed}s elapsed)"
    sleep "${POLL_INTERVAL}"
  done
}

# ============================================================================
# Test: CLI Memory Command
# ============================================================================
test_cli_memory_command() {
  local task_id="$1"
  local cli_bin="$2"

  info "=== Testing CLI Memory Command ==="

  # Test 1: Basic memory command with task ID
  info "Test: devsh task memory ${task_id}"
  local output
  if output=$("${cli_bin}" task memory "${task_id}" 2>&1); then
    if [[ -n "${output}" ]]; then
      record_pass "CLI memory command succeeded with output"
    else
      record_pass "CLI memory command succeeded (no memory synced yet)"
    fi
  else
    record_fail "CLI memory command failed: ${output}"
  fi

  # Test 2: Memory command with --type filter
  for mem_type in knowledge daily tasks mailbox; do
    info "Test: devsh task memory ${task_id} --type ${mem_type}"
    if output=$("${cli_bin}" task memory "${task_id}" --type "${mem_type}" 2>&1); then
      record_pass "CLI memory --type ${mem_type} succeeded"
    else
      record_fail "CLI memory --type ${mem_type} failed: ${output}"
    fi
  done

  # Test 3: Memory command with --json output
  info "Test: devsh task memory ${task_id} --json"
  if output=$("${cli_bin}" task memory "${task_id}" --json 2>&1); then
    # Verify it's valid JSON
    if echo "${output}" | jq . >/dev/null 2>&1; then
      record_pass "CLI memory --json produces valid JSON"
    else
      record_fail "CLI memory --json output is not valid JSON"
    fi
  else
    record_fail "CLI memory --json failed: ${output}"
  fi

  info "=== CLI Memory Tests Complete ==="
}

# ============================================================================
# Test: HTTP API Memory Endpoint
# ============================================================================
test_http_memory_endpoint() {
  local task_id="$1"
  local cli_bin="$2"

  info "=== Testing HTTP API Memory Endpoint ==="

  # Get the Convex site URL
  local convex_url="${CONVEX_SITE_URL:-}"
  if [[ -z "${convex_url}" ]] && [[ -n "${NEXT_PUBLIC_CONVEX_URL:-}" ]]; then
    convex_url="${NEXT_PUBLIC_CONVEX_URL//.convex.cloud/.convex.site}"
  fi

  if [[ -z "${convex_url}" ]]; then
    record_skip "HTTP API test: CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL not set"
    return
  fi

  # Get team slug from CLI
  local team_slug
  team_slug=$("${cli_bin}" team --json 2>/dev/null | jq -r '.[0].slug // empty' || echo "")
  if [[ -z "${team_slug}" ]]; then
    record_skip "HTTP API test: Could not determine team slug"
    return
  fi

  # Get task run ID from task
  local task_json
  task_json=$("${cli_bin}" task list --json 2>/dev/null || echo "[]")
  local task_run_id
  task_run_id=$(echo "${task_json}" | jq -r --arg id "${task_id}" '.[] | select(.id == $id) | .taskRunId // empty' 2>/dev/null || echo "")

  if [[ -z "${task_run_id}" ]]; then
    record_skip "HTTP API test: Could not find task run ID for task ${task_id}"
    return
  fi

  # Note: We can't easily test authenticated HTTP requests from bash without access tokens
  # The integration tests in TypeScript cover this better
  record_skip "HTTP API test: Use TypeScript integration tests for authenticated API testing"

  info "=== HTTP API Memory Tests Complete ==="
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "=== Memory E2E Test ===" > "${LOG_FILE}"
  echo "Started at: $(date -Iseconds)" >> "${LOG_FILE}"

  info "=== Agent Memory Protocol E2E Test ==="
  echo ""

  # Check CLI binary
  local cli_bin
  cli_bin="$(get_cli_binary)"
  if [[ -z "${cli_bin}" ]]; then
    info "Building devsh..."
    (cd "${PROJECT_DIR}" && make install-devsh-dev) || {
      fail "Failed to build devsh"
      exit 1
    }
    cli_bin="$HOME/.local/bin/devsh"
    export PATH="$HOME/.local/bin:$PATH"
  fi

  info "Using CLI: ${cli_bin}"

  # Check authentication
  if ! "${cli_bin}" team >/dev/null 2>&1; then
    fail "Not authenticated. Run: ${cli_bin} auth login"
    exit 1
  fi

  # Create or use existing task
  if [[ "${SKIP_SPAWN}" == false ]]; then
    if [[ -z "${REPO}" ]]; then
      fail "Repository required. Use --repo owner/repo"
      exit 1
    fi

    info "Creating test task..."
    local create_output
    create_output=$("${cli_bin}" task create \
      --repo "${REPO}" \
      --agent "${AGENT}" \
      "Test task for memory E2E validation - please add a test file" 2>&1) || {
      fail "Failed to create task: ${create_output}"
      exit 1
    }

    # Extract task ID from output
    TASK_ID=$(echo "${create_output}" | grep -oE '[a-z0-9]{24,}' | head -n 1 || true)
    if [[ -z "${TASK_ID}" ]]; then
      fail "Could not parse task ID from output"
      echo "${create_output}"
      exit 1
    fi

    info "Created task: ${TASK_ID}"
    echo "Task ID: ${TASK_ID}" >> "${LOG_FILE}"

    # Wait for task completion
    if ! wait_for_task_completion "${TASK_ID}" "${WAIT_TIMEOUT}" "${cli_bin}"; then
      warn "Task did not complete within timeout, testing memory anyway"
    fi
  else
    if [[ -z "${TASK_ID}" ]]; then
      fail "No task ID provided with --skip-spawn"
      exit 1
    fi
    info "Using existing task: ${TASK_ID}"
  fi

  # Run tests
  echo ""
  test_cli_memory_command "${TASK_ID}" "${cli_bin}"
  echo ""
  test_http_memory_endpoint "${TASK_ID}" "${cli_bin}"

  # Print summary
  echo ""
  info "=== Test Summary ==="
  echo -e "${GREEN}Passed: ${TESTS_PASSED}${NC}"
  echo -e "${RED}Failed: ${TESTS_FAILED}${NC}"
  echo -e "${YELLOW}Skipped: ${TESTS_SKIPPED}${NC}"

  # Log summary
  echo "" >> "${LOG_FILE}"
  echo "=== Summary ===" >> "${LOG_FILE}"
  echo "Passed: ${TESTS_PASSED}" >> "${LOG_FILE}"
  echo "Failed: ${TESTS_FAILED}" >> "${LOG_FILE}"
  echo "Skipped: ${TESTS_SKIPPED}" >> "${LOG_FILE}"
  echo "Completed at: $(date -Iseconds)" >> "${LOG_FILE}"

  # Exit with appropriate code
  if [[ ${TESTS_FAILED} -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
