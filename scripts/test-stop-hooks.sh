#!/bin/bash
# Test script for stop hook cooperation between autopilot-keep-running.sh and codex-review.sh
# Tests the flag-file mechanism that replaced the generic stop_hook_active check.
#
# Usage: ./scripts/test-stop-hooks.sh
#
# Each test simulates the hook execution flow by calling the actual hook scripts
# with crafted input JSON and environment variables, then verifying side effects
# (flag files, debug log entries, exit codes).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_DIR/.claude/hooks"

AUTOPILOT_HOOK="$HOOKS_DIR/autopilot-keep-running.sh"
CODEX_REVIEW_HOOK="$HOOKS_DIR/codex-review.sh"

PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'
CONDITIONAL_WAIT_TEXT="Only if you are blocked on external work and are about to poll status"

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$expected" = "$actual" ]; then
    echo -e "  ${GREEN}PASS${NC}: $desc (got: $actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC}: $desc (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_exists() {
  local desc="$1" path="$2"
  TOTAL=$((TOTAL + 1))
  if [ -f "$path" ]; then
    echo -e "  ${GREEN}PASS${NC}: $desc (file exists: $path)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC}: $desc (file missing: $path)"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_not_exists() {
  local desc="$1" path="$2"
  TOTAL=$((TOTAL + 1))
  if [ ! -f "$path" ]; then
    echo -e "  ${GREEN}PASS${NC}: $desc (file absent: $path)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC}: $desc (file should not exist: $path)"
    FAIL=$((FAIL + 1))
  fi
}

assert_log_contains() {
  local desc="$1" log_file="$2" pattern="$3"
  TOTAL=$((TOTAL + 1))
  if grep -q "$pattern" "$log_file" 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC}: $desc (log contains: $pattern)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC}: $desc (log missing: $pattern)"
    FAIL=$((FAIL + 1))
  fi
}

cleanup_session() {
  local sid="$1"
  rm -f "/tmp/claude-autopilot-blocked-${sid}"
  rm -f "/tmp/claude-autopilot-completed-${sid}"
  rm -f "/tmp/claude-autopilot-turns-${sid}"
  rm -f "/tmp/claude-autopilot-stop-${sid}"
  rm -f "/tmp/codex-review-fails-${sid}"
  rm -f "/tmp/codex-review-debug.log"
}

# Common env vars for codex-review invocations
# CODEX_REVIEW_DEBUG=1 enables the opt-in debug log so assertions can check it
# CODEX_REVIEW_DRY_RUN=1 exits before the actual codex binary call
REVIEW_COMMON_ENV="CODEX_REVIEW_DISABLED=0 CODEX_REVIEW_DEBUG=1 CODEX_REVIEW_DRY_RUN=1"

# ============================================================================
# Test 1: Autopilot blocks -> flag file created -> codex-review skips
# ============================================================================
echo ""
echo -e "${YELLOW}Test 1: Autopilot blocks -> codex-review skips${NC}"

SID="test-stop-hook-1"
cleanup_session "$SID"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# Run autopilot hook (should block)
AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=20 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

# Check autopilot created flag file
assert_file_exists "autopilot created blocked flag file" "/tmp/claude-autopilot-blocked-${SID}"

# Check autopilot output contains block decision
DECISION=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.decision' 2>/dev/null || echo "")
assert_eq "autopilot output block decision" "block" "$DECISION"

# Run codex-review hook (should skip due to flag file)
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

assert_eq "codex-review exits 0 (skipped)" "0" "$REVIEW_EXIT"
assert_log_contains "debug log shows autopilot blocked" "/tmp/codex-review-debug.log" "autopilot blocked this stop"

cleanup_session "$SID"

# ============================================================================
# Test 2: Autopilot allows (max turns reached) -> flag cleaned -> codex-review runs
# ============================================================================
echo ""
echo -e "${YELLOW}Test 2: Autopilot allows (max turns) -> codex-review proceeds${NC}"

SID="test-stop-hook-2"
cleanup_session "$SID"

# Pre-seed turn counter to 0, set max to 1 so next turn hits limit
echo "0" > "/tmp/claude-autopilot-turns-${SID}"
# Pre-create a flag file as if autopilot blocked on a previous stop
echo "1" > "/tmp/claude-autopilot-blocked-${SID}"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# Run autopilot hook (should allow - max turns reached)
AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=1 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

# Flag file should be cleaned up
assert_file_not_exists "autopilot cleaned flag file on max turns" "/tmp/claude-autopilot-blocked-${SID}"

# Autopilot should NOT output a block decision (it exits 0 silently)
assert_eq "autopilot output empty (allowed stop)" "" "$AUTOPILOT_OUTPUT"

# Run codex-review hook (should proceed past autopilot check)
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

assert_log_contains "debug log shows proceeding with review" "/tmp/codex-review-debug.log" "Proceeding with codex review"

cleanup_session "$SID"

# ============================================================================
# Test 3: Autopilot off + stale flag file -> cleaned up, codex-review runs
# ============================================================================
echo ""
echo -e "${YELLOW}Test 3: Autopilot off + stale flag -> cleaned, codex-review proceeds${NC}"

SID="test-stop-hook-3"
cleanup_session "$SID"

# Create stale flag file (left over from previous autopilot session)
echo "stale" > "/tmp/claude-autopilot-blocked-${SID}"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# Run codex-review with autopilot explicitly OFF
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=0 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

# Stale flag file should be cleaned up
assert_file_not_exists "stale flag file cleaned up" "/tmp/claude-autopilot-blocked-${SID}"
assert_log_contains "debug log shows stale cleanup" "/tmp/codex-review-debug.log" "Cleaned up stale autopilot blocked flag"
assert_log_contains "debug log shows proceeding" "/tmp/codex-review-debug.log" "Proceeding with codex review"

cleanup_session "$SID"

# ============================================================================
# Test 4: bun-check blocks (stop_hook_active=true) but codex-review still runs
# ============================================================================
echo ""
echo -e "${YELLOW}Test 4: bun-check blocks (stop_hook_active=true) -> codex-review still runs${NC}"

SID="test-stop-hook-4"
cleanup_session "$SID"

# stop_hook_active=true simulates bun-check having blocked
INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":true}'

# No flag file exists (autopilot didn't block, or is off)
# Run codex-review with autopilot explicitly OFF
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=0 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

# codex-review should NOT skip (no flag file, autopilot not active)
assert_log_contains "debug log shows proceeding despite stop_hook_active" "/tmp/codex-review-debug.log" "Proceeding with codex review"

cleanup_session "$SID"

# ============================================================================
# Test 5: stop_hook_active=true -> autopilot still blocks (ignores flag)
# ============================================================================
echo ""
echo -e "${YELLOW}Test 5: stop_hook_active=true -> autopilot still blocks (MAX_TURNS is the guard)${NC}"

SID="test-stop-hook-5"
cleanup_session "$SID"

# Pre-create flag file as if autopilot blocked on a previous cycle
echo "5" > "/tmp/claude-autopilot-blocked-${SID}"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":true}'

# Run autopilot hook -- should block regardless of stop_hook_active
# (autopilot is first in chain, MAX_TURNS is the only loop guard)
AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=20 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

# Autopilot should still block (turn 1, well under max)
DECISION=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.decision' 2>/dev/null || echo "")
assert_eq "autopilot blocks despite stop_hook_active=true" "block" "$DECISION"

# Flag file should be updated with new turn count
assert_file_exists "flag file updated after block" "/tmp/claude-autopilot-blocked-${SID}"

# Turn counter should be at 1
TURN_COUNT=$(cat "/tmp/claude-autopilot-turns-${SID}" 2>/dev/null || echo "0")
assert_eq "turn counter incremented to 1" "1" "$TURN_COUNT"

# Verify codex-review still skips because flag file exists
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

assert_eq "codex-review exits 0 (skipped, flag exists)" "0" "$REVIEW_EXIT"
assert_log_contains "debug log shows autopilot blocked" "/tmp/codex-review-debug.log" "autopilot blocked this stop"

cleanup_session "$SID"

# ============================================================================
# Test 6: Session stop file -> autopilot allows and cleans flag
# ============================================================================
echo ""
echo -e "${YELLOW}Test 6: Session stop file -> autopilot allows, flag cleaned${NC}"

SID="test-stop-hook-6"
cleanup_session "$SID"

# Pre-create flag file and session stop file
echo "3" > "/tmp/claude-autopilot-blocked-${SID}"
touch "/tmp/claude-autopilot-stop-${SID}"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# Run autopilot hook (should detect stop file, clean flag, and allow)
AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

assert_file_not_exists "flag file cleaned on stop file" "/tmp/claude-autopilot-blocked-${SID}"
assert_eq "autopilot output empty (allowed stop)" "" "$AUTOPILOT_OUTPUT"

cleanup_session "$SID"

# ============================================================================
# Test 7: AUTOPILOT_KEEP_RUNNING_DISABLED=1 + stale flag -> codex-review runs
# ============================================================================
echo ""
echo -e "${YELLOW}Test 7: Autopilot disabled via override + stale flag -> codex-review proceeds${NC}"

SID="test-stop-hook-7"
cleanup_session "$SID"

# Stale flag file from before the override was set
echo "2" > "/tmp/claude-autopilot-blocked-${SID}"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# CLAUDE_AUTOPILOT=1 but AUTOPILOT_KEEP_RUNNING_DISABLED=1 overrides it
REVIEW_EXIT=0
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  AUTOPILOT_KEEP_RUNNING_DISABLED=1 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$CODEX_REVIEW_HOOK" 2>/dev/null || REVIEW_EXIT=$?

# codex-review should treat autopilot as inactive and clean stale flag
assert_file_not_exists "stale flag cleaned when override active" "/tmp/claude-autopilot-blocked-${SID}"
assert_log_contains "debug log shows stale cleanup" "/tmp/codex-review-debug.log" "Cleaned up stale autopilot blocked flag"
assert_log_contains "debug log shows proceeding" "/tmp/codex-review-debug.log" "Proceeding with codex review"

cleanup_session "$SID"

# ============================================================================
# Test 8: Smart delay escalation - work phase vs monitoring phase
# ============================================================================
echo ""
echo -e "${YELLOW}Test 8: Delay escalation - work vs monitoring phase${NC}"

SID="test-stop-hook-8"
cleanup_session "$SID"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

# Turn 1: should be "work" phase (no sleep instruction in output)
AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=30 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

REASON=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.reason' 2>/dev/null || echo "")
HAS_SLEEP=$(echo "$REASON" | grep -c "sleep" || true)
STARTS_WITH_CONTINUE=$(echo "$REASON" | grep -c "^Continue from where you left off" || true)
assert_eq "turn 1 (work phase) has no sleep instruction" "0" "$HAS_SLEEP"
assert_eq "turn 1 starts with continue guidance" "1" "$STARTS_WITH_CONTINUE"

# Turn 4 (threshold=3, so turn 4 is monitoring phase 1): should include "sleep 30"
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=30 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" >/dev/null 2>&1 || true
echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=30 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" >/dev/null 2>&1 || true

AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=30 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

REASON=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.reason' 2>/dev/null || echo "")
HAS_SLEEP_30=$(echo "$REASON" | grep -c "sleep 30" || true)
HAS_CONDITIONAL_WAIT_30=$(echo "$REASON" | grep -c "$CONDITIONAL_WAIT_TEXT" || true)
STARTS_WITH_CONTINUE=$(echo "$REASON" | grep -c "^Continue from where you left off" || true)
assert_eq "turn 4 (monitoring phase 1) includes sleep 30" "1" "$HAS_SLEEP_30"
assert_eq "turn 4 keeps main guidance first" "1" "$STARTS_WITH_CONTINUE"
assert_eq "turn 4 sleep guidance is conditional" "1" "$HAS_CONDITIONAL_WAIT_30"

# Turn 9 (threshold=3, so turn 9 = 3+5+1 is monitoring phase 2): should include "sleep 60"
for i in $(seq 5 8); do
  echo "$INPUT_JSON" | \
    CLAUDE_AUTOPILOT=1 \
    CLAUDE_AUTOPILOT_MAX_TURNS=30 \
    CLAUDE_AUTOPILOT_DELAY=0 \
    CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
    CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
    bash "$AUTOPILOT_HOOK" >/dev/null 2>&1 || true
done

AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=30 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

REASON=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.reason' 2>/dev/null || echo "")
HAS_SLEEP_60=$(echo "$REASON" | grep -c "sleep 60" || true)
HAS_CONDITIONAL_WAIT_60=$(echo "$REASON" | grep -c "$CONDITIONAL_WAIT_TEXT" || true)
STARTS_WITH_CONTINUE=$(echo "$REASON" | grep -c "^Continue from where you left off" || true)
assert_eq "turn 9 (monitoring phase 2) includes sleep 60" "1" "$HAS_SLEEP_60"
assert_eq "turn 9 keeps main guidance first" "1" "$STARTS_WITH_CONTINUE"
assert_eq "turn 9 sleep guidance is conditional" "1" "$HAS_CONDITIONAL_WAIT_60"

cleanup_session "$SID"

# ============================================================================
# Test 9: Infinite mode stays in work phase and never completes
# ============================================================================
echo ""
echo -e "${YELLOW}Test 9: Infinite mode stays in work phase${NC}"

SID="test-stop-hook-9"
cleanup_session "$SID"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'

for i in $(seq 1 8); do
  AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
    CLAUDE_AUTOPILOT=1 \
    CLAUDE_AUTOPILOT_MAX_TURNS=-1 \
    CLAUDE_AUTOPILOT_DELAY=0 \
    CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=3 \
    CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
    bash "$AUTOPILOT_HOOK" 2>/dev/null) || true
done

REASON=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.reason' 2>/dev/null || echo "")
HAS_SLEEP=$(echo "$REASON" | grep -c "sleep" || true)
TURN_COUNT=$(cat "/tmp/claude-autopilot-turns-${SID}" 2>/dev/null || echo "")

assert_eq "infinite mode has no sleep instruction after many turns" "0" "$HAS_SLEEP"
assert_eq "infinite mode keeps incrementing turns" "8" "$TURN_COUNT"
assert_file_exists "infinite mode keeps blocked flag set" "/tmp/claude-autopilot-blocked-${SID}"
assert_file_not_exists "infinite mode does not write completed marker" "/tmp/claude-autopilot-completed-${SID}"

cleanup_session "$SID"

# ============================================================================
# Test 10: Review-enabled prompt keeps review guidance first
# ============================================================================
echo ""
echo -e "${YELLOW}Test 10: Review prompt keeps review guidance first${NC}"

SID="test-stop-hook-10"
cleanup_session "$SID"

INPUT_JSON='{"session_id":"'"$SID"'","stop_hook_active":false}'
echo "7" > "/tmp/claude-autopilot-turns-${SID}"

AUTOPILOT_OUTPUT=$(echo "$INPUT_JSON" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=10 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_AUTOPILOT_MONITORING_THRESHOLD=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$AUTOPILOT_HOOK" 2>/dev/null) || true

REASON=$(echo "$AUTOPILOT_OUTPUT" | jq -r '.reason' 2>/dev/null || echo "")
STARTS_WITH_REVIEW=$(echo "$REASON" | grep -c "^Code review is running" || true)
HAS_SLEEP_60=$(echo "$REASON" | grep -c "sleep 60" || true)
HAS_CONDITIONAL_WAIT=$(echo "$REASON" | grep -c "$CONDITIONAL_WAIT_TEXT" || true)

assert_eq "review turn starts with review guidance" "1" "$STARTS_WITH_REVIEW"
assert_eq "review turn keeps conditional sleep guidance" "1" "$HAS_CONDITIONAL_WAIT"
assert_eq "review turn includes sleep 60 when monitoring" "1" "$HAS_SLEEP_60"
assert_file_not_exists "review turn clears blocked flag" "/tmp/claude-autopilot-blocked-${SID}"

cleanup_session "$SID"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All $TOTAL assertions passed ($PASS/$TOTAL)${NC}"
else
  echo -e "${RED}$FAIL/$TOTAL assertions failed${NC} (${PASS} passed)"
fi
echo "============================================"

exit "$FAIL"
