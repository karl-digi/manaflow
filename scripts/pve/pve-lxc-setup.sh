#!/usr/bin/env bash
# pve-lxc-setup.sh - Standalone script to create cmux LXC template on PVE host
#
# Run directly on PVE host console:
#   curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000
#
# Or download and run:
#   curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh -o pve-lxc-setup.sh
#   chmod +x pve-lxc-setup.sh
#   ./pve-lxc-setup.sh 9000
#
# This script:
#   1. Creates a new LXC container from Ubuntu 24.04 template
#   2. Configures it with all cmux dependencies (Docker, Node.js, Bun, uv, VNC, etc.)
#   3. Converts it to a template for cloning
#
# Requirements:
#   - Run as root on PVE host
#   - Ubuntu 24.04 template downloaded (pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst)
#   - Storage with 'rootdir' content type (default: local-lvm)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Configuration defaults
DEFAULT_VMID="9000"
DEFAULT_STORAGE="${PVE_STORAGE:-local-lvm}"
DEFAULT_MEMORY="${PVE_LXC_MEMORY:-4096}"
DEFAULT_CORES="${PVE_LXC_CORES:-4}"
DEFAULT_DISK="${PVE_LXC_DISK:-32}"
DEFAULT_OSTEMPLATE="${PVE_OSTEMPLATE:-local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst}"
DEFAULT_HOSTNAME="cmux-template"

usage() {
    cat << EOF
Usage: $(basename "$0") [VMID] [OPTIONS]

Create a cmux LXC template on Proxmox VE host.

Arguments:
  VMID                    Template VMID (default: ${DEFAULT_VMID})

Options:
  --memory <MB>           Memory in MB (default: ${DEFAULT_MEMORY})
  --cores <N>             CPU cores (default: ${DEFAULT_CORES})
  --disk <GB>             Disk size in GB (default: ${DEFAULT_DISK})
  --storage <name>        Storage pool (default: ${DEFAULT_STORAGE})
  --ostemplate <volid>    OS template (default: ${DEFAULT_OSTEMPLATE})
  --hostname <name>       Container hostname (default: ${DEFAULT_HOSTNAME})
  --skip-create           Skip container creation (only configure existing)
  --skip-configure        Skip configuration (only create container)
  --skip-convert          Skip template conversion (keep as container)
  -h, --help              Show this help

Environment Variables:
  PVE_STORAGE             Default storage pool
  PVE_LXC_MEMORY          Default memory (MB)
  PVE_LXC_CORES           Default CPU cores
  PVE_LXC_DISK            Default disk size (GB)
  PVE_OSTEMPLATE          Default OS template

Examples:
  # Run from PVE console via curl
  curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/pve-lxc-setup.sh | bash -s -- 9000

  # With custom options
  $(basename "$0") 9000 --memory 8192 --cores 8 --storage local-zfs

  # Only configure existing container
  $(basename "$0") 9000 --skip-create

  # Create without converting to template
  $(basename "$0") 9000 --skip-convert
EOF
}

# Check if running on PVE host
check_pve_host() {
    if ! command -v pct &>/dev/null; then
        log_error "This script must be run on a Proxmox VE host (pct command not found)"
        exit 1
    fi

    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

# Check if OS template exists
check_ostemplate() {
    local template="$1"
    local storage="${template%%:*}"
    local volid="${template#*:}"
    local path="/var/lib/vz/template/cache/${volid##*/}"

    # Check common paths
    if [[ -f "$path" ]] || [[ -f "/var/lib/vz/template/cache/${volid##*/}" ]]; then
        return 0
    fi

    # Check via pvesm
    if pvesm list "$storage" 2>/dev/null | grep -q "${volid##*/}"; then
        return 0
    fi

    return 1
}

# Download OS template if needed
download_ostemplate() {
    local template="$1"
    local storage="${template%%:*}"

    log_info "Checking OS template: ${template}"

    if check_ostemplate "$template"; then
        log_success "OS template found"
        return 0
    fi

    log_info "Downloading OS template..."
    if pveam download "$storage" "ubuntu-24.04-standard_24.04-2_amd64.tar.zst"; then
        log_success "OS template downloaded"
    else
        log_error "Failed to download OS template"
        echo "Manual download: pveam download ${storage} ubuntu-24.04-standard_24.04-2_amd64.tar.zst"
        exit 1
    fi
}

# Create LXC container
create_container() {
    local vmid="$1"
    local memory="$2"
    local cores="$3"
    local disk="$4"
    local storage="$5"
    local ostemplate="$6"
    local hostname="$7"

    log_info "Creating LXC container ${vmid}..."
    echo "  Memory: ${memory}MB"
    echo "  Cores: ${cores}"
    echo "  Disk: ${disk}GB"
    echo "  Storage: ${storage}"
    echo "  OS Template: ${ostemplate}"
    echo "  Hostname: ${hostname}"

    # Check if container already exists
    if pct status "$vmid" &>/dev/null; then
        log_warn "Container ${vmid} already exists"
        read -p "Delete and recreate? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Stopping and destroying container ${vmid}..."
            pct stop "$vmid" 2>/dev/null || true
            pct destroy "$vmid" --purge 2>/dev/null || true
        else
            log_info "Keeping existing container"
            return 0
        fi
    fi

    # Create container
    if pct create "$vmid" "$ostemplate" \
        --hostname "$hostname" \
        --memory "$memory" \
        --cores "$cores" \
        --rootfs "${storage}:${disk}" \
        --net0 "name=eth0,bridge=vmbr0,ip=dhcp" \
        --unprivileged 1 \
        --features "nesting=1" \
        --start 0; then
        log_success "Container ${vmid} created"
    else
        log_error "Failed to create container"
        exit 1
    fi
}

# Generate setup script for container
generate_setup_script() {
    cat << 'SETUP_EOF'
#!/bin/bash
# cmux LXC container setup script - idempotent and resumable

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# Marker file to track completed steps
MARKER_DIR="/opt/cmux/.setup-markers"
mkdir -p "$MARKER_DIR"

step_done() { [[ -f "$MARKER_DIR/$1" ]]; }
mark_done() { touch "$MARKER_DIR/$1"; }

echo "=== cmux LXC Setup Script ==="
echo ""

# Step 1: Base packages and locale
if step_done "01-base"; then
    echo "[1/8] Base dependencies... SKIP (already done)"
else
    echo "[1/8] Installing base dependencies..."
    apt-get update -qq
    apt-get install -y -qq \
        curl wget git unzip ca-certificates gnupg lsb-release \
        sudo vim htop net-tools iproute2 openssh-server locales systemd \
        zsh software-properties-common jq
    locale-gen en_US.UTF-8 || true
    update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 || true
    mark_done "01-base"
fi

# Step 2: Docker
if step_done "02-docker"; then
    echo "[2/8] Docker... SKIP (already done)"
elif command -v docker &>/dev/null; then
    echo "[2/8] Docker... SKIP (already installed)"
    mark_done "02-docker"
else
    echo "[2/8] Installing Docker..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker || true
    mark_done "02-docker"
fi

# Step 3: Node.js
if step_done "03-nodejs"; then
    echo "[3/8] Node.js... SKIP (already done)"
elif command -v node &>/dev/null && [[ "$(node --version 2>/dev/null)" == v2* ]]; then
    echo "[3/8] Node.js... SKIP (already installed: $(node --version))"
    mark_done "03-nodejs"
else
    echo "[3/8] Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
    echo "    Installed: $(node --version)"
    mark_done "03-nodejs"
fi

# Step 4: Bun
if step_done "04-bun"; then
    echo "[4/8] Bun... SKIP (already done)"
elif command -v bun &>/dev/null; then
    echo "[4/8] Bun... SKIP (already installed: $(bun --version))"
    mark_done "04-bun"
else
    echo "[4/8] Installing Bun..."
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
    ln -sf /root/.bun/bin/bun /usr/local/bin/bun
    ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx
    echo "    Installed: $(/usr/local/bin/bun --version)"
    mark_done "04-bun"
fi

# Step 5: uv (Python)
if step_done "05-uv"; then
    echo "[5/8] uv (Python)... SKIP (already done)"
elif command -v uv &>/dev/null; then
    echo "[5/8] uv... SKIP (already installed: $(uv --version))"
    mark_done "05-uv"
else
    echo "[5/8] Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
    ln -sf /root/.local/bin/uv /usr/local/bin/uv
    ln -sf /root/.local/bin/uvx /usr/local/bin/uvx
    echo "    Installed: $(/usr/local/bin/uv --version)"
    mark_done "05-uv"
fi

# Step 6: VNC and X11
if step_done "06-vnc"; then
    echo "[6/8] VNC/X11... SKIP (already done)"
elif command -v Xvfb &>/dev/null; then
    echo "[6/8] VNC/X11... SKIP (already installed)"
    mark_done "06-vnc"
else
    echo "[6/8] Installing VNC and X11..."
    apt-get install -y -qq xvfb tigervnc-standalone-server tigervnc-common x11-utils xterm dbus-x11
    mark_done "06-vnc"
fi

# Step 7: CRIU (optional)
if step_done "07-criu"; then
    echo "[7/8] CRIU... SKIP (already done)"
elif command -v criu &>/dev/null; then
    echo "[7/8] CRIU... SKIP (already installed)"
    mark_done "07-criu"
else
    echo "[7/8] Installing CRIU..."
    add-apt-repository -y universe 2>/dev/null || true
    apt-get update -qq 2>/dev/null || true
    if apt-get install -y -qq criu 2>/dev/null; then
        echo "    CRIU installed"
    else
        echo "    CRIU not available - skipping"
    fi
    mark_done "07-criu"
fi

# Step 8: Finalize
if step_done "08-finalize"; then
    echo "[8/8] Finalize... SKIP (already done)"
else
    echo "[8/8] Finalizing setup..."

    # Create cmux directories
    mkdir -p /opt/cmux/{bin,config,checkpoints}
    mkdir -p /var/log/cmux
    mkdir -p /root/workspace

    # Enable SSH service
    systemctl enable ssh 2>/dev/null || true
    systemctl start ssh 2>/dev/null || true

    # Enable Docker service
    systemctl enable docker 2>/dev/null || true

    # Set zsh as default shell
    if command -v zsh &>/dev/null; then
        chsh -s "$(which zsh)" root 2>/dev/null || true
    fi

    # Setup XDG_RUNTIME_DIR
    mkdir -p /run/user/0
    chmod 700 /run/user/0
    grep -q 'XDG_RUNTIME_DIR' /root/.bashrc 2>/dev/null || \
        echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.bashrc
    grep -q 'XDG_RUNTIME_DIR' /root/.zshrc 2>/dev/null || \
        echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.zshrc 2>/dev/null || true

    # Setup PATH
    PATH_EXPORT='export PATH="/usr/local/bin:/usr/local/cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/go/bin:$PATH"'
    grep -q '/usr/local/bin' /root/.bashrc 2>/dev/null || echo "$PATH_EXPORT" >> /root/.bashrc
    grep -q '/usr/local/bin' /root/.zshrc 2>/dev/null || echo "$PATH_EXPORT" >> /root/.zshrc 2>/dev/null || true

    mark_done "08-finalize"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Installed versions:"
node --version 2>/dev/null && echo "  Node.js: $(node --version)" || true
/usr/local/bin/bun --version 2>/dev/null && echo "  Bun: $(/usr/local/bin/bun --version)" || true
/usr/local/bin/uv --version 2>/dev/null && echo "  uv: $(/usr/local/bin/uv --version 2>&1 | head -1)" || true
docker --version 2>/dev/null && echo "  Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')" || true
criu --version 2>/dev/null && echo "  CRIU: $(criu --version 2>&1 | head -1)" || true
echo ""
SETUP_EOF
}

# Configure container
configure_container() {
    local vmid="$1"

    log_info "Configuring container ${vmid}..."

    # Check container exists
    if ! pct status "$vmid" &>/dev/null; then
        log_error "Container ${vmid} not found"
        exit 1
    fi

    # Start container if not running
    local status
    status=$(pct status "$vmid" | awk '{print $2}')
    if [[ "$status" != "running" ]]; then
        log_info "Starting container ${vmid}..."
        pct start "$vmid"
        sleep 5
    fi

    # Generate and push setup script
    local setup_script="/tmp/cmux-setup-${vmid}.sh"
    generate_setup_script > "$setup_script"
    chmod +x "$setup_script"

    log_info "Pushing setup script to container..."
    pct push "$vmid" "$setup_script" /tmp/setup.sh

    log_info "Executing setup script inside container..."
    log_info "This may take several minutes..."
    echo ""

    if pct exec "$vmid" -- bash /tmp/setup.sh; then
        log_success "Container ${vmid} configured successfully"
    else
        log_error "Setup script failed"
        echo "Debug: pct enter ${vmid}"
        exit 1
    fi

    # Cleanup
    rm -f "$setup_script"
}

# Convert container to template
convert_to_template() {
    local vmid="$1"

    log_info "Converting container ${vmid} to template..."

    # Check if already a template
    if pct config "$vmid" 2>/dev/null | grep -q "template: 1"; then
        log_success "Container ${vmid} is already a template"
        return 0
    fi

    # Stop container if running
    local status
    status=$(pct status "$vmid" | awk '{print $2}')
    if [[ "$status" == "running" ]]; then
        log_info "Stopping container ${vmid}..."
        pct stop "$vmid"
        sleep 2
    fi

    # Convert to template
    if pct template "$vmid"; then
        log_success "Container ${vmid} converted to template"
    else
        log_error "Failed to convert to template"
        exit 1
    fi
}

# Main
main() {
    local vmid="$DEFAULT_VMID"
    local memory="$DEFAULT_MEMORY"
    local cores="$DEFAULT_CORES"
    local disk="$DEFAULT_DISK"
    local storage="$DEFAULT_STORAGE"
    local ostemplate="$DEFAULT_OSTEMPLATE"
    local hostname="$DEFAULT_HOSTNAME"
    local skip_create=false
    local skip_configure=false
    local skip_convert=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            --memory)
                memory="$2"
                shift 2
                ;;
            --cores)
                cores="$2"
                shift 2
                ;;
            --disk)
                disk="$2"
                shift 2
                ;;
            --storage)
                storage="$2"
                shift 2
                ;;
            --ostemplate)
                ostemplate="$2"
                shift 2
                ;;
            --hostname)
                hostname="$2"
                shift 2
                ;;
            --skip-create)
                skip_create=true
                shift
                ;;
            --skip-configure)
                skip_configure=true
                shift
                ;;
            --skip-convert)
                skip_convert=true
                shift
                ;;
            [0-9]*)
                vmid="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    echo ""
    echo "======================================"
    echo "  cmux LXC Template Setup"
    echo "======================================"
    echo ""
    echo "  VMID: ${vmid}"
    echo "  Skip create: ${skip_create}"
    echo "  Skip configure: ${skip_configure}"
    echo "  Skip convert: ${skip_convert}"
    echo ""

    # Check environment
    check_pve_host

    # Download OS template if needed
    if [[ "$skip_create" != "true" ]]; then
        download_ostemplate "$ostemplate"
    fi

    # Create container
    if [[ "$skip_create" != "true" ]]; then
        create_container "$vmid" "$memory" "$cores" "$disk" "$storage" "$ostemplate" "$hostname"
    fi

    # Configure container
    if [[ "$skip_configure" != "true" ]]; then
        configure_container "$vmid"
    fi

    # Convert to template
    if [[ "$skip_convert" != "true" ]]; then
        convert_to_template "$vmid"
    fi

    echo ""
    echo "======================================"
    echo "  Setup Complete!"
    echo "======================================"
    echo ""
    echo "Template ${vmid} is ready for use."
    echo ""
    echo "Clone command:"
    echo "  pct clone ${vmid} <new-vmid> --full"
    echo ""
    echo "Or use snapshot-pvelxc.py to build snapshots:"
    echo "  uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid ${vmid}"
    echo ""
}

main "$@"
