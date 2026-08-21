import './verify-android-release-ota-endpoint-contract.mjs';
import './verify-runtime-release-private-delivery-contract.mjs';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const v1Path = '.github/workflows/verify-v1.yml';
const carrierPath = '.github/workflows/verify-carrier.yml';
const ownerPath = '.github/workflows/owner-control-v2.yml';
const v1 = read(v1Path);
const carrier = read(carrierPath);
const owner = read(ownerPath);

const requireAll = (text, needles, prefix) => {
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${prefix}:${needle}`);
  }
};

requireAll(v1, [
  'name: Owner V1 Current Verification',
  'workflow_call:',
  'V1_SOURCE_READ_TOKEN',
  'Verify exact source identity',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'v1-runtime-contracts',
  'packages/runtime/*.test.ts',
  'v1-ui-authority',
  'packages/ui/ui-authority-boundary.test.mjs',
  'packages/ui/sdk-passthrough.test.mjs',
  'v1-typecheck',
  'tsc --noEmit -p tsconfig.json',
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
  'actions/setup-java@v5',
  'android-actions/setup-android@v4',
  'gradle/actions/setup-gradle@v6',
  'carrier-runtime-contracts',
  'packages/native/*.test.ts',
  'carrier-web-compat',
  'npm --prefix apps/smt-web run test:carrier',
  'carrier-static',
  'apps/smt-android/g6-carrier-static.test.mjs',
  ':app:compileDebugJavaWithJavac',
  ':app:lintDebug',
  ':app:assembleDebug',
  'carrier-apk-artifact',
], 'CARRIER_VERIFY_POLICY_REQUIRED');

requireAll(owner, [
  '/verify-v1',
  '/verify-carrier',
  '/repair-smt-p01-lockfile',
  '/release-runtime',
  '/release-android',
  '/runtime-status',
  './.github/workflows/verify-v1.yml',
  './.github/workflows/verify-carrier.yml',
], 'OWNER_CONTROL_CURRENT_COMMAND_REQUIRED');

for (const retired of ['/verify-a', '/verify-b', '/verify-c', '/verify-abc', '/verify-ui-mother']) {
  if (owner.includes(retired)) throw new Error(`OWNER_CONTROL_LEGACY_COMMAND_FORBIDDEN:${retired}`);
}

for (const workflow of [v1, carrier]) {
  if (/contents:\s*write/.test(workflow)) throw new Error('VERIFY_CONTENTS_WRITE_FORBIDDEN');
  if (/persist-credentials:\s*true/.test(workflow)) throw new Error('VERIFY_PERSIST_CREDENTIALS_FORBIDDEN');
  if (/\b(?:test:g5|test:g6|test:b3|typecheck:g5|typecheck:g6)\b/.test(workflow)) {
    throw new Error('CURRENT_VERIFY_LEGACY_GATE_NAME_FORBIDDEN');
  }
}

const retiredActiveWorkflows = [
  'manual-verify.yml',
  'verify-a.yml',
  'verify-b.yml',
  'verify-c.yml',
  'verify-abc-integration.yml',
  'verify-core.yml',
  'verify-ui-mother.yml',
  'verify-b-smm.yml',
  'p01-builder-control.yml',
  'diagnose-channel-attribution.yml',
];
for (const name of retiredActiveWorkflows) {
  if (fs.existsSync(`.github/workflows/${name}`)) throw new Error(`LEGACY_VERIFY_WORKFLOW_STILL_ACTIVE:${name}`);
}

console.log('Builder current verification policy: PASS');
