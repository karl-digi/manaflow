#!/bin/bash
set -e

ADMIN_KEY="cmux-dev|017aebe6643f7feb3fe831fbb93a348653c63e5711d2427d1a34b670e3151b0165d86a5ff9"
BACKEND_URL="http://localhost:9777"
ENV_FILE=".env.production"

echo "🔧 Setting up Convex environment variables..."

# Wait for backend to be ready
echo "⏳ Waiting for Convex backend to be ready..."
timeout=30
elapsed=0
until curl -f -s "$BACKEND_URL/" > /dev/null 2>&1; do
  if [ $elapsed -ge $timeout ]; then
    echo "❌ Timeout waiting for backend"
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "✅ Backend is ready!"

# Check if .env.production exists
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: $ENV_FILE not found"
  exit 1
fi

# Extract value from .env file, handling quoted values
get_env_value() {
  local key=$1
  local value=$(grep "^${key}=" "$ENV_FILE" | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  # Handle multi-line values (like private keys)
  if [[ $value == *"-----BEGIN"* ]]; then
    # Extract full private key including newlines
    awk "/^${key}=/{flag=1} flag{print} /END.*KEY/{flag=0}" "$ENV_FILE" | sed "s/^${key}=//" | sed 's/^"//' | sed 's/"$//'
  else
    echo "$value"
  fi
}

# Read the GitHub private key properly (multi-line)
GITHUB_PRIVATE_KEY=$(awk '/^CMUX_GITHUB_APP_PRIVATE_KEY=/{flag=1; sub(/^CMUX_GITHUB_APP_PRIVATE_KEY=/, ""); sub(/^"/, "")} flag{print} /END.*KEY/{sub(/"$/, ""); print; flag=0}' "$ENV_FILE" | sed 's/  $//')

echo "📤 Uploading environment variables to Convex backend..."

# Set all environment variables at once
response=$(curl -s -X POST "$BACKEND_URL/api/update_environment_variables" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Convex $ADMIN_KEY" \
  -d "$(cat <<EOF
{
  "changes": [
    {"name": "STACK_WEBHOOK_SECRET", "value": "$(get_env_value STACK_WEBHOOK_SECRET)"},
    {"name": "BASE_APP_URL", "value": "$(get_env_value BASE_APP_URL)"},
    {"name": "CMUX_TASK_RUN_JWT_SECRET", "value": "$(get_env_value CMUX_TASK_RUN_JWT_SECRET)"},
    {"name": "NEXT_PUBLIC_STACK_PROJECT_ID", "value": "$(get_env_value NEXT_PUBLIC_STACK_PROJECT_ID)"},
    {"name": "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY", "value": "$(get_env_value NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY)"},
    {"name": "STACK_SECRET_SERVER_KEY", "value": "$(get_env_value STACK_SECRET_SERVER_KEY)"},
    {"name": "STACK_SUPER_SECRET_ADMIN_KEY", "value": "$(get_env_value STACK_SUPER_SECRET_ADMIN_KEY)"},
    {"name": "STACK_DATA_VAULT_SECRET", "value": "$(get_env_value STACK_DATA_VAULT_SECRET)"},
    {"name": "GITHUB_APP_WEBHOOK_SECRET", "value": "$(get_env_value GITHUB_APP_WEBHOOK_SECRET)"},
    {"name": "CMUX_GITHUB_APP_ID", "value": "$(get_env_value CMUX_GITHUB_APP_ID)"},
    {"name": "CMUX_GITHUB_APP_PRIVATE_KEY", "value": $(echo "$GITHUB_PRIVATE_KEY" | jq -Rs .)},
    {"name": "NEXT_PUBLIC_GITHUB_APP_SLUG", "value": "$(get_env_value NEXT_PUBLIC_GITHUB_APP_SLUG)"},
    {"name": "INSTALL_STATE_SECRET", "value": "dev_install_state_secret_cmux_local"},
    {"name": "OPENAI_API_KEY", "value": "$(get_env_value OPENAI_API_KEY)"},
    {"name": "ANTHROPIC_API_KEY", "value": "$(get_env_value ANTHROPIC_API_KEY)"},
    {"name": "GEMINI_API_KEY", "value": "$(get_env_value GEMINI_API_KEY)"},
    {"name": "MORPH_API_KEY", "value": "$(get_env_value MORPH_API_KEY)"}
  ]
}
EOF
)")

if echo "$response" | grep -q "error"; then
  echo "❌ Error setting environment variables:"
  echo "$response"
  exit 1
fi

echo "✅ Environment variables configured successfully!"

# Verify by listing them
echo ""
echo "📋 Verifying environment variables..."
curl -s -X GET "$BACKEND_URL/api/list_environment_variables" \
  -H "Authorization: Convex $ADMIN_KEY" | jq -r '.environmentVariables | keys | .[]' | while read key; do
  echo "  ✓ $key"
done

echo ""
echo "🎉 Setup complete! You can now run: bun run convex:deploy:prod"
