#!/usr/bin/env bash
set -euo pipefail

echo "=== devsh PVE LXC Consistency Tests ==="

if [[ -z "${PVE_API_URL:-}" ]]; then
  echo "PVE_API_URL required"
  exit 1
fi
if [[ -z "${PVE_API_TOKEN:-}" ]]; then
  echo "PVE_API_TOKEN required"
  exit 1
fi

echo "Building devsh..."
make install-devsh-dev

# Ensure ~/.local/bin is on PATH (where install-devsh-dev installs the binary)
export PATH="$HOME/.local/bin:$PATH"

ID=""
cleanup() {
  if [[ -n "${ID}" ]]; then
    echo ""
    echo "Cleaning up ${ID}..."
    devsh delete "${ID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo ""
echo "Test 1: Starting PVE LXC instance..."
OUTPUT="$(devsh start -p pve-lxc 2>&1 || true)"
echo "${OUTPUT}"

ID="$(echo "${OUTPUT}" | grep -oE 'pvelxc-[a-z0-9]+' | head -n 1 || true)"
if [[ -z "${ID}" ]]; then
  ID="$(echo "${OUTPUT}" | grep -oE 'cmux-[0-9]+' | head -n 1 || true)"
fi
if [[ -z "${ID}" ]]; then
  echo "FAIL: Could not parse instance ID from output"
  exit 1
fi
echo "Created: ${ID}"

echo ""
echo "Test 2: Verifying instance ID format..."
if [[ ! "${ID}" =~ ^(pvelxc-[a-z0-9]+|cmux-[0-9]+)$ ]]; then
  echo "FAIL: Invalid instance ID format: ${ID}"
  exit 1
fi
echo "PASS: Instance ID format correct"

echo ""
echo "Test 3: Testing exec..."
sleep 30
if ! RESULT="$(devsh exec "${ID}" "echo hello" 2>&1)"; then
  echo "FAIL: Exec command failed"
  echo "${RESULT}"
  exit 1
fi
if [[ "${RESULT}" != *"hello"* ]]; then
  echo "FAIL: Exec did not return expected output"
  echo "Got: ${RESULT}"
  exit 1
fi
echo "PASS: Exec works"

echo ""
echo "Test 4: Checking URLs..."
STATUS="$(devsh status "${ID}" 2>&1 || true)"
echo "${STATUS}"
if [[ "${STATUS}" == *"port-39378"* ]] || [[ "${STATUS}" == *"VS Code:"* ]]; then
  echo "PASS: VS Code URL present"
else
  echo "WARN: VS Code URL format may differ"
fi

echo ""
echo "Test 5: Testing pause/resume..."
devsh pause "${ID}"
sleep 5
devsh resume "${ID}"
sleep 10
if ! RESULT2="$(devsh exec "${ID}" "echo resumed" 2>&1)"; then
  echo "FAIL: Exec failed after resume"
  echo "${RESULT2}"
  exit 1
fi
if [[ "${RESULT2}" != *"resumed"* ]]; then
  echo "FAIL: Resume did not work"
  echo "Got: ${RESULT2}"
  exit 1
fi
echo "PASS: Pause/Resume works"

echo ""
echo "All tests PASSED"
