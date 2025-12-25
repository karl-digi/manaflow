SHELL := /bin/bash

DEVCONTAINER_DIR := .devcontainer
COMPOSE_FILE := docker-compose.convex.yml
PROJECT_NAME := cmux-convex

.PHONY: convex-up convex-down convex-restart convex-clean convex-init convex-init-prod convex-clear-prod convex-fresh dev dev-electron sync-upstream-tags

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
	@echo "🔧 Initializing Convex environment variables (local)..."
	./scripts/setup-convex-env.sh

convex-init-prod:
	@echo "🔧 Initializing Convex environment variables (production)..."
	./scripts/setup-convex-env.sh --prod

convex-clear-prod:
	@echo "⚠️  WARNING: This will DELETE ALL DATA from production Convex!"
	@echo "Press Ctrl+C within 5 seconds to cancel..."
	@sleep 5
	@echo "🗑️  Clearing all tables in production Convex..."
	@rm -rf /tmp/convex-empty && mkdir -p /tmp/convex-empty/dummy
	@touch /tmp/convex-empty/dummy/.gitkeep
	@cd /tmp/convex-empty && zip -r empty.zip dummy
	cd packages/convex && bunx convex import --env-file ../../.env.production --replace-all -y /tmp/convex-empty/empty.zip
	@rm -rf /tmp/convex-empty
	@echo "✅ Production database cleared"

convex-fresh: convex-clean convex-up
	@echo "⏳ Waiting for containers to be ready..."
	@sleep 5
	@$(MAKE) convex-init
	@echo "🎉 Fresh Convex setup complete! Ready to deploy."

dev:
	./scripts/dev.sh

dev-electron:
	./scripts/dev.sh --electron --electron-debug

sync-upstream-tags:
	./scripts/sync-upstream-tags.sh
