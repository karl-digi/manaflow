#!/usr/bin/env bash
# install-clone-proxy.sh - Install pve-clone-proxy binary and systemd unit on PVE host
#
# Intended usage (run on PVE host):
#   curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/install-clone-proxy.sh | bash -s --
#   # With local binary you already uploaded (e.g., /tmp/pve-clone-proxy):
#   curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/install-clone-proxy.sh | \
#     bash -s -- --binary-path /tmp/pve-clone-proxy
#   # Or download from a specific URL:
#   curl -fsSL https://raw.githubusercontent.com/karlorz/cmux/main/scripts/pve/install-clone-proxy.sh | \
#     bash -s -- --binary-url https://example.com/pve-clone-proxy-linux-amd64
#
# Notes:
# - This script does NOT build on the PVE host. Provide a prebuilt binary via --binary-path or --binary-url.
# - Requires root privileges.

set -euo pipefail

DEFAULT_INSTALL_DIR="/usr/local/bin"
DEFAULT_ENV_FILE="/etc/default/pve-clone-proxy"
DEFAULT_SERVICE_PATH="/etc/systemd/system/pve-clone-proxy.service"
DEFAULT_BINARY_URL_BASE="https://github.com/karlorz/cmux/releases/latest/download"

binary_path=""
binary_url=""
install_dir="$DEFAULT_INSTALL_DIR"
env_file="$DEFAULT_ENV_FILE"
service_path="$DEFAULT_SERVICE_PATH"
skip_start="false"

usage() {
    cat <<EOF
Usage: $0 [--binary-path /path/to/pve-clone-proxy] [--binary-url URL] [--install-dir DIR] [--env-file FILE] [--service-path FILE] [--no-start]

Options:
  --binary-path   Use an already-downloaded binary on the host (e.g., /tmp/pve-clone-proxy-test)
  --binary-url    Download binary from URL (default: $DEFAULT_BINARY_URL)
  --install-dir   Where to install the binary (default: $DEFAULT_INSTALL_DIR)
  --env-file      Environment file for systemd unit (default: $DEFAULT_ENV_FILE)
  --service-path  Systemd unit destination (default: $DEFAULT_SERVICE_PATH)
  --no-start      Install but do not enable/start the service

If both --binary-path and --binary-url are provided, --binary-path wins.
EOF
}

log() { printf "[%s] %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"; }

require_root() {
    if [[ $EUID -ne 0 ]]; then
        log "ERROR: must run as root"
        exit 1
    fi
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)
            log "ERROR: unsupported architecture $(uname -m)"
            exit 1
            ;;
    esac
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --binary-path)
                binary_path="$2"; shift 2;;
            --binary-url)
                binary_url="$2"; shift 2;;
            --install-dir)
                install_dir="$2"; shift 2;;
            --env-file)
                env_file="$2"; shift 2;;
            --service-path)
                service_path="$2"; shift 2;;
            --no-start)
                skip_start="true"; shift 1;;
            -h|--help)
                usage; exit 0;;
            *)
                log "ERROR: unknown option $1"
                usage
                exit 1
                ;;
        esac
    done
}

download_binary() {
    local url="$1"
    local dst="$2"
    log "Downloading binary from $url"
    curl -fL --connect-timeout 10 --retry 2 "$url" -o "$dst"
    chmod +x "$dst"
}

install_binary() {
    local src="$1"
    local dest_dir="$2"
    mkdir -p "$dest_dir"
    install -m 0755 "$src" "${dest_dir}/pve-clone-proxy"
    log "Installed binary to ${dest_dir}/pve-clone-proxy"
}

write_env_file() {
    local file="$1"
    if [[ -f "$file" ]]; then
        log "Env file exists, leaving as-is: $file"
        return
    fi

    cat > "$file" <<'EOF'
# Environment overrides for pve-clone-proxy
# CLONE_PROXY_LISTEN="127.0.0.1:8081"
# CLONE_PROXY_TARGET="https://127.0.0.1:8006"
CLONE_PROXY_SKIP_TLS_VERIFY="true"
# CLONE_PROXY_POLL_INTERVAL="2s"
# CLONE_PROXY_POLL_TIMEOUT="15m"
# CLONE_PROXY_REQUEST_TIMEOUT="30s"
# CLONE_PROXY_QUEUE_SIZE="100"
EOF
    chmod 0644 "$file"
    log "Wrote env file: $file"
}

write_service() {
    local file="$1"
    local env="$2"

    cat > "$file" <<EOF
[Unit]
Description=cmux PVE LXC clone serialization proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=-${env}
ExecStart=${install_dir}/pve-clone-proxy
Restart=on-failure
RestartSec=3
TimeoutStopSec=15s

NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$file"
    log "Wrote systemd unit: $file"
}

main() {
    parse_args "$@"
    require_root

    arch=$(detect_arch)
    default_url="${DEFAULT_BINARY_URL_BASE}/pve-clone-proxy-linux-${arch}"

    tmp_bin=""
    if [[ -n "$binary_path" ]]; then
        if [[ ! -f "$binary_path" ]]; then
            log "ERROR: binary not found at $binary_path"
            exit 1
        fi
        tmp_bin="$binary_path"
        log "Using provided binary: $binary_path"
    else
        tmp_bin="$(mktemp)"
        download_binary "${binary_url:-$default_url}" "$tmp_bin"
    fi

    install_binary "$tmp_bin" "$install_dir"
    write_env_file "$env_file"
    write_service "$service_path" "$env_file"

    systemctl daemon-reload
    if [[ "$skip_start" != "true" ]]; then
        systemctl enable pve-clone-proxy
        systemctl restart pve-clone-proxy
        log "Service enabled and restarted: pve-clone-proxy"
        systemctl --no-pager --full status pve-clone-proxy || true
    else
        log "Service installed but not started (--no-start set)"
    fi

    if [[ -z "$binary_path" ]]; then
        rm -f "$tmp_bin"
    fi
}

main "$@"
