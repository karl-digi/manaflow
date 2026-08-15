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

# A stale template token file next to the results JSON. The runtime smoke
# must ignore it: it generates a fresh disposable token per clone instead of
# reusing anything found in the artifact directory. Synthetic fixture only.
STALE_TOKEN="deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
printf '%s\n' "${STALE_TOKEN}" >"${tmp_dir}/execd-token-snapshot-deadline.txt"
chmod 644 "${tmp_dir}/execd-token-snapshot-deadline.txt"

cat >"${tmp_dir}/bash_env" <<'EOF'
# Unset first so SECONDS is an ordinary variable, not Bash's real-time
# special one: otherwise a real one-second command sleep accrues wall-clock
# time and reduces the virtual 600-second probe budget on slow hosts.
unset SECONDS
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
curl() {
  printf 'args=%s\n' "$*" >"${DEVSH_CURL_RECORD:-/dev/null}"
  printf '%s' "${DEVSH_HEALTHZ_STATUS:-200}"
}
# Record the PVE_EXECD_TOKEN_FILE state seen by a fake devsh invocation
# without printing the token itself to the test output.
record_token_state() {
  local out_file="$1"
  {
    printf 'path=%s\n' "${PVE_EXECD_TOKEN_FILE:-}"
    if [[ -n "${PVE_EXECD_TOKEN_FILE:-}" && -f "${PVE_EXECD_TOKEN_FILE}" ]]; then
      printf 'exists=yes\n'
      printf 'content=%s\n' "$(<"${PVE_EXECD_TOKEN_FILE}")"
      printf 'mode=%s\n' "$(stat -c '%a' "${PVE_EXECD_TOKEN_FILE}" 2>/dev/null || stat -f '%Lp' "${PVE_EXECD_TOKEN_FILE}" 2>/dev/null || printf 'unknown')"
    else
      printf 'exists=no\n'
    fi
  } >"${out_file}"
}
# Record the path mktemp returns so cleanup can be asserted even when devsh
# start is never reached.
mktemp() {
  local out
  out="$(command mktemp "$@")"
  if [[ -n "${DEVSH_MKTEMP_RECORD:-}" ]]; then
    printf 'path=%s\n' "${out}" >"${DEVSH_MKTEMP_RECORD}"
  fi
  printf '%s\n' "${out}"
}
# In-process stand-in that only fails disposable-token generation, proving
# EXIT cleanup covers failures between mktemp and devsh start.
python3() {
  if [[ "${DEVSH_MODE:-}" == "token-gen-fail" && "${2:-}" == *cmux-execd-token* ]]; then
    return 1
  fi
  command python3 "$@"
}
devsh() {
  local command_name="${1:-}"
  shift || true

  case "${command_name}" in
    start)
      record_token_state "${DEVSH_START_RECORD:-/dev/null}"

      local starts=0
      if [[ -f "${DEVSH_START_COUNT_FILE:-}" ]]; then
        IFS= read -r starts <"${DEVSH_START_COUNT_FILE}" || true
      fi
      starts=$((starts + 1))
      printf '%s\n' "${starts}" >"${DEVSH_START_COUNT_FILE:-/dev/null}"
      if [[ -n "${DEVSH_START_RECORD:-}" ]]; then
        record_token_state "${DEVSH_START_RECORD}.${starts}"
      fi

      if [[ "${DEVSH_MODE}" == "start-fail" ]]; then
        echo "devsh start failed" >&2
        return 1
      fi
      if [[ "${DEVSH_MODE}" == "second-start-fails" && "${starts}" -eq 2 ]]; then
        echo "devsh start failed for second clone" >&2
        return 1
      fi

      echo "pvelxc-deadline"
      ;;
    exec)
      # Record the token state at most once per smoke invocation: the record
      # helper spawns external programs, which must not run on every
      # readiness probe (real wall time would accrue in SECONDS and skew the
      # virtual 600-second deadline test).
      local recorded=0
      if [[ -f "${DEVSH_EXEC_RECORD_COUNT:-}" ]]; then
        IFS= read -r recorded <"${DEVSH_EXEC_RECORD_COUNT:-}" || true
      fi
      if (( recorded == 0 )); then
        record_token_state "${DEVSH_EXEC_RECORD:-/dev/null}"
        printf '%s\n' "$((recorded + 1))" >"${DEVSH_EXEC_RECORD_COUNT:-/dev/null}"
      fi

      local calls=0
      if [[ -f "${DEVSH_CALLS_FILE}" ]]; then
        IFS= read -r calls <"${DEVSH_CALLS_FILE}" || true
      fi
      calls=$((calls + 1))
      printf '%s\n' "${calls}" >"${DEVSH_CALLS_FILE}"

      if [[ "${DEVSH_MODE}" == "ready" || "${DEVSH_MODE}" == "second-start-fails" ]]; then
        echo "exec_ready"
        return 0
      fi

      if [[ "${DEVSH_MODE}" == "fail-then-succeed" && "${calls}" -gt 40 ]]; then
        echo "exec_ready"
        return 0
      fi

      if [[ "${DEVSH_MODE}" == "token-fetch-fail" ]]; then
        echo "Error: failed to execute command: fetch exec token: HTTP 501" >&2
        return 1
      fi

      if [[ "${DEVSH_MODE}" == "edge-502" ]]; then
        echo "Error: failed to execute command: HTTP exec failed for container 227 via candidates: https://port-39375-x.example.test, http://x.example.test:39375; last error: execd at https://port-39375-x.example.test/exec returned HTTP 502" >&2
        return 1
      fi

      if [[ "${DEVSH_MODE}" == "conn-refused" ]]; then
        echo "Error: failed to execute command: HTTP exec failed for container 227 via candidates: https://port-39375-x.example.test, http://x.example.test:39375; last error: request to http://x.example.test:39375/exec failed: Post \"http://x.example.test:39375/exec\": dial tcp 192.0.2.10:39375: connect: connection refused" >&2
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

# Focused harness assertion: prove the generated BASH_ENV virtual clock does
# not accrue real wall time. A real one-second CommandBuiltin sleep must not
# advance SECONDS; the fake sleep must advance it by exactly its duration.
clock_focus() {
  (
    cd "${tmp_dir}"
    BASH_ENV="${tmp_dir}/bash_env" bash -s <<'FOCUS_EOF'
set -euo pipefail
before="${SECONDS:-0}"
command sleep 1
after="${SECONDS:-0}"
if (( after != before )); then
  echo "FAIL: real \`command sleep 1\` advanced the virtual clock by $((after - before))s" >&2
  exit 1
fi
sleep 3
if (( SECONDS != before + 3 )); then
  echo "FAIL: fake \`sleep 3\` advanced the virtual clock to ${SECONDS}, expected $((before + 3))" >&2
  exit 1
fi
echo "PASS: virtual clock ignores real time; fake sleep advances by exactly three"
FOCUS_EOF
  )
}

# Standalone focus run for TDD: PVE_SMOKE_CLOCK_FOCUS=1 runs only the clock
# assertion and exits, so the change can be proven red-then-green in isolation.
if [[ "${PVE_SMOKE_CLOCK_FOCUS:-}" == "1" ]]; then
  clock_focus || exit 1
  exit 0
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_smoke() {
  local mode="$1"
  local calls_file="$2"
  local start_record="$3"
  local exec_record="$4"
  local curl_record="$5"
  local public_domain="${6:-}"
  local healthz_status="${7:-}"
  local results_file="${8:-${tmp_dir}/results.json}"
  local start_count_file="${9:-}"
  local mktemp_record="${10:-}"
  local exec_record_count="${11:-}"
  (
    cd "${tmp_dir}"
    BASH_ENV="${tmp_dir}/bash_env" \
      DEVSH_MODE="${mode}" \
      DEVSH_CALLS_FILE="${calls_file}" \
      DEVSH_START_RECORD="${start_record}" \
      DEVSH_EXEC_RECORD="${exec_record}" \
      DEVSH_CURL_RECORD="${curl_record}" \
      DEVSH_HEALTHZ_STATUS="${healthz_status}" \
      DEVSH_START_COUNT_FILE="${start_count_file}" \
      DEVSH_MKTEMP_RECORD="${mktemp_record}" \
      DEVSH_EXEC_RECORD_COUNT="${exec_record_count}" \
      PVE_PUBLIC_DOMAIN="${public_domain}" \
      bash "${runtime_dir}/pve-lxc-snapshot-runtime-smoke.sh" "${results_file}"
  )
}

record_field() {
  local record_file="$1"
  local field="$2"
  local value=""
  if [[ -f "${record_file}" ]]; then
    value="$(sed -n "s/^${field}=//p" "${record_file}" | head -n 1)"
  fi
  printf '%s' "${value}"
}

echo "=== PVE LXC snapshot runtime-smoke deadline tests ==="

clock_focus

calls_file="${tmp_dir}/calls.success"
start_record="${tmp_dir}/start.success"
exec_record="${tmp_dir}/exec.success"
if ! success_output="$(run_smoke fail-then-succeed "${calls_file}" "${start_record}" "${exec_record}" "${tmp_dir}/curl.success" 2>&1)"; then
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
exec_count_file="${tmp_dir}/exec.deadline.count"
if deadline_output="$(run_smoke always-fail "${calls_file}" "${tmp_dir}/start.deadline" "${tmp_dir}/exec.deadline" "${tmp_dir}/curl.deadline" "" "" "" "" "" "${exec_count_file}" 2>&1)"; then
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
deadline_token_path="$(record_field "${tmp_dir}/start.deadline" path)"
if [[ -z "${deadline_token_path}" || -e "${deadline_token_path}" ]]; then
  fail "temporary token file was not removed after readiness failure"
fi
exec_recordings="0"
if [[ -f "${exec_count_file}" ]]; then
  IFS= read -r exec_recordings <"${exec_count_file}" || true
fi
if [[ "${exec_recordings}" != "1" ]]; then
  fail "exec token state was recorded ${exec_recordings} times across 200 probes (expected exactly 1)"
fi

echo "PASS: readiness probes honor the 600-second deadline"

calls_file="${tmp_dir}/calls.token"
if token_output="$(run_smoke token-fetch-fail "${calls_file}" "${tmp_dir}/start.token" "${tmp_dir}/exec.token" "${tmp_dir}/curl.token" 2>&1)"; then
  printf '%s\n' "${token_output}" >&2
  fail "runtime smoke must fail when the execd auth token cannot be fetched"
fi
if [[ "${token_output}" != *"could not fetch the execd auth token"* ]]; then
  fail "token-fetch failure lost its diagnostic: ${token_output}"
fi
if [[ "${token_output}" == *"exec endpoint unreachable (network)"* ]]; then
  fail "token-fetch failure was misclassified as a network failure"
fi
if [[ "${token_output}" == *"execd-token-"* ]]; then
  fail "token-fetch diagnostic still references template token persistence"
fi

echo "PASS: token-fetch failures are classified distinctly from network failures"

calls_file="${tmp_dir}/calls.edge"
if edge_output="$(run_smoke edge-502 "${calls_file}" "${tmp_dir}/start.edge" "${tmp_dir}/exec.edge" "${tmp_dir}/curl.edge" 2>&1)"; then
  printf '%s\n' "${edge_output}" >&2
  fail "runtime smoke must fail when the execd edge returns HTTP 502"
fi
if [[ "${edge_output}" != *"execd did not respond (edge/HTTP error)"* ]]; then
  fail "edge failure lost its diagnostic: ${edge_output}"
fi
if [[ "${edge_output}" == *"exec endpoint unreachable (network)"* ]]; then
  fail "edge failure was misclassified as a network failure"
fi

echo "PASS: edge/HTTP failures are classified distinctly from network failures"

calls_file="${tmp_dir}/calls.conn"
if conn_output="$(run_smoke conn-refused "${calls_file}" "${tmp_dir}/start.conn" "${tmp_dir}/exec.conn" "${tmp_dir}/curl.conn" 2>&1)"; then
  printf '%s\n' "${conn_output}" >&2
  fail "runtime smoke must fail when the execd connection is refused"
fi
if [[ "${conn_output}" != *"execd connection failed (refused/DNS/timeout)"* ]]; then
  fail "connection failure lost its diagnostic: ${conn_output}"
fi
if [[ "${conn_output}" == *"exec endpoint unreachable (network)"* ]]; then
  fail "connection failure was misclassified as a network failure"
fi

echo "PASS: connection failures are classified distinctly from network failures"

echo ""
echo "=== PVE LXC snapshot runtime-smoke disposable-token tests ==="

calls_file="${tmp_dir}/calls.tokenlife"
start_record="${tmp_dir}/start.tokenlife"
exec_record="${tmp_dir}/exec.tokenlife"
curl_record="${tmp_dir}/curl.tokenlife"
if ! token_output="$(run_smoke ready "${calls_file}" "${start_record}" "${exec_record}" "${curl_record}" "fake.example.com" "200" 2>&1)"; then
  printf '%s\n' "${token_output}" >&2
  fail "runtime smoke must pass when the clone is ready"
fi

start_path="$(record_field "${start_record}" path)"
start_content="$(record_field "${start_record}" content)"
start_exists="$(record_field "${start_record}" exists)"
start_mode="$(record_field "${start_record}" mode)"
exec_path="$(record_field "${exec_record}" path)"
exec_content="$(record_field "${exec_record}" content)"

if [[ "${start_exists}" != "yes" ]]; then
  fail "token file did not exist when devsh start was invoked"
fi
if [[ -z "${start_path}" ]]; then
  fail "token file path was not recorded at devsh start"
fi
if [[ "${start_path}" == "${tmp_dir}"/* ]]; then
  fail "token file was created inside the results directory"
fi
if [[ "${start_path}" != /* ]]; then
  fail "token file path is not absolute"
fi
if [[ "${start_path##*/}" != cmux-execd-token.snapshot-deadline.* ]]; then
  fail "token file path does not match the disposable mktemp pattern"
fi
if [[ ! "${start_content}" =~ ^[a-f0-9]{64}$ ]]; then
  fail "generated token does not match ^[a-f0-9]{64}$"
fi
if [[ "${start_content}" == "${STALE_TOKEN}" ]]; then
  fail "generated token reuses the stale template token instead of a fresh secret"
fi
if [[ "${start_mode}" != "600" ]]; then
  fail "token file mode is not 0600"
fi
if [[ "${exec_path}" != "${start_path}" || "${exec_content}" != "${start_content}" ]]; then
  fail "devsh exec did not see the same token file/content as devsh start"
fi
if [[ "${token_output}" != *"Healthz status: 200"* ]]; then
  fail "healthz status was not reported: ${token_output}"
fi
if [[ ! -f "${curl_record}" ]]; then
  fail "healthz probe never invoked curl"
fi
if [[ "$(record_field "${curl_record}" args)" != *"/healthz"* ]]; then
  fail "healthz probe did not target the /healthz endpoint"
fi
if [[ "$(record_field "${curl_record}" args)" != *"https://port-39375-pvelxc-deadline.fake.example.com/healthz"* ]]; then
  fail "healthz probe did not use the public execd hostname"
fi
curl_args="$(record_field "${curl_record}" args)"
if [[ "${curl_args}" == *"Authorization"* || "${curl_args}" == *"Bearer"* || "${curl_args}" == *"${start_content}"* ]]; then
  fail "healthz probe carried auth material"
fi
if [[ -e "${start_path}" ]]; then
  fail "token file still exists after the smoke run (EXIT cleanup missing)"
fi
if [[ ! -f "${tmp_dir}/execd-token-snapshot-deadline.txt" ]]; then
  fail "runtime smoke removed the stale template token file instead of ignoring it"
fi

echo "PASS: each clone gets a fresh disposable 0600 token file cleaned up on exit"

calls_file="${tmp_dir}/calls.skipped"
if ! skipped_output="$(run_smoke ready "${calls_file}" "${tmp_dir}/start.skipped" "${tmp_dir}/exec.skipped" "${tmp_dir}/curl.skipped" 2>&1)"; then
  printf '%s\n' "${skipped_output}" >&2
  fail "runtime smoke must pass when no public domain is configured"
fi
if [[ "${skipped_output}" != *"Healthz status: skipped"* ]]; then
  fail "healthz probe was not skipped without a public domain"
fi
if [[ -f "${tmp_dir}/curl.skipped" ]]; then
  fail "healthz curl was invoked without a public domain"
fi

echo "PASS: healthz is skipped when no public domain is available"

echo ""
echo "=== PVE LXC snapshot runtime-smoke cleanup-path tests ==="

# Setup failure: mktemp succeeded but token generation failed. The tracked
# token array must still remove the temporary file via the EXIT trap.
calls_file="${tmp_dir}/calls.genfail"
mktemp_record="${tmp_dir}/mktemp.genfail"
start_count_file="${tmp_dir}/starts.genfail"
if genfail_output="$(run_smoke token-gen-fail "${calls_file}" "${tmp_dir}/start.genfail" "${tmp_dir}/exec.genfail" "${tmp_dir}/curl.genfail" "" "" "${tmp_dir}/results.json" "${start_count_file}" "${mktemp_record}" 2>&1)"; then
  printf '%s\n' "${genfail_output}" >&2
  fail "runtime smoke must fail when token generation fails"
fi
genfail_path="$(record_field "${mktemp_record}" path)"
if [[ -z "${genfail_path}" ]]; then
  fail "token file path was not recorded at mktemp time"
fi
if [[ -e "${genfail_path}" ]]; then
  fail "temporary token file leaked after token generation failure"
fi
if [[ -f "${tmp_dir}/start.genfail" ]]; then
  fail "devsh start was reached despite token generation failure"
fi
if [[ -f "${start_count_file}" ]]; then
  fail "devsh start was invoked despite token generation failure"
fi
if [[ "${genfail_output}" == *"Waiting for exec"* ]]; then
  fail "token generation failure was misreported as a readiness deadline failure"
fi
if [[ "${genfail_output}" == *"Runtime smoke"* ]]; then
  fail "smoke run proceeded past token generation despite the failure"
fi

echo "PASS: EXIT cleanup covers failures between mktemp and devsh start"

# devsh start failure after the token was created.
calls_file="${tmp_dir}/calls.startfail"
if startfail_output="$(run_smoke start-fail "${calls_file}" "${tmp_dir}/start.startfail" "${tmp_dir}/exec.startfail" "${tmp_dir}/curl.startfail" 2>&1)"; then
  printf '%s\n' "${startfail_output}" >&2
  fail "runtime smoke must fail when devsh start fails"
fi
startfail_path="$(record_field "${tmp_dir}/start.startfail" path)"
if [[ -z "${startfail_path}" || -e "${startfail_path}" ]]; then
  fail "temporary token file was not removed after devsh start failure"
fi

echo "PASS: EXIT cleanup removes the token after devsh start failure"

# Two clones: clone 1 succeeds, clone 2 fails at start. The cleanup array
# must handle the second clone's EXIT path without retaining the first
# clone's token, and each clone must have had its own fresh token file.
printf '%s\n' '{"results":[{"presetId":"standard","snapshotId":"snapshot-deadline"},{"presetId":"standard","snapshotId":"snapshot-other"}]}' >"${tmp_dir}/results.two.json"
calls_file="${tmp_dir}/calls.two"
start_count_file="${tmp_dir}/starts.two"
if two_output="$(run_smoke second-start-fails "${calls_file}" "${tmp_dir}/start.two" "${tmp_dir}/exec.two" "${tmp_dir}/curl.two" "" "" "${tmp_dir}/results.two.json" "${start_count_file}" 2>&1)"; then
  printf '%s\n' "${two_output}" >&2
  fail "runtime smoke must fail when the second clone's start fails"
fi
first_path="$(record_field "${tmp_dir}/start.two.1" path)"
first_content="$(record_field "${tmp_dir}/start.two.1" content)"
first_mode="$(record_field "${tmp_dir}/start.two.1" mode)"
second_path="$(record_field "${tmp_dir}/start.two.2" path)"
second_content="$(record_field "${tmp_dir}/start.two.2" content)"
second_mode="$(record_field "${tmp_dir}/start.two.2" mode)"
if [[ -z "${first_path}" || ! "${first_content}" =~ ^[a-f0-9]{64}$ || "${first_mode}" != "600" ]]; then
  fail "first clone did not get a fresh 0600 disposable token"
fi
if [[ -z "${second_path}" || ! "${second_content}" =~ ^[a-f0-9]{64}$ || "${second_mode}" != "600" ]]; then
  fail "second clone did not get a fresh 0600 disposable token"
fi
if [[ "${first_path}" == "${second_path}" || "${first_content}" == "${second_content}" ]]; then
  fail "clones did not get independent disposable token files"
fi
if [[ -e "${first_path}" || -e "${second_path}" ]]; then
  fail "a temporary token file survived the two-snapshot run"
fi
if [[ "${two_output}" != *"PASS: standard (snapshot-deadline)"* ]]; then
  fail "first clone did not pass before the second clone failed"
fi

echo "PASS: two-snapshot EXIT cleanup removes both clones' tokens"
