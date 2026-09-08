import fs from 'node:fs';

const workflow='.github/workflows/v2-builder-admission-queue.yml';
const selfCheck='.github/workflows/builder-self-check.yml';
const guard='scripts/verify-v2-memory-guard.mjs';

for(const p of [workflow,selfCheck,guard]){
  if(!fs.existsSync(p)) throw new Error('MEMORY_GUARD_POLICY_FILE_MISSING:'+p);
}

const wf=fs.readFileSync(workflow,'utf8');
const sc=fs.readFileSync(selfCheck,'utf8');

if(!wf.includes('- name: Run V2 Memory Guard')) throw new Error('MEMORY_GUARD_STEP_REMOVED');
if(!wf.includes('node scripts/verify-v2-memory-guard.mjs candidate')) throw new Error('MEMORY_GUARD_COMMAND_CHANGED_OR_REMOVED');
if(wf.indexOf('Run V2 Memory Guard') > wf.indexOf('Analyze impact and build integration working tree')){
  throw new Error('MEMORY_GUARD_RUNS_TOO_LATE');
}
if(!sc.includes('node scripts/verify-v2-memory-guard-policy.mjs')){
  throw new Error('MEMORY_GUARD_POLICY_NOT_SELF_CHECKED');
}
console.log('V2 Memory Guard policy: PASS');
