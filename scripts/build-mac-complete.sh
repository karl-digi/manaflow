#!/usr/bin/env bash
set -euo pipefail

# Complete Mac build script: build, sign, create DMG, and notarize
# This replaces the problematic electron-builder process with a working solution

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"
DIST_DIR="$CLIENT_DIR/dist-electron"

echo "=========================================="
echo "Complete Mac ARM64 Build & Notarization"
echo "=========================================="

# Load environment
if [[ -f "$ROOT_DIR/.env.codesign" ]]; then
  echo "==> Loading codesign environment..."
  set -a
  source "$ROOT_DIR/.env.codesign"
  set +a
else
  echo "Warning: .env.codesign not found, building unsigned" >&2
fi

# Check for signing capability
HAS_SIGNING=true
for k in MAC_CERT_BASE64 MAC_CERT_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  if [[ -z "${!k:-}" ]]; then HAS_SIGNING=false; fi
done

# Step 1: Clean previous builds
echo ""
echo "==> Step 1: Cleaning previous builds..."
rm -rf "$DIST_DIR"

# Step 2: Install dependencies
echo ""
echo "==> Step 2: Installing dependencies..."
cd "$ROOT_DIR"
bun install --frozen-lockfile

# Step 3: Prepare entitlements and generate icons
echo ""
echo "==> Step 3: Preparing entitlements and generating icons..."
cd "$ROOT_DIR"
bash "$ROOT_DIR/scripts/prepare-macos-entitlements.sh" || true
cd "$CLIENT_DIR"
bun run ./scripts/generate-icons.mjs

# Step 4: Build the app
echo ""
echo "==> Step 4: Building Electron app..."
bash "$ROOT_DIR/scripts/build-electron-prod.sh"

# Get version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Building version: $VERSION"

APP_PATH="$DIST_DIR/mac-arm64/cmux.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: App build failed - not found at $APP_PATH" >&2
  exit 1
fi

echo "App built successfully at: $APP_PATH"

# Step 5: Sign the app (if credentials available)
if [[ "$HAS_SIGNING" == "true" ]]; then
  echo ""
  echo "==> Step 5: Signing app..."
  
  # Prepare certificate
  TMPDIR_CERT="$(mktemp -d)"
  CERT_PATH="$TMPDIR_CERT/mac_signing_cert.p12"
  node -e "process.stdout.write(Buffer.from(process.env.MAC_CERT_BASE64,'base64'))" > "$CERT_PATH"
  
  # Import to temporary keychain
  KEYCHAIN_NAME="cmux-signing-$(uuidgen).keychain"
  KEYCHAIN_PATH="/tmp/$KEYCHAIN_NAME"
  security create-keychain -p "" "$KEYCHAIN_PATH"
  security unlock-keychain -p "" "$KEYCHAIN_PATH"
  security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "$MAC_CERT_PASSWORD" -T /usr/bin/codesign
  security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN_PATH"
  
  # Sign the app
  codesign --deep --force --verify --verbose \
    --sign "Developer ID Application: Manaflow, Inc. (7WLXT3NR37)" \
    --keychain "$KEYCHAIN_PATH" \
    --timestamp \
    --options runtime \
    --entitlements "$CLIENT_DIR/build/entitlements.mac.plist" \
    "$APP_PATH"
  
  echo "Verifying signature..."
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  
  # Cleanup keychain
  security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
  rm -f "$CERT_PATH"
  
  echo "✓ App signed successfully"
else
  echo ""
  echo "==> Step 5: Skipping signing (no credentials)"
fi

# Step 6: Create DMG
echo ""
echo "==> Step 6: Creating DMG..."
DMG_PATH="$DIST_DIR/cmux-${VERSION}-arm64.dmg"

# Check if create-dmg is available
if command -v create-dmg &> /dev/null; then
  create-dmg \
    --volname "cmux" \
    --window-pos 200 120 \
    --window-size 800 400 \
    --icon-size 100 \
    --icon "cmux.app" 200 190 \
    --hide-extension "cmux.app" \
    --app-drop-link 600 190 \
    "$DMG_PATH" \
    "$APP_PATH"
else
  # Fallback to hdiutil, auto-sizing to content to avoid space errors
  echo "create-dmg not found, using hdiutil..."

  VOL_NAME="cmux"
  # Overwrite any existing DMG
  rm -f "$DMG_PATH"

  # Create compressed DMG directly from the app folder (auto-sized)
  hdiutil create -volname "$VOL_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"
fi

# Sign the DMG
if [[ "$HAS_SIGNING" == "true" ]]; then
  echo "Signing DMG..."
  codesign --force --sign "Developer ID Application: Manaflow, Inc. (7WLXT3NR37)" "$DMG_PATH"
fi

echo "✓ DMG created: $DMG_PATH"

# Step 7: Create ZIP for distribution
echo ""
echo "==> Step 7: Creating ZIP..."
ZIP_PATH="$DIST_DIR/cmux-${VERSION}-arm64-mac.zip"
cd "$DIST_DIR/mac-arm64"
ditto -c -k --sequesterRsrc --keepParent "cmux.app" "$ZIP_PATH"
echo "✓ ZIP created: $ZIP_PATH"

# Step 8: Notarize (if credentials available)
if [[ "$HAS_SIGNING" == "true" ]]; then
  echo ""
  echo "==> Step 8: Submitting for notarization..."
  
  # Prepare Apple API key
  TMPDIR_APIKEY="$(mktemp -d)"
  API_KEY_PATH="$TMPDIR_APIKEY/AuthKey_${APPLE_API_KEY_ID}.p8"
  printf "%s" "${APPLE_API_KEY}" | perl -0777 -pe 's/\r\n|\r|\n/\n/g' > "$API_KEY_PATH"
  
  # Submit DMG for notarization
  echo "Submitting DMG for notarization..."
  SUBMISSION_OUTPUT=$(xcrun notarytool submit "$DMG_PATH" \
    --key "$API_KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait \
    --timeout 30m \
    --output-format json 2>&1)
  
  SUBMISSION_ID=$(echo "$SUBMISSION_OUTPUT" | jq -r '.id' 2>/dev/null || echo "unknown")
  STATUS=$(echo "$SUBMISSION_OUTPUT" | jq -r '.status' 2>/dev/null || echo "unknown")
  
  echo "Submission ID: $SUBMISSION_ID"
  echo "Status: $STATUS"
  
  if [[ "$STATUS" == "Accepted" ]]; then
    echo "✓ Notarization successful!"
    
    # Staple the notarization
    echo "Stapling notarization to DMG..."
    xcrun stapler staple "$DMG_PATH" || true
    
    echo "Stapling notarization to app..."
    xcrun stapler staple "$APP_PATH" || true
    
    # Re-create the ZIP with stapled app
    echo "Re-creating ZIP with stapled app..."
    cd "$DIST_DIR/mac-arm64"
    ditto -c -k --sequesterRsrc --keepParent "cmux.app" "$ZIP_PATH"
    
    echo "✓ Notarization complete and stapled"
  elif [[ "$STATUS" == "In Progress" ]]; then
    echo "⏳ Notarization in progress. Check status with:"
    echo "   ./scripts/notary-wait.sh $SUBMISSION_ID"
  else
    echo "⚠️  Notarization status: $STATUS"
    echo "Check logs with:"
    echo "   xcrun notarytool log $SUBMISSION_ID --key $API_KEY_PATH --key-id $APPLE_API_KEY_ID --issuer $APPLE_API_ISSUER"
  fi
  
  # Cleanup
  rm -f "$API_KEY_PATH"
else
  echo ""
  echo "==> Step 8: Skipping notarization (no credentials)"
fi

# Summary
echo ""
echo "=========================================="
echo "Build Complete!"
echo "=========================================="
echo "Version: $VERSION"
echo "Architecture: arm64"
echo ""
echo "Artifacts created:"
echo "  • App: $APP_PATH"
echo "  • DMG: $DMG_PATH"
echo "  • ZIP: $ZIP_PATH"
echo ""

if [[ "$HAS_SIGNING" == "true" ]]; then
  echo "Signing: ✓ Signed with Developer ID"
  echo "Notarization: Submitted (check status with ./scripts/notary-status.sh)"
else
  echo "Signing: ✗ Unsigned (no credentials)"
  echo "Notarization: ✗ Not notarized"
fi

echo ""
echo "To test the app:"
echo "  open $APP_PATH"
echo ""
echo "To verify signing:"
echo "  spctl -a -t exec -vv $APP_PATH"
echo ""
