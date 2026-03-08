#!/bin/bash
set -e

# ============================================================================
# Tailscale App Connector Setup for PVE LXCs
#
# Usage:
#   ./setup-tailscale-lxc.sh           # Full setup + verification
#   ./setup-tailscale-lxc.sh --attach <VMID>  # Attach hook to existing VM/template
#   ./setup-tailscale-lxc.sh --check   # Check configuration and fix issues
#   ./setup-tailscale-lxc.sh --ip <IP> # Override auto-detected IP
#   ./setup-tailscale-lxc.sh --help    # Show help
# ============================================================================

# Configuration (can be overridden via --ip flag or environment variable)
PVE_HOST_IP="${PVE_HOST_IP:-}"        # Auto-detected if not set
PVE_BRIDGE="${PVE_BRIDGE:-vmbr0}"     # Bridge interface to detect IP from
TAILSCALE_INTERFACE="tailscale0"      # Tailscale interface name
SNIPPET_DIR="/var/lib/vz/snippets"
HOOK_SCRIPT_NAME="tailscale-hook.sh"
TEMPLATE_VMID=9000                    # Default template for verification
SOCKS5_PORT=1055                      # SOCKS5 proxy port
ROUTE_OVERRIDE_SUBNET="${ROUTE_OVERRIDE_SUBNET:-10.10.0.0/23}" # Subnet to keep on local bridge (set empty to skip)
ROUTE_OVERRIDE_METRIC="${ROUTE_OVERRIDE_METRIC:-5}"            # Metric for the local override
LAN_DNS_SERVER="${LAN_DNS_SERVER:-}"  # Router/DHCP server for .lan DNS (auto-detected from gateway if not set)

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
debug() { echo -e "${BLUE}[DEBUG]${NC} $1"; }

# ============================================================================
# Auto-detect PVE Host IP
# ============================================================================
detect_host_ip() {
    local detected_ip

    # Try to get IP from the bridge interface
    detected_ip=$(ip -4 addr show "$PVE_BRIDGE" 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)

    if [ -z "$detected_ip" ]; then
        # Fallback: try to get from default route
        detected_ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' | head -1)
    fi

    if [ -z "$detected_ip" ]; then
        error "Could not auto-detect PVE host IP. Please specify with --ip <IP>"
    fi

    echo "$detected_ip"
}

# ============================================================================
# Auto-detect LAN DNS server (router/gateway)
# ============================================================================
detect_lan_dns() {
    local detected_gw

    # Get default gateway - typically the router that serves DHCP/DNS for .lan
    detected_gw=$(ip route show default 2>/dev/null | grep -oP 'via \K[\d.]+' | head -1)

    if [ -z "$detected_gw" ]; then
        warn "Could not auto-detect LAN DNS server (gateway). .lan resolution may not work."
        echo ""
        return
    fi

    echo "$detected_gw"
}

# ============================================================================
# Validate IP address format
# ============================================================================
validate_ip() {
    local ip="$1"
    if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        error "Invalid IP address format: $ip"
    fi
}

# ============================================================================
# Check and Fix Configuration
# ============================================================================
check_and_fix() {
    local issues_found=0
    local fixes_applied=0

    log "Checking Tailscale LXC configuration..."
    log "Detected PVE Host IP: $PVE_HOST_IP"
    echo ""

    # Check 1: tailscaled service
    log "Checking tailscaled service..."
    if ! systemctl is-active --quiet tailscaled; then
        warn "tailscaled is not running"
        issues_found=$((issues_found + 1))
    else
        log "  tailscaled: running"
    fi

    # Check 2: SOCKS5 config IP matches current host IP
    log "Checking SOCKS5 proxy configuration..."
    local socks5_conf="/etc/systemd/system/tailscaled.service.d/socks5.conf"
    if [ -f "$socks5_conf" ]; then
        local configured_ip
        configured_ip=$(grep -oP 'socks5-server=\K[\d.]+' "$socks5_conf" 2>/dev/null || echo "")

        if [ -z "$configured_ip" ]; then
            warn "  SOCKS5 config exists but no IP found"
            issues_found=$((issues_found + 1))
        elif [ "$configured_ip" != "$PVE_HOST_IP" ]; then
            warn "  SOCKS5 config IP mismatch: configured=$configured_ip, actual=$PVE_HOST_IP"
            issues_found=$((issues_found + 1))

            log "  Fixing SOCKS5 configuration..."
            mkdir -p /etc/systemd/system/tailscaled.service.d
            cat > "$socks5_conf" << EOF
[Service]
ExecStart=
ExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641 --socks5-server=$PVE_HOST_IP:$SOCKS5_PORT --outbound-http-proxy-listen=$PVE_HOST_IP:$SOCKS5_PORT
EOF
            systemctl daemon-reload
            systemctl restart tailscaled
            sleep 2
            fixes_applied=$((fixes_applied + 1))
            log "  Fixed SOCKS5 configuration"
        else
            log "  SOCKS5 config: OK (IP=$configured_ip)"
        fi
    else
        warn "  SOCKS5 config not found at $socks5_conf"
        issues_found=$((issues_found + 1))
    fi

    # Check 3: SOCKS5 proxy is listening
    log "Checking SOCKS5 proxy listener..."
    if ss -tlnp | grep -q ":$SOCKS5_PORT"; then
        local listen_ip
        listen_ip=$(ss -tlnp | grep ":$SOCKS5_PORT" | awk '{print $4}' | cut -d: -f1)
        if [ "$listen_ip" = "$PVE_HOST_IP" ]; then
            log "  SOCKS5 proxy: listening on $PVE_HOST_IP:$SOCKS5_PORT"
        else
            warn "  SOCKS5 proxy listening on wrong IP: $listen_ip (expected $PVE_HOST_IP)"
            issues_found=$((issues_found + 1))
        fi
    else
        warn "  SOCKS5 proxy not listening on port $SOCKS5_PORT"
        issues_found=$((issues_found + 1))
    fi

    # Check 4: dnsmasq config
    log "Checking dnsmasq configuration..."
    local dnsmasq_conf="/etc/dnsmasq.d/01-tailscale.conf"
    if [ -f "$dnsmasq_conf" ]; then
        local dnsmasq_ip
        dnsmasq_ip=$(grep -oP 'listen-address=\K[\d.]+' "$dnsmasq_conf" 2>/dev/null || echo "")

        if [ -z "$dnsmasq_ip" ]; then
            warn "  dnsmasq config exists but no listen-address found"
            issues_found=$((issues_found + 1))
        elif [ "$dnsmasq_ip" != "$PVE_HOST_IP" ]; then
            warn "  dnsmasq config IP mismatch: configured=$dnsmasq_ip, actual=$PVE_HOST_IP"
            issues_found=$((issues_found + 1))

            log "  Fixing dnsmasq configuration..."
            cat > "$dnsmasq_conf" << DNSEOF
interface=$PVE_BRIDGE
listen-address=$PVE_HOST_IP
bind-dynamic
server=100.100.100.100
domain-needed
bogus-priv
DNSEOF
            systemctl restart dnsmasq
            fixes_applied=$((fixes_applied + 1))
            log "  Fixed dnsmasq configuration"
        else
            log "  dnsmasq config: OK (IP=$dnsmasq_ip)"
        fi
    else
        warn "  dnsmasq config not found at $dnsmasq_conf"
        issues_found=$((issues_found + 1))
    fi

    # Check 5: dnsmasq service
    log "Checking dnsmasq service..."
    if ! systemctl is-active --quiet dnsmasq; then
        warn "  dnsmasq is not running"
        issues_found=$((issues_found + 1))
        log "  Starting dnsmasq..."
        systemctl start dnsmasq
        fixes_applied=$((fixes_applied + 1))
    else
        log "  dnsmasq: running"
    fi

    # Check 6: Hook script IP
    log "Checking hook script configuration..."
    local hook_script="$SNIPPET_DIR/$HOOK_SCRIPT_NAME"
    if [ -f "$hook_script" ]; then
        local hook_ip
        hook_ip=$(grep -oP 'PVE_HOST_IP="\K[\d.]+' "$hook_script" 2>/dev/null || echo "")

        if [ -z "$hook_ip" ]; then
            warn "  Hook script exists but no PVE_HOST_IP found"
            issues_found=$((issues_found + 1))
        elif [ "$hook_ip" != "$PVE_HOST_IP" ]; then
            warn "  Hook script IP mismatch: configured=$hook_ip, actual=$PVE_HOST_IP"
            issues_found=$((issues_found + 1))

            log "  Regenerating hook script..."
            create_hook_script
            fixes_applied=$((fixes_applied + 1))
            log "  Fixed hook script"
        else
            log "  Hook script: OK (IP=$hook_ip)"
        fi
    else
        warn "  Hook script not found at $hook_script"
        issues_found=$((issues_found + 1))
    fi

    # Check 7: IP forwarding
    log "Checking IP forwarding..."
    if [ "$(cat /proc/sys/net/ipv4/ip_forward)" != "1" ]; then
        warn "  IPv4 forwarding is disabled"
        issues_found=$((issues_found + 1))
        log "  Enabling IP forwarding..."
        echo 1 > /proc/sys/net/ipv4/ip_forward
        fixes_applied=$((fixes_applied + 1))
    else
        log "  IP forwarding: enabled"
    fi

    # Check 8: iptables MASQUERADE rule
    log "Checking iptables MASQUERADE rule..."
    if iptables -t nat -C POSTROUTING -o $TAILSCALE_INTERFACE -j MASQUERADE 2>/dev/null; then
        log "  MASQUERADE rule: OK"
    else
        warn "  MASQUERADE rule missing"
        issues_found=$((issues_found + 1))
    fi

    # Check 9: Local route override to keep LAN on bridge instead of tailscale0
    if [ -n "$ROUTE_OVERRIDE_SUBNET" ]; then
        log "Checking local route override for $ROUTE_OVERRIDE_SUBNET..."
        if ip route show "$ROUTE_OVERRIDE_SUBNET" | grep -q "dev $PVE_BRIDGE"; then
            log "  Local route present via $PVE_BRIDGE"
        else
            warn "  Local route missing; enforcing override..."
            ensure_local_route_override
            fixes_applied=$((fixes_applied + 1))
        fi
    else
        log "Route override skipped (ROUTE_OVERRIDE_SUBNET empty)"
    fi

    echo ""
    log "============================================"
    if [ $issues_found -eq 0 ]; then
        log "All checks passed! Configuration is healthy."
    else
        log "Issues found: $issues_found"
        log "Fixes applied: $fixes_applied"
        if [ $fixes_applied -gt 0 ]; then
            log "Re-run --check to verify fixes."
        fi
    fi
    log "============================================"

    return $issues_found
}

# ============================================================================
# Ensure local route override for overlapping LANs (prevents Tailscale route capture)
# ============================================================================
ensure_local_route_override() {
    if [ -z "$ROUTE_OVERRIDE_SUBNET" ]; then
        log "Route override skipped (ROUTE_OVERRIDE_SUBNET empty)"
        return
    fi

    # Install an explicit local route so vmbr0 wins over tailscale0 for the subnet
    if ip route replace "$ROUTE_OVERRIDE_SUBNET" dev "$PVE_BRIDGE" metric "$ROUTE_OVERRIDE_METRIC" src "$PVE_HOST_IP"; then
        log "Ensured local route for $ROUTE_OVERRIDE_SUBNET via $PVE_BRIDGE (metric=$ROUTE_OVERRIDE_METRIC src=$PVE_HOST_IP)"
    else
        warn "Failed to set local route for $ROUTE_OVERRIDE_SUBNET"
    fi

    # Add a rule so traffic to the subnet prefers table main over Tailscale table 52
    if ip rule delete pref 5260 to "$ROUTE_OVERRIDE_SUBNET" lookup main 2>/dev/null; then
        :
    fi
    if ip rule add pref 5260 to "$ROUTE_OVERRIDE_SUBNET" lookup main; then
        log "Ensured policy rule pref 5260 uses main for $ROUTE_OVERRIDE_SUBNET"
    else
        warn "Failed to set policy rule for $ROUTE_OVERRIDE_SUBNET"
    fi

    # Persist via oneshot systemd service (avoids editing /etc/network/interfaces directly)
    local service_path="/etc/systemd/system/tailscale-local-route.service"
    cat > "$service_path" << EOF
[Unit]
Description=Ensure local LAN route wins over Tailscale
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/sbin/ip route replace $ROUTE_OVERRIDE_SUBNET dev $PVE_BRIDGE metric $ROUTE_OVERRIDE_METRIC src $PVE_HOST_IP
ExecStart=/bin/sh -c '/sbin/ip rule delete pref 5260 to $ROUTE_OVERRIDE_SUBNET lookup main 2>/dev/null; /sbin/ip rule add pref 5260 to $ROUTE_OVERRIDE_SUBNET lookup main'

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now tailscale-local-route.service
    log "Persisted local route override service (tailscale-local-route.service)"
}

show_help() {
    cat << 'EOF'
Tailscale App Connector Setup for PVE LXCs

USAGE:
    ./setup-tailscale-lxc.sh [OPTIONS]

OPTIONS:
    (no args)       Full setup: configure host, create hook, run verification
    --attach VMID   Attach hook script to an existing VM or template
    --check         Check configuration and auto-fix IP mismatches
    --ip <IP>       Override auto-detected PVE host IP
    --help          Show this help message

ENVIRONMENT VARIABLES:
    PVE_HOST_IP     Override auto-detected IP (same as --ip)
    PVE_BRIDGE      Bridge interface to detect IP from (default: vmbr0)
    LAN_DNS_SERVER  Router/DHCP server IP for .lan hostname resolution
                    (auto-detected from default gateway if not set)

EXAMPLES:
    # Full setup with auto-detected IP
    ./setup-tailscale-lxc.sh

    # Full setup with specific IP
    ./setup-tailscale-lxc.sh --ip 10.10.9.9

    # Check and fix configuration issues
    ./setup-tailscale-lxc.sh --check

    # Attach hook to template 9000
    ./setup-tailscale-lxc.sh --attach 9000

    # Attach hook to running LXC 105
    ./setup-tailscale-lxc.sh --attach 105
EOF
    exit 0
}

# ============================================================================
# Attach Hook to VMID
# ============================================================================
attach_hook() {
    local vmid="$1"

    if ! pct config "$vmid" &>/dev/null; then
        error "VMID $vmid not found!"
    fi

    log "Attaching hook script to VMID $vmid..."
    pct set "$vmid" -hookscript "local:snippets/$HOOK_SCRIPT_NAME"
    log "Hook script attached to VMID $vmid"
    log "   Containers cloned from this template will auto-configure on start."
}

# ============================================================================
# Create Hook Script
# ============================================================================
create_hook_script() {
    log "Creating LXC Hook Script..."
    mkdir -p "$SNIPPET_DIR"

    cat <<HOOKEOF > "$SNIPPET_DIR/$HOOK_SCRIPT_NAME"
#!/bin/bash
vmid="\$1"
phase="\$2"
PVE_HOST_IP="$PVE_HOST_IP"

if [[ "\$phase" == "post-start" ]]; then
    echo "[\$vmid] Tailscale Hook: Configuring routes, DNS, and transparent proxy..."

    # Wait for network to be ready inside LXC
    echo "[\$vmid] Waiting for network..."
    for i in {1..30}; do
        if lxc-attach -n \$vmid -- ip route add 100.64.0.0/10 via \$PVE_HOST_IP 2>/dev/null; then
            echo "[\$vmid] Route added successfully."
            break
        fi
        sleep 1
    done

    # Force DNS to PVE Host
    lxc-attach -n \$vmid -- bash -c "echo 'nameserver \$PVE_HOST_IP' > /etc/resolv.conf"
    # Prefer IPv4 (redsocks is IPv4-only); make idempotent
    lxc-attach -n \$vmid -- bash -c "grep -q '^precedence ::ffff:0:0/96 100' /etc/gai.conf || echo 'precedence ::ffff:0:0/96 100' >> /etc/gai.conf"
    # Disable IPv6 to avoid bypass paths
    lxc-attach -n \$vmid -- sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || true
    lxc-attach -n \$vmid -- sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true
    lxc-attach -n \$vmid -- sysctl -w net.ipv6.conf.lo.disable_ipv6=1 >/dev/null 2>&1 || true

    # Install redsocks for transparent TCP proxying (if not present)
    if ! lxc-attach -n \$vmid -- which redsocks > /dev/null 2>&1; then
        echo "[\$vmid] Installing redsocks..."
        lxc-attach -n \$vmid -- apt-get update -qq
        lxc-attach -n \$vmid -- apt-get install -y -qq redsocks iptables
        # Stop default service immediately to prevent conflict
        lxc-attach -n \$vmid -- systemctl stop redsocks
        lxc-attach -n \$vmid -- systemctl disable redsocks
    fi

    # Create redsocks config
    lxc-attach -n \$vmid -- bash -c "cat > /etc/redsocks.conf << RSCONF
base {
    log_debug = off;
    log_info = off;
    daemon = on;
    redirector = iptables;
    redsocks_conn_max = 1024;
    connpres_idle_timeout = 300;
}
redsocks {
    local_ip = 127.0.0.1;
    local_port = 12345;
    ip = \$PVE_HOST_IP;
    port = $SOCKS5_PORT;
    type = socks5;
}
RSCONF"

    # Create iptables rules script
    lxc-attach -n \$vmid -- bash -c 'cat > /usr/local/bin/redsocks-fw.sh << '\''FWEOF'\''
#!/bin/bash
iptables -t nat -N REDSOCKS 2>/dev/null || iptables -t nat -F REDSOCKS
iptables -t nat -A REDSOCKS -d 0.0.0.0/8 -j RETURN
iptables -t nat -A REDSOCKS -d 10.0.0.0/8 -j RETURN
iptables -t nat -A REDSOCKS -d 100.64.0.0/10 -j RETURN
iptables -t nat -A REDSOCKS -d 127.0.0.0/8 -j RETURN
iptables -t nat -A REDSOCKS -d 169.254.0.0/16 -j RETURN
iptables -t nat -A REDSOCKS -d 172.16.0.0/12 -j RETURN
iptables -t nat -A REDSOCKS -d 192.168.0.0/16 -j RETURN
iptables -t nat -A REDSOCKS -d 224.0.0.0/4 -j RETURN
iptables -t nat -A REDSOCKS -d 240.0.0.0/4 -j RETURN
iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12345
iptables -t nat -A OUTPUT -p tcp -j REDSOCKS
# Block QUIC/UDP 443 to avoid bypassing the TCP proxy
iptables -C OUTPUT -p udp --dport 443 -j REJECT 2>/dev/null || iptables -A OUTPUT -p udp --dport 443 -j REJECT
# Allow DNS to host, block other UDP to stop leaks
iptables -C OUTPUT -p udp -d $PVE_HOST_IP --dport 53 -j ACCEPT 2>/dev/null || iptables -A OUTPUT -p udp -d $PVE_HOST_IP --dport 53 -j ACCEPT
iptables -C OUTPUT -p udp --dport 53 -j REJECT 2>/dev/null || iptables -A OUTPUT -p udp --dport 53 -j REJECT
iptables -C OUTPUT -p udp -j REJECT 2>/dev/null || iptables -A OUTPUT -p udp -j REJECT
FWEOF
chmod +x /usr/local/bin/redsocks-fw.sh'

    # Create systemd service
    lxc-attach -n \$vmid -- bash -c 'cat > /etc/systemd/system/redsocks.service << '\''SVCEOF'\''
[Unit]
Description=Redsocks Transparent Proxy
After=network.target

[Service]
Type=forking
# Apply iptables rules before starting
ExecStartPre=/usr/local/bin/redsocks-fw.sh
ExecStart=/usr/sbin/redsocks -c /etc/redsocks.conf
# Ensure rules are cleaned up on stop
ExecStopPost=/sbin/iptables -t nat -F REDSOCKS
ExecStopPost=/bin/sh -c "/sbin/iptables -t nat -D OUTPUT -p tcp -j REDSOCKS 2>/dev/null || true"
Restart=on-failure
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
SVCEOF'

    # Enable and start redsocks
    lxc-attach -n \$vmid -- systemctl daemon-reload
    lxc-attach -n \$vmid -- systemctl enable redsocks
    lxc-attach -n \$vmid -- systemctl start redsocks

    echo "[\$vmid] Tailscale Hook: Done. All TCP traffic routes through proxy."
fi
HOOKEOF

    chmod +x "$SNIPPET_DIR/$HOOK_SCRIPT_NAME"
    log "Hook script created at $SNIPPET_DIR/$HOOK_SCRIPT_NAME"
}

# ============================================================================
# Configure PVE Host
# ============================================================================
configure_host() {
    log "Configuring PVE Host..."
    log "Using PVE Host IP: $PVE_HOST_IP"

    # Install Tailscale if needed
    if ! command -v tailscale &> /dev/null; then
        log "Installing Tailscale..."
        curl -fsSL https://tailscale.com/install.sh | sh
    else
        log "Tailscale already installed."
    fi

    # Configure Tailscale
    if ! tailscale status &> /dev/null; then
        log "Running 'tailscale up'... authenticate via the link below:"
        # Reverting to --accept-dns=true as it is known working
        tailscale up --accept-dns=true --accept-routes=true
    else
        log "Tailscale is up."
        tailscale set --accept-dns=true --accept-routes=true
        log "Configured: --accept-dns=true --accept-routes=true"
    fi

    # Install dnsmasq if needed
    if ! command -v dnsmasq &> /dev/null; then
        log "Installing dnsmasq..."
        apt update && apt install dnsmasq -y
    fi

    # Configure dnsmasq for MagicDNS forwarding
    log "Configuring dnsmasq..."
    cat > /etc/dnsmasq.d/01-tailscale.conf << DNSEOF
interface=$PVE_BRIDGE
listen-address=$PVE_HOST_IP
bind-dynamic
DNSEOF

    # Add .lan DNS forwarding to router if LAN_DNS_SERVER is set
    if [ -n "$LAN_DNS_SERVER" ]; then
        log "Forwarding .lan queries to router at $LAN_DNS_SERVER"
        cat >> /etc/dnsmasq.d/01-tailscale.conf << DNSEOF
# Forward .lan queries to local router (DHCP server for hostname resolution)
server=/lan/$LAN_DNS_SERVER
DNSEOF
    fi

    cat >> /etc/dnsmasq.d/01-tailscale.conf << DNSEOF
# Forward all other queries to Tailscale MagicDNS
server=100.100.100.100
domain-needed
bogus-priv
DNSEOF
    systemctl restart dnsmasq

    # Enable IP forwarding
    log "Enabling IP forwarding..."
    echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-tailscale.conf
    echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.d/99-tailscale.conf
    sysctl -p /etc/sysctl.d/99-tailscale.conf

    # IPTables Masquerading
    if ! iptables -t nat -C POSTROUTING -o $TAILSCALE_INTERFACE -j MASQUERADE 2>/dev/null; then
        iptables -t nat -A POSTROUTING -o $TAILSCALE_INTERFACE -j MASQUERADE
        log "Added MASQUERADE rule."
        if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
            DEBIAN_FRONTEND=noninteractive apt install iptables-persistent -y
        fi
        netfilter-persistent save
    fi

    # Configure SOCKS5 proxy
    log "Configuring SOCKS5 proxy..."
    mkdir -p /etc/systemd/system/tailscaled.service.d
    cat > /etc/systemd/system/tailscaled.service.d/socks5.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=41641 --socks5-server=$PVE_HOST_IP:$SOCKS5_PORT --outbound-http-proxy-listen=$PVE_HOST_IP:$SOCKS5_PORT
EOF
    systemctl daemon-reload
    systemctl restart tailscaled
    sleep 3
    if ss -tlnp | grep -q ":$SOCKS5_PORT"; then
        log "SOCKS5 proxy listening on $PVE_HOST_IP:$SOCKS5_PORT"
    else
        warn "SOCKS5 proxy may not be running"
    fi

    ensure_local_route_override
}

# ============================================================================
# Verification
# ============================================================================
run_verification() {
    log "Starting Verification..."

    if ! pct config $TEMPLATE_VMID &>/dev/null; then
        warn "Template VMID $TEMPLATE_VMID not found. Skipping verification."
        return
    fi

    NEXT_VMID=$(pvesh get /cluster/nextid)
    log "Cloning VMID $TEMPLATE_VMID to new VMID $NEXT_VMID..."
    pct clone $TEMPLATE_VMID $NEXT_VMID --hostname "tailscale-test-$NEXT_VMID" --full 0

    log "Setting hookscript..."
    pct set $NEXT_VMID -hookscript "local:snippets/$HOOK_SCRIPT_NAME"

    log "Starting container $NEXT_VMID..."
    pct start $NEXT_VMID

    log "Waiting 15 seconds for startup and hook execution..."
    sleep 15

    log "Verifying Routes..."
    if pct exec $NEXT_VMID -- ip route show 100.64.0.0/10 | grep -q "via $PVE_HOST_IP"; then
        log "Route verification PASSED"
    else
        warn "Route verification FAILED"
    fi

    log "Verifying DNS..."
    if pct exec $NEXT_VMID -- cat /etc/resolv.conf | grep -q "nameserver $PVE_HOST_IP"; then
        log "DNS verification PASSED"
    else
        warn "DNS verification FAILED"
    fi

    log ""
    log "--- Setup Complete ---"
    log "Test container: pct exec $NEXT_VMID -- curl https://api.ipify.org"
    log "Delete when done: pct destroy $NEXT_VMID"
}

# ============================================================================
# Main
# ============================================================================

# Parse arguments
COMMAND=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            show_help
            ;;
        --check)
            COMMAND="check"
            shift
            ;;
        --attach)
            COMMAND="attach"
            ATTACH_VMID="${2:-}"
            if [ -z "$ATTACH_VMID" ]; then
                error "Usage: $0 --attach <VMID>"
            fi
            shift 2
            ;;
        --ip)
            PVE_HOST_IP="${2:-}"
            if [ -z "$PVE_HOST_IP" ]; then
                error "Usage: $0 --ip <IP_ADDRESS>"
            fi
            shift 2
            ;;
        *)
            error "Unknown option: $1. Use --help for usage."
            ;;
    esac
done

# Auto-detect IP if not provided
if [ -z "$PVE_HOST_IP" ]; then
    PVE_HOST_IP=$(detect_host_ip)
    log "Auto-detected PVE Host IP: $PVE_HOST_IP"
fi

# Validate IP
validate_ip "$PVE_HOST_IP"

# Auto-detect LAN DNS server if not provided
if [ -z "$LAN_DNS_SERVER" ]; then
    LAN_DNS_SERVER=$(detect_lan_dns)
    if [ -n "$LAN_DNS_SERVER" ]; then
        log "Auto-detected LAN DNS server (gateway): $LAN_DNS_SERVER"
    fi
fi

# Execute command
case "${COMMAND:-setup}" in
    check)
        check_and_fix
        ;;
    attach)
        create_hook_script
        attach_hook "$ATTACH_VMID"
        ;;
    setup|*)
        configure_host
        create_hook_script
        run_verification
        ;;
esac
