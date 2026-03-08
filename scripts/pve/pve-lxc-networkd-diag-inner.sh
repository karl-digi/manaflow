set -euo pipefail

iface="${CMUX_NET_IFACE:-eth0}"

echo "=== CMUX PVE-LXC systemd-networkd diagnostics ==="
echo "timestamp: $(date -Is 2>/dev/null || date)"
echo "iface: ${iface}"
echo ""

echo "=== /etc/systemd/network/eth0.network ==="
if [ -f /etc/systemd/network/eth0.network ]; then
  sed -n '1,200p' /etc/systemd/network/eth0.network
else
  echo "(missing)"
fi
echo ""

echo "=== /etc/systemd/network (tree) ==="
ls -la /etc/systemd/network 2>/dev/null || true
find /etc/systemd/network -maxdepth 2 -type f -print 2>/dev/null | sort || true
echo ""

echo "=== networkctl status ${iface} ==="
networkctl status "${iface}" --no-pager 2>/dev/null || true
echo ""

net_file="$(
  networkctl status "${iface}" --no-pager 2>/dev/null \
    | awk -F': ' '/Network File/ {print $2; exit}' \
    | tr -d '\r'
)"
if [ -n "${net_file}" ]; then
  echo "network_file: ${net_file}"
else
  echo "network_file: (not detected)"
fi
echo ""

if [ -n "${net_file}" ]; then
  base="$(basename "${net_file}")"
  drop_file="/etc/systemd/network/${base}.d/99-cmux-dhcp.conf"
  echo "=== expected drop-in (${drop_file}) ==="
  if [ -f "${drop_file}" ]; then
    sed -n '1,200p' "${drop_file}"
  else
    echo "(missing)"
  fi
  echo ""
fi

echo "=== systemd-analyze cat-config systemd/network ==="
if command -v systemd-analyze >/dev/null 2>&1; then
  SYSTEMD_PAGER=cat systemd-analyze cat-config systemd/network 2>/dev/null || true
else
  echo "(systemd-analyze not found)"
fi
echo ""

if [ -n "${net_file}" ] && command -v systemd-analyze >/dev/null 2>&1; then
  echo "=== systemd-analyze cat-config ${net_file} ==="
  SYSTEMD_PAGER=cat systemd-analyze cat-config "${net_file}" 2>/dev/null || true
  echo ""
fi

echo "=== /etc/resolv.conf ==="
if [ -f /etc/resolv.conf ]; then
  sed -n '1,200p' /etc/resolv.conf
else
  echo "(missing)"
fi
echo ""

echo "=== journalctl -u systemd-networkd -n 200 ==="
journalctl -u systemd-networkd --no-pager -n 200 2>/dev/null || true
