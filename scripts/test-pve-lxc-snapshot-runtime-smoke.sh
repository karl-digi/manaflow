#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_script="${repo_root}/scripts/pve/pve-lxc-snapshot-runtime-smoke.sh"

if [[ ! -f "${source_script}" ]]; then
  echo "FAIL: runtime smoke script not found: ${source_script}" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${tmp_dir}"
}
trap cleanup EXIT

runtime_dir="${tmp_dir}/runtime"
bin_dir="${tmp_dir}/bin"
mkdir -p "${runtime_dir}" "${bin_dir}"
cp "${source_script}" "${runtime_dir}/pve-lxc-snapshot-runtime-smoke.sh"

cat >"${runtime_dir}/pve-lxc-networkd-verify.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${runtime_dir}/pve-lxc-networkd-verify.sh"

cat >"${runtime_dir}/pve-lxc-networkd-diag.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${runtime_dir}/pve-lxc-networkd-diag.sh"

cat >"${bin_dir}/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
EOF
chmod +x "${bin_dir}/timeout"

cat >"${bin_dir}/devsh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
shift || true

case "${command_name}" in
  start)
    echo "pvelxc-deadline"
    ;;
  exec)
    calls=0
    if [[ -f "${DEVSH_CALLS_FILE}" ]]; then
      calls="$(<"${DEVSH_CALLS_FILE}")"
    fi
    calls=$((calls + 1))
    printf '%s\n' "${calls}" >"${DEVSH_CALLS_FILE}"

    if [[ "${DEVSH_MODE}" == "fail-then-succeed" && "${calls}" -gt 40 ]]; then
      echo "exec_ready"
      exit 0
    fi

    echo "exec endpoint not ready" >&2
    exit 1
    ;;
  delete)
    ;;
  *)
    echo "unexpected devsh command: ${command_name}" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${bin_dir}/devsh"

cat >"${tmp_dir}/bash_env" <<'EOF'
SECONDS=0
sleep() {
  local duration="${1:-0}"
  SECONDS=$((SECONDS + duration))
}
EOF

printf '%s\n' '{"results":[{"presetId":"standard","snapshotId":"snapshot-deadline"}]}' >"${tmp_dir}/results.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_smoke() {
  local mode="$1"
  local calls_file="$2"
  (
    cd "${tmp_dir}"
    PATH="${bin_dir}:${PATH}" \
      BASH_ENV="${tmp_dir}/bash_env" \
      DEVSH_MODE="${mode}" \
      DEVSH_CALLS_FILE="${calls_file}" \
      bash "${runtime_dir}/pve-lxc-snapshot-runtime-smoke.sh" "${tmp_dir}/results.json"
  )
}

echo "=== PVE LXC snapshot runtime-smoke deadline tests ==="

calls_file="${tmp_dir}/calls.success"
if ! success_output="$(run_smoke fail-then-succeed "${calls_file}" 2>&1)"; then
  printf '%s\n' "${success_output}" >&2
  fail "runtime smoke must accept readiness after more than 40 fast failed probes"
fi
success_calls="$(<"${calls_file}")"
if (( success_calls < 41 )); then
  fail "expected at least 41 readiness probes, got ${success_calls}"
fi
if [[ "${success_output}" != *"All runtime smoke checks passed"* ]]; then
  fail "success output did not report a passing runtime smoke check"
fi

calls_file="${tmp_dir}/calls.deadline"
if deadline_output="$(run_smoke always-fail "${calls_file}" 2>&1)"; then
  printf '%s\n' "${deadline_output}" >&2
  fail "runtime smoke must fail when readiness never arrives"
fi
deadline_calls="$(<"${calls_file}")"
if [[ "${deadline_calls}" != "200" ]]; then
  fail "expected 200 virtual three-second probes before the 600-second deadline, got ${deadline_calls}"
fi
if [[ "${deadline_output}" != *"exec endpoint unreachable (network)"* ]]; then
  fail "deadline failure lost its network diagnostic"
fi

echo "PASS: readiness probes honor the 600-second deadline"
