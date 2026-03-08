# Makefile for cloudrouter CLI
# Primary npm package: @karlorz/cloudrouter

VERSION ?= 0.1.0
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

# Auth configuration (set via env or make arguments for production)
# These are baked into the binary via ldflags
STACK_PROJECT_ID ?=
STACK_PUBLISHABLE_CLIENT_KEY ?=
CMUX_API_URL ?=
CONVEX_SITE_URL ?=

# Package path for ldflags
AUTH_PKG := github.com/karlorz/cloudrouter/internal/auth

# Production ldflags - strips debug info, bakes in config
LDFLAGS := -s -w \
           -X main.Version=$(VERSION) \
           -X main.Commit=$(COMMIT) \
           -X main.BuildTime=$(BUILD_TIME) \
           -X main.Mode=prod \
           -X '$(AUTH_PKG).ProjectID=$(STACK_PROJECT_ID)' \
           -X '$(AUTH_PKG).PublishableKey=$(STACK_PUBLISHABLE_CLIENT_KEY)' \
           -X '$(AUTH_PKG).CmuxURL=$(CMUX_API_URL)' \
           -X '$(AUTH_PKG).ConvexSiteURL=$(CONVEX_SITE_URL)'

# Dev ldflags (uses Mode=dev which enables hardcoded dev defaults)
DEV_LDFLAGS := -s -w \
               -X main.Version=$(VERSION) \
               -X main.Commit=$(COMMIT) \
               -X main.BuildTime=$(BUILD_TIME) \
               -X main.Mode=dev

.PHONY: all build build-dev build-prod build-all \
        install install-dev clean test deps \
        npm-build npm-build-dev npm-version npm-publish npm-publish-dry \
        build-npm-cloudrouter build-npm-cloudrouter-dev npm-publish-cloudrouter npm-publish-cloudrouter-dry

# Default target
all: build

# =============================================================================
# Local Development Builds
# =============================================================================

# Development build (default for local dev)
build-dev:
	@echo "Building cloudrouter for development (Mode=dev)..."
	@echo "  API URL: $$(grep 'DevCmuxURL.*=' internal/auth/auth.go | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
	@echo "  Convex:  $$(grep 'DevConvexSiteURL.*=' internal/auth/auth.go | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
	go build -ldflags "$(DEV_LDFLAGS)" -o bin/cloudrouter ./cmd/cmux
	@echo "Dev build complete: bin/cloudrouter"

# Install dev build to user directory (no sudo needed)
install-dev: build-dev
	@mkdir -p ~/.local/bin
	@cp bin/cloudrouter ~/.local/bin/cloudrouter
	@echo "Installed to ~/.local/bin/cloudrouter"
	@# Check if ~/.local/bin is in PATH
	@if ! echo "$$PATH" | grep -q "$$HOME/.local/bin"; then \
		echo ""; \
		echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"; \
		echo '  export PATH="$$HOME/.local/bin:$$PATH"'; \
		echo ""; \
		echo "Or run now:"; \
		echo '  export PATH="$$HOME/.local/bin:$$PATH"'; \
	else \
		echo "Run 'cloudrouter --version' to verify."; \
	fi

# =============================================================================
# Production Builds
# =============================================================================

# Production build (requires credentials)
build: build-prod

build-prod:
	@echo "Building cloudrouter for production (Mode=prod)..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter ./cmd/cmux
	@echo "Production build complete: bin/cloudrouter"

# Install production build to system
install: build
	cp bin/cloudrouter /usr/local/bin/cloudrouter

# Cross-platform production builds
build-all:
	@echo "Building cloudrouter for all platforms..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter-darwin-amd64 ./cmd/cmux
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter-darwin-arm64 ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter-linux-amd64 ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter-linux-arm64 ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/cloudrouter-windows-amd64.exe ./cmd/cmux
	@echo "Done! Binaries in bin/"

# =============================================================================
# NPM Package Builds (@karlorz/cloudrouter)
# =============================================================================

# Build npm packages with dev mode (no credentials needed)
npm-build-dev:
	@echo "Building @karlorz/cloudrouter npm packages (dev mode)..."
	@mkdir -p npm/cloudrouter-darwin-arm64/bin \
	          npm/cloudrouter-darwin-x64/bin \
	          npm/cloudrouter-linux-arm64/bin \
	          npm/cloudrouter-linux-x64/bin \
	          npm/cloudrouter-win32-x64/bin \
	          npm/cloudrouter/lib
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/cloudrouter-darwin-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/cloudrouter-darwin-x64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/cloudrouter-linux-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/cloudrouter-linux-x64/bin/cloudrouter ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(DEV_LDFLAGS)" -o npm/cloudrouter-win32-x64/bin/cloudrouter.exe ./cmd/cmux
	@# Copy darwin-arm64 binary to lib/cloudrouter as fallback for bunx/npx
	@cp npm/cloudrouter-darwin-arm64/bin/cloudrouter npm/cloudrouter/lib/cloudrouter
	@chmod +x npm/cloudrouter/lib/cloudrouter npm/cloudrouter/bin/cloudrouter 2>/dev/null || true
	@echo "Done! Dev binaries built in npm/cloudrouter-*/bin/"
	@echo "  API URL: $$(grep 'DevCmuxURL.*=' internal/auth/auth.go | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
	@echo "  Convex:  $$(grep 'DevConvexSiteURL.*=' internal/auth/auth.go | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"

# Build npm packages for production
# Usage: make npm-build STACK_PROJECT_ID=... STACK_PUBLISHABLE_CLIENT_KEY=... CMUX_API_URL=... CONVEX_SITE_URL=...
npm-build:
	@echo "Building @karlorz/cloudrouter npm packages (production)..."
	@if [ -z "$(STACK_PROJECT_ID)" ]; then echo "Error: STACK_PROJECT_ID is required"; exit 1; fi
	@if [ -z "$(STACK_PUBLISHABLE_CLIENT_KEY)" ]; then echo "Error: STACK_PUBLISHABLE_CLIENT_KEY is required"; exit 1; fi
	@if [ -z "$(CMUX_API_URL)" ]; then echo "Error: CMUX_API_URL is required"; exit 1; fi
	@if [ -z "$(CONVEX_SITE_URL)" ]; then echo "Error: CONVEX_SITE_URL is required"; exit 1; fi
	@mkdir -p npm/cloudrouter-darwin-arm64/bin \
	          npm/cloudrouter-darwin-x64/bin \
	          npm/cloudrouter-linux-arm64/bin \
	          npm/cloudrouter-linux-x64/bin \
	          npm/cloudrouter-win32-x64/bin \
	          npm/cloudrouter/lib
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-darwin-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-darwin-x64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-linux-arm64/bin/cloudrouter ./cmd/cmux
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-linux-x64/bin/cloudrouter ./cmd/cmux
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o npm/cloudrouter-win32-x64/bin/cloudrouter.exe ./cmd/cmux
	@# Copy darwin-arm64 binary to lib/cloudrouter as fallback for bunx/npx
	@cp npm/cloudrouter-darwin-arm64/bin/cloudrouter npm/cloudrouter/lib/cloudrouter
	@chmod +x npm/cloudrouter/lib/cloudrouter npm/cloudrouter/bin/cloudrouter 2>/dev/null || true
	@echo "Done! Production binaries built in npm/cloudrouter-*/bin/"
	@# Verify binaries report correct version
	@echo "Verifying binary versions..."
	@EXPECTED="cloudrouter version $(VERSION)"; \
	for bin in npm/cloudrouter-darwin-arm64/bin/cloudrouter npm/cloudrouter-darwin-x64/bin/cloudrouter npm/cloudrouter/lib/cloudrouter; do \
		ACTUAL=$$($$bin --version 2>/dev/null || echo "failed"); \
		if [ "$$ACTUAL" != "$$EXPECTED" ]; then \
			echo "ERROR: $$bin reports '$$ACTUAL' but expected '$$EXPECTED'"; \
			exit 1; \
		fi; \
	done
	@echo "All binaries verified at version $(VERSION)"

# Update version in all npm package.json files
npm-version:
	@echo "Updating @karlorz/cloudrouter package versions to $(VERSION)..."
	@for pkg in cloudrouter cloudrouter-darwin-arm64 cloudrouter-darwin-x64 cloudrouter-linux-arm64 cloudrouter-linux-x64 cloudrouter-win32-x64; do \
		if [ -f "npm/$$pkg/package.json" ]; then \
			sed -i '' 's/"version": "[^"]*"/"version": "$(VERSION)"/' npm/$$pkg/package.json; \
			if [ "$$pkg" = "cloudrouter" ]; then \
				sed -i '' 's/"@karlorz\/cloudrouter-darwin-arm64": "[^"]*"/"@karlorz\/cloudrouter-darwin-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"@karlorz\/cloudrouter-darwin-x64": "[^"]*"/"@karlorz\/cloudrouter-darwin-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"@karlorz\/cloudrouter-linux-arm64": "[^"]*"/"@karlorz\/cloudrouter-linux-arm64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"@karlorz\/cloudrouter-linux-x64": "[^"]*"/"@karlorz\/cloudrouter-linux-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
				sed -i '' 's/"@karlorz\/cloudrouter-win32-x64": "[^"]*"/"@karlorz\/cloudrouter-win32-x64": "$(VERSION)"/' npm/$$pkg/package.json; \
			fi; \
		fi; \
	done
	@echo "Done! Updated to version $(VERSION)"

# Publish @karlorz/cloudrouter to npm (requires npm-build first)
npm-publish: npm-build
	@echo "Publishing @karlorz/cloudrouter v$(VERSION) to npm..."
	@echo ""
	@echo "Step 1/2: Publishing platform packages..."
	cd npm/cloudrouter-darwin-arm64 && npm publish --access public
	cd npm/cloudrouter-darwin-x64 && npm publish --access public
	cd npm/cloudrouter-linux-arm64 && npm publish --access public
	cd npm/cloudrouter-linux-x64 && npm publish --access public
	cd npm/cloudrouter-win32-x64 && npm publish --access public
	@echo ""
	@echo "Step 2/2: Publishing main package..."
	cd npm/cloudrouter && npm publish --access public
	@echo ""
	@echo "Published @karlorz/cloudrouter v$(VERSION)"
	@echo "Install with: npm install -g @karlorz/cloudrouter"

# Dry-run publish (for testing)
npm-publish-dry: npm-build
	@echo "Dry-run publishing @karlorz/cloudrouter v$(VERSION)..."
	cd npm/cloudrouter-darwin-arm64 && npm publish --access public --dry-run
	cd npm/cloudrouter-darwin-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter-linux-arm64 && npm publish --access public --dry-run
	cd npm/cloudrouter-linux-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter-win32-x64 && npm publish --access public --dry-run
	cd npm/cloudrouter && npm publish --access public --dry-run
	@echo "Dry-run complete!"

# =============================================================================
# Aliases (for compatibility with root Makefile)
# =============================================================================

# These aliases allow the root Makefile targets to work unchanged
build-npm-cloudrouter: npm-build
build-npm-cloudrouter-dev: npm-build-dev
npm-publish-cloudrouter: npm-publish
npm-publish-cloudrouter-dry: npm-publish-dry

# =============================================================================
# Utilities
# =============================================================================

clean:
	rm -rf bin/
	rm -f npm/cloudrouter-*/bin/cloudrouter npm/cloudrouter-*/bin/cloudrouter.exe
	rm -f npm/cloudrouter/lib/cloudrouter

test:
	go test -v ./...

deps:
	go mod download
	go mod tidy

# Show current configuration
info:
	@echo "cloudrouter Makefile"
	@echo "===================="
	@echo "VERSION:  $(VERSION)"
	@echo "COMMIT:   $(COMMIT)"
	@echo "BUILD:    $(BUILD_TIME)"
	@echo ""
	@echo "Production config (from env):"
	@echo "  STACK_PROJECT_ID:             $(if $(STACK_PROJECT_ID),set,NOT SET)"
	@echo "  STACK_PUBLISHABLE_CLIENT_KEY: $(if $(STACK_PUBLISHABLE_CLIENT_KEY),set,NOT SET)"
	@echo "  CMUX_API_URL:                 $(if $(CMUX_API_URL),$(CMUX_API_URL),NOT SET)"
	@echo "  CONVEX_SITE_URL:              $(if $(CONVEX_SITE_URL),$(CONVEX_SITE_URL),NOT SET)"

# Help
help:
	@echo "cloudrouter Makefile targets:"
	@echo ""
	@echo "Local Development:"
	@echo "  make build-dev     Build dev binary (uses hardcoded dev defaults)"
	@echo "  make install-dev   Install dev binary to /usr/local/bin"
	@echo ""
	@echo "Production:"
	@echo "  make build-prod    Build production binary (requires env vars)"
	@echo "  make build-all     Build for all platforms"
	@echo "  make install       Install production binary"
	@echo ""
	@echo "NPM Publishing (@karlorz/cloudrouter):"
	@echo "  make npm-build-dev   Build npm packages (dev mode)"
	@echo "  make npm-build       Build npm packages (production)"
	@echo "  make npm-version     Update version in package.json files"
	@echo "  make npm-publish-dry Dry-run npm publish"
	@echo "  make npm-publish     Publish to npm"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean         Remove built binaries"
	@echo "  make test          Run tests"
	@echo "  make deps          Download and tidy dependencies"
	@echo "  make info          Show build configuration"
	@echo ""
	@echo "Required env vars for production builds:"
	@echo "  STACK_PROJECT_ID, STACK_PUBLISHABLE_CLIENT_KEY,"
	@echo "  CMUX_API_URL, CONVEX_SITE_URL"
