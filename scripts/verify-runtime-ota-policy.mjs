import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-ota.yml';
const workflow = fs.readFileSync(path, 'utf8');

const required = [
  'name: Owner Manual V1 Runtime OTA Package',
  'workflow_dispatch:',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "if: github.actor == 'Pantonyeung'",
  'permissions:\n  contents: read',
  'V1_SOURCE_READ_TOKEN',
  'V1_ARTIFACT_DELIVERY_TOKEN',
  'V1_ANDROID_KEYSTORE_B64',
  'V1_ANDROID_KEYSTORE_PASSWORD',
  'V1_ANDROID_KEY_ALIAS',
  'V1_ANDROID_KEY_PASSWORD',
  'EXPECTED_APP_SIGNING_CERT_SHA256: 8f66270541c419a90ae0e8b94a2c7796e13d5c06805b0919ce3f7f5b3602857a',
  'Verify exact private source identity',
  'npm install --global --silent typescript@5.8.3',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'npm run test:g5',
  'npm run typecheck:g5',
  'npm --prefix apps/smt-web test',
  'npm --prefix apps/smt-web run build',
  'MoreFun-Release-Id:',
  'MoreFun-Runtime-Version:',
  'MoreFun-Channel:',
  'MoreFun-Min-Carrier-Version-Code:',
  'MoreFun-Bridge-Version:',
  'jar --create',
  'jarsigner',
  'jarsigner -verify -strict',
  'Stable Runtime OTA signing identity verified: PASS',
  'runtime-build-metadata.json',
  'RUNTIME_SHA256SUMS',
  'gh release create',
  '--repo "$SOURCE_REPO"',
  '--target "$SOURCE_SHA"',
  '--prerelease',
  'Private V1 Runtime OTA delivery: PASS',
  'rm -f "$RUNNER_TEMP/morefunos-v1-runtime-signing.p12"',
];

for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`BUILDER_RUNTIME_OTA_POLICY_REQUIRED:${needle}`);
}

const forbiddenTriggers = [
  /^\s{2}push\s*:/m,
  /^\s{2}pull_request\s*:/m,
  /^\s{2}schedule\s*:/m,
  /^\s{2}workflow_run\s*:/m,
  /^\s{2}repository_dispatch\s*:/m,
];
for (const pattern of forbiddenTriggers) {
  if (pattern.test(workflow)) throw new Error(`BUILDER_RUNTIME_OTA_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}

if (/contents:\s*write/.test(workflow)) throw new Error('BUILDER_RUNTIME_OTA_DEFAULT_CONTENTS_WRITE_FORBIDDEN');
if (/persist-credentials:\s*true/.test(workflow)) throw new Error('BUILDER_RUNTIME_OTA_PERSIST_CREDENTIALS_FORBIDDEN');
if (/actions\/upload-artifact/.test(workflow)) throw new Error('BUILDER_RUNTIME_OTA_PUBLIC_ARTIFACT_FORBIDDEN');
if (/android-actions\/setup-android|setup-gradle|\bgradle\b|assembleDebug|lintDebug|apksigner/.test(workflow)) {
  throw new Error('BUILDER_RUNTIME_OTA_ANDROID_BUILD_FORBIDDEN');
}
if (/addJavascriptInterface|MainActivity|AndroidManifest/.test(workflow)) {
  throw new Error('BUILDER_RUNTIME_OTA_SOURCE_LOG_OR_NATIVE_MUTATION_FORBIDDEN');
}
if (!/GH_TOKEN:\s*\$\{\{\s*secrets\.V1_ARTIFACT_DELIVERY_TOKEN\s*\}\}/.test(workflow)) {
  throw new Error('BUILDER_RUNTIME_OTA_SEPARATE_DELIVERY_TOKEN_REQUIRED');
}
if (/GH_TOKEN:\s*\$\{\{\s*secrets\.V1_SOURCE_READ_TOKEN\s*\}\}/.test(workflow)) {
  throw new Error('BUILDER_RUNTIME_OTA_READ_TOKEN_REUSE_FORBIDDEN');
}

console.log('Builder Runtime OTA policy: PASS');
