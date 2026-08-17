import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-release.yml';
const workflow = fs.readFileSync(path, 'utf8');
const onlinePublisherPath = 'scripts/publish-runtime-online.mjs';
const existingReleaseVerifierPath = 'scripts/verify-existing-runtime-release.mjs';
const onlinePublisher = fs.readFileSync(onlinePublisherPath, 'utf8');
const existingReleaseVerifier = fs.readFileSync(existingReleaseVerifierPath, 'utf8');

const staleRuntimeProductionPaths = [
  '.github/workflows/manual-runtime-ota.yml',
  '.github/workflows/publish-runtime.yml',
  '.github/workflows/runtime-online-publish.yml',
  'scripts/verify-runtime-ota-policy.mjs',
  'scripts/verify-runtime-ota-manifest-contract.mjs',
];
for (const stalePath of staleRuntimeProductionPaths) {
  if (fs.existsSync(stalePath)) throw new Error(`RUNTIME_RELEASE_SECOND_PRODUCTION_AUTHORITY_FORBIDDEN:${stalePath}`);
}

const required = [
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "MIN_CARRIER_VERSION_CODE: '21'",
  'RUNTIME_VERSION="${RELEASE_ID}"',
  'V1_ARTIFACT_DELIVERY_TOKEN',
  'GH_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  'GH_TOKEN: ${{ secrets.V1_SOURCE_READ_TOKEN }}',
  '--repo "$SOURCE_REPO"',
  '--target "$NORMALIZED_SOURCE_SHA"',
  'run_stage "runtime-g6-static" npm run test:g6',
  'run_stage "runtime-smt-web-tests" npm --prefix apps/smt-web test',
  'run_stage "runtime-package-candidate-stable-bootstrap-ready" node --experimental-strip-types --test apps/smt-web/src/smt-device-gate-bootstrap-consumer.test.ts apps/smt-web/src/runtime-carrier-ready.test.ts',
  'run_stage "runtime-smt-web-build" npm --prefix apps/smt-web run build',
  'jarsigner -verify -strict',
  '-keystore "$KEYSTORE" -storetype PKCS12',
  '-storepass "$V1_ANDROID_KEYSTORE_PASSWORD"',
  '"$RUNTIME_BUNDLE" "$V1_ANDROID_KEY_ALIAS"',
  'Verify signed Runtime Package P0 contract',
  "test -f \"$EXTRACT_DIR/index.html\"",
  "test -f \"$EXTRACT_DIR/META-INF/MANIFEST.MF\"",
  "normalize_manifest_value 'MoreFun-Release-Id'",
  "normalize_manifest_value 'MoreFun-Runtime-Version'",
  "normalize_manifest_value 'MoreFun-Channel'",
  "normalize_manifest_value 'MoreFun-Min-Carrier-Version-Code'",
  "normalize_manifest_value 'MoreFun-Bridge-Version'",
  'RUNTIME_PACKAGE_REMOTE_',
  'RUNTIME_PACKAGE_MISSING_',
  'RUNTIME_PACKAGE_REMOTE_CORE_DEPENDENCY_FORBIDDEN',
  'package_contract=PASS',
  'runtimePackageContract: process.env.PACKAGE_CONTRACT',
  'Verify external OTA manifest matches signed package',
  'RUNTIME_EXTERNAL_MANIFEST_MISMATCH_',
  'external_contract=PASS',
  'runtime-package-contract=PASS',
  'runtime-package-candidate-stable-bootstrap-ready=PASS',
  'runtime-package-internal-external-identity=PASS',
  'Private V1 Runtime delivery: PASS',
  '/publish-runtime ',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
  'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  "WRANGLER_VERSION: '4.118.0'",
  'ref: infra/cloudflare-ota-delivery',
  'path: ota-delivery',
  'node scripts/publish-runtime-online.mjs',
  'node scripts/verify-existing-runtime-release.mjs existing-release "$RELEASE_TAG"',
  'Publish verified Runtime online package-first and manifest-last',
  'Publish existing verified Runtime online package-first and manifest-last',
  'Existing Runtime locked signer + internal identity: PASS',
  'gh release view "$RELEASE_TAG" --repo "$SOURCE_REPO"',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PRIVATE_DELIVERY_REQUIRED:${needle}`);
}

const forbidden = [
  'permissions:\n  contents: write',
  'GH_TOKEN: ${{ github.token }}',
  '--repo "$GITHUB_REPOSITORY"',
  'Signed runtime GitHub Release delivery: PASS',
  "MIN_CARRIER_VERSION_CODE: '13'",
  "MIN_CARRIER_VERSION_CODE: '15'",
  'RUNTIME_VERSION="${SHORT_SHA}"',
  'npm run test:g6:web',
  'jarsigner -verify -strict "$RUNTIME_BUNDLE" >/dev/null',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.V1_SOURCE_READ_TOKEN }}',
];
for (const needle of forbidden) {
  if (workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PUBLIC_OR_STALE_CONTRACT_FORBIDDEN:${needle}`);
}

if (!/permissions:\s*\n\s*contents:\s*read/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_DEFAULT_CONTENTS_MUST_BE_READ_ONLY');
}
if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
}
if (!/jarsigner\s+-verify\s+-strict[\s\S]{0,240}-keystore\s+"\$KEYSTORE"[\s\S]{0,240}"\$RUNTIME_BUNDLE"\s+"\$V1_ANDROID_KEY_ALIAS"/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_LOCKED_SIGNER_STRICT_VERIFY_REQUIRED');
}
if (!/if:\s*steps\.external_contract\.outcome == 'success'[\s\S]{0,2200}gh release create/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_DELIVERY_MUST_REQUIRE_PACKAGE_EXTERNAL_CONTRACT_PASS');
}
if (/actions\/upload-artifact|--repo\s+"\$GITHUB_REPOSITORY"/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_PUBLIC_ARTIFACT_DELIVERY_FORBIDDEN');
}
if (!/startsWith\(github\.event\.comment\.body, '\/publish-runtime '\)/.test(workflow)) {
  throw new Error('RUNTIME_EXISTING_PUBLICATION_OWNER_COMMAND_REQUIRED');
}
if (!/gh release download "\$RELEASE_TAG" --repo "\$SOURCE_REPO"/.test(workflow)) {
  throw new Error('RUNTIME_EXISTING_PUBLICATION_PRIVATE_RELEASE_DOWNLOAD_REQUIRED');
}
if (!/Download exact existing private Runtime Release artifacts[\s\S]{0,320}GH_TOKEN:\s*\$\{\{ secrets\.V1_SOURCE_READ_TOKEN \}\}/.test(workflow)) {
  throw new Error('RUNTIME_EXISTING_PUBLICATION_READ_ONLY_SOURCE_TOKEN_REQUIRED');
}

const publisherRequired = [
  "const OTA_BUCKET = 'morefunos-v1-ota'",
  "const OTA_PUBLIC_ORIGIN = 'https://morefunos-v1-ota.pantonyeung.workers.dev'",
  "const PUBLISHED_MANIFEST_KEY = 'runtime-update-published.json'",
  "const EXPECTED_WRANGLER_VERSION = '4.118.0'",
  "requiredEnv('CLOUDFLARE_API_TOKEN')",
  "requiredEnv('CLOUDFLARE_ACCOUNT_ID')",
  "'r2', 'object', 'put', `${OTA_BUCKET}/${runtimeFilename}`",
  "'--remote'",
  "online-ota-package-public-get=PASS",
  "'r2', 'object', 'put', `${OTA_BUCKET}/${PUBLISHED_MANIFEST_KEY}`",
  "online-ota-manifest-public-get=PASS",
  "online-ota-publication=PASS",
  "runWrangler(['deploy', '--config', 'wrangler.jsonc']",
  "X-MoreFunOS-Manifest-Source",
];
for (const needle of publisherRequired) {
  if (!onlinePublisher.includes(needle)) throw new Error(`RUNTIME_ONLINE_PUBLISHER_REQUIRED:${needle}`);
}
const packagePutIndex = onlinePublisher.indexOf("'r2', 'object', 'put', `${OTA_BUCKET}/${runtimeFilename}`");
const packageProofIndex = onlinePublisher.indexOf("online-ota-package-public-get=PASS");
const manifestPutIndex = onlinePublisher.indexOf("'r2', 'object', 'put', `${OTA_BUCKET}/${PUBLISHED_MANIFEST_KEY}`");
const manifestProofIndex = onlinePublisher.indexOf("online-ota-manifest-public-get=PASS");
if (!(packagePutIndex >= 0 && packagePutIndex < packageProofIndex && packageProofIndex < manifestPutIndex && manifestPutIndex < manifestProofIndex)) {
  throw new Error('RUNTIME_ONLINE_PACKAGE_FIRST_MANIFEST_LAST_ORDER_REQUIRED');
}
if (/r2['",\s]+object['",\s]+delete|r2['",\s]+bucket['",\s]+delete|httpMetadata.*PUT|request\.method\s*===?\s*['"]PUT['"]/i.test(onlinePublisher)) {
  throw new Error('RUNTIME_ONLINE_DESTRUCTIVE_OR_PUBLIC_UPLOAD_PATH_FORBIDDEN');
}

const existingVerifierRequired = [
  "const EXPECTED_SOURCE_REPO = 'Pantonyeung/morefunos-v1'",
  "const EXPECTED_SIGNING_CERT_SHA256 = '8f66270541c419a90ae0e8b94a2c7796e13d5c06805b0919ce3f7f5b3602857a'",
  "assertEqual(metadata.runtimePackageContract, 'PASS'",
  "assertEqual(manifest.runtimeVersion, manifest.releaseId",
  "assertEqual(manifest.minCarrierVersionCode, 21",
  'EXISTING_RUNTIME_BUNDLE_HASH_MANIFEST_MISMATCH',
  'EXISTING_RUNTIME_SHA256SUMS_MISMATCH',
  'EXISTING_RUNTIME_RELEASE_TAG_MISMATCH',
  'existing-runtime-release-metadata=PASS',
];
for (const needle of existingVerifierRequired) {
  if (!existingReleaseVerifier.includes(needle)) throw new Error(`RUNTIME_EXISTING_RELEASE_VERIFIER_REQUIRED:${needle}`);
}

console.log('Runtime release single-authority private delivery + package P0 + online R2 publication contract: PASS');
