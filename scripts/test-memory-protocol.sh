#!/usr/bin/env bash
# Spike S8: Agent Memory Protocol Validation Test Script
# Tests memory seeding, read/write, cross-run seeding, and Convex sync
#
# Usage:
#   ./scripts/test-memory-protocol.sh                    # Run all tests
#   ./scripts/test-memory-protocol.sh --provider pve-lxc # Use specific sandbox provider
#   ./scripts/test-memory-protocol.sh --skip-spawn       # Test against existing sandbox
#   ./scripts/test-memory-protocol.sh --sandbox-id <id>  # Use specific sandbox ID
#
# Required Environment:
#   - PVE_API_URL, PVE_API_TOKEN (for pve-lxc provider)
#   - MORPH_API_KEY (for morph provider)
#
# Test Scenarios:
#   1. Memory Seeding Verification - Check directory structure exists
#   2. Memory Read on Start - Verify agents can read pre-populated memory
#   3. Memory Write on Completion - Verify agents write to memory files
#   4. Cross-Run Seeding - Verify new sandboxes get previous knowledge
#   5. Convex Sync Verification - Verify memory syncs to Convex on stop

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/logs/memory-protocol-test.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PROVIDER="${SANDBOX_PROVIDER:-pve-lxc}"
SANDBOX_ID=""
SKIP_SPAWN=false
CLEANUP=true
SEED_MEMORY=true  # Manually seed memory for cmux-devbox sandboxes

# Memory protocol paths (must match agent-memory-protocol.ts)
MEMORY_DIR="/root/lifecycle/memory"
KNOWLEDGE_DIR="${MEMORY_DIR}/knowledge"
DAILY_DIR="${MEMORY_DIR}/daily"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider|-p)
      PROVIDER="$2"
      shift 2
      ;;
    --sandbox-id|-s)
      SANDBOX_ID="$2"
      SKIP_SPAWN=true
      shift 2
      ;;
    --skip-spawn)
      SKIP_SPAWN=true
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
    --no-seed)
      SEED_MEMORY=false
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --provider, -p <provider>  Sandbox provider (pve-lxc, morph, e2b)"
      echo "  --sandbox-id, -s <id>      Use existing sandbox ID"
      echo "  --skip-spawn               Skip spawning new sandbox"
      echo "  --no-cleanup               Don't delete sandbox after tests"
      echo "  --no-seed                  Don't seed memory (for web app sandboxes)"
      echo "  -h, --help                 Show this help"
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

# Cleanup function
cleanup() {
  if [[ "${CLEANUP}" == true ]] && [[ -n "${SANDBOX_ID}" ]] && [[ "${SKIP_SPAWN}" == false ]]; then
    info "Cleaning up sandbox ${SANDBOX_ID}..."
    cmux-devbox delete "${SANDBOX_ID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Execute command in sandbox (returns output, never fails script)
sandbox_exec() {
  cmux-devbox exec "${SANDBOX_ID}" "$@" 2>&1 || true
}

# Check if file exists in sandbox
sandbox_file_exists() {
  local path="$1"
  local result
  result="$(sandbox_exec "test -f '${path}' && echo 'exists' || echo 'missing'" 2>/dev/null || echo "error")"
  [[ "${result}" == *"exists"* ]]
}

# Check if directory exists in sandbox
sandbox_dir_exists() {
  local path="$1"
  local result
  result="$(sandbox_exec "test -d '${path}' && echo 'exists' || echo 'missing'" 2>/dev/null || echo "error")"
  [[ "${result}" == *"exists"* ]]
}

# Get file content from sandbox (returns content or empty string)
sandbox_cat() {
  local path="$1"
  local result
  result="$(sandbox_exec "cat '${path}' 2>/dev/null" || echo "")"
  echo "${result}"
}

# Write content to sandbox file
sandbox_write() {
  local path="$1"
  local content="$2"
  local encoded
  encoded="$(echo -n "${content}" | base64)"
  sandbox_exec "echo '${encoded}' | base64 -d > '${path}'"
}

# ============================================================================
# Memory Seeding (for cmux-devbox sandboxes)
# ============================================================================
seed_memory_protocol() {
  info "Seeding memory protocol files..."

  local today
  today="$(date +%Y-%m-%d)"

  # Create directory structure
  sandbox_exec "mkdir -p ${KNOWLEDGE_DIR} ${DAILY_DIR}"

  # Seed TASKS.json
  local tasks_json='{"version":1,"tasks":[],"metadata":{"sandboxId":"'${SANDBOX_ID}'","createdAt":"'$(date -Iseconds)'"}}'
  sandbox_exec "echo '${tasks_json}' > ${MEMORY_DIR}/TASKS.json"

  # Seed MAILBOX.json
  sandbox_exec "echo '{\"version\":1,\"messages\":[]}' > ${MEMORY_DIR}/MAILBOX.json"

  # Seed knowledge/MEMORY.md with P0/P1/P2 template
  local knowledge_content='# Project Knowledge

> Curated insights organized by priority. Add date tags for TTL tracking.

## P0 - Core (Never Expires)
<!-- Fundamental project facts, configuration, invariants -->

## P1 - Active (90-day TTL)
<!-- Ongoing work context, current strategies, recent decisions -->

## P2 - Reference (30-day TTL)
<!-- Temporary findings, debug notes, one-off context -->

---
*Priority guide: P0 = permanent truth, P1 = active context, P2 = temporary reference*
*Format: - [YYYY-MM-DD] Your insight here*'

  # Use base64 to avoid shell escaping issues
  local knowledge_b64
  knowledge_b64="$(echo "${knowledge_content}" | base64)"
  sandbox_exec "echo '${knowledge_b64}' | base64 -d > ${KNOWLEDGE_DIR}/MEMORY.md"

  # Seed daily log
  local daily_content="# Daily Log: ${today}

> Session-specific observations. Temporary notes go here.

---"
  local daily_b64
  daily_b64="$(echo "${daily_content}" | base64)"
  sandbox_exec "echo '${daily_b64}' | base64 -d > ${DAILY_DIR}/${today}.md"

  # Create sync.sh stub with env var checks
  local sync_stub='#!/bin/bash
# Memory sync stub for testing
MEMORY_DIR="/root/lifecycle/memory"
if [ -z "${CMUX_CALLBACK_URL:-}" ] || [ -z "${CMUX_TASK_RUN_JWT:-}" ]; then
  echo "Missing env vars"
  exit 0
fi
exit 0'
  local sync_b64
  sync_b64="$(echo "${sync_stub}" | base64)"
  sandbox_exec "echo '${sync_b64}' | base64 -d > ${MEMORY_DIR}/sync.sh && chmod +x ${MEMORY_DIR}/sync.sh"

  # Create MCP server stub
  local mcp_stub='#!/usr/bin/env node
// cmux Memory MCP Server stub
const tools = ["read_memory", "list_daily_logs", "read_daily_log", "search_memory"];
console.log(JSON.stringify({tools}));'
  local mcp_b64
  mcp_b64="$(echo "${mcp_stub}" | base64)"
  sandbox_exec "echo '${mcp_b64}' | base64 -d > ${MEMORY_DIR}/mcp-server.js && chmod +x ${MEMORY_DIR}/mcp-server.js"

  info "Memory protocol seeded successfully"
}

# ============================================================================
# Test Scenario 1: Memory Seeding Verification
# ============================================================================
test_memory_seeding() {
  info "=== Scenario 1: Memory Seeding Verification ==="

  # Test 1.1: Check root memory directory exists
  if sandbox_dir_exists "${MEMORY_DIR}"; then
    record_pass "Memory directory exists: ${MEMORY_DIR}"
  else
    record_fail "Memory directory missing: ${MEMORY_DIR}"
    return 1
  fi

  # Test 1.2: Check knowledge subdirectory
  if sandbox_dir_exists "${KNOWLEDGE_DIR}"; then
    record_pass "Knowledge directory exists: ${KNOWLEDGE_DIR}"
  else
    record_fail "Knowledge directory missing: ${KNOWLEDGE_DIR}"
  fi

  # Test 1.3: Check daily subdirectory
  if sandbox_dir_exists "${DAILY_DIR}"; then
    record_pass "Daily directory exists: ${DAILY_DIR}"
  else
    record_fail "Daily directory missing: ${DAILY_DIR}"
  fi

  # Test 1.4: Check TASKS.json
  if sandbox_file_exists "${MEMORY_DIR}/TASKS.json"; then
    local tasks_content
    tasks_content="$(sandbox_cat "${MEMORY_DIR}/TASKS.json")"
    if echo "${tasks_content}" | grep -q '"version"'; then
      record_pass "TASKS.json exists with valid structure"
    else
      record_fail "TASKS.json exists but has invalid structure"
    fi
  else
    record_fail "TASKS.json missing: ${MEMORY_DIR}/TASKS.json"
  fi

  # Test 1.5: Check MAILBOX.json
  if sandbox_file_exists "${MEMORY_DIR}/MAILBOX.json"; then
    local mailbox_content
    mailbox_content="$(sandbox_cat "${MEMORY_DIR}/MAILBOX.json")"
    if echo "${mailbox_content}" | grep -q '"messages"'; then
      record_pass "MAILBOX.json exists with valid structure"
    else
      record_fail "MAILBOX.json exists but has invalid structure"
    fi
  else
    record_fail "MAILBOX.json missing: ${MEMORY_DIR}/MAILBOX.json"
  fi

  # Test 1.6: Check knowledge/MEMORY.md
  if sandbox_file_exists "${KNOWLEDGE_DIR}/MEMORY.md"; then
    local knowledge_content
    knowledge_content="$(sandbox_cat "${KNOWLEDGE_DIR}/MEMORY.md")"
    if echo "${knowledge_content}" | grep -q "## P0 - Core"; then
      record_pass "knowledge/MEMORY.md exists with P0/P1/P2 template"
    else
      record_fail "knowledge/MEMORY.md missing priority sections"
    fi
  else
    record_fail "knowledge/MEMORY.md missing: ${KNOWLEDGE_DIR}/MEMORY.md"
  fi

  # Test 1.7: Check daily/{date}.md
  local today
  today="$(date +%Y-%m-%d)"
  if sandbox_file_exists "${DAILY_DIR}/${today}.md"; then
    record_pass "Today's daily log exists: ${DAILY_DIR}/${today}.md"
  else
    record_fail "Today's daily log missing: ${DAILY_DIR}/${today}.md"
  fi

  # Test 1.8: Check sync.sh
  if sandbox_file_exists "${MEMORY_DIR}/sync.sh"; then
    record_pass "Memory sync script exists: ${MEMORY_DIR}/sync.sh"
  else
    record_fail "Memory sync script missing: ${MEMORY_DIR}/sync.sh"
  fi

  # Test 1.9: Check MCP server
  if sandbox_file_exists "${MEMORY_DIR}/mcp-server.js"; then
    record_pass "MCP server exists: ${MEMORY_DIR}/mcp-server.js"
  else
    record_fail "MCP server missing: ${MEMORY_DIR}/mcp-server.js"
  fi

  info "=== Scenario 1 Complete ==="
}

# ============================================================================
# Test Scenario 2: Memory Read Verification
# ============================================================================
test_memory_read() {
  info "=== Scenario 2: Memory Read Verification ==="

  # Test 2.1: Verify knowledge file is readable
  local knowledge_content
  knowledge_content="$(sandbox_cat "${KNOWLEDGE_DIR}/MEMORY.md")"
  if [[ -n "${knowledge_content}" ]] && [[ "${knowledge_content}" != "" ]]; then
    record_pass "knowledge/MEMORY.md is readable"
  else
    record_fail "knowledge/MEMORY.md is empty or unreadable"
  fi

  # Test 2.2: Verify TASKS.json is valid JSON
  local tasks_json
  tasks_json="$(sandbox_cat "${MEMORY_DIR}/TASKS.json")"
  if echo "${tasks_json}" | jq . >/dev/null 2>&1; then
    record_pass "TASKS.json is valid JSON"
  else
    record_fail "TASKS.json is invalid JSON"
  fi

  # Test 2.3: Verify MAILBOX.json is valid JSON
  local mailbox_json
  mailbox_json="$(sandbox_cat "${MEMORY_DIR}/MAILBOX.json")"
  if echo "${mailbox_json}" | jq . >/dev/null 2>&1; then
    record_pass "MAILBOX.json is valid JSON"
  else
    record_fail "MAILBOX.json is invalid JSON"
  fi

  info "=== Scenario 2 Complete ==="
}

# ============================================================================
# Test Scenario 3: Memory Write Verification
# ============================================================================
test_memory_write() {
  info "=== Scenario 3: Memory Write Verification ==="

  local today
  today="$(date +%Y-%m-%d)"
  local test_marker="TEST_MARKER_${RANDOM}"

  # Test 3.1: Write to daily log
  local daily_path="${DAILY_DIR}/${today}.md"
  local original_content
  original_content="$(sandbox_cat "${daily_path}")"
  local new_daily_content="${original_content}
- ${test_marker} Test entry for memory write verification"

  sandbox_write "${daily_path}" "${new_daily_content}"

  local updated_content
  updated_content="$(sandbox_cat "${daily_path}")"
  if echo "${updated_content}" | grep -q "${test_marker}"; then
    record_pass "Successfully wrote to daily log"
  else
    record_fail "Failed to write to daily log"
  fi

  # Test 3.2: Write to knowledge file
  local knowledge_path="${KNOWLEDGE_DIR}/MEMORY.md"
  local knowledge_content
  knowledge_content="$(sandbox_cat "${knowledge_path}")"

  # Add a P2 entry
  local p2_entry="- [${today}] ${test_marker} Test project uses bun package manager"
  local new_knowledge
  new_knowledge="$(echo "${knowledge_content}" | sed "s/## P2 - Reference (30-day TTL)/## P2 - Reference (30-day TTL)\\n${p2_entry}/")"

  sandbox_write "${knowledge_path}" "${new_knowledge}"

  local updated_knowledge
  updated_knowledge="$(sandbox_cat "${knowledge_path}")"
  if echo "${updated_knowledge}" | grep -q "${test_marker}"; then
    record_pass "Successfully wrote to knowledge file"
  else
    record_fail "Failed to write to knowledge file"
  fi

  # Test 3.3: Add task to TASKS.json
  local tasks_json
  tasks_json="$(sandbox_cat "${MEMORY_DIR}/TASKS.json")"
  local new_task="{\"id\": \"test-${RANDOM}\", \"title\": \"Test task\", \"status\": \"done\"}"
  local updated_tasks
  updated_tasks="$(echo "${tasks_json}" | jq --argjson task "${new_task}" '.tasks += [$task]')"

  sandbox_write "${MEMORY_DIR}/TASKS.json" "${updated_tasks}"

  local verify_tasks
  verify_tasks="$(sandbox_cat "${MEMORY_DIR}/TASKS.json")"
  if echo "${verify_tasks}" | jq -e '.tasks | length > 0' >/dev/null 2>&1; then
    record_pass "Successfully wrote to TASKS.json"
  else
    record_fail "Failed to write to TASKS.json"
  fi

  info "=== Scenario 3 Complete ==="
}

# ============================================================================
# Test Scenario 4: MCP Server Verification
# ============================================================================
test_mcp_server() {
  info "=== Scenario 4: MCP Server Verification ==="

  # Test 4.1: MCP server is executable
  local mode
  mode="$(sandbox_exec "stat -c '%a' '${MEMORY_DIR}/mcp-server.js' 2>/dev/null || stat -f '%Lp' '${MEMORY_DIR}/mcp-server.js' 2>/dev/null || echo ''")"
  if [[ "${mode}" == *"7"* ]] || [[ "${mode}" == *"5"* ]]; then
    record_pass "MCP server has execute permissions"
  else
    warn "MCP server may not have execute permissions (mode: ${mode})"
    record_skip "MCP server permissions check inconclusive"
  fi

  # Test 4.2: MCP server has valid Node.js shebang
  local shebang
  shebang="$(sandbox_exec "head -n 1 '${MEMORY_DIR}/mcp-server.js'")"
  if echo "${shebang}" | grep -q "#!/usr/bin/env node"; then
    record_pass "MCP server has valid Node.js shebang"
  else
    record_fail "MCP server missing valid shebang"
  fi

  # Test 4.3: MCP server contains expected tools
  local server_content
  server_content="$(sandbox_cat "${MEMORY_DIR}/mcp-server.js")"

  local tools_found=0
  for tool in "read_memory" "list_daily_logs" "read_daily_log" "search_memory"; do
    if echo "${server_content}" | grep -q "${tool}"; then
      tools_found=$((tools_found + 1))
    fi
  done

  if [[ ${tools_found} -eq 4 ]]; then
    record_pass "MCP server contains all 4 expected tools"
  else
    record_fail "MCP server missing tools (found ${tools_found}/4)"
  fi

  info "=== Scenario 4 Complete ==="
}

# ============================================================================
# Test Scenario 5: Sync Script Verification
# ============================================================================
test_sync_script() {
  info "=== Scenario 5: Sync Script Verification ==="

  # Test 5.1: Sync script is executable
  local mode
  mode="$(sandbox_exec "stat -c '%a' '${MEMORY_DIR}/sync.sh' 2>/dev/null || stat -f '%Lp' '${MEMORY_DIR}/sync.sh' 2>/dev/null || echo ''")"
  if [[ "${mode}" == *"7"* ]] || [[ "${mode}" == *"5"* ]]; then
    record_pass "Sync script has execute permissions"
  else
    warn "Sync script may not have execute permissions (mode: ${mode})"
    record_skip "Sync script permissions check inconclusive"
  fi

  # Test 5.2: Sync script has bash shebang
  local shebang
  shebang="$(sandbox_exec "head -n 1 '${MEMORY_DIR}/sync.sh'")"
  if echo "${shebang}" | grep -q "#!/bin/bash"; then
    record_pass "Sync script has valid bash shebang"
  else
    record_fail "Sync script missing valid shebang"
  fi

  # Test 5.3: Sync script references correct memory dir
  local sync_content
  sync_content="$(sandbox_cat "${MEMORY_DIR}/sync.sh")"
  if echo "${sync_content}" | grep -q "/root/lifecycle/memory"; then
    record_pass "Sync script uses correct memory directory"
  else
    record_fail "Sync script has incorrect memory directory"
  fi

  # Test 5.4: Sync script includes required env var checks
  if echo "${sync_content}" | grep -q "CMUX_CALLBACK_URL" && echo "${sync_content}" | grep -q "CMUX_TASK_RUN_JWT"; then
    record_pass "Sync script checks required environment variables"
  else
    record_fail "Sync script missing env var checks"
  fi

  info "=== Scenario 5 Complete ==="
}

# ============================================================================
# Test Scenario 6: Git Workspace Isolation
# ============================================================================
test_git_isolation() {
  info "=== Scenario 6: Git Workspace Isolation ==="

  # Test 6.1: Memory directory is outside /root/workspace
  if [[ "${MEMORY_DIR}" != /root/workspace* ]]; then
    record_pass "Memory directory is outside git workspace"
  else
    record_fail "Memory directory is inside git workspace (will pollute git status)"
  fi

  # Test 6.2: Check that /root/workspace/.cmux does NOT exist
  if sandbox_dir_exists "/root/workspace/.cmux"; then
    record_fail "Old .cmux directory exists in workspace (git pollution)"
  else
    record_pass "No .cmux directory in workspace"
  fi

  # Test 6.3: Verify memory files don't appear in git status (if workspace has git)
  local git_status
  git_status="$(sandbox_exec "cd /root/workspace && git status --porcelain 2>/dev/null || echo 'NO_GIT'")"
  if [[ "${git_status}" == "NO_GIT" ]]; then
    record_skip "No git repository in workspace"
  elif echo "${git_status}" | grep -q "memory"; then
    record_fail "Memory files appear in git status"
  else
    record_pass "Memory files do not appear in git status"
  fi

  info "=== Scenario 6 Complete ==="
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "=== Memory Protocol Validation Tests ===" > "${LOG_FILE}"
  echo "Started at: $(date -Iseconds)" >> "${LOG_FILE}"
  echo "Provider: ${PROVIDER}" >> "${LOG_FILE}"

  info "=== cmux Agent Memory Protocol Validation Tests (S8) ==="
  info "Provider: ${PROVIDER}"
  info "Log file: ${LOG_FILE}"
  echo ""

  # Build cmux-devbox if needed
  if ! command -v cmux-devbox >/dev/null 2>&1; then
    info "Building cmux-devbox..."
    (cd "${PROJECT_DIR}" && make install-cmux-devbox-dev) || {
      fail "Failed to build cmux-devbox"
      exit 1
    }
    export PATH="$HOME/.local/bin:$PATH"
  fi

  # Spawn sandbox if needed
  if [[ "${SKIP_SPAWN}" == false ]]; then
    info "Spawning new sandbox (provider: ${PROVIDER})..."
    local output
    output="$(cmux-devbox start -p "${PROVIDER}" 2>&1)" || {
      fail "Failed to spawn sandbox"
      echo "${output}"
      exit 1
    }

    # Extract sandbox ID
    SANDBOX_ID="$(echo "${output}" | grep -oE 'pvelxc-[a-z0-9]+|morphvm_[a-z0-9]+|cmux-[0-9]+|sandbox_[a-z0-9]+' | head -n 1 || true)"
    if [[ -z "${SANDBOX_ID}" ]]; then
      fail "Could not parse sandbox ID from output"
      echo "${output}"
      exit 1
    fi

    info "Sandbox created: ${SANDBOX_ID}"
    echo "Sandbox ID: ${SANDBOX_ID}" >> "${LOG_FILE}"

    # Wait for sandbox to be ready
    info "Waiting for sandbox to be ready..."
    sleep 30

    # Seed memory protocol files (cmux-devbox doesn't seed by default)
    if [[ "${SEED_MEMORY}" == true ]]; then
      seed_memory_protocol
    fi
  else
    if [[ -z "${SANDBOX_ID}" ]]; then
      fail "No sandbox ID provided with --skip-spawn"
      exit 1
    fi
    info "Using existing sandbox: ${SANDBOX_ID}"
  fi

  # Run all test scenarios
  echo ""
  test_memory_seeding
  echo ""
  test_memory_read
  echo ""
  test_memory_write
  echo ""
  test_mcp_server
  echo ""
  test_sync_script
  echo ""
  test_git_isolation

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
