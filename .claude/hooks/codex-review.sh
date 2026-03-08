#!/bin/bash
# Runs codex code review in background and shows results on next stop
# This avoids blocking the stop hook while codex runs (which can take 5+ minutes)

set -euo pipefail

# Debug logging is opt-in via CODEX_REVIEW_DEBUG=1
DEBUG_ENABLED="${CODEX_REVIEW_DEBUG:-0}"
debug_log() {
  if [ "$DEBUG_ENABLED" = "1" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "/tmp/codex-review-debug.log"
  fi
}

debug_log "=== codex-review.sh START ==="
debug_log "CODEX_REVIEW_DISABLED=${CODEX_REVIEW_DISABLED:-}"
debug_log "CLAUDE_AUTOPILOT=${CLAUDE_AUTOPILOT:-}"

# Skip if disabled via env var
if [ "${CODEX_REVIEW_DISABLED:-}" = "1" ]; then
  debug_log "Exiting: CODEX_REVIEW_DISABLED=1"
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Read session_id from hook stdin JSON
INPUT=$(cat)
debug_log "INPUT JSON: $INPUT"

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null || echo "default")
SESSION_ID="${SESSION_ID:-default}"
debug_log "SESSION_ID: $SESSION_ID"

# Session-scoped file paths
REVIEWED_FILE="/tmp/codex-review-reviewed-${SESSION_ID}"
RESULT_FILE="/tmp/codex-review-result-${SESSION_ID}"
BG_PID_FILE="/tmp/codex-review-pid-${SESSION_ID}"
BG_STATE_FILE="/tmp/codex-review-bg-state-${SESSION_ID}"
FAIL_COUNT_FILE="/tmp/codex-review-fails-${SESSION_ID}"
AUTOPILOT_BLOCKED_FILE="/tmp/claude-autopilot-blocked-${SESSION_ID}"
COMPLETED_FILE="/tmp/claude-autopilot-completed-${SESSION_ID}"

# Clean up completed marker on exit
trap 'rm -f "$COMPLETED_FILE"' EXIT

# Autopilot is only active when Claude set it for this run and it has not been
# explicitly disabled via AUTOPILOT_KEEP_RUNNING_DISABLED=1.
AUTOPILOT_ACTIVE="0"
if [ "${CLAUDE_AUTOPILOT:-0}" = "1" ] && [ "${AUTOPILOT_KEEP_RUNNING_DISABLED:-0}" != "1" ]; then
  AUTOPILOT_ACTIVE="1"
fi
debug_log "AUTOPILOT_ACTIVE: $AUTOPILOT_ACTIVE, AUTOPILOT_BLOCKED_FILE exists: $([ -f "$AUTOPILOT_BLOCKED_FILE" ] && echo 'true' || echo 'false')"

# Skip if autopilot specifically blocked this stop
if [ "$AUTOPILOT_ACTIVE" = "1" ] && [ -f "$AUTOPILOT_BLOCKED_FILE" ]; then
  debug_log "Exiting: autopilot blocked this stop (flag file exists)"
  exit 0
fi

# Clean up stale flag file if autopilot is not active
if [ "$AUTOPILOT_ACTIVE" != "1" ] && [ -f "$AUTOPILOT_BLOCKED_FILE" ]; then
  rm -f "$AUTOPILOT_BLOCKED_FILE"
  debug_log "Cleaned up stale autopilot blocked flag"
fi

# --- Compute current state fingerprint FIRST ---
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
MAIN_BASE=$(git merge-base main HEAD 2>/dev/null || echo "unknown")
HAS_UNCOMMITTED=$(git status --porcelain 2>/dev/null | grep -q . && echo "1" || echo "0")

# For dirty tree, include hash of both unstaged AND staged changes
if [ "$HAS_UNCOMMITTED" = "1" ]; then
  # Combine unstaged (git diff) and staged (git diff --cached) for full fingerprint
  DIRTY_HASH=$({ git diff 2>/dev/null; git diff --cached 2>/dev/null; } | shasum -a 256 | cut -c1-16)
else
  DIRTY_HASH="clean"
fi

STATE_FINGERPRINT="${CURRENT_HEAD}:${DIRTY_HASH}"
debug_log "Current state fingerprint: $STATE_FINGERPRINT"

# --- Check for completed background review results ---
# Show results from previous background review if available
if [ -f "$RESULT_FILE" ]; then
  PREV_STATE=$(cat "$BG_STATE_FILE" 2>/dev/null || echo "")
  FINDINGS=$(cat "$RESULT_FILE")
  rm -f "$RESULT_FILE" "$BG_PID_FILE" "$BG_STATE_FILE"

  # Discard stale results if repo state changed since review started
  if [ "$PREV_STATE" != "$STATE_FINGERPRINT" ]; then
    debug_log "Discarding stale results for $PREV_STATE (current: $STATE_FINGERPRINT)"
    FINDINGS=""
  fi

  if [ -n "$FINDINGS" ]; then
    debug_log "Found background review results for state: $PREV_STATE"

    # Check fail count
    FAIL_COUNT=0
    if [ -f "$FAIL_COUNT_FILE" ]; then
      FAIL_COUNT=$(cat "$FAIL_COUNT_FILE")
    fi

    if [ "$FAIL_COUNT" -ge 5 ]; then
      debug_log "Hit fail limit, not showing results"
    else
      # Use opencode to check if review passed
      VERDICT=$(opencode run "Output: $FINDINGS

If the output indicates code review passed with no issues, return exactly 'lgtm'. Otherwise return 'issues'." --model opencode/big-pickle 2>/dev/null || echo "issues")

      if echo "$VERDICT" | grep -qi "lgtm"; then
        rm -f "$FAIL_COUNT_FILE"
        debug_log "Background review PASSED (lgtm)"
        echo "$PREV_STATE" > "$REVIEWED_FILE"
        # Review passed, no action needed
      else
        echo "$PREV_STATE" > "$REVIEWED_FILE"
        echo $((FAIL_COUNT + 1)) > "$FAIL_COUNT_FILE"
        debug_log "Background review has ISSUES"

        REMAINING_INFO=""
        if [ "$AUTOPILOT_ACTIVE" = "1" ]; then
          TURN_FILE="/tmp/claude-autopilot-turns-${SESSION_ID}"
          if [ -f "$TURN_FILE" ]; then
            CURRENT_TURN=$(cat "$TURN_FILE" 2>/dev/null || echo "0")
            AP_MAX="${CLAUDE_AUTOPILOT_MAX_TURNS:-20}"
            REMAINING=$((AP_MAX - CURRENT_TURN))
            if [ "$REMAINING" -gt 0 ]; then
              REMAINING_INFO=" You have $REMAINING autopilot turns remaining to address these."
            fi
          fi
        fi

        echo "## Codex Code Review Findings (attempt $((FAIL_COUNT + 1))/5)

$FINDINGS

---
Please address the above issues.${REMAINING_INFO}" >&2
        exit 2
      fi
    fi
  fi
fi

# --- Session-based work detection (fingerprint already computed above) ---

# Check if already reviewed this exact state
if [ -f "$REVIEWED_FILE" ] && [ "$(cat "$REVIEWED_FILE")" = "$STATE_FINGERPRINT" ]; then
  debug_log "Skipping: already reviewed state $STATE_FINGERPRINT"
  exit 0
fi

# Check if background review already running for this state
if [ -f "$BG_PID_FILE" ] && [ -f "$BG_STATE_FILE" ]; then
  BG_PID=$(cat "$BG_PID_FILE")
  BG_STATE=$(cat "$BG_STATE_FILE")
  if [ "$BG_STATE" = "$STATE_FINGERPRINT" ] && kill -0 "$BG_PID" 2>/dev/null; then
    debug_log "Background review already running for state $STATE_FINGERPRINT (pid $BG_PID)"
    exit 0
  fi
fi

# Determine if there's work to review
COMMITS_AHEAD=$(git rev-list --count "${MAIN_BASE}..HEAD" 2>/dev/null || echo "0")

if [ "$COMMITS_AHEAD" = "0" ] && [ "$HAS_UNCOMMITTED" = "0" ]; then
  TURN_FILE="/tmp/claude-autopilot-turns-${SESSION_ID}"
  if [ "$AUTOPILOT_ACTIVE" = "1" ] && [ -f "$COMPLETED_FILE" ]; then
    debug_log "Work detected via autopilot completed marker"
  elif [ -f "$TURN_FILE" ]; then
    debug_log "Work detected via turn file"
  else
    debug_log "Skipping: no work vs main"
    exit 0
  fi
fi

debug_log "Proceeding with codex review..."

# Dry-run mode
if [ "${CODEX_REVIEW_DRY_RUN:-}" = "1" ]; then
  debug_log "Dry-run mode, exiting"
  exit 0
fi

# Check fail count before starting new review
FAIL_COUNT=0
if [ -f "$FAIL_COUNT_FILE" ]; then
  FAIL_COUNT=$(cat "$FAIL_COUNT_FILE")
fi
if [ "$FAIL_COUNT" -ge 5 ]; then
  debug_log "Hit fail limit, not starting new review"
  exit 0
fi

debug_log "Starting background codex review for state $STATE_FINGERPRINT..."

# Kill any existing background review (and its children)
if [ -f "$BG_PID_FILE" ]; then
  OLD_PID=$(cat "$BG_PID_FILE")
  debug_log "Killing old background review (pid $OLD_PID)"
  # Kill process tree: first children, then parent
  pkill -P "$OLD_PID" 2>/dev/null || true
  kill "$OLD_PID" 2>/dev/null || true
  rm -f "$BG_PID_FILE" "$BG_STATE_FILE"
fi

# Start background review (no timeout - let it run as long as needed)
(
  TMPFILE=$(mktemp)
  trap 'rm -f "$TMPFILE"' EXIT

  if command -v unbuffer >/dev/null 2>&1; then
    unbuffer codex \
      --sandbox danger-full-access \
      --model gpt-5.4 \
      -c model_reasoning_effort="high" \
      review --base main > "$TMPFILE" 2>&1 || true
  else
    codex \
      --sandbox danger-full-access \
      --model gpt-5.4 \
      -c model_reasoning_effort="high" \
      review --base main > "$TMPFILE" 2>&1 || true
  fi

  # Extract findings
  CLEAN=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPFILE")
  FINDINGS=$(echo "$CLEAN" | awk '
    /^codex$/ { found=1; content=""; next }
    found { content = content $0 "\n" }
    END { print content }
  ' | sed '/^$/d' | grep -v '^tokens used' | head -50)

  # Save results for next stop to pick up
  echo "$FINDINGS" > "$RESULT_FILE"
  rm -f "$BG_PID_FILE"
) &

BG_PID=$!
echo "$BG_PID" > "$BG_PID_FILE"
echo "$STATE_FINGERPRINT" > "$BG_STATE_FILE"
debug_log "Background review started (pid $BG_PID)"

# Exit immediately - don't block the stop hook
exit 0
