import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-release.yml';
const workflow = fs.readFileSync(path, 'utf8');

const required = [
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "MIN_CARRIER_VERSION_CODE: '15'",
  'V1_ARTIFACT_DELIVERY_TOKEN',
  'GH_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  '--repo "$SOURCE_REPO"',
  '--target "$NORMALIZED_SOURCE_SHA"',
  'run_stage "runtime-g6-static" npm run test:g6',
  'run_stage "runtime-smt-web-tests" npm --prefix apps/smt-web test',
  'run_stage "runtime-smt-web-build" npm --prefix apps/smt-web run build',
  'Private V1 Runtime delivery: PASS',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PRIVATE_DELIVERY_REQUIRED:${needle}`);
}

const forbidden = [
  'permissions:\n  contents: write',
  'GH_TOKEN: ${{ github.token }}',
  '--repo "$GITHUB_REPOSITORY"',
  'Signed runtime GitHub Release delivery: PASS',
  "MIN_CARRIER_VERSION_CODE: '13'",
  'npm run test:g6:web',
];
for (const needle of forbidden) {
  if (workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PUBLIC_OR_STALE_CONTRACT_FORBIDDEN:${needle}`);
}

if (!/permissions:\s*\n\s*contents:\s*read/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_DEFAULT_CONTENTS_MUST_BE_READ_ONLY');
}
if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
}

console.log('Runtime release private delivery contract: PASS');
