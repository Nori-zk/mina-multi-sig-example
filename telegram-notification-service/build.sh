#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(grep -o '"version": "[^"]*"' "package.json" | sed 's/"version": "//;s/"$//')

if [[ -z "$VERSION" ]]; then
  echo "Error: Version not found in package.json"
  exit 1
fi

IMAGE_NAME="telegram-multisig-ceremony-notification-service"
REGISTRY="${REGISTRY:-0x6a6f6e6e79}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"

# Setup for cross-compilation
TEMP_BUILDER="multiarch-builder-$$"
CURRENT_BUILDER="$(docker buildx ls 2>/dev/null | awk '/\*/{print $1; exit}' || true)"

cleanup() {
  rc=$?
  echo "Cleaning up..."

  # restore previous builder if we have one
  if [[ -n "$CURRENT_BUILDER" ]]; then
    echo "Restoring previous buildx builder: $CURRENT_BUILDER"
    docker buildx use "$CURRENT_BUILDER" >/dev/null 2>&1 || true
  else
    # try to switch back to default if available
    docker buildx use default >/dev/null 2>&1 || true
  fi

  # remove the temporary builder we created
  echo "Removing temporary builder: $TEMP_BUILDER"
  docker buildx rm "$TEMP_BUILDER" >/dev/null 2>&1 || true

  exit $rc
}

trap cleanup EXIT INT TERM

# Register QEMU
echo "Registering QEMU (idempotent)..."
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes >/dev/null 2>&1 || true

# Create and use temporary builder
echo "Creating temporary buildx builder: $TEMP_BUILDER (driver: docker-container)"
docker buildx create --name "$TEMP_BUILDER" --driver docker-container --use

echo "Bootstrapping the builder..."
docker buildx inspect --bootstrap

# Build both architectures
echo "Building amd64 image..."
docker buildx build \
  --platform linux/amd64 \
  --tag "${FULL_IMAGE}:${VERSION}-amd64" \
  --output type=docker \
  .

echo "Building arm64 image..."
docker buildx build \
  --platform linux/arm64 \
  --tag "${FULL_IMAGE}:${VERSION}-arm64" \
  --output type=docker \
  .

echo "Built locally:"
echo "   ${FULL_IMAGE}:${VERSION}-amd64"
echo "   ${FULL_IMAGE}:${VERSION}-arm64"