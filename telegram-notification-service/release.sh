#!/bin/bash
set -euo pipefail

# Step 1: Get the directory where the script is located (absolute path)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Step 2: Navigate to the script directory
cd "$SCRIPT_DIR"

# Step 3: Extract version from package.json
VERSION=$(grep -o '"version": "[^"]*"' "package.json" | sed 's/"version": "//;s/"$//')

# Check if the version was extracted successfully
if [[ -z "$VERSION" ]]; then
  echo "Error: Version not found in package.json"
  exit 1
fi

# Step 4: Define the image name and registry
IMAGE_NAME="telegram-multisig-ceremony-notification-service"
REGISTRY="${REGISTRY:-0x6a6f6e6e79}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"

# Step 5: Push arch-specific images to registry
echo "Pushing arch-specific images..."
docker push "${FULL_IMAGE}:${VERSION}-amd64"
docker push "${FULL_IMAGE}:${VERSION}-arm64"

# Step 6: Create multi-arch manifest for versioned tag
echo "Creating multi-arch manifest for version ${VERSION}..."
docker buildx imagetools create \
  --tag "${FULL_IMAGE}:${VERSION}" \
  "${FULL_IMAGE}:${VERSION}-amd64" \
  "${FULL_IMAGE}:${VERSION}-arm64"

# Step 7: Create multi-arch manifest for latest tag
echo "Creating multi-arch manifest for latest..."
docker buildx imagetools create \
  --tag "${FULL_IMAGE}:latest" \
  "${FULL_IMAGE}:${VERSION}-amd64" \
  "${FULL_IMAGE}:${VERSION}-arm64"

echo "Released:"
echo "   ${FULL_IMAGE}:${VERSION}"
echo "   ${FULL_IMAGE}:latest"