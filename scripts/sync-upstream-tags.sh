#!/bin/bash
set -euo pipefail

# Sync tags from upstream and override latest release tag to fork's HEAD
# This ensures the release-pr workflow detects changes on your fork

echo "Fetching tags from upstream..."
git fetch upstream --tags --force

LATEST_TAG=$(git describe --tags --match "v[0-9]*" --abbrev=0 upstream/main 2>/dev/null || true)

if [ -z "$LATEST_TAG" ]; then
    echo "ERROR: No release tags found on upstream/main"
    exit 1
fi

echo "Latest upstream tag: $LATEST_TAG"

echo "Deleting local tag $LATEST_TAG (if exists)..."
git tag -d "$LATEST_TAG" 2>/dev/null || true

echo "Deleting remote tag $LATEST_TAG from origin (if exists)..."
git push origin ":refs/tags/$LATEST_TAG" 2>/dev/null || true

echo "Creating new tag $LATEST_TAG at HEAD..."
git tag "$LATEST_TAG" HEAD

echo "Pushing tag $LATEST_TAG to origin..."
git push origin "$LATEST_TAG"

echo "Done! Tag $LATEST_TAG now points to your HEAD"
