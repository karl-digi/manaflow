#!/usr/bin/env bash
set -euo pipefail

# Helper: find a Coolify Application UUID (COOLIFY_APP_UUID) for cmux server (apps/server).
#
# Reads COOLIFY_BASE_URL and COOLIFY_API_TOKEN from:
#   1) current environment, or
#   2) an env file (default: repo-root/.env.production if present, else repo-root/.env)
#
# Then queries Coolify API: GET /api/v1/applications and selects the app by base_directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --env-file <path>         Read COOLIFY_BASE_URL / COOLIFY_API_TOKEN from env file
                            (default: .env.production if present, else .env)
  --base-dir <path>         Match Coolify application's base_directory (default: /apps/server)
  --compose-location <path> Optional secondary filter for docker_compose_location
                            (default: /docker-compose.yml if multiple matches)
  --name <string>           Optional filter: application name equals this string
  --raw                     Print only the UUID (no extra text)
  -h, --help                Show help

Environment variables:
  COOLIFY_BASE_URL          Example: https://coolify.example.com
  COOLIFY_API_TOKEN         Coolify API token from Keys & Tokens -> API tokens

Examples:
  bash scripts/coolify-find-app-uuid.sh
  bash scripts/coolify-find-app-uuid.sh --env-file .env.production
  bash scripts/coolify-find-app-uuid.sh --raw | pbcopy
EOF
}

ENV_FILE=""
BASE_DIR="/apps/server"
COMPOSE_LOCATION=""
APP_NAME=""
RAW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      if [[ -z "$ENV_FILE" ]]; then
        echo "--env-file requires a path" >&2
        exit 1
      fi
      shift 2
      ;;
    --base-dir)
      BASE_DIR="${2:-}"
      if [[ -z "$BASE_DIR" ]]; then
        echo "--base-dir requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --compose-location)
      COMPOSE_LOCATION="${2:-}"
      if [[ -z "$COMPOSE_LOCATION" ]]; then
        echo "--compose-location requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --name)
      APP_NAME="${2:-}"
      if [[ -z "$APP_NAME" ]]; then
        echo "--name requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --raw)
      RAW=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

normalize_path() {
  local p="${1:-}"
  if [[ -z "$p" ]]; then
    return 0
  fi
  if [[ "$p" != /* ]]; then
    p="/$p"
  fi
  p="${p%/}"
  printf '%s\n' "$p"
}

read_env_file_var() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  # Minimal .env parser for simple KEY=value (quotes supported).
  # Only used for COOLIFY_BASE_URL and COOLIFY_API_TOKEN.
  awk -v k="$key" '
    function trim(s) { sub(/^[ \t\r\n]+/, "", s); sub(/[ \t\r\n]+$/, "", s); return s }
    /^[ \t]*#/ { next }
    {
      line=$0
      sub(/^[ \t]*export[ \t]+/, "", line)
      if (index(line, k "=") != 1) next
      val=substr(line, length(k)+2)
      val=trim(val)
      if (val ~ /^"/) {
        if (val ~ /^".*"$/) { val=substr(val,2,length(val)-2) }
      } else if (val ~ /^'\''/) {
        if (val ~ /^'\''.*'\''$/) { val=substr(val,2,length(val)-2) }
      } else {
        # strip inline comments/whitespace for unquoted values
        sub(/[ \t]+#.*/, "", val)
        sub(/[ \t].*$/, "", val)
      }
      print val
    }
  ' "$file" | tail -n 1
}

pick_default_env_file() {
  if [[ -f "$ROOT_DIR/.env.production" ]]; then
    printf '%s\n' "$ROOT_DIR/.env.production"
    return 0
  fi
  if [[ -f "$ROOT_DIR/.env" ]]; then
    printf '%s\n' "$ROOT_DIR/.env"
    return 0
  fi
  return 1
}

if [[ -z "${ENV_FILE:-}" ]]; then
  ENV_FILE="$(pick_default_env_file || true)"
fi

COOLIFY_BASE_URL_VAL="${COOLIFY_BASE_URL:-}"
COOLIFY_API_TOKEN_VAL="${COOLIFY_API_TOKEN:-}"

if [[ -z "$COOLIFY_BASE_URL_VAL" && -n "${ENV_FILE:-}" ]]; then
  COOLIFY_BASE_URL_VAL="$(read_env_file_var "$ENV_FILE" "COOLIFY_BASE_URL" || true)"
fi
if [[ -z "$COOLIFY_API_TOKEN_VAL" && -n "${ENV_FILE:-}" ]]; then
  COOLIFY_API_TOKEN_VAL="$(read_env_file_var "$ENV_FILE" "COOLIFY_API_TOKEN" || true)"
fi

if [[ -z "$COOLIFY_BASE_URL_VAL" ]]; then
  echo "COOLIFY_BASE_URL is not set. Set it in the environment or in ${ENV_FILE:-an env file}." >&2
  exit 1
fi
if [[ -z "$COOLIFY_API_TOKEN_VAL" ]]; then
  echo "COOLIFY_API_TOKEN is not set. Set it in the environment or in ${ENV_FILE:-an env file}." >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required." >&2; exit 1; }

base_url="${COOLIFY_BASE_URL_VAL%/}"
base_dir_norm="$(normalize_path "$BASE_DIR")"
compose_norm="$(normalize_path "$COMPOSE_LOCATION")"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

apps_json="$tmp_dir/apps.json"
http_code="$(
  curl -sS -o "$apps_json" -w '%{http_code}' \
    --connect-timeout 10 --max-time 30 --retry 2 --retry-delay 1 \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN_VAL}" \
    "${base_url}/api/v1/applications" || true
)"

if [[ "$http_code" != "200" ]]; then
  echo "Coolify API request failed: HTTP ${http_code} (${base_url}/api/v1/applications)" >&2
  exit 1
fi

select_filter='
  def norm_path($p):
    if ($p|type) != "string" or ($p|length)==0 then ""
    else
      ($p
        | if startswith("/") then . else "/" + . end
        | sub("/+$";""))
    end;

  map({
    name: (.name // ""),
    uuid: (.uuid // ""),
    base_directory: norm_path(.base_directory),
    docker_compose_location: norm_path(.docker_compose_location),
    git_repository: (.git_repository // ""),
    git_branch: (.git_branch // ""),
    build_pack: (.build_pack // "")
  })
'

matches_json="$tmp_dir/matches.json"
jq -c --arg base "$base_dir_norm" --arg name "$APP_NAME" "
  $select_filter
  | map(select(.uuid != \"\"))
  | map(select(.base_directory == \$base))
  | (if (\$name | length) > 0 then map(select(.name == \$name)) else . end)
" "$apps_json" > "$matches_json"

match_count="$(jq -r 'length' "$matches_json")"

if [[ "$match_count" -eq 0 ]]; then
  echo "No Coolify application found with base_directory=${base_dir_norm}." >&2
  echo "Tip: list candidates with:" >&2
  echo "  curl -fsS \"${base_url}/api/v1/applications\" -H \"Authorization: Bearer <token>\" | jq -r '.[] | \"\\(.name)\\t\\(.uuid)\\t\\(.base_directory // \"\")\\t\\(.docker_compose_location // \"\")\"'" >&2
  exit 1
fi

if [[ "$match_count" -gt 1 ]]; then
  if [[ -z "$compose_norm" ]]; then
    compose_norm="/docker-compose.yml"
  fi

filtered_json="$tmp_dir/filtered.json"
  jq -c --arg compose "$compose_norm" '
    map(select(.docker_compose_location == $compose))
  ' "$matches_json" > "$filtered_json"

filtered_count="$(jq -r 'length' "$filtered_json")"
  if [[ "$filtered_count" -eq 1 ]]; then
    mv "$filtered_json" "$matches_json"
    match_count=1
  else
    echo "Multiple applications match base_directory=${base_dir_norm}." >&2
    echo "Matches:" >&2
    jq -r '.[] | "- \(.name)\t\(.uuid)\tbase=\(.base_directory)\tcompose=\(.docker_compose_location)"' "$matches_json" >&2
    echo "Use --name <app-name> or --compose-location <path> to disambiguate." >&2
    exit 1
  fi
fi

uuid="$(jq -r '.[0].uuid' "$matches_json")"
name="$(jq -r '.[0].name' "$matches_json")"
base_dir="$(jq -r '.[0].base_directory' "$matches_json")"
compose_loc="$(jq -r '.[0].docker_compose_location' "$matches_json")"

if [[ "$RAW" == "true" ]]; then
  printf '%s\n' "$uuid"
  exit 0
fi

echo "Found Coolify application:"
echo "  name: ${name}"
echo "  uuid: ${uuid}"
echo "  base_directory: ${base_dir}"
if [[ -n "${compose_loc:-}" ]]; then
  echo "  docker_compose_location: ${compose_loc}"
fi
echo ""
echo "COOLIFY_APP_UUID=${uuid}"
