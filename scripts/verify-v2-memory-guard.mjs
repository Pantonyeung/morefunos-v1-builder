import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'candidate');
const capabilityId = (process.argv[3] || '').trim().toUpperCase();
const capabilityAction = normalizeAction(process.argv[4] || '');
const workId = (process.argv[5] || '').trim();

const REQUIRED_ENTRY_FILES = [
  'AUTHORITY.md',
  'AI-INDEX.yaml',
  'docs/recovery/START-HERE.md',
  'docs/recovery/READ-FIREWALL.yaml',
  'docs/recovery/CURRENT-CYCLE.yaml',
  'docs/recovery/commander/CAPABILITY-CATALOG.yaml',
  'docs/workflows/WORK-ITEM-CONTRACT.yaml',
];

const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));

function normalizeAction(value) {
  const v = String(value || '').trim().toUpperCase();
  return v === 'REGRESSION' ? 'REGRESSION_REPAIR' : v;
}

function scalar(text, key) {
  const prefix = `${key}:`;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function emit(fields) {
  for (const [k, v] of Object.entries(fields)) console.log(`${k}=${String(v ?? '').replace(/\r?\n/g, ' ')}`);
}

function fail(stage, code, file = 'N/A', expected = 'N/A', actual = 'N/A', remediation = 'Fix only the named governance envelope; do not change unrelated product runtime.') {
  emit({
    GUARD_RESULT: 'FAIL',
    GUARD_STAGE: stage,
    ERROR_CODE: code,
    WORK_ID: workId || 'N/A',
    CAPABILITY_ID: capabilityId || 'N/A',
    FILE: file,
    EXPECTED: expected,
    ACTUAL: actual,
    REMEDIATION: remediation,
  });
  process.exit(1);
}

function pass(stage, globalAuditRequired = false) {
  emit({
    GUARD_RESULT: 'PASS',
    GUARD_STAGE: stage,
    WORK_ID: workId,
    CAPABILITY_ID: capabilityId,
    CAPABILITY_ACTION: capabilityAction,
    GLOBAL_AUDIT_REQUIRED: globalAuditRequired ? 'true' : 'false',
  });
}

// G0 ENTRY GUARD: identity + bounded authorization only.
for (const p of REQUIRED_ENTRY_FILES) {
  if (!exists(p)) fail('ENTRY', 'ENTRY_REQUIRED_FILE_MISSING', p, 'file exists', 'missing');
}

if (!/^CAP-[A-Z0-9][A-Z0-9-]*$/.test(capabilityId)) {
  fail('ENTRY', 'ENTRY_CAPABILITY_ID_INVALID', 'request', 'CAP-[A-Z0-9-]+', capabilityId || 'empty');
}
if (!workId) fail('ENTRY', 'ENTRY_WORK_ID_MISSING', 'request', 'non-empty work_id', 'empty');

const contract = read('docs/workflows/WORK-ITEM-CONTRACT.yaml');
const allowedActions = new Set();
const contractLines = contract.split(/\r?\n/);
const allowedHeader = contractLines.findIndex(line => line.trim() === 'allowed_capability_actions:');
if (allowedHeader < 0) fail('ENTRY', 'ENTRY_ACTION_CONTRACT_MISSING', 'docs/workflows/WORK-ITEM-CONTRACT.yaml', 'allowed_capability_actions', 'missing');
for (let i = allowedHeader + 1; i < contractLines.length; i += 1) {
  const m = /^\s+-\s+([A-Z0-9_]+)\s*$/.exec(contractLines[i]);
  if (!m) break;
  allowedActions.add(normalizeAction(m[1]));
}
if (!allowedActions.has(capabilityAction)) {
  fail('ENTRY', 'ENTRY_CAPABILITY_ACTION_INVALID', 'docs/workflows/WORK-ITEM-CONTRACT.yaml', [...allowedActions].join(','), capabilityAction || 'empty');
}

const catalog = read('docs/recovery/commander/CAPABILITY-CATALOG.yaml');
const capabilityMatches = [...catalog.matchAll(/^\s*- capability_id:\s*(CAP-[A-Z0-9-]+)\s*$/gm)].map(m => m[1]);
const duplicateIds = [...new Set(capabilityMatches.filter((id, i, a) => a.indexOf(id) !== i))];
if (duplicateIds.length) fail('ENTRY', 'ENTRY_DUPLICATE_CAPABILITY_ID', 'docs/recovery/commander/CAPABILITY-CATALOG.yaml', 'unique capability ids', duplicateIds.join(','));
if (!capabilityMatches.includes(capabilityId)) {
  fail('ENTRY', 'ENTRY_CAPABILITY_NOT_IN_CATALOG', 'docs/recovery/commander/CAPABILITY-CATALOG.yaml', capabilityId, 'not found');
}

const workFiles = walk(path.join(root, 'docs/workflows/work-items')).filter(p => /\.ya?ml$/i.test(p));
const workMatches = [];
for (const file of workFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (scalar(text, 'work_id') === workId) workMatches.push({ file, text });
}
if (workMatches.length === 0) fail('ENTRY', 'ENTRY_WORK_ITEM_NOT_FOUND', 'docs/workflows/work-items/**', workId, '0 matches');
if (workMatches.length > 1) fail('ENTRY', 'ENTRY_WORK_ITEM_NOT_UNIQUE', 'docs/workflows/work-items/**', '1 match', `${workMatches.length} matches`);

const work = workMatches[0];
const workRel = path.relative(root, work.file).replaceAll('\\', '/');
const unified = scalar(work.text, 'execution_model').toUpperCase() === 'SINGLE_FULL_SYSTEM_CONSOLIDATION_POOL';

if (unified) {
  if (!work.text.includes(capabilityId)) {
    fail('ENTRY', 'ENTRY_UNIFIED_WORK_CAPABILITY_MISSING', workRel, `contains ${capabilityId}`, 'not found');
  }
  const plans = walk(path.join(root, 'docs/plans')).filter(p => /\.(ya?ml|md)$/i.test(p));
  const accepted = [];
  for (const file of plans) {
    const text = fs.readFileSync(file, 'utf8');
    const planWork = scalar(text, 'work_id');
    const parentWork = scalar(text, 'parent_work_id');
    const planCap = scalar(text, 'capability_id').toUpperCase();
    const planAction = normalizeAction(scalar(text, 'capability_action'));
    const status = scalar(text, 'status').toUpperCase();
    if ((planWork === workId || parentWork === workId) && planCap === capabilityId && planAction === capabilityAction && status === 'ACCEPTED') {
      accepted.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  }
  if (accepted.length === 0) {
    fail('ENTRY', 'ENTRY_ACCEPTED_BOUNDED_PLAN_NOT_FOUND', 'docs/plans/**', `${workId}+${capabilityId}+${capabilityAction}+ACCEPTED`, '0 matches', 'Create or fix exactly one bounded Accepted Plan for this Work/Capability/Action; do not edit runtime to satisfy governance.');
  }
  if (accepted.length > 1) {
    fail('ENTRY', 'ENTRY_ACCEPTED_BOUNDED_PLAN_NOT_UNIQUE', 'docs/plans/**', '1 accepted bounded plan', accepted.join(','));
  }
} else {
  const workCap = scalar(work.text, 'capability_id').toUpperCase();
  const workAction = normalizeAction(scalar(work.text, 'capability_action'));
  if (workCap !== capabilityId) fail('ENTRY', 'ENTRY_WORK_CAPABILITY_MISMATCH', workRel, capabilityId, workCap || 'empty');
  if (workAction !== capabilityAction) fail('ENTRY', 'ENTRY_WORK_ACTION_MISMATCH', workRel, capabilityAction, workAction || 'empty');
  const planRef = scalar(work.text, 'plan');
  if (!planRef) fail('ENTRY', 'ENTRY_WORK_PLAN_POINTER_MISSING', workRel, 'plan: <exact path>', 'missing');
  if (!exists(planRef)) fail('ENTRY', 'ENTRY_PLAN_FILE_MISSING', planRef, 'file exists', 'missing');
  const plan = read(planRef);
  const planStatus = scalar(plan, 'status').toUpperCase();
  const planCap = scalar(plan, 'capability_id').toUpperCase();
  const planAction = normalizeAction(scalar(plan, 'capability_action'));
  if (planStatus !== 'ACCEPTED') fail('ENTRY', 'ENTRY_PLAN_NOT_ACCEPTED', planRef, 'ACCEPTED', planStatus || 'empty');
  if (planCap && planCap !== capabilityId) fail('ENTRY', 'ENTRY_PLAN_CAPABILITY_MISMATCH', planRef, capabilityId, planCap);
  if (planAction && planAction !== capabilityAction) fail('ENTRY', 'ENTRY_PLAN_ACTION_MISMATCH', planRef, capabilityAction, planAction);
}

pass('ENTRY');

// G1 SCOPE GUARD: request-relevant invariants only. No historical/global cross-document sweep.
const authority = read('AUTHORITY.md');
const cycle = read('docs/recovery/CURRENT-CYCLE.yaml');
const firewall = read('docs/recovery/READ-FIREWALL.yaml');
const start = read('docs/recovery/START-HERE.md');

if (!authority.includes('Pantonyeung/Morefun-v2')) fail('SCOPE', 'SCOPE_PRODUCT_AUTHORITY_MISSING', 'AUTHORITY.md', 'Pantonyeung/Morefun-v2', 'missing');
if (!authority.includes('Pantonyeung/morefunos-v1-builder')) fail('SCOPE', 'SCOPE_BUILDER_AUTHORITY_MISSING', 'AUTHORITY.md', 'Pantonyeung/morefunos-v1-builder', 'missing');
if (!cycle.includes('v2_native_ci_forbidden: true')) fail('SCOPE', 'SCOPE_V2_NATIVE_CI_POLICY_MISSING', 'docs/recovery/CURRENT-CYCLE.yaml', 'v2_native_ci_forbidden: true', 'missing');
if (!cycle.includes('builder_executor: Pantonyeung/morefunos-v1-builder')) fail('SCOPE', 'SCOPE_BUILDER_EXECUTOR_POLICY_MISSING', 'docs/recovery/CURRENT-CYCLE.yaml', 'builder_executor: Pantonyeung/morefunos-v1-builder', 'missing');
if (!firewall.includes('default_mode: CURRENT_MODE')) fail('SCOPE', 'SCOPE_READ_FIREWALL_MODE_MISSING', 'docs/recovery/READ-FIREWALL.yaml', 'default_mode: CURRENT_MODE', 'missing');
if (!start.includes('docs/recovery/CURRENT-CYCLE.yaml')) fail('SCOPE', 'SCOPE_START_HERE_ROUTING_MISSING', 'docs/recovery/START-HERE.md', 'CURRENT-CYCLE routing', 'missing');

if (capabilityAction === 'NEW_BUILD') {
  const manifest = `docs/workflows/completion-manifests/${workId}.yaml`;
  if (!exists(manifest)) fail('SCOPE', 'SCOPE_NEW_BUILD_MANIFEST_REQUIRED', manifest, 'manifest exists', 'missing');
  const text = read(manifest);
  if (!text.includes(`work_id: ${workId}`)) fail('SCOPE', 'SCOPE_NEW_BUILD_MANIFEST_WORK_MISMATCH', manifest, workId, 'mismatch');
  if (!text.includes(`capability_id: ${capabilityId}`)) fail('SCOPE', 'SCOPE_NEW_BUILD_MANIFEST_CAPABILITY_MISMATCH', manifest, capabilityId, 'mismatch');
}

pass('SCOPE');

// G2 GLOBAL: only true global boundary invariants. Local runtime work no longer scans every historical/current registry.
const globalAuditRequired = ['NEW_BUILD', 'SUPERSEDE'].includes(capabilityAction);
if (globalAuditRequired) {
  const globalRequired = [
    'GOVERNANCE-RULES.yaml',
    'WORK-POLICY.yaml',
    'INTEGRATION-POLICY.yaml',
    'docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md',
    'docs/recovery/commander/CAPABILITY-IDENTITY-RECONCILIATION-2026-09-08.yaml',
    'docs/recovery/commander/DOCUMENT-AUTHORITY-REGISTRY.yaml',
  ];
  for (const p of globalRequired) {
    if (!exists(p)) fail('GLOBAL', 'GLOBAL_REQUIRED_FILE_MISSING', p, 'file exists', 'missing');
  }
}

pass('GLOBAL', globalAuditRequired);
console.log('SCOPED_GUARD_COMPLETE=PASS');
