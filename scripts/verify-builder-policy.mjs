import './verify-android-release-ota-endpoint-contract.mjs';
import './verify-runtime-release-private-delivery-contract.mjs';
import './verify-runtime-release-trigger-contract.mjs';
import './verify-owner-control-runtime-release-retired.mjs';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const v1 = read('.github/workflows/verify-v1.yml');
const carrier = read('.github/workflows/verify-carrier.yml');
const d103 = read('.github/workflows/verify-smt-p01-d103.yml');
const runtimeRelease = read('.github/workflows/runtime-release-v2.yml');
const owner = read('.github/workflows/owner-control-v2.yml');

const requireAll = (text, needles, prefix) => {
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${prefix}:${needle}`);
  }
};

requireAll(v1, [
  'name: Owner V1 Current Verification',
  'workflow_call:',
  'V1_SOURCE_READ_TOKEN',
  'Verify current Builder policy',
  'node scripts/verify-builder-policy.mjs',
  'Verify exact source identity',
  'IMMUTABLE_MOREFUNOS_OWNER_SOVEREIGNTY_SNAPSHOT_V1_2026-08-21.md',
  'd4767c95d566633fc241fe5fbbaaed6eeba2d351',
  'Verify immutable Owner Sovereignty Snapshot',
  'git -C source hash-object',
  'sovereignty-lock',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'v1-contracts',
  'npm run test:v1',
  'v1-typecheck',
  'npm run typecheck:v1',
  'v1-smt-functional',
  'npm --prefix apps/smt-web test',
  'v1-smt-build',
  'npm --prefix apps/smt-web run build',
  'failed_stage=',
], 'V1_VERIFY_POLICY_REQUIRED');

requireAll(carrier, [
  'name: Owner V1 Carrier Verification',
  'workflow_call:',
  'V1_SOURCE_READ_TOKEN',
  'Verify current Builder policy',
  'node scripts/verify-builder-policy.mjs',
  'actions/setup-java@v5',
  'android-actions/setup-android@v4',
  'gradle/actions/setup-gradle@v6',
  'carrier-runtime-contracts',
  'packages/native/*.test.ts',
  'carrier-web-compat',
  'npm --prefix apps/smt-web run test:carrier',
  'carrier-static',
  'apps/smt-android/carrier-static.test.mjs',
  ':app:compileDebugJavaWithJavac',
  ':app:lintDebug',
  ':app:assembleDebug',
  'carrier-apk-artifact',
], 'CARRIER_VERIFY_POLICY_REQUIRED');

requireAll(d103, [
  'name: SMT P01 D-103 Verification',
  'workflow_call:',
  'V1_SOURCE_READ_TOKEN',
  'Checkout exact V1 source',
  'Verify exact source identity',
  'Run V1-owned D-103 profile',
  'npm run verify:smt-p01-d103',
  'source/artifacts/smt-p01-d103',
  'failure_stage=',
], 'D103_THIN_RELAY_REQUIRED');

const d103ForbiddenProductKnowledge = [
  /\bvitest\b/,
  /\btsc\b/,
  /vite\s+preview/,
  /playwright@/,
  /p01-d103-golden/,
  /d103-visual\.html/,
  /viewport-size/,
  /data-d103-visual-ready/,
  /apps\/smt-web\/src/,
];
for (const pattern of d103ForbiddenProductKnowledge) {
  if (pattern.test(d103)) throw new Error(`D103_BUILDER_PRODUCT_KNOWLEDGE_FORBIDDEN:${pattern}`);
}

for (const [name, workflow] of [['verify-v1', v1], ['verify-carrier', carrier], ['verify-smt-p01-d103', d103]]) {
  if (/^concurrency:\s*$/m.test(workflow)) throw new Error(`VERIFY_CONCURRENCY_LOCK_FORBIDDEN:${name}`);
}

requireAll(runtimeRelease, [
  'group: runtime-release-v2-${{ inputs.release_channel }}',
  "cancel-in-progress: ${{ inputs.release_channel != 'stable' }}",
  'jobs:',
  'verify-smt-p01-d103:',
  'needs: verify-smt-p01-d103',
  'Publish Runtime package-first and manifest-last',
], 'RUNTIME_RELEASE_SINGLE_CHAIN_REQUIRED');
if (/group:\s*runtime-release-v2-\$\{\{\s*inputs\.source_sha/.test(runtimeRelease)) {
  throw new Error('RUNTIME_RELEASE_SOURCE_SHA_CONCURRENCY_FORBIDDEN');
}

requireAll(owner, [
  '/verify-v1', '/verify-carrier', '/repair-smt-p01-lockfile',
  '/release-runtime', '/release-android', '/runtime-status',
  './.github/workflows/verify-v1.yml', './.github/workflows/verify-carrier.yml',
], 'OWNER_CONTROL_CURRENT_COMMAND_REQUIRED');

const retiredOwnerCommandArms = [
  /^\s*\/verify-a\)\s+COMMAND=verify-a\s*;;\s*$/m,
  /^\s*\/verify-b\)\s+COMMAND=verify-b\s*;;\s*$/m,
  /^\s*\/verify-c\)\s+COMMAND=verify-c\s*;;\s*$/m,
  /^\s*\/verify-abc\)\s+COMMAND=verify-abc\s*;;\s*$/m,
  /^\s*\/verify-ui-mother\)\s+COMMAND=verify-ui-mother\s*;;\s*$/m,
];
for (const pattern of retiredOwnerCommandArms) {
  if (pattern.test(owner)) throw new Error(`OWNER_CONTROL_LEGACY_COMMAND_FORBIDDEN:${pattern}`);
}

for (const workflow of [v1, carrier, d103]) {
  if (/contents:\s*write/.test(workflow)) throw new Error('VERIFY_CONTENTS_WRITE_FORBIDDEN');
  if (/persist-credentials:\s*true/.test(workflow)) throw new Error('VERIFY_PERSIST_CREDENTIALS_FORBIDDEN');
}
for (const workflow of [v1, carrier]) {
  if (/\b(?:test:g5|test:g6|test:b3|typecheck:g5|typecheck:g6)\b/.test(workflow)) throw new Error('CURRENT_VERIFY_LEGACY_GATE_NAME_FORBIDDEN');
}

const retiredActiveWorkflows = [
  'manual-verify.yml', 'manual-android-release.yml',
  'verify-a.yml', 'verify-b.yml', 'verify-c.yml', 'verify-abc-integration.yml',
  'verify-core.yml', 'verify-ui-mother.yml', 'verify-b-smm.yml',
  'p01-builder-control.yml', 'diagnose-channel-attribution.yml',
];
for (const name of retiredActiveWorkflows) {
  if (fs.existsSync(`.github/workflows/${name}`)) throw new Error(`LEGACY_VERIFY_WORKFLOW_STILL_ACTIVE:${name}`);
}

console.log('Builder current verification policy: PASS');
