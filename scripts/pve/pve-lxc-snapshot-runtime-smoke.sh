#!/usr/bin/env bash
set -euo pipefail

results_json="${1:-}"

if [[ -z "${results_json}" ]]; then
  echo "Usage: $0 <results-json>" >&2
  echo "Example: $0 logs/pve-lxc-snapshot/results.json" >&2
  exit 2
fi

if [[ ! -f "${results_json}" ]]; then
  echo "ERROR: results json not found: ${results_json}" >&2
  exit 2
fi

if ! command -v devsh >/dev/null 2>&1; then
  echo "ERROR: devsh not found on PATH" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
verify="${script_dir}/pve-lxc-networkd-verify.sh"
diag="${script_dir}/pve-lxc-networkd-diag.sh"

if [[ ! -x "${verify}" ]]; then
  echo "ERROR: missing verify script: ${verify}" >&2
  exit 2
fi
if [[ ! -x "${diag}" ]]; then
  echo "ERROR: missing diag script: ${diag}" >&2
  exit 2
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_dir="logs/pve-lxc-networkd"
mkdir -p "${log_dir}"

run_novnc_verify() {
  local id="$1"
  devsh exec "${id}" "set -euo pipefail; expected_version='v1.7.0-beta'; marker=\$(cat /etc/cmux/novnc-version 2>/dev/null || true); if [[ \"\${marker}\" != \"\${expected_version}\" ]]; then echo \"FAIL: expected /etc/cmux/novnc-version=\${expected_version}, got \${marker:-missing}\" >&2; exit 1; fi; if dpkg-query -W -f='\${Status}\\n' novnc 2>/dev/null | grep -q '^install ok installed$'; then echo 'FAIL: distro novnc package is still installed' >&2; exit 1; fi; if ! grep -q 'vnc-clipboard-bridge' /usr/share/novnc/vnc.html 2>/dev/null; then echo 'FAIL: vnc-clipboard-bridge missing from /usr/share/novnc/vnc.html' >&2; exit 1; fi; curl -I --max-time 5 http://127.0.0.1:39380/vnc.html >/dev/null"
}

readarray -t snapshot_lines < <(
  python3 - "${results_json}" <<'PY'
import json
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
results = data.get("results") or []
for r in results:
    preset = (r.get("presetId") or r.get("preset_id") or "unknown").strip()
    snap = (r.get("snapshotId") or r.get("snapshot_id") or "").strip()
    if not snap:
        continue
    print(f"{preset}\t{snap}")
PY
)

if [[ ${#snapshot_lines[@]} -eq 0 ]]; then
  echo "ERROR: no snapshot IDs found in ${results_json}" >&2
  exit 2
fi

active_id=""
cleanup() {
  if [[ -n "${active_id}" ]]; then
    devsh delete "${active_id}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for line in "${snapshot_lines[@]}"; do
  preset="$(printf '%s' "${line}" | cut -f1)"
  snapshot_id="$(printf '%s' "${line}" | cut -f2)"

  echo ""
  echo "=== Runtime smoke: ${preset} (${snapshot_id}) ==="

  set +e
  start_out="$(timeout 12m devsh start -p pve-lxc --no-auth --snapshot "${snapshot_id}" 2>&1)"
  start_rc=$?
  set -e
  echo "${start_out}"
  if [[ $start_rc -ne 0 ]]; then
    echo "ERROR: devsh start failed for snapshot ${snapshot_id}" >&2
    exit $start_rc
  fi

  active_id="$(printf '%s' "${start_out}" | grep -oE 'pvelxc-[a-z0-9]+' | head -n 1 || true)"
  if [[ -z "${active_id}" ]]; then
    active_id="$(printf '%s' "${start_out}" | grep -oE 'cmux-[0-9]+' | head -n 1 || true)"
  fi
  if [[ -z "${active_id}" ]]; then
    echo "ERROR: could not parse instance ID from devsh output" >&2
    exit 1
  fi

  echo "Instance: ${active_id}"

  echo "Waiting for exec..."
  exec_ready="false"
  saw_401="false"
  timed_out="false"
  deadline=$((SECONDS + 600))
  for _ in $(seq 1 40); do
    if probe_out="$(devsh exec "${active_id}" "echo exec_ready" 2>&1)"; then
      exec_ready="true"
      break
    fi
    if [[ "${probe_out}" == *401* ]]; then
      saw_401="true"
    fi
    if (( SECONDS >= deadline )); then
      # shellcheck disable=SC2034 # deadline-break marker required by Change 4 spec
      timed_out="true"
      break
    fi
    sleep 3
  done
  if [[ "${exec_ready}" != "true" ]]; then
    if [[ "${saw_401}" == "true" ]]; then
      echo "exec endpoint returned HTTP 401 (auth) - execd token propagation broken; check execd auth token fetch" >&2
    else
      echo "exec endpoint unreachable (network) - check cloudflared/tailscale route and cmux-execd startup" >&2
    fi
    echo "ERROR: exec not ready for ${active_id}" >&2
    "${diag}" "${active_id}" "${log_dir}/diag.runtime.${preset}.${snapshot_id}.${active_id}.${timestamp}.txt" || true
    exit 1
  fi

  diag_out="${log_dir}/diag.runtime.${preset}.${snapshot_id}.${active_id}.${timestamp}.txt"
  "${diag}" "${active_id}" "${diag_out}" || true

  if ! "${verify}" "${active_id}"; then
    echo "ERROR: runtime verification failed for ${active_id} (${snapshot_id})" >&2
    echo "Diagnostics: ${diag_out}" >&2
    exit 1
  fi

  if ! run_novnc_verify "${active_id}"; then
    echo "ERROR: noVNC runtime verification failed for ${active_id} (${snapshot_id})" >&2
    echo "Diagnostics: ${diag_out}" >&2
    exit 1
  fi

  echo "Re-checking after 30s (post-boot overwrite detection)..."
  sleep 30
  if ! "${verify}" "${active_id}"; then
    late_diag_out="${log_dir}/diag.runtime.late.${preset}.${snapshot_id}.${active_id}.${timestamp}.txt"
    "${diag}" "${active_id}" "${late_diag_out}" || true
    echo "ERROR: runtime verification regressed after boot for ${active_id} (${snapshot_id})" >&2
    echo "Diagnostics (early): ${diag_out}" >&2
    echo "Diagnostics (late): ${late_diag_out}" >&2
    exit 1
  fi

  if ! run_novnc_verify "${active_id}"; then
    late_diag_out="${log_dir}/diag.runtime.late.${preset}.${snapshot_id}.${active_id}.${timestamp}.txt"
    "${diag}" "${active_id}" "${late_diag_out}" || true
    echo "ERROR: noVNC runtime verification regressed after boot for ${active_id} (${snapshot_id})" >&2
    echo "Diagnostics (early): ${diag_out}" >&2
    echo "Diagnostics (late): ${late_diag_out}" >&2
    exit 1
  fi

  echo "PASS: ${preset} (${snapshot_id})"

  devsh delete "${active_id}" >/dev/null 2>&1 || true
  active_id=""
done

echo ""
echo "All runtime smoke checks passed"
