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
if [[ "$ref_status" == "403" || "$ref_status" == "401" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_CONTENTS_ACCESS_FAILED::Repository metadata is readable, but Contents-backed tag-ref access is denied (HTTP $ref_status). Refresh V1_ARTIFACT_DELIVERY_TOKEN repository Contents permission/access. No R2 mutation was attempted."
  exit 26
fi
if [[ "$ref_status" != "200" && "$ref_status" != "404" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_TAG_REF_CHECK_FAILED::Exact tag-ref check returned HTTP $ref_status. No R2 mutation was attempted."
  exit 27
fi
if [[ "$ref_status" == "200" ]]; then
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

release_body="$RUNNER_TEMP/existing-runtime-release.json"
release_status="$(curl --silent --show-error --location \
  --output "$release_body" \
  --write-out '%{http_code}' \
  --header "$AUTH_HEADER" \
  --header "$ACCEPT_HEADER" \
  --header "$API_VERSION_HEADER" \
  "$API_ROOT/repos/$SOURCE_REPO/releases/tags/$RELEASE_TAG")"
if [[ "$release_status" != "200" ]]; then
  api_message="$(jq -r '.message // "no-message"' "$release_body" 2>/dev/null || printf 'unparseable-response')"
  echo "::error title=RUNTIME_EXISTING_RELEASE_LOOKUP_FAILED::Private repository access is valid, but the exact Runtime Release tag was not readable (HTTP $release_status; GitHub message: $api_message). No R2 mutation was attempted."
  exit 21
fi

release_id="$(jq -r '.id // empty' "$release_body")"
resolved_tag="$(jq -r '.tag_name // empty' "$release_body")"
if [[ -z "$release_id" || "$resolved_tag" != "$RELEASE_TAG" ]]; then
  echo "::error title=RUNTIME_EXISTING_RELEASE_IDENTITY_INVALID::Release lookup returned an invalid identity. No R2 mutation was attempted."
  exit 25
fi

echo "Existing private Runtime Release lookup: PASS (release-id=$release_id)"

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
