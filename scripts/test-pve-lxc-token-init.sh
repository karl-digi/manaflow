#!/bin/bash
# Contract test for cmux-token-init token rotation and clone-specific override.
#
# Usage: bash scripts/test-pve-lxc-token-init.sh
#
# Copies the canonical configs/systemd/bin/cmux-token-init into a temporary
# fake root (rewriting only its absolute token-file paths into that root),
# puts controlled cat/openssl executables first in PATH, and verifies:
#   1. A fresh clone boot ID rotates the token when no override exists.
#   2. An explicit CMUX_EXECD_AUTH_TOKEN wins over rotation and is mirrored.
#   3. A matching boot ID with an existing token skips regeneration.
#   4. The canonical script retains the /proc/1/environ fallback lookup.
#
# The live Proxmox `env` integration is exercised by the weekly snapshot
# smoke clone; this test keeps the generator hermetic.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_SCRIPT="$REPO_ROOT/configs/systemd/bin/cmux-token-init"

# Synthetic 64-hex-char fixtures (never real tokens).
TEMPLATE_TOKEN="0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e"
ROTATED_TOKEN="1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f"
OVERRIDE_TOKEN="abababababababababababababababababababababababababababababababab"
TEMPLATE_BOOT_ID="template-boot"
CLONE_BOOT_ID="clone-boot"

FAKE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FAKE_ROOT"' EXIT

mkdir -p "$FAKE_ROOT/bin" "$FAKE_ROOT/root" "$FAKE_ROOT/home/user"

# Controlled executables placed first in PATH.
cat > "$FAKE_ROOT/bin/cat" <<'EOF'
#!/bin/bash
# Controlled cat: returns a fixed boot ID for the kernel boot_id file and
# delegates everything else to the real cat.
if [[ "${1:-}" = "/proc/sys/kernel/random/boot_id" ]]; then
    printf '%s\n' "${FAKE_BOOT_ID:-clone-boot}"
    exit 0
fi
exec /bin/cat "$@"
EOF
chmod +x "$FAKE_ROOT/bin/cat"

cat > "$FAKE_ROOT/bin/openssl" <<'EOF'
#!/bin/bash
# Controlled openssl: emits a fixed 64-hex token instead of random data.
printf '%s' "${FAKE_OPENSSL_TOKEN:-1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f}"
EOF
chmod +x "$FAKE_ROOT/bin/openssl"

# Copy the canonical script, replacing only its absolute token-file paths.
sed -e "s|/root/|$FAKE_ROOT/root/|g" -e "s|/home/user/|$FAKE_ROOT/home/user/|g" \
    "$CANONICAL_SCRIPT" > "$FAKE_ROOT/cmux-token-init"
chmod +x "$FAKE_ROOT/cmux-token-init"

# Existing template state with boot ID "template-boot".
seed_template_state() {
    printf '%s' "$TEMPLATE_TOKEN" > "$FAKE_ROOT/root/.worker-auth-token"
    printf '%s' "$TEMPLATE_TOKEN" > "$FAKE_ROOT/root/.vscode-token"
    printf '%s' "$TEMPLATE_BOOT_ID" > "$FAKE_ROOT/root/.token-boot-id"
    printf '%s' "$TEMPLATE_TOKEN" > "$FAKE_ROOT/home/user/.worker-auth-token"
    printf '%s' "$TEMPLATE_TOKEN" > "$FAKE_ROOT/home/user/.vscode-token"
    printf '%s' "$TEMPLATE_BOOT_ID" > "$FAKE_ROOT/home/user/.token-boot-id"
}

run_token_init() {
    local boot_id="${1:-$CLONE_BOOT_ID}"
    local override="${2:-}"
    (
        cd "$FAKE_ROOT"
        export PATH="$FAKE_ROOT/bin:$PATH"
        export FAKE_BOOT_ID="$boot_id"
        export FAKE_OPENSSL_TOKEN="$ROTATED_TOKEN"
        if [[ -n "$override" ]]; then
            export CMUX_EXECD_AUTH_TOKEN="$override"
        else
            unset CMUX_EXECD_AUTH_TOKEN
        fi
        "$FAKE_ROOT/cmux-token-init"
    )
}

failures=0

assert_file_equals() {
    local file="$1"
    local expected="$2"
    local actual
    if [[ ! -f "$file" ]]; then
        echo "FAIL: missing $file (expected: $expected)"
        failures=$((failures + 1))
        return
    fi
    actual="$(cat "$file")"
    if [[ "$actual" != "$expected" ]]; then
        echo "FAIL: $file content mismatch"
        echo "  expected: $expected"
        echo "  actual:   $actual"
        failures=$((failures + 1))
    else
        echo "PASS: $file"
    fi
}

echo "== [1/4] Clone boot ID rotates token when no override exists =="
seed_template_state
run_token_init "$CLONE_BOOT_ID"
expected="$ROTATED_TOKEN"
assert_file_equals "$FAKE_ROOT/root/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/root/.vscode-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.vscode-token" "$expected"
assert_file_equals "$FAKE_ROOT/root/.token-boot-id" "$CLONE_BOOT_ID"

echo ""
echo "== [2/4] Explicit CMUX_EXECD_AUTH_TOKEN wins over rotation and is mirrored =="
seed_template_state
run_token_init "$CLONE_BOOT_ID" "$OVERRIDE_TOKEN"
expected="$OVERRIDE_TOKEN"
assert_file_equals "$FAKE_ROOT/root/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/root/.vscode-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.vscode-token" "$expected"

echo ""
echo "== [3/4] Matching boot ID preserves existing tokens when no override exists =="
seed_template_state
run_token_init "$TEMPLATE_BOOT_ID"
expected="$TEMPLATE_TOKEN"
assert_file_equals "$FAKE_ROOT/root/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/root/.vscode-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.worker-auth-token" "$expected"
assert_file_equals "$FAKE_ROOT/home/user/.vscode-token" "$expected"

echo ""
echo "== [4/4] Canonical script retains the /proc/1/environ fallback lookup =="
if grep -Fq '/proc/1/environ' "$CANONICAL_SCRIPT"; then
    echo "PASS: canonical script reads /proc/1/environ"
else
    echo "FAIL: canonical script does not read /proc/1/environ"
    failures=$((failures + 1))
fi

echo ""
if [[ "$failures" -gt 0 ]]; then
    echo "FAILED: $failures assertion(s) failed"
    exit 1
fi
echo "All token-init contract assertions passed."
