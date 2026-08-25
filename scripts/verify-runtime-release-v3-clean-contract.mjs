import fs from 'node:fs';

const workflowPath = '.github/workflows/runtime-release-v3.yml';
if (!fs.existsSync(workflowPath)) {
  throw new Error('RUNTIME_RELEASE_V3_WORKFLOW_REQUIRED');
}
if (fs.existsSync('.github/workflows/runtime-release-request.yml')) {
  throw new Error('RUNTIME_RELEASE_OLD_REQUEST_RELAY_FORBIDDEN');
}

const workflow = fs.readFileSync(workflowPath, 'utf8');
const v2 = fs.readFileSync('.github/workflows/runtime-release-v2.yml', 'utf8');
const requireText = (needle) => {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_V3_REQUIRED:${needle}`);
};

for (const needle of [
  'name: Runtime Release V3',
  'workflow_dispatch:',
  'branches: [runtime-release-queue]',
  'source_sha:',
  'release_channel:',
  'group: runtime-release-v3-${{',
  'cancel-in-progress:',
  'Setup Node 22.22.2',
  "node-version: '22.22.2'",
  'SMT_RUNTIME_ROOT: source/apps/smt-clean',
  'SMT_RUNTIME_ENTRY: apps/smt-clean/src/main.tsx',
  'Checkout exact MoreFunOS V1 source',
  'Checkout exact shared TEST_ONLY fixtures',
  'Verify exact source and canonical SMT product root',
  'npm --prefix source/apps/smt-web ci --no-audit --no-fund',
  '(cd "$SMT_RUNTIME_ROOT" && npm install --workspaces=false --package-lock=false --ignore-scripts --no-audit --no-fund)',
  'MOREFUNOS_SHARED_UI_FIXTURES_DIR="$GITHUB_WORKSPACE/shared-ui-fixtures" npm test --workspaces=false',
  'npm --prefix source/apps/smt-web test',
  'unset MOREFUNOS_SHARED_UI_FIXTURES_DIR || true',
  '(cd "$SMT_RUNTIME_ROOT" && npm run build --workspaces=false)',
  'Sign Runtime package',
  'jarsigner -verify -strict',
  'MoreFun-Product-Root: apps/smt-clean',
  'Deliver immutable Runtime evidence',
  'Publish Runtime package-first and manifest-last',
  'node scripts/publish-runtime-online.mjs',
  'runtime-v3-stage',
  'run_id=$GITHUB_RUN_ID',
  'stage=$STAGE',
  'Runtime Release V3 final result',
]) requireText(needle);

const forbidden = [
  /workflow_call:/,
  /uses:\s*\.\/\.github\/workflows\/runtime-release-v2\.yml/,
  /uses:\s*\.\/\.github\/workflows\/verify-smt-p01-d103\.yml/,
  /issue_comment:/,
  /\/release-runtime/,
  /group:\s*runtime-release-v3-.*source_sha/,
  /node-version:\s*'22\.12\.0'/,
  /npm --prefix source\/apps\/smt-web run build/,
  /jar cfm "\$RUNTIME_BUNDLE" "\$MANIFEST" -C source\/apps\/smt-web\/dist \./,
];
for (const pattern of forbidden) {
  if (pattern.test(workflow)) throw new Error(`RUNTIME_RELEASE_V3_FORBIDDEN:${pattern}`);
}

const productCheckoutCount = (workflow.match(/- name: Checkout exact MoreFunOS V1 source/g) ?? []).length;
if (productCheckoutCount !== 1) {
  throw new Error(`RUNTIME_RELEASE_V3_EXACTLY_ONE_PRODUCT_CHECKOUT_REQUIRED:${productCheckoutCount}`);
}
const fixtureCheckoutCount = (workflow.match(/- name: Checkout exact shared TEST_ONLY fixtures/g) ?? []).length;
if (fixtureCheckoutCount !== 1) {
  throw new Error(`RUNTIME_RELEASE_V3_EXACTLY_ONE_TEST_FIXTURE_CHECKOUT_REQUIRED:${fixtureCheckoutCount}`);
}

if (!v2.includes('name: Runtime Release V2 Retired')) {
  throw new Error('RUNTIME_RELEASE_V2_MUST_BE_RETIRED');
}
if (/workflow_dispatch:|push:/.test(v2)) {
  throw new Error('RUNTIME_RELEASE_V2_DIRECT_TRIGGER_FORBIDDEN');
}

console.log('Runtime Release V3 clean contract: PASS');
