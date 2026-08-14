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

console.log('Builder policy: PASS');
