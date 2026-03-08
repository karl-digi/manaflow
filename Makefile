SHELL := /bin/bash

DEVCONTAINER_DIR := .devcontainer
COMPOSE_FILE := docker-compose.convex.yml
PROJECT_NAME := cmux-convex

# Default environment files (can be overridden: make target ENV_FILE=.env.custom)
ENV_FILE ?= .env
ENV_FILE_PROD ?= .env.production

# Cloudrouter dev version (distinct from prod npm version)
CLOUDROUTER_DEV_VERSION ?= 0.1.0-dev

.PHONY: convex-up convex-down convex-restart convex-clean convex-init convex-init-prod convex-clear convex-clear-prod convex-reset convex-reset-prod convex-fresh dev dev-electron install-cloudrouter-dev install-devsh-dev install-devsh-prod sync-upstream-tags chrome-debug
.PHONY: clone-proxy-linux-amd64 clone-proxy-linux-arm64 screenshot-collector-upload screenshot-collector-upload-prod
.PHONY: cloudrouter-npm-republish-prod cloudrouter-npm-republish-prod-dry
.PHONY: devsh-npm-republish-prod devsh-npm-republish-prod-dry

convex-up:
	cd $(DEVCONTAINER_DIR) && COMPOSE_PROJECT_NAME=$(PROJECT_NAME) docker compose -f $(COMPOSE_FILE) up -d

convex-down:
	cd $(DEVCONTAINER_DIR) && COMPOSE_PROJECT_NAME=$(PROJECT_NAME) docker compose -f $(COMPOSE_FILE) down

convex-restart: convex-down convex-up

convex-clean:
	@echo "🗑️  Stopping and removing Convex containers with volumes..."
	cd $(DEVCONTAINER_DIR) && COMPOSE_PROJECT_NAME=$(PROJECT_NAME) docker compose -f $(COMPOSE_FILE) down -v
	@echo "✅ Convex containers and volumes removed"

convex-init:
	@echo "Initializing Convex environment variables..."
	./scripts/setup-convex-env.sh --env-file $(ENV_FILE)

convex-init-prod:
	@echo "Initializing Convex environment variables (production)..."
	./scripts/setup-convex-env.sh --prod --env-file $(ENV_FILE_PROD)

convex-clear:
	@echo "WARNING: This will DELETE ALL DATA from local Convex!"
	@echo "Using env file: $(ENV_FILE)"
	@echo "Press Ctrl+C within 5 seconds to cancel..."
	@sleep 5
	@echo "Clearing all tables in local Convex..."
	@rm -rf /tmp/convex-empty && mkdir -p /tmp/convex-empty/dummy
	@touch /tmp/convex-empty/dummy/.gitkeep
	@cd /tmp/convex-empty && zip -r empty.zip dummy
	cd packages/convex && bunx convex import --env-file ../../$(ENV_FILE) --replace-all -y /tmp/convex-empty/empty.zip
	@rm -rf /tmp/convex-empty
	@echo "Local database cleared"

convex-clear-prod:
	@echo "WARNING: This will DELETE ALL DATA from production Convex!"
	@echo "Using env file: $(ENV_FILE_PROD)"
	@test -f "$(ENV_FILE_PROD)" || (echo "Error: $(ENV_FILE_PROD) not found (required for production)" && exit 1)
	@echo "Press Ctrl+C within 5 seconds to cancel..."
	@sleep 5
	@echo "Clearing all tables in production Convex..."
	@rm -rf /tmp/convex-empty && mkdir -p /tmp/convex-empty/dummy
	@touch /tmp/convex-empty/dummy/.gitkeep
	@cd /tmp/convex-empty && zip -r empty.zip dummy
	cd packages/convex && bunx convex import --env-file ../../$(ENV_FILE_PROD) --replace-all -y /tmp/convex-empty/empty.zip
	@rm -rf /tmp/convex-empty
	@echo "Production database cleared"

convex-reset:
	@echo "WARNING: This will DELETE ALL DATA, FILES, and FUNCTIONS from local Convex!"
	@echo "Using env file: $(ENV_FILE)"
	@echo "Press Ctrl+C within 5 seconds to cancel..."
	@sleep 5
	@echo "Step 1: Clearing file storage..."
	cd packages/convex && bunx convex run admin:clearStorage --env-file ../../$(ENV_FILE)
	@echo "Step 2: Clearing all tables..."
	@rm -rf /tmp/convex-empty-data && mkdir -p /tmp/convex-empty-data/dummy
	@touch /tmp/convex-empty-data/dummy/.gitkeep
	@cd /tmp/convex-empty-data && zip -r empty.zip dummy
	cd packages/convex && bunx convex import --env-file ../../$(ENV_FILE) --replace-all -y /tmp/convex-empty-data/empty.zip
	@rm -rf /tmp/convex-empty-data
	@echo "Step 3: Deploying empty functions (clears all functions and crons)..."
	cd scripts/convex-empty && bun install --frozen-lockfile && bunx convex deploy --env-file ../../$(ENV_FILE) -y
	@echo "Full reset complete (all data, files, functions, and crons cleared)"

convex-reset-prod:
	@echo "WARNING: This will DELETE ALL DATA, FILES, and FUNCTIONS from production Convex!"
	@echo "Using env file: $(ENV_FILE_PROD)"
	@test -f "$(ENV_FILE_PROD)" || (echo "Error: $(ENV_FILE_PROD) not found (required for production)" && exit 1)
	@echo "Press Ctrl+C within 5 seconds to cancel..."
	@sleep 5
	@echo "Step 1: Clearing file storage..."
	cd packages/convex && bunx convex run admin:clearStorage --env-file ../../$(ENV_FILE_PROD)
	@echo "Step 2: Clearing all tables..."
	@rm -rf /tmp/convex-empty-data && mkdir -p /tmp/convex-empty-data/dummy
	@touch /tmp/convex-empty-data/dummy/.gitkeep
	@cd /tmp/convex-empty-data && zip -r empty.zip dummy
	cd packages/convex && bunx convex import --env-file ../../$(ENV_FILE_PROD) --replace-all -y /tmp/convex-empty-data/empty.zip
	@rm -rf /tmp/convex-empty-data
	@echo "Step 3: Deploying empty functions (clears all functions and crons)..."
	cd scripts/convex-empty && bun install --frozen-lockfile && bunx convex deploy --env-file ../../$(ENV_FILE_PROD) -y
	@echo "Full production reset complete (all data, files, functions, and crons cleared)"

convex-fresh: convex-clean convex-up
	@echo "Waiting for containers to be ready..."
	@sleep 5
	@$(MAKE) convex-init ENV_FILE=$(ENV_FILE)
	@echo "Fresh Convex setup complete! Ready to deploy."

dev:
	./scripts/dev.sh

dev-electron:
	./scripts/dev.sh --electron --electron-debug

# Build and install cloudrouter CLI (dev mode)
# cloudrouter auto-loads CLOUDROUTER_REFRESH_TOKEN from .env (no interactive login needed)
# Dev build automatically uses cmux-devbox-lite-dev template for E2B provider
install-cloudrouter-dev:
	@echo "Building and installing cloudrouter (dev mode)..."
	$(MAKE) -C packages/cloudrouter install-dev VERSION=$(CLOUDROUTER_DEV_VERSION)
	@echo ""
	@echo "Verifying auth..."
	@if cloudrouter whoami 2>/dev/null | grep -q "User:"; then \
		cloudrouter whoami; \
		echo ""; \
		echo "cloudrouter ready!"; \
		echo ""; \
		echo "  cloudrouter start .           # uses cmux-devbox-lite-dev (dev build default)"; \
		echo "  cloudrouter start . -p e2b    # uses cmux-devbox-lite-dev (E2B provider)"; \
		echo ""; \
		echo "To force production template: CLOUDROUTER_DEV_MODE=0 cloudrouter start ."; \
	else \
		echo "Not logged in."; \
		echo ""; \
		echo "Options:"; \
		echo "  1. Add CLOUDROUTER_REFRESH_TOKEN to .env (recommended for dev)"; \
		echo "  2. Or run 'cloudrouter login' (requires dev server: make dev)"; \
	fi

# Build and install devsh CLI (dev mode) to ~/.local/bin
install-devsh-dev:
	@echo "Building and installing devsh (dev mode)..."
	$(MAKE) -C packages/devsh install-dev
	@echo ""
	@echo "devsh ready! Run: devsh --help"

# Build and install devsh CLI (production mode) to ~/.local/bin
# Reads config from .env.production, bakes production API URLs into binary
# Version is read from packages/devsh/npm/devsh/package.json
install-devsh-prod:
	@ENV_FILE="$(ENV_FILE_PROD)"; \
	if [ ! -f "$$ENV_FILE" ]; then \
		echo "Error: $$ENV_FILE not found"; \
		exit 1; \
	fi; \
	set -a; . "$$ENV_FILE"; set +a; \
	STACK_PROJECT_ID="$$NEXT_PUBLIC_STACK_PROJECT_ID"; \
	STACK_PUBLISHABLE_CLIENT_KEY="$$NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"; \
	CMUX_API_URL="$$BASE_APP_URL"; \
	CMUX_SERVER_URL="$$NEXT_PUBLIC_SERVER_ORIGIN"; \
	CONVEX_SITE_URL="$$CONVEX_SITE_URL"; \
	if [ -z "$$CONVEX_SITE_URL" ] && [ -n "$$NEXT_PUBLIC_CONVEX_URL" ]; then \
		CONVEX_SITE_URL="$$(printf '%s' "$$NEXT_PUBLIC_CONVEX_URL" | sed 's/\.convex\.cloud/.convex.site/g')"; \
	fi; \
	VERSION="$$(node -pe "require('./packages/devsh/npm/devsh/package.json').version")"; \
	if [ -z "$$VERSION" ]; then \
		echo "Error: Failed to read version from packages/devsh/npm/devsh/package.json"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PROJECT_ID" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PROJECT_ID is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PUBLISHABLE_CLIENT_KEY" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_API_URL" ]; then \
		echo "Error: BASE_APP_URL is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CONVEX_SITE_URL" ]; then \
		echo "Error: CONVEX_SITE_URL could not be resolved from CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_SERVER_URL" ]; then \
		echo "Error: NEXT_PUBLIC_SERVER_ORIGIN is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	echo "Building devsh (production mode, VERSION=$$VERSION)..."; \
	env -i PATH="$$PATH" HOME="$$HOME" TERM="$$TERM" \
	$(MAKE) -C packages/devsh install-prod \
		STACK_PROJECT_ID="$$STACK_PROJECT_ID" \
		STACK_PUBLISHABLE_CLIENT_KEY="$$STACK_PUBLISHABLE_CLIENT_KEY" \
		CMUX_API_URL="$$CMUX_API_URL" \
		CONVEX_SITE_URL="$$CONVEX_SITE_URL" \
		CMUX_SERVER_URL="$$CMUX_SERVER_URL" \
		VERSION="$$VERSION"

# Start Chrome with remote debugging on port 9222 (for CDP/MCP)
chrome-debug:
	@chmod +x scripts/chrome-debug.sh
	./scripts/chrome-debug.sh

sync-upstream-tags:
	./scripts/sync-upstream-tags.sh

clone-proxy-linux-amd64:
	cd scripts/pve/clone-proxy && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/pve-clone-proxy .
	@echo "Built linux/amd64 proxy to /tmp/pve-clone-proxy"

clone-proxy-linux-arm64:
	cd scripts/pve/clone-proxy && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o /tmp/pve-clone-proxy .
	@echo "Built linux/arm64 proxy to /tmp/pve-clone-proxy"

# Screenshot Collector Upload
# Uploads the host-screenshot-collector to Convex file storage
# The collector is downloaded by preview jobs to capture screenshots

screenshot-collector-upload:
	@echo "Uploading screenshot collector to local Convex..."
	@CONVEX_URL=$$(grep -E '^NEXT_PUBLIC_CONVEX_URL=' $(ENV_FILE) | head -1 | cut -d'=' -f2 | sed 's/.convex.cloud/.convex.site/'); \
	if [ -z "$$CONVEX_URL" ]; then \
		echo "Error: NEXT_PUBLIC_CONVEX_URL not found in $(ENV_FILE)"; \
		exit 1; \
	fi; \
	echo "Using Convex URL: $$CONVEX_URL"; \
	cd packages/host-screenshot-collector && CONVEX_URL="$$CONVEX_URL" ./scripts/upload-to-convex.sh

screenshot-collector-upload-prod:
	@echo "Uploading screenshot collector to production Convex..."
	@test -f "$(ENV_FILE_PROD)" || (echo "Error: $(ENV_FILE_PROD) not found" && exit 1)
	@CONVEX_URL=$$(grep -E '^NEXT_PUBLIC_CONVEX_URL=' $(ENV_FILE_PROD) | head -1 | cut -d'=' -f2 | sed 's/.convex.cloud/.convex.site/'); \
	if [ -z "$$CONVEX_URL" ]; then \
		echo "Error: NEXT_PUBLIC_CONVEX_URL not found in $(ENV_FILE_PROD)"; \
		exit 1; \
	fi; \
	echo "Using Convex URL: $$CONVEX_URL"; \
	cd packages/host-screenshot-collector && CONVEX_URL="$$CONVEX_URL" ./scripts/upload-to-convex.sh --production

# Cloudrouter npm republish using production env file
cloudrouter-npm-republish-prod-dry:
	@ENV_FILE="$(ENV_FILE_PROD)"; \
	if [ ! -f "$$ENV_FILE" ]; then \
		echo "Error: $$ENV_FILE not found"; \
		exit 1; \
	fi; \
	set -a; . "$$ENV_FILE"; set +a; \
	STACK_PROJECT_ID="$$NEXT_PUBLIC_STACK_PROJECT_ID"; \
	STACK_PUBLISHABLE_CLIENT_KEY="$$NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"; \
	CMUX_API_URL="$$BASE_APP_URL"; \
	CONVEX_SITE_URL="$$CONVEX_SITE_URL"; \
	if [ -z "$$CONVEX_SITE_URL" ] && [ -n "$$NEXT_PUBLIC_CONVEX_URL" ]; then \
		CONVEX_SITE_URL="$$(printf '%s' "$$NEXT_PUBLIC_CONVEX_URL" | sed 's/\.convex\.cloud/.convex.site/g')"; \
	fi; \
	VERSION="$$CLOUDROUTER_NPM_VERSION"; \
	if [ -z "$$VERSION" ]; then \
		VERSION="$$(node -pe "require('./packages/cloudrouter/npm/cloudrouter/package.json').version")"; \
	fi; \
	if [ -z "$$STACK_PROJECT_ID" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PROJECT_ID is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PUBLISHABLE_CLIENT_KEY" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_API_URL" ]; then \
		echo "Error: BASE_APP_URL is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CONVEX_SITE_URL" ]; then \
		echo "Error: CONVEX_SITE_URL could not be resolved from CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$VERSION" ]; then \
		echo "Error: unable to resolve VERSION from CLOUDROUTER_NPM_VERSION or packages/cloudrouter/npm/cloudrouter/package.json"; \
		exit 1; \
	fi; \
	echo "Running cloudrouter npm dry-run publish (VERSION=$$VERSION)"; \
	env -i PATH="$$PATH" HOME="$$HOME" TERM="$$TERM" \
	$(MAKE) -C packages/cloudrouter npm-publish-cloudrouter-dry \
		STACK_PROJECT_ID="$$STACK_PROJECT_ID" \
		STACK_PUBLISHABLE_CLIENT_KEY="$$STACK_PUBLISHABLE_CLIENT_KEY" \
		CMUX_API_URL="$$CMUX_API_URL" \
		CONVEX_SITE_URL="$$CONVEX_SITE_URL" \
		VERSION="$$VERSION"

cloudrouter-npm-republish-prod:
	@ENV_FILE="$(ENV_FILE_PROD)"; \
	if [ ! -f "$$ENV_FILE" ]; then \
		echo "Error: $$ENV_FILE not found"; \
		exit 1; \
	fi; \
	set -a; . "$$ENV_FILE"; set +a; \
	STACK_PROJECT_ID="$$NEXT_PUBLIC_STACK_PROJECT_ID"; \
	STACK_PUBLISHABLE_CLIENT_KEY="$$NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"; \
	CMUX_API_URL="$$BASE_APP_URL"; \
	CONVEX_SITE_URL="$$CONVEX_SITE_URL"; \
	if [ -z "$$CONVEX_SITE_URL" ] && [ -n "$$NEXT_PUBLIC_CONVEX_URL" ]; then \
		CONVEX_SITE_URL="$$(printf '%s' "$$NEXT_PUBLIC_CONVEX_URL" | sed 's/\.convex\.cloud/.convex.site/g')"; \
	fi; \
	VERSION="$$CLOUDROUTER_NPM_VERSION"; \
	if [ -z "$$VERSION" ]; then \
		VERSION="$$(node -pe "require('./packages/cloudrouter/npm/cloudrouter/package.json').version")"; \
	fi; \
	if [ -z "$$STACK_PROJECT_ID" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PROJECT_ID is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PUBLISHABLE_CLIENT_KEY" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_API_URL" ]; then \
		echo "Error: BASE_APP_URL is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CONVEX_SITE_URL" ]; then \
		echo "Error: CONVEX_SITE_URL could not be resolved from CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$VERSION" ]; then \
		echo "Error: unable to resolve VERSION from CLOUDROUTER_NPM_VERSION or packages/cloudrouter/npm/cloudrouter/package.json"; \
		exit 1; \
	fi; \
	echo "Running cloudrouter npm live publish (VERSION=$$VERSION)"; \
	env -i PATH="$$PATH" HOME="$$HOME" TERM="$$TERM" \
	$(MAKE) -C packages/cloudrouter npm-publish-cloudrouter \
		STACK_PROJECT_ID="$$STACK_PROJECT_ID" \
		STACK_PUBLISHABLE_CLIENT_KEY="$$STACK_PUBLISHABLE_CLIENT_KEY" \
		CMUX_API_URL="$$CMUX_API_URL" \
		CONVEX_SITE_URL="$$CONVEX_SITE_URL" \
		VERSION="$$VERSION"

# devsh npm republish using production env file
devsh-npm-republish-prod-dry:
	@ENV_FILE="$(ENV_FILE_PROD)"; \
	if [ ! -f "$$ENV_FILE" ]; then \
		echo "Error: $$ENV_FILE not found"; \
		exit 1; \
	fi; \
	set -a; . "$$ENV_FILE"; set +a; \
	STACK_PROJECT_ID="$$NEXT_PUBLIC_STACK_PROJECT_ID"; \
	STACK_PUBLISHABLE_CLIENT_KEY="$$NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"; \
	CMUX_API_URL="$$BASE_APP_URL"; \
	CMUX_SERVER_URL="$$NEXT_PUBLIC_SERVER_ORIGIN"; \
	CONVEX_SITE_URL="$$CONVEX_SITE_URL"; \
	if [ -z "$$CONVEX_SITE_URL" ] && [ -n "$$NEXT_PUBLIC_CONVEX_URL" ]; then \
		CONVEX_SITE_URL="$$(printf '%s' "$$NEXT_PUBLIC_CONVEX_URL" | sed 's/\\.convex\\.cloud/.convex.site/g')"; \
	fi; \
	VERSION="$$DEVSH_NPM_VERSION"; \
	if [ -z "$$VERSION" ]; then \
		VERSION="$$(node -pe "require('./packages/devsh/npm/devsh/package.json').version")"; \
	fi; \
	if [ -z "$$STACK_PROJECT_ID" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PROJECT_ID is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PUBLISHABLE_CLIENT_KEY" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_API_URL" ]; then \
		echo "Error: BASE_APP_URL is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CONVEX_SITE_URL" ]; then \
		echo "Error: CONVEX_SITE_URL could not be resolved from CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_SERVER_URL" ]; then \
		echo "Error: NEXT_PUBLIC_SERVER_ORIGIN is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$VERSION" ]; then \
		echo "Error: unable to resolve VERSION from DEVSH_NPM_VERSION or packages/devsh/npm/devsh/package.json"; \
		exit 1; \
	fi; \
	echo "Running devsh npm dry-run publish (VERSION=$$VERSION)"; \
	env -i PATH="$$PATH" HOME="$$HOME" TERM="$$TERM" \
	$(MAKE) -C packages/devsh npm-publish-devsh-dry \
		STACK_PROJECT_ID="$$STACK_PROJECT_ID" \
		STACK_PUBLISHABLE_CLIENT_KEY="$$STACK_PUBLISHABLE_CLIENT_KEY" \
		CMUX_API_URL="$$CMUX_API_URL" \
		CONVEX_SITE_URL="$$CONVEX_SITE_URL" \
		CMUX_SERVER_URL="$$CMUX_SERVER_URL" \
		VERSION="$$VERSION"

devsh-npm-republish-prod:
	@ENV_FILE="$(ENV_FILE_PROD)"; \
	if [ ! -f "$$ENV_FILE" ]; then \
		echo "Error: $$ENV_FILE not found"; \
		exit 1; \
	fi; \
	set -a; . "$$ENV_FILE"; set +a; \
	STACK_PROJECT_ID="$$NEXT_PUBLIC_STACK_PROJECT_ID"; \
	STACK_PUBLISHABLE_CLIENT_KEY="$$NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"; \
	CMUX_API_URL="$$BASE_APP_URL"; \
	CMUX_SERVER_URL="$$NEXT_PUBLIC_SERVER_ORIGIN"; \
	CONVEX_SITE_URL="$$CONVEX_SITE_URL"; \
	if [ -z "$$CONVEX_SITE_URL" ] && [ -n "$$NEXT_PUBLIC_CONVEX_URL" ]; then \
		CONVEX_SITE_URL="$$(printf '%s' "$$NEXT_PUBLIC_CONVEX_URL" | sed 's/\\.convex\\.cloud/.convex.site/g')"; \
	fi; \
	VERSION="$$DEVSH_NPM_VERSION"; \
	if [ -z "$$VERSION" ]; then \
		VERSION="$$(node -pe "require('./packages/devsh/npm/devsh/package.json').version")"; \
	fi; \
	if [ -z "$$STACK_PROJECT_ID" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PROJECT_ID is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$STACK_PUBLISHABLE_CLIENT_KEY" ]; then \
		echo "Error: NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_API_URL" ]; then \
		echo "Error: BASE_APP_URL is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CONVEX_SITE_URL" ]; then \
		echo "Error: CONVEX_SITE_URL could not be resolved from CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$CMUX_SERVER_URL" ]; then \
		echo "Error: NEXT_PUBLIC_SERVER_ORIGIN is required in $$ENV_FILE"; \
		exit 1; \
	fi; \
	if [ -z "$$VERSION" ]; then \
		echo "Error: unable to resolve VERSION from DEVSH_NPM_VERSION or packages/devsh/npm/devsh/package.json"; \
		exit 1; \
	fi; \
	echo "Running devsh npm live publish (VERSION=$$VERSION)"; \
	env -i PATH="$$PATH" HOME="$$HOME" TERM="$$TERM" \
	$(MAKE) -C packages/devsh npm-publish-devsh \
		STACK_PROJECT_ID="$$STACK_PROJECT_ID" \
		STACK_PUBLISHABLE_CLIENT_KEY="$$STACK_PUBLISHABLE_CLIENT_KEY" \
		CMUX_API_URL="$$CMUX_API_URL" \
		CONVEX_SITE_URL="$$CONVEX_SITE_URL" \
		CMUX_SERVER_URL="$$CMUX_SERVER_URL" \
		VERSION="$$VERSION"
