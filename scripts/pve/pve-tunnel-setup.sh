#!/usr/bin/env bash
# pve-tunnel-setup.sh - Deploy Cloudflare Tunnel + Caddy on PVE host
#
# This script sets up public access for PVE LXC sandboxes without port forwarding.
# Run this on your PVE host (not locally).
#
# Prerequisites:
#   - PVE v8.x host
#   - Domain configured in Cloudflare
#   - Cloudflare API token with Zone:DNS:Edit and Account:Cloudflare Tunnel:Edit permissions
#
# Usage:
#   # Copy to PVE host and run:
#   scp scripts/pve/pve-tunnel-setup.sh root@pve:/tmp/
#   ssh root@pve "bash /tmp/pve-tunnel-setup.sh setup"
#
#   # Or run specific commands:
#   ./pve-tunnel-setup.sh install-cloudflared
#   ./pve-tunnel-setup.sh install-caddy
#   ./pve-tunnel-setup.sh create-tunnel
#   ./pve-tunnel-setup.sh configure-dns
#   ./pve-tunnel-setup.sh status

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step() { echo -e "${CYAN}[STEP]${NC} $*"; }

# Configuration (can be overridden via environment)
CF_TUNNEL_NAME="${CF_TUNNEL_NAME:-cmux-tunnel}"
CADDY_PORT="${CADDY_PORT:-8080}"
CLOUDFLARED_CONFIG_DIR="${CLOUDFLARED_CONFIG_DIR:-/etc/cloudflared}"
CADDY_CONFIG_DIR="${CADDY_CONFIG_DIR:-/etc/caddy}"
PVE_API_HOSTNAME="${PVE_API_HOSTNAME:-}"
# Default PVE API origin goes through the local clone proxy (plain HTTP).
# Override to https://127.0.0.1:8006 if you want to bypass the proxy.
PVE_API_ORIGIN="${PVE_API_ORIGIN:-http://127.0.0.1:8081}"

# Service ports for cmux sandboxes
VSCODE_PORT=39378
GO_WORKER_PORT=39377      # Go worker-daemon (SSH proxy, HTTP API)
NODE_WORKER_PORT=39376    # Node.js worker (Socket.IO for web tasks)
XTERM_PORT=39383
EXEC_PORT=39375
VNC_PORT=39380

show_help() {
    cat << 'EOF'
PVE Cloudflare Tunnel Setup Script

This script deploys Cloudflare Tunnel + Caddy for public access to PVE LXC sandboxes
without requiring port forwarding.

USAGE:
    ./pve-tunnel-setup.sh <command> [options]

COMMANDS:
    setup               Run full setup (install + configure + start)
    install-cloudflared Install cloudflared binary
    install-caddy       Install Caddy web server
    create-tunnel       Create Cloudflare tunnel (requires CF_API_TOKEN)
    configure-dns       Add wildcard DNS CNAME to Cloudflare
    configure-caddy     Generate Caddy config for subdomain routing
    configure-tunnel    Generate cloudflared config
    start               Start cloudflared and caddy services
    stop                Stop services
    status              Show service status
    logs                Show logs from both services
    uninstall           Remove tunnel and configs

REQUIRED ENVIRONMENT VARIABLES:
    CF_API_TOKEN        Cloudflare API token with DNS:Edit and Tunnel:Edit permissions
    CF_ZONE_ID          Cloudflare Zone ID (found in domain overview)
    CF_ACCOUNT_ID       Cloudflare Account ID (found in domain overview)
    CF_DOMAIN           Your domain (e.g., example.com)

OPTIONAL ENVIRONMENT VARIABLES:
    CF_TUNNEL_NAME      Tunnel name (default: cmux-tunnel)
    PVE_API_HOSTNAME    Optional PVE API hostname (e.g., pve.example.com)
    PVE_API_ORIGIN      PVE API origin URL (default: https://127.0.0.1:8006)

URL PATTERN (instanceId-based, uses free Cloudflare Universal SSL):
    https://port-{port}-{instanceId}.{CF_DOMAIN}

    Examples:
      https://port-39378-pvelxc-abc123.example.com  (vscode)
      https://port-39377-pvelxc-abc123.example.com  (go worker - SSH proxy)
      https://port-39376-pvelxc-abc123.example.com  (node.js worker - Socket.IO)
      https://port-39375-pvelxc-abc123.example.com  (exec)
      https://port-39380-pvelxc-abc123.example.com  (vnc)
      https://port-39383-pvelxc-abc123.example.com  (xterm)
      https://port-5173-pvelxc-abc123.example.com   (preview)

EXAMPLE:
    # Set environment
    export CF_API_TOKEN="your-token"
    export CF_ZONE_ID="your-zone-id"
    export CF_ACCOUNT_ID="your-account-id"
    export CF_DOMAIN="example.com"

    # Run full setup
    ./pve-tunnel-setup.sh setup

    # URLs will be available at:
    # https://port-39378-pvelxc-abc123.example.com (vscode)
    # https://port-39377-pvelxc-abc123.example.com (go worker - SSH proxy)
    # https://port-39376-pvelxc-abc123.example.com (node.js worker - Socket.IO)
EOF
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

check_env() {
    local missing=0
    for var in CF_API_TOKEN CF_ZONE_ID CF_ACCOUNT_ID CF_DOMAIN; do
        if [[ -z "${!var:-}" ]]; then
            log_error "Missing required environment variable: $var"
            missing=1
        fi
    done
    if [[ $missing -eq 1 ]]; then
        echo ""
        echo "Set these variables before running:"
        echo "  export CF_API_TOKEN='your-api-token'"
        echo "  export CF_ZONE_ID='your-zone-id'"
        echo "  export CF_ACCOUNT_ID='your-account-id'"
        echo "  export CF_DOMAIN='example.com'"
        exit 1
    fi
}

# Install cloudflared
install_cloudflared() {
    log_step "Installing cloudflared..."

    if command -v cloudflared &> /dev/null; then
        local version
        version=$(cloudflared --version 2>&1 | head -1)
        log_success "cloudflared already installed: $version"
        return 0
    fi

    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64) arch="amd64" ;;
        aarch64) arch="arm64" ;;
        armv7l) arch="arm" ;;
        *) log_error "Unsupported architecture: $arch"; exit 1 ;;
    esac

    local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
    log_info "Downloading cloudflared for $arch..."

    curl -fsSL "$url" -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared

    # Verify installation
    local version
    version=$(cloudflared --version 2>&1 | head -1)
    log_success "Installed cloudflared: $version"
}

# Install Caddy
install_caddy() {
    log_step "Installing Caddy..."

    if command -v caddy &> /dev/null; then
        local version
        version=$(caddy version 2>&1 | head -1)
        log_success "Caddy already installed: $version"
        return 0
    fi

    # Add Caddy repo
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl

    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list

    apt-get update -qq
    apt-get install -y caddy

    # Disable default caddy service (we'll use custom config)
    systemctl stop caddy 2>/dev/null || true
    systemctl disable caddy 2>/dev/null || true

    log_success "Caddy installed"
}

# Create Cloudflare Tunnel via API
create_tunnel() {
    log_step "Creating Cloudflare Tunnel: $CF_TUNNEL_NAME"
    check_env

    mkdir -p "$CLOUDFLARED_CONFIG_DIR"

    # Check if tunnel already exists
    local existing
    existing=$(curl -s -X GET \
        "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${CF_TUNNEL_NAME}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" | jq -r '.result[0].id // empty')

    if [[ -n "$existing" ]]; then
        log_warn "Tunnel '$CF_TUNNEL_NAME' already exists (ID: $existing)"
        CF_TUNNEL_ID="$existing"
    else
        # Create tunnel
        local response
        response=$(curl -s -X POST \
            "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"name\":\"${CF_TUNNEL_NAME}\",\"config_src\":\"local\"}")

        CF_TUNNEL_ID=$(echo "$response" | jq -r '.result.id // empty')

        if [[ -z "$CF_TUNNEL_ID" ]]; then
            log_error "Failed to create tunnel"
            echo "$response" | jq .
            exit 1
        fi

        log_success "Created tunnel: $CF_TUNNEL_ID"
    fi

    # Get tunnel token
    log_info "Fetching tunnel token..."
    local token_response
    token_response=$(curl -s -X GET \
        "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/token" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json")

    local tunnel_token
    tunnel_token=$(echo "$token_response" | jq -r '.result // empty')

    if [[ -z "$tunnel_token" || "$tunnel_token" == "null" ]]; then
        log_error "Failed to get tunnel token"
        echo "$token_response" | jq .
        exit 1
    fi

    # Save tunnel info
    echo "$CF_TUNNEL_ID" > "${CLOUDFLARED_CONFIG_DIR}/tunnel-id"
    echo "$tunnel_token" > "${CLOUDFLARED_CONFIG_DIR}/tunnel-token"
    chmod 600 "${CLOUDFLARED_CONFIG_DIR}/tunnel-token"

    log_success "Tunnel token saved to ${CLOUDFLARED_CONFIG_DIR}/tunnel-token"
}

# Configure DNS wildcard CNAME
configure_dns() {
    log_step "Configuring wildcard DNS..."
    check_env

    local tunnel_id
    tunnel_id=$(cat "${CLOUDFLARED_CONFIG_DIR}/tunnel-id" 2>/dev/null || echo "")

    if [[ -z "$tunnel_id" ]]; then
        log_error "Tunnel ID not found. Run 'create-tunnel' first."
        exit 1
    fi

    # Use single-level wildcard for free Cloudflare Universal SSL
    local record_name="*"
    local target="${tunnel_id}.cfargotunnel.com"

    # Check if record exists
    local existing
    existing=$(curl -s -X GET \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${record_name}.${CF_DOMAIN}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" | jq -r '.result[0].id // empty')

    if [[ -n "$existing" ]]; then
        log_info "Updating existing DNS record..."
        curl -s -X PUT \
            "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${existing}" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${target}\",\"proxied\":true}" > /dev/null
    else
        log_info "Creating DNS record: *.${CF_DOMAIN} -> ${target}"
        local response
        response=$(curl -s -X POST \
            "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${target}\",\"proxied\":true}")

        if ! echo "$response" | jq -e '.success' > /dev/null; then
            log_error "Failed to create DNS record"
            echo "$response" | jq .
            exit 1
        fi
    fi

    log_success "DNS configured: *.${CF_DOMAIN} -> tunnel"
}

# Configure cloudflared
configure_tunnel() {
    log_step "Configuring cloudflared..."

    local tunnel_id
    tunnel_id=$(cat "${CLOUDFLARED_CONFIG_DIR}/tunnel-id" 2>/dev/null || echo "")

    if [[ -z "$tunnel_id" ]]; then
        log_error "Tunnel ID not found. Run 'create-tunnel' first."
        exit 1
    fi

    # Use single-level wildcard for free Cloudflare Universal SSL
    local hostname_pattern="*.${CF_DOMAIN}"

    # Create credentials file from tunnel token
    local tunnel_token
    tunnel_token=$(cat "${CLOUDFLARED_CONFIG_DIR}/tunnel-token" 2>/dev/null || echo "")

    if [[ -n "$tunnel_token" ]]; then
        # Decode token to get credentials (base64 encoded JSON with AccountTag, TunnelSecret, TunnelID)
        local decoded
        decoded=$(echo "$tunnel_token" | base64 -d 2>/dev/null || echo "")

        if [[ -n "$decoded" ]]; then
            local account_tag tunnel_secret
            account_tag=$(echo "$decoded" | jq -r '.a // empty')
            tunnel_secret=$(echo "$decoded" | jq -r '.s // empty')

            if [[ -n "$account_tag" && -n "$tunnel_secret" ]]; then
                cat > "${CLOUDFLARED_CONFIG_DIR}/${tunnel_id}.json" << CREDS
{
  "AccountTag": "${account_tag}",
  "TunnelSecret": "${tunnel_secret}",
  "TunnelID": "${tunnel_id}"
}
CREDS
                chmod 600 "${CLOUDFLARED_CONFIG_DIR}/${tunnel_id}.json"
                log_success "Created credentials file"
            fi
        fi
    fi

    cat > "${CLOUDFLARED_CONFIG_DIR}/config.yml" << EOF
# Cloudflare Tunnel configuration for cmux sandboxes
# Generated by pve-tunnel-setup.sh
# URL pattern: https://port-{port}-{instanceId}.${CF_DOMAIN}

tunnel: ${tunnel_id}
credentials-file: ${CLOUDFLARED_CONFIG_DIR}/${tunnel_id}.json

ingress:
$(if [[ -n "$PVE_API_HOSTNAME" ]]; then cat << PVE_INGRESS
    # Optional PVE API hostname (defaults to clone proxy at ${PVE_API_ORIGIN})
    - hostname: "${PVE_API_HOSTNAME}"
    service: ${PVE_API_ORIGIN}
    originRequest:
      noTLSVerify: true

PVE_INGRESS
fi)
  # Route all subdomains to local Caddy
  - hostname: "${hostname_pattern}"
    service: http://localhost:${CADDY_PORT}
    originRequest:
      noTLSVerify: true

  # Catch-all (required)
  - service: http_status:404
EOF

    log_success "cloudflared config written to ${CLOUDFLARED_CONFIG_DIR}/config.yml"

    # Create systemd service using local config mode (not --token)
    cat > /etc/systemd/system/cloudflared.service << EOF
[Unit]
Description=Cloudflare Tunnel for cmux sandboxes
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --config ${CLOUDFLARED_CONFIG_DIR}/config.yml run
Restart=always
RestartSec=5
KillMode=process
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    log_success "cloudflared systemd service configured"
}

# Configure Caddy for dynamic subdomain routing
configure_caddy() {
    log_step "Configuring Caddy..."

    mkdir -p "$CADDY_CONFIG_DIR"

    # Get local domain suffix for container DNS resolution
    local domain_suffix
    domain_suffix=$(grep -oP 'search\s+\K\S+' /etc/resolv.conf 2>/dev/null || echo "lan")

    cat > "${CADDY_CONFIG_DIR}/Caddyfile.cmux" << EOF
# Caddy configuration for cmux sandbox subdomain routing
# Generated by pve-tunnel-setup.sh
# URL pattern (instanceId-based): port-{port}-{instanceId}.${CF_DOMAIN}
#
# Examples:
#   port-39378-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39378 (vscode)
#   port-39377-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39377 (go worker - SSH proxy)
#   port-39376-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39376 (node.js worker - Socket.IO)
#   port-39375-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39375 (exec)
#   port-39380-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39380 (vnc)
#   port-39383-pvelxc-abc123.${CF_DOMAIN} -> pvelxc-abc123.${domain_suffix}:39383 (xterm)
#   port-5173-pvelxc-abc123.${CF_DOMAIN}  -> pvelxc-abc123.${domain_suffix}:5173  (preview)

:${CADDY_PORT} {
    # Handle CORS preflight requests
    @options method OPTIONS
    handle @options {
        header Access-Control-Allow-Origin "*"
        header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"
        header Access-Control-Allow-Headers "*"
        header Access-Control-Max-Age "86400"
        respond 204
    }

    # InstanceId-based routing
    @service header_regexp service Host ^port-(\d+)-([a-z0-9-]+)\.
    handle @service {
        reverse_proxy {re.service.2}.${domain_suffix}:{re.service.1} {
            header_up Host {upstream_hostport}
            transport http {
                dial_timeout 10s
            }
            # Strip headers that block iframe embedding (e.g., noVNC sends Cross-Origin-Resource-Policy: same-origin)
            # Also strip CORS headers to avoid duplicates (Caddy adds its own)
            header_down -X-Frame-Options
            header_down -Content-Security-Policy
            header_down -Content-Security-Policy-Report-Only
            header_down -Cross-Origin-Embedder-Policy
            header_down -Cross-Origin-Opener-Policy
            header_down -Cross-Origin-Resource-Policy
            header_down -Access-Control-Allow-Origin
            header_down -Access-Control-Allow-Methods
            header_down -Access-Control-Allow-Headers
            header_down -Access-Control-Expose-Headers
            header_down -Access-Control-Allow-Credentials
        }
        # Add permissive CORS headers for iframe embedding
        header Access-Control-Allow-Origin "*"
        header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"
        header Access-Control-Allow-Headers "*"
        header Access-Control-Expose-Headers "*"
    }

    # Default: return helpful error
    handle {
        respond "cmux sandbox not found. Use format: port-{port}-{instanceId}.${CF_DOMAIN}" 404
    }

    # Logging
    log {
        output file /var/log/caddy/cmux-access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
EOF

    mkdir -p /var/log/caddy

    log_success "Caddy config written to ${CADDY_CONFIG_DIR}/Caddyfile.cmux"

    # Create systemd service
    cat > /etc/systemd/system/caddy-cmux.service << EOF
[Unit]
Description=Caddy reverse proxy for cmux sandboxes
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/caddy run --config ${CADDY_CONFIG_DIR}/Caddyfile.cmux --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config ${CADDY_CONFIG_DIR}/Caddyfile.cmux --adapter caddyfile
Restart=always
RestartSec=5
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    log_success "Caddy systemd service configured"
}

# Start services
start_services() {
    log_step "Starting services..."

    systemctl enable cloudflared
    systemctl start cloudflared

    systemctl enable caddy-cmux
    systemctl start caddy-cmux

    sleep 2

    if systemctl is-active --quiet cloudflared; then
        log_success "cloudflared is running"
    else
        log_error "cloudflared failed to start"
        journalctl -u cloudflared -n 20 --no-pager
    fi

    if systemctl is-active --quiet caddy-cmux; then
        log_success "caddy-cmux is running"
    else
        log_error "caddy-cmux failed to start"
        journalctl -u caddy-cmux -n 20 --no-pager
    fi
}

# Stop services
stop_services() {
    log_step "Stopping services..."
    systemctl stop cloudflared 2>/dev/null || true
    systemctl stop caddy-cmux 2>/dev/null || true
    log_success "Services stopped"
}

# Show status
show_status() {
    echo ""
    echo "=== Cloudflare Tunnel Status ==="
    systemctl status cloudflared --no-pager -l 2>/dev/null || echo "Not installed"
    echo ""
    echo "=== Caddy Status ==="
    systemctl status caddy-cmux --no-pager -l 2>/dev/null || echo "Not installed"
    echo ""
    echo "=== Configuration ==="
    if [[ -f "${CLOUDFLARED_CONFIG_DIR}/tunnel-id" ]]; then
        echo "Tunnel ID: $(cat ${CLOUDFLARED_CONFIG_DIR}/tunnel-id)"
    fi
    if [[ -n "${CF_DOMAIN:-}" ]]; then
        echo "Sandbox URLs: https://port-{port}-{instanceId}.${CF_DOMAIN}"
    fi
}

# Show logs
show_logs() {
    echo "=== Cloudflared Logs ==="
    journalctl -u cloudflared -n 50 --no-pager
    echo ""
    echo "=== Caddy Logs ==="
    journalctl -u caddy-cmux -n 50 --no-pager
}

# Uninstall
uninstall() {
    log_step "Uninstalling..."

    stop_services

    systemctl disable cloudflared 2>/dev/null || true
    systemctl disable caddy-cmux 2>/dev/null || true

    rm -f /etc/systemd/system/cloudflared.service
    rm -f /etc/systemd/system/caddy-cmux.service
    systemctl daemon-reload

    # Optionally remove configs
    read -p "Remove configuration files? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$CLOUDFLARED_CONFIG_DIR"
        rm -f "${CADDY_CONFIG_DIR}/Caddyfile.cmux"
        log_info "Configuration removed"
    fi

    log_success "Uninstall complete"
}

# Full setup
full_setup() {
    log_info "Starting full setup..."
    check_root
    check_env

    echo ""
    echo "Configuration:"
    echo "  Domain: ${CF_DOMAIN}"
    echo "  Tunnel name: ${CF_TUNNEL_NAME}"
    echo ""
    echo "URLs will be (instanceId-based pattern, free Cloudflare Universal SSL):"
    echo "  https://port-39378-{instanceId}.${CF_DOMAIN}  (vscode)"
    echo "  https://port-39377-{instanceId}.${CF_DOMAIN}  (go worker - SSH proxy)"
    echo "  https://port-39376-{instanceId}.${CF_DOMAIN}  (node.js worker - Socket.IO)"
    echo ""

    read -p "Continue? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        exit 0
    fi

    install_cloudflared
    install_caddy
    create_tunnel
    configure_dns
    configure_tunnel
    configure_caddy
    start_services

    echo ""
    log_success "Setup complete!"
    echo ""
    echo "Your sandboxes are now accessible at:"
    echo "  https://port-39378-{instanceId}.${CF_DOMAIN}  (vscode)"
    echo "  https://port-39377-{instanceId}.${CF_DOMAIN}  (go worker - SSH proxy)"
    echo "  https://port-39376-{instanceId}.${CF_DOMAIN}  (node.js worker - Socket.IO)"
    echo "  https://port-39375-{instanceId}.${CF_DOMAIN}  (exec)"
    echo "  https://port-39380-{instanceId}.${CF_DOMAIN}  (vnc)"
    echo "  https://port-39383-{instanceId}.${CF_DOMAIN}  (xterm)"
    echo ""
    echo "To test, start a sandbox container and visit the URL."
    echo "For example, if you start pvelxc-abc123:"
    echo "  https://port-39378-pvelxc-abc123.${CF_DOMAIN}"
}

# Main
case "${1:-help}" in
    setup)
        full_setup
        ;;
    install-cloudflared)
        check_root
        install_cloudflared
        ;;
    install-caddy)
        check_root
        install_caddy
        ;;
    create-tunnel)
        check_root
        create_tunnel
        ;;
    configure-dns)
        check_root
        configure_dns
        ;;
    configure-tunnel)
        check_root
        configure_tunnel
        ;;
    configure-caddy)
        check_root
        configure_caddy
        ;;
    start)
        check_root
        start_services
        ;;
    stop)
        check_root
        stop_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    uninstall)
        check_root
        uninstall
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
