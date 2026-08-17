#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?Configured private Release token is required}"
: "${SOURCE_REPO:?SOURCE_REPO is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"

DEST_DIR="${1:-existing-release}"
mkdir -p "$DEST_DIR"

API_ROOT="https://api.github.com"
AUTH_HEADER="Authorization: Bearer ${GH_TOKEN}"
ACCEPT_HEADER="Accept: application/vnd.github+json"
API_VERSION_HEADER="X-GitHub-Api-Version: 2022-11-28"

# Bounded recovery receipt for the already-produced d094 immutable Runtime Release.
# This receipt does not create a second Release/OTA authority: it is only used when
# GitHub's tag/ref or Release lookup endpoints deny access while the exact asset-ID
# endpoint remains readable. The downloaded bundle is still reverified by the
# existing metadata/hash/signer/package gates before any R2 mutation.
RECOVERY_TAG="builder-v1-runtime-candidate-d094591d03c1-run-32030194094"
RECOVERY_RELEASE_ID="371741295"
RECOVERY_BUNDLE_ASSET_ID="518085617"
RECOVERY_UPDATE_ASSET_ID="518085618"
RECOVERY_METADATA_ASSET_ID="518085619"
RECOVERY_SUMS_ASSET_ID="518085616"
RECOVERY_BUNDLE_NAME="MoreFunOS-SMT-runtime-candidate-d094591d03c1.mfos"
RECOVERY_BUNDLE_BYTES="649319"
RECOVERY_BUNDLE_SHA256="f455b286f6ab85437af584edc6c2be66f36e1351c578f12c89e56801c2a9f4b1"
use_recovery_receipt=false

repo_body="$RUNNER_TEMP/existing-runtime-repo.json"
repo_status="$(curl --silent --show-error --location \
  --output "$repo_body" \
  --write-out '%{http_code}' \
  --header "$AUTH_HEADER" \
  --header "$ACCEPT_HEADER" \
  --header "$API_VERSION_HEADER" \
  "$API_ROOT/repos/$SOURCE_REPO")"
if [[ "$repo_status" != "200" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_REPO_ACCESS_FAILED::Configured private Release token cannot read SOURCE_REPO (HTTP $repo_status). Check token expiry and repository selection. No R2 mutation was attempted."
  exit 20
fi

echo "Existing private source repository metadata access: PASS"

ref_body="$RUNNER_TEMP/existing-runtime-tag-ref.json"
ref_status="$(curl --silent --show-error --location \
  --output "$ref_body" \
  --write-out '%{http_code}' \
  --header "$AUTH_HEADER" \
  --header "$ACCEPT_HEADER" \
  --header "$API_VERSION_HEADER" \
  "$API_ROOT/repos/$SOURCE_REPO/git/ref/tags/$RELEASE_TAG")"
if [[ "$ref_status" == "403" && "$RELEASE_TAG" == "$RECOVERY_TAG" ]]; then
  echo "::notice title=RUNTIME_EXISTING_RELEASE_D094_RECEIPT_FALLBACK::GitHub tag-ref lookup returned HTTP 403 for the verified d094 Release. Using the locked asset receipt; no R2 mutation has occurred."
  use_recovery_receipt=true
elif [[ "$ref_status" == "403" || "$ref_status" == "401" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_CONTENTS_ACCESS_FAILED::Repository metadata is readable, but Contents-backed tag-ref access is denied (HTTP $ref_status). No verified receipt exists for this tag. No R2 mutation was attempted."
  exit 26
elif [[ "$ref_status" != "200" && "$ref_status" != "404" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_TAG_REF_CHECK_FAILED::Exact tag-ref check returned HTTP $ref_status. No R2 mutation was attempted."
  exit 27
elif [[ "$ref_status" == "200" ]]; then
  resolved_ref="$(jq -r '.ref // empty' "$ref_body")"
  if [[ "$resolved_ref" != "refs/tags/$RELEASE_TAG" ]]; then
    echo "::error title=RUNTIME_EXISTING_RELEASE_TAG_REF_IDENTITY_INVALID::Tag-ref lookup returned an unexpected identity. No R2 mutation was attempted."
    exit 28
  fi
  echo "::notice title=RUNTIME_EXISTING_RELEASE_TAG_REF_PASS::Exact Runtime tag ref exists and is readable with the configured private Release token."
  echo "Existing private Runtime tag ref: PASS"
else
  echo "::warning title=RUNTIME_EXISTING_RELEASE_TAG_REF_NOT_FOUND::Exact Runtime tag ref returned HTTP 404. Release API will be checked independently; no R2 mutation has occurred."
  echo "Existing private Runtime tag ref: NOT FOUND; checking Release API independently"
fi

if [[ "$use_recovery_receipt" != "true" ]]; then
  release_body="$RUNNER_TEMP/existing-runtime-release.json"
  release_status="$(curl --silent --show-error --location \
    --output "$release_body" \
    --write-out '%{http_code}' \
    --header "$AUTH_HEADER" \
    --header "$ACCEPT_HEADER" \
    --header "$API_VERSION_HEADER" \
    "$API_ROOT/repos/$SOURCE_REPO/releases/tags/$RELEASE_TAG")"
  if [[ "$release_status" == "403" && "$RELEASE_TAG" == "$RECOVERY_TAG" ]]; then
    echo "::notice title=RUNTIME_EXISTING_RELEASE_D094_RECEIPT_FALLBACK::GitHub Release-by-tag lookup returned HTTP 403 for the verified d094 Release. Using the locked asset receipt; no R2 mutation has occurred."
    use_recovery_receipt=true
  elif [[ "$release_status" != "200" ]]; then
    api_message="$(jq -r '.message // "no-message"' "$release_body" 2>/dev/null || printf 'unparseable-response')"
    echo "::error title=RUNTIME_EXISTING_RELEASE_LOOKUP_FAILED::Private repository access is valid, but the exact Runtime Release tag was not readable (HTTP $release_status; GitHub message: $api_message). No R2 mutation was attempted."
    exit 21
  else
    release_id="$(jq -r '.id // empty' "$release_body")"
    resolved_tag="$(jq -r '.tag_name // empty' "$release_body")"
    if [[ -z "$release_id" || "$resolved_tag" != "$RELEASE_TAG" ]]; then
      echo "::error title=RUNTIME_EXISTING_RELEASE_IDENTITY_INVALID::Release lookup returned an invalid identity. No R2 mutation was attempted."
      exit 25
    fi
    echo "Existing private Runtime Release lookup: PASS (release-id=$release_id)"
  fi
fi

if [[ "$use_recovery_receipt" == "true" ]]; then
  download_receipt_asset() {
    local asset_id="$1" asset_name="$2"
    local status
    status="$(curl --silent --show-error --location \
      --output "$DEST_DIR/$asset_name" \
      --write-out '%{http_code}' \
      --header "$AUTH_HEADER" \
      --header 'Accept: application/octet-stream' \
      --header "$API_VERSION_HEADER" \
      "$API_ROOT/repos/$SOURCE_REPO/releases/assets/$asset_id")"
    if [[ "$status" != "200" ]]; then
      echo "::error title=RUNTIME_EXISTING_RELEASE_RECEIPT_ASSET_DOWNLOAD_FAILED::Verified d094 receipt asset $asset_name could not be downloaded by asset ID (HTTP $status). No R2 mutation was attempted."
      exit 29
    fi
  }

  download_receipt_asset "$RECOVERY_BUNDLE_ASSET_ID" "$RECOVERY_BUNDLE_NAME"
  download_receipt_asset "$RECOVERY_UPDATE_ASSET_ID" "runtime-update.json"
  download_receipt_asset "$RECOVERY_METADATA_ASSET_ID" "runtime-build-metadata.json"
  download_receipt_asset "$RECOVERY_SUMS_ASSET_ID" "RUNTIME_SHA256SUMS"

  actual_bytes="$(stat -c%s "$DEST_DIR/$RECOVERY_BUNDLE_NAME")"
  actual_sha256="$(sha256sum "$DEST_DIR/$RECOVERY_BUNDLE_NAME" | awk '{print $1}')"
  if [[ "$actual_bytes" != "$RECOVERY_BUNDLE_BYTES" || "$actual_sha256" != "$RECOVERY_BUNDLE_SHA256" ]]; then
    echo "::error title=RUNTIME_EXISTING_RELEASE_RECEIPT_IDENTITY_FAILED::Downloaded d094 bundle does not match the locked receipt bytes/hash. No R2 mutation was attempted."
    exit 30
  fi
  echo "Existing private Runtime Release receipt download: PASS (release-id=$RECOVERY_RELEASE_ID)"
else
  if ! gh release download "$RELEASE_TAG" --repo "$SOURCE_REPO" --dir "$DEST_DIR" >/dev/null 2>&1; then
    if [[ "$RELEASE_TAG" == "$RECOVERY_TAG" ]]; then
      echo "::error title=RUNTIME_EXISTING_RELEASE_DOWNLOAD_FAILED::Normal private Release download failed after successful lookup. Re-run through the verified d094 receipt path rather than rebuilding. No R2 mutation was attempted."
    else
      echo "::error title=RUNTIME_EXISTING_RELEASE_DOWNLOAD_FAILED::The exact private Runtime Release exists but its assets could not be downloaded. No R2 mutation was attempted."
    fi
    exit 22
  fi
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
