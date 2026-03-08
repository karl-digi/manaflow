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

# Retry configuration for transient errors
MAX_RETRIES="${PVE_MAX_RETRIES:-3}"
RETRY_DELAY="${PVE_RETRY_DELAY:-5}"

# HTTP exec configuration (optional, for faster execution when cmux-execd is running)
# Set PVE_PUBLIC_DOMAIN to enable HTTP exec (e.g., example.com)
# URL pattern (instanceId-based): https://port-{port}-{instanceId}.{public_domain}
PVE_PUBLIC_DOMAIN="${PVE_PUBLIC_DOMAIN:-}"

get_container_hostname() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)
    local hostname
    hostname=$(pve_lxc_config "$vmid" "$node" | jq -r '.data.hostname // empty')
    if [[ -z "$hostname" ]]; then
        hostname="cmux-${vmid}"
    fi
    echo "$hostname"
}

# Check if a string contains transient error patterns
is_transient_error() {
    local output="$1"
    # SSH/network transient errors
    echo "$output" | grep -qiE "(connection refused|connection reset|connection timed out|temporary failure|network is unreachable|no route to host|502|503|504|bad gateway|service unavailable|gateway timeout)" && return 0
    return 1
}

# Execute command with retry logic for transient errors
# Usage: retry_command <description> <command...>
retry_command() {
    local description="$1"
    shift
    local cmd=("$@")

    local attempt=1
    local delay="$RETRY_DELAY"
    local result output exit_code

    while [[ $attempt -le $MAX_RETRIES ]]; do
        output=$("${cmd[@]}" 2>&1) && exit_code=0 || exit_code=$?

        if [[ $exit_code -eq 0 ]]; then
            echo "$output"
            return 0
        fi

        # Check if this is a transient error worth retrying
        if is_transient_error "$output" && [[ $attempt -lt $MAX_RETRIES ]]; then
            log_warn "${description} failed (attempt ${attempt}/${MAX_RETRIES}): transient error, retrying in ${delay}s..."
            sleep "$delay"
            delay=$((delay * 2))  # Exponential backoff
            attempt=$((attempt + 1))
        else
            # Non-transient error or max retries reached
            echo "$output" >&2
            return $exit_code
        fi
    done

    return 1
}

# HTTP exec via cmux-execd (when PVE_PUBLIC_DOMAIN is set)
# Usage: http_exec <vmid> <command> [timeout]
http_exec() {
    local vmid="$1"
    local command="$2"
    local timeout="${3:-120}"

    if [[ -z "$PVE_PUBLIC_DOMAIN" ]]; then
        return 1  # HTTP exec not available
    fi

    local hostname
    hostname=$(get_container_hostname "$vmid")
    local url="https://port-39375-${hostname}.${PVE_PUBLIC_DOMAIN}/exec"
    local json_payload
    json_payload=$(jq -n --arg cmd "$command" --argjson timeout "$timeout" '{command: $cmd, timeout: $timeout}')

    local result
    result=$(curl -s -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "$json_payload" \
        --max-time "$timeout" 2>&1) || return 1

    # Parse response
    local exit_code stdout stderr
    exit_code=$(echo "$result" | jq -r '.exit_code // 1')
    stdout=$(echo "$result" | jq -r '.stdout // ""')
    stderr=$(echo "$result" | jq -r '.stderr // ""')

    echo "$stdout"
    [[ -n "$stderr" ]] && echo "$stderr" >&2

    return "$exit_code"
}

# HTTP file push via cmux-execd (when PVE_PUBLIC_DOMAIN is set)
# Usage: http_push <vmid> <local_path> <remote_path>
http_push() {
    local vmid="$1"
    local local_path="$2"
    local remote_path="$3"

    if [[ -z "$PVE_PUBLIC_DOMAIN" ]]; then
        return 1  # HTTP exec not available
    fi

    # Base64 encode the file and push via HTTP exec
    local base64_content
    base64_content=$(base64 < "$local_path")

    local decode_cmd="echo '${base64_content}' | base64 -d > ${remote_path}"
    http_exec "$vmid" "$decode_cmd" 60
}

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
    "39376"  # node.js worker (Socket.IO for web tasks)
    "39377"  # go worker (SSH proxy, HTTP API)
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

Options for 'create':
  --memory <MB>           Memory in MB (default: ${DEFAULT_MEMORY})
  --cores <N>             CPU cores (default: ${DEFAULT_CORES})
  --disk <GB>             Disk size in GB (default: ${DEFAULT_DISK})
  --storage <name>        Storage pool (default: ${DEFAULT_STORAGE})
  --ostemplate <volid>    OS template (default: ${DEFAULT_OSTEMPLATE})
  --hostname <name>       Container hostname (default: cmux-template)

Options for 'configure':
  --mode <mode>           Execution mode (default: auto)
                            auto          - Auto-detect (local if on PVE, else pve-ssh)
                            local         - Run pct commands directly (on PVE host)
                            pve-ssh       - SSH to PVE host, then use pct
                            container-ssh - SSH directly into container (needs openssh-server)
                            http          - Use cmux-execd HTTP exec (needs PVE_PUBLIC_DOMAIN)

Environment Variables:
  PVE_EXEC_MODE           Default execution mode for configure (default: auto)
  PVE_SSH_HOST            SSH target for pve-ssh mode (default: derived from PVE_API_URL)
  PVE_PUBLIC_DOMAIN           Cloudflare Tunnel domain for HTTP exec (optional)
                            When set, adds 'http' mode using cmux-execd
  PVE_MAX_RETRIES         Max retries for transient errors (default: 3)
  PVE_RETRY_DELAY         Initial retry delay in seconds (default: 5)

Examples:
  $(basename "$0") list
  $(basename "$0") create 9000 --memory 8192 --cores 8
  $(basename "$0") configure 9000                      # Auto-detect mode
  $(basename "$0") configure 9000 --mode pve-ssh      # SSH to PVE host
  $(basename "$0") configure 9000 --mode container-ssh # SSH to container
  $(basename "$0") configure 9000 --mode http         # HTTP exec (needs cmux-execd)
  $(basename "$0") convert 9000

Note: The Proxmox VE API does not support executing commands inside containers.
      The 'configure' command requires either:
      - Running this script on the PVE host (local mode)
      - SSH access to the PVE host (pve-ssh mode)
      - SSH server running inside the container (container-ssh mode)
      - cmux-execd HTTP daemon running inside the container (http mode)
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
        --data-urlencode "unprivileged=0" \
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

# Get container IP address via API
# Usage: pve_lxc_get_ip <vmid> [node]
pve_lxc_get_ip() {
    local vmid="$1"
    local node="${2:-$(pve_get_default_node)}"
    pve_api GET "/api2/json/nodes/${node}/lxc/${vmid}/interfaces" | \
        jq -r '.data[] | select(.name == "eth0") | .inet // empty' | \
        cut -d'/' -f1
}

cmd_configure() {
    local vmid="$1"
    shift
    local node
    node=$(pve_get_default_node)

    # Parse options
    local mode="${PVE_EXEC_MODE:-auto}"  # auto, pve-ssh, container-ssh, local
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --mode) mode="$2"; shift 2 ;;
            *) log_error "Unknown option: $1"; return 1 ;;
        esac
    done

    log_info "Configuring container ${vmid} on ${node}..."

    # Check container exists
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "null" || -z "$status" ]]; then
        log_error "Container ${vmid} not found"
        return 1
    fi

    # Start container if not running
    if [[ "$status" != "running" ]]; then
        log_info "Starting container ${vmid} via API..."
        local upid
        upid=$(pve_lxc_start "$vmid" "$node" | jq -r '.data // empty')
        if [[ -n "$upid" ]]; then
            pve_wait_task "$upid" 120 "$node"
        fi
        sleep 5
    fi

    # Generate setup script
    local setup_script="/tmp/cmux-lxc-setup-${vmid}.sh"

    cat > "$setup_script" << 'SETUP_EOF'
#!/bin/bash
# cmux LXC container setup script - idempotent and resumable
# Run this inside the container: pct exec <vmid> -- bash /tmp/setup.sh

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# Marker file to track completed steps
MARKER_DIR="/opt/cmux/.setup-markers"
mkdir -p "$MARKER_DIR"

step_done() { [[ -f "$MARKER_DIR/$1" ]]; }
mark_done() { touch "$MARKER_DIR/$1"; }

echo "=== cmux LXC Setup Script (Resumable) ==="
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
        zsh software-properties-common
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

# Step 7: CRIU (optional - may not be available on all distros)
if step_done "07-criu"; then
    echo "[7/8] CRIU... SKIP (already done)"
elif command -v criu &>/dev/null; then
    echo "[7/8] CRIU... SKIP (already installed)"
    mark_done "07-criu"
else
    echo "[7/8] Installing CRIU..."
    # Enable universe repo if needed (for Ubuntu)
    add-apt-repository -y universe 2>/dev/null || true
    apt-get update -qq 2>/dev/null || true
    if apt-get install -y -qq criu 2>/dev/null; then
        echo "    CRIU installed"
    else
        echo "    CRIU not available - skipping (checkpointing will use disk snapshots)"
    fi
    mark_done "07-criu"
fi

# Step 8: cmux directories and final config
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

    # Set zsh as default shell if available
    if command -v zsh &>/dev/null; then
        chsh -s "$(which zsh)" root 2>/dev/null || true
    fi

    # Setup XDG_RUNTIME_DIR (needed for some tools)
    mkdir -p /run/user/0
    chmod 700 /run/user/0
    grep -q 'XDG_RUNTIME_DIR' /root/.bashrc 2>/dev/null || \
        echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.bashrc
    grep -q 'XDG_RUNTIME_DIR' /root/.zshrc 2>/dev/null || \
        echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.zshrc 2>/dev/null || true

    # Setup PATH in shell rc files
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
echo "Setup completed successfully!"
SETUP_EOF

    chmod +x "$setup_script"

    # Auto-detect execution mode if set to auto
    if [[ "$mode" == "auto" ]]; then
        # Check if we're on the PVE host (pct command available)
        if command -v pct &>/dev/null; then
            mode="local"
        else
            # Default to pve-ssh since container-ssh requires SSH in container
            mode="pve-ssh"
        fi
    fi

    log_info "Execution mode: ${mode}"

    case "$mode" in
        local)
            # Running directly on PVE host
            log_info "Pushing setup script to container ${vmid}..."
            if ! pct push "$vmid" "$setup_script" /tmp/setup.sh; then
                log_error "Failed to push setup script to container"
                return 1
            fi

            log_info "Executing setup script inside container ${vmid}..."
            log_info "This may take several minutes..."
            echo ""

            if pct exec "$vmid" -- bash /tmp/setup.sh; then
                log_success "Container ${vmid} configured successfully"
            else
                log_error "Setup script failed"
                echo "Debug: pct enter ${vmid}"
                return 1
            fi
            ;;

        pve-ssh)
            # SSH to PVE host, then use pct
            local pve_ssh_host="${PVE_SSH_HOST:-}"
            if [[ -z "$pve_ssh_host" ]]; then
                pve_ssh_host="root@$(echo "${PVE_API_URL}" | sed -E 's|https?://([^:/]+).*|\1|')"
            fi
            log_info "Using PVE SSH host: ${pve_ssh_host}"

            log_info "Copying setup script to PVE host..."
            if ! retry_command "SCP to PVE host" scp -q "$setup_script" "${pve_ssh_host}:/tmp/cmux-lxc-setup-${vmid}.sh"; then
                log_error "Failed to copy setup script to PVE host"
                return 1
            fi

            log_info "Pushing setup script to container ${vmid}..."
            if ! retry_command "pct push" ssh "$pve_ssh_host" "pct push ${vmid} /tmp/cmux-lxc-setup-${vmid}.sh /tmp/setup.sh"; then
                log_error "Failed to push setup script to container"
                return 1
            fi

            log_info "Executing setup script inside container ${vmid}..."
            log_info "This may take several minutes..."
            echo ""

            if ssh -t "$pve_ssh_host" "pct exec ${vmid} -- bash /tmp/setup.sh"; then
                log_success "Container ${vmid} configured successfully"
            else
                log_error "Setup script failed"
                echo "Debug: ssh ${pve_ssh_host} 'pct enter ${vmid}'"
                return 1
            fi
            ;;

        container-ssh)
            # SSH directly into the container using its IP (requires SSH in container)
            log_info "Getting container IP address via API..."
            local container_ip
            container_ip=$(pve_lxc_get_ip "$vmid" "$node")

            if [[ -z "$container_ip" ]]; then
                log_error "Could not get container IP address"
                log_info "Container may not have network configured yet"
                echo ""
                echo "Alternative: Run on PVE host directly:"
                echo "  scp ${setup_script} root@<pve-host>:/tmp/"
                echo "  ssh root@<pve-host> 'pct push ${vmid} /tmp/cmux-lxc-setup-${vmid}.sh /tmp/setup.sh'"
                echo "  ssh root@<pve-host> 'pct exec ${vmid} -- bash /tmp/setup.sh'"
                return 1
            fi

            local container_ssh="root@${container_ip}"
            log_info "Container IP: ${container_ip}"

            # Quick check if SSH port is open (1 second timeout)
            if ! nc -z -w 1 "$container_ip" 22 &>/dev/null; then
                log_warn "SSH port 22 not open on container (openssh-server not installed)"
                echo ""
                echo "The container does not have SSH enabled."
                echo "Options:"
                echo "  1. Run script on PVE host: --mode pve-ssh"
                echo "  2. Copy script manually and run via PVE console"
                echo ""
                echo "Script generated: ${setup_script}"
                echo ""
                echo "Manual steps on PVE host:"
                echo "  pct push ${vmid} ${setup_script} /tmp/setup.sh"
                echo "  pct exec ${vmid} -- bash /tmp/setup.sh"
                return 1
            fi

            log_info "Copying setup script to container..."
            if ! retry_command "SCP to container" scp -o StrictHostKeyChecking=no "$setup_script" "${container_ssh}:/tmp/setup.sh"; then
                log_error "Failed to copy setup script to container"
                return 1
            fi

            log_info "Executing setup script inside container ${vmid}..."
            log_info "This may take several minutes..."
            echo ""

            if ssh -t -o StrictHostKeyChecking=no "$container_ssh" "bash /tmp/setup.sh"; then
                log_success "Container ${vmid} configured successfully"
            else
                log_error "Setup script failed"
                echo "Debug: ssh ${container_ssh}"
                return 1
            fi
            ;;

        http)
            # Use HTTP exec via cmux-execd (requires PVE_PUBLIC_DOMAIN and cmux-execd running)
            if [[ -z "$PVE_PUBLIC_DOMAIN" ]]; then
                log_error "HTTP exec mode requires PVE_PUBLIC_DOMAIN environment variable"
                echo "Set PVE_PUBLIC_DOMAIN to your Cloudflare Tunnel domain (e.g., example.com)"
                return 1
            fi

            local hostname
            hostname=$(get_container_hostname "$vmid")
            local http_url="https://port-39375-${hostname}.${PVE_PUBLIC_DOMAIN}/exec"
            log_info "Using HTTP exec via cmux-execd: ${http_url}"

            # Check if cmux-execd is reachable
            log_info "Testing HTTP exec connectivity..."
            if ! http_exec "$vmid" "echo 'HTTP exec test'" 10 &>/dev/null; then
                log_error "HTTP exec not available on container ${vmid}"
                echo "Ensure cmux-execd is running inside the container."
                echo "Falling back to SSH mode may be necessary for initial setup."
                return 1
            fi
            log_info "HTTP exec is available"

            log_info "Pushing setup script to container ${vmid} via HTTP exec..."
            if ! http_push "$vmid" "$setup_script" "/tmp/setup.sh"; then
                log_error "Failed to push setup script via HTTP exec"
                return 1
            fi

            log_info "Executing setup script inside container ${vmid} via HTTP exec..."
            log_info "This may take several minutes..."
            echo ""

            # Execute with a long timeout (15 minutes for full setup)
            if http_exec "$vmid" "bash /tmp/setup.sh" 900; then
                log_success "Container ${vmid} configured successfully via HTTP exec"
            else
                log_error "Setup script failed"
                echo "Check container logs or try --mode pve-ssh for debugging"
                return 1
            fi
            ;;

        *)
            log_error "Unknown execution mode: ${mode}"
            echo "Valid modes: auto, local, pve-ssh, container-ssh, http"
            return 1
            ;;
    esac

    echo ""
    echo "Next steps:"
    echo "  1. Convert to template: $(basename "$0") convert ${vmid}"
    echo "     (This will auto-stop the container)"
}

cmd_convert() {
    local vmid="$1"
    local node
    node=$(pve_get_default_node)

    # Check container exists and get config
    local config
    config=$(pve_lxc_config "$vmid" "$node")

    # Check if already a template
    local is_template
    is_template=$(echo "$config" | jq -r '.data.template // 0')
    if [[ "$is_template" == "1" ]]; then
        log_success "Container ${vmid} is already a template"
        echo ""
        echo "Clone command: pct clone ${vmid} <new-vmid> --full"
        return 0
    fi

    # Check status and stop if running
    local status
    status=$(pve_lxc_status "$vmid" "$node" | jq -r '.data.status')

    if [[ "$status" == "running" ]]; then
        log_info "Stopping container ${vmid}..."
        local upid
        upid=$(pve_lxc_stop "$vmid" "$node" | jq -r '.data // empty')
        if [[ -n "$upid" ]]; then
            pve_wait_task "$upid" 60 "$node" || true
        fi
        sleep 2
    fi

    log_info "Converting container ${vmid} to template..."

    local result
    result=$(pve_api POST "/api2/json/nodes/${node}/lxc/${vmid}/template")

    # Debug: show raw API response
    log_info "API response:"
    echo "$result" | jq . 2>/dev/null || echo "$result"

    # Check for errors in response
    if echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
        log_error "Failed to convert to template (API error)"
        return 1
    fi

    # Verify the template was actually created
    sleep 1
    local verify_config
    verify_config=$(pve_lxc_config "$vmid" "$node")
    local is_now_template
    is_now_template=$(echo "$verify_config" | jq -r '.data.template // 0')

    if [[ "$is_now_template" != "1" ]]; then
        log_error "Template conversion failed - container is not marked as template"
        log_info "This may be a permissions issue. Verify your API token has VM.Config.Options permission."
        return 1
    fi

    log_success "Container ${vmid} converted to template"
    echo ""
    echo "Template is now ready for cloning."
    echo "Clone command: pct clone ${vmid} <new-vmid> --full"
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
