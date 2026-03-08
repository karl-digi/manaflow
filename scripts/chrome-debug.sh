#!/usr/bin/env bash
# Start Chrome with remote debugging in detached mode.
# Usage: ./scripts/chrome-debug.sh [URL]
set -euo pipefail

DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"
PROFILE_MATCH_PATTERN="chrome-debug-profile"
TARGET_URL="${1:-${CHROME_DEBUG_URL:-about:blank}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${ROOT_DIR}/logs/chrome-debug.log"
PROFILE_DIR="${CHROME_DEBUG_PROFILE:-${ROOT_DIR}/.chrome-debug-profile}"

detect_chrome() {
  if [[ -n "${CHROME:-}" ]]; then
    if [[ -x "${CHROME}" ]]; then
      echo "${CHROME}"
      return 0
    fi
    if command -v "${CHROME}" >/dev/null 2>&1; then
      command -v "${CHROME}"
      return 0
    fi
  fi

  if [[ "${OSTYPE:-}" == "darwin"* ]]; then
    local mac_paths=(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    )
    local p
    for p in "${mac_paths[@]}"; do
      if [[ -x "${p}" ]]; then
        echo "${p}"
        return 0
      fi
    done

    p="$(ls -d "$HOME"/.cache/puppeteer/chrome/*/chrome-mac-*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing 2>/dev/null | head -n 1 || true)"
    if [[ -n "${p}" && -x "${p}" ]]; then
      echo "${p}"
      return 0
    fi
  else
    local chrome_cmd
    for chrome_cmd in \
      "chromium-browser" \
      "chromium" \
      "google-chrome-unstable" \
      "google-chrome-stable" \
      "google-chrome"; do
      if command -v "${chrome_cmd}" >/dev/null 2>&1; then
        command -v "${chrome_cmd}"
        return 0
      fi
    done
  fi

  return 1
}

# Reuse existing healthy debug instance only if it matches our profile marker.
if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  if pgrep -f "${PROFILE_MATCH_PATTERN}" >/dev/null 2>&1; then
    echo "[OK] Found existing debug Chrome instance on port ${DEBUG_PORT}; reusing."
    exit 0
  fi
fi

echo "[INFO] No reusable debug instance found; stopping Chrome processes."
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
  pkill -ax "Google Chrome" 2>/dev/null || true
  pkill -ax "Google Chrome Canary" 2>/dev/null || true
  pkill -ax "Chromium" 2>/dev/null || true
else
  pkill -x "google-chrome" 2>/dev/null || true
  pkill -x "google-chrome-stable" 2>/dev/null || true
  pkill -x "google-chrome-unstable" 2>/dev/null || true
  pkill -x "chromium" 2>/dev/null || true
  pkill -x "chromium-browser" 2>/dev/null || true
fi

if pgrep -f "${PROFILE_MATCH_PATTERN}" >/dev/null 2>&1; then
  pgrep -f "${PROFILE_MATCH_PATTERN}" | xargs kill -9 2>/dev/null || true
fi
sleep 2

CHROME_BIN="$(detect_chrome || true)"
if [[ -z "${CHROME_BIN}" || ! -x "${CHROME_BIN}" ]]; then
  echo "[ERROR] Chrome/Chromium binary not found."
  echo "Set CHROME to a valid binary path if it is installed in a custom location."
  exit 1
fi

mkdir -p "$(dirname "${LOG_FILE}")" "${PROFILE_DIR}"

echo "[INFO] Starting Chrome in detached mode."
echo "[INFO] Chrome: ${CHROME_BIN}"
echo "[INFO] Port: ${DEBUG_PORT}"
echo "[INFO] Profile: ${PROFILE_DIR}"
echo "[INFO] URL: ${TARGET_URL}"
echo "[INFO] Log file: ${LOG_FILE}"

CHROME_ARGS=(
  --remote-debugging-port="${DEBUG_PORT}"
  --remote-debugging-address=127.0.0.1
  --remote-allow-origins=*
  --user-data-dir="${PROFILE_DIR}"
  --no-first-run
  --no-default-browser-check
  "${TARGET_URL}"
)

if command -v setsid >/dev/null 2>&1; then
  setsid nohup "${CHROME_BIN}" "${CHROME_ARGS[@]}" < /dev/null > "${LOG_FILE}" 2>&1 &
else
  nohup "${CHROME_BIN}" "${CHROME_ARGS[@]}" < /dev/null > "${LOG_FILE}" 2>&1 &
fi

echo -n "[INFO] Waiting for debugger on port ${DEBUG_PORT}"
for _ in {1..20}; do
  if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
    # Avoid false positives when Chrome briefly opens then exits.
    sleep 1
    if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
      echo
      echo "[OK] Chrome is listening on port ${DEBUG_PORT}."
      exit 0
    fi
  fi
  echo -n "."
  sleep 0.5
done

echo
echo "[ERROR] Chrome started but port ${DEBUG_PORT} is not responsive."
echo "[ERROR] Check logs at ${LOG_FILE}"
exit 1
