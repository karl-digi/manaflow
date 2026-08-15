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
mkdir -p "${runtime_dir}"
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

cat >"${tmp_dir}/bash_env" <<'EOF'
SECONDS=0
sleep() {
  local duration="${1:-0}"
  SECONDS=$((SECONDS + duration))
}
# In-process fakes: probes must not spawn real subprocesses, or bash's
# SECONDS variable accrues wall-clock time and the 600-second deadline
# fires a probe early on slow machines.
timeout() {
  shift
  "$@"
}
devsh() {
  local command_name="${1:-}"
  shift || true

  case "${command_name}" in
    start)
      echo "pvelxc-deadline"
      ;;
    exec)
      local calls=0
      if [[ -f "${DEVSH_CALLS_FILE}" ]]; then
        IFS= read -r calls <"${DEVSH_CALLS_FILE}" || true
      fi
      calls=$((calls + 1))
      printf '%s\n' "${calls}" >"${DEVSH_CALLS_FILE}"

      if [[ "${DEVSH_MODE}" == "fail-then-succeed" && "${calls}" -gt 40 ]]; then
        echo "exec_ready"
        return 0
      fi

      if [[ "${DEVSH_MODE}" == "token-fetch-fail" ]]; then
        echo "Error: failed to execute command: fetch exec token: HTTP 501" >&2
        return 1
      fi

      echo "exec endpoint not ready" >&2
      return 1
      ;;
    delete)
      ;;
    *)
      echo "unexpected devsh command: ${command_name}" >&2
      return 1
      ;;
  esac
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

calls_file="${tmp_dir}/calls.token"
if token_output="$(run_smoke token-fetch-fail "${calls_file}" 2>&1)"; then
  printf '%s\n' "${token_output}" >&2
  fail "runtime smoke must fail when the execd auth token cannot be fetched"
fi
if [[ "${token_output}" != *"could not fetch the execd auth token"* ]]; then
  fail "token-fetch failure lost its diagnostic: ${token_output}"
fi
if [[ "${token_output}" == *"exec endpoint unreachable (network)"* ]]; then
  fail "token-fetch failure was misclassified as a network failure"
fi

echo "PASS: token-fetch failures are classified distinctly from network failures"
