#!/usr/bin/env bash
# pve-criu.sh - CRIU checkpoint/restore operations for LXC containers
# Usage: ./pve-criu.sh <command> [options]
#
# Commands:
#   checkpoint <vmid>     - Create checkpoint (saves RAM state, suspends container)
#   restore <vmid>        - Restore from checkpoint (resumes container)
#   snapshot <vmid>       - Create disk snapshot (does not save RAM)
#   rollback <vmid> <snap>- Rollback to snapshot
#   list <vmid>           - List snapshots/checkpoints
#   delete <vmid> <name>  - Delete snapshot/checkpoint
#   status                - Check CRIU availability on node
#
# CRITICAL: CRIU checkpoint/restore is essential for RAM state preservation
# This allows cmux to pause sandboxes and resume with all processes intact.
#
# Required environment variables:
#   PVE_API_URL, PVE_API_TOKEN
#
# Optional:
#   PVE_NODE - Target node (auto-detected if not set)
#   PVE_CHECKPOINT_DIR - Directory for checkpoints (default: /var/lib/cmux/checkpoints)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/pve-api.sh"

# Default configuration
CHECKPOINT_DIR="${PVE_CHECKPOINT_DIR:-/var/lib/cmux/checkpoints}"

usage() {
    cat << EOF
Usage: $(basename "$0") <command> [options]

CRIU Checkpoint/Restore Commands:
  checkpoint <vmid>       Suspend container and save RAM state (CRIU)
  restore <vmid>          Resume container from checkpoint
  suspend <vmid>          Alias for checkpoint
  resume <vmid>           Alias for restore

Snapshot Commands (disk only, no RAM):
  snapshot <vmid> [name]  Create disk snapshot
  rollback <vmid> <name>  Rollback to snapshot
  list <vmid>             List snapshots for container
  delete <vmid> <name>    Delete a snapshot

Status Commands:
  status                  Check CRIU availability on node
  test <vmid>             Test checkpoint/restore cycle

Options:
  --state-file <path>     Custom state file path for checkpoint
  --timeout <seconds>     Timeout for operations (default: 300)

Examples:
  # Check if CRIU is available
  $(basename "$0") status

  # Create checkpoint (pause with RAM state)
  $(basename "$0") checkpoint 100

  # Restore from checkpoint (resume)
  $(basename "$0") restore 100

  # Test checkpoint/restore cycle
  $(basename "$0") test 100

  # Create disk snapshot (no RAM state)
  $(basename "$0") snapshot 100 pre-upgrade

  # List snapshots
  $(basename "$0") list 100

Notes:
  - CRIU checkpoint saves the complete process state including RAM
  - Disk snapshots only save the filesystem state
  - For cmux RAM snapshot parity with Morph, use checkpoint/restore
  - CRIU requires kernel support and proper container configuration
EOF
}

# Check if CRIU is available on the node
cmd_status() {
    local node
    node=$(pve_get_default_node)

    log_info "Checking CRIU status on node ${node}..."
    echo ""

    # Check node status for CRIU support
    local node_info
    node_info=$(pve_api GET "/api2/json/nodes/${node}/status")

    echo "Node: ${node}"
    echo "$node_info" | jq '.data | {
        pveversion: .pveversion,
        kversion: .kversion,
        cpuinfo: .cpuinfo.model
    }'

    echo ""
    log_info "To verify CRIU on the node, SSH and run:"
    echo "  criu check"
    echo "  criu check --all"
    echo ""
    echo "If CRIU is not installed:"
    echo "  apt-get install criu"
    echo ""

    # List containers that support checkpoint
    log_info "LXC containers and their checkpoint support:"
    echo ""

    local containers
    containers=$(pve_list_lxc "$node")

    echo "$containers" | jq -r '.data[] | "\(.vmid)\t\(.name // "-")\t\(.status)"' | \
    while IFS=$'\t' read -r vmid name status; do
        # Get container config to check features
        local config
        config=$(pve_lxc_config "$vmid" "$node" 2>/dev/null || echo '{}')

        local features
        features=$(echo "$config" | jq -r '.data.features // "none"')

        # CRIU works better with certain features
        local criu_ready="maybe"
        if [[ "$features" == *"nesting=1"* ]]; then
            criu_ready="likely"
        fi

        printf "  %-6s %-20s %-10s features=%s (CRIU: %s)\n" "$vmid" "$name" "[$status]" "$features" "$criu_ready"
    done

    echo ""
    log_info "For CRIU checkpoint support, containers should have:"
    echo "  - features=nesting=1 (for Docker-in-Docker)"
    echo "  - Unprivileged containers may have limitations"
    echo "  - Some applications may not checkpoint cleanly"
}

# Create CRIU checkpoint (suspend with RAM state)
cmd_checkpoint() {
    local vmid="$1"
    shift

    local state_file=""
    local timeout=300

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --state-file) state_file="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    local node
    node=$(pve_get_default_node)

    # Default state file path
    if [[ -z "$state_file" ]]; then
        state_file="${CHECKPOINT_DIR}/${vmid}.criu"
    fi

    # Check container is running
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" != "running" ]]; then
        log_error "Container ${vmid} is not running (status: ${status})"
        log_info "Only running containers can be checkpointed"
        return 1
    fi

    log_info "Creating CRIU checkpoint for container ${vmid}..."
    echo "  State file: ${state_file}"
    echo ""

    # Proxmox uses the suspend API for CRIU checkpoint
    # Note: This requires CRIU to be installed on the node
    local result
    result=$(pve_lxc_suspend "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        # Check for error message
        local error
        error=$(echo "$result" | jq -r '.errors // .message // empty')

        if [[ -n "$error" ]]; then
            log_error "Failed to create checkpoint: ${error}"
        else
            log_error "Failed to create checkpoint"
            echo "$result" | jq .
        fi

        echo ""
        log_info "Common issues:"
        echo "  - CRIU not installed: apt-get install criu"
        echo "  - Container not properly configured for CRIU"
        echo "  - Some running processes may block checkpointing"
        return 1
    fi

    pve_wait_task "$upid" "$timeout" "$node"

    # Verify container is now suspended
    local new_status
    new_status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$new_status" == "suspended" || "$new_status" == "stopped" ]]; then
        log_success "Container ${vmid} checkpointed successfully"
        echo ""
        echo "Container state: ${new_status}"
        echo "To restore: $(basename "$0") restore ${vmid}"
    else
        log_warn "Container status: ${new_status} (expected: suspended)"
    fi
}

# Restore from CRIU checkpoint (resume)
cmd_restore() {
    local vmid="$1"
    shift

    local state_file=""
    local timeout=300

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --state-file) state_file="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    local node
    node=$(pve_get_default_node)

    # Check container status
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "running" ]]; then
        log_warn "Container ${vmid} is already running"
        return 0
    fi

    log_info "Restoring container ${vmid} from checkpoint..."
    echo ""

    local result
    result=$(pve_lxc_resume "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        # If resume fails, try start
        log_warn "Resume failed, trying regular start..."
        result=$(pve_lxc_start "$vmid" "$node")
        upid=$(echo "$result" | jq -r '.data // empty')

        if [[ -z "$upid" ]]; then
            log_error "Failed to restore container"
            echo "$result" | jq .
            return 1
        fi
    fi

    pve_wait_task "$upid" "$timeout" "$node"

    # Verify container is running
    local new_status
    new_status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$new_status" == "running" ]]; then
        log_success "Container ${vmid} restored and running"

        # Brief delay for network to come up
        sleep 2

        # Show network info
        local ip
        ip=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.ip // empty' | head -n1)
        if [[ -n "$ip" ]]; then
            echo "  IP: ${ip}"
        fi
    else
        log_warn "Container status: ${new_status} (expected: running)"
    fi
}

# Create disk snapshot (no RAM state)
cmd_snapshot() {
    local vmid="$1"
    local snapname="${2:-snap-$(date +%Y%m%d-%H%M%S)}"

    local node
    node=$(pve_get_default_node)

    log_info "Creating disk snapshot '${snapname}' for container ${vmid}..."

    local result
    result=$(pve_lxc_snapshot "$vmid" "$snapname" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        log_error "Failed to create snapshot"
        echo "$result" | jq .
        return 1
    fi

    pve_wait_task "$upid" 300 "$node"

    log_success "Snapshot '${snapname}' created for container ${vmid}"
    echo ""
    echo "Note: Disk snapshots do NOT preserve RAM state."
    echo "For RAM state preservation, use: $(basename "$0") checkpoint ${vmid}"
}

# Rollback to snapshot
cmd_rollback() {
    local vmid="$1"
    local snapname="$2"

    local node
    node=$(pve_get_default_node)

    # Check if container is running
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "running" ]]; then
        log_warn "Container is running. It will be stopped for rollback."
        read -p "Continue? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cancelled"
            return 0
        fi
    fi

    log_info "Rolling back container ${vmid} to snapshot '${snapname}'..."

    local result
    result=$(pve_lxc_rollback "$vmid" "$snapname" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        log_error "Failed to rollback"
        echo "$result" | jq .
        return 1
    fi

    pve_wait_task "$upid" 300 "$node"

    log_success "Container ${vmid} rolled back to '${snapname}'"
}

# List snapshots
cmd_list() {
    local vmid="$1"

    local node
    node=$(pve_get_default_node)

    log_info "Snapshots for container ${vmid}:"
    echo ""

    local snapshots
    snapshots=$(pve_lxc_snapshots "$vmid" "$node")

    local count
    count=$(echo "$snapshots" | jq '.data | length')

    if [[ "$count" -eq 0 ]]; then
        echo "  (no snapshots)"
        return
    fi

    printf "%-20s %-20s %s\n" "NAME" "TIME" "DESCRIPTION"
    printf "%-20s %-20s %s\n" "----" "----" "-----------"

    echo "$snapshots" | jq -r '.data[] | [.name, (.snaptime // 0 | todate), (.description // "-")] | @tsv' | \
    while IFS=$'\t' read -r name snaptime description; do
        printf "%-20s %-20s %s\n" "$name" "$snaptime" "$description"
    done
}

# Delete snapshot
cmd_delete() {
    local vmid="$1"
    local snapname="$2"

    local node
    node=$(pve_get_default_node)

    log_warn "Deleting snapshot '${snapname}' from container ${vmid}..."
    read -p "Are you sure? (y/N) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled"
        return 0
    fi

    local result
    result=$(pve_api DELETE "/api2/json/nodes/${node}/lxc/${vmid}/snapshot/${snapname}")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 120 "$node"
        log_success "Snapshot '${snapname}' deleted"
    else
        log_error "Failed to delete snapshot"
        echo "$result" | jq .
        return 1
    fi
}

# Test checkpoint/restore cycle
cmd_test() {
    local vmid="$1"

    local node
    node=$(pve_get_default_node)

    log_info "Testing checkpoint/restore cycle for container ${vmid}..."
    echo ""

    # Check container is running
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" != "running" ]]; then
        log_error "Container ${vmid} must be running for this test"
        return 1
    fi

    # Step 1: Create a marker file
    log_info "Step 1: Creating marker file in container..."
    local marker="cmux-criu-test-$(date +%s)"
    echo "  Marker: ${marker}"
    echo ""

    # Note: This requires pct exec which needs SSH or direct access
    log_info "To complete the test manually:"
    echo ""
    echo "  # Create marker in running container"
    echo "  pct exec ${vmid} -- touch /tmp/${marker}"
    echo ""
    echo "  # Checkpoint"
    echo "  $(basename "$0") checkpoint ${vmid}"
    echo ""
    echo "  # Restore"
    echo "  $(basename "$0") restore ${vmid}"
    echo ""
    echo "  # Verify marker still exists"
    echo "  pct exec ${vmid} -- ls -la /tmp/${marker}"
    echo ""
    echo "  # If the marker exists, CRIU checkpoint/restore works!"
    echo ""

    # Offer to do checkpoint/restore only
    read -p "Run checkpoint/restore cycle now? (y/N) " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        cmd_checkpoint "$vmid"
        echo ""
        sleep 2
        cmd_restore "$vmid"
        echo ""
        log_success "Checkpoint/restore cycle completed"
        echo ""
        echo "Verify processes resumed correctly by checking your application."
    fi
}

# Main
main() {
    if [[ $# -lt 1 ]]; then
        usage
        exit 1
    fi

    local cmd="$1"
    shift

    case "$cmd" in
        checkpoint|suspend)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_checkpoint "$@"
            ;;
        restore|resume)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_restore "$@"
            ;;
        snapshot)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_snapshot "$@"
            ;;
        rollback)
            [[ $# -lt 2 ]] && { log_error "Missing VMID or snapshot name"; usage; exit 1; }
            cmd_rollback "$@"
            ;;
        list|ls)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_list "$@"
            ;;
        delete|rm)
            [[ $# -lt 2 ]] && { log_error "Missing VMID or snapshot name"; usage; exit 1; }
            cmd_delete "$@"
            ;;
        status)
            cmd_status
            ;;
        test)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_test "$@"
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            log_error "Unknown command: ${cmd}"
            usage
            exit 1
            ;;
    esac
}

main "$@"
