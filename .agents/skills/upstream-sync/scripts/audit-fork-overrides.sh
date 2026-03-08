#!/usr/bin/env bash
set -euo pipefail

RANGE="${1:-origin/main...HEAD}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

if ! git diff --name-only "$RANGE" -- >/dev/null 2>&1; then
  echo "Error: invalid git range '$RANGE'." >&2
  echo "Usage: $0 [<range>]  # example: $0 origin/main...HEAD" >&2
  exit 1
fi

get_env_value() {
  local env_file="$1"
  local key="$2"

  if [ ! -f "$env_file" ]; then
    echo ""
    return 0
  fi

  # Only used for non-secret keys. Do NOT reuse this for API keys or tokens.
  local line
  line="$(rg -m1 "^${key}=" "$env_file" 2>/dev/null || true)"
  if [ -z "$line" ]; then
    echo ""
    return 0
  fi

  echo "${line#${key}=}"
}

print_env_cues() {
  local dev_protocol prod_protocol dev_base prod_base
  dev_protocol="$(get_env_value ".env" "NEXT_PUBLIC_CMUX_PROTOCOL")"
  prod_protocol="$(get_env_value ".env.production" "NEXT_PUBLIC_CMUX_PROTOCOL")"
  dev_base="$(get_env_value ".env" "BASE_APP_URL")"
  prod_base="$(get_env_value ".env.production" "BASE_APP_URL")"

  echo "### Env cues (sanitized)"
  echo "- \`.env\`: NEXT_PUBLIC_CMUX_PROTOCOL=${dev_protocol:-<unset>}, BASE_APP_URL=${dev_base:-<unset>}"
  echo "- \`.env.production\`: NEXT_PUBLIC_CMUX_PROTOCOL=${prod_protocol:-<unset>}, BASE_APP_URL=${prod_base:-<unset>}"
}

print_heading() {
  echo "## Fork override / rebrand audit (\`$RANGE\`)"
  echo
}

findings_p2=0
findings_p3=0
findings_info=0

note_p2() {
  findings_p2=$((findings_p2 + 1))
  echo "- P2: $1"
}

note_p3() {
  findings_p3=$((findings_p3 + 1))
  echo "- P3: $1"
}

note_info() {
  findings_info=$((findings_info + 1))
  echo "- INFO: $1"
}

check_proxy_regex_has_com() {
  local file="$1"
  if [ ! -f "$file" ]; then
    note_info "Missing file: \`$file\` (skipped)"
    return 0
  fi

  local line
  line="$(rg -n "\\(\\?:app\\|.*localhost\\)" "$file" | head -n1 || true)"
  if [ -z "$line" ]; then
    note_info "Could not locate proxy hostname regex in \`$file\`; review manually"
    return 0
  fi

  if [[ "$line" != *"|com|"* && "$line" != *"|com"* ]]; then
    note_p2 "Proxy hostname regex in \`$file\` appears to omit \`com\` TLD; .manaflow.com-style URLs may not parse correctly"
  fi
}

check_comment_signature_matchers() {
  local file="packages/convex/convex/github_pr_comments.ts"
  if [ ! -f "$file" ]; then
    note_info "Missing file: \`$file\` (skipped)"
    return 0
  fi

  if ! rg -q "COMMENT_SIGNATURE_MATCHERS" "$file"; then
    note_info "\`COMMENT_SIGNATURE_MATCHERS\` not found in \`$file\`; review signature matching logic manually"
    return 0
  fi

  # P2: without legacy cmux.dev UTM variants, existing bot comments may not be detected,
  # leading to duplicate PR comments instead of updates.
  if ! rg -q "cmux\\.dev\\?" "$file"; then
    note_p2 "\`$file\` lacks legacy cmux.dev UTM signature matcher(s); old PR comments may be duplicated instead of updated"
  fi

  # Not always required, but forks typically want this configurable to avoid hardcoding upstream domains.
  if rg -q "const CMUX_BASE_URL = \"https://manaflow\\.com\"" "$file"; then
    note_p3 "\`$file\` hardcodes \`https://manaflow.com\`; consider making the signature base URL configurable (for fork domains)"
  fi
}

check_preview_urls_hardcoded_manaflow() {
  local file
  for file in \
    "packages/convex/convex/preview_jobs_http.ts" \
    "packages/convex/convex/previewScreenshots.ts"; do
    if [ ! -f "$file" ]; then
      note_info "Missing file: \`$file\` (skipped)"
      continue
    fi
    if rg -q "www\\.manaflow\\.com" "$file"; then
      note_p3 "\`$file\` references \`www.manaflow.com\`; consider using \`BASE_APP_URL\` from env for fork deployments"
    fi
  done
}

extract_first_match() {
  local pattern="$1"
  local file="$2"
  rg -o -m1 "$pattern" "$file" 2>/dev/null || true
}

check_electron_partition_drift() {
  local index_file="apps/client/electron/main/index.ts"
  local bootstrap_file="apps/client/electron/main/bootstrap.ts"

  if [ ! -f "$index_file" ] || [ ! -f "$bootstrap_file" ]; then
    note_info "Electron partition check skipped (missing files)"
    return 0
  fi

  local index_partition bootstrap_partition
  index_partition="$(extract_first_match "persist:[^\"]+" "$index_file")"
  bootstrap_partition="$(extract_first_match "persist:[^\"]+" "$bootstrap_file")"

  if [ -z "$index_partition" ] || [ -z "$bootstrap_partition" ]; then
    note_info "Could not extract Electron partition strings; review \`$index_file\` and \`$bootstrap_file\` manually"
    return 0
  fi

  if [ "$index_partition" != "$bootstrap_partition" ]; then
    note_p3 "Electron partition drift: \`$index_file\` uses \`$index_partition\` but \`$bootstrap_file\` uses \`$bootstrap_partition\`"
  fi
}

check_electron_host_mismatch() {
  local index_file="apps/client/electron/main/index.ts"
  local comments_file="apps/client/src/components/cmux-comments.tsx"

  if [ ! -f "$index_file" ] || [ ! -f "$comments_file" ]; then
    note_info "Electron host check skipped (missing files)"
    return 0
  fi

  local index_has_cmux comments_has_cmux comments_has_manaflow
  if rg -q "\"cmux\\.local\"" "$index_file"; then
    index_has_cmux=1
  else
    index_has_cmux=0
  fi
  if rg -q "\"cmux\\.local\"" "$comments_file"; then
    comments_has_cmux=1
  else
    comments_has_cmux=0
  fi
  if rg -q "\"manaflow\\.local\"" "$comments_file"; then
    comments_has_manaflow=1
  else
    comments_has_manaflow=0
  fi

  if [ "$index_has_cmux" -eq 1 ] && [ "$comments_has_cmux" -eq 0 ] && [ "$comments_has_manaflow" -eq 1 ]; then
    note_p3 "Electron hostname mismatch: \`$index_file\` uses \`cmux.local\` but \`$comments_file\` only checks \`manaflow.local\`"
  fi
}

check_hardcoded_manaflow_scheme() {
  local matches
  matches="$(rg -n "manaflow://" apps packages 2>/dev/null | head -n 20 || true)"
  if [ -n "$matches" ]; then
    note_p3 "Found hardcoded \`manaflow://\` deep link scheme references (prefer \`NEXT_PUBLIC_CMUX_PROTOCOL\` in fork)"
    echo
    echo "  Evidence (first 20 matches):"
    echo '```'
    echo "$matches"
    echo '```'
  fi
}

check_branch_prefix_hardcoded() {
  local file
  for file in \
    "apps/server/src/utils/branchNameGenerator.ts" \
    "apps/www/lib/utils/branch-name-generator.ts" \
    "apps/www/lib/routes/branch.route.ts"; do
    if [ ! -f "$file" ]; then
      continue
    fi
    if rg -q "manaflow/" "$file"; then
      note_p3 "\`$file\` appears to hardcode \`manaflow/\` branch prefix; ensure fork prefix behavior is preserved"
    fi
  done
}

check_devsh_module_path() {
  local go_mod="packages/devsh/go.mod"
  local npm_pkg="packages/devsh/npm/devsh/package.json"

  if [ ! -f "$go_mod" ]; then
    note_info "Missing file: \`$go_mod\` (skipped)"
  else
    if ! rg -q "^module github\\.com/karlorz/devsh" "$go_mod"; then
      note_p2 "\`$go_mod\` does not use fork Go module path \`github.com/karlorz/devsh\`; upstream may have overwritten fork customization"
    fi
  fi

  if [ ! -f "$npm_pkg" ]; then
    note_info "Missing file: \`$npm_pkg\` (skipped)"
  else
    if ! rg -q "\"author\":\\s*\"karlorz\"" "$npm_pkg"; then
      note_p2 "\`$npm_pkg\` author is not \`karlorz\`; upstream may have overwritten fork customization"
    fi
    if ! rg -q "\"name\":\\s*\"devsh\"" "$npm_pkg"; then
      note_p2 "\`$npm_pkg\` package name changed from \`devsh\`; upstream may have renamed back to cmux-devbox"
    fi
  fi
}

check_electron_build_scripts() {
  local local_build="scripts/build-electron-local.sh"
  local prod_build="scripts/build-electron-prod.sh"
  local fork_config="apps/client/electron-builder.fork.json"
  local fork_local_config="apps/client/electron-builder.fork.local.json"
  local dmg_script="scripts/build-prod-mac-arm64-no-notarize-or-sign.sh"
  local client_pkg="apps/client/package.json"

  if [ ! -f "$fork_config" ] || [ ! -f "$fork_local_config" ]; then
    note_p3 "Electron fork config JSON missing (\`$fork_config\` / \`$fork_local_config\`); fork builds may fall back to upstream defaults"
  fi

  if [ -f "$local_build" ] && ! rg -q "build:mac:workaround" "$local_build"; then
    note_p3 "\`$local_build\` does not run \`build:mac:workaround\`; verify it still uses the fork packaging flow"
  fi

  if [ -f "$prod_build" ] && ! rg -q "build:mac:workaround" "$prod_build"; then
    note_p3 "\`$prod_build\` does not run \`build:mac:workaround\`; verify it still uses the fork packaging flow"
  fi

  if [ -f "$client_pkg" ] && ! rg -q "\"build:mac:workaround\"" "$client_pkg"; then
    note_p3 "\`$client_pkg\` missing \`build:mac:workaround\` script; local Electron build scripts may break"
  fi

  if [ -f "$dmg_script" ] && ! rg -q -- "--config electron-builder\\.fork\\.local\\.json" "$dmg_script"; then
    note_p3 "\`$dmg_script\` does not use \`electron-builder.fork.local.json\`; verify fork \`appId\`/protocol/productName are preserved"
  fi
}

print_heading
print_env_cues
echo
echo "### Findings (treat P2 as merge gates)"

check_comment_signature_matchers
check_proxy_regex_has_com "packages/shared/src/components/environment/utils.ts"
check_proxy_regex_has_com "apps/www/components/preview/preview-configure-client.tsx"
check_preview_urls_hardcoded_manaflow
check_electron_partition_drift
check_electron_host_mismatch
check_hardcoded_manaflow_scheme
check_branch_prefix_hardcoded
check_electron_build_scripts
check_devsh_module_path

if [ "$findings_p2" -eq 0 ] && [ "$findings_p3" -eq 0 ] && [ "$findings_info" -eq 0 ]; then
  echo "- None."
fi

echo
echo "### Follow-up checklist"
if [ "$findings_p2" -eq 0 ] && [ "$findings_p3" -eq 0 ]; then
  echo "- [ ] No rebrand override follow-up required for this sync range."
else
  echo "- [ ] Fix all P2 findings or explicitly mark not applicable with evidence."
  echo "- [ ] Review P3 findings and decide whether to align fork configuration now."
fi
