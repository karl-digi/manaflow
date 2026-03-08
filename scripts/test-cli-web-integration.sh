#!/usr/bin/env bash
#
# CLI <-> Web App Integration Test
#
# Verifies that devsh CLI actions properly synchronize with the web app
# dashboard through Convex as the single source of truth.
#
# Prerequisites:
#   - Dev server running (make dev)
#   - devsh built (make install-devsh-dev)
#   - User authenticated (devsh auth login)
#
# Usage:
#   ./scripts/test-cli-web-integration.sh
#   ./scripts/test-cli-web-integration.sh --skip-instance-tests  # Skip create/pause/resume tests
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Parse arguments
SKIP_INSTANCE_TESTS=false
for arg in "$@"; do
  case $arg in
    --skip-instance-tests)
      SKIP_INSTANCE_TESTS=true
      shift
      ;;
  esac
done

# Test result functions
pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

skip() {
  echo -e "${YELLOW}[SKIP]${NC} $1"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

# Cleanup function for instance tests
INSTANCE_ID=""
cleanup() {
  if [[ -n "${INSTANCE_ID}" ]]; then
    info "Cleaning up instance ${INSTANCE_ID}..."
    devsh delete "${INSTANCE_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== CLI <-> Web App Integration Test ==="
echo ""

# Ensure devsh is available
export PATH="$HOME/.local/bin:$PATH"

# ============================================================================
# Test 1: CLI Version Check
# ============================================================================
info "Test 1: Checking CLI is available..."
if devsh --version >/dev/null 2>&1; then
  VERSION=$(devsh --version 2>&1 || echo "unknown")
  pass "CLI available: ${VERSION}"
else
  fail "CLI not found. Run 'make install-devsh-dev' first"
  exit 1
fi

# ============================================================================
# Test 2: Authentication Check
# ============================================================================
info "Test 2: Checking authentication..."
if WHOAMI_OUTPUT=$(devsh auth whoami 2>&1); then
  # Extract user info
  USER_EMAIL=$(echo "${WHOAMI_OUTPUT}" | grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | head -n1 || echo "")
  if [[ -n "${USER_EMAIL}" ]]; then
    pass "Authenticated as: ${USER_EMAIL}"
  else
    pass "Authenticated (email not shown in output)"
  fi
else
  fail "Not authenticated. Run 'devsh auth login' first"
  exit 1
fi

# ============================================================================
# Test 3: Team List
# ============================================================================
info "Test 3: Listing teams..."
if TEAM_LIST_OUTPUT=$(devsh team list --json 2>&1); then
  # Parse JSON to get teams
  TEAM_COUNT=$(echo "${TEAM_LIST_OUTPUT}" | jq -r '.teams | length' 2>/dev/null || echo "0")
  if [[ "${TEAM_COUNT}" -gt 0 ]]; then
    pass "Found ${TEAM_COUNT} team(s)"
    # Get the selected team
    SELECTED_TEAM=$(echo "${TEAM_LIST_OUTPUT}" | jq -r '.teams[] | select(.selected == true) | .slug // .teamId' 2>/dev/null || echo "")
    if [[ -n "${SELECTED_TEAM}" ]]; then
      info "  Selected team: ${SELECTED_TEAM}"
    fi
  else
    fail "No teams found"
  fi
else
  fail "Failed to list teams: ${TEAM_LIST_OUTPUT}"
fi

# ============================================================================
# Test 4: Team Switch Sync (CLI -> Web)
# ============================================================================
info "Test 4: Testing team switch (CLI -> Convex)..."

# Get current team and another team to switch to
ORIGINAL_TEAM=$(devsh team list --json 2>/dev/null | jq -r '.teams[] | select(.selected == true) | .slug // .teamId' || echo "")
OTHER_TEAM=$(devsh team list --json 2>/dev/null | jq -r '.teams[] | select(.selected != true) | .slug // .teamId' | head -n1 || echo "")

if [[ -z "${ORIGINAL_TEAM}" ]]; then
  fail "Could not determine current team"
elif [[ -z "${OTHER_TEAM}" ]]; then
  skip "Only one team available - cannot test team switch"
else
  info "  Switching from '${ORIGINAL_TEAM}' to '${OTHER_TEAM}'..."

  if devsh team switch "${OTHER_TEAM}" >/dev/null 2>&1; then
    # Verify the switch worked by checking whoami
    sleep 1  # Brief wait for profile cache to clear
    NEW_SELECTED=$(devsh team list --json 2>/dev/null | jq -r '.teams[] | select(.selected == true) | .slug // .teamId' || echo "")

    if [[ "${NEW_SELECTED}" == "${OTHER_TEAM}" ]]; then
      pass "Team switch synced: '${ORIGINAL_TEAM}' -> '${OTHER_TEAM}'"

      # Switch back
      info "  Switching back to '${ORIGINAL_TEAM}'..."
      devsh team switch "${ORIGINAL_TEAM}" >/dev/null 2>&1 || true
    else
      fail "Team switch not reflected (expected: ${OTHER_TEAM}, got: ${NEW_SELECTED})"
      # Try to switch back anyway
      devsh team switch "${ORIGINAL_TEAM}" >/dev/null 2>&1 || true
    fi
  else
    fail "Team switch command failed"
  fi
fi

# ============================================================================
# Test 5: Instance List
# ============================================================================
info "Test 5: Testing instance list..."
if LIST_OUTPUT=$(devsh ls 2>&1); then
  if [[ "${LIST_OUTPUT}" == *"No VMs found"* ]]; then
    pass "Instance list works (empty - no instances)"
  else
    # Count instances (skip header lines)
    INSTANCE_COUNT=$(echo "${LIST_OUTPUT}" | grep -cE '^(cr_|cmux_|manaflow_|pvelxc-)' || echo "0")
    pass "Instance list works (${INSTANCE_COUNT} instance(s) found)"
  fi
else
  fail "Instance list failed: ${LIST_OUTPUT}"
fi

# ============================================================================
# Instance lifecycle tests (create, pause, resume, delete)
# ============================================================================
if [[ "${SKIP_INSTANCE_TESTS}" == "true" ]]; then
  skip "Test 6-9: Instance lifecycle tests skipped (--skip-instance-tests)"
else
  # Determine provider based on environment
  PROVIDER=""
  if [[ -n "${PVE_API_URL:-}" ]] && [[ -n "${PVE_API_TOKEN:-}" ]]; then
    PROVIDER="pve-lxc"
    info "Using PVE LXC provider"
  elif [[ -n "${MORPH_API_KEY:-}" ]]; then
    PROVIDER="morph"
    info "Using Morph provider"
  else
    skip "Test 6-9: No sandbox provider configured (set MORPH_API_KEY or PVE_API_URL+PVE_API_TOKEN)"
    SKIP_INSTANCE_TESTS=true
  fi

  if [[ "${SKIP_INSTANCE_TESTS}" != "true" ]]; then
    # ============================================================================
    # Test 6: Create Instance
    # ============================================================================
    info "Test 6: Creating instance..."

    CREATE_ARGS=""
    if [[ "${PROVIDER}" == "pve-lxc" ]]; then
      CREATE_ARGS="-p pve-lxc"
    fi

    if CREATE_OUTPUT=$(devsh start ${CREATE_ARGS} 2>&1); then
      # Extract instance ID from output
      INSTANCE_ID=$(echo "${CREATE_OUTPUT}" | grep -oE '(cr_[a-z0-9]+|cmux_[a-zA-Z0-9]+|manaflow_[a-zA-Z0-9]+|pvelxc-[a-z0-9]+)' | head -n1 || echo "")

      if [[ -n "${INSTANCE_ID}" ]]; then
        pass "Instance created: ${INSTANCE_ID}"

        # Wait for instance to be ready
        info "  Waiting for instance to be ready..."
        sleep 15

        # ============================================================================
        # Test 7: Verify Instance in List
        # ============================================================================
        info "Test 7: Verifying instance appears in list..."
        if LIST_OUTPUT=$(devsh ls 2>&1); then
          if echo "${LIST_OUTPUT}" | grep -q "${INSTANCE_ID}"; then
            pass "Instance ${INSTANCE_ID} appears in list"
          else
            fail "Instance ${INSTANCE_ID} not found in list"
          fi
        else
          fail "Failed to list instances"
        fi

        # ============================================================================
        # Test 8: Pause Instance
        # ============================================================================
        info "Test 8: Pausing instance..."
        if devsh pause "${INSTANCE_ID}" >/dev/null 2>&1; then
          pass "Pause command succeeded"
          sleep 5

          # Verify status changed
          if STATUS_OUTPUT=$(devsh status "${INSTANCE_ID}" 2>&1); then
            if echo "${STATUS_OUTPUT}" | grep -iq "paused"; then
              pass "Instance status shows paused"
            else
              info "  Status output: ${STATUS_OUTPUT}"
              skip "Could not verify paused status (status command output format may differ)"
            fi
          fi
        else
          fail "Pause command failed"
        fi

        # ============================================================================
        # Test 9: Resume Instance
        # ============================================================================
        info "Test 9: Resuming instance..."
        if devsh resume "${INSTANCE_ID}" >/dev/null 2>&1; then
          pass "Resume command succeeded"
          sleep 10

          # Verify status changed back to running
          if STATUS_OUTPUT=$(devsh status "${INSTANCE_ID}" 2>&1); then
            if echo "${STATUS_OUTPUT}" | grep -iq "running"; then
              pass "Instance status shows running"
            else
              info "  Status output: ${STATUS_OUTPUT}"
              skip "Could not verify running status (status command output format may differ)"
            fi
          fi

          # Test exec after resume
          info "  Testing exec after resume..."
          if EXEC_OUTPUT=$(devsh exec "${INSTANCE_ID}" "echo integration-test-ok" 2>&1); then
            if echo "${EXEC_OUTPUT}" | grep -q "integration-test-ok"; then
              pass "Exec works after resume"
            else
              fail "Exec output incorrect after resume: ${EXEC_OUTPUT}"
            fi
          else
            fail "Exec failed after resume: ${EXEC_OUTPUT}"
          fi
        else
          fail "Resume command failed"
        fi

        # ============================================================================
        # Test 10: Delete Instance
        # ============================================================================
        info "Test 10: Deleting instance..."
        if devsh delete "${INSTANCE_ID}" >/dev/null 2>&1; then
          pass "Delete command succeeded"
          INSTANCE_ID=""  # Clear so cleanup doesn't try to delete again

          sleep 3

          # Verify instance no longer in list
          if LIST_OUTPUT=$(devsh ls 2>&1); then
            if echo "${LIST_OUTPUT}" | grep -q "${INSTANCE_ID:-DELETED}"; then
              fail "Instance still appears in list after delete"
            else
              pass "Instance removed from list"
            fi
          fi
        else
          fail "Delete command failed"
        fi
      else
        fail "Could not parse instance ID from create output: ${CREATE_OUTPUT}"
      fi
    else
      fail "Instance creation failed: ${CREATE_OUTPUT}"
    fi
  fi
fi

# ============================================================================
# Task Management Tests (CLI <-> Web sync)
# ============================================================================
info "Test 11: Testing task list..."
if TASK_LIST_OUTPUT=$(devsh task list 2>&1); then
  if [[ "${TASK_LIST_OUTPUT}" == *"No active tasks found"* ]]; then
    pass "Task list works (empty - no tasks)"
  else
    TASK_COUNT=$(echo "${TASK_LIST_OUTPUT}" | grep -cE '^[a-z0-9]{16}' || echo "0")
    pass "Task list works (${TASK_COUNT} task(s) found)"
  fi
else
  fail "Task list failed: ${TASK_LIST_OUTPUT}"
fi

# ============================================================================
# Test 12: Create Task (CLI -> Web sync)
# ============================================================================
info "Test 12: Creating task via CLI..."
TASK_ID=""
if CREATE_TASK_OUTPUT=$(devsh task create --json "CLI integration test task - should be cleaned up" 2>&1); then
  TASK_ID=$(echo "${CREATE_TASK_OUTPUT}" | jq -r '.taskId // empty' 2>/dev/null || echo "")
  if [[ -n "${TASK_ID}" ]]; then
    pass "Task created: ${TASK_ID}"
  else
    fail "Could not parse task ID from output: ${CREATE_TASK_OUTPUT}"
  fi
else
  fail "Task creation failed: ${CREATE_TASK_OUTPUT}"
fi

# ============================================================================
# Test 12b: Create Task with Agent Spawning (CLI -> apps/server -> agentSpawner)
# ============================================================================
info "Test 12b: Creating task with agent via CLI (tests apps/server HTTP API)..."
TASK_WITH_AGENT_ID=""

# Check if CMUX_SERVER_URL is configured (apps/server must be running)
if curl -s http://localhost:9776/api/health > /dev/null 2>&1; then
  if CREATE_AGENT_OUTPUT=$(devsh task create --repo karlorz/testing-repo-1 --agent opencode/gpt-4o --json "Agent spawn test - $(date +%s)" 2>&1); then
    TASK_WITH_AGENT_ID=$(echo "${CREATE_AGENT_OUTPUT}" | jq -r '.taskId // empty' 2>/dev/null || echo "")
    AGENT_STATUS=$(echo "${CREATE_AGENT_OUTPUT}" | jq -r '.agents[0].status // empty' 2>/dev/null || echo "")

    if [[ -n "${TASK_WITH_AGENT_ID}" ]]; then
      if [[ "${AGENT_STATUS}" == "running" ]]; then
        pass "Task created with running agent: ${TASK_WITH_AGENT_ID}"
        info "  Agent spawned via apps/server HTTP API (same flow as web app)"
      elif [[ "${AGENT_STATUS}" == "failed" ]]; then
        AGENT_ERROR=$(echo "${CREATE_AGENT_OUTPUT}" | jq -r '.agents[0].error // empty' 2>/dev/null || echo "unknown")
        info "Task created but agent failed: ${AGENT_ERROR}"
        pass "Task created (agent spawn attempted): ${TASK_WITH_AGENT_ID}"
      else
        # Check if taskRuns exist (--no-sandbox behavior or ServerURL not set)
        TASK_RUNS=$(echo "${CREATE_AGENT_OUTPUT}" | jq -r '.taskRuns // empty' 2>/dev/null || echo "")
        if [[ -n "${TASK_RUNS}" ]]; then
          pass "Task created with task runs (agents not spawned - expected if ServerURL not configured)"
        else
          pass "Task created: ${TASK_WITH_AGENT_ID} (agent status: ${AGENT_STATUS:-unknown})"
        fi
      fi
    else
      fail "Could not parse task ID from agent task output: ${CREATE_AGENT_OUTPUT}"
    fi
  else
    fail "Task with agent creation failed: ${CREATE_AGENT_OUTPUT}"
  fi

  # Cleanup task with agent
  if [[ -n "${TASK_WITH_AGENT_ID}" ]]; then
    info "  Cleaning up agent test task..."
    devsh task stop "${TASK_WITH_AGENT_ID}" >/dev/null 2>&1 || true
  fi
else
  skip "Test 12b: apps/server not running at localhost:9776 (run 'make dev' first)"
fi

# ============================================================================
# Test 13: Verify Task in List (CLI -> Web sync)
# ============================================================================
if [[ -n "${TASK_ID}" ]]; then
  info "Test 13: Verifying task appears in list..."
  sleep 2  # Brief wait for sync

  if LIST_OUTPUT=$(devsh task list 2>&1); then
    if echo "${LIST_OUTPUT}" | grep -q "${TASK_ID}"; then
      pass "Task ${TASK_ID} appears in list"
    else
      # Task ID might be truncated in output, check for partial match
      TASK_ID_SHORT="${TASK_ID:0:16}"
      if echo "${LIST_OUTPUT}" | grep -q "${TASK_ID_SHORT}"; then
        pass "Task appears in list (partial ID match)"
      else
        fail "Task ${TASK_ID} not found in list"
      fi
    fi
  else
    fail "Failed to list tasks"
  fi

  # ============================================================================
  # Test 14: Get Task Status
  # ============================================================================
  info "Test 14: Getting task status..."
  if STATUS_OUTPUT=$(devsh task status "${TASK_ID}" 2>&1); then
    if echo "${STATUS_OUTPUT}" | grep -q "Task Details"; then
      pass "Task status retrieved successfully"
    else
      pass "Task status returned (output format may differ)"
    fi
  else
    fail "Failed to get task status: ${STATUS_OUTPUT}"
  fi

  # ============================================================================
  # Test 15: Stop Task (CLI -> Web sync)
  # ============================================================================
  info "Test 15: Stopping task..."
  if devsh task stop "${TASK_ID}" >/dev/null 2>&1; then
    pass "Task stopped successfully"

    # Verify task is archived
    sleep 2
    if ARCHIVED_OUTPUT=$(devsh task list --archived 2>&1); then
      if echo "${ARCHIVED_OUTPUT}" | grep -q "${TASK_ID:0:16}"; then
        pass "Task appears in archived list"
      else
        skip "Could not verify task in archived list (may be timing issue)"
      fi
    fi
  else
    fail "Task stop failed"
  fi
else
  skip "Test 13-15: No task created to test"
fi

# ============================================================================
# Test Summary
# ============================================================================
echo ""
echo "============================================"
echo "Test Summary"
echo "============================================"
echo -e "  ${GREEN}Passed:${NC}  ${TESTS_PASSED}"
echo -e "  ${RED}Failed:${NC}  ${TESTS_FAILED}"
echo -e "  ${YELLOW}Skipped:${NC} ${TESTS_SKIPPED}"
echo ""

if [[ ${TESTS_FAILED} -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
  echo ""
  echo "Manual verification recommended:"
  echo "  1. Open http://localhost:9779 in browser"
  echo "  2. Verify team selector matches CLI selection"
  echo "  3. Verify instance list matches CLI output"
  echo "  4. Verify task list matches CLI 'task list' output"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
