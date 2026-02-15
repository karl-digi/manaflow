#!/usr/bin/env bash
# pve-instance.sh - Manage LXC container instances for cmux sandboxes
# Usage: ./pve-instance.sh <command> [options]
#
# Commands:
#   list                  - List all LXC containers
#   start <vmid>          - Start a container
#   stop <vmid>           - Stop a container (graceful)
#   kill <vmid>           - Force stop a container
#   clone <template> <id> - Clone from template to new instance
#   delete <vmid>         - Delete a container
#   status <vmid>         - Show container status
#   exec <vmid> <cmd>     - Execute command in container
#
# Required environment variables:
#   PVE_API_URL, PVE_API_TOKEN
#
# Optional:
#   PVE_NODE - Target node (auto-detected if not set)
#   PVE_TEMPLATE_VMID - Default template for cloning

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/pve-api.sh"

# Default configuration
DEFAULT_TEMPLATE="${PVE_TEMPLATE_VMID:-9000}"

usage() {
    cat << EOF
Usage: $(basename "$0") <command> [options]

Commands:
  list                    List all LXC containers
  start <vmid>            Start a container
  stop <vmid>             Stop a container (graceful shutdown)
  kill <vmid>             Force stop a container immediately
  restart <vmid>          Restart a container
  clone <vmid>            Clone from template (uses PVE_TEMPLATE_VMID or 9000)
  clone <src> <dst>       Clone from source VMID to destination VMID
  delete <vmid>           Delete a container (must be stopped)
  status <vmid>           Show detailed container status
  logs <vmid>             Show container console output

Options:
  --template <vmid>       Template VMID for cloning (default: ${DEFAULT_TEMPLATE})
  --hostname <name>       Hostname for cloned container
  --memory <MB>           Override memory for clone
  --cores <N>             Override CPU cores for clone

Examples:
  $(basename "$0") list
  $(basename "$0") start 100
  $(basename "$0") clone 101 --hostname sandbox-001
  $(basename "$0") clone 9000 102 --memory 8192
  $(basename "$0") status 100
EOF
}

# Find next available VMID
find_next_vmid() {
    local node
    node=$(pve_get_default_node)

    # Get all existing VMIDs (LXC + QEMU)
    local lxc_ids qemu_ids all_ids
    lxc_ids=$(pve_list_lxc "$node" | jq -r '.data[].vmid' 2>/dev/null || echo "")
    qemu_ids=$(pve_list_qemu "$node" | jq -r '.data[].vmid' 2>/dev/null || echo "")

    # Combine and find max
    all_ids=$(echo -e "${lxc_ids}\n${qemu_ids}" | grep -v '^$' | sort -n)

    if [[ -z "$all_ids" ]]; then
        echo "100"
        return
    fi

    # Find next available starting from 100
    local vmid=100
    while echo "$all_ids" | grep -q "^${vmid}$"; do
        vmid=$((vmid + 1))
    done

    echo "$vmid"
}

cmd_list() {
    local node
    node=$(pve_get_default_node)

    log_info "LXC containers on ${node}:"
    echo ""

    local result
    result=$(pve_list_lxc "$node")

    local count
    count=$(echo "$result" | jq '.data | length')

    if [[ "$count" -eq 0 ]]; then
        echo "  (no containers found)"
        return
    fi

    # Print header
    printf "%-8s %-20s %-10s %-10s %-10s %s\n" "VMID" "NAME" "STATUS" "MEM" "CPU" "UPTIME"
    printf "%-8s %-20s %-10s %-10s %-10s %s\n" "----" "----" "------" "---" "---" "------"

    # Print each container
    echo "$result" | jq -r '.data[] | [.vmid, (.name // "-"), .status, .maxmem, .cpus, (.uptime // 0)] | @tsv' | \
    while IFS=$'\t' read -r vmid name status maxmem cpus uptime; do
        # Convert memory to human readable
        local mem_gb
        mem_gb=$(echo "scale=1; ${maxmem} / 1073741824" | bc 2>/dev/null || echo "?")

        # Convert uptime to human readable
        local uptime_str
        if [[ "$uptime" -gt 86400 ]]; then
            uptime_str="$((uptime / 86400))d"
        elif [[ "$uptime" -gt 3600 ]]; then
            uptime_str="$((uptime / 3600))h"
        elif [[ "$uptime" -gt 60 ]]; then
            uptime_str="$((uptime / 60))m"
        else
            uptime_str="${uptime}s"
        fi

        printf "%-8s %-20s %-10s %-10s %-10s %s\n" "$vmid" "$name" "$status" "${mem_gb}G" "$cpus" "$uptime_str"
    done
}

cmd_start() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Starting container ${vmid}..."

    local result
    result=$(pve_lxc_start "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 60 "$node"
        log_success "Container ${vmid} started"

        # Show IP address if available
        sleep 2
        local status
        status=$(pve_lxc_status "$vmid" "$node")
        local ip
        ip=$(echo "$status" | jq -r '.data.ip // empty' | head -n1)
        if [[ -n "$ip" ]]; then
            echo "  IP: ${ip}"
        fi
    else
        log_error "Failed to start container"
        echo "$result" | jq .
        return 1
    fi
}

cmd_stop() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Stopping container ${vmid} (graceful)..."

    local result
    result=$(pve_lxc_shutdown "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 120 "$node"
        log_success "Container ${vmid} stopped"
    else
        log_error "Failed to stop container"
        echo "$result" | jq .
        return 1
    fi
}

cmd_kill() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Force stopping container ${vmid}..."

    local result
    result=$(pve_lxc_stop "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 30 "$node"
        log_success "Container ${vmid} force stopped"
    else
        log_error "Failed to stop container"
        echo "$result" | jq .
        return 1
    fi
}

cmd_restart() {
    local vmid="$1"

    cmd_stop "$vmid"
    sleep 2
    cmd_start "$vmid"
}

cmd_clone() {
    local src_vmid=""
    local dst_vmid=""
    local hostname=""
    local memory=""
    local cores=""

    # Parse arguments
    if [[ $# -ge 1 && ! "$1" =~ ^-- ]]; then
        # First positional arg
        if [[ $# -ge 2 && ! "$2" =~ ^-- ]]; then
            # Two positional args: src dst
            src_vmid="$1"
            dst_vmid="$2"
            shift 2
        else
            # One positional arg: use as dst, default template as src
            src_vmid="$DEFAULT_TEMPLATE"
            dst_vmid="$1"
            shift
        fi
    fi

    # Parse options
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --template) src_vmid="$2"; shift 2 ;;
            --hostname) hostname="$2"; shift 2 ;;
            --memory) memory="$2"; shift 2 ;;
            --cores) cores="$2"; shift 2 ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    # Auto-generate destination VMID if not provided
    if [[ -z "$dst_vmid" ]]; then
        dst_vmid=$(find_next_vmid)
        log_info "Auto-assigned VMID: ${dst_vmid}"
    fi

    local node
    node=$(pve_get_default_node)

    log_info "Cloning container ${src_vmid} to ${dst_vmid}..."

    # Build clone parameters
    local params="newid=${dst_vmid}&full=1"
    [[ -n "$hostname" ]] && params+="&hostname=${hostname}"

    local result
    result=$(pve_api POST "/api2/json/nodes/${node}/lxc/${src_vmid}/clone" -d "$params")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        log_error "Failed to clone container"
        echo "$result" | jq .
        return 1
    fi

    pve_wait_task "$upid" 600 "$node"

    # Apply memory/cores overrides if specified
    if [[ -n "$memory" || -n "$cores" ]]; then
        log_info "Applying configuration overrides..."
        local config_params=""
        [[ -n "$memory" ]] && config_params+="memory=${memory}&"
        [[ -n "$cores" ]] && config_params+="cores=${cores}&"
        config_params="${config_params%&}"

        pve_api PUT "/api2/json/nodes/${node}/lxc/${dst_vmid}/config" -d "$config_params"
    fi

    log_success "Container ${dst_vmid} cloned from ${src_vmid}"
    echo ""
    echo "Start the new container:"
    echo "  $(basename "$0") start ${dst_vmid}"
}

cmd_delete() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    # Check status
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "running" ]]; then
        log_error "Container is running. Stop it first: $(basename "$0") stop ${vmid}"
        return 1
    fi

    log_warn "Deleting container ${vmid}..."
    read -p "Are you sure? (y/N) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled"
        return 0
    fi

    local result
    result=$(pve_lxc_delete "$vmid" "$node")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -n "$upid" ]]; then
        pve_wait_task "$upid" 120 "$node"
        log_success "Container ${vmid} deleted"
    else
        log_error "Failed to delete container"
        echo "$result" | jq .
        return 1
    fi
}

cmd_status() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Container ${vmid} status:"
    echo ""

    local status
    status=$(pve_lxc_status "$vmid" "$node")

    echo "$status" | jq '.data | {
        status: .status,
        vmid: .vmid,
        name: .name,
        uptime: .uptime,
        cpu: .cpu,
        maxcpu: .cpus,
        mem: .mem,
        maxmem: .maxmem,
        disk: .disk,
        maxdisk: .maxdisk,
        netin: .netin,
        netout: .netout
    }'

    echo ""

    # Get config
    local config
    config=$(pve_lxc_config "$vmid" "$node")

    echo "Network:"
    echo "$config" | jq -r '.data | to_entries[] | select(.key | startswith("net")) | "  \(.key): \(.value)"'
}

cmd_logs() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "To view container ${vmid} console, use:"
    echo ""
    echo "  # Interactive console"
    echo "  pct enter ${vmid}"
    echo ""
    echo "  # Execute command"
    echo "  pct exec ${vmid} -- <command>"
    echo ""
    echo "  # View systemd logs"
    echo "  pct exec ${vmid} -- journalctl -f"
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
        list|ls)
            cmd_list
            ;;
        start)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_start "$@"
            ;;
        stop)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_stop "$@"
            ;;
        kill)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_kill "$@"
            ;;
        restart)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_restart "$@"
            ;;
        clone)
            cmd_clone "$@"
            ;;
        delete|rm)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_delete "$@"
            ;;
        status)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_status "$@"
            ;;
        logs)
            [[ $# -lt 1 ]] && { log_error "Missing VMID"; usage; exit 1; }
            cmd_logs "$@"
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
