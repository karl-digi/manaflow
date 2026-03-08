#!/usr/bin/env bash
set -euo pipefail

id="${1:-}"

if [[ -z "${id}" ]]; then
  echo "Usage: $0 <instance-id>" >&2
  exit 2
fi

if ! command -v devsh >/dev/null 2>&1; then
  echo "ERROR: devsh not found on PATH" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
inner_path="${script_dir}/pve-lxc-networkd-verify-inner.sh"

if [[ ! -f "${inner_path}" ]]; then
  echo "ERROR: missing inner script: ${inner_path}" >&2
  exit 2
fi

inner="$(cat "${inner_path}")"
remote_cmd="$(cat <<EOF
set -euo pipefail
tmp="/tmp/cmux-networkd-verify.sh"
cat >"\${tmp}" <<'CMUX_NETWORKD_VERIFY_EOF'
${inner}
CMUX_NETWORKD_VERIFY_EOF
set +e
/bin/bash "\${tmp}"
rc=\$?
set -e
rm -f "\${tmp}" || true
exit "\${rc}"
EOF
)"

devsh exec "${id}" "${remote_cmd}"
