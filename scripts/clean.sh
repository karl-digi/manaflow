#!/usr/bin/env bash
set -euo pipefail

# Wipe local install/build artifacts. Does not reinstall unless --install.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=0
FORCE=0
FRESH=0
INSTALL=0
SKIP_DEV_STOP=0
TARGET="."
BACKUP_ROOT="${CMUX_ENV_BACKUP_ROOT:-}"
ENV_BACKUP_DIR=""

PRESERVE_ENV_FILES=(
  ".env"
  ".env.local"
  ".env.production"
  ".envrc"
  "packages/convex/.env.local"
  "packages/convex/.env.convex"
  "packages/cloudrouter/cmux-devbox-lite/.env"
)

ARTIFACT_DIR_NAMES=(
  node_modules
  target
  .next
  .turbo
  .pytest_cache
  dist
  dist-ssr
  dist-electron
  out
  .venv
  .tanstack
  .wrangler
  .playwright-cli
  .worktrees
  .chrome-debug-profile
  .pnpm-store
  __pycache__
  tmp
  logs
)

show_help() {
  cat <<EOF
Usage: $0 [options] [path]

Delete local install and build artifacts. Dependencies are not reinstalled
unless you pass --install.

Options:
  -n, --dry-run        Show what would be removed. Do not delete.
  -f, --force          Skip the interactive confirmation prompt.
      --fresh          Make the checkout look like a git clone (git clean -fdx).
                       Keeps .env / .env.local / .env.production and other local
                       env files via backup + restore.
      --install        After cleaning, run bun install --frozen-lockfile.
      --backup-env DIR Extra env backup directory (default: .git/cmux-env-backup).
      --skip-dev-stop  Do not run scripts/cleanup-dev.sh first.
  -h, --help           Show this help.

Examples:
  bun run clean                # remove node_modules and other artifacts
  bun run clean:fresh          # clone-like tree, keep env files, no install
  $0 --fresh --install         # clone-like tree, then reinstall deps
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -f|--force) FORCE=1; shift ;;
    --fresh) FRESH=1; shift ;;
    --install) INSTALL=1; shift ;;
    --backup-env)
      BACKUP_ROOT="${2:-}"
      if [[ -z "$BACKUP_ROOT" ]]; then
        echo "--backup-env requires a directory" >&2
        exit 1
      fi
      shift 2
      ;;
    --skip-dev-stop) SKIP_DEV_STOP=1; shift ;;
    -h|--help) show_help; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2
      show_help
      exit 1
      ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [[ "$FRESH" -eq 1 && "$TARGET" != "." ]]; then
  echo "--fresh always runs against the repository root. Ignore extra path: $TARGET" >&2
fi

resolve_backup_root() {
  if [[ -n "$BACKUP_ROOT" ]]; then
    printf '%s\n' "$BACKUP_ROOT"
    return
  fi
  local git_dir
  git_dir="$(git -C "$REPO_ROOT" rev-parse --git-dir)"
  git_dir="$(cd "$REPO_ROOT" && cd "$git_dir" && pwd)"
  printf '%s\n' "$git_dir/cmux-env-backup"
}

human_from_kb() {
  awk -v k="$1" 'BEGIN {
    if (k >= 1048576) printf "%.1fG", k / 1048576
    else if (k >= 1024) printf "%.1fM", k / 1024
    else printf "%sK", k
  }'
}

confirm_or_exit() {
  local prompt="$1"
  if [[ "$FORCE" -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    echo "Non-interactive shell detected. Proceeding without confirmation."
    return 0
  fi
  local response=""
  read -r -p "$prompt [y/N]: " response
  if [[ "$response" =~ ^[yY](es)?$ ]]; then
    return 0
  fi
  echo "Cleanup cancelled by user."
  exit 0
}

stop_dev_servers() {
  if [[ "$SKIP_DEV_STOP" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if [[ -f "$REPO_ROOT/scripts/cleanup-dev.sh" ]]; then
    echo "Stopping local dev-server processes..."
    bash "$REPO_ROOT/scripts/cleanup-dev.sh" || true
    echo ""
  fi
}

copy_env_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp -p "$src" "$dest"
  if ! cmp -s "$src" "$dest"; then
    echo "Copy mismatch: $dest" >&2
    exit 1
  fi
}

backup_env_files() {
  local stamp backup_dir manifest copied src dest
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="$(resolve_backup_root)/$stamp"
  ENV_BACKUP_DIR="$backup_dir"
  mkdir -p "$backup_dir"
  manifest="$backup_dir/MANIFEST.txt"
  {
    echo "repo=$REPO_ROOT"
    echo "head=$(git -C "$REPO_ROOT" rev-parse HEAD)"
    echo "stamp=$stamp"
  } >"$manifest"

  copied=0
  echo "Preserving env files in $backup_dir"
  for rel in "${PRESERVE_ENV_FILES[@]}"; do
    src="$REPO_ROOT/$rel"
    if [[ ! -f "$src" ]]; then
      continue
    fi
    dest="$backup_dir/$rel"
    copy_env_file "$src" "$dest"
    echo "copied $rel sha256=$(shasum -a 256 "$dest" | awk '{print $1}')" >>"$manifest"
    copied=$((copied + 1))
  done
  echo "Backed up $copied env file(s)."
  echo ""
}

restore_env_from() {
  local backup_dir="$1"
  local rel src dest restored
  restored=0
  echo "Restoring env files"
  for rel in "${PRESERVE_ENV_FILES[@]}"; do
    src="$backup_dir/$rel"
    dest="$REPO_ROOT/$rel"
    if [[ ! -f "$src" ]]; then
      continue
    fi
    copy_env_file "$src" "$dest"
    restored=$((restored + 1))
  done
  echo "Restored $restored env file(s)."
  echo "Env backup kept at: $backup_dir"
  echo ""
}

restore_on_exit() {
  if [[ -n "${ENV_BACKUP_DIR:-}" ]]; then
    restore_env_from "$ENV_BACKUP_DIR"
    ENV_BACKUP_DIR=""
  fi
}

maybe_install() {
  local announce="${1:-}"
  if [[ "$INSTALL" -ne 1 ]]; then
    if [[ "$announce" == "announce" ]]; then
      echo "Skipped bun install. Run bun install when you need a working tree."
    fi
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry-run: would run bun install --frozen-lockfile"
    return 0
  fi
  if ! command -v bun >/dev/null 2>&1; then
    echo "bun is not on PATH; cannot --install." >&2
    exit 1
  fi
  echo "Installing dependencies..."
  (cd "$REPO_ROOT" && bun install --frozen-lockfile)
}

artifact_name_regex() {
  local name
  local parts=()
  for name in "${ARTIFACT_DIR_NAMES[@]}"; do
    parts+=("${name//./\\.}")
  done
  local IFS="|"
  printf '^(%s)$' "${parts[*]}"
}

collect_artifact_dirs() {
  local dir regex
  regex="$(artifact_name_regex)"
  if command -v fd >/dev/null 2>&1; then
    while IFS= read -r -d '' dir; do
      CLEAN_DIRS+=("$dir")
    done < <(fd -HI -t d --prune -0 --exclude .git --exclude dev-docs "$regex" "$TARGET")
  else
    local find_names=()
    local name
    for name in "${ARTIFACT_DIR_NAMES[@]}"; do
      find_names+=(-o -name "$name")
    done
    find_names=("${find_names[@]:1}")
    while IFS= read -r -d '' dir; do
      CLEAN_DIRS+=("$dir")
    done < <(find "$TARGET" \( -name .git -o -name dev-docs \) -prune -o -type d \( "${find_names[@]}" \) -prune -print0)
  fi
}

collect_artifact_files() {
  local file
  while IFS= read -r -d '' file; do
    CLEAN_FILES+=("$file")
  done < <(find "$TARGET" \( -name .git -o -name dev-docs -o -name node_modules \) -prune -o -type f -name '*.tsbuildinfo' -print0)
}

print_size_list() {
  local path size_kb
  local total_kb=0
  for path in "${CLEAN_DIRS[@]+"${CLEAN_DIRS[@]}"}"; do
    if [[ -d "$path" ]]; then
      size_kb="$(du -sk "$path" | awk '{print $1}')"
      total_kb=$((total_kb + size_kb))
      echo "  [DIR]  $path ($(human_from_kb "$size_kb"))"
    fi
  done
  for path in "${CLEAN_FILES[@]+"${CLEAN_FILES[@]}"}"; do
    if [[ -f "$path" ]]; then
      size_kb="$(du -sk "$path" | awk '{print $1}')"
      total_kb=$((total_kb + size_kb))
      echo "  [FILE] $path ($(human_from_kb "$size_kb"))"
    fi
  done
  echo ""
  if [[ "$total_kb" -ge 1048576 ]]; then
    echo "Estimated total space to reclaim: $(human_from_kb "$total_kb")"
  elif [[ "$total_kb" -ge 1024 ]]; then
    echo "Estimated total space to reclaim: $((total_kb / 1024)) MB"
  else
    echo "Estimated total space to reclaim: ${total_kb} KB"
  fi
}

delete_paths() {
  local cores=1
  if command -v nproc >/dev/null 2>&1; then
    cores="$(nproc)"
  elif command -v sysctl >/dev/null 2>&1; then
    cores="$(sysctl -n hw.ncpu)"
  fi
  if [[ ${#CLEAN_DIRS[@]} -gt 0 ]]; then
    printf "%s\0" "${CLEAN_DIRS[@]}" | xargs -0 -n 1 -P "$cores" rm -rf -- || true
    local dir
    for dir in "${CLEAN_DIRS[@]}"; do
      if [[ -d "$dir" ]]; then
        rm -rf -- "$dir"
      fi
    done
  fi
  local file
  for file in "${CLEAN_FILES[@]+"${CLEAN_FILES[@]}"}"; do
    if [[ -f "$file" ]]; then
      rm -f -- "$file"
    fi
  done
}

clean_artifacts() {
  echo "=== CMUX Dev Disk Rescue ==="
  echo "Mode:    artifacts (no git clean, no reinstall unless --install)"
  echo "Target:  $TARGET"
  echo ""

  CLEAN_DIRS=()
  CLEAN_FILES=()
  collect_artifact_dirs
  collect_artifact_files

  echo "Discovered items to clean:"
  if [[ ${#CLEAN_DIRS[@]} -eq 0 && ${#CLEAN_FILES[@]} -eq 0 ]]; then
    echo "  No files or directories need cleaning."
    echo "Nothing to do. Exiting."
    maybe_install
    return 0
  fi
  print_size_list
  echo ""

  confirm_or_exit "Delete these install/build artifacts without reinstalling?"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry-run mode active. No files were deleted."
    maybe_install
    return 0
  fi

  stop_dev_servers
  echo "Cleaning up items..."
  delete_paths
  echo "Cleanup complete. node_modules and other artifacts removed."
  maybe_install announce
}

list_top_level_untracked() {
  local name
  while IFS= read -r name; do
    [[ -z "$name" || "$name" == ".git" ]] && continue
    if [[ -d "$REPO_ROOT/$name" ]]; then
      du -sk "$REPO_ROOT/$name" 2>/dev/null | awk -v n="$name/" '{printf "%s\t%s\n", $1, n}'
    elif [[ -e "$REPO_ROOT/$name" ]]; then
      du -sk "$REPO_ROOT/$name" 2>/dev/null | awk -v n="$name" '{printf "%s\t%s\n", $1, n}'
    fi
  done < <(
    {
      git -C "$REPO_ROOT" ls-files -o --directory --exclude-standard
      git -C "$REPO_ROOT" ls-files -o -i --directory --exclude-standard
    } | sed 's|/$||' | awk -F/ 'NF == 1 && $1 != "" && $1 != "." && !seen[$1]++ { print $1 }'
  ) | awk '{
      kb=$1; $1=""
      sub(/^ /, "", $0)
      n=$0
      if (kb >= 1048576) h=sprintf("%.1fG", kb/1048576)
      else if (kb >= 1024) h=sprintf("%.1fM", kb/1024)
      else h=sprintf("%sK", kb)
      printf "%s\t%s\n", h, n
    }'
}

clean_fresh() {
  echo "=== CMUX clone-fresh reset ==="
  echo "Mode:    git clean -fdx (keep env files, no reinstall unless --install)"
  echo "Repo:    $REPO_ROOT"
  echo "Branch:  $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  echo ""

  if [[ ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ]]; then
    echo "Refusing --fresh: $REPO_ROOT is not a git checkout." >&2
    exit 1
  fi
  if [[ -d "$REPO_ROOT/.git/rebase-merge" || -d "$REPO_ROOT/.git/rebase-apply" || -f "$REPO_ROOT/.git/MERGE_HEAD" ]]; then
    echo "Refusing --fresh: rebase or merge in progress." >&2
    exit 1
  fi

  echo "Env files that will be kept:"
  local rel
  for rel in "${PRESERVE_ENV_FILES[@]}"; do
    if [[ -f "$REPO_ROOT/$rel" ]]; then
      echo "  keep  $rel"
    else
      echo "  miss  $rel"
    fi
  done
  echo ""
  echo "Top-level untracked/ignored paths git clean -fdx would remove:"
  list_top_level_untracked
  echo ""
  echo "git clean -fdx also deletes ignored files inside tracked directories"
  echo "(nested node_modules, Rust target, dist, .next, .venv, logs, ...)."
  echo ""

  confirm_or_exit "Reset this checkout to a just-cloned tree and keep env files?"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry-run: git clean -ndx (not executed)."
    maybe_install
    return 0
  fi

  stop_dev_servers
  backup_env_files
  trap restore_on_exit EXIT

  echo "git clean -fdxq"
  set +e
  git -C "$REPO_ROOT" clean -fdxq
  git_clean_status=$?
  set -e
  if [[ "$git_clean_status" -ne 0 ]]; then
    echo "git clean exited $git_clean_status; sweeping leftover artifact dirs."
    TARGET="$REPO_ROOT"
    CLEAN_DIRS=()
    CLEAN_FILES=()
    collect_artifact_dirs
    if [[ ${#CLEAN_DIRS[@]} -gt 0 ]]; then
      delete_paths
    fi
  fi

  restore_on_exit
  trap - EXIT
  echo "Clone-fresh cleanup complete. node_modules is gone until you install."
  maybe_install announce
}

if [[ "$FRESH" -eq 1 ]]; then
  clean_fresh
else
  clean_artifacts
fi
