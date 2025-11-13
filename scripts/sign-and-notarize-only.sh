#!/usr/bin/env bash
set -euo pipefail

# Sign and notarize an already-built Mac app
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Load environment
if [[ -f "$ROOT_DIR/.env.codesign" ]]; then
  set -a
  source "$ROOT_DIR/.env.codesign"
  set +a
else
  echo "Error: .env.codesign not found" >&2
  exit 1
fi

# Check for required env vars
for k in MAC_CERT_BASE64 MAC_CERT_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  if [[ -z "${!k:-}" ]]; then 
    echo "Error: Missing required env var: $k" >&2
    exit 1
  fi
done

# Skip build if app already exists
APP_PATH="$CLIENT_DIR/dist-electron/mac-arm64/cmux.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "==> App not found, building app bundle..."
  bash "$ROOT_DIR/scripts/build-electron-prod.sh"
else
  echo "==> Using existing app at: $APP_PATH"
fi

# Find the app
APP_PATH="$CLIENT_DIR/dist-electron/mac-arm64/cmux.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: App not found at $APP_PATH" >&2
  exit 1
fi

echo "==> Found app at: $APP_PATH"

# Prepare certificate
echo "==> Preparing certificate..."
TMPDIR_CERT="$(mktemp -d)"
CERT_PATH="$TMPDIR_CERT/mac_signing_cert.p12"
node -e "process.stdout.write(Buffer.from(process.env.MAC_CERT_BASE64,'base64'))" > "$CERT_PATH"

# Import certificate to keychain
echo "==> Importing certificate to keychain..."
KEYCHAIN_NAME="cmux-signing-$(uuidgen).keychain"
KEYCHAIN_PATH="/tmp/$KEYCHAIN_NAME"
security create-keychain -p "" "$KEYCHAIN_PATH"
security unlock-keychain -p "" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "$MAC_CERT_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN_PATH"

# Sign the app
echo "==> Signing app..."
bash "$ROOT_DIR/scripts/prepare-macos-entitlements.sh" || true

codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Manaflow, Inc. (7WLXT3NR37)" \
  --keychain "$KEYCHAIN_PATH" \
  --timestamp \
  --options runtime \
  --entitlements "$CLIENT_DIR/build/entitlements.mac.plist" \
  "$APP_PATH"

echo "==> Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

# Create ZIP for notarization
echo "==> Creating ZIP for notarization..."
ZIP_PATH="$CLIENT_DIR/dist-electron/cmux-notarize.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

# Prepare Apple API key
TMPDIR_APIKEY="$(mktemp -d)"
API_KEY_PATH="$TMPDIR_APIKEY/AuthKey_${APPLE_API_KEY_ID}.p8"
printf "%s" "${APPLE_API_KEY}" | perl -0777 -pe 's/\r\n|\r|\n/\n/g' > "$API_KEY_PATH"

# Submit for notarization
echo "==> Submitting for notarization..."
SUBMISSION_ID=$(xcrun notarytool submit "$ZIP_PATH" \
  --key "$API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --wait \
  --output-format json | jq -r '.id')

echo "Submission ID: $SUBMISSION_ID"

# Wait for notarization
echo "==> Waiting for notarization..."
xcrun notarytool wait "$SUBMISSION_ID" \
  --key "$API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER"

# Check status
STATUS=$(xcrun notarytool info "$SUBMISSION_ID" \
  --key "$API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --output-format json | jq -r '.status')

if [[ "$STATUS" == "Accepted" ]]; then
  echo "==> Notarization successful!"
  
  # Staple the app
  echo "==> Stapling notarization..."
  xcrun stapler staple "$APP_PATH"
  
  echo "==> Verifying stapling..."
  xcrun stapler validate "$APP_PATH"
  
  echo "==> Final Gatekeeper check..."
  spctl -a -t exec -vv "$APP_PATH"
  
  echo "==> SUCCESS! App is signed and notarized at: $APP_PATH"
else
  echo "==> Notarization failed with status: $STATUS"
  echo "Getting log..."
  xcrun notarytool log "$SUBMISSION_ID" \
    --key "$API_KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER"
  exit 1
fi

# Cleanup
security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
rm -f "$CERT_PATH" "$API_KEY_PATH" "$ZIP_PATH"
