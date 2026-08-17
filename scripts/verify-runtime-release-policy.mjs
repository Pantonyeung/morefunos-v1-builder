import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-release.yml';
const workflow = fs.readFileSync(path, 'utf8');

const required = [
  'name: Owner Manual V1 Runtime Release',
  'workflow_dispatch:',
  'issue_comment:',
  'types: [created]',
  "github.actor == 'Pantonyeung'",
  "github.event.issue.number == 2",
  "startsWith(github.event.comment.body, '/release-runtime ')",
  'permissions:\n  contents: write',
  'issues: read',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  'V1_SOURCE_READ_TOKEN',
  'COMMENT_BODY: ${{ github.event.comment.body || \'\' }}',
  "COMMAND_VERB='/release-runtime'",
  'source_sha must normalize to an exact 40-character Git commit SHA',
  'release_channel invalid',
  'Runtime release command must contain exactly: /release-runtime <sha> <channel>.',
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
if (!/github\.event_name\s*==\s*'workflow_dispatch'/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_MANUAL_EVENT_GATE_REQUIRED');
if (!/github\.event_name\s*==\s*'issue_comment'/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_COMMENT_EVENT_GATE_REQUIRED');
if (!/github\.event\.issue\.number\s*==\s*2/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_CONTROL_ISSUE_REQUIRED');
if (!/startsWith\(github\.event\.comment\.body, '\/release-runtime '\)/.test(workflow)) throw new Error('BUILDER_RUNTIME_RELEASE_COMMAND_PREFIX_REQUIRED');

console.log('Builder runtime release policy: PASS');