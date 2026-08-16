#!/bin/bash
# cmux-lxc-execd-token-hook.sh - PVE LXC pre-start hookscript for cmux execd
# token injection on hosts that reject the container `env` config option.
#
# PVE 9.1+ (pve-container 6.0.15+) supports setting the LXC runtime env via
# the config endpoint's `env` parameter; older hosts (e.g. PVE 8) reject it
# with HTTP 400. On those hosts devsh falls back to writing the per-clone
# token into the container description as a cmux-execd-auth-token=<hex>
# marker. This script is inherited from the base template's hookscript
# config (the API forbids non-root@pam callers from setting it), so devsh
# only writes the description marker. PVE invokes it at pre-start, after
# generating /var/lib/lxc/<vmid>/config and before boot, so appending
# `lxc.environment = CMUX_EXECD_AUTH_TOKEN=<token>` here lands in the
# container's /proc/1/environ where the in-container cmux-token-init reads it.
#
# PVE invokes hookscripts as:  <script> <vmid> <phase>
# Phases include pre-start, post-start, pre-stop, post-stop; only pre-start
# is handled here.
#
# Config paths (both overridable so tests can run against temp dirs):
#   PVE_LXC_CONF_DIR   = /etc/pve/lxc   (container .conf files)
#   LXC_RUN_CONFIG_DIR = /var/lib/lxc   (generated container configs)
#
# Fail-open by design: any internal error is logged to stderr (PVE captures
# hook output in the task log) and the hook exits 0, so a broken hook can
# never block a container boot.
#
# Staging instructions: scripts/pve/README.md.
set -euo pipefail

PVE_LXC_CONF_DIR="${PVE_LXC_CONF_DIR:-/etc/pve/lxc}"
LXC_RUN_CONFIG_DIR="${LXC_RUN_CONFIG_DIR:-/var/lib/lxc}"

log() {
  echo "cmux-lxc-execd-token-hook: $*" >&2
}

# Fail-open insurance: a nonzero exit (e.g. an unexpected failure under
# set -e) is logged and converted to exit 0 so PVE never sees a hook failure
# as a failed boot.
# shellcheck disable=SC2329 # invoked via the EXIT trap below; shellcheck does not track trap references
fail_open() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    log "internal error (exit $rc); failing open"
  fi
  exit 0
}
trap fail_open EXIT

apply() {
  local vmid="$1" phase="$2"
  local conf_path target token

  if [[ "$phase" != "pre-start" ]]; then
    exit 0
  fi
  if [[ ! "$vmid" =~ ^[0-9]+$ ]]; then
    log "invalid vmid '$vmid'; skipping"
    exit 0
  fi

  conf_path="$PVE_LXC_CONF_DIR/$vmid.conf"
  if [[ ! -f "$conf_path" ]]; then
    log "container config $conf_path not found; skipping"
    exit 0
  fi

  # First marker match only; devsh writes it via the container description.
  token="$(grep -oE 'cmux-execd-auth-token=[a-f0-9]{64}' "$conf_path" | head -n 1 || true)"
  token="${token#cmux-execd-auth-token=}"
  if [[ -z "$token" ]]; then
    # Container is not managed by this mechanism.
    exit 0
  fi
  if [[ ! "$token" =~ ^[a-f0-9]{64}$ ]]; then
    log "invalid execd token marker in $conf_path; skipping"
    exit 0
  fi

  target="$LXC_RUN_CONFIG_DIR/$vmid/config"
  if [[ ! -f "$target" ]]; then
    log "generated LXC config $target not found; skipping"
    exit 0
  fi
  if grep -qs 'CMUX_EXECD_AUTH_TOKEN' "$target"; then
    # Insurance against double-fires; PVE regenerates the config each start.
    exit 0
  fi

  printf '%s\n' "lxc.environment = CMUX_EXECD_AUTH_TOKEN=$token" >> "$target"
}

apply "$@"
exit 0