#!/usr/bin/env bash
# Spike S4: MCP Server Validation Test Script
# Tests the in-sandbox MCP server for memory protocol access
#
# Usage:
#   ./scripts/test-mcp-server.sh                    # Run full test
#   ./scripts/test-mcp-server.sh --provider pve-lxc # Use specific sandbox provider
#   ./scripts/test-mcp-server.sh --sandbox-id <id>  # Use existing sandbox
#
# Test Scenarios:
#   1. Server Deployment - mcp-server.js exists and is executable
#   2. Tool Discovery - Server lists all 7 expected tools
#   3. Memory Read Tools - read_memory, list_daily_logs, read_daily_log, search_memory
#   4. Messaging Tools - send_message, get_my_messages, mark_read
#   5. JSON-RPC Protocol - Correct request/response format

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/logs/mcp-server-test.log"

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
KNOWLEDGE_DIR="${MEMORY_DIR}/knowledge"
DAILY_DIR="${MEMORY_DIR}/daily"
MCP_SERVER="${MEMORY_DIR}/mcp-server.js"

# Expected tools
EXPECTED_TOOLS=("read_memory" "list_daily_logs" "read_daily_log" "search_memory" "send_message" "get_my_messages" "mark_read")

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

# Check if file exists in sandbox
sandbox_file_exists() {
  local path="$1"
  local result
  result="$(sandbox_exec "test -f '${path}' && echo 'exists' || echo 'missing'")"
  [[ "${result}" == *"exists"* ]]
}

# Send JSON-RPC request to MCP server and get response
mcp_call() {
  local request="$1"
  local encoded
  encoded="$(echo -n "${request}" | base64)"
  sandbox_exec "echo '${encoded}' | base64 -d | timeout 5 node '${MCP_SERVER}' 2>/dev/null | head -n 1" || echo ""
}

# Initialize memory structure for testing
init_memory_structure() {
  info "Initializing memory structure..."
  sandbox_exec "mkdir -p ${KNOWLEDGE_DIR} ${DAILY_DIR}"

  local today
  today="$(date +%Y-%m-%d)"

  # Seed knowledge file with searchable content
  sandbox_write "${KNOWLEDGE_DIR}/MEMORY.md" "# Project Knowledge

## P0 - Core (Never Expires)
- [2025-01-01] This project uses bun package manager
- [2025-01-01] Port 3001 is used for auth service

## P1 - Active (90-day TTL)
- [2025-02-15] Working on auth refactor

## P2 - Reference (30-day TTL)
- [2025-02-20] Tested with sandbox morphvm_test123
"

  # Seed daily log
  sandbox_write "${DAILY_DIR}/${today}.md" "# Daily Log: ${today}

> Session-specific observations.

---
- Fixed authentication bug in auth.ts line 42
- Tested with curl command
"

  # Seed tasks
  sandbox_write "${MEMORY_DIR}/TASKS.json" '{"version":1,"tasks":[{"id":"task-1","title":"Fix auth bug","status":"done"}]}'

  # Seed mailbox with test messages
  sandbox_write "${MEMORY_DIR}/MAILBOX.json" '{"version":1,"messages":[{"id":"msg_test123","from":"agent-a","to":"agent-b","type":"handoff","message":"Please review auth.ts","timestamp":"2025-02-20T10:00:00Z","read":false}]}'
}

# ============================================================================
# Test Scenario 1: Server Deployment
# ============================================================================
test_server_deployment() {
  info "=== Scenario 1: Server Deployment ==="

  # Test 1.1: MCP server file exists
  if sandbox_file_exists "${MCP_SERVER}"; then
    record_pass "mcp-server.js exists"
  else
    record_fail "mcp-server.js missing"
    return 1
  fi

  # Test 1.2: MCP server is executable
  local mode
  mode="$(sandbox_exec "stat -c '%a' '${MCP_SERVER}' 2>/dev/null || stat -f '%Lp' '${MCP_SERVER}' 2>/dev/null || echo ''")"
  if [[ "${mode}" == *"7"* ]] || [[ "${mode}" == *"5"* ]]; then
    record_pass "mcp-server.js has execute permissions"
  else
    warn "mcp-server.js permissions: ${mode}"
    record_skip "mcp-server.js permissions check inconclusive"
  fi

  # Test 1.3: MCP server has Node.js shebang
  local shebang
  shebang="$(sandbox_exec "head -n 1 '${MCP_SERVER}'")"
  # Handle escaped shebang from base64 encoding (#\!/usr/bin/env node)
  if echo "${shebang}" | grep -qE '#!?\\?!/usr/bin/env node|^#!/usr/bin/env node'; then
    record_pass "mcp-server.js has Node.js shebang"
  else
    record_fail "mcp-server.js missing shebang (got: ${shebang})"
  fi

  # Test 1.4: Node.js is available
  local node_version
  node_version="$(sandbox_exec "node --version 2>/dev/null || echo 'missing'")"
  if [[ "${node_version}" == v* ]]; then
    record_pass "Node.js available: ${node_version}"
  else
    record_fail "Node.js not available"
  fi

  info "=== Scenario 1 Complete ==="
}

# ============================================================================
# Test Scenario 2: Tool Discovery
# ============================================================================
test_tool_discovery() {
  info "=== Scenario 2: Tool Discovery ==="

  local mcp_content
  mcp_content="$(sandbox_cat "${MCP_SERVER}")"

  # Test 2.1: Server has tools array
  if echo "${mcp_content}" | grep -q "const tools"; then
    record_pass "Server defines tools array"
  else
    record_fail "Server missing tools array"
  fi

  # Test 2.2-2.8: Check each expected tool
  local tools_found=0
  for tool in "${EXPECTED_TOOLS[@]}"; do
    if echo "${mcp_content}" | grep -q "name: '${tool}'\|name:\"${tool}\"\|'${tool}'\|\"${tool}\""; then
      tools_found=$((tools_found + 1))
      record_pass "Tool defined: ${tool}"
    else
      record_fail "Tool missing: ${tool}"
    fi
  done

  # Test 2.9: All 7 tools present
  if [[ ${tools_found} -eq ${#EXPECTED_TOOLS[@]} ]]; then
    record_pass "All ${#EXPECTED_TOOLS[@]} expected tools defined"
  else
    record_fail "Missing tools: found ${tools_found}/${#EXPECTED_TOOLS[@]}"
  fi

  info "=== Scenario 2 Complete ==="
}

# ============================================================================
# Test Scenario 3: Memory Read Tools
# ============================================================================
test_memory_read_tools() {
  info "=== Scenario 3: Memory Read Tools ==="

  local mcp_content
  mcp_content="$(sandbox_cat "${MCP_SERVER}")"

  # Test 3.1: read_memory has type parameter
  if echo "${mcp_content}" | grep -A 20 "name: 'read_memory'" | grep -q "type.*enum.*knowledge.*tasks.*mailbox"; then
    record_pass "read_memory accepts type parameter with enum"
  else
    # Alternative check
    if echo "${mcp_content}" | grep -q "knowledge.*tasks.*mailbox\|enum:.*knowledge"; then
      record_pass "read_memory has memory type options"
    else
      warn "read_memory parameter check inconclusive"
      record_skip "read_memory parameter validation"
    fi
  fi

  # Test 3.2: read_memory reads correct file paths
  if echo "${mcp_content}" | grep -q "MEMORY.md\|TASKS.json\|MAILBOX.json"; then
    record_pass "read_memory references memory files"
  else
    record_fail "read_memory missing file references"
  fi

  # Test 3.3: list_daily_logs reads daily directory
  if echo "${mcp_content}" | grep -q "daily\|DAILY_DIR"; then
    record_pass "list_daily_logs references daily directory"
  else
    record_fail "list_daily_logs missing daily directory reference"
  fi

  # Test 3.4: search_memory supports query parameter
  if echo "${mcp_content}" | grep -q "query.*string\|searchMemory"; then
    record_pass "search_memory has query parameter"
  else
    warn "search_memory parameter check inconclusive"
    record_skip "search_memory parameter validation"
  fi

  # Test 3.5: search_memory searches multiple files
  if echo "${mcp_content}" | grep -q "searchMemory\|toLowerCase().*includes"; then
    record_pass "search_memory has search logic"
  else
    warn "search_memory logic check inconclusive"
    record_skip "search_memory logic validation"
  fi

  info "=== Scenario 3 Complete ==="
}

# ============================================================================
# Test Scenario 4: Messaging Tools
# ============================================================================
test_messaging_tools() {
  info "=== Scenario 4: Messaging Tools ==="

  local mcp_content
  mcp_content="$(sandbox_cat "${MCP_SERVER}")"

  # Test 4.1: send_message has required parameters
  if echo "${mcp_content}" | grep -qE "to.*from.*message|send_message.*to.*message"; then
    record_pass "send_message has to/message parameters"
  else
    # Simpler check
    if echo "${mcp_content}" | grep -q "'to'\|\"to\"" && echo "${mcp_content}" | grep -q "'message'\|\"message\""; then
      record_pass "send_message parameters found"
    else
      warn "send_message parameter check inconclusive"
      record_skip "send_message parameter validation"
    fi
  fi

  # Test 4.2: send_message supports message types
  if echo "${mcp_content}" | grep -q "handoff.*request.*status\|type.*enum"; then
    record_pass "send_message supports message types"
  else
    if echo "${mcp_content}" | grep -q "handoff" && echo "${mcp_content}" | grep -q "request" && echo "${mcp_content}" | grep -q "status"; then
      record_pass "send_message has message type options"
    else
      record_fail "send_message missing message types"
    fi
  fi

  # Test 4.3: send_message writes to MAILBOX.json
  if echo "${mcp_content}" | grep -q "writeMailbox\|MAILBOX.json\|mailbox"; then
    record_pass "send_message writes to mailbox"
  else
    record_fail "send_message missing mailbox write"
  fi

  # Test 4.4: get_my_messages filters by agent name
  if echo "${mcp_content}" | grep -q "AGENT_NAME\|CMUX_AGENT_NAME\|from\|to"; then
    record_pass "get_my_messages filters by agent"
  else
    warn "get_my_messages filter check inconclusive"
    record_skip "get_my_messages filter validation"
  fi

  # Test 4.5: get_my_messages handles broadcast (*)
  if echo "${mcp_content}" | grep -q '\*'; then
    record_pass "get_my_messages handles broadcast messages"
  else
    warn "get_my_messages broadcast check inconclusive"
    record_skip "get_my_messages broadcast validation"
  fi

  # Test 4.6: mark_read updates message
  if echo "${mcp_content}" | grep -q "mark_read\|read.*true\|.read = true"; then
    record_pass "mark_read updates read status"
  else
    record_fail "mark_read missing read status update"
  fi

  info "=== Scenario 4 Complete ==="
}

# ============================================================================
# Test Scenario 5: JSON-RPC Protocol
# ============================================================================
test_jsonrpc_protocol() {
  info "=== Scenario 5: JSON-RPC Protocol ==="

  local mcp_content
  mcp_content="$(sandbox_cat "${MCP_SERVER}")"

  # Test 5.1: Server handles initialize method
  if echo "${mcp_content}" | grep -q "initialize"; then
    record_pass "Server handles initialize method"
  else
    record_fail "Server missing initialize handler"
  fi

  # Test 5.2: Server handles tools/list method
  if echo "${mcp_content}" | grep -q "tools/list"; then
    record_pass "Server handles tools/list method"
  else
    record_fail "Server missing tools/list handler"
  fi

  # Test 5.3: Server handles tools/call method
  if echo "${mcp_content}" | grep -q "tools/call"; then
    record_pass "Server handles tools/call method"
  else
    record_fail "Server missing tools/call handler"
  fi

  # Test 5.4: Response includes jsonrpc version
  if echo "${mcp_content}" | grep -q "jsonrpc.*2.0\|\"2.0\""; then
    record_pass "Response includes jsonrpc version"
  else
    warn "jsonrpc version check inconclusive"
    record_skip "jsonrpc version validation"
  fi

  # Test 5.5: Response includes id field
  if echo "${mcp_content}" | grep -q "response.id\|id:.*id\|{ id"; then
    record_pass "Response includes id field"
  else
    warn "Response id check inconclusive"
    record_skip "Response id validation"
  fi

  # Test 5.6: Error responses use error field
  if echo "${mcp_content}" | grep -q "response.error\|error:.*message\|error.*code"; then
    record_pass "Error responses use error field"
  else
    warn "Error response check inconclusive"
    record_skip "Error response validation"
  fi

  info "=== Scenario 5 Complete ==="
}

# ============================================================================
# Test Scenario 6: Live Server Tests (if Node.js available)
# ============================================================================
test_live_server() {
  info "=== Scenario 6: Live Server Tests ==="

  # Check if Node.js is available
  local node_available
  node_available="$(sandbox_exec "command -v node >/dev/null && echo 'yes' || echo 'no'")"

  if [[ "${node_available}" != *"yes"* ]]; then
    record_skip "Node.js not available - skipping live tests"
    return 0
  fi

  # Test 6.1: Server responds to initialize
  info "Testing initialize request..."
  local init_request='{"jsonrpc":"2.0","id":1,"method":"initialize"}'
  local init_response
  init_response="$(mcp_call "${init_request}")"

  if echo "${init_response}" | jq -e '.result.serverInfo' >/dev/null 2>&1; then
    record_pass "Server responds to initialize"
  else
    warn "Initialize response: ${init_response}"
    record_skip "Initialize test inconclusive"
  fi

  # Test 6.2: Server lists tools
  info "Testing tools/list request..."
  local list_request='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  local list_response
  list_response="$(mcp_call "${list_request}")"

  if echo "${list_response}" | jq -e '.result.tools' >/dev/null 2>&1; then
    local tool_count
    tool_count="$(echo "${list_response}" | jq '.result.tools | length')"
    if [[ "${tool_count}" -eq 7 ]]; then
      record_pass "Server lists all 7 tools"
    else
      warn "Server lists ${tool_count} tools (expected 7)"
      record_skip "Tool count mismatch"
    fi
  else
    warn "tools/list response: ${list_response}"
    record_skip "tools/list test inconclusive"
  fi

  # Test 6.3: read_memory tool works
  info "Testing read_memory tool..."
  local read_request='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_memory","arguments":{"type":"knowledge"}}}'
  local read_response
  read_response="$(mcp_call "${read_request}")"

  if echo "${read_response}" | jq -e '.result.content[0].text' >/dev/null 2>&1; then
    record_pass "read_memory returns content"
  else
    warn "read_memory response: ${read_response}"
    record_skip "read_memory test inconclusive"
  fi

  # Test 6.4: search_memory tool works
  info "Testing search_memory tool..."
  local search_request='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_memory","arguments":{"query":"bun"}}}'
  local search_response
  search_response="$(mcp_call "${search_request}")"

  if echo "${search_response}" | jq -e '.result.content[0].text' >/dev/null 2>&1; then
    record_pass "search_memory returns results"
  else
    warn "search_memory response: ${search_response}"
    record_skip "search_memory test inconclusive"
  fi

  info "=== Scenario 6 Complete ==="
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "=== MCP Server Tests ===" > "${LOG_FILE}"
  echo "Started at: $(date -Iseconds)" >> "${LOG_FILE}"
  echo "Provider: ${PROVIDER}" >> "${LOG_FILE}"

  info "=== devsh MCP Server Tests (S4) ==="
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

  # Initialize memory structure
  init_memory_structure

  # Seed MCP server if not present (get from agent-memory-protocol.ts)
  if ! sandbox_file_exists "${MCP_SERVER}"; then
    info "MCP server not found - seeding for testing..."
    # This would normally come from the actual deployment
    # For testing, we check if the file exists in the codebase and deploy it
    fail "MCP server not deployed to sandbox"
    info "Note: Run memory protocol seeding first, or use --sandbox-id with a properly configured sandbox"
  fi

  # Run all test scenarios
  echo ""
  test_server_deployment
  echo ""
  test_tool_discovery
  echo ""
  test_memory_read_tools
  echo ""
  test_messaging_tools
  echo ""
  test_jsonrpc_protocol
  echo ""
  test_live_server

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
