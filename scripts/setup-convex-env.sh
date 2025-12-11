#!/bin/bash
set -e

# Default values
ENV_FILE=".env"
MODE="local"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --prod|--production)
      MODE="production"
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prod, --production    Use production Convex cloud"
      echo "  --env-file FILE         Env file to read (default: .env)"
      echo "  -h, --help              Show this help"
      echo ""
      echo "Examples:"
      echo "  $0 --prod                          # Production with .env"
      echo "  $0 --prod --env-file .env.custom   # Production with custom env file"
      echo "  $0                                 # Local dev with .env"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--prod|--production] [--env-file FILE]"
      exit 1
      ;;
  esac
done

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

if [ "$MODE" = "production" ]; then
  # Production mode - use Convex cloud
  DEPLOY_KEY=$(get_env_value CONVEX_DEPLOY_KEY)
  if [ -z "$DEPLOY_KEY" ]; then
    echo "Error: CONVEX_DEPLOY_KEY not found in $ENV_FILE"
    exit 1
  fi
  BACKEND_URL="https://outstanding-stoat-794.convex.cloud"
  ADMIN_KEY="$DEPLOY_KEY"
  echo "Setting up Convex environment variables (PRODUCTION)..."
  echo "Env file: $ENV_FILE"
  echo "Target: $BACKEND_URL"
else
  # Local mode - use local backend
  ADMIN_KEY="cmux-dev|017aebe6643f7feb3fe831fbb93a348653c63e5711d2427d1a34b670e3151b0165d86a5ff9"
  BACKEND_URL="http://localhost:9777"
  echo "Setting up Convex environment variables (LOCAL)..."
  echo "Env file: $ENV_FILE"

  # Wait for backend to be ready (only for local)
  echo "Waiting for Convex backend to be ready..."
  timeout=30
  elapsed=0
  until curl -f -s "$BACKEND_URL/" > /dev/null 2>&1; do
    if [ $elapsed -ge $timeout ]; then
      echo "Error: Timeout waiting for backend"
      exit 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "Backend is ready"
fi

# Read the GitHub private key properly (multi-line)
# Note: PKCS#1 to PKCS#8 conversion is now handled at runtime in Convex
# (see packages/convex/_shared/githubApp.ts wrapPkcs1InPkcs8 function)
GITHUB_PRIVATE_KEY=$(sed -n '/^CMUX_GITHUB_APP_PRIVATE_KEY=/,/-----END.*KEY-----/p' "$ENV_FILE" | sed 's/^CMUX_GITHUB_APP_PRIVATE_KEY="//' | sed 's/"$//')

# Set INSTALL_STATE_SECRET based on mode
if [ "$MODE" = "production" ]; then
  INSTALL_STATE_SECRET=$(get_env_value INSTALL_STATE_SECRET)
else
  INSTALL_STATE_SECRET="dev_install_state_secret_cmux_local"
fi

echo "Uploading environment variables to Convex backend..."

# Show what we're setting (keys only, not values for security)
echo ""
echo "Environment variables to set:"
echo "  - STACK_WEBHOOK_SECRET: $(get_env_value STACK_WEBHOOK_SECRET | head -c 10)..."
echo "  - BASE_APP_URL: $(get_env_value BASE_APP_URL)"
echo "  - CMUX_TASK_RUN_JWT_SECRET: $(get_env_value CMUX_TASK_RUN_JWT_SECRET | head -c 10)..."
echo "  - NEXT_PUBLIC_STACK_PROJECT_ID: $(get_env_value NEXT_PUBLIC_STACK_PROJECT_ID)"
echo "  - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: $(get_env_value NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY | head -c 15)..."
echo "  - STACK_SECRET_SERVER_KEY: $(get_env_value STACK_SECRET_SERVER_KEY | head -c 10)..."
echo "  - STACK_SUPER_SECRET_ADMIN_KEY: $(get_env_value STACK_SUPER_SECRET_ADMIN_KEY | head -c 10)..."
echo "  - STACK_DATA_VAULT_SECRET: $(get_env_value STACK_DATA_VAULT_SECRET | head -c 10)..."
echo "  - GITHUB_APP_WEBHOOK_SECRET: $(get_env_value GITHUB_APP_WEBHOOK_SECRET | head -c 10)..."
echo "  - CMUX_GITHUB_APP_ID: $(get_env_value CMUX_GITHUB_APP_ID)"
echo "  - CMUX_GITHUB_APP_PRIVATE_KEY: $(echo "$GITHUB_PRIVATE_KEY" | head -1)"
echo "  - NEXT_PUBLIC_GITHUB_APP_SLUG: $(get_env_value NEXT_PUBLIC_GITHUB_APP_SLUG)"
echo "  - INSTALL_STATE_SECRET: $(echo "$INSTALL_STATE_SECRET" | head -c 10)..."
echo "  - OPENAI_API_KEY: $(get_env_value OPENAI_API_KEY | head -c 10)..."
echo "  - ANTHROPIC_API_KEY: $(get_env_value ANTHROPIC_API_KEY | head -c 10)..."
echo "  - GEMINI_API_KEY: $(get_env_value GEMINI_API_KEY | head -c 10)..."
echo "  - MORPH_API_KEY: $(get_env_value MORPH_API_KEY | head -c 10)..."
echo ""

# Build JSON payload, only including non-empty values
build_json_changes() {
  local changes=""

  add_change() {
    local name=$1
    local value=$2
    if [ -n "$value" ]; then
      if [ -n "$changes" ]; then
        changes="$changes,"
      fi
      # Escape the value for JSON (use printf to avoid adding newline from echo)
      local escaped_value=$(printf '%s' "$value" | jq -Rs . | sed 's/^"//;s/"$//')
      changes="$changes{\"name\": \"$name\", \"value\": \"$escaped_value\"}"
    fi
  }

  add_change "STACK_WEBHOOK_SECRET" "$(get_env_value STACK_WEBHOOK_SECRET)"
  add_change "BASE_APP_URL" "$(get_env_value BASE_APP_URL)"
  add_change "CMUX_TASK_RUN_JWT_SECRET" "$(get_env_value CMUX_TASK_RUN_JWT_SECRET)"
  add_change "NEXT_PUBLIC_STACK_PROJECT_ID" "$(get_env_value NEXT_PUBLIC_STACK_PROJECT_ID)"
  add_change "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY" "$(get_env_value NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY)"
  add_change "STACK_SECRET_SERVER_KEY" "$(get_env_value STACK_SECRET_SERVER_KEY)"
  add_change "STACK_SUPER_SECRET_ADMIN_KEY" "$(get_env_value STACK_SUPER_SECRET_ADMIN_KEY)"
  add_change "STACK_DATA_VAULT_SECRET" "$(get_env_value STACK_DATA_VAULT_SECRET)"
  add_change "GITHUB_APP_WEBHOOK_SECRET" "$(get_env_value GITHUB_APP_WEBHOOK_SECRET)"
  add_change "CMUX_GITHUB_APP_ID" "$(get_env_value CMUX_GITHUB_APP_ID)"
  add_change "NEXT_PUBLIC_GITHUB_APP_SLUG" "$(get_env_value NEXT_PUBLIC_GITHUB_APP_SLUG)"
  add_change "INSTALL_STATE_SECRET" "$INSTALL_STATE_SECRET"
  add_change "OPENAI_API_KEY" "$(get_env_value OPENAI_API_KEY)"
  add_change "ANTHROPIC_API_KEY" "$(get_env_value ANTHROPIC_API_KEY)"
  add_change "GEMINI_API_KEY" "$(get_env_value GEMINI_API_KEY)"
  add_change "MORPH_API_KEY" "$(get_env_value MORPH_API_KEY)"

  # Handle private key separately (multi-line)
  if [ -n "$GITHUB_PRIVATE_KEY" ]; then
    if [ -n "$changes" ]; then
      changes="$changes,"
    fi
    # Private key needs trailing newline for proper PEM format
    local pk_escaped=$(printf '%s\n' "$GITHUB_PRIVATE_KEY" | jq -Rs . | sed 's/^"//;s/"$//')
    changes="$changes{\"name\": \"CMUX_GITHUB_APP_PRIVATE_KEY\", \"value\": \"$pk_escaped\"}"
  fi

  echo "{\"changes\": [$changes]}"
}

JSON_PAYLOAD=$(build_json_changes)

# Debug: show payload size
echo "Payload size: $(echo "$JSON_PAYLOAD" | wc -c | tr -d ' ') bytes"

# Set all environment variables at once
response=$(curl -s -X POST "$BACKEND_URL/api/update_environment_variables" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Convex $ADMIN_KEY" \
  -d "$JSON_PAYLOAD")

# Show response for debugging
if [ -n "$response" ]; then
  echo "API Response: $response"
fi

if echo "$response" | grep -qi "error"; then
  echo "Error setting environment variables:"
  echo "$response"
  exit 1
fi

echo "Environment variables configured successfully"

# Verify by listing them
echo ""
echo "Verifying environment variables..."
curl -s -X GET "$BACKEND_URL/api/list_environment_variables" \
  -H "Authorization: Convex $ADMIN_KEY" | jq -r '.environmentVariables | keys | .[]' | while read key; do
  echo "  [ok] $key"
done

echo ""
if [ "$MODE" = "production" ]; then
  echo "Setup complete (production). You can now run: bun run convex:deploy:prod"
else
  echo "Setup complete (local). Convex env vars have been configured for local development."
fi
