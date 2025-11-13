#!/usr/bin/env bash
set -euo pipefail

# Standalone notarization script for testing/debugging
# Can be run independently after building to iterate on notarization issues

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/apps/client/dist-electron"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--env-file path] [--artifact path] [--verbose]

Notarizes an already-built macOS DMG/ZIP artifact.

Options:
  --env-file path    Source environment variables from file (default: .env.codesign)
  --artifact path    Path to DMG/ZIP to notarize (default: auto-detect from dist-electron)
  --verbose          Enable verbose notarytool output
  --no-wait          Don't wait for notarization to complete
  --history          Show notarization history instead of submitting

Required env vars:
  APPLE_API_KEY       Apple API key content or file path
  APPLE_API_KEY_ID    Apple API Key ID
  APPLE_API_ISSUER    Apple API Issuer ID (UUID)

EOF
}

ENV_FILE=""
ARTIFACT=""
VERBOSE=false
WAIT_FLAG="--wait"
SHOW_HISTORY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --artifact)
      ARTIFACT="${2:-}"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --no-wait)
      WAIT_FLAG=""
      shift
      ;;
    --history)
      SHOW_HISTORY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Load environment variables
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Env file not found: $ENV_FILE" >&2
    exit 1
  fi
  echo "==> Loading env from $ENV_FILE"
  set -a
  source "$ENV_FILE"
  set +a
elif [[ -f "$ROOT_DIR/.env.codesign" ]]; then
  echo "==> Loading env from .env.codesign"
  set -a
  source "$ROOT_DIR/.env.codesign"
  set +a
fi

# Check required env vars
for var in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

# Prepare API key file if needed
if [[ ! -f "${APPLE_API_KEY}" ]]; then
  echo "==> Preparing API key file"
  TMPDIR_APIKEY="$(mktemp -d)"
  API_KEY_PATH="$TMPDIR_APIKEY/AuthKey_${APPLE_API_KEY_ID}.p8"
  printf "%s" "${APPLE_API_KEY}" | perl -0777 -pe 's/\r\n|\r|\n/\n/g' > "$API_KEY_PATH"
  export APPLE_API_KEY="$API_KEY_PATH"
  echo "    Created: $API_KEY_PATH"
fi

# Build notarytool args
NOTARY_ARGS=(
  "--key" "${APPLE_API_KEY}"
  "--key-id" "${APPLE_API_KEY_ID}"
  "--issuer" "${APPLE_API_ISSUER}"
)

if [[ "$VERBOSE" == "true" ]]; then
  NOTARY_ARGS+=("--verbose")
fi

# Show notarytool version
echo "==> notarytool version: $(xcrun notarytool --version 2>/dev/null || echo 'not found')"

# If showing history, do that and exit
if [[ "$SHOW_HISTORY" == "true" ]]; then
  echo "==> Fetching notarization history"
  xcrun notarytool history "${NOTARY_ARGS[@]}" --output-format json 2>&1 | tee /tmp/notary-history.json
  echo ""
  echo "Full output saved to: /tmp/notary-history.json"
  exit 0
fi

# Find artifact to notarize
if [[ -z "$ARTIFACT" ]]; then
  echo "==> Auto-detecting artifact from $DIST_DIR"
  if compgen -G "$DIST_DIR/*.dmg" > /dev/null; then
    ARTIFACT="$(ls -1 "$DIST_DIR"/*.dmg | head -n1)"
    echo "    Found DMG: $ARTIFACT"
  elif compgen -G "$DIST_DIR/*.zip" > /dev/null; then
    ARTIFACT="$(ls -1 "$DIST_DIR"/*.zip | head -n1)"
    echo "    Found ZIP: $ARTIFACT"
  else
    echo "No DMG or ZIP found in $DIST_DIR" >&2
    echo "Specify artifact with --artifact flag" >&2
    exit 1
  fi
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Artifact not found: $ARTIFACT" >&2
  exit 1
fi

echo "==> Submitting for notarization: $ARTIFACT"
echo "    Size: $(du -h "$ARTIFACT" | cut -f1)"
echo "    MD5: $(md5 -q "$ARTIFACT")"

# Submit for notarization
SUBMIT_OUT_FILE="/tmp/notary-submit-$(date +%s).txt"
echo "==> Running notarytool submit (output will be saved to $SUBMIT_OUT_FILE)"

set +e
xcrun notarytool submit "$ARTIFACT" $WAIT_FLAG --output-format json "${NOTARY_ARGS[@]}" 2>&1 | tee "$SUBMIT_OUT_FILE"
SUBMIT_CODE=$?
set -e

echo ""
echo "==> Exit code: $SUBMIT_CODE"

# Try to extract submission ID for follow-up
SUBMISSION_ID=$(grep -o '"id" *: *"[^"]*"' "$SUBMIT_OUT_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

if [[ -n "$SUBMISSION_ID" ]]; then
  echo "==> Submission ID: $SUBMISSION_ID"
  echo ""
  echo "To check status:"
  echo "  xcrun notarytool info \"$SUBMISSION_ID\" --key \"$APPLE_API_KEY\" --key-id \"$APPLE_API_KEY_ID\" --issuer \"$APPLE_API_ISSUER\""
  echo ""
  echo "To get logs:"
  echo "  xcrun notarytool log \"$SUBMISSION_ID\" --key \"$APPLE_API_KEY\" --key-id \"$APPLE_API_KEY_ID\" --issuer \"$APPLE_API_ISSUER\""
fi

# Check for success
if [[ $SUBMIT_CODE -eq 0 ]] && grep -qi '"status" *: *"Accepted"\|status: Accepted\|Accepted' "$SUBMIT_OUT_FILE"; then
  echo ""
  echo "==> ✅ Notarization ACCEPTED"
  
  # Attempt to staple if it's a DMG
  if [[ "$ARTIFACT" == *.dmg ]]; then
    echo "==> Stapling notarization to DMG"
    xcrun stapler staple "$ARTIFACT" || true
    xcrun stapler validate "$ARTIFACT" || true
  fi
else
  echo ""
  echo "==> ❌ Notarization FAILED or PENDING"
  
  if [[ -n "$SUBMISSION_ID" ]]; then
    echo "==> Attempting to fetch detailed log"
    xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_ARGS[@]}" --output-format text 2>&1 | tee /tmp/notary-log.txt || true
    echo ""
    echo "Log saved to: /tmp/notary-log.txt"
  fi
  
  exit 1
fi