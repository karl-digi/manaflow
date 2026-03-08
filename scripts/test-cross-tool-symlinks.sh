#!/usr/bin/env bash
# E2E test for cross-tool symlinks feature (PR #432)
#
# Tests that cross-tool symlinks are created correctly:
# - ~/.codex/AGENTS.md -> ~/.claude/CLAUDE.md
# - ~/.gemini/GEMINI.md -> ~/.claude/CLAUDE.md
#
# Usage:
#   ./scripts/test-cross-tool-symlinks.sh                    # Run all tests
#   ./scripts/test-cross-tool-symlinks.sh --provider pve-lxc # Use specific sandbox provider
#   ./scripts/test-cross-tool-symlinks.sh --skip-spawn       # Test against existing sandbox
#   ./scripts/test-cross-tool-symlinks.sh --sandbox-id <id>  # Use specific sandbox ID
#
# Required Environment:
#   - PVE_API_URL, PVE_API_TOKEN (for pve-lxc provider)
#   - MORPH_API_KEY (for morph provider)
#
# Test Scenarios:
#   1. Claude Agent - Creates master CLAUDE.md and symlinks
#   2. Symlink Verification - Check symlinks exist and point correctly
#   3. Content Verification - Ensure all files have identical content
#   4. Memory Protocol - Verify agent memory files exist
#   5. Codex Agent - Verify AGENTS.md symlink is readable

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/logs/cross-tool-symlinks-test.log"

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
REPO="karlorz/testing-repo-1"
AGENT_CLAUDE="claude/haiku-4.5"
AGENT_CODEX="codex/gpt-5.1-codex-mini"

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
    --repo)
      REPO="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --provider, -p <provider>  Sandbox provider (pve-lxc, morph, e2b)"
      echo "  --sandbox-id, -s <id>      Use existing sandbox ID"
      echo "  --skip-spawn               Skip spawning new sandbox"
      echo "  --no-cleanup               Don't delete sandbox after tests"
      echo "  --repo <owner/repo>        Repository for task creation"
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

# Execute command in sandbox (returns output, never fails script)
sandbox_exec() {
  devsh exec "${SANDBOX_ID}" "$@" 2>&1 || true
}

# Check if file exists in sandbox
sandbox_file_exists() {
  local path="$1"
  local result
  result="$(sandbox_exec "test -f '${path}' && echo 'exists' || echo 'missing'" 2>/dev/null || echo "error")"
  [[ "${result}" == *"exists"* ]]
}

# Check if path is a symlink in sandbox
sandbox_is_symlink() {
  local path="$1"
  local result
  result="$(sandbox_exec "test -L '${path}' && echo 'symlink' || echo 'not_symlink'" 2>/dev/null || echo "error")"
  [[ "${result}" == *"symlink"* ]]
}

# Get symlink target in sandbox
sandbox_readlink() {
  local path="$1"
  sandbox_exec "readlink '${path}' 2>/dev/null || echo ''"
}

# Get file content from sandbox
sandbox_cat() {
  local path="$1"
  sandbox_exec "cat '${path}' 2>/dev/null" || echo ""
}

# ============================================================================
# Test Scenario 1: CLAUDE.md Exists
# ============================================================================
test_claude_md_exists() {
  info "=== Scenario 1: CLAUDE.md Existence ==="

  # Test 1.1: Check ~/.claude directory exists
  if sandbox_exec "test -d ~/.claude && echo 'exists'" | grep -q "exists"; then
    record_pass "~/.claude directory exists"
  else
    record_fail "~/.claude directory missing"
    return 1
  fi

  # Test 1.2: Check ~/.claude/CLAUDE.md exists
  if sandbox_file_exists "/root/.claude/CLAUDE.md"; then
    record_pass "~/.claude/CLAUDE.md exists"
  else
    record_fail "~/.claude/CLAUDE.md missing"
    return 1
  fi

  # Test 1.3: Check CLAUDE.md contains memory protocol instructions
  local claude_content
  claude_content="$(sandbox_cat "/root/.claude/CLAUDE.md")"
  if echo "${claude_content}" | grep -q "Agent Memory Protocol"; then
    record_pass "CLAUDE.md contains Agent Memory Protocol instructions"
  else
    record_fail "CLAUDE.md missing Agent Memory Protocol instructions"
  fi

  info "=== Scenario 1 Complete ==="
}

# ============================================================================
# Test Scenario 2: Symlink Verification
# ============================================================================
test_symlinks_exist() {
  info "=== Scenario 2: Symlink Verification ==="

  # Test 2.1: Check ~/.codex directory exists
  if sandbox_exec "test -d ~/.codex && echo 'exists'" | grep -q "exists"; then
    record_pass "~/.codex directory exists"
  else
    record_fail "~/.codex directory missing"
  fi

  # Test 2.2: Check ~/.codex/AGENTS.md is a symlink
  if sandbox_is_symlink "/root/.codex/AGENTS.md"; then
    record_pass "~/.codex/AGENTS.md is a symlink"
  else
    record_fail "~/.codex/AGENTS.md is not a symlink"
  fi

  # Test 2.3: Check symlink target is correct
  local target
  target="$(sandbox_readlink "/root/.codex/AGENTS.md")"
  # Target should be ~/.claude/CLAUDE.md or /root/.claude/CLAUDE.md
  if echo "${target}" | grep -qE '(~|/root)/\.claude/CLAUDE\.md'; then
    record_pass "~/.codex/AGENTS.md points to ~/.claude/CLAUDE.md"
  else
    record_fail "~/.codex/AGENTS.md has wrong target: ${target}"
  fi

  # Test 2.4: Check ~/.gemini directory exists
  if sandbox_exec "test -d ~/.gemini && echo 'exists'" | grep -q "exists"; then
    record_pass "~/.gemini directory exists"
  else
    record_fail "~/.gemini directory missing"
  fi

  # Test 2.5: Check ~/.gemini/GEMINI.md is a symlink
  if sandbox_is_symlink "/root/.gemini/GEMINI.md"; then
    record_pass "~/.gemini/GEMINI.md is a symlink"
  else
    record_fail "~/.gemini/GEMINI.md is not a symlink"
  fi

  # Test 2.6: Check symlink target is correct
  target="$(sandbox_readlink "/root/.gemini/GEMINI.md")"
  if echo "${target}" | grep -qE '(~|/root)/\.claude/CLAUDE\.md'; then
    record_pass "~/.gemini/GEMINI.md points to ~/.claude/CLAUDE.md"
  else
    record_fail "~/.gemini/GEMINI.md has wrong target: ${target}"
  fi

  info "=== Scenario 2 Complete ==="
}

# ============================================================================
# Test Scenario 3: Content Verification
# ============================================================================
test_content_identical() {
  info "=== Scenario 3: Content Verification ==="

  # Test 3.1: Compare CLAUDE.md and AGENTS.md content
  local diff_result
  diff_result="$(sandbox_exec "diff ~/.claude/CLAUDE.md ~/.codex/AGENTS.md && echo 'IDENTICAL' || echo 'DIFFERENT'")"
  if echo "${diff_result}" | grep -q "IDENTICAL"; then
    record_pass "~/.claude/CLAUDE.md and ~/.codex/AGENTS.md have identical content"
  else
    record_fail "~/.claude/CLAUDE.md and ~/.codex/AGENTS.md differ"
  fi

  # Test 3.2: Compare CLAUDE.md and GEMINI.md content
  diff_result="$(sandbox_exec "diff ~/.claude/CLAUDE.md ~/.gemini/GEMINI.md && echo 'IDENTICAL' || echo 'DIFFERENT'")"
  if echo "${diff_result}" | grep -q "IDENTICAL"; then
    record_pass "~/.claude/CLAUDE.md and ~/.gemini/GEMINI.md have identical content"
  else
    record_fail "~/.claude/CLAUDE.md and ~/.gemini/GEMINI.md differ"
  fi

  # Test 3.3: Verify content from symlink is readable
  local agents_content
  agents_content="$(sandbox_cat "/root/.codex/AGENTS.md")"
  if echo "${agents_content}" | grep -q "Agent Memory Protocol"; then
    record_pass "Content is readable through ~/.codex/AGENTS.md symlink"
  else
    record_fail "Content not readable through ~/.codex/AGENTS.md symlink"
  fi

  info "=== Scenario 3 Complete ==="
}

# ============================================================================
# Test Scenario 4: Memory Protocol Verification
# ============================================================================
test_memory_protocol() {
  info "=== Scenario 4: Memory Protocol Verification ==="

  local MEMORY_DIR="/root/lifecycle/memory"

  # Test 4.1: Check memory directory exists
  if sandbox_exec "test -d ${MEMORY_DIR} && echo 'exists'" | grep -q "exists"; then
    record_pass "Memory directory exists: ${MEMORY_DIR}"
  else
    record_fail "Memory directory missing: ${MEMORY_DIR}"
    return 1
  fi

  # Test 4.2: Check knowledge subdirectory exists
  if sandbox_exec "test -d ${MEMORY_DIR}/knowledge && echo 'exists'" | grep -q "exists"; then
    record_pass "Knowledge directory exists"
  else
    record_fail "Knowledge directory missing"
  fi

  # Test 4.3: Check daily subdirectory exists
  if sandbox_exec "test -d ${MEMORY_DIR}/daily && echo 'exists'" | grep -q "exists"; then
    record_pass "Daily directory exists"
  else
    record_fail "Daily directory missing"
  fi

  # Test 4.4: Check TASKS.json exists
  if sandbox_file_exists "${MEMORY_DIR}/TASKS.json"; then
    record_pass "TASKS.json exists"
  else
    record_fail "TASKS.json missing"
  fi

  # Test 4.5: Check MAILBOX.json exists
  if sandbox_file_exists "${MEMORY_DIR}/MAILBOX.json"; then
    record_pass "MAILBOX.json exists"
  else
    record_fail "MAILBOX.json missing"
  fi

  # Test 4.6: Check knowledge/MEMORY.md exists with P0/P1/P2 sections
  local knowledge_content
  knowledge_content="$(sandbox_cat "${MEMORY_DIR}/knowledge/MEMORY.md")"
  if echo "${knowledge_content}" | grep -qE "## P0|P0.*Core|P0:"; then
    record_pass "knowledge/MEMORY.md exists with priority sections"
  else
    record_fail "knowledge/MEMORY.md missing or missing priority sections"
  fi

  info "=== Scenario 4 Complete ==="
}

# ============================================================================
# Test Scenario 5: Instructions Content Verification
# ============================================================================
test_instructions_content() {
  info "=== Scenario 5: Instructions Content Verification ==="

  # Test 5.1: CLAUDE.md contains memory directory path
  local claude_content
  claude_content="$(sandbox_cat "/root/.claude/CLAUDE.md")"
  if echo "${claude_content}" | grep -q "/root/lifecycle/memory"; then
    record_pass "CLAUDE.md contains correct memory directory path"
  else
    record_fail "CLAUDE.md missing memory directory path"
  fi

  # Test 5.2: CLAUDE.md contains inter-agent messaging section
  if echo "${claude_content}" | grep -q "Inter-Agent Messaging"; then
    record_pass "CLAUDE.md contains inter-agent messaging section"
  else
    record_fail "CLAUDE.md missing inter-agent messaging section"
  fi

  # Test 5.3: CLAUDE.md contains execution summary section
  if echo "${claude_content}" | grep -q "Execution Summary"; then
    record_pass "CLAUDE.md contains execution summary section"
  else
    record_fail "CLAUDE.md missing execution summary section"
  fi

  info "=== Scenario 5 Complete ==="
}

# ============================================================================
# Main Test Runner
# ============================================================================
main() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "=== Cross-Tool Symlinks E2E Tests ===" > "${LOG_FILE}"
  echo "Started at: $(date -Iseconds)" >> "${LOG_FILE}"
  echo "Provider: ${PROVIDER}" >> "${LOG_FILE}"

  info "=== Cross-Tool Symlinks E2E Tests (PR #432) ==="
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

    # Create a task to spawn the sandbox with the Claude agent
    # This ensures the environment is set up correctly with all the files
    local task_output
    task_output="$(devsh task create --repo "${REPO}" --agent "${AGENT_CLAUDE}" --provider "${PROVIDER}" "Create a simple test.txt file with 'hello world' content" 2>&1)" || {
      fail "Failed to create task"
      echo "${task_output}"
      exit 1
    }

    info "Task created, waiting for sandbox..."
    echo "${task_output}" >> "${LOG_FILE}"

    # Extract task ID from output (format: p17erbkc77h59gcv11kjt0m69s826d7c or tr_xxx)
    local TASK_ID
    TASK_ID="$(echo "${task_output}" | grep -oE '(tr_[a-zA-Z0-9]+|Task ID: [a-z0-9]+|Task created: [a-z0-9]+)' | grep -oE '[a-z0-9]{20,}|tr_[a-zA-Z0-9]+' | head -n 1 || true)"
    if [[ -z "${TASK_ID}" ]]; then
      fail "Could not parse task ID from output"
      echo "${task_output}"
      exit 1
    fi

    info "Task ID: ${TASK_ID}"
    echo "Task ID: ${TASK_ID}" >> "${LOG_FILE}"

    # Wait for task to have a sandbox assigned
    info "Waiting for sandbox to be assigned..."
    local wait_count=0
    local max_wait=60
    while [[ ${wait_count} -lt ${max_wait} ]]; do
      local task_info
      task_info="$(devsh task show "${TASK_ID}" 2>&1)" || true
      SANDBOX_ID="$(echo "${task_info}" | grep -oE 'pvelxc-[a-z0-9]+|morphvm_[a-z0-9]+|sbx_[a-z0-9]+|port-[0-9]+-pvelxc-[a-z0-9]+' | grep -oE 'pvelxc-[a-z0-9]+' | head -n 1 || true)"
      if [[ -n "${SANDBOX_ID}" ]]; then
        break
      fi
      sleep 2
      wait_count=$((wait_count + 1))
    done

    if [[ -z "${SANDBOX_ID}" ]]; then
      fail "Timeout waiting for sandbox to be assigned"
      exit 1
    fi

    info "Sandbox assigned: ${SANDBOX_ID}"
    echo "Sandbox ID: ${SANDBOX_ID}" >> "${LOG_FILE}"

    # Wait a bit more for the environment to be fully set up
    info "Waiting for environment setup to complete..."
    sleep 15
  else
    if [[ -z "${SANDBOX_ID}" ]]; then
      fail "No sandbox ID provided with --skip-spawn"
      exit 1
    fi
    info "Using existing sandbox: ${SANDBOX_ID}"
  fi

  # Run all test scenarios
  echo ""
  test_claude_md_exists
  echo ""
  test_symlinks_exist
  echo ""
  test_content_identical
  echo ""
  test_memory_protocol
  echo ""
  test_instructions_content

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

  # Print verification checklist
  echo ""
  info "=== Verification Checklist ==="
  echo "| Test | Command | Expected |"
  echo "|------|---------|----------|"
  echo "| CLAUDE.md exists | test -f ~/.claude/CLAUDE.md | Exit 0 |"
  echo "| AGENTS.md is symlink | test -L ~/.codex/AGENTS.md | Exit 0 |"
  echo "| GEMINI.md is symlink | test -L ~/.gemini/GEMINI.md | Exit 0 |"
  echo "| Symlink target correct | readlink ~/.codex/AGENTS.md | ~/.claude/CLAUDE.md |"
  echo "| Content identical | diff ~/.claude/CLAUDE.md ~/.codex/AGENTS.md | No output |"
  echo "| Memory protocol | grep 'Agent Memory Protocol' ~/.codex/AGENTS.md | Match |"
  echo "| Memory dir exists | test -d /root/lifecycle/memory/ | Exit 0 |"
  echo "| TASKS.json exists | test -f /root/lifecycle/memory/TASKS.json | Exit 0 |"

  # Exit with appropriate code
  if [[ ${TESTS_FAILED} -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
