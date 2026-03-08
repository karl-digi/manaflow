#!/bin/bash
# Test: completed marker flow between autopilot and codex-review hooks
#
# Validates the fix for: codex-review not running after autopilot max turns
# because the turn file is deleted before codex-review can check it.
#
# Run from repo root on branch fix/autopilot-codex-review-completed-marker:
#   bash .claude/hooks/test-completed-marker.sh
#
# Expected: all tests PASS

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_SESSION="test-$$"
PASS=0
FAIL=0

cleanup() {
  rm -f "/tmp/claude-autopilot-turns-${TEST_SESSION}"
  rm -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"
  rm -f "/tmp/claude-autopilot-blocked-${TEST_SESSION}"
  rm -f "/tmp/claude-autopilot-stop-${TEST_SESSION}"
  rm -f "/tmp/claude-autopilot-completed-default"
  rm -f "/tmp/claude-autopilot-turns-default"
  rm -f "/tmp/claude-autopilot-blocked-default"
  rm -f "/tmp/codex-review-debug.log"
}
trap cleanup EXIT

assert() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

# assert_not: passes when the command FAILS (for negated checks)
assert_not() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  fi
}

echo "=== Test: completed marker flow ==="
echo "Session: $TEST_SESSION"
echo ""

# Clear debug log to avoid stale entries
rm -f /tmp/codex-review-debug.log

# --- Test 1: autopilot writes completed marker at max turns ---
echo "[1] autopilot-keep-running.sh: writes marker at max turns"
cleanup
echo "1" > "/tmp/claude-autopilot-turns-${TEST_SESSION}"

echo "{\"session_id\":\"${TEST_SESSION}\"}" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=2 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/autopilot-keep-running.sh" >/dev/null 2>&1 || true

assert "Completed marker exists" test -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"
assert_not "Turn file still exists (should be deleted)" test -f "/tmp/claude-autopilot-turns-${TEST_SESSION}"
assert "Marker contains turn count" grep -q "2" "/tmp/claude-autopilot-completed-${TEST_SESSION}"

# --- Test 2: codex-review detects marker via dry-run ---
echo ""
echo "[2] codex-review.sh: detects completed marker (dry-run)"

# The completed marker from test 1 should still exist
echo "{\"session_id\":\"${TEST_SESSION}\"}" | \
  CLAUDE_AUTOPILOT=1 \
  CODEX_REVIEW_DISABLED=0 \
  CODEX_REVIEW_DEBUG=1 \
  CODEX_REVIEW_DRY_RUN=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/codex-review.sh" >/dev/null 2>&1 || true

# The hook should proceed to review (not skip with "no work done").
# On a branch with changes, Check 2 (git diff) fires before Check 4.
# On a clean branch, Check 4 (completed marker) fires instead.
# Either way the hook must NOT exit with "Skipping review".
assert_not "Hook proceeds (no 'Skipping review')" grep -q "Skipping review" /tmp/codex-review-debug.log
assert "Hook reaches dry-run checkpoint" grep -q "Dry-run mode" /tmp/codex-review-debug.log
assert_not "Completed marker cleaned up by trap" test -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"

# --- Test 3: stale marker cleaned by autopilot on next cycle ---
echo ""
echo "[3] autopilot-keep-running.sh: cleans stale marker on next cycle"

echo "stale" > "/tmp/claude-autopilot-completed-${TEST_SESSION}"

echo "{\"session_id\":\"${TEST_SESSION}\"}" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=20 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/autopilot-keep-running.sh" >/dev/null 2>&1 || true

assert_not "Stale marker removed at cycle start" test -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"

# --- Test 4: empty session_id falls back to "default" ---
echo ""
echo "[4] SESSION_ID guard: empty falls back to 'default'"

echo '{}' | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=1 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/autopilot-keep-running.sh" >/dev/null 2>&1 || true

assert "Marker written with 'default' session" test -f "/tmp/claude-autopilot-completed-default"

# --- Test 5: no marker when autopilot not enabled ---
echo ""
echo "[5] No marker when CLAUDE_AUTOPILOT unset"
cleanup

echo "{\"session_id\":\"${TEST_SESSION}\"}" | \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/autopilot-keep-running.sh" >/dev/null 2>&1 || true

assert_not "No marker when autopilot disabled" test -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"

# --- Test 6: max turns -1 keeps running without completed marker ---
echo ""
echo "[6] Infinite mode: no completed marker when CLAUDE_AUTOPILOT_MAX_TURNS=-1"
cleanup
echo "5" > "/tmp/claude-autopilot-turns-${TEST_SESSION}"

echo "{\"session_id\":\"${TEST_SESSION}\"}" | \
  CLAUDE_AUTOPILOT=1 \
  CLAUDE_AUTOPILOT_MAX_TURNS=-1 \
  CLAUDE_AUTOPILOT_DELAY=0 \
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
  bash "$SCRIPT_DIR/autopilot-keep-running.sh" >/dev/null 2>&1 || true

assert_not "No completed marker in infinite mode" test -f "/tmp/claude-autopilot-completed-${TEST_SESSION}"
assert "Turn file retained in infinite mode" test -f "/tmp/claude-autopilot-turns-${TEST_SESSION}"
assert "Turn count increments in infinite mode" grep -q "6" "/tmp/claude-autopilot-turns-${TEST_SESSION}"

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

[ "$FAIL" -eq 0 ]
