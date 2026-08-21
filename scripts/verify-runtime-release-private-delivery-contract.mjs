import fs from 'node:fs';

const workflowPath = '.github/workflows/runtime-release-v2.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const publisherPath = 'scripts/publish-runtime-online.mjs';
const publisher = fs.readFileSync(publisherPath, 'utf8');

for (const stalePath of [
  '.github/workflows/manual-runtime-release.yml',
  '.github/workflows/manual-runtime-ota.yml',
  '.github/workflows/publish-runtime.yml',
  '.github/workflows/runtime-online-publish.yml',
]) {
  if (fs.existsSync(stalePath)) throw new Error(`RUNTIME_RELEASE_SECOND_PRODUCTION_AUTHORITY_FORBIDDEN:${stalePath}`);
}

const required = [
  'name: Runtime Release V2',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "MIN_CARRIER_VERSION_CODE: '21'",
  'uses: ./.github/workflows/verify-v1.yml',
  'needs: verify-v1',
  'Checkout exact verified MoreFunOS V1 source',
  'npm --prefix source/apps/smt-web ci --no-audit --no-fund',
  'npm --prefix source/apps/smt-web run build',
  'jar cfm "$RUNTIME_BUNDLE" "$MANIFEST" -C source/apps/smt-web/dist .',
  'jarsigner -verify -strict',
  'MoreFun-Release-Id:',
  'MoreFun-Runtime-Version:',
  'MoreFun-Channel:',
  'MoreFun-Min-Carrier-Version-Code:',
  'MoreFun-Bridge-Version:',
  'runtimePackageContract: \'PASS\'',
  'GH_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  '--repo "$SOURCE_REPO"',
  '--target "$SOURCE_SHA"',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
  'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  "WRANGLER_VERSION: '4.118.0'",
  'ref: infra/cloudflare-ota-delivery',
  'node scripts/publish-runtime-online.mjs',
  'Publish Runtime package-first and manifest-last',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_CURRENT_REQUIRED:${needle}`);
}

for (const forbidden of [
  'verify-ui-mother.yml',
  'test:g5',
  'test:g6',
  'test:b3',
  'actions/upload-artifact',
  'contents: write',
  'persist-credentials: true',
]) {
  if (workflow.includes(forbidden)) throw new Error(`RUNTIME_RELEASE_LEGACY_OR_UNSAFE_FORBIDDEN:${forbidden}`);
}

const publisherRequired = [
  "const OTA_BUCKET = 'morefunos-v1-ota'",
  "const OTA_PUBLIC_ORIGIN = 'https://morefunos-v1-ota.pantonyeung.workers.dev'",
  "const PUBLISHED_MANIFEST_KEY = 'runtime-update-published.json'",
  "const EXPECTED_WRANGLER_VERSION = '4.118.0'",
  "requiredEnv('CLOUDFLARE_API_TOKEN')",
  "requiredEnv('CLOUDFLARE_ACCOUNT_ID')",
  "online-ota-package-public-get=PASS",
  "online-ota-manifest-public-get=PASS",
  "online-ota-publication=PASS",
];
for (const needle of publisherRequired) {
  if (!publisher.includes(needle)) throw new Error(`RUNTIME_ONLINE_PUBLISHER_REQUIRED:${needle}`);
}

const packagePutIndex = publisher.indexOf("'r2', 'object', 'put', `${OTA_BUCKET}/${runtimeFilename}`");
const packageProofIndex = publisher.indexOf('online-ota-package-public-get=PASS');
const manifestPutIndex = publisher.indexOf("'r2', 'object', 'put', `${OTA_BUCKET}/${PUBLISHED_MANIFEST_KEY}`");
const manifestProofIndex = publisher.indexOf('online-ota-manifest-public-get=PASS');
if (!(packagePutIndex >= 0 && packagePutIndex < packageProofIndex && packageProofIndex < manifestPutIndex && manifestPutIndex < manifestProofIndex)) {
  throw new Error('RUNTIME_ONLINE_PACKAGE_FIRST_MANIFEST_LAST_ORDER_REQUIRED');
}

console.log('Runtime release current single-authority private delivery contract: PASS');
