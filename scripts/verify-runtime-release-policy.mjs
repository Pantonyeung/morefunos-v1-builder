import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-release.yml';
const workflow = fs.readFileSync(path, 'utf8');

const required = [
  'name: Owner Manual V1 Runtime Release',
  'workflow_dispatch:',
  "if: github.actor == 'Pantonyeung'",
  'permissions:\n  contents: write',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  'V1_SOURCE_READ_TOKEN',
  'V1_ANDROID_KEYSTORE_B64',
  'V1_ANDROID_KEYSTORE_PASSWORD',
  'V1_ANDROID_KEY_ALIAS',
  'V1_ANDROID_KEY_PASSWORD',
  'EXPECTED_APP_SIGNING_CERT_SHA256: 8f66270541c419a90ae0e8b94a2c7796e13d5c06805b0919ce3f7f5b3602857a',
  'ref: ${{ steps.request.outputs.source_sha }}',
  'persist-credentials: false',
  'npm run test:g6',
  'npm run typecheck:g6',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'npm run test:g6:web',
  'npm --prefix apps/smt-web run build',
  'jarsigner',
  'keytool -exportcert',
  'MoreFun-Release-Id:',
  'MoreFun-Min-Carrier-Version-Code:',
  'MoreFun-Bridge-Version:',
  'gh release create',
  '--repo "$GITHUB_REPOSITORY"',
  'Signed runtime GitHub Release delivery: PASS',
  'rm -f "$KEYSTORE" "$CERT_DER" "$MANIFEST"',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`BUILDER_RUNTIME_RELEASE_POLICY_REQUIRED:${needle}`);
}

const forbiddenTriggers = [
  /^\s{2}push\s*:/m,
  /^\s{2}pull_request\s*:/m,
  /^\s{2}schedule\s*:/m,
  /^\s{2}workflow_run\s*:/m,
  /^\s{2}repository_dispatch\s*:/m,
];
for (const pattern of forbiddenTriggers) {
  if (pattern.test(workflow)) throw new Error(`BUILDER_RUNTIME_RELEASE_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}

if (/persist-credentials:\s*true/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
if (/gradle|setup-android|apksigner|assembleDebug|lintDebug/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_ANDROID_BUILD_FORBIDDEN');
if (/actions\/upload-artifact/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_PUBLIC_WORKFLOW_ARTIFACT_FORBIDDEN');
if (/GH_TOKEN:\s*\$\{\{\s*secrets\.V1_SOURCE_READ_TOKEN\s*\}\}/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_SOURCE_TOKEN_REUSE_FORBIDDEN');
if (/cat\s+.*(?:MainActivity|business-runtime|\.ts|\.java)/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_SOURCE_LOG_FORBIDDEN');
if (!/RELEASE_CHANNEL/.test(workflow) || !/stable\|candidate\|dev/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_CHANNEL_GATE_REQUIRED');

console.log('Builder runtime release policy: PASS');
