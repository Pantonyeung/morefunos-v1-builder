import fs from 'node:fs';

const owner=fs.readFileSync('.github/workflows/owner-control-v2.yml','utf8');
if(!owner.includes("/release-runtime) echo 'Comment-triggered Runtime release is retired.")) {
  throw new Error('OWNER_CONTROL_RUNTIME_RELEASE_RETIREMENT_MARKER_REQUIRED');
}
if(/\/release-runtime\)\s+COMMAND=release-runtime/.test(owner)) {
  throw new Error('OWNER_CONTROL_RUNTIME_RELEASE_EXECUTION_FORBIDDEN');
}
if(/^\s*release-runtime:\s*$/m.test(owner)) {
  throw new Error('OWNER_CONTROL_RUNTIME_RELEASE_JOB_FORBIDDEN');
}
if(/uses:\s*\.\/\.github\/workflows\/runtime-release-v2\.yml/.test(owner)) {
  throw new Error('OWNER_CONTROL_RUNTIME_RELEASE_CALL_FORBIDDEN');
}
console.log('Owner Control comment Runtime release retired: PASS');
