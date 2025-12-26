#!/usr/bin/env bash
# pve-api.sh - Proxmox VE API helper functions
# Source this file in other scripts: source "$(dirname "$0")/pve-api.sh"

set -euo pipefail

# Required environment variables:
# PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
# PVE_API_TOKEN - API token in format: user@realm!tokenid=secret

# Get script and project directories
PVE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PVE_PROJECT_ROOT="$(cd "${PVE_SCRIPT_DIR}/../.." && pwd)"

# Auto-load .env file from project root if it exists
# Only load if PVE_API_URL is not already set (avoid overwriting explicit exports)
if [[ -z "${PVE_API_URL:-}" && -f "${PVE_PROJECT_ROOT}/.env" ]]; then
    # Support quoted/multiline values safely by sourcing with export-all mode
    set -a
    # shellcheck disable=SC1091
    . "${PVE_PROJECT_ROOT}/.env"
    set +a
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Validate required environment variables
pve_check_env() {
    local missing=0
    if [[ -z "${PVE_API_URL:-}" ]]; then
        log_error "PVE_API_URL is not set"
        missing=1
    fi
    if [[ -z "${PVE_API_TOKEN:-}" ]]; then
        log_error "PVE_API_TOKEN is not set"
        missing=1
    fi
    if [[ $missing -eq 1 ]]; then
        echo ""
        echo "Required environment variables:"
        echo "  PVE_API_URL=https://pve.example.com:8006"
        echo "  PVE_API_TOKEN=user@realm!tokenid=secret"
        return 1
    fi
    return 0
}

# Parse PVE_API_TOKEN into user and token components
# Format: user@realm!tokenid=secret
pve_parse_token() {
    local token="${PVE_API_TOKEN}"
    # Extract user@realm!tokenid part (before =)
    PVE_TOKEN_ID="${token%%=*}"
    # Extract secret part (after =)
    PVE_TOKEN_SECRET="${token#*=}"
}

# Make authenticated API request
# Usage: pve_api GET /api2/json/nodes
#        pve_api POST /api2/json/nodes/pve/lxc -d "vmid=100&ostemplate=..."
pve_api() {
    local method="$1"
    shift
    local endpoint="$1"
    shift

    pve_check_env || return 1
    pve_parse_token

    local url="${PVE_API_URL}${endpoint}"
    local auth_header="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

    curl -s -k \
        -X "$method" \
        -H "$auth_header" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        "$@" \
        "$url"
}

# Make API request and format JSON output
pve_api_json() {
    pve_api "$@" | jq .
}

# Test API connection and authentication
pve_test_connection() {
    log_info "Testing connection to ${PVE_API_URL}..."

    local result
    if ! result=$(pve_api GET /api2/json/version 2>&1); then
        log_error "Failed to connect to Proxmox API"
        echo "$result"
        return 1
    fi

    local version
    version=$(echo "$result" | jq -r '.data.version // empty')

    if [[ -z "$version" ]]; then
        log_error "Invalid API response or authentication failed"
        echo "$result" | jq . 2>/dev/null || echo "$result"
        return 1
    fi

    log_success "Connected to Proxmox VE v${version}"
    return 0
}

# Get list of nodes
pve_list_nodes() {
    pve_api GET /api2/json/nodes | jq -r '.data[].node'
}

# Get default/first node
pve_get_default_node() {
    local node="${PVE_NODE:-}"
    if [[ -z "$node" ]]; then
        node=$(pve_list_nodes | head -n1)
    fi
    echo "$node"
}

# List LXC containers on a node
# Usage: pve_list_lxc [node]
pve_list_lxc() {
    local node="${1:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/lxc"
}

# List QEMU VMs on a node
# Usage: pve_list_qemu [node]
pve_list_qemu() {
    local node="${1:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/qemu"
}

# Get LXC container status
# Usage: pve_lxc_status <vmid> [node]
pve_lxc_status() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/lxc/${vmid}/status/current"
}

# Get LXC container config
# Usage: pve_lxc_config <vmid> [node]
pve_lxc_config() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/lxc/${vmid}/config"
}

# Start LXC container
# Usage: pve_lxc_start <vmid> [node]
pve_lxc_start() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/status/start"
}

# Stop LXC container
# Usage: pve_lxc_stop <vmid> [node]
pve_lxc_stop() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/status/stop"
}

# Shutdown LXC container (graceful)
# Usage: pve_lxc_shutdown <vmid> [node]
pve_lxc_shutdown() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/status/shutdown"
}

# Suspend LXC container (requires CRIU)
# Usage: pve_lxc_suspend <vmid> [node]
pve_lxc_suspend() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/status/suspend"
}

# Resume LXC container
# Usage: pve_lxc_resume <vmid> [node]
pve_lxc_resume() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/status/resume"
}

# Create snapshot of LXC container
# Usage: pve_lxc_snapshot <vmid> <snapname> [node]
pve_lxc_snapshot() {
    local vmid="$1"
    local snapname="$2"
    local node="${3:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/snapshot" \
        -d "snapname=${snapname}"
}

# List snapshots of LXC container
# Usage: pve_lxc_snapshots <vmid> [node]
pve_lxc_snapshots() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/lxc/${vmid}/snapshot"
}

# Rollback LXC container to snapshot
# Usage: pve_lxc_rollback <vmid> <snapname> [node]
pve_lxc_rollback() {
    local vmid="$1"
    local snapname="$2"
    local node="${3:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/snapshot/${snapname}/rollback"
}

# Clone LXC container
# Usage: pve_lxc_clone <vmid> <newid> [node]
pve_lxc_clone() {
    local vmid="$1"
    local newid="$2"
    local node="${3:-$(pve_get_default_node)}"
    pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/clone" \
        -d "newid=${newid}&full=1"
}

# Delete LXC container
# Usage: pve_lxc_delete <vmid> [node]
pve_lxc_delete() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api DELETE "/api2/json/nodes/${node}/lxc/${vmid}"
}

# Get storage list
# Usage: pve_list_storage [node]
pve_list_storage() {
    local node="${1:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/storage"
}

# Get available templates
# Usage: pve_list_templates <storage> [node]
pve_list_templates() {
    local storage="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/storage/${storage}/content" | \
        jq -r '.data[] | select(.content == "vztmpl") | .volid'
}

# Get task status
# Usage: pve_task_status <upid> [node]
pve_task_status() {
    local upid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/tasks/${upid}/status"
}

# Wait for task to complete
# Usage: pve_wait_task <upid> [timeout_seconds] [node]
pve_wait_task() {
    local upid="$1"
    local timeout="${2:-300}"
    local node="${3:-$(pve_get_default_node)}"
    local elapsed=0

    log_info "Waiting for task ${upid}..."

    while [[ $elapsed -lt $timeout ]]; do
        local status
        status=$(pve_task_status "$upid" "$node" | jq -r '.data.status')

        if [[ "$status" == "stopped" ]]; then
            local exitstatus
            exitstatus=$(pve_task_status "$upid" "$node" | jq -r '.data.exitstatus')
            if [[ "$exitstatus" == "OK" ]]; then
                log_success "Task completed successfully"
                return 0
            else
                log_error "Task failed: ${exitstatus}"
                return 1
            fi
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    log_error "Task timed out after ${timeout}s"
    return 1
}

# If script is run directly, test the connection
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    pve_test_connection
fi
