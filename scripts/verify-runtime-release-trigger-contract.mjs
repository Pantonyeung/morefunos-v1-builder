import fs from 'node:fs';

const path='.github/workflows/runtime-release-request.yml';
if(!fs.existsSync(path)) throw new Error('RUNTIME_RELEASE_REQUEST_WORKFLOW_REQUIRED');
const text=fs.readFileSync(path,'utf8');
const required=[
  'name: Runtime Release Request',
  'workflow_dispatch:',
  'branches: [runtime-release-queue]',
  'paths: [runtime-release-request.json]',
  "github.actor == 'Pantonyeung'",
  'Validate exact release request',
  "['candidate','stable','dev']",
  '/^[0-9a-fA-F]{40}$/',
  'runtime-release-request request_id=',
  'status=accepted',
  'uses: ./.github/workflows/runtime-release-v2.yml',
  'secrets: inherit',
  'status=$RESULT',
];
for(const needle of required){
  if(!text.includes(needle)) throw new Error(`RUNTIME_RELEASE_REQUEST_CONTRACT_REQUIRED:${needle}`);
}
if(!/push:\s*[\s\S]*runtime-release-queue/.test(text)) throw new Error('RUNTIME_RELEASE_QUEUE_PUSH_TRIGGER_REQUIRED');
if(/uses:\s*\.\/\.github\/workflows\/verify-smt-p01-d103\.yml/.test(text)) throw new Error('RUNTIME_RELEASE_REQUEST_MUST_NOT_DUPLICATE_VERIFY');
if(/Publish Runtime package-first and manifest-last/.test(text)) throw new Error('RUNTIME_RELEASE_REQUEST_MUST_NOT_OWN_PUBLISH_LOGIC');
console.log('Runtime release trigger contract: PASS');
