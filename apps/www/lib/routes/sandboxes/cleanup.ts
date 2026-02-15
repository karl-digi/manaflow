/**
 * Commands to clean up the VM before snapshotting/freezing/pausing.
 *
 * IMPORTANT: We must kill all user processes (especially dev servers) to avoid
 * port conflicts when the VM is restored.
 */

/**
 * Common dev server ports to force-kill processes on.
 * This is a safeguard in case process name matching misses something.
 */
const DEV_PORTS = [3000, 3001, 3002, 3003, 4000, 5000, 5173, 5174, 8000, 8080, 8888];

/**
 * PTY server URL - used to kill terminal sessions
 */
const PTY_SERVER_URL = "http://localhost:39383";

export const VM_CLEANUP_COMMANDS = [
  // Step 1: Kill all PTY sessions via cmux-pty server (VS Code terminals)
  // Get all session PIDs and kill them, then delete the sessions
  `for pid in $(curl -sf ${PTY_SERVER_URL}/sessions 2>/dev/null | jq -r '.sessions[].pid' 2>/dev/null); do kill -9 $pid 2>/dev/null; done || true`,
  `curl -sf ${PTY_SERVER_URL}/sessions 2>/dev/null | jq -r '.sessions[].id' 2>/dev/null | xargs -I {} curl -sf -X DELETE ${PTY_SERVER_URL}/sessions/{} 2>/dev/null || true`,
  // Step 2: Kill all processes running in tmux panes (fallback for tmux backend)
  "for pid in $(tmux list-panes -a -F '#{pane_pid}' 2>/dev/null); do pkill -9 -P $pid 2>/dev/null; kill -9 $pid 2>/dev/null; done || true",
  "tmux kill-server 2>/dev/null || true",
  // Step 3: Kill any remaining dev processes by name
  "pkill -9 -u root node 2>/dev/null || true",
  "pkill -9 -u root bun 2>/dev/null || true",
  "pkill -9 -u root vite 2>/dev/null || true",
  "pkill -9 -u root esbuild 2>/dev/null || true",
  "pkill -9 -u root next 2>/dev/null || true",
  "pkill -9 -u root python 2>/dev/null || true",
  "pkill -9 -u root python3 2>/dev/null || true",
  // Step 4: Nuclear option - kill ANY process listening on common dev ports
  ...DEV_PORTS.map((port) => `fuser -k ${port}/tcp 2>/dev/null || true`),
].join(" && ");

/**
 * Commands to clean up credentials before snapshotting.
 * These are separate from process cleanup since they're only needed for snapshots,
 * not for regular pause operations.
 */
export const CREDENTIAL_CLEANUP_COMMANDS = [
  "git config --global --unset user.name 2>/dev/null || true",
  "git config --global --unset user.email 2>/dev/null || true",
  "git config --global --unset credential.helper 2>/dev/null || true",
  "git credential-cache exit 2>/dev/null || true",
  "gh auth logout 2>/dev/null || true",
].join(" && ");

/**
 * Commands to clean up browser lock files before snapshotting.
 *
 * Chrome/Chromium stores hostname-specific lock files (SingletonLock, SingletonSocket,
 * SingletonCookie) that contain the container hostname. When a snapshot is taken and
 * cloned to a new container with a different hostname, Chrome refuses to start because
 * it thinks another process is using the profile.
 *
 * This cleanup removes these stale lock files to allow Chrome to start fresh on cloned
 * containers.
 */
export const BROWSER_LOCK_CLEANUP_COMMANDS = [
  // Stop Chrome/Chromium processes first
  "pkill -9 chrome 2>/dev/null || true",
  "pkill -9 chromium 2>/dev/null || true",
  // Clean up Chrome lock files (various profile locations)
  "rm -f /root/.config/chrome/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/chrome/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/chrome/SingletonCookie 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonCookie 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonCookie 2>/dev/null || true",
  // Clean up any Chrome crash dumps that might reference old hostname
  "rm -rf /root/.config/chrome/Crash\\ Reports/* 2>/dev/null || true",
  "rm -rf /root/.config/google-chrome/Crash\\ Reports/* 2>/dev/null || true",
  "rm -rf /root/.config/chromium/Crash\\ Reports/* 2>/dev/null || true",
].join(" && ");

/**
 * Full cleanup commands for snapshotting (processes + credentials + browser locks).
 */
export const SNAPSHOT_CLEANUP_COMMANDS = `${VM_CLEANUP_COMMANDS} && ${CREDENTIAL_CLEANUP_COMMANDS} && ${BROWSER_LOCK_CLEANUP_COMMANDS}`;

/**
 * Commands to clean stale browser lock files on container boot.
 * This is a subset of BROWSER_LOCK_CLEANUP_COMMANDS that only removes lock files
 * without killing Chrome (since Chrome may not be running yet on boot).
 *
 * This handles the case where a snapshot was created with stale lock files
 * from a previous container hostname.
 */
export const BROWSER_LOCK_CLEANUP_ON_BOOT = [
  // Clean up Chrome lock files (various profile locations)
  // These contain hostname-specific data that prevents Chrome from starting on cloned containers
  "rm -f /root/.config/chrome/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/chrome/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/chrome/SingletonCookie 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/google-chrome/SingletonCookie 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonLock 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonSocket 2>/dev/null || true",
  "rm -f /root/.config/chromium/SingletonCookie 2>/dev/null || true",
].join(" && ");

/**
 * Commands to restart cmux services after a VM resume.
 *
 * When a VM is paused after running VM_CLEANUP_COMMANDS, the services
 * (cmux-xterm, cmux-ide, etc.) are killed. On resume, systemd doesn't
 * automatically restart them since the state was frozen. This command
 * restarts the cmux target to bring all services back up.
 *
 * Also cleans stale browser lock files that may exist in snapshots from
 * previous container hostnames.
 */
export const VM_RESTART_SERVICES_COMMANDS = [
  // Clean stale browser lock files before starting services
  BROWSER_LOCK_CLEANUP_ON_BOOT,
  // Restart the cmux target which includes all cmux services
  "systemctl restart cmux.target",
].join(" && ");
