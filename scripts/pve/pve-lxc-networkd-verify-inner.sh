set -euo pipefail

iface="${CMUX_NET_IFACE:-eth0}"

net_file="$(
  networkctl status "${iface}" --no-pager 2>/dev/null \
    | awk -F': ' '/Network File/ {print $2; exit}' \
    | tr -d '\r'
)"
if [ -z "${net_file}" ]; then
  echo "FAIL: could not determine Network File for ${iface}" >&2
  networkctl status "${iface}" --no-pager 2>/dev/null || true
  exit 1
fi

base="$(basename "${net_file}")"
drop_file="/etc/systemd/network/${base}.d/99-cmux-dhcp.conf"
if [ ! -f "${drop_file}" ]; then
  echo "FAIL: expected networkd drop-in missing: ${drop_file}" >&2
  echo "Base network file: ${net_file}" >&2
  ls -la "/etc/systemd/network/${base}.d" 2>/dev/null || true
  exit 1
fi

if ! grep -Eiq '^SendHostname[[:space:]]*=[[:space:]]*yes[[:space:]]*$' "${drop_file}"; then
  echo "FAIL: drop-in does not contain SendHostname=yes: ${drop_file}" >&2
  sed -n '1,200p' "${drop_file}" >&2 || true
  exit 1
fi
if ! grep -Eiq '^UseDNS[[:space:]]*=[[:space:]]*no[[:space:]]*$' "${drop_file}"; then
  echo "FAIL: drop-in does not contain UseDNS=no: ${drop_file}" >&2
  sed -n '1,200p' "${drop_file}" >&2 || true
  exit 1
fi

if ! command -v systemd-analyze >/dev/null 2>&1; then
  echo "FAIL: systemd-analyze not found" >&2
  exit 1
fi

cfg="$(SYSTEMD_PAGER=cat systemd-analyze cat-config "${net_file}" 2>/dev/null || true)"
if [ -z "${cfg}" ]; then
  echo "FAIL: systemd-analyze cat-config produced no output for ${net_file}" >&2
  exit 1
fi

if ! echo "${cfg}" | grep -Eiq 'SendHostname[[:space:]]*=[[:space:]]*yes'; then
  echo "FAIL: SendHostname=yes missing from effective config (${net_file})" >&2
  echo "--- cat-config (${net_file}) ---" >&2
  echo "${cfg}" >&2
  exit 1
fi

if ! echo "${cfg}" | grep -Eiq 'UseDNS[[:space:]]*=[[:space:]]*no'; then
  echo "FAIL: UseDNS=no missing from effective config (${net_file})" >&2
  echo "--- cat-config (${net_file}) ---" >&2
  echo "${cfg}" >&2
  exit 1
fi

echo "PASS: networkd DHCP config ok (${iface} via ${net_file})"
