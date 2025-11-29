SHELL := /bin/bash

DEVCONTAINER_DIR := .devcontainer
COMPOSE_FILE := docker-compose.convex.yml
PROJECT_NAME := cmux-convex

.PHONY: convex-up convex-down convex-restart convex-clean convex-init convex-fresh dev

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
	@echo "🔧 Initializing Convex environment variables..."
	./scripts/setup-convex-env.sh

convex-fresh: convex-clean convex-up
	@echo "⏳ Waiting for containers to be ready..."
	@sleep 5
	@$(MAKE) convex-init
	@echo "🎉 Fresh Convex setup complete! Ready to deploy."

dev:
	./scripts/dev.sh --skip-docker --show-compose-logs --skip-convex
