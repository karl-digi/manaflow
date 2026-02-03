#!/bin/bash
# Start all services for the cmux E2B sandbox
# Services: OpenVSCode, Chrome CDP, VNC, noVNC, worker daemon

echo "[cmux-e2b] Starting services..."

# Always generate a fresh auth token on startup (security: each instance gets unique token)
AUTH_TOKEN_FILE="/home/user/.worker-auth-token"
AUTH_TOKEN=$(openssl rand -hex 32)
echo "$AUTH_TOKEN" > "$AUTH_TOKEN_FILE"
chmod 644 "$AUTH_TOKEN_FILE"
chown user:user "$AUTH_TOKEN_FILE"

echo "[cmux-e2b] Auth token generated: ${AUTH_TOKEN:0:8}..."

# Create VSCode connection token file (same as worker auth)
VSCODE_TOKEN_FILE="/home/user/.vscode-token"
echo "$AUTH_TOKEN" > "$VSCODE_TOKEN_FILE"
chmod 644 "$VSCODE_TOKEN_FILE"
chown user:user "$VSCODE_TOKEN_FILE"

# Set VNC password (use first 8 chars of auth token for VNC which has 8 char limit)
VNC_PASSWORD="${AUTH_TOKEN:0:8}"
echo "$VNC_PASSWORD" | vncpasswd -f > /home/user/.vnc/passwd
chmod 600 /home/user/.vnc/passwd
echo "[cmux-e2b] VNC password set (first 8 chars of auth token)"

# Start D-Bus for desktop environment
echo "[cmux-e2b] Starting D-Bus..."
sudo mkdir -p /run/dbus 2>/dev/null || true
sudo dbus-daemon --system --fork 2>/dev/null || true

# Start VNC server on display :1 (port 5901)
echo "[cmux-e2b] Starting VNC server on display :1..."
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
vncserver :1 -geometry 1920x1080 -depth 24 2>/dev/null &
sleep 3

# Start noVNC on port 39380
echo "[cmux-e2b] Starting noVNC on port 39380..."
/opt/noVNC/utils/novnc_proxy --vnc localhost:5901 --listen 39380 2>/dev/null &

# Start OpenVSCode Server on port 39378 with connection token
echo "[cmux-e2b] Starting OpenVSCode Server on port 39378 (with token auth)..."
/opt/openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 39378 \
    --connection-token-file "$VSCODE_TOKEN_FILE" \
    --telemetry-level off \
    /home/user/workspace 2>/dev/null &

# Start Chrome in headless mode with CDP on port 9222
echo "[cmux-e2b] Starting Chrome CDP on port 9222..."
google-chrome \
    --headless=new \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --disable-software-rasterizer \
    --window-size=1920,1080 \
    --no-first-run \
    --no-default-browser-check \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --user-data-dir=/home/user/.chrome-data \
    about:blank 2>/dev/null &

# Start worker daemon on port 39377
echo "[cmux-e2b] Starting worker daemon on port 39377..."
node /usr/local/bin/worker-daemon.js &

echo "[cmux-e2b] All services started!"
echo "[cmux-e2b] Services:"
echo "  - VSCode:  http://localhost:39378?tkn=$AUTH_TOKEN"
echo "  - Worker:  http://localhost:39377 (use Bearer token)"
echo "  - VNC:     http://localhost:39380 (password: first 8 chars of token)"
echo "  - Chrome:  http://localhost:9222"
echo ""
echo "[cmux-e2b] Auth token stored at: $AUTH_TOKEN_FILE"

# Keep running
tail -f /dev/null
