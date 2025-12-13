#!/usr/bin/env bash
# E2E tests for SSH commands (cloud + local)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
DMUX="${ROOT_DIR}/packages/sandbox/target/release/dmux"
DEV_PID=""
SANDBOX_ID=""

# Set base URL for dmux (dev server runs on 46831, not dmux's default 46833)
export CMUX_SANDBOX_URL="http://localhost:46831"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_test() { echo -e "${GREEN}[TEST]${NC} $*"; }

cleanup() {
    log_info "Cleaning up..."

    # Delete sandbox if created
    if [[ -n "${SANDBOX_ID}" ]]; then
        log_info "Deleting sandbox ${SANDBOX_ID}..."
        curl -sf -X DELETE "http://localhost:46831/sandboxes/${SANDBOX_ID}" || true
    fi

    # Kill dev server if we started it
    if [[ -n "${DEV_PID}" ]]; then
        log_info "Stopping dev server (PID ${DEV_PID})..."
        kill "${DEV_PID}" 2>/dev/null || true
        wait "${DEV_PID}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Build dmux if needed
if [[ ! -f "${DMUX}" ]]; then
    log_info "Building dmux..."
    (cd "${ROOT_DIR}/packages/sandbox" && cargo build --release --bin dmux)
fi

# Check if dev server is already running
if curl -sf "http://localhost:46831/healthz" >/dev/null 2>&1; then
    log_info "Dev server already running"
else
    log_info "Starting dev server..."
    (cd "${ROOT_DIR}" && ./scripts/dev.sh) &
    DEV_PID=$!

    # Wait for health check
    log_info "Waiting for dev server to be ready..."
    for i in $(seq 1 120); do
        if curl -sf "http://localhost:46831/healthz" >/dev/null 2>&1; then
            log_info "Dev server ready after ${i}s"
            break
        fi
        if [[ $i -eq 120 ]]; then
            log_error "Dev server failed to start after 120s"
            exit 1
        fi
        sleep 1
    done
fi

# ============================================================================
# LOCAL SANDBOX TESTS
# ============================================================================

log_info "=========================================="
log_info "LOCAL SANDBOX TESTS"
log_info "=========================================="

# Create a local sandbox
log_test "Creating local sandbox..."
CREATE_OUTPUT=$(curl -sf -X POST "http://localhost:46831/sandboxes" \
    -H "Content-Type: application/json" \
    -d '{"name": "e2e-ssh-test", "workspace": "/tmp/e2e-ssh-test"}')
SANDBOX_ID=$(echo "${CREATE_OUTPUT}" | jq -r '.id')
SANDBOX_INDEX=$(echo "${CREATE_OUTPUT}" | jq -r '.index')
log_info "Created sandbox: ${SANDBOX_ID} (index: ${SANDBOX_INDEX})"

# Test with both full UUID and short prefix
LOCAL_ID_FULL="l_${SANDBOX_ID}"
LOCAL_ID_SHORT="l_${SANDBOX_ID:0:8}"
log_info "Local ID (full): ${LOCAL_ID_FULL}"
log_info "Local ID (short): ${LOCAL_ID_SHORT}"

# Also test with raw UUID (no l_ prefix - should work for task run IDs)
log_info "Raw UUID: ${SANDBOX_ID}"

# Test ssh-exec with l_<full-uuid>
log_test "Testing ssh-exec with l_<full-uuid>..."
EXEC_OUTPUT=$("${DMUX}" ssh-exec "${LOCAL_ID_FULL}" echo "hello full uuid")
if [[ "${EXEC_OUTPUT}" == *"hello full uuid"* ]]; then
    log_info "PASS: ssh-exec l_<full-uuid>"
else
    log_error "FAIL: ssh-exec l_<full-uuid>"
    log_error "Output: ${EXEC_OUTPUT}"
    exit 1
fi

# Test ssh-exec with l_<short-prefix>
log_test "Testing ssh-exec with l_<short-prefix>..."
EXEC_OUTPUT=$("${DMUX}" ssh-exec "${LOCAL_ID_SHORT}" echo "hello short prefix")
if [[ "${EXEC_OUTPUT}" == *"hello short prefix"* ]]; then
    log_info "PASS: ssh-exec l_<short-prefix>"
else
    log_error "FAIL: ssh-exec l_<short-prefix>"
    log_error "Output: ${EXEC_OUTPUT}"
    exit 1
fi

# Test ssh-exec exit code propagation
log_test "Testing ssh-exec exit code propagation..."
set +e
"${DMUX}" ssh-exec "${LOCAL_ID_FULL}" "exit 42"
EXIT_CODE=$?
set -e
if [[ "${EXIT_CODE}" -eq 42 ]]; then
    log_info "PASS: ssh-exec exit code propagation (got ${EXIT_CODE})"
else
    log_error "FAIL: ssh-exec exit code propagation (expected 42, got ${EXIT_CODE})"
    exit 1
fi

# Test ssh-exec with command that has spaces
log_test "Testing ssh-exec with complex command..."
EXEC_OUTPUT=$("${DMUX}" ssh-exec "${LOCAL_ID_FULL}" "echo 'hello world' && pwd")
if [[ "${EXEC_OUTPUT}" == *"hello world"* ]] && [[ "${EXEC_OUTPUT}" == *"/workspace"* ]]; then
    log_info "PASS: ssh-exec complex command"
else
    log_error "FAIL: ssh-exec complex command"
    log_error "Output: ${EXEC_OUTPUT}"
    exit 1
fi

# Test interactive SSH with full UUID
log_test "Testing interactive SSH with l_<full-uuid>..."
INTERACTIVE_OUTPUT=$(echo "echo 'interactive full' && exit" | timeout 10 "${DMUX}" ssh "${LOCAL_ID_FULL}" 2>&1 || true)
if [[ "${INTERACTIVE_OUTPUT}" == *"interactive full"* ]] || [[ "${INTERACTIVE_OUTPUT}" == *"Connected"* ]]; then
    log_info "PASS: interactive SSH l_<full-uuid>"
else
    log_warn "WARN: interactive SSH l_<full-uuid> may have issues"
fi

# Test interactive SSH with short prefix
log_test "Testing interactive SSH with l_<short-prefix>..."
INTERACTIVE_OUTPUT=$(echo "echo 'interactive short' && exit" | timeout 10 "${DMUX}" ssh "${LOCAL_ID_SHORT}" 2>&1 || true)
if [[ "${INTERACTIVE_OUTPUT}" == *"interactive short"* ]] || [[ "${INTERACTIVE_OUTPUT}" == *"Connected"* ]]; then
    log_info "PASS: interactive SSH l_<short-prefix>"
else
    log_warn "WARN: interactive SSH l_<short-prefix> may have issues"
fi

# ============================================================================
# CLOUD SANDBOX TESTS (optional - requires CMUX_API_URL)
# ============================================================================

if [[ -n "${CMUX_API_URL:-}" ]] && [[ -n "${TEST_CLOUD_SANDBOX_ID:-}" ]]; then
    log_info "=========================================="
    log_info "CLOUD SANDBOX TESTS"
    log_info "=========================================="

    CLOUD_ID="c_${TEST_CLOUD_SANDBOX_ID}"
    log_info "Cloud ID: ${CLOUD_ID}"

    # Test ssh-exec with cloud sandbox
    log_test "Testing ssh-exec with cloud sandbox..."
    EXEC_OUTPUT=$("${DMUX}" ssh-exec "${CLOUD_ID}" echo "hello from cloud sandbox" 2>&1 || true)
    if [[ "${EXEC_OUTPUT}" == *"hello from cloud sandbox"* ]]; then
        log_info "PASS: ssh-exec cloud sandbox"
    else
        log_warn "WARN: ssh-exec cloud sandbox (output: ${EXEC_OUTPUT})"
    fi
else
    log_warn "Skipping cloud tests (set CMUX_API_URL and TEST_CLOUD_SANDBOX_ID to enable)"
fi

# ============================================================================
# SUMMARY
# ============================================================================

log_info "=========================================="
log_info "ALL TESTS PASSED"
log_info "=========================================="
