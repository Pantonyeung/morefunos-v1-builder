import fs from 'node:fs';

const workflowPath = '.github/workflows/manual-verify.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'workflow_dispatch:',
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "runs-on: ubuntu-latest",
  "if: github.actor == 'Pantonyeung'",
  'V1_SOURCE_READ_TOKEN',
  'Verify exact private source identity',
  'id: request',
  "tr -d '[:space:]'",
  'steps.request.outputs.source_sha',
  'EXPECTED_SOURCE_SHA',
  'g4|g5|current|smt-lock|smt-lock-audit|smt-web|android',
  'npm --prefix apps/smt-web install --package-lock-only --ignore-scripts --no-audit --no-fund',
  'smt-lock-audit-canonicalize',
  'smt-lock-audit-zero-diff',
  'git diff --exit-code -- apps/smt-web/package-lock.json',
  'smt-lock-audit-hash-stability',
  'smt-lock-audit-ci',
  'sha256sum apps/smt-web/package-lock.json',
  'actions/upload-artifact@v4',
  'smt-web-package-lock-${{ steps.request.outputs.source_sha }}',
  'path: source/apps/smt-web/package-lock.json',
  'retention-days: 1',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'npm run test:g5',
  'npm run test:current',
  'npm run typecheck:g5',
  'npm --prefix apps/smt-web test',
  'npm --prefix apps/smt-web run build',
  'actions/setup-java@v5',
  "distribution: 'temurin'",
  "java-version: '17'",
  'gradle/actions/setup-gradle@v6',
  "gradle-version: '9.5.0'",
  'android-g6-static',
  'npm run test:g6',
  'android-g6-typecheck',
  'npm run typecheck:g6',
  'android-smt-web-locked-install',
  'android-smt-web-build',
  'android-sdk-components',
  'platforms;android-36',
  'build-tools;36.0.0',
  'android-lint-debug',
  ':app:lintDebug',
  'android-assemble-debug',
  ':app:assembleDebug',
  'apps/smt-android/app/build/outputs/apk/debug/app-debug.apk',
  'artifact_sha256=',
  'artifact_bytes=',
  'artifact_version=',
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    throw new Error(`BUILDER_POLICY_REQUIRED:${needle}`);
  }
}

const forbiddenTriggers = [
  /^\s{2}push\s*:/m,
  /^\s{2}pull_request\s*:/m,
  /^\s{2}schedule\s*:/m,
  /^\s{2}workflow_run\s*:/m,
  /^\s{2}repository_dispatch\s*:/m,
];

for (const pattern of forbiddenTriggers) {
  if (pattern.test(workflow)) throw new Error(`BUILDER_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}

if (/contents:\s*write/.test(workflow)) {
  throw new Error('BUILDER_DEFAULT_CONTENTS_WRITE_FORBIDDEN');
}

if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('BUILDER_PERSIST_CREDENTIALS_FORBIDDEN');
}

if (/ref:\s*\$\{\{\s*inputs\.source_sha\s*\}\}/.test(workflow)) {
  throw new Error('BUILDER_RAW_SOURCE_SHA_CHECKOUT_FORBIDDEN');
}

if (/npm\s+(?:install|i)\s+(?!.*--package-lock-only)/.test(workflow.split('smt-lock)')[1]?.split(';;')[0] ?? '')) {
  throw new Error('BUILDER_SMT_LOCK_INSTALL_SCOPE_FORBIDDEN');
}

if (/SMT_LOCKFILE_BEGIN|SMT_LOCKFILE_END|cat\s+apps\/smt-web\/package-lock\.json/.test(workflow)) {
  throw new Error('BUILDER_SMT_LOCK_RAW_LOG_FORBIDDEN');
}

const androidCase = workflow.split('android)')[1]?.split(';;')[0] ?? '';
if (!androidCase.includes('gradle -p apps/smt-android :app:assembleDebug --no-daemon')) {
  throw new Error('BUILDER_ANDROID_ASSEMBLE_CONTRACT_REQUIRED');
}
if (!androidCase.includes('gradle -p apps/smt-android :app:lintDebug --no-daemon')) {
  throw new Error('BUILDER_ANDROID_LINT_CONTRACT_REQUIRED');
}
if (/upload-artifact[\s\S]{0,500}app-debug\.apk/.test(workflow)) {
  throw new Error('BUILDER_PUBLIC_APK_UPLOAD_FORBIDDEN');
}
if (/cat\s+.*(?:MainActivity|build\.gradle|AndroidManifest|\.java)/.test(workflow)) {
  throw new Error('BUILDER_ANDROID_SOURCE_LOG_FORBIDDEN');
}

console.log('Builder policy: PASS');
