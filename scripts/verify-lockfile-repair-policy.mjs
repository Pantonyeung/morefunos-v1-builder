import fs from 'node:fs';

const workflowPath = '.github/workflows/lockfile-repair.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'workflow_dispatch:',
  "if: github.actor == 'Pantonyeung'",
  'permissions:',
  'contents: read',
  'V1_SOURCE_READ_TOKEN',
  'V1_LOCKFILE_WRITE_TOKEN',
  'persist-credentials: false',
  'npm --prefix apps/smt-web install --package-lock-only --ignore-scripts --no-audit --no-fund',
  'npm --prefix apps/smt-web ci --no-audit --no-fund',
  'apps/smt-web/package-lock.json',
  'builder/g5-lockfile-',
  'git diff --cached --name-only',
  'refs/heads/${REPAIR_BRANCH}',
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    throw new Error(`LOCKFILE_REPAIR_POLICY_REQUIRED:${needle}`);
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
  if (pattern.test(workflow)) throw new Error(`LOCKFILE_REPAIR_AUTOMATIC_TRIGGER_FORBIDDEN:${pattern}`);
}

if (/contents:\s*write/.test(workflow)) {
  throw new Error('LOCKFILE_REPAIR_DEFAULT_GITHUB_TOKEN_WRITE_FORBIDDEN');
}

if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('LOCKFILE_REPAIR_PERSIST_CREDENTIALS_FORBIDDEN');
}

if (/HEAD:refs\/heads\/(?:main|master)\b/.test(workflow) || /git\s+push[^\n]*(?:main|master)\b/.test(workflow)) {
  throw new Error('LOCKFILE_REPAIR_MAIN_PUSH_FORBIDDEN');
}

if (!workflow.includes('test "$STAGED_PATHS" = "apps/smt-web/package-lock.json"')) {
  throw new Error('LOCKFILE_REPAIR_SINGLE_FILE_GUARD_REQUIRED');
}

console.log('Lockfile repair policy: PASS');
