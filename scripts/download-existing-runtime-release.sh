#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?V1_SOURCE_READ_TOKEN is required}"
: "${SOURCE_REPO:?SOURCE_REPO is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"

DEST_DIR="${1:-existing-release}"
mkdir -p "$DEST_DIR"

if ! gh release view "$RELEASE_TAG" --repo "$SOURCE_REPO" --json tagName,isPrerelease --jq '.tagName' >/dev/null 2>&1; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_LOOKUP_FAILED::The exact private Runtime Release tag is not readable with V1_SOURCE_READ_TOKEN. No R2 mutation was attempted."
  exit 21
fi

echo "Existing private Runtime Release lookup: PASS"

if ! gh release download "$RELEASE_TAG" --repo "$SOURCE_REPO" --dir "$DEST_DIR" >/dev/null 2>&1; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_DOWNLOAD_FAILED::The exact private Runtime Release exists but its assets could not be downloaded. No R2 mutation was attempted."
  exit 22
fi

for required_asset in runtime-update.json runtime-build-metadata.json RUNTIME_SHA256SUMS; do
  if [[ ! -f "$DEST_DIR/$required_asset" ]]; then
    echo "::error title=RUNTIME_EXISTING_RELEASE_ASSET_MISSING::Required immutable Release asset is missing: $required_asset. No R2 mutation was attempted."
    exit 23
  fi
done

bundle_count="$(find "$DEST_DIR" -maxdepth 1 -type f -name '*.mfos' | wc -l | tr -d ' ')"
if [[ "$bundle_count" != "1" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_BUNDLE_CARDINALITY_INVALID::Expected exactly one signed .mfos Release asset; observed $bundle_count. No R2 mutation was attempted."
  exit 24
fi

echo "Existing private Runtime Release download: PASS"
