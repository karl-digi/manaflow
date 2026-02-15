#!/usr/bin/env bash
# pve-test-connection.sh - Test Proxmox VE API connectivity and authentication
# Usage: ./pve-test-connection.sh
#
# Required environment variables:
#   PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
#   PVE_API_TOKEN - API token in format: user@realm!tokenid=secret

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/pve-api.sh"

echo "=========================================="
echo "  Proxmox VE API Connection Test"
echo "=========================================="
echo ""

# Check environment
echo "Configuration:"
echo "  PVE_API_URL: ${PVE_API_URL:-<not set>}"
echo "  PVE_API_TOKEN: ${PVE_API_TOKEN:+<set>}${PVE_API_TOKEN:-<not set>}"
echo "  PVE_NODE: ${PVE_NODE:-<auto-detect>}"
echo ""

# Test connection
if ! pve_test_connection; then
    exit 1
fi

echo ""

# Get cluster/node info
log_info "Fetching node information..."
nodes=$(pve_list_nodes)
node_count=$(echo "$nodes" | wc -l | tr -d ' ')

echo ""
echo "Nodes ($node_count):"
echo "$nodes" | while read -r node; do
    echo "  - $node"
done

echo ""

# Get default node
default_node=$(pve_get_default_node)
log_info "Using node: ${default_node}"

echo ""

# List LXC containers
log_info "Listing LXC containers on ${default_node}..."
lxc_list=$(pve_list_lxc "$default_node")
lxc_count=$(echo "$lxc_list" | jq '.data | length')

echo ""
echo "LXC Containers ($lxc_count):"
if [[ "$lxc_count" -gt 0 ]]; then
    echo "$lxc_list" | jq -r '.data[] | "  - \(.vmid): \(.name // "unnamed") [\(.status)]"'
else
    echo "  (none)"
fi

echo ""

# List storage
log_info "Listing storage on ${default_node}..."
storage_list=$(pve_list_storage "$default_node")
echo ""
echo "Storage:"
echo "$storage_list" | jq -r '.data[] | "  - \(.storage) [\(.type)] - \(.content)"'

echo ""

# Summary
echo "=========================================="
log_success "API connection test completed successfully"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Create LXC template: ./pve-lxc-template.sh create"
echo "  2. Start instance: ./pve-instance.sh start <vmid>"
echo "  3. Test CRIU: ./pve-criu.sh checkpoint <vmid>"
