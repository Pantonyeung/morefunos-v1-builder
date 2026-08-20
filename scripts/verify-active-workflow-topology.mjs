import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.resolve('.github/workflows');
const allowedIssueCommentWorkflow = 'owner-control-v2.yml';

const files = fs.readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

const listeners = [];
for (const name of files) {
  const text = fs.readFileSync(path.join(workflowDir, name), 'utf8');
  if (/^\s{2}issue_comment\s*:/m.test(text)) listeners.push(name);
}

if (listeners.length !== 1 || listeners[0] !== allowedIssueCommentWorkflow) {
  throw new Error(`ACTIVE_ISSUE_COMMENT_TOPOLOGY_INVALID:${listeners.join(',') || 'NONE'}`);
}

const retiredDirectListeners = [
  'manual-runtime-release.yml',
  'owner-verification-control.yml',
  'runtime-release-status.yml',
  'p01-canonical-verify.yml',
  'p01-g5-static-diagnostic.yml',
  'p01-lock-test.yml',
  'p01-repair-diagnostic-runner.yml',
  'p01-runtime-projection-diagnostic.yml',
  'p01-smt-runtime-adapter-diagnostic.yml',
  'p01-trigger-diagnostic.yml',
  'p01-verify-observable-runner.yml',
  'restore-operational-lockfiles.yml',
  'writeback-operational-lockfiles.yml',
  'diagnose-b-components.yml',
  'diagnose-b-gates.yml',
  'diagnose-c4.yml',
  'diagnose-cross-surface-ui.yml',
  'diagnose-operational-lockfiles.yml',
  'verify-cross-surface-preview.yml',
  'verify-feature-bundle.yml',
  'verify-secondary-surfaces.yml',
];

for (const name of retiredDirectListeners) {
  if (fs.existsSync(path.join(workflowDir, name))) {
    throw new Error(`RETIRED_DIRECT_LISTENER_REACTIVATED:${name}`);
  }
}

console.log(`Active workflow topology: PASS (${allowedIssueCommentWorkflow} is the only issue_comment listener)`);
