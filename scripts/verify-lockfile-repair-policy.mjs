import fs from 'node:fs';

const workflowPath = '.github/workflows/lockfile-repair.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'name: Owner Manual V1 B2 Lockfile Repair',
  'workflow_dispatch:',
  "if: github.actor == 'Pantonyeung'",
  'permissions:',
  'contents: read',
  'V1_SOURCE_READ_TOKEN',
  'V1_B2_LOCKFILE_WRITE_TOKEN',
  'persist-credentials: false',
  'rm -rf apps/smt-web/node_modules',
  'rm -f apps/smt-web/package-lock.json',
  'npm --prefix apps/smt-web install --package-lock-only --ignore-scripts --no-audit --no-fund',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'apps/smt-web/package-lock.json',
  'builder/b2-lockfile-',
  'build(b2): canonicalize SMT dependency lockfile',
  'git diff --cached --name-only',
  'refs/heads/${REPAIR_BRANCH}',
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    throw new Error(`B2_LOCKFILE_REPAIR_POLICY_REQUIRED:${needle}`);
  }
}

const removeLockIndex = workflow.indexOf('rm -f apps/smt-web/package-lock.json');
const canonicalizeIndex = workflow.indexOf('npm --prefix apps/smt-web install --package-lock-only --ignore-scripts --no-audit --no-fund');
if (removeLockIndex < 0 || canonicalizeIndex < 0 || removeLockIndex > canonicalizeIndex) {
  throw new Error('B2_LOCKFILE_REPAIR_FRESH_REGENERATION_REQUIRED');
}

const forbiddenTriggers = [
  /^\s{2}push\s*:/m,
  /^\s{2}pull_request\s*:/m,
  /^\s{2}schedule\s*:/m,
  /^\s{2}workflow_run\s*:/m,
  /^\s{2}repository_dispatch\s*:/m,
];

for (const pattern of forbiddenTriggers) {
  if (pattern.test(workflow)) throw new Error(`B2_LOCKFILE_REPAIR_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}

if (/contents:\s*write/.test(workflow)) {
  throw new Error('B2_LOCKFILE_REPAIR_DEFAULT_GITHUB_TOKEN_WRITE_FORBIDDEN');
}

if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('B2_LOCKFILE_REPAIR_PERSIST_CREDENTIALS_FORBIDDEN');
}

if (/HEAD:refs\/heads\/(?:main|master)\b/.test(workflow) || /git\s+push[^\n]*(?:main|master)\b/.test(workflow)) {
  throw new Error('B2_LOCKFILE_REPAIR_MAIN_PUSH_FORBIDDEN');
}

if (!workflow.includes('test "$STAGED_PATHS" = "apps/smt-web/package-lock.json"')) {
  throw new Error('B2_LOCKFILE_REPAIR_SINGLE_FILE_GUARD_REQUIRED');
}

const forbiddenCredentials = [
  'V1_LOCKFILE_WRITE_TOKEN',
  'V1_ARTIFACT_DELIVERY_TOKEN',
  'V1_DIAGNOSTICS_WRITE_TOKEN',
  'V1_ANDROID_KEYSTORE_B64',
  'V1_ANDROID_KEYSTORE_PASSWORD',
  'V1_ANDROID_KEY_ALIAS',
  'V1_ANDROID_KEY_PASSWORD',
];

for (const secret of forbiddenCredentials) {
  if (workflow.includes(secret)) {
    throw new Error(`B2_LOCKFILE_REPAIR_CREDENTIAL_REUSE_FORBIDDEN:${secret}`);
  }
}

if (!/V1_B2_LOCKFILE_WRITE_TOKEN:\s*\$\{\{\s*secrets\.V1_B2_LOCKFILE_WRITE_TOKEN\s*\}\}/.test(workflow)) {
  throw new Error('B2_LOCKFILE_REPAIR_DEDICATED_WRITE_TOKEN_REQUIRED');
}

console.log('B2 lockfile repair policy: PASS');
