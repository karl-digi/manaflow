#!/usr/bin/env bash
set -euo pipefail

# Wait for a notarization submission to complete

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUBMISSION_ID="${1:-}"

if [[ -z "$SUBMISSION_ID" ]]; then
  echo "Usage: $(basename "$0") <submission-id>"
  echo ""
  echo "Recent submissions:"
  source "$ROOT_DIR/.env.codesign"
  echo "$APPLE_API_KEY" > /tmp/AuthKey_temp.p8
  xcrun notarytool history --key /tmp/AuthKey_temp.p8 --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --output-format json 2>&1 | jq -r '.history[] | "\(.id) \(.status) \(.createdDate) \(.name)"' | head -10
  rm -f /tmp/AuthKey_temp.p8
  exit 1
fi

# Load environment
source "$ROOT_DIR/.env.codesign"

# Prepare API key
API_KEY_PATH="/tmp/AuthKey_${APPLE_API_KEY_ID}.p8"
echo "$APPLE_API_KEY" > "$API_KEY_PATH"

echo "==> Waiting for submission: $SUBMISSION_ID"

# Wait for completion
xcrun notarytool wait "$SUBMISSION_ID" \
  --key "$API_KEY_PATH" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --output-format json 2>&1 | tee /tmp/notary-wait-result.json

# Get the final status
STATUS=$(cat /tmp/notary-wait-result.json | jq -r '.status' 2>/dev/null || echo "Unknown")

echo ""
echo "==> Final status: $STATUS"

if [[ "$STATUS" == "Accepted" ]]; then
  echo "✅ Notarization accepted!"
else
  echo "❌ Notarization failed or rejected"
  echo ""
  echo "Getting detailed log..."
  xcrun notarytool log "$SUBMISSION_ID" \
    --key "$API_KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --output-format text 2>&1 | tee /tmp/notary-log.txt
fi

# Clean up
rm -f "$API_KEY_PATH"