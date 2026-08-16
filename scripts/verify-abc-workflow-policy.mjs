import fs from 'node:fs';

const files = {
  core: '.github/workflows/verify-core.yml',
  a: '.github/workflows/verify-a.yml',
  b: '.github/workflows/verify-b.yml',
  c: '.github/workflows/verify-c.yml',
  integration: '.github/workflows/verify-abc-integration.yml',
  control: '.github/workflows/owner-verification-control.yml',
};

for (const [name, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) throw new Error(`ABC_VERIFY_WORKFLOW_REQUIRED:${name}:${path}`);
}

const read = (name) => fs.readFileSync(files[name], 'utf8');
const core = read('core');
const a = read('a');
const b = read('b');
const c = read('c');
const integration = read('integration');
const control = read('control');

const requireText = (label, text, needle) => {
  if (!text.includes(needle)) throw new Error(`${label}_REQUIRED:${needle}`);
};

requireText('CORE', core, 'workflow_call:');
requireText('CORE', core, 'source_sha:');
requireText('CORE', core, 'verification_profile:');
requireText('CORE', core, 'V1_SOURCE_READ_TOKEN');
requireText('CORE', core, 'Verify exact private source identity');
requireText('CORE', core, "tr -d '[:space:]'");
requireText('CORE', core, 'EXPECTED_SOURCE_SHA');
requireText('CORE', core, 'Private verification core: PASS');
requireText('CORE', core, 'Generate sanitized verification metadata');
requireText('CORE', core, 'Fail workflow after sanitized evidence');
requireText('CORE', core, 'npm run test:g5');
requireText('CORE', core, 'npm run test:current');
requireText('CORE', core, 'npm run typecheck:g5');
requireText('CORE', core, 'npm --prefix apps/smt-web test');
requireText('CORE', core, 'npm --prefix apps/smt-web run build');
requireText('CORE', core, 'npm run test:g6');
requireText('CORE', core, 'npm run typecheck:g6');

// B G5 failures must expose only a sanitized failing sub-stage, never private test output.
requireText('CORE', core, 'diagnose_b_g5()');
requireText('CORE', core, 'diagnostic_stage=$stage');
requireText('CORE', core, 'b-g5-order-service-mode');
requireText('CORE', core, 'b-g5-smt-orders-port');
requireText('CORE', core, 'b-g5-ui-smt-03-static');
requireText('CORE', core, 'if ! run_stage "b-g5-targeted" npm run test:g5; then');
requireText('CORE', core, 'diagnose_b_g5 || true');
requireText('CORE', core, 'DIAGNOSTIC_STAGE:');
requireText('CORE', core, 'diagnosticStage:');

const lineRules = [
  ['A', a, 'morefunos-v1-a-verify', "verification_profile: 'a'"],
  ['B', b, 'morefunos-v1-b-verify', "verification_profile: 'b'"],
  ['C', c, 'morefunos-v1-c-verify', "verification_profile: 'c'"],
  ['ABC', integration, 'morefunos-v1-abc-integration', "verification_profile: 'integration'"],
];

for (const [label, text, concurrency, profile] of lineRules) {
  requireText(label, text, 'workflow_dispatch:');
  requireText(label, text, 'workflow_call:');
  requireText(label, text, 'source_sha:');
  requireText(label, text, concurrency);
  requireText(label, text, "if: github.actor == 'Pantonyeung'");
  requireText(label, text, 'uses: ./.github/workflows/verify-core.yml');
  requireText(label, text, profile);
  requireText(label, text, 'secrets: inherit');
}

const uniqueConcurrency = new Set(lineRules.map(([, , group]) => group));
if (uniqueConcurrency.size !== lineRules.length) throw new Error('ABC_VERIFY_CONCURRENCY_MUST_BE_UNIQUE');

requireText('CONTROL', control, 'issue_comment:');
requireText('CONTROL', control, "github.actor == 'Pantonyeung'");
requireText('CONTROL', control, 'github.event.issue.number == 2');
requireText('CONTROL', control, '/verify-a ');
requireText('CONTROL', control, '/verify-b ');
requireText('CONTROL', control, '/verify-c ');
requireText('CONTROL', control, '/verify-abc ');
requireText('CONTROL', control, '^[0-9a-fA-F]{40}$');
requireText('CONTROL', control, 'uses: ./.github/workflows/verify-a.yml');
requireText('CONTROL', control, 'uses: ./.github/workflows/verify-b.yml');
requireText('CONTROL', control, 'uses: ./.github/workflows/verify-c.yml');
requireText('CONTROL', control, 'uses: ./.github/workflows/verify-abc-integration.yml');

const forbiddenAutomaticTriggers = [/^\s{2}push\s*:/m, /^\s{2}pull_request\s*:/m, /^\s{2}schedule\s*:/m, /^\s{2}workflow_run\s*:/m, /^\s{2}repository_dispatch\s*:/m];
for (const [name, text] of Object.entries({ a, b, c, integration, control })) {
  for (const pattern of forbiddenAutomaticTriggers) {
    if (pattern.test(text)) throw new Error(`ABC_VERIFY_AUTOMATIC_TRIGGER_FORBIDDEN:${name}:${pattern}`);
  }
  if (/contents:\s*write/.test(text)) throw new Error(`ABC_VERIFY_CONTENTS_WRITE_FORBIDDEN:${name}`);
  if (/persist-credentials:\s*true/.test(text)) throw new Error(`ABC_VERIFY_PERSIST_CREDENTIALS_FORBIDDEN:${name}`);
}

if (/contents:\s*write/.test(core)) throw new Error('ABC_VERIFY_CORE_CONTENTS_WRITE_FORBIDDEN');
if (/persist-credentials:\s*true/.test(core)) throw new Error('ABC_VERIFY_CORE_PERSIST_CREDENTIALS_FORBIDDEN');
if (/\b(?:cat|head|tail|sed\s+-n)\b[^\n]*(?:MainActivity|AndroidManifest|\.java|private-verification\.log)/i.test(core)) {
  throw new Error('ABC_VERIFY_PRIVATE_SOURCE_OR_LOG_OUTPUT_FORBIDDEN');
}

console.log('ABC independent verification workflow policy: PASS');
