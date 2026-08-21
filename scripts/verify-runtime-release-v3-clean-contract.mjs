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
  'Checkout exact MoreFunOS V1 source',
  'Verify exact source identity',
  'npm --prefix source/apps/smt-web ci --no-audit --no-fund',
  'npm --prefix source/apps/smt-web test',
  'npm --prefix source/apps/smt-web run build',
  'Sign Runtime package',
  'jarsigner -verify -strict',
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
];
for (const pattern of forbidden) {
  if (pattern.test(workflow)) throw new Error(`RUNTIME_RELEASE_V3_FORBIDDEN:${pattern}`);
}

const v1CheckoutCount = (workflow.match(/repository:\s*Pantonyeung\/morefunos-v1/g) ?? []).length;
if (v1CheckoutCount !== 1) {
  throw new Error(`RUNTIME_RELEASE_V3_EXACTLY_ONE_V1_CHECKOUT_REQUIRED:${v1CheckoutCount}`);
}

if (!v2.includes('name: Runtime Release V2 Retired')) {
  throw new Error('RUNTIME_RELEASE_V2_MUST_BE_RETIRED');
}
if (/workflow_dispatch:|push:/.test(v2)) {
  throw new Error('RUNTIME_RELEASE_V2_DIRECT_TRIGGER_FORBIDDEN');
}

console.log('Runtime Release V3 clean contract: PASS');
