#!/usr/bin/env bash
# E2E test script for devsh orchestration CLI commands
# Run: ./scripts/test-orchestration.sh
set -euo pipefail

echo "=== devsh Orchestration E2E Tests ==="
echo ""

# Check prerequisites
if ! command -v devsh &> /dev/null; then
  echo "[SETUP] devsh not found, building..."
  make install-devsh-dev
fi

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo "[PASS] $1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "[FAIL] $1"; }
skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); echo "[SKIP] $1"; }

# Test 1: Help command
echo ""
echo "[1/10] Testing orchestrate help command..."
if devsh orchestrate --help > /dev/null 2>&1; then
  pass "orchestrate --help works"
else
  fail "orchestrate --help failed"
fi

# Test 2: List command (should work even without auth - returns empty or auth error)
echo ""
echo "[2/10] Testing orchestrate list..."
if devsh orchestrate list 2>&1 | grep -qE "task|error|unauthorized|Error"; then
  pass "orchestrate list responds (auth may be missing)"
else
  fail "orchestrate list failed silently"
fi

# Test 3: Status with invalid ID (should fail gracefully)
echo ""
echo "[3/10] Testing orchestrate status with invalid ID..."
STATUS_OUTPUT=$(devsh orchestrate status invalid_id_12345 2>&1 || true)
if echo "$STATUS_OUTPUT" | grep -qiE "not found|error|invalid|fail|unauthorized"; then
  pass "invalid ID handled correctly"
else
  echo "    Output: $STATUS_OUTPUT"
  fail "unexpected response for invalid ID"
fi

# Test 4: Cancel with invalid ID (should fail gracefully)
echo ""
echo "[4/10] Testing orchestrate cancel with invalid ID..."
CANCEL_OUTPUT=$(devsh orchestrate cancel invalid_id_12345 2>&1 || true)
if echo "$CANCEL_OUTPUT" | grep -qiE "not found|error|invalid|fail|unauthorized"; then
  pass "invalid cancel handled correctly"
else
  echo "    Output: $CANCEL_OUTPUT"
  fail "unexpected response for invalid cancel"
fi

# Test 5: Spawn (requires auth - skip in CI if not configured)
echo ""
echo "[5/10] Testing orchestrate spawn (requires auth)..."
if [ -n "${CMUX_AUTH_TOKEN:-}" ]; then
  SPAWN_OUTPUT=$(devsh orchestrate spawn \
    --agent claude/haiku-4.5 \
    --repo karlorz/testing-repo-1 \
    "Test prompt: list files in current directory" 2>&1 || true)
  if echo "$SPAWN_OUTPUT" | grep -qiE "orchestrationTaskId|taskId|running|success"; then
    pass "spawn succeeded"
  elif echo "$SPAWN_OUTPUT" | grep -qiE "error|fail|unauthorized"; then
    fail "spawn failed: $SPAWN_OUTPUT"
  else
    echo "    Output: $SPAWN_OUTPUT"
    fail "unexpected spawn response"
  fi
else
  skip "CMUX_AUTH_TOKEN not set"
fi

# Test 6: Wait command - invalid ID
echo ""
echo "[6/10] Testing orchestrate wait with invalid ID..."
WAIT_OUTPUT=$(timeout 10s devsh orchestrate wait invalid_id_12345 --timeout 5s 2>&1 || true)
if echo "$WAIT_OUTPUT" | grep -qiE "not found|error|invalid|fail|unauthorized|timeout"; then
  pass "wait with invalid ID handled correctly"
else
  echo "    Output: $WAIT_OUTPUT"
  fail "unexpected wait response for invalid ID"
fi

# Test 7: Wait command - timeout
echo ""
echo "[7/10] Testing orchestrate wait timeout..."
# This should timeout since we're using a fake ID
WAIT_TIMEOUT_OUTPUT=$(timeout 10s devsh orchestrate wait fake_task_that_does_not_exist --timeout 3s 2>&1 || true)
if echo "$WAIT_TIMEOUT_OUTPUT" | grep -qiE "timeout|not found|error|fail"; then
  pass "wait timeout handled correctly"
else
  echo "    Output: $WAIT_TIMEOUT_OUTPUT"
  fail "wait did not timeout as expected"
fi

# Test 8: Message command - missing type flag
echo ""
echo "[8/10] Testing orchestrate message without --type..."
MSG_NO_TYPE=$(devsh orchestrate message fake_task_run_id "test message" 2>&1 || true)
if echo "$MSG_NO_TYPE" | grep -qiE "type.*required|missing|flag"; then
  pass "message without type handled correctly"
else
  echo "    Output: $MSG_NO_TYPE"
  fail "message should require --type flag"
fi

# Test 9: Message command - invalid type
echo ""
echo "[9/10] Testing orchestrate message with invalid type..."
MSG_INVALID_TYPE=$(devsh orchestrate message fake_task_run_id "test message" --type invalid_type 2>&1 || true)
if echo "$MSG_INVALID_TYPE" | grep -qiE "invalid.*type|must be|handoff|request|status"; then
  pass "message with invalid type handled correctly"
else
  echo "    Output: $MSG_INVALID_TYPE"
  fail "message should reject invalid type"
fi

# Test 10: Migrate command - missing plan file
echo ""
echo "[10/10] Testing orchestrate migrate without --plan-file..."
MIGRATE_NO_FILE=$(devsh orchestrate migrate 2>&1 || true)
if echo "$MIGRATE_NO_FILE" | grep -qiE "plan.*required|missing|file|required flag"; then
  pass "migrate without plan file handled correctly"
else
  # Check if the command just shows help (also acceptable)
  if echo "$MIGRATE_NO_FILE" | grep -qiE "Usage:|plan-file"; then
    pass "migrate shows usage without required args"
  else
    echo "    Output: $MIGRATE_NO_FILE"
    fail "migrate should require --plan-file"
  fi
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo "Skipped: $SKIP_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "Some tests failed!"
  exit 1
else
  echo "All tests passed (or skipped)!"
  exit 0
fi
