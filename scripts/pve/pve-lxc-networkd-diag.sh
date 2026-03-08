#!/usr/bin/env bash
set -euo pipefail

id="${1:-}"
out="${2:-}"

if [[ -z "${id}" ]]; then
  echo "Usage: $0 <instance-id> [output-file]" >&2
  exit 2
fi

if ! command -v devsh >/dev/null 2>&1; then
  echo "ERROR: devsh not found on PATH" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
inner_path="${script_dir}/pve-lxc-networkd-diag-inner.sh"

if [[ ! -f "${inner_path}" ]]; then
  echo "ERROR: missing inner script: ${inner_path}" >&2
  exit 2
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "${out}" ]]; then
  out="logs/pve-lxc-networkd/diag.runtime.${id}.${timestamp}.txt"
fi

mkdir -p "$(dirname -- "${out}")"

inner="$(cat "${inner_path}")"
remote_cmd="$(cat <<EOF
set -euo pipefail
tmp="/tmp/cmux-networkd-diag.sh"
cat >"\${tmp}" <<'CMUX_NETWORKD_DIAG_EOF'
${inner}
CMUX_NETWORKD_DIAG_EOF
set +e
/bin/bash "\${tmp}"
rc=\$?
set -e
rm -f "\${tmp}" || true
exit "\${rc}"
EOF
)"

set +e
output="$(devsh exec "${id}" "${remote_cmd}" 2>&1)"
rc=$?
set -e

printf '%s\n' "${output}" > "${out}"

if [[ $rc -ne 0 ]]; then
  echo "ERROR: diagnostics failed for ${id} (exit ${rc})" >&2
  echo "Saved: ${out}" >&2
  exit "${rc}"
fi

echo "Saved: ${out}"
