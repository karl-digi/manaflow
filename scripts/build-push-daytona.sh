#!/bin/bash

set -e  # Exit on error

BASE_NAME="cmux-worker"
IDE_DEPS_CHANNEL="${IDE_DEPS_CHANNEL:-stable}"

echo "Finding latest version from Docker images..."

# Get all tags for the base image name, extract version numbers, and find the highest
LATEST_VERSION=$(docker images --format "table {{.Repository}}:{{.Tag}}" | \
    grep "^$BASE_NAME:" | \
    sed "s/^$BASE_NAME://" | \
    grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | \
    sort -V | \
    tail -n 1)

# If no version found, start with 0.0.0 (will be incremented to 0.0.1)
if [ -z "$LATEST_VERSION" ]; then
    echo "No existing versions found, starting with 0.0.1"
    NEW_VERSION="0.0.1"
else
    echo "Latest version found: $LATEST_VERSION"
    
    # Parse version components
    IFS='.' read -r MAJOR MINOR PATCH <<< "$LATEST_VERSION"
    
    # Increment patch version
    PATCH=$((PATCH + 1))
    NEW_VERSION="$MAJOR.$MINOR.$PATCH"
fi

echo "New version: $NEW_VERSION"

# Set image name with new version
IMAGE_NAME="$BASE_NAME:$NEW_VERSION"

echo "Building image: $IMAGE_NAME"

# Build the image with specified platform
docker build -t "$IMAGE_NAME" --platform=linux/amd64 --build-arg IDE_DEPS_CHANNEL="${IDE_DEPS_CHANNEL}" .

echo "Pushing to Daytona..."

# Push the image to Daytona
daytona snapshot push "$IMAGE_NAME" -n "$IMAGE_NAME"

echo "Successfully built and pushed $IMAGE_NAME"
