#!/usr/bin/env bash
# setup-orca-agent-home.sh — migrate allowlist root→/home/orca, wire workspace gh (G1/G2), B1 symlinks.
# Run: devsh exec <id> 'bash -s' < scripts/pve/setup-orca-agent-home.sh
#
# Idempotent attach recipe for long-lived LXC boxes that were mirrored to /root
# (pre-orca-serve). Mirrors the devsh --orca-serve post-start composition
# (packages/devsh/internal/cli/orca_serve.go): B1 ensure → migrate allowlist →
# workspace gh → agent matrix. Never copies auth.json, never gh auth login as
# orca, never sets HOME=/root for orca.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root inside the container (devsh exec <id> 'bash -s' < this script)" >&2
  exit 1
fi

ORCA=orca
ORCA_HOME=/home/orca

# Run a command as orca with the orca home. su/sudo do not reliably reset HOME
# to the target user's home here, and HOME=/root is forbidden for orca
# (Chromium SIGTRAP), so set it explicitly.
orca_run() {
  sudo -u "$ORCA" env HOME="$ORCA_HOME" bash -lc "$1"
}

echo "== setup-orca-agent-home: B1 ensure =="
# 1) B1 ensure (idempotent): system user nologin, sudoers, traversal perms,
#    home symlinks, npm prefix ~/.local, git safe.directory.
id "$ORCA" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$ORCA"
echo "orca ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/orca
chmod 440 /etc/sudoers.d/orca
chmod 755 /root
[ -d /root/workspace ] && chmod 755 /root/workspace || true
[ -d /root/wiki ] && chmod 755 /root/wiki || true
ln -sfn /root "$ORCA_HOME/root-home"
ln -sfn /root/workspace "$ORCA_HOME/workspace"
ln -sfn /root/wiki "$ORCA_HOME/wiki"
chown -h "$ORCA:$ORCA" "$ORCA_HOME/root-home" "$ORCA_HOME/workspace" "$ORCA_HOME/wiki"
# shellcheck disable=SC2016 # $HOME expands inside the container's bash -lc, not here
orca_run 'mkdir -p "$HOME/.local/bin" "$HOME/.local/lib/node_modules"; if command -v npm >/dev/null 2>&1; then npm config set prefix "$HOME/.local"; fi'
# Link bun-installed agent CLIs (claude, gemini, opencode, etc.) into orca PATH
# bun installs to /root/.bun/bin/ which is not on orca's PATH by default
echo "[B1] Linking bun-installed CLIs to /home/orca/.local/bin..."
for cli in /root/.bun/bin/*; do
    name=$(basename "$cli")
    [ "$name" = "bun" ] && continue
    [ "$name" = "bunx" ] && continue
    ln -sfn "$cli" "$ORCA_HOME/.local/bin/$name"
done
chown -h "$ORCA:$ORCA" "$ORCA_HOME/.local/bin/"* 2>/dev/null || true
orca_run 'git config --global --add safe.directory /root/workspace; git config --global --add safe.directory /root/wiki; git config --global --add safe.directory /root'

echo "== setup-orca-agent-home: migrate allowlist root -> /home/orca =="
# 2) Migrate the mirrorlocal.DefaultIncludePaths allowlist from /root to
#    /home/orca. Secret basenames (auth.json, credentials) and sqlite/db files
#    are excluded at copy time — never copied, even nested inside allowlist
#    dirs. Ownership lands on orca:orca.
mkdir -p "$ORCA_HOME"
ALLOWLIST=(
  .claude/settings.json
  .claude/config.json
  .claude/keybindings.json
  .claude/skills
  .claude/hooks
  .claude/commands
  .codex/config.toml
  .codex/keybindings.json
  .codex/AGENTS.md
  .codex/skills
  .codex/hooks
  .codex/automations
)
for p in "${ALLOWLIST[@]}"; do
  if [ -e "/root/$p" ]; then
    mkdir -p "$ORCA_HOME/$(dirname "$p")"
    tar -C /root -cf - \
      --exclude=auth.json --exclude=.credentials.json --exclude=credentials.json \
      --exclude='*.sqlite' --exclude='*.sqlite3' --exclude='*.db' \
      --exclude='*.lock' --exclude='*.wal' --exclude='*.shm' \
      "$p" | tar -C "$ORCA_HOME" -xf -
    echo "  migrated /root/$p"
  else
    echo "  skip /root/$p (absent)"
  fi
done
chown -R "$ORCA:$ORCA" "$ORCA_HOME/.claude" "$ORCA_HOME/.codex" 2>/dev/null || true

echo "== setup-orca-agent-home: workspace gh for orca (G1 helper + G2 wrapper) =="
# 3) G1: orca's global git config delegates to root's workspace gh via a
#    sudo -n credential helper. G2: optional ~/.local/bin/gh wrapper so `gh`
#    on orca's PATH behaves like root's gh. Never `gh auth login` as orca.
orca_run 'git config --global credential.https://github.com.helper "!sudo -n /usr/bin/gh auth git-credential"'
orca_run 'git config --global credential.https://gist.github.com.helper "!sudo -n /usr/bin/gh auth git-credential"'
install -d "$ORCA_HOME/.local/bin"
printf '%s\n' '#!/bin/sh' 'exec sudo -n /usr/bin/gh "$@"' > "$ORCA_HOME/.local/bin/gh"
chmod 755 "$ORCA_HOME/.local/bin/gh"
chown "$ORCA:$ORCA" "$ORCA_HOME/.local/bin/gh"

echo "== setup-orca-agent-home: agent matrix =="
# 4) Detection matrix (same as devsh BuildAgentMatrixCommand).
echo "-- binaries on orca PATH --"
for b in claude codex grok gh; do
  if p=$(orca_run "command -v $b" 2>/dev/null); then
    echo "ok   $b: $p"
  else
    echo "miss $b"
  fi
done
echo "-- mirrored config under /home/orca --"
for p in .claude .codex; do
  if [ -e "$ORCA_HOME/$p" ]; then
    echo "ok   $ORCA_HOME/$p"
  else
    echo "miss $ORCA_HOME/$p"
  fi
done
echo "-- gh via workspace root default --"
if [ -f /root/.config/gh/hosts.yml ]; then
  echo "ok   root gh hosts present; orca delegates via sudo -n gh"
  sudo -n /usr/bin/gh auth status 2>&1 | head -5 || true
else
  echo "warn root gh not configured"
fi
echo "-- agent auth files (absent unless device-auth done as orca) --"
for f in "$ORCA_HOME/.claude/auth.json" "$ORCA_HOME/.codex/auth.json"; do
  if [ -e "$f" ]; then
    echo "note $f present"
  else
    echo "ok   $f absent"
  fi
done

echo
echo "Claude/Codex API auth: use device-auth as orca if needed (mirror redacts auth.json)"
echo "gh: uses workspace root via sudo -n gh — do not gh auth login as orca"
