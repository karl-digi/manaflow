#!/bin/bash
# Test xterm CORS headers and connectivity
# Usage: ./scripts/test-xterm-cors.sh <vmid>
# Example: ./scripts/test-xterm-cors.sh 202

set -euo pipefail

VMID="${1:-202}"
DOMAIN="${PVE_PUBLIC_DOMAIN:-alphasolves.com}"
XTERM_URL="https://xterm-${VMID}.${DOMAIN}"

echo "=============================================="
echo "Testing xterm service for VMID: ${VMID}"
echo "URL: ${XTERM_URL}"
echo "=============================================="
echo

# Test 1: Basic connectivity
echo "[Test 1] Basic connectivity to ${XTERM_URL}/sessions"
echo "----------------------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${XTERM_URL}/sessions" --max-time 10 || echo "FAILED")
echo "HTTP Status Code: ${HTTP_CODE}"
echo

# Test 2: Check response headers (including CORS)
echo "[Test 2] Response headers from ${XTERM_URL}/sessions"
echo "----------------------------------------------"
curl -s -I "${XTERM_URL}/sessions" --max-time 10 2>&1 || echo "FAILED to get headers"
echo

# Test 3: Preflight OPTIONS request (what browsers send)
echo "[Test 3] CORS Preflight (OPTIONS) request"
echo "----------------------------------------------"
curl -s -I -X OPTIONS "${XTERM_URL}/sessions" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type" \
  --max-time 10 2>&1 || echo "FAILED OPTIONS request"
echo

# Test 4: Actual GET with Origin header
echo "[Test 4] GET request with Origin header"
echo "----------------------------------------------"
curl -s -i "${XTERM_URL}/sessions" \
  -H "Origin: http://localhost:5173" \
  -H "Accept: application/json" \
  --max-time 10 2>&1 | head -30 || echo "FAILED GET request"
echo

# Test 5: Check if service is running internally (via exec service)
echo "[Test 5] Check cmux-pty service status via exec endpoint"
echo "----------------------------------------------"
EXEC_URL="https://exec-${VMID}.${DOMAIN}"
curl -s -X POST "${EXEC_URL}/exec" \
  -H "Content-Type: application/json" \
  -d '{"command": "systemctl status cmux-pty --no-pager", "timeout_ms": 10000}' \
  --max-time 15 2>&1 || echo "FAILED exec request"
echo

# Test 6: Check cmux-pty logs
echo "[Test 6] Check cmux-pty logs (last 20 lines)"
echo "----------------------------------------------"
curl -s -X POST "${EXEC_URL}/exec" \
  -H "Content-Type: application/json" \
  -d '{"command": "tail -20 /var/log/cmux/cmux-pty.log", "timeout_ms": 10000}' \
  --max-time 15 2>&1 || echo "FAILED exec request"
echo

# Test 7: Check if cmux-pty binary has CORS support (check version/build date)
echo "[Test 7] Check cmux-pty binary info"
echo "----------------------------------------------"
curl -s -X POST "${EXEC_URL}/exec" \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la /usr/local/bin/cmux-pty && /usr/local/bin/cmux-pty --version 2>&1 || echo no-version-flag", "timeout_ms": 10000}' \
  --max-time 15 2>&1 || echo "FAILED exec request"
echo

# Test 8: Test internal xterm connectivity (from inside container)
echo "[Test 8] Test internal xterm connectivity (localhost:39383)"
echo "----------------------------------------------"
curl -s -X POST "${EXEC_URL}/exec" \
  -H "Content-Type: application/json" \
  -d '{"command": "curl -s -i http://127.0.0.1:39383/sessions -H \"Accept: application/json\" | head -30", "timeout_ms": 10000}' \
  --max-time 15 2>&1 || echo "FAILED exec request"
echo

echo "=============================================="
echo "Test complete"
echo "=============================================="
