#!/bin/bash
set -e

# Docker Hub repository
REPO="manaflow/cmux"

# Get version from package.json or use 'latest'
VERSION=${1:-latest}

# Build for current platform first (faster for testing)
echo "Building Docker image for current platform..."

# Add a build timestamp label to force a new layer (helps with push issues)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
IDE_DEPS_CHANNEL="${IDE_DEPS_CHANNEL:-stable}"
docker build \
    --build-arg IDE_DEPS_CHANNEL="${IDE_DEPS_CHANNEL}" \
    --label "build.version=${VERSION}" \
    --label "build.time=${BUILD_TIME}" \
    -t ${REPO}:${VERSION} \
    -t ${REPO}:latest \
    .

echo "Build complete!"
echo "To push: ./scripts/docker-push.sh ${VERSION}"
