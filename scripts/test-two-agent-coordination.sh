#!/usr/bin/env bash
# Spike S2: Two-Agent Coordination Test Script
# Tests that two agents can coordinate via MAILBOX.json without orchestration infrastructure
#
# Usage:
#   ./scripts/test-two-agent-coordination.sh                    # Run full test
#   ./scripts/test-two-agent-coordination.sh --provider pve-lxc # Use specific sandbox provider
#   ./scripts/test-two-agent-coordination.sh --sandbox-id <id>  # Use existing sandbox
#
# Test Scenarios:
#   1. File Corruption Prevention - Concurrent writes don't corrupt MAILBOX.json
#   2. Message Delivery - Agent B receives Agent A's message
#   3. Message Types - handoff, request, status all work correctly
#   4. Broadcast Messages - "*" recipient reaches all agents

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/logs/two-agent-coordination-test.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
PROVIDER="${SANDBOX_PROVIDER:-pve-lxc}"
SANDBOX_ID=""
SKIP_SPAWN=false
CLEANUP=true

# Memory protocol paths
MEMORY_DIR="/root/lifecycle/memory"
MAILBOX_PATH="${MEMORY_DIR}/MAILBOX.json"

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
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --provider, -p <provider>  Sandbox provider (pve-lxc, morph, e2b)"
      echo "  --sandbox-id, -s <id>      Use existing sandbox ID"
      echo "  --skip-spawn               Skip spawning new sandbox"
      echo "  --no-cleanup               Don't delete sandbox after tests"
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
    devsh delete "${SANDBOX_ID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Execute command in sandbox
sandbox_exec() {
  devsh exec "${SANDBOX_ID}" "$@" 2>&1 || true
}

# Get file content from sandbox
sandbox_cat() {
  local path="$1"
  sandbox_exec "cat '${path}' 2>/dev/null" || echo ""
}

# Write content to sandbox file
sandbox_write() {
  local path="$1"
  local content="$2"
  local encoded
  encoded="$(echo -n "${content}" | base64)"
  sandbox_exec "echo '${encoded}' | base64 -d > '${path}'"
}

# Initialize mailbox
init_mailbox() {
  info "Initializing MAILBOX.json..."
  sandbox_exec "mkdir -p ${MEMORY_DIR}"
  local initial='{"version":1,"messages":[]}'
  sandbox_write "${MAILBOX_PATH}" "${initial}"
}

# Add message to mailbox (simulating agent behavior)
add_message() {
  local from="$1"
  local to="$2"
  local msg_type="$3"
  local message="$4"
  local msg_id="msg_$(uuidgen 2>/dev/null | tr -d '-' | head -c 12 || echo "$(date +%s)${RANDOM}")"

  local mailbox_content
  mailbox_content="$(sandbox_cat "${MAILBOX_PATH}")"

  # Create new message JSON
  local timestamp
  timestamp="$(date -Iseconds)"
  local new_msg="{\"id\":\"${msg_id}\",\"from\":\"${from}\",\"to\":\"${to}\",\"type\":\"${msg_type}\",\"message\":\"${message}\",\"timestamp\":\"${timestamp}\",\"read\":false}"

  # Add to mailbox using jq
  local updated
  updated="$(echo "${mailbox_content}" | jq --argjson msg "${new_msg}" '.messages += [$msg]')"

  sandbox_write "${MAILBOX_PATH}" "${updated}"
  echo "${msg_id}"
}

# ============================================================================
# Test Scenario 1: Mailbox File Integrity
# ============================================================================
test_mailbox_integrity() {
  info "=== Scenario 1: Mailbox File Integrity ==="

  # Test 1.1: Initial mailbox is valid JSON
  local content
  content="$(sandbox_cat "${MAILBOX_PATH}")"
  if echo "${content}" | jq . >/dev/null 2>&1; then
    record_pass "Initial mailbox is valid JSON"
  else
    record_fail "Initial mailbox is invalid JSON"
    return 1
  fi

  # Test 1.2: Add multiple messages rapidly
  info "Adding 5 messages rapidly..."
  for i in {1..5}; do
    add_message "agent-${i}" "*" "status" "Message ${i} from agent ${i}" >/dev/null
  done

  # Test 1.3: Verify mailbox still valid JSON after writes
  content="$(sandbox_cat "${MAILBOX_PATH}")"
  if echo "${content}" | jq . >/dev/null 2>&1; then
    record_pass "Mailbox valid JSON after multiple writes"
  else
    record_fail "Mailbox corrupted after multiple writes"
  fi

  # Test 1.4: Verify all 5 messages present
  local msg_count
  msg_count="$(echo "${content}" | jq '.messages | length')"
  if [[ "${msg_count}" -eq 5 ]]; then
    record_pass "All 5 messages present in mailbox"
  else
    record_fail "Expected 5 messages, found ${msg_count}"
  fi

  info "=== Scenario 1 Complete ==="
}

# ============================================================================
# Test Scenario 2: Message Delivery
# ============================================================================
test_message_delivery() {
  info "=== Scenario 2: Message Delivery ==="

  # Reset mailbox
  init_mailbox

  # Test 2.1: Agent A sends handoff to Agent B
  local msg_id
  msg_id="$(add_message "claude/sonnet-4.5" "codex/gpt-5.1-codex-mini" "handoff" "Completed auth implementation. Please write tests.")"

  if [[ -n "${msg_id}" ]]; then
    record_pass "Agent A sent handoff message (${msg_id})"
  else
    record_fail "Failed to send handoff message"
  fi

  # Test 2.2: Verify message is addressed to Agent B
  local mailbox
  mailbox="$(sandbox_cat "${MAILBOX_PATH}")"
  local recipient
  recipient="$(echo "${mailbox}" | jq -r '.messages[0].to')"

  if [[ "${recipient}" == "codex/gpt-5.1-codex-mini" ]]; then
    record_pass "Message addressed to correct recipient"
  else
    record_fail "Message addressed to wrong recipient: ${recipient}"
  fi

  # Test 2.3: Verify message type is handoff
  local msg_type
  msg_type="$(echo "${mailbox}" | jq -r '.messages[0].type')"

  if [[ "${msg_type}" == "handoff" ]]; then
    record_pass "Message type is handoff"
  else
    record_fail "Message type incorrect: ${msg_type}"
  fi

  # Test 2.4: Message is unread
  local is_read
  is_read="$(echo "${mailbox}" | jq -r '.messages[0].read')"

  if [[ "${is_read}" == "false" ]]; then
    record_pass "Message marked as unread"
  else
    record_fail "Message should be unread"
  fi

  info "=== Scenario 2 Complete ==="
}

# ============================================================================
# Test Scenario 3: Message Types
# ============================================================================
test_message_types() {
  info "=== Scenario 3: Message Types ==="

  # Reset mailbox
  init_mailbox

  # Test 3.1: Handoff message
  add_message "agent-a" "agent-b" "handoff" "Work transfer message" >/dev/null
  local mailbox
  mailbox="$(sandbox_cat "${MAILBOX_PATH}")"
  local type1
  type1="$(echo "${mailbox}" | jq -r '.messages[0].type')"
  if [[ "${type1}" == "handoff" ]]; then
    record_pass "Handoff message type preserved"
  else
    record_fail "Handoff type not preserved: ${type1}"
  fi

  # Test 3.2: Request message
  add_message "agent-b" "agent-a" "request" "Can you review this?" >/dev/null
  mailbox="$(sandbox_cat "${MAILBOX_PATH}")"
  local type2
  type2="$(echo "${mailbox}" | jq -r '.messages[1].type')"
  if [[ "${type2}" == "request" ]]; then
    record_pass "Request message type preserved"
  else
    record_fail "Request type not preserved: ${type2}"
  fi

  # Test 3.3: Status message
  add_message "agent-c" "*" "status" "Making progress on feature" >/dev/null
  mailbox="$(sandbox_cat "${MAILBOX_PATH}")"
  local type3
  type3="$(echo "${mailbox}" | jq -r '.messages[2].type')"
  if [[ "${type3}" == "status" ]]; then
    record_pass "Status message type preserved"
  else
    record_fail "Status type not preserved: ${type3}"
  fi

  info "=== Scenario 3 Complete ==="
}

# ============================================================================
# Test Scenario 4: Broadcast Messages
# ============================================================================
test_broadcast_messages() {
  info "=== Scenario 4: Broadcast Messages ==="

  # Reset mailbox
  init_mailbox

  # Test 4.1: Send broadcast message
  add_message "lead-agent" "*" "status" "Starting new task" >/dev/null

  local mailbox
  mailbox="$(sandbox_cat "${MAILBOX_PATH}")"
  local to_field
  to_field="$(echo "${mailbox}" | jq -r '.messages[0].to')"

  if [[ "${to_field}" == "*" ]]; then
    record_pass "Broadcast message uses '*' recipient"
  else
    record_fail "Broadcast recipient incorrect: ${to_field}"
  fi

  # Test 4.2: Multiple agents can see broadcast (simulated)
  # In real scenario, any agent reading mailbox with to="*" or to=their_name should see it
  local msg_count
  msg_count="$(echo "${mailbox}" | jq '.messages | length')"
  if [[ "${msg_count}" -eq 1 ]]; then
    record_pass "Broadcast message in mailbox"
  else
    record_fail "Broadcast message missing"
  fi

  info "=== Scenario 4 Complete ==="
}

# ============================================================================
# Test Scenario 5: MCP Server Message Tools (if available)
# ============================================================================
test_mcp_message_tools() {
  info "=== Scenario 5: MCP Server Message Tools ==="

  # Check if MCP server exists
  local mcp_exists
  mcp_exists="$(sandbox_exec "test -f '${MEMORY_DIR}/mcp-server.js' && echo 'exists' || echo 'missing'")"

  if [[ "${mcp_exists}" != *"exists"* ]]; then
    record_skip "MCP server not deployed - skipping MCP tool tests"
    return 0
  fi

  # Reset mailbox for MCP tests
  init_mailbox

  # Test 5.1: MCP server contains send_message tool
  local mcp_content
  mcp_content="$(sandbox_cat "${MEMORY_DIR}/mcp-server.js")"
  if echo "${mcp_content}" | grep -q "send_message"; then
    record_pass "MCP server has send_message tool"
  else
    record_fail "MCP server missing send_message tool"
  fi

  # Test 5.2: MCP server contains get_my_messages tool
  if echo "${mcp_content}" | grep -q "get_my_messages"; then
    record_pass "MCP server has get_my_messages tool"
  else
    record_fail "MCP server missing get_my_messages tool"
  fi

  # Test 5.3: MCP server contains mark_read tool
  if echo "${mcp_content}" | grep -q "mark_read"; then
    record_pass "MCP server has mark_read tool"
  else
    record_fail "MCP server missing mark_read tool"
  fi

  info "=== Scenario 5 Complete ==="
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "=== Two-Agent Coordination Tests ===" > "${LOG_FILE}"
  echo "Started at: $(date -Iseconds)" >> "${LOG_FILE}"
  echo "Provider: ${PROVIDER}" >> "${LOG_FILE}"

  info "=== devsh Two-Agent Coordination Tests (S2) ==="
  info "Provider: ${PROVIDER}"
  info "Log file: ${LOG_FILE}"
  echo ""

  # Build devsh if needed
  if ! command -v devsh >/dev/null 2>&1; then
    info "Building devsh..."
    (cd "${PROJECT_DIR}" && make install-devsh-dev) || {
      fail "Failed to build devsh"
      exit 1
    }
    export PATH="$HOME/.local/bin:$PATH"
  fi

  # Spawn sandbox if needed
  if [[ "${SKIP_SPAWN}" == false ]]; then
    info "Spawning new sandbox (provider: ${PROVIDER})..."
    local output
    output="$(devsh start -p "${PROVIDER}" 2>&1)" || {
      fail "Failed to spawn sandbox"
      echo "${output}"
      exit 1
    }

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
  else
    if [[ -z "${SANDBOX_ID}" ]]; then
      fail "No sandbox ID provided with --skip-spawn"
      exit 1
    fi
    info "Using existing sandbox: ${SANDBOX_ID}"
  fi

  # Initialize mailbox
  init_mailbox

  # Run all test scenarios
  echo ""
  test_mailbox_integrity
  echo ""
  test_message_delivery
  echo ""
  test_message_types
  echo ""
  test_broadcast_messages
  echo ""
  test_mcp_message_tools

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

  if [[ ${TESTS_FAILED} -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
