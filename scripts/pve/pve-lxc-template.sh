#!/usr/bin/env bash
# pve-lxc-template.sh - Manage LXC templates for cmux sandboxes
# Usage: ./pve-lxc-template.sh <command> [options]
#
# Commands:
#   list              - List available templates
#   create <vmid>     - Create a new cmux base template
#   configure <vmid>  - Configure an existing container as cmux template
#   convert <vmid>    - Convert container to template
#
# Required environment variables:
#   PVE_API_URL, PVE_API_TOKEN
#
# Optional:
#   PVE_NODE - Target node (auto-detected if not set)
#   PVE_STORAGE - Storage for templates (default: local)
#   PVE_TEMPLATE_VMID - Default template VMID for cloning

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/pve-api.sh"

# Default configuration
# Note: PVE_STORAGE should be a storage that supports 'rootdir' content type
DEFAULT_STORAGE="${PVE_STORAGE:-local}"
DEFAULT_MEMORY="${PVE_LXC_MEMORY:-4096}"
DEFAULT_CORES="${PVE_LXC_CORES:-4}"
DEFAULT_DISK="${PVE_LXC_DISK:-32}"
# OS template must be on a storage that supports 'vztmpl' content type (usually 'local')
DEFAULT_OSTEMPLATE="${PVE_OSTEMPLATE:-local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst}"

# cmux required ports
CMUX_PORTS=(
    "39377"  # worker
    "39378"  # openvscode
    "39379"  # proxy
    "39380"  # vnc
    "39381"  # cdp
)

usage() {
    cat << EOF
Usage: $(basename "$0") <command> [options]

Commands:
  list                    List available OS templates
  create <vmid>           Create a new cmux base LXC container
  configure <vmid>        Configure existing container with cmux services
  convert <vmid>          Convert container to template (makes it read-only)
  info <vmid>             Show container/template info

Options:
  --memory <MB>           Memory in MB (default: ${DEFAULT_MEMORY})
  --cores <N>             CPU cores (default: ${DEFAULT_CORES})
  --disk <GB>             Disk size in GB (default: ${DEFAULT_DISK})
  --storage <name>        Storage pool (default: ${DEFAULT_STORAGE})
  --ostemplate <volid>    OS template (default: ${DEFAULT_OSTEMPLATE})
  --hostname <name>       Container hostname (default: cmux-template)

Examples:
  $(basename "$0") list
  $(basename "$0") create 9000 --memory 8192 --cores 8
  $(basename "$0") configure 9000
  $(basename "$0") convert 9000
EOF
}

cmd_list() {
    local node
    node=$(pve_get_default_node)

    log_info "Available OS templates on ${node}:"
    echo ""

    # List all storage and find templates
    local storages
    storages=$(pve_list_storage "$node" | jq -r '.data[].storage')

    for storage in $storages; do
        local templates
        templates=$(pve_list_templates "$storage" "$node" 2>/dev/null || true)
        if [[ -n "$templates" ]]; then
            echo "Storage: ${storage}"
            echo "$templates" | while read -r tmpl; do
                echo "  - ${tmpl}"
            done
            echo ""
        fi
    done
}

cmd_create() {
    local vmid="$1"
    shift

    # Parse options
    local memory="$DEFAULT_MEMORY"
    local cores="$DEFAULT_CORES"
    local disk="$DEFAULT_DISK"
    local storage="$DEFAULT_STORAGE"
    local ostemplate="$DEFAULT_OSTEMPLATE"
    local hostname="cmux-template"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --memory) memory="$2"; shift 2 ;;
            --cores) cores="$2"; shift 2 ;;
            --disk) disk="$2"; shift 2 ;;
            --storage) storage="$2"; shift 2 ;;
            --ostemplate) ostemplate="$2"; shift 2 ;;
            --hostname) hostname="$2"; shift 2 ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    local node
    node=$(pve_get_default_node)

    log_info "Creating LXC container ${vmid} on ${node}..."
    echo "  Memory: ${memory}MB"
    echo "  Cores: ${cores}"
    echo "  Disk: ${disk}GB"
    echo "  Storage: ${storage}"
    echo "  OS Template: ${ostemplate}"
    echo "  Hostname: ${hostname}"
    echo ""

    # Build creation parameters using --data-urlencode for proper encoding
    local net0_value="name=eth0,bridge=vmbr0,ip=dhcp"
    local features_value="nesting=1"
    local rootfs_value="${storage}:${disk}"

    pve_check_env || return 1
    pve_parse_token

    local url="${PVE_API_URL}/api2/json/nodes/${node}/lxc"
    local auth_header="Authorization: PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"

    local result
    result=$(curl -s -k \
        -X POST \
        -H "$auth_header" \
        --data-urlencode "vmid=${vmid}" \
        --data-urlencode "ostemplate=${ostemplate}" \
        --data-urlencode "hostname=${hostname}" \
        --data-urlencode "memory=${memory}" \
        --data-urlencode "cores=${cores}" \
        --data-urlencode "rootfs=${rootfs_value}" \
        --data-urlencode "net0=${net0_value}" \
        --data-urlencode "start=0" \
        --data-urlencode "unprivileged=1" \
        --data-urlencode "features=${features_value}" \
        "$url")

    local upid
    upid=$(echo "$result" | jq -r '.data // empty')

    if [[ -z "$upid" ]]; then
        log_error "Failed to create container"
        echo "$result" | jq .
        return 1
    fi

    # Wait for creation to complete
    pve_wait_task "$upid" 300 "$node"

    log_success "Container ${vmid} created successfully"
    echo ""
    echo "Next steps:"
    echo "  1. Configure cmux: $(basename "$0") configure ${vmid}"
    echo "     (This will auto-start the container and install dependencies)"
    echo "  2. Convert to template: $(basename "$0") convert ${vmid}"
}

cmd_configure() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Configuring container ${vmid} on ${node}..."

    # Determine SSH target for pct commands
    # PVE_SSH_HOST can be set to override (e.g., root@pve.example.com)
    local pve_ssh_host="${PVE_SSH_HOST:-}"
    if [[ -z "$pve_ssh_host" ]]; then
        # Try to extract hostname from PVE_API_URL
        pve_ssh_host="root@$(echo "${PVE_API_URL}" | sed -E 's|https?://([^:/]+).*|\1|')"
    fi

    # Check container exists
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "null" || -z "$status" ]]; then
        log_error "Container ${vmid} not found"
        return 1
    fi

    # Start container if not running
    if [[ "$status" != "running" ]]; then
        log_info "Starting container ${vmid}..."
        local upid
        upid=$(pve_lxc_start "$vmid" "$node" | jq -r '.data // empty')
        if [[ -n "$upid" ]]; then
            pve_wait_task "$upid" 120 "$node"
        fi
        sleep 3
    fi

    # Generate setup script
    local setup_script="/tmp/cmux-lxc-setup-${vmid}.sh"

    cat > "$setup_script" << 'SETUP_EOF'
#!/bin/bash
# cmux LXC container setup script
# Run this inside the container: pct exec <vmid> -- bash /tmp/setup.sh

set -euo pipefail

echo "=== cmux LXC Setup Script ==="
echo ""

# Update system
echo "[1/8] Updating system packages..."
apt-get update
apt-get upgrade -y

# Install base dependencies
echo "[2/8] Installing base dependencies..."
apt-get install -y \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    vim \
    htop \
    net-tools \
    iproute2 \
    openssh-server \
    systemd

# Install Docker
echo "[3/8] Installing Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Install Node.js (via NodeSource)
echo "[4/8] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Install Bun
echo "[5/8] Installing Bun..."
curl -fsSL https://bun.sh/install | bash
ln -sf /root/.bun/bin/bun /usr/local/bin/bun

# Install uv (Python package manager)
echo "[6/8] Installing uv..."
curl -LsSf https://astral.sh/uv/install.sh | sh
ln -sf /root/.local/bin/uv /usr/local/bin/uv

# Install VNC and X11 dependencies
echo "[7/8] Installing VNC and X11..."
apt-get install -y \
    xvfb \
    tigervnc-standalone-server \
    tigervnc-common \
    x11-utils \
    xterm \
    dbus-x11

# Install CRIU for checkpointing
echo "[8/8] Installing CRIU..."
apt-get install -y criu

# Create cmux directories
mkdir -p /opt/cmux/{bin,config,checkpoints}
mkdir -p /var/log/cmux

# Configure Docker to start on boot
systemctl enable docker

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Container is ready for cmux services installation."
echo "Next: Install cmux worker, proxy, and openvscode binaries."
SETUP_EOF

    chmod +x "$setup_script"

    log_info "Using SSH host: ${pve_ssh_host}"
    log_info "Copying setup script to PVE host..."

    # Copy script to PVE host first
    if ! scp -q "$setup_script" "${pve_ssh_host}:/tmp/cmux-lxc-setup-${vmid}.sh"; then
        log_error "Failed to copy setup script to PVE host"
        return 1
    fi

    log_info "Pushing setup script to container ${vmid}..."
    if ! ssh "$pve_ssh_host" "pct push ${vmid} /tmp/cmux-lxc-setup-${vmid}.sh /tmp/setup.sh"; then
        log_error "Failed to push setup script to container"
        return 1
    fi

    log_info "Executing setup script inside container ${vmid}..."
    log_info "This may take several minutes..."
    echo ""

    # Execute setup script with real-time output via SSH
    if ssh -t "$pve_ssh_host" "pct exec ${vmid} -- bash /tmp/setup.sh"; then
        log_success "Container ${vmid} configured successfully"
        echo ""
        echo "Next steps:"
        echo "  1. Convert to template: $(basename "$0") convert ${vmid}"
        echo "     (This will auto-stop the container)"
    else
        log_error "Setup script failed"
        echo ""
        echo "Debug interactively:"
        echo "  ssh ${pve_ssh_host} 'pct enter ${vmid}'"
        return 1
    fi
}

cmd_convert() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    # Check container exists
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "running" ]]; then
        log_info "Stopping container ${vmid}..."
        pve_lxc_stop "$vmid" "$node"
        sleep 3
    fi

    log_info "Converting container ${vmid} to template..."

    local result
    result=$(pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/template")

    if echo "$result" | jq -e '.data' > /dev/null 2>&1; then
        log_success "Container ${vmid} converted to template"
        echo ""
        echo "Template is now ready for cloning."
        echo "Clone command: pct clone ${vmid} <new-vmid> --full"
    else
        log_error "Failed to convert to template"
        echo "$result" | jq .
        return 1
    fi
}

cmd_info() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    log_info "Container ${vmid} information:"
    echo ""

    echo "Status:"
    pve_lxc_status "$vmid" "$node" | jq '.data'

    echo ""
    echo "Configuration:"
    pve_lxc_config "$vmid" "$node" | jq '.data'

    echo ""
    echo "Snapshots:"
    pve_lxc_snapshots "$vmid" "$node" | jq '.data'
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
        list)
            cmd_list
            ;;
        create)
            if [[ $# -lt 1 ]]; then
                log_error "Missing VMID"
                usage
                exit 1
            fi
            cmd_create "$@"
            ;;
        configure)
            if [[ $# -lt 1 ]]; then
                log_error "Missing VMID"
                usage
                exit 1
            fi
            cmd_configure "$@"
            ;;
        convert)
            if [[ $# -lt 1 ]]; then
                log_error "Missing VMID"
                usage
                exit 1
            fi
            cmd_convert "$@"
            ;;
        info)
            if [[ $# -lt 1 ]]; then
                log_error "Missing VMID"
                usage
                exit 1
            fi
            cmd_info "$@"
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
