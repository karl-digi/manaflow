#!/usr/bin/env bash
# pve-test-template.sh - Test a PVE LXC template by cloning and verifying
# Usage: ./pve-test-template.sh [template-vmid]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/pve-api.sh"

DEFAULT_TEMPLATE_VMID="${PVE_TEMPLATE_VMID:-9000}"

usage() {
    cat << EOF
Usage: $(basename "$0") [template-vmid]

Tests a PVE LXC template by:
  1. Cloning to a temporary container
  2. Starting the container
  3. Verifying installed tools (node, bun, uv, docker)
  4. Cleaning up (stop + delete)

Arguments:
  template-vmid   Template VMID to test (default: ${DEFAULT_TEMPLATE_VMID})

Examples:
  $(basename "$0")           # Test template 9000
  $(basename "$0") 9001      # Test template 9001
EOF
}

# Global vars for cleanup trap
TEST_VMID=""
TEST_NODE=""

cleanup() {
    if [[ -n "$TEST_VMID" && -n "$TEST_NODE" ]]; then
        log_info "Cleaning up test container ${TEST_VMID}..."
        pve_lxc_stop "$TEST_VMID" "$TEST_NODE" 2>/dev/null || true
        sleep 2
        pve_lxc_delete "$TEST_VMID" "$TEST_NODE" 2>/dev/null || true
        log_success "Cleanup complete"
    fi
}
trap cleanup EXIT

main() {
    local template_vmid="${1:-$DEFAULT_TEMPLATE_VMID}"

    if [[ "$template_vmid" == "-h" || "$template_vmid" == "--help" ]]; then
        usage
        exit 0
    fi

    TEST_NODE=$(pve_get_default_node)

    # Find next available VMID for test container
    TEST_VMID=$(pve_api GET "/api2/json/cluster/nextid" | jq -r '.data')

    log_info "Testing template ${template_vmid} on node ${TEST_NODE}"
    log_info "Test container VMID: ${TEST_VMID}"
    echo ""

    # 1. Clone template
    log_info "[1/4] Cloning template ${template_vmid} to ${TEST_VMID}..."
    local clone_result
    clone_result=$(pve_lxc_clone "$template_vmid" "$TEST_VMID" "$TEST_NODE")
    local upid
    upid=$(echo "$clone_result" | jq -r '.data // empty')
    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 300 "$TEST_NODE"
    fi

    # 2. Start container
    log_info "[2/4] Starting test container..."
    local start_result
    start_result=$(pve_lxc_start "$TEST_VMID" "$TEST_NODE")
    upid=$(echo "$start_result" | jq -r '.data // empty')
    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 60 "$TEST_NODE"
    fi
    sleep 3

    # 3. Verify tools via SSH to PVE host
    log_info "[3/4] Verifying installed tools..."
    echo ""

    local pve_ssh_host="root@$(echo "${PVE_API_URL}" | sed -E 's|https?://([^:/]+).*|\1|')"

    local failed=0

    # Check each tool
    check_tool() {
        local name="$1"
        local cmd="$2"
        local result
        if result=$(ssh -o ConnectTimeout=5 "$pve_ssh_host" "pct exec ${TEST_VMID} -- $cmd" 2>/dev/null); then
            echo "  [OK] $name: $result"
        else
            echo "  [FAIL] $name: not found or error"
            failed=1
        fi
    }

    check_tool "Node.js" "node --version"
    check_tool "Bun" "/usr/local/bin/bun --version"
    check_tool "uv" "/usr/local/bin/uv --version"
    check_tool "Docker" "docker --version"

    echo ""

    # 4. Results
    log_info "[4/4] Test results"
    if [[ $failed -eq 0 ]]; then
        log_success "All tools verified successfully!"
        echo ""
        echo "Template ${template_vmid} is ready for use."
    else
        log_warn "Some tools failed verification"
        echo ""
        echo "Template may need reconfiguration."
        exit 1
    fi
}

main "$@"
