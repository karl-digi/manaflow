#!/bin/bash
set -e

# Source the environment file
source .env.codesign

# Create temporary key file
KEY_FILE="/tmp/AuthKey_${APPLE_API_KEY_ID}.p8"
echo "$APPLE_API_KEY" > "$KEY_FILE"

echo "Storing credentials in keychain..."
xcrun notarytool store-credentials "cmux-notarytool" \
    --key "$KEY_FILE" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --validate

# Clean up
rm -f "$KEY_FILE"

echo "Credentials stored. Now running history..."
xcrun notarytool history --keychain-profile "cmux-notarytool"