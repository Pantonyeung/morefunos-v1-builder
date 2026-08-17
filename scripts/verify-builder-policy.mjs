import './verify-android-release-ota-endpoint-contract.mjs';
import fs from 'node:fs';

const workflowPath = '.github/workflows/manual-verify.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const releaseWorkflowPath = '.github/workflows/manual-android-release.yml';
const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');

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
  'android-actions/setup-android@v4',
  "packages: 'platform-tools platforms;android-36 build-tools;36.0.0'",
  'gradle/actions/setup-gradle@v6',
  "gradle-version: '9.5.0'",
  'android-g6-static',
  'npm run test:g6',
  'android-g6-typecheck',
  'npm run typecheck:g6',
  'android-smt-web-locked-install',
  'android-smt-web-build',
  'android-sdk-components',
  'platforms/android-36/android.jar',
  'build-tools/36.0.0/aapt2',
  'run_android_lint()',
  'gradle -p apps/smt-android :app:lintDebug --no-daemon',
  'android-lint-issue-summary=',
  'lint_issue_summary=',
  'LINT_ISSUE_SUMMARY:',
  'lintIssueSummary:',
  'android-assemble-debug',
  ':app:assembleDebug',
  'apps/smt-android/app/build/outputs/apk/debug/app-debug.apk',
  'artifact_sha256=',
  'artifact_bytes=',
  'artifact_version=',
];

for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`BUILDER_POLICY_REQUIRED:${needle}`);
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
if (/contents:\s*write/.test(workflow)) throw new Error('BUILDER_DEFAULT_CONTENTS_WRITE_FORBIDDEN');
if (/persist-credentials:\s*true/.test(workflow)) throw new Error('BUILDER_PERSIST_CREDENTIALS_FORBIDDEN');
if (/ref:\s*\$\{\{\s*inputs\.source_sha\s*\}\}/.test(workflow)) throw new Error('BUILDER_RAW_SOURCE_SHA_CHECKOUT_FORBIDDEN');
if (/npm\s+(?:install|i)\s+(?!.*--package-lock-only)/.test(workflow.split('smt-lock)')[1]?.split(';;')[0] ?? '')) throw new Error('BUILDER_SMT_LOCK_INSTALL_SCOPE_FORBIDDEN');
if (/SMT_LOCKFILE_BEGIN|SMT_LOCKFILE_END|cat\s+apps\/smt-web\/package-lock\.json/.test(workflow)) throw new Error('BUILDER_SMT_LOCK_RAW_LOG_FORBIDDEN');

const androidMarker = '\n            android)\n';
const androidStart = workflow.lastIndexOf(androidMarker);
if (androidStart < 0) throw new Error('BUILDER_ANDROID_CASE_REQUIRED');
const androidBodyStart = androidStart + androidMarker.length;
const androidEnd = workflow.indexOf('\n              ;;', androidBodyStart);
const androidCase = androidEnd >= 0 ? workflow.slice(androidBodyStart, androidEnd) : '';
if (!androidCase.includes('gradle -p apps/smt-android :app:assembleDebug --no-daemon')) throw new Error('BUILDER_ANDROID_ASSEMBLE_CONTRACT_REQUIRED');
if (!workflow.includes('gradle -p apps/smt-android :app:lintDebug --no-daemon')) throw new Error('BUILDER_ANDROID_LINT_COMMAND_REQUIRED');
if (!androidCase.includes('run_android_lint || exit 1')) throw new Error('BUILDER_ANDROID_LINT_HELPER_CALL_REQUIRED');
if (!workflow.includes('android-actions/setup-android@v4')) throw new Error('BUILDER_ANDROID_SDK_SETUP_ACTION_REQUIRED');
if (!workflow.includes('android-lint-issue-summary=')) throw new Error('BUILDER_ANDROID_LINT_SANITIZED_SUMMARY_REQUIRED');
if (!workflow.includes('lint_issue_summary=')) throw new Error('BUILDER_ANDROID_LINT_OUTPUT_REQUIRED');
if (/\b(?:cat|head|tail|sed\s+-n)\b[^\n]*lint-results[^\n]*\.xml/i.test(workflow)) throw new Error('BUILDER_ANDROID_LINT_RAW_REPORT_LOG_FORBIDDEN');
if (/upload-artifact[\s\S]{0,500}app-debug\.apk/.test(workflow)) throw new Error('BUILDER_PUBLIC_APK_UPLOAD_FORBIDDEN');
if (/cat\s+.*(?:MainActivity|build\.gradle|AndroidManifest|\.java)/.test(workflow)) throw new Error('BUILDER_ANDROID_SOURCE_LOG_FORBIDDEN');
if (/V1_ARTIFACT_DELIVERY_TOKEN|V1_ANDROID_KEYSTORE_|V1_B2_LOCKFILE_WRITE_TOKEN|gh release create/.test(workflow)) throw new Error('BUILDER_NORMAL_VERIFY_MUST_REMAIN_READ_ONLY');

const releaseRequired = [
  'name: Owner Manual V1 Android Release',
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
  'ref: ${{ steps.request.outputs.source_sha }}',
  'persist-credentials: false',
  'npm run test:g6',
  'npm run typecheck:g6',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'npm --prefix apps/smt-web run build',
  'gradle -p apps/smt-android :app:lintDebug --no-daemon',
  'gradle -p apps/smt-android :app:assembleDebug --no-daemon',
  'build-tools/36.0.0/apksigner',
  'apksigner',
  'Stable APK signing identity verified: PASS',
  'test "$VERSION_CODE" -ge 12',
  'test "$PACKAGE_ID" = "com.morefunos.smt"',
  'build-metadata.json',
  'SHA256SUMS',
  'gh release create',
  '--repo "$SOURCE_REPO"',
  '--target "$NORMALIZED_SOURCE_SHA"',
  '--prerelease',
  'Private V1 Release delivery: PASS',
];
for (const needle of releaseRequired) {
  if (!releaseWorkflow.includes(needle)) throw new Error(`BUILDER_ANDROID_RELEASE_POLICY_REQUIRED:${needle}`);
}
for (const pattern of forbiddenTriggers) {
  if (pattern.test(releaseWorkflow)) throw new Error(`BUILDER_ANDROID_RELEASE_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}
if (/contents:\s*write/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_DEFAULT_CONTENTS_WRITE_FORBIDDEN');
if (/persist-credentials:\s*true/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
if (/ref:\s*\$\{\{\s*inputs\.source_sha\s*\}\}/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_RAW_SOURCE_SHA_CHECKOUT_FORBIDDEN');
if (/actions\/upload-artifact|uploads\.github\.com|--repo\s+\$\{\{\s*github\.repository\s*\}\}/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_PUBLIC_ARTIFACT_DELIVERY_FORBIDDEN');
if (/cat\s+.*(?:MainActivity|build\.gradle|AndroidManifest|\.java)/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_SOURCE_LOG_FORBIDDEN');
if (/GH_TOKEN:\s*\$\{\{\s*secrets\.V1_SOURCE_READ_TOKEN\s*\}\}/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_READ_TOKEN_REUSE_FORBIDDEN');
if (!/GH_TOKEN:\s*\$\{\{\s*secrets\.V1_ARTIFACT_DELIVERY_TOKEN\s*\}\}/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_SEPARATE_DELIVERY_TOKEN_REQUIRED');
if (/V1_B2_LOCKFILE_WRITE_TOKEN/.test(releaseWorkflow)) throw new Error('BUILDER_ANDROID_RELEASE_B2_LOCKFILE_TOKEN_FORBIDDEN');
if (!releaseWorkflow.includes('rm -f "$RUNNER_TEMP/morefunos-v1-app-signing.p12"')) throw new Error('BUILDER_ANDROID_RELEASE_SIGNING_KEY_CLEANUP_REQUIRED');

console.log('Builder policy: PASS');
