import fs from 'node:fs';

const workflowPath = '.github/workflows/runtime-release-v3.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const publisherPath = 'scripts/publish-runtime-online.mjs';
const publisher = fs.readFileSync(publisherPath, 'utf8');

const required = [
  'name: Runtime Release V3',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "MIN_CARRIER_VERSION_CODE: '21'",
  'SMT_RUNTIME_ROOT: source/apps/smt-clean',
  'SMT_RUNTIME_ENTRY: apps/smt-clean/src/main.tsx',
  'SHARED_FIXTURES_SHA: 7618149a36d819171efbc220ddfed58af0b577c9',
  'Checkout exact MoreFunOS V1 source',
  'Checkout exact shared TEST_ONLY fixtures',
  'npm --prefix source/apps/smt-web ci --no-audit --no-fund',
  '(cd "$SMT_RUNTIME_ROOT" && npm install --workspaces=false --package-lock=false --ignore-scripts --no-audit --no-fund)',
  'MOREFUNOS_SHARED_UI_FIXTURES_DIR="$GITHUB_WORKSPACE/shared-ui-fixtures" npm test --workspaces=false',
  'npm --prefix source/apps/smt-web test',
  'unset MOREFUNOS_SHARED_UI_FIXTURES_DIR || true',
  '(cd "$SMT_RUNTIME_ROOT" && npm run build --workspaces=false)',
  'jar cfm "$RUNTIME_BUNDLE" "$MANIFEST" -C "$SMT_RUNTIME_ROOT/dist" .',
  'jarsigner -verify -strict',
  'MoreFun-Release-Id:',
  'MoreFun-Runtime-Version:',
  'MoreFun-Channel:',
  'MoreFun-Min-Carrier-Version-Code:',
  'MoreFun-Bridge-Version:',
  'MoreFun-Product-Root: apps/smt-clean',
  "runtimePackageContract:'PASS'",
  "sharedTestFixturesAuthority:'TEST_ONLY_NON_PRODUCTION'",
  'GH_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  '--repo "$SOURCE_REPO"',
  '--target "$SOURCE_SHA"',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
  'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
  "WRANGLER_VERSION: '4.118.0'",
  'OTA_WORKER_DIR: ${{ github.workspace }}/source/infra/cloudflare/ota-worker',
  'node scripts/publish-runtime-online.mjs',
  'Publish Runtime package-first and manifest-last',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_V3_CURRENT_REQUIRED:${needle}`);
}

for (const forbidden of [
  'uses: ./.github/workflows/runtime-release-v2.yml',
  'uses: ./.github/workflows/verify-smt-p01-d103.yml',
  'needs: verify-smt-p01-d103',
  'ref: infra/cloudflare-ota-delivery',
  'contents: write',
  'persist-credentials: true',
]) {
  if (workflow.includes(forbidden)) throw new Error(`RUNTIME_RELEASE_V3_LEGACY_OR_UNSAFE_FORBIDDEN:${forbidden}`);
}

const publisherRequired = [
  "const OTA_BUCKET = 'morefunos-v1-ota'",
  "const OTA_PUBLIC_ORIGIN = 'https://morefunos-v1-ota.pantonyeung.workers.dev'",
  "const PUBLISHED_MANIFEST_KEY = 'runtime-update-published.json'",
  "const EXPECTED_WRANGLER_VERSION = '4.118.0'",
  "requiredEnv('CLOUDFLARE_API_TOKEN')",
  "requiredEnv('CLOUDFLARE_ACCOUNT_ID')",
  'online-ota-package-public-get=PASS',
  'online-ota-manifest-public-get=PASS',
  'online-ota-publication=PASS',
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

console.log('Runtime Release V3 single-authority delivery contract: PASS');
