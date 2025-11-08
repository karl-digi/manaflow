import type { CreateTerminalTabRequest } from "@/queries/terminals";

const CLOUD_TMUX_BOOTSTRAP_SCRIPT = `set -euo pipefail
SESSION="cmux"
WORKSPACE_ROOT="/root/workspace"
ensure_session() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    return
  fi

  tmux new-session -d -s "$SESSION" -c "$WORKSPACE_ROOT" -n "main"
  tmux rename-window -t "$SESSION:1" "main" >/dev/null 2>&1 || true
  tmux new-window -t "$SESSION:" -n "maintenance" -c "$WORKSPACE_ROOT"
  tmux new-window -t "$SESSION:" -n "dev" -c "$WORKSPACE_ROOT"
}
ensure_session

tmux select-window -t "$SESSION:main" >/dev/null 2>&1 || true
exec tmux attach -t "$SESSION"`;

const STANDARD_ATTACH_SCRIPT = `set -euo pipefail
tmux select-window -t cmux:0 >/dev/null 2>&1 || true
exec tmux attach -t cmux`;

export function buildTmuxAttachRequest(
  isCloudWorkspace?: boolean | null
): CreateTerminalTabRequest {
  return {
    cmd: "bash",
    args: ["-lc", isCloudWorkspace ? CLOUD_TMUX_BOOTSTRAP_SCRIPT : STANDARD_ATTACH_SCRIPT],
  };
}

