#!/bin/bash
set -euo pipefail

# Sync tags from upstream and override latest release tag to fork's HEAD
# This ensures the release-pr workflow detects changes on your fork
# Also handles draft release cleanup and recreation

REPO="${GITHUB_REPO:-karlorz/cmux}"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: Working tree is dirty. Commit or stash changes before running." >&2
    exit 1
fi

echo "Fetching tags from upstream..."
git fetch upstream --tags --force

LATEST_TAG=$(git describe --tags --match "v[0-9]*" --abbrev=0 upstream/main 2>/dev/null || true)

if [ -z "$LATEST_TAG" ]; then
    echo "ERROR: No release tags found on upstream/main"
    exit 1
fi

echo "Latest upstream tag: $LATEST_TAG"
echo "Target repo: $REPO"

# Sync apps/client/package.json version with the upstream tag.
VERSION="${LATEST_TAG#v}"
echo "Setting apps/client/package.json version to $VERSION..."
cd apps/client
npm pkg set version="$VERSION"
cd - >/dev/null

if ! git diff --quiet -- apps/client/package.json; then
    git add apps/client/package.json
    git commit -m "chore: release $LATEST_TAG"
fi

# Check if a release exists for this tag and delete it
echo "Checking for existing release $LATEST_TAG..."
if gh release view "$LATEST_TAG" --repo "$REPO" &>/dev/null; then
    echo "Deleting existing release $LATEST_TAG..."
    gh release delete "$LATEST_TAG" --repo "$REPO" --yes
fi

echo "Deleting remote tag $LATEST_TAG from origin (if exists)..."
git push origin ":refs/tags/$LATEST_TAG" 2>/dev/null || true

echo "Deleting local tag $LATEST_TAG (if exists)..."
git tag -d "$LATEST_TAG" 2>/dev/null || true

echo "Creating new tag $LATEST_TAG at HEAD..."
git tag "$LATEST_TAG" HEAD

echo "Pushing tag $LATEST_TAG to origin..."
git push origin "$LATEST_TAG"

# Extract version number for title (remove 'v' prefix)
VERSION_TITLE="${LATEST_TAG#v}"

echo "Creating draft release $LATEST_TAG..."
gh release create "$LATEST_TAG" \
    --repo "$REPO" \
    --draft \
    --title "$VERSION_TITLE" \
    --generate-notes

echo "Done! Tag $LATEST_TAG now points to HEAD with draft release created"
echo "View release: https://github.com/$REPO/releases/tag/$LATEST_TAG"
