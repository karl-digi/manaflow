#!/bin/bash
set -e

# Default values
ENV_FILE=".env"
MODE="auto"  # auto-detect based on CONVEX_DEPLOY_KEY
STRICT_MODE=false
USE_ENV_FILE=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --prod|--production)
      MODE="production"
      shift
      ;;
    --local)
      MODE="local"
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
    --strict)
      STRICT_MODE=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --prod, --production    Force Convex cloud mode (requires env file)"
      echo "  --local                 Force local self-hosted mode"
      echo "  --env-file FILE         Env file to read (default: .env)"
      echo "  --strict                Require env file to exist (no fallback to env vars)"
      echo "  -h, --help              Show this help"
      echo ""
      echo "Auto-detection (default):"
      echo "  - If CONVEX_DEPLOY_KEY is set in env file -> uses Convex cloud"
      echo "  - If CONVEX_SELF_HOSTED_ADMIN_KEY is set  -> uses local self-hosted"
      echo ""
      echo "Examples:"
      echo "  $0                                 # Auto-detect from .env (fallback to env vars)"
      echo "  $0 --prod                          # Force production mode (requires env file)"
      echo "  $0 --local                         # Force local mode"
      echo "  $0 --env-file .env.custom          # Use custom env file"
      echo "  $0 --strict                        # Require env file to exist"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--prod|--local] [--env-file FILE]"
      exit 1
      ;;
  esac
done

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
  # In strict mode or production mode, env file must exist
  if [ "$STRICT_MODE" = true ] || [ "$MODE" = "production" ]; then
    echo "Error: $ENV_FILE not found (required for production/strict mode)"
    exit 1
  fi
  echo "Note: $ENV_FILE not found, using in-memory environment variables"
  USE_ENV_FILE=false
fi

# Extract value from .env file, falling back to in-memory environment variables
get_env_value() {
  local key=$1
  local value=""

  # Try to get from env file first if it exists
  if [ "$USE_ENV_FILE" = true ]; then
    value=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    # Handle multi-line values (like private keys)
    if [[ $value == *"-----BEGIN"* ]]; then
      value=$(awk "/^${key}=/{flag=1} flag{print} /END.*KEY/{flag=0}" "$ENV_FILE" | sed "s/^${key}=//" | sed 's/^"//' | sed 's/"$//')
    fi
  fi

  # Fall back to in-memory environment variable if not found in file (non-strict mode only)
  if [ -z "$value" ] && [ "$USE_ENV_FILE" = false ]; then
    value="${!key}"
  fi

  echo "$value"
}

# Auto-detect mode if not explicitly set
if [ "$MODE" = "auto" ]; then
  DEPLOY_KEY=$(get_env_value CONVEX_DEPLOY_KEY)
  SELF_HOSTED_KEY=$(get_env_value CONVEX_SELF_HOSTED_ADMIN_KEY)

  if [ -n "$DEPLOY_KEY" ]; then
    MODE="production"
    echo "[Auto-detect] Found CONVEX_DEPLOY_KEY, using Convex cloud"
  elif [ -n "$SELF_HOSTED_KEY" ]; then
    MODE="local"
    echo "[Auto-detect] Found CONVEX_SELF_HOSTED_ADMIN_KEY, using local self-hosted"
  else
    echo "Error: Neither CONVEX_DEPLOY_KEY nor CONVEX_SELF_HOSTED_ADMIN_KEY found in $ENV_FILE"
    echo "Set one of these to configure Convex backend"
    exit 1
  fi
fi

if [ "$MODE" = "production" ]; then
  # Production mode - use Convex cloud
  DEPLOY_KEY=$(get_env_value CONVEX_DEPLOY_KEY)
  CONVEX_URL=$(get_env_value NEXT_PUBLIC_CONVEX_URL)

  if [ -z "$DEPLOY_KEY" ]; then
    echo "Error: CONVEX_DEPLOY_KEY not found in $ENV_FILE"
    exit 1
  fi

  # Use NEXT_PUBLIC_CONVEX_URL if set, otherwise default
  if [ -n "$CONVEX_URL" ]; then
    BACKEND_URL="$CONVEX_URL"
  else
    BACKEND_URL="https://outstanding-stoat-794.convex.cloud"
  fi

  ADMIN_KEY="$DEPLOY_KEY"
  echo "Setting up Convex environment variables (CLOUD)..."
  echo "Env file: $ENV_FILE"
  echo "Target: $BACKEND_URL"
else
  # Local mode - use local backend
  SELF_HOSTED_KEY=$(get_env_value CONVEX_SELF_HOSTED_ADMIN_KEY)
  SELF_HOSTED_URL=$(get_env_value CONVEX_SELF_HOSTED_URL)

  if [ -n "$SELF_HOSTED_KEY" ]; then
    ADMIN_KEY="$SELF_HOSTED_KEY"
  else
    ADMIN_KEY="cmux-dev|017aebe6643f7feb3fe831fbb93a348653c63e5711d2427d1a34b670e3151b0165d86a5ff9"
  fi

  if [ -n "$SELF_HOSTED_URL" ]; then
    BACKEND_URL="$SELF_HOSTED_URL"
  else
    BACKEND_URL="http://localhost:9777"
  fi

  echo "Setting up Convex environment variables (LOCAL)..."
  echo "Env file: $ENV_FILE"
  echo "Target: $BACKEND_URL"

  # Wait for backend to be ready (only for local)
  echo "Waiting for Convex backend to be ready..."
  timeout=30
  elapsed=0
  until curl -f -s "$BACKEND_URL/" > /dev/null 2>&1; do
    if [ $elapsed -ge $timeout ]; then
      echo "Error: Timeout waiting for backend at $BACKEND_URL"
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
GITHUB_PRIVATE_KEY=""
if [ "$USE_ENV_FILE" = true ]; then
  GITHUB_PRIVATE_KEY=$(sed -n '/^CMUX_GITHUB_APP_PRIVATE_KEY=/,/-----END.*KEY-----/p' "$ENV_FILE" | sed 's/^CMUX_GITHUB_APP_PRIVATE_KEY="//' | sed 's/"$//')
fi
# Fall back to in-memory environment variable (non-strict mode only)
if [ -z "$GITHUB_PRIVATE_KEY" ] && [ "$USE_ENV_FILE" = false ]; then
  GITHUB_PRIVATE_KEY="${CMUX_GITHUB_APP_PRIVATE_KEY}"
fi

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
echo "  - NEXT_PUBLIC_CMUX_PROTOCOL: $(get_env_value NEXT_PUBLIC_CMUX_PROTOCOL)"
echo "  - INSTALL_STATE_SECRET: $(echo "$INSTALL_STATE_SECRET" | head -c 10)..."
# Helper to show value or (will be deleted) for optional vars
show_optional_value() {
  local value=$1
  local truncate=${2:-10}
  if [ -n "$value" ]; then
    echo "$value" | head -c "$truncate"
    echo "..."
  else
    echo "(will be deleted)"
  fi
}
# Optional AI API keys (all may be unset; provider is chosen dynamically in crown/actions)
echo "  - OPENAI_API_KEY: $(show_optional_value "$(get_env_value OPENAI_API_KEY)")"
echo "  - ANTHROPIC_API_KEY: $(show_optional_value "$(get_env_value ANTHROPIC_API_KEY)")"
echo "  - GEMINI_API_KEY: $(show_optional_value "$(get_env_value GEMINI_API_KEY)")"
echo "  - AIGATEWAY_OPENAI_BASE_URL: $(show_optional_value "$(get_env_value AIGATEWAY_OPENAI_BASE_URL)" 50)"
echo "  - AIGATEWAY_ANTHROPIC_BASE_URL: $(show_optional_value "$(get_env_value AIGATEWAY_ANTHROPIC_BASE_URL)" 50)"
echo "  - AIGATEWAY_GEMINI_BASE_URL: $(show_optional_value "$(get_env_value AIGATEWAY_GEMINI_BASE_URL)" 50)"
echo "  - POSTHOG_API_KEY: $(show_optional_value "$(get_env_value POSTHOG_API_KEY)")"
echo "  - MORPH_API_KEY: $(get_env_value MORPH_API_KEY | head -c 10)..."
echo "  - PVE_API_URL: $(get_env_value PVE_API_URL)"
echo "  - PVE_API_TOKEN: $(get_env_value PVE_API_TOKEN | head -c 20)..."
echo "  - PVE_NODE: $(get_env_value PVE_NODE)"
echo "  - PVE_PUBLIC_DOMAIN: $(get_env_value PVE_PUBLIC_DOMAIN)"
echo "  - PVE_STORAGE: $(get_env_value PVE_STORAGE)"
echo "  - SANDBOX_PROVIDER: $(get_env_value SANDBOX_PROVIDER)"
# PR comment branding for fork customization
echo "  - CMUX_BASE_URL: $(show_optional_value "$(get_env_value CMUX_BASE_URL)" 40)"
echo "  - CMUX_BOT_NAME: $(show_optional_value "$(get_env_value CMUX_BOT_NAME)" 20)"
# Opt-in feature flag for screenshot workflow (disabled by default)
echo "  - CMUX_ENABLE_SCREENSHOT_WORKFLOW: $(show_optional_value "$(get_env_value CMUX_ENABLE_SCREENSHOT_WORKFLOW)" 10)"
# Note: CMUX_IS_STAGING removed from Convex - preview_jobs_worker hardcodes "false" in sandbox
CONVEX_IS_PRODUCTION_DISPLAY=$(get_env_value CONVEX_IS_PRODUCTION)
if [ -z "$CONVEX_IS_PRODUCTION_DISPLAY" ]; then
  CONVEX_IS_PRODUCTION_DISPLAY=$( [ "$MODE" = "production" ] && echo "true" || echo "false" )
  echo "  - CONVEX_IS_PRODUCTION: $CONVEX_IS_PRODUCTION_DISPLAY (from MODE)"
else
  echo "  - CONVEX_IS_PRODUCTION: $CONVEX_IS_PRODUCTION_DISPLAY (from env file)"
fi
echo ""

# Build JSON payload, only including non-empty values
build_json_changes() {
  local changes=""

  # Add change only if value is non-empty (skip if empty)
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

  # Add change with deletion support: if value is empty, delete the variable (value: null)
  # Use this for optional variables that should be removed when not set in .env
  add_optional_change() {
    local name=$1
    local value=$2
    if [ -n "$changes" ]; then
      changes="$changes,"
    fi
    if [ -n "$value" ]; then
      local escaped_value=$(printf '%s' "$value" | jq -Rs . | sed 's/^"//;s/"$//')
      changes="$changes{\"name\": \"$name\", \"value\": \"$escaped_value\"}"
    else
      # Empty value = delete the variable
      changes="$changes{\"name\": \"$name\", \"value\": null}"
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
  add_change "NEXT_PUBLIC_CMUX_PROTOCOL" "$(get_env_value NEXT_PUBLIC_CMUX_PROTOCOL)"
  add_change "INSTALL_STATE_SECRET" "$INSTALL_STATE_SECRET"
  # AI API keys: optional and deleted when not set (provider selection is dynamic)
  add_optional_change "OPENAI_API_KEY" "$(get_env_value OPENAI_API_KEY)"
  add_optional_change "ANTHROPIC_API_KEY" "$(get_env_value ANTHROPIC_API_KEY)"
  add_optional_change "GEMINI_API_KEY" "$(get_env_value GEMINI_API_KEY)"
  # AI Gateway base URL overrides: use add_optional_change to delete when not set
  add_optional_change "AIGATEWAY_OPENAI_BASE_URL" "$(get_env_value AIGATEWAY_OPENAI_BASE_URL)"
  add_optional_change "AIGATEWAY_ANTHROPIC_BASE_URL" "$(get_env_value AIGATEWAY_ANTHROPIC_BASE_URL)"
  add_optional_change "AIGATEWAY_GEMINI_BASE_URL" "$(get_env_value AIGATEWAY_GEMINI_BASE_URL)"
  add_optional_change "POSTHOG_API_KEY" "$(get_env_value POSTHOG_API_KEY)"
  add_change "MORPH_API_KEY" "$(get_env_value MORPH_API_KEY)"
  add_change "PVE_API_URL" "$(get_env_value PVE_API_URL)"
  add_change "PVE_API_TOKEN" "$(get_env_value PVE_API_TOKEN)"
  add_change "PVE_NODE" "$(get_env_value PVE_NODE)"
  add_change "PVE_PUBLIC_DOMAIN" "$(get_env_value PVE_PUBLIC_DOMAIN)"
  add_change "PVE_STORAGE" "$(get_env_value PVE_STORAGE)"
  add_optional_change "SANDBOX_PROVIDER" "$(get_env_value SANDBOX_PROVIDER)"
  # PR comment branding: configurable base URL and bot name for fork customization
  add_optional_change "CMUX_BASE_URL" "$(get_env_value CMUX_BASE_URL)"
  add_optional_change "CMUX_BOT_NAME" "$(get_env_value CMUX_BOT_NAME)"
  # Opt-in feature flag: set to "true" to enable, delete (null) when not set to disable
  add_optional_change "CMUX_ENABLE_SCREENSHOT_WORKFLOW" "$(get_env_value CMUX_ENABLE_SCREENSHOT_WORKFLOW)"
  # Note: CMUX_IS_STAGING removed from Convex schema - preview_jobs_worker hardcodes "false" in sandbox

  # Set CONVEX_IS_PRODUCTION: first check env file, then fall back to MODE
  CONVEX_IS_PRODUCTION_ENV=$(get_env_value CONVEX_IS_PRODUCTION)
  if [ -n "$CONVEX_IS_PRODUCTION_ENV" ]; then
    add_change "CONVEX_IS_PRODUCTION" "$CONVEX_IS_PRODUCTION_ENV"
  elif [ "$MODE" = "production" ]; then
    add_change "CONVEX_IS_PRODUCTION" "true"
  else
    add_change "CONVEX_IS_PRODUCTION" "false"
  fi

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
  echo "Setup complete (Convex Cloud). Target: $BACKEND_URL"
else
  echo "Setup complete (Local self-hosted). Target: $BACKEND_URL"
fi
