#!/usr/bin/env bash
set -euo pipefail

# Show detailed notarization status and info

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load environment
if [[ -f "$ROOT_DIR/.env.codesign" ]]; then
  source "$ROOT_DIR/.env.codesign"
else
  echo "Error: .env.codesign not found" >&2
  exit 1
fi

# Prepare API key
API_KEY_PATH="/tmp/AuthKey_${APPLE_API_KEY_ID}.p8"
echo "$APPLE_API_KEY" > "$API_KEY_PATH"

echo "=================================================================================="
echo "NOTARIZATION STATUS DASHBOARD"
echo "=================================================================================="
echo ""
echo "API Configuration:"
echo "  Key ID: $APPLE_API_KEY_ID"
echo "  Issuer: $APPLE_API_ISSUER"
echo ""

# Get history
echo "Recent Submissions:"
echo "--------------------------------------------------------------------------------"
HISTORY=$(xcrun notarytool history \
  --key "$API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --output-format json 2>&1)

echo "$HISTORY" | jq -r '.history[] | "[\(.status | .[0:12] | . + (" " * (12 - length)))] \(.id) \(.createdDate) \(.name)"' | head -10

echo ""
echo "Detailed Status for Each Submission:"
echo "--------------------------------------------------------------------------------"

# Get detailed info for each recent submission
for ID in $(echo "$HISTORY" | jq -r '.history[].id' | head -5); do
  echo ""
  echo "Submission: $ID"
  
  INFO=$(xcrun notarytool info "$ID" \
    --key "$API_KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --output-format json 2>&1)
  
  STATUS=$(echo "$INFO" | jq -r '.status')
  CREATED=$(echo "$INFO" | jq -r '.createdDate')
  NAME=$(echo "$INFO" | jq -r '.name')
  
  echo "  File: $NAME"
  echo "  Status: $STATUS"
  echo "  Created: $CREATED"
  
  # If there's an error or it's rejected, try to get the log
  if [[ "$STATUS" == "Rejected" ]] || [[ "$STATUS" == "Invalid" ]]; then
    echo "  Getting error log..."
    xcrun notarytool log "$ID" \
      --key "$API_KEY_PATH" \
      --key-id "$APPLE_API_KEY_ID" \
      --issuer "$APPLE_API_ISSUER" \
      --output-format text 2>&1 | head -20 | sed 's/^/    /'
  fi
done

echo ""
echo "=================================================================================="
echo ""
echo "Commands for specific submissions:"
echo ""
echo "Wait for completion:"
echo "  ./scripts/notary-wait.sh <submission-id>"
echo ""
echo "Get detailed log:"
echo "  xcrun notarytool log <submission-id> --key $API_KEY_PATH --key-id $APPLE_API_KEY_ID --issuer $APPLE_API_ISSUER"
echo ""
echo "Submit new file:"
echo "  ./scripts/notarize-only.sh [--artifact path/to/file.dmg]"
echo ""

# Clean up
rm -f "$API_KEY_PATH"