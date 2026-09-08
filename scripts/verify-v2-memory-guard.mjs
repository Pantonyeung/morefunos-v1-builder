import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'candidate');
const requestedCapabilityId = (process.argv[3] || '').trim().toUpperCase();
const requestedCapabilityAction = (process.argv[4] || '').trim().toUpperCase();
const requestedWorkId = (process.argv[5] || '').trim();

const required = [
  'AUTHORITY.md',
  'AI-INDEX.yaml',
  'docs/recovery/START-HERE.md',
  'docs/recovery/READ-FIREWALL.yaml',
  'docs/recovery/CURRENT-CYCLE.yaml',
  'docs/recovery/commander/CAPABILITY-CATALOG.yaml',
  'docs/recovery/commander/CAPABILITY-SOURCE-COVERAGE-AUDIT-2026-09-08.yaml',
  'docs/recovery/commander/AUXILIARY-ASSET-REGISTRY.yaml',
  'docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md',
  'docs/recovery/commander/CAPABILITY-IDENTITY-RECONCILIATION-2026-09-08.yaml',
  'docs/recovery/commander/DOCUMENT-AUTHORITY-REGISTRY.yaml',
  'docs/recovery/commander/CAPABILITY-DEEP-AUDIT-2026-09-08.md',
  'docs/recovery/commander/HISTORICAL-CAPABILITY-LINEAGE-2026-09-08.md',
  'docs/recovery/commander/HISTORICAL-REPORT-QUARANTINE-REGISTRY.yaml',
  'GOVERNANCE-RULES.yaml',
  'WORK-POLICY.yaml',
  'PORT-IMPLEMENTATION-REGISTRY.yaml',
  'INTEGRATION-REGISTRY.yaml',
  'docs/workflows/WORK-ITEM-CONTRACT.yaml',
  'PLAN-TEMPLATE.yaml',
  'docs/workflows/GATE-REGISTRY.yaml',
  'docs/workflows/WORKFLOW-REGISTRY.yaml',
  'docs/workflows/WORK-STATE-MACHINE.yaml',
  'ROOM-TEMPLATE.yaml',
  'BRANCH-POLICY.yaml',
  'docs/workflows/SELF-SERVICE-GOVERNANCE-CONTRACT.yaml',
  'INTEGRATION-POLICY.yaml',
  'docs/workflows/FAILURE-CORRECTION-CLOSURE-CONTRACT.yaml',
  'docs/recovery/TEAM-HANDOFF-PROTOCOL.md',
  'docs/GOVERNANCE.md',
  'docs/ROOMS.md',
  'docs/constitution/README.md',
];

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

for (const p of required) {
  if (!fs.existsSync(path.join(root, p))) {
    throw new Error(`MEMORY_GUARD_REQUIRED_FILE_MISSING:${p}`);
  }
}

const authority = read('AUTHORITY.md');
const index = read('AI-INDEX.yaml');
const start = read('docs/recovery/START-HERE.md');
const firewall = read('docs/recovery/READ-FIREWALL.yaml');
const cycle = read('docs/recovery/CURRENT-CYCLE.yaml');
const catalog = read('docs/recovery/commander/CAPABILITY-CATALOG.yaml');
const sourceCoverageAudit = read('docs/recovery/commander/CAPABILITY-SOURCE-COVERAGE-AUDIT-2026-09-08.yaml');
const auxiliaryAssetRegistry = read('docs/recovery/commander/AUXILIARY-ASSET-REGISTRY.yaml');
const masterRegistry = read('docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md');
const docRegistry = read('docs/recovery/commander/DOCUMENT-AUTHORITY-REGISTRY.yaml');
const quarantineRegistry = read('docs/recovery/commander/HISTORICAL-REPORT-QUARANTINE-REGISTRY.yaml');
const governance = read('GOVERNANCE-RULES.yaml');
const workPolicy = read('WORK-POLICY.yaml');
const portRegistry = read('PORT-IMPLEMENTATION-REGISTRY.yaml');
const integrationRegistry = read('INTEGRATION-REGISTRY.yaml');
const workItemContract = read('docs/workflows/WORK-ITEM-CONTRACT.yaml');
const planTemplate = read('PLAN-TEMPLATE.yaml');
const gateRegistry = read('docs/workflows/GATE-REGISTRY.yaml');
const workflowRegistry = read('docs/workflows/WORKFLOW-REGISTRY.yaml');
const workStateMachine = read('docs/workflows/WORK-STATE-MACHINE.yaml');
const roomTemplate = read('ROOM-TEMPLATE.yaml');
const branchPolicy = read('BRANCH-POLICY.yaml');
const selfServiceGovernance = read('docs/workflows/SELF-SERVICE-GOVERNANCE-CONTRACT.yaml');
const integrationPolicy = read('INTEGRATION-POLICY.yaml');
const failureClosure = read('docs/workflows/FAILURE-CORRECTION-CLOSURE-CONTRACT.yaml');

const requireText = (text, needle, code) => {
  if (!text.includes(needle)) throw new Error(`${code}:${needle}`);
};

const capabilityIds = new Set();
const capabilityPaths = [];
let currentCapabilityId = null;
let inCanonicalPaths = false;
for (const raw of catalog.split(/\r?\n/)) {
  const idMatch = raw.match(/^  - capability_id:\s*(CAP-[A-Z0-9-]+)\s*$/);
  if (idMatch) {
    const id = idMatch[1];
    if (capabilityIds.has(id)) throw new Error('MEMORY_GUARD_DUPLICATE_CAPABILITY_ID:' + id);
    capabilityIds.add(id);
    currentCapabilityId = id;
    inCanonicalPaths = false;
    continue;
  }
  if (/^    canonical_paths:\s*$/.test(raw)) {
    inCanonicalPaths = true;
    continue;
  }
  if (/^    [a-zA-Z0-9_]+:/.test(raw)) {
    inCanonicalPaths = false;
  }
  if (inCanonicalPaths) {
    const pathMatch = raw.match(/^      -\s+(.+?)\s*$/);
    if (pathMatch && currentCapabilityId) {
      const p = pathMatch[1].replace(/^[\"']|[\"']$/g, '');
      if (p) capabilityPaths.push({ capabilityId: currentCapabilityId, path: p });
    }
  }
}



const legacyCapabilityMap = new Map();
for (const match of catalog.matchAll(/legacy_id:\s*(CAP-[A-Z0-9-]+)\s*\n\s*canonical_id:\s*(CAP-[A-Z0-9-]+)/g)) {
  const legacyId = match[1];
  const canonicalId = match[2];
  if (legacyCapabilityMap.has(legacyId) && legacyCapabilityMap.get(legacyId) !== canonicalId) {
    throw new Error('MEMORY_GUARD_LEGACY_ID_AMBIGUOUS:' + legacyId);
  }
  if (capabilityIds.has(legacyId)) {
    throw new Error('MEMORY_GUARD_LEGACY_ID_ALSO_CANONICAL:' + legacyId);
  }
  if (!capabilityIds.has(canonicalId)) {
    throw new Error('MEMORY_GUARD_LEGACY_TARGET_MISSING:' + legacyId + ':' + canonicalId);
  }
  legacyCapabilityMap.set(legacyId, canonicalId);
}

const masterCapabilityIds = new Set(
  [...masterRegistry.matchAll(/\b(CAP-[A-Z0-9-]+)\b/g)].map(m => m[1]),
);
for (const masterId of masterCapabilityIds) {
  if (!capabilityIds.has(masterId) && !legacyCapabilityMap.has(masterId)) {
    throw new Error('MEMORY_GUARD_MASTER_ID_UNRESOLVED:' + masterId);
  }
}
for (const canonicalId of capabilityIds) {
  if (!masterCapabilityIds.has(canonicalId)) {
    throw new Error('MEMORY_GUARD_CANONICAL_ID_MISSING_HUMAN_MASTER:' + canonicalId);
  }
}
requireText(masterRegistry, '## Phase 9｜Canonical Capability Identity Reconciliation', 'MEMORY_GUARD_PHASE9_HUMAN_RECONCILIATION_MISSING');
requireText(catalog, 'legacy_capability_id_mappings:', 'MEMORY_GUARD_PHASE9_LEGACY_MAPPING_MISSING');

if (!requestedWorkId) throw new Error('MEMORY_GUARD_WORK_ID_MISSING');

const walkFiles = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out;
};

const walkAllFiles = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAllFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

const scalarField = (text, key) => {
  const lines = text.split(/\r?\n/);
  const prefix = key + ':';
  for (const raw of lines) {
    if (!raw.startsWith(prefix)) continue;
    return raw.slice(prefix.length).trim().replace(/^[\"']|[\"']$/g, '');
  }
  return '';
};

if (!/^CAP-[A-Z0-9][A-Z0-9-]*$/.test(requestedCapabilityId)) {
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_ID_INVALID:' + requestedCapabilityId);
}
const allowedCapabilityActions = new Set(['REUSE','LINKUP','EXTEND','REGRESSION_REPAIR','PHYSICAL_ACCEPTANCE','NEW_BUILD','SUPERSEDE']);
if (!allowedCapabilityActions.has(requestedCapabilityAction)) {
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_ACTION_INVALID:' + requestedCapabilityAction);
}
if (!capabilityIds.has(requestedCapabilityId)) {
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_NOT_IN_CATALOG:' + requestedCapabilityId);
}

const workItemRoot = path.join(root, 'docs/workflows/work-items');
const workItemMatches = [];
for (const file of walkFiles(workItemRoot)) {
  const text = fs.readFileSync(file, 'utf8');
  if (scalarField(text, 'work_id') === requestedWorkId) workItemMatches.push({file, text});
}
if (workItemMatches.length === 0) throw new Error('MEMORY_GUARD_WORK_ITEM_NOT_FOUND:' + requestedWorkId);
if (workItemMatches.length !== 1) throw new Error('MEMORY_GUARD_WORK_ITEM_NOT_UNIQUE:' + requestedWorkId + ':' + workItemMatches.length);

const workItem = workItemMatches[0];
const wiCapabilityId = scalarField(workItem.text, 'capability_id').toUpperCase();
const wiCapabilityAction = scalarField(workItem.text, 'capability_action').toUpperCase();
if (wiCapabilityId !== requestedCapabilityId) {
  throw new Error('MEMORY_GUARD_WORK_ITEM_CAPABILITY_ID_MISMATCH:' + requestedWorkId + ':' + wiCapabilityId + ':' + requestedCapabilityId);
}
if (wiCapabilityAction !== requestedCapabilityAction) {
  throw new Error('MEMORY_GUARD_WORK_ITEM_CAPABILITY_ACTION_MISMATCH:' + requestedWorkId + ':' + wiCapabilityAction + ':' + requestedCapabilityAction);
}

const planRef = scalarField(workItem.text, 'plan');
if (!planRef) throw new Error('MEMORY_GUARD_WORK_ITEM_PLAN_MISSING:' + requestedWorkId);
const planFile = path.join(root, planRef);
if (!fs.existsSync(planFile)) throw new Error('MEMORY_GUARD_WORK_ITEM_PLAN_NOT_FOUND:' + requestedWorkId + ':' + planRef);
const planText = fs.readFileSync(planFile, 'utf8');
const planCapabilityId = scalarField(planText, 'capability_id').toUpperCase();
const planCapabilityAction = scalarField(planText, 'capability_action').toUpperCase();
if (planCapabilityId !== requestedCapabilityId) {
  throw new Error('MEMORY_GUARD_PLAN_CAPABILITY_ID_MISMATCH:' + requestedWorkId + ':' + planCapabilityId + ':' + requestedCapabilityId);
}
if (planCapabilityAction !== requestedCapabilityAction) {
  throw new Error('MEMORY_GUARD_PLAN_CAPABILITY_ACTION_MISMATCH:' + requestedWorkId + ':' + planCapabilityAction + ':' + requestedCapabilityAction);
}
for (const requiredCapability of [
  'CAP-ORDER-IDENTITY-001',
  'CAP-CUSTOMER-ORDER-001',
  'CAP-PAYMENT-REFUND-001',
  'CAP-PRINT-CORE-001',
  'CAP-FULFILLMENT-001',
  'CAP-KEETA-INGRESS-001',
  'CAP-STAFF-RBAC-001',
  'CAP-STORE-CONFIG-001',
]) {
  if (!capabilityIds.has(requiredCapability)) {
    throw new Error('MEMORY_GUARD_REQUIRED_CAPABILITY_MISSING:' + requiredCapability);
  }
}

const integrationCapabilityRefs = new Set();
for (const raw of integrationRegistry.split(/\r?\n/)) {
  const direct = raw.match(/^\s+capability_id:\s*(CAP-[A-Z0-9-]+)\s*$/);
  if (direct) integrationCapabilityRefs.add(direct[1]);
  const listRef = raw.match(/^\s+-\s+(CAP-[A-Z0-9-]+)\s*$/);
  if (listRef) integrationCapabilityRefs.add(listRef[1]);
}
if (requestedCapabilityAction === 'NEW_BUILD') {
  const marker = '- capability_id: ' + requestedCapabilityId;
  const startIndex = catalog.indexOf(marker);
  const nextIndex = catalog.indexOf('\n  - capability_id:', startIndex + marker.length);
  const block = startIndex >= 0 ? catalog.slice(startIndex, nextIndex >= 0 ? nextIndex : catalog.length) : '';
  if (/no_redo:\s*true/.test(block) && !/lifecycle:\s*(PARTIAL|DRAFT|DISCOVERED)/.test(block)) {
    throw new Error('MEMORY_GUARD_NEW_BUILD_REUSES_NO_REDO_CAPABILITY:' + requestedCapabilityId);
  }
}

for (const id of integrationCapabilityRefs) {
  if (!capabilityIds.has(id)) throw new Error('MEMORY_GUARD_DANGLING_INTEGRATION_CAPABILITY_REF:' + id);
}

const catalogCapabilityRefs = new Set();
for (const raw of catalog.split(/\r?\n/)) {
  const ref = raw.match(/^\s{6}-\s+(CAP-[A-Z0-9-]+)\s*$/);
  if (ref) catalogCapabilityRefs.add(ref[1]);
}
for (const id of catalogCapabilityRefs) {
  if (!capabilityIds.has(id)) throw new Error('MEMORY_GUARD_DANGLING_CATALOG_CAPABILITY_REF:' + id);
}

for (const entry of capabilityPaths) {
  if (!fs.existsSync(path.join(root, entry.path))) {
    throw new Error('MEMORY_GUARD_CANONICAL_PATH_MISSING:' + entry.capabilityId + ':' + entry.path);
  }
}

requireText(authority, 'Read Firewall', 'MEMORY_GUARD_AUTHORITY_FIREWALL_MISSING');
requireText(authority, 'Capability-first hard rule', 'MEMORY_GUARD_CAPABILITY_FIRST_MISSING');

requireText(index, 'docs/recovery/READ-FIREWALL.yaml', 'MEMORY_GUARD_AI_INDEX_FIREWALL_MISSING');
requireText(index, 'historical_reports_cross_read_for_current_truth: FORBIDDEN', 'MEMORY_GUARD_CROSS_REPORT_DENY_MISSING');
requireText(index, 'evidence_mode_requires_capability_id: true', 'MEMORY_GUARD_EVIDENCE_MODE_ID_MISSING');
requireText(index, 'room_records_are_workflow_local_not_repository_current_truth: true', 'MEMORY_GUARD_ROOM_TRUTH_BYPASS');
requireText(index, 'empty_registry_means_no_accepted_v2_cross_room_product_flow: false', 'MEMORY_GUARD_INTEGRATION_STATE_STALE');

requireText(start, 'CURRENT_MODE', 'MEMORY_GUARD_CURRENT_MODE_MISSING');
requireText(start, 'EVIDENCE_MODE', 'MEMORY_GUARD_EVIDENCE_MODE_MISSING');
if (start.includes('R0102 Pricing')) throw new Error('MEMORY_GUARD_STALE_START_HERE_R0102');

requireText(firewall, 'deny_cross_report_current_truth_inference: true', 'MEMORY_GUARD_FIREWALL_CROSS_REPORT_MISSING');
requireText(firewall, 'docs/rooms/**', 'MEMORY_GUARD_ROOMS_DENY_MISSING');
requireText(firewall, 'requires:', 'MEMORY_GUARD_EVIDENCE_REQUIREMENTS_MISSING');

for (const needle of [
  'read_firewall: docs/recovery/READ-FIREWALL.yaml',
  'capability_catalog: docs/recovery/commander/CAPABILITY-CATALOG.yaml',
  'document_authority_registry: docs/recovery/commander/DOCUMENT-AUTHORITY-REGISTRY.yaml',
  'current_mode_historical_cross_report_read_forbidden: true',
]) {
  requireText(cycle, needle, 'MEMORY_GUARD_CURRENT_CYCLE_BINDING_MISSING');
}

requireText(catalog, 'catalog_id: MOREFUNOS-CAPABILITY-CATALOG', 'MEMORY_GUARD_CATALOG_ID_MISSING');
requireText(catalog, 'new_build_requires_catalog_absence_proof: true', 'MEMORY_GUARD_CATALOG_NO_REDO_RULE_MISSING');
requireText(docRegistry, 'SEARCH_RESULT_DOES_NOT_EQUAL_AUTHORITY', 'MEMORY_GUARD_DOC_AUTHORITY_RULE_MISSING');
requireText(docRegistry, 'CROSS_REPORT_CURRENT_TRUTH_INFERENCE_FORBIDDEN', 'MEMORY_GUARD_DOC_CROSS_REPORT_RULE_MISSING');
requireText(governance, 'first: MEMORY_GATEWAY', 'MEMORY_GUARD_GOV_ROUTING_MISSING');
requireText(governance, 'only_valid_method: CURRENT_CYCLE_PLUS_CAPABILITY_CATALOG_PLUS_EXACT_LATEST_ADMITTED_SOURCE', 'MEMORY_GUARD_LATEST_TRUTH_RULE_STALE');
requireText(governance, 'before_any_repo_search: false', 'MEMORY_GUARD_ROOM_ENTRY_STILL_PRESEARCH');
requireText(governance, 'room_current_handoff_as_default_current_truth: FORBIDDEN', 'MEMORY_GUARD_ROOM_BYPASS_PRESENT');
requireText(workPolicy, 'resolve_capability_id_and_action', 'MEMORY_GUARD_WORK_CAPABILITY_RESOLUTION_MISSING');
requireText(portRegistry, 'implementation_locator_is_not_capability_status: true', 'MEMORY_GUARD_PORT_REGISTRY_STATE_DRIFT');
requireText(portRegistry, 'no_remaining_or_completion_percentage_fields: true', 'MEMORY_GUARD_PORT_REGISTRY_REMAINING_DRIFT');
requireText(integrationRegistry, 'flow_id: INTG-KEETA-HK-001', 'MEMORY_GUARD_KEETA_FLOW_MISSING');
requireText(integrationRegistry, 'status: ACTIVE', 'MEMORY_GUARD_NO_ACTIVE_INTEGRATION_FLOW');
requireText(workItemContract, '- capability_id', 'MEMORY_GUARD_WORK_ITEM_CAPABILITY_ID_MISSING');
requireText(workItemContract, '- capability_action', 'MEMORY_GUARD_WORK_ITEM_CAPABILITY_ACTION_MISSING');
requireText(planTemplate, 'capability_id: null', 'MEMORY_GUARD_PLAN_CAPABILITY_ID_MISSING');
requireText(planTemplate, 'capability_action: null', 'MEMORY_GUARD_PLAN_CAPABILITY_ACTION_MISSING');
requireText(gateRegistry, 'G01A_CAPABILITY_MEMORY:', 'MEMORY_GUARD_CAPABILITY_GATE_MISSING');
requireText(workflowRegistry, 'G01A_CAPABILITY_MEMORY', 'MEMORY_GUARD_WORKFLOW_CAPABILITY_GATE_MISSING');
requireText(workStateMachine, 'classification_requires_capability_resolution: true', 'MEMORY_GUARD_STATE_CAPABILITY_RESOLUTION_MISSING');
requireText(cycle, 'CONSTITUTION_GATE: PASS_ACCEPTED_B0015', 'MEMORY_GUARD_CONSTITUTION_GATE_NOT_CURRENT');
requireText(cycle, 'cross_port_gap_register_read_mode: EVIDENCE_MODE_ONLY_FOR_EXPLICIT_GAP_OR_REGRESSION_INVESTIGATION', 'MEMORY_GUARD_STALE_GAP_MANDATORY_READ');
requireText(cycle, 'LATEST_MAIN_SHA_AT_COMMANDER_REFRESH: DYNAMIC_RESOLVE_REQUIRED_DO_NOT_TRUST_CACHED_SHA', 'MEMORY_GUARD_CACHED_MAIN_SHA_PRESENT');
requireText(roomTemplate, 'Memory Gateway + Read Firewall + CURRENT-CYCLE + Capability Catalog', 'MEMORY_GUARD_ROOM_TEMPLATE_STALE');
requireText(roomTemplate, '歷史只可 EVIDENCE_MODE + 同一 Capability ID 解鎖', 'MEMORY_GUARD_ROOM_HISTORY_BYPASS');
requireText(branchPolicy, 'resolve_capability_id_and_action', 'MEMORY_GUARD_BRANCH_CAPABILITY_BYPASS');
requireText(selfServiceGovernance, 'capability_resolution_required_before_workspace_reservation: true', 'MEMORY_GUARD_SELF_SERVICE_CAPABILITY_BYPASS');
requireText(selfServiceGovernance, 'memory_guard_pass_true', 'MEMORY_GUARD_SELF_SERVICE_ADMISSION_BYPASS');
requireText(selfServiceGovernance, 'required_for_new_records_after_memory_firewall:', 'MEMORY_GUARD_RESERVATION_CAPABILITY_ID_MISSING');
requireText(selfServiceGovernance, 'completion_manifest_required_for_new_records_after_memory_firewall:', 'MEMORY_GUARD_COMPLETION_CAPABILITY_ID_MISSING');
requireText(branchPolicy, 'create_exact_workspace_reservation_record_with_capability_id_and_action', 'MEMORY_GUARD_BRANCH_RESERVATION_CAPABILITY_MISSING');
requireText(branchPolicy, 'create_completion_manifest_with_capability_id_and_action', 'MEMORY_GUARD_BRANCH_COMPLETION_CAPABILITY_MISSING');
requireText(integrationPolicy, 'active_flow_requires_capability_id: true', 'MEMORY_GUARD_INTEGRATION_CAPABILITY_BYPASS');
requireText(failureClosure, 'current_cycle_capability_registry_and_workflow_local_updates_complete_before_terminal_seal', 'MEMORY_GUARD_FAILURE_CLOSURE_STALE');


const cycleLineCount = cycle.split(/\r?\n/).length;
if (cycleLineCount > 220) throw new Error('MEMORY_GUARD_CURRENT_CYCLE_TOO_LARGE:' + cycleLineCount);
requireText(cycle, 'keep_current_cycle_compact: true', 'MEMORY_GUARD_CURRENT_COMPACT_RULE_MISSING');
requireText(cycle, 'historical_incident_detail_in_current_cycle: FORBIDDEN', 'MEMORY_GUARD_CURRENT_HISTORY_POLLUTION_RULE_MISSING');
requireText(cycle, 'old_builder_run_log_in_current_cycle: FORBIDDEN', 'MEMORY_GUARD_CURRENT_OLD_RUN_RULE_MISSING');
requireText(cycle, 'historical_cycle_snapshot:', 'MEMORY_GUARD_CURRENT_HISTORY_SNAPSHOT_POINTER_MISSING');

requireText(quarantineRegistry, 'registry_id: MOREFUNOS-HISTORICAL-REPORT-QUARANTINE', 'MEMORY_GUARD_QUARANTINE_REGISTRY_MISSING');
requireText(quarantineRegistry, 'phase_1_root_new_chat:', 'MEMORY_GUARD_QUARANTINE_PHASE1_MISSING');
requireText(quarantineRegistry, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_QUARANTINE_PHASE1_NOT_GREEN');
requireText(quarantineRegistry, 'builder_run: 34177402845', 'MEMORY_GUARD_QUARANTINE_PHASE1_RUN_MISSING');
requireText(firewall, 'docs/recovery/history/**', 'MEMORY_GUARD_HISTORY_AUTO_READ_NOT_BLOCKED');
requireText(firewall, 'docs/recovery/NEW-CHAT-SEAMLESS-*.md', 'MEMORY_GUARD_ROOT_NEW_CHAT_AUTO_READ_NOT_BLOCKED');

const phase1Start = quarantineRegistry.indexOf('phase_1_root_new_chat:');
const phase2Start = quarantineRegistry.indexOf('phase_2_root_governance:');
const phase1Block = quarantineRegistry.slice(
  phase1Start,
  phase2Start > phase1Start ? phase2Start : quarantineRegistry.length,
);
const quarantineOriginals = [...phase1Block.matchAll(/^    - original_path:\s*(.+?)\s*$/gm)].map(m => m[1].trim());
const quarantineBodies = [...phase1Block.matchAll(/^      historical_body:\s*(.+?)\s*$/gm)].map(m => m[1].trim());
if (quarantineOriginals.length !== 7 || quarantineBodies.length !== 7) {
  throw new Error('MEMORY_GUARD_QUARANTINE_PHASE1_COUNT_MISMATCH:' + quarantineOriginals.length + ':' + quarantineBodies.length);
}
for (let i = 0; i < quarantineOriginals.length; i += 1) {
  const original = path.join(root, quarantineOriginals[i]);
  const body = path.join(root, quarantineBodies[i]);
  if (!fs.existsSync(original)) throw new Error('MEMORY_GUARD_QUARANTINE_POINTER_MISSING:' + quarantineOriginals[i]);
  if (!fs.existsSync(body)) throw new Error('MEMORY_GUARD_QUARANTINE_BODY_MISSING:' + quarantineBodies[i]);
  const originalText = fs.readFileSync(original, 'utf8');
  const bodyText = fs.readFileSync(body, 'utf8');
  if (!originalText.includes('HISTORICAL_COMPATIBILITY_POINTER')) {
    throw new Error('MEMORY_GUARD_QUARANTINE_POINTER_NOT_TOMBSTONED:' + quarantineOriginals[i]);
  }
  if (!bodyText.includes('DOCUMENT_CLASS: HISTORICAL_EVIDENCE')) {
    throw new Error('MEMORY_GUARD_QUARANTINE_BODY_NOT_EVIDENCE:' + quarantineBodies[i]);
  }
}


requireText(quarantineRegistry, 'phase_2_root_governance:', 'MEMORY_GUARD_QUARANTINE_PHASE2_MISSING');
const phase2GovernanceStart = quarantineRegistry.indexOf('phase_2_root_governance:');
const phase3RootStart = quarantineRegistry.indexOf('phase_3_root_final:');
const phase2Block = quarantineRegistry.slice(phase2GovernanceStart, phase3RootStart > phase2GovernanceStart ? phase3RootStart : quarantineRegistry.length);
requireText(phase2Block, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_QUARANTINE_PHASE2_NOT_GREEN');
const phase2Quarantined = [
  'docs/recovery/COMMAND-CENTER.md',
  'docs/recovery/COMMANDER-BOOTSTRAP.md',
  'docs/recovery/GAP-LEDGER.yaml',
  'docs/recovery/LANDING-LEDGER.yaml',
  'docs/recovery/THREE-TO-TWO-TEAM-TRANSITION.md',
  'docs/recovery/KEETA-HISTORICAL-ASSET-NO-REDO-LEDGER-2026-09-04.md',
];
for (const originalPath of phase2Quarantined) {
  const original = path.join(root, originalPath);
  if (!fs.existsSync(original)) throw new Error('MEMORY_GUARD_PHASE2_POINTER_MISSING:' + originalPath);
  const text = fs.readFileSync(original, 'utf8');
  if (!text.includes('HISTORICAL_COMPATIBILITY_POINTER')) {
    throw new Error('MEMORY_GUARD_PHASE2_NOT_TOMBSTONED:' + originalPath);
  }
  const basename = path.basename(originalPath);
  const body = path.join(root, 'docs/recovery/history/root-governance', basename);
  if (!fs.existsSync(body)) throw new Error('MEMORY_GUARD_PHASE2_BODY_MISSING:' + basename);
}
const handoffProtocol = read('docs/recovery/TEAM-HANDOFF-PROTOCOL.md');
const docsGovernance = read('docs/GOVERNANCE.md');
const docsRooms = read('docs/ROOMS.md');
const constitutionReadme = read('docs/constitution/README.md');
requireText(handoffProtocol, 'CAPABILITY_ID:', 'MEMORY_GUARD_HANDOFF_CAPABILITY_ID_MISSING');
requireText(handoffProtocol, '喺 `docs/recovery/commander/CAPABILITY-CATALOG.yaml` resolve `capability_id`', 'MEMORY_GUARD_HANDOFF_CAPABILITY_FIRST_MISSING');
requireText(handoffProtocol, 'Repository current truth仍由：', 'MEMORY_GUARD_HANDOFF_AUTHORITY_BOUNDARY_MISSING');


requireText(quarantineRegistry, 'phase_3_root_final:', 'MEMORY_GUARD_PHASE3_ROOT_POLICY_MISSING');
requireText(quarantineRegistry, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE3_NOT_GREEN');
requireText(quarantineRegistry, 'builder_run: 34178825898', 'MEMORY_GUARD_PHASE3_RUN_MISSING');
requireText(quarantineRegistry, 'root_current_allowlist:', 'MEMORY_GUARD_ROOT_ALLOWLIST_MISSING');
requireText(firewall, 'docs/recovery/ADDRESS-BASED-WORKFLOW.md', 'MEMORY_GUARD_ADDRESS_ROUTING_NOT_BLOCKED');

const addressPath = path.join(root, 'docs/recovery/ADDRESS-BASED-WORKFLOW.md');
const addressHistory = path.join(root, 'docs/recovery/history/root-governance/ADDRESS-BASED-WORKFLOW.md');
if (!fs.existsSync(addressPath) || !fs.readFileSync(addressPath, 'utf8').includes('HISTORICAL_COMPATIBILITY_POINTER')) {
  throw new Error('MEMORY_GUARD_ADDRESS_ROUTING_NOT_TOMBSTONED');
}
if (!fs.existsSync(addressHistory) || !fs.readFileSync(addressHistory, 'utf8').includes('HISTORICAL_EVIDENCE')) {
  throw new Error('MEMORY_GUARD_ADDRESS_HISTORY_MISSING');
}

const realDevicePath = path.join(root, 'docs/recovery/REAL-DEVICE-MASTER-CHECKLIST.md');
const realDeviceHistory = path.join(root, 'docs/recovery/history/root-acceptance/REAL-DEVICE-MASTER-CHECKLIST-R2-PRE-REFRESH-2026-09-08.md');
if (!fs.existsSync(realDevicePath)) throw new Error('MEMORY_GUARD_REAL_DEVICE_CHECKLIST_MISSING');
if (!fs.existsSync(realDeviceHistory)) throw new Error('MEMORY_GUARD_REAL_DEVICE_R2_ARCHIVE_MISSING');
const realDevice = fs.readFileSync(realDevicePath, 'utf8');
requireText(realDevice, 'CURRENT_CAMPAIGN: 2026-09-08_FRONTLINE_PHYSICAL_AND_GOLDEN', 'MEMORY_GUARD_REAL_DEVICE_CAMPAIGN_STALE');
requireText(realDevice, '# A9 — FRONTLINE PHYSICAL ACCEPTANCE', 'MEMORY_GUARD_REAL_DEVICE_A9_MISSING');
requireText(realDevice, '# A10 — FRONTLINE GOLDEN DAY', 'MEMORY_GUARD_REAL_DEVICE_A10_MISSING');
requireText(realDevice, '# A11/B11 — FULL OPERATIONAL HANDSHAKE', 'MEMORY_GUARD_REAL_DEVICE_A11_MISSING');
if (realDevice.includes('CURRENT_CAMPAIGN: R2') || realDevice.includes('d40a70acaa2ec7dbb549a81ccf8092e3a028bc28')) {
  throw new Error('MEMORY_GUARD_REAL_DEVICE_OLD_R2_TRUTH_PRESENT');
}

const recoveryRoot = path.join(root, 'docs/recovery');
const allowedCurrentRootFiles = new Set([
  'CURRENT-CYCLE.yaml',
  'READ-FIREWALL.yaml',
  'START-HERE.md',
  'REAL-DEVICE-MASTER-CHECKLIST.md',
  'TEAM-HANDOFF-PROTOCOL.md',
]);
for (const entry of fs.readdirSync(recoveryRoot, {withFileTypes:true})) {
  if (!entry.isFile()) continue;
  if (allowedCurrentRootFiles.has(entry.name)) continue;
  const full = path.join(recoveryRoot, entry.name);
  const text = fs.readFileSync(full, 'utf8');
  if (!text.includes('HISTORICAL_COMPATIBILITY_POINTER')) {
    throw new Error('MEMORY_GUARD_RECOVERY_ROOT_UNCLASSIFIED_LONG_FORM:' + entry.name);
  }
}


requireText(quarantineRegistry, 'phase_4_commander_high_risk:', 'MEMORY_GUARD_PHASE4_COMMANDER_QUARANTINE_MISSING');
requireText(quarantineRegistry, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE4_COMMANDER_NOT_GREEN');
{
  const p4Start = quarantineRegistry.indexOf('phase_4_commander_high_risk:');
  const p5Start = quarantineRegistry.indexOf('phase_5', p4Start + 1);
  const p4Block = quarantineRegistry.slice(p4Start, p5Start > p4Start ? p5Start : quarantineRegistry.length);
  if (!/builder_run:\s*\d+/.test(p4Block)) {
    throw new Error('MEMORY_GUARD_PHASE4_COMMANDER_RUN_MISSING');
  }
  if (!/exact_candidate_sha:\s*[0-9a-f]{40}/.test(p4Block)) {
    throw new Error('MEMORY_GUARD_PHASE4_COMMANDER_SHA_MISSING');
  }
}
const commanderPhase4 = [
  ['docs/recovery/commander/WORK-ACCEPTANCE-JOURNAL.md','docs/recovery/history/commander/WORK-ACCEPTANCE-JOURNAL-PRE-QUARANTINE-2026-09-08.md'],
  ['docs/recovery/commander/ACTIVE-CHANGE-LEASES.yaml','docs/recovery/history/commander/ACTIVE-CHANGE-LEASES-PRE-QUARANTINE-2026-09-08.yaml'],
  ['docs/recovery/commander/ADMISSION-QUEUE.yaml','docs/recovery/history/commander/ADMISSION-QUEUE-PRE-QUARANTINE-2026-09-08.yaml'],
  ['docs/recovery/commander/COMMANDER-MASTER-LEDGER.md','docs/recovery/history/commander/COMMANDER-MASTER-LEDGER-PRE-QUARANTINE-2026-09-08.md'],
];
for (const [pointerPath, historyPath] of commanderPhase4) {
  const pointer = path.join(root, pointerPath);
  const history = path.join(root, historyPath);
  if (!fs.existsSync(pointer)) throw new Error('MEMORY_GUARD_PHASE4_POINTER_MISSING:' + pointerPath);
  if (!fs.existsSync(history)) throw new Error('MEMORY_GUARD_PHASE4_HISTORY_MISSING:' + historyPath);
  const pointerText = fs.readFileSync(pointer, 'utf8');
  if (!pointerText.includes('HISTORICAL_COMPATIBILITY_POINTER')) {
    throw new Error('MEMORY_GUARD_PHASE4_POINTER_NOT_TOMBSTONED:' + pointerPath);
  }
}
const journalPointer = fs.readFileSync(path.join(root, 'docs/recovery/commander/WORK-ACCEPTANCE-JOURNAL.md'), 'utf8');
requireText(journalPointer, 'DOCUMENT_CLASS: HISTORICAL_COMPATIBILITY_POINTER', 'MEMORY_GUARD_PHASE4_JOURNAL_POINTER_CLASS_MISSING');
requireText(journalPointer, 'AI_READ_POLICY: EVIDENCE_MODE_ONLY', 'MEMORY_GUARD_PHASE4_JOURNAL_READ_POLICY_MISSING');
requireText(journalPointer, 'CURRENT_WORK_AUTHORITY: false', 'MEMORY_GUARD_PHASE4_JOURNAL_AUTHORITY_BOUNDARY_MISSING');
const commanderLedgerPointer = fs.readFileSync(path.join(root, 'docs/recovery/commander/COMMANDER-MASTER-LEDGER.md'), 'utf8');
requireText(commanderLedgerPointer, 'DOCUMENT_CLASS: HISTORICAL_COMPATIBILITY_POINTER', 'MEMORY_GUARD_PHASE4_MASTER_LEDGER_POINTER_CLASS_MISSING');
requireText(commanderLedgerPointer, 'AI_READ_POLICY: EVIDENCE_MODE_ONLY', 'MEMORY_GUARD_PHASE4_MASTER_LEDGER_READ_POLICY_MISSING');
requireText(commanderLedgerPointer, 'CURRENT_WORK_AUTHORITY: false', 'MEMORY_GUARD_PHASE4_MASTER_LEDGER_AUTHORITY_BOUNDARY_MISSING');
requireText(firewall, 'docs/recovery/commander/WORK-ACCEPTANCE-JOURNAL.md', 'MEMORY_GUARD_PHASE4_JOURNAL_NOT_BLOCKED');
requireText(firewall, 'docs/recovery/commander/COMMANDER-MASTER-LEDGER.md', 'MEMORY_GUARD_PHASE4_LEDGER_NOT_BLOCKED');


requireText(firewall, 'commander_historical_pattern_rule:', 'MEMORY_GUARD_COMMANDER_PATTERN_RULE_MISSING');
for (const pattern of [
  'docs/recovery/commander/*HANDOFF*.md',
  'docs/recovery/commander/*TAKEOVER*.md',
  'docs/recovery/commander/*ACCEPTANCE*.md',
  'docs/recovery/commander/*INCIDENT*.md',
  'docs/recovery/commander/*CHECKPOINT*.md',
  'docs/recovery/commander/SESSION-*.md',
  'docs/recovery/commander/T1-*.md',
  'docs/recovery/commander/T2-*.md',
  'docs/recovery/commander/T3-*.md',
  'docs/recovery/commander/TEAM1-*.md',
  'docs/recovery/commander/TEAM2-*.md',
  'docs/recovery/commander/TEAM3-*.md',
]) {
  requireText(firewall, pattern, 'MEMORY_GUARD_COMMANDER_HISTORICAL_PATTERN_MISSING');
}
requireText(firewall, 'filename_pattern_match_does_not_assign_work: true', 'MEMORY_GUARD_COMMANDER_PATTERN_ASSIGNMENT_RULE_MISSING');


requireText(quarantineRegistry, 'phase_5_commander_snapshots:', 'MEMORY_GUARD_PHASE5_COMMANDER_SNAPSHOT_MISSING');
const phase5Start = quarantineRegistry.indexOf('phase_5_commander_snapshots:');
const phase5Block = quarantineRegistry.slice(phase5Start);
requireText(phase5Block, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE5_COMMANDER_NOT_GREEN');
requireText(phase5Block, 'builder_run: 34180381453', 'MEMORY_GUARD_PHASE5_RUN_MISSING');
requireText(phase5Block, 'exact_candidate_sha: 660165d0c25e91b2bad6a8dbdc39d3db1d579f7d', 'MEMORY_GUARD_PHASE5_SHA_MISSING');
requireText(phase5Block, 'quarantined_count: 16', 'MEMORY_GUARD_PHASE5_COMMANDER_COUNT_DECLARATION_MISSING');
const phase5Pointers = [...phase5Block.matchAll(/^    - path:\s*(docs\/recovery\/commander\/.+?)\s*$/gm)].map(m => m[1].trim());
const phase5Bodies = [...phase5Block.matchAll(/^      historical_body:\s*(docs\/recovery\/history\/commander\/snapshots\/.+?)\s*$/gm)].map(m => m[1].trim());
if (phase5Pointers.length !== 16 || phase5Bodies.length !== 16) {
  throw new Error('MEMORY_GUARD_PHASE5_COMMANDER_COUNT_MISMATCH:' + phase5Pointers.length + ':' + phase5Bodies.length);
}
for (let i = 0; i < phase5Pointers.length; i += 1) {
  const pointerPath = phase5Pointers[i];
  const bodyPath = phase5Bodies[i];
  const pointer = path.join(root, pointerPath);
  const body = path.join(root, bodyPath);
  if (!fs.existsSync(pointer)) throw new Error('MEMORY_GUARD_PHASE5_POINTER_MISSING:' + pointerPath);
  if (!fs.existsSync(body)) throw new Error('MEMORY_GUARD_PHASE5_BODY_MISSING:' + bodyPath);
  const pointerText = fs.readFileSync(pointer, 'utf8');
  const bodyText = fs.readFileSync(body, 'utf8');
  requireText(pointerText, 'DOCUMENT_CLASS: HISTORICAL_COMPATIBILITY_POINTER', 'MEMORY_GUARD_PHASE5_POINTER_CLASS_MISSING');
  requireText(pointerText, 'AI_READ_POLICY: EVIDENCE_MODE_ONLY', 'MEMORY_GUARD_PHASE5_POINTER_READ_POLICY_MISSING');
  requireText(pointerText, 'CURRENT_WORK_AUTHORITY: false', 'MEMORY_GUARD_PHASE5_POINTER_AUTHORITY_BOUNDARY_MISSING');
  requireText(bodyText, 'DOCUMENT_CLASS: HISTORICAL_EVIDENCE', 'MEMORY_GUARD_PHASE5_BODY_CLASS_MISSING');
  requireText(firewall, pointerPath, 'MEMORY_GUARD_PHASE5_POINTER_NOT_BLOCKED');
}


requireText(firewall, 'commander_namespace_policy:', 'MEMORY_GUARD_COMMANDER_NAMESPACE_POLICY_MISSING');
requireText(firewall, 'default_class: HISTORICAL_EVIDENCE', 'MEMORY_GUARD_COMMANDER_NAMESPACE_DEFAULT_CLASS_MISSING');
requireText(firewall, 'default_current_mode_read: FORBIDDEN', 'MEMORY_GUARD_COMMANDER_NAMESPACE_DEFAULT_READ_NOT_FORBIDDEN');
requireText(docRegistry, 'docs/recovery/commander/**: HISTORICAL_EVIDENCE', 'MEMORY_GUARD_COMMANDER_DOCREG_DEFAULT_MISSING');

const commanderAllowlist = [
  'docs/recovery/commander/AUXILIARY-ASSET-REGISTRY.yaml',
  'docs/recovery/commander/CAPABILITY-CATALOG.yaml',
  'docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md',
  'docs/recovery/commander/CAPABILITY-IDENTITY-RECONCILIATION-2026-09-08.yaml',
  'docs/recovery/commander/DOCUMENT-AUTHORITY-REGISTRY.yaml',
  'docs/recovery/commander/CAPABILITY-DEEP-AUDIT-2026-09-08.md',
  'docs/recovery/commander/HISTORICAL-CAPABILITY-LINEAGE-2026-09-08.md',
  'docs/recovery/commander/HISTORICAL-REPORT-QUARANTINE-REGISTRY.yaml',
  'docs/recovery/commander/CORE-FAST-AND-FRESH-GATE-2026-09-08.md',
  'docs/recovery/commander/TWO-TEAM-END-TO-END-OPERATIONAL-ROADMAP-2026-09-07.md',
];

const documentRegistryBlock = (filePath) => {
  const marker = '  - path: ' + filePath;
  const start = docRegistry.indexOf(marker);
  if (start < 0) return '';
  const next = docRegistry.indexOf('\n  - path:', start + marker.length);
  const defaults = docRegistry.indexOf('\ndefaults:', start + marker.length);
  const ends = [next, defaults].filter(x => x >= 0);
  const end = ends.length ? Math.min(...ends) : docRegistry.length;
  return docRegistry.slice(start, end);
};

for (const filePath of commanderAllowlist) {
  if (!fs.existsSync(path.join(root, filePath))) {
    throw new Error('MEMORY_GUARD_COMMANDER_ALLOWLIST_FILE_MISSING:' + filePath);
  }
  requireText(firewall, '    - ' + filePath, 'MEMORY_GUARD_COMMANDER_ALLOWLIST_ENTRY_MISSING');
  const blockText = documentRegistryBlock(filePath);
  if (!blockText) throw new Error('MEMORY_GUARD_COMMANDER_ALLOWLIST_DOCREG_ENTRY_MISSING:' + filePath);
  requireText(blockText, 'authority: CURRENT_REFERENCE', 'MEMORY_GUARD_COMMANDER_ALLOWLIST_DOCREG_NOT_CURRENT_REFERENCE');
}

const currentCommanderRefs = [...new Set(cycle.match(/docs\/recovery\/commander\/[A-Za-z0-9._-]+/g) || [])];
for (const filePath of currentCommanderRefs) {
  if (!commanderAllowlist.includes(filePath)) {
    throw new Error('MEMORY_GUARD_CURRENT_CYCLE_COMMANDER_REF_NOT_ALLOWLISTED:' + filePath);
  }
}


requireText(firewall, 'decision_namespace_policy:', 'MEMORY_GUARD_DECISION_NAMESPACE_POLICY_MISSING');
requireText(firewall, 'decision_namespace_policy:\n  default_class: HISTORICAL_EVIDENCE', 'MEMORY_GUARD_DECISION_NAMESPACE_DEFAULT_CLASS_MISSING');
requireText(firewall, 'default_current_mode_read: FORBIDDEN', 'MEMORY_GUARD_DECISION_NAMESPACE_DEFAULT_READ_NOT_FORBIDDEN');
requireText(docRegistry, 'docs/recovery/decisions/**: HISTORICAL_EVIDENCE', 'MEMORY_GUARD_DECISION_DOCREG_DEFAULT_MISSING');

const decisionAllowlist = [
  'docs/recovery/decisions/PRODUCT-FAMILY-AND-OWNED-CHANNEL-REDEFINITION-2026-09-07.md',
  'docs/recovery/decisions/CORE-FIRST-THEN-IMMEDIATE-A11-B11-THEN-INCREMENTAL-DOMAINS-2026-09-08.md',
  'docs/recovery/decisions/TEAM-C-FEATURE-EXPANSION-CHARTER-2026-09-08.md',
  'docs/recovery/decisions/INVENTORY-STATISTICAL-ONLY-NONBLOCKING-AUTHORITY-2026-09-08.md',
  'docs/recovery/decisions/DOMAIN-SPECIFIC-CONSISTENCY-AND-FAST-PATH-CONSTITUTION-2026-09-08.md',
  'docs/recovery/decisions/CANONICAL-ORDER-IDENTITY-CONTRACT-2026-09-05.md',
  'docs/recovery/decisions/FRONTLINE-OFFLINE-OPERATIONAL-BUNDLE-2026-09-07.md',
];

for (const filePath of decisionAllowlist) {
  if (!fs.existsSync(path.join(root, filePath))) {
    throw new Error('MEMORY_GUARD_DECISION_ALLOWLIST_FILE_MISSING:' + filePath);
  }
  requireText(firewall, '    - ' + filePath, 'MEMORY_GUARD_DECISION_ALLOWLIST_FIREWALL_ENTRY_MISSING');
  const marker = '  - path: ' + filePath;
  const start = docRegistry.indexOf(marker);
  if (start < 0) throw new Error('MEMORY_GUARD_DECISION_DOCREG_ENTRY_MISSING:' + filePath);
  const next = docRegistry.indexOf('\n  - path:', start + marker.length);
  const defaults = docRegistry.indexOf('\ndefaults:', start + marker.length);
  const candidates = [next, defaults].filter(x => x >= 0);
  const end = candidates.length ? Math.min(...candidates) : docRegistry.length;
  const entry = docRegistry.slice(start, end);
  requireText(entry, 'authority: CURRENT_REFERENCE', 'MEMORY_GUARD_DECISION_DOCREG_NOT_CURRENT_REFERENCE');
}

const currentDecisionRefSources = [
  cycle,
  catalog,
  read('docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md'),
];
const currentDecisionRefs = new Set();
for (const source of currentDecisionRefSources) {
  for (const match of source.match(/docs\/recovery\/decisions\/[A-Za-z0-9._-]+\.md/g) || []) {
    currentDecisionRefs.add(match);
  }
}
for (const filePath of currentDecisionRefs) {
  if (!decisionAllowlist.includes(filePath)) {
    throw new Error('MEMORY_GUARD_CURRENT_DECISION_REF_NOT_ALLOWLISTED:' + filePath);
  }
}


requireText(quarantineRegistry, 'phase_8_workflow_namespace:', 'MEMORY_GUARD_PHASE8_WORKFLOW_NAMESPACE_MISSING');
requireText(quarantineRegistry, 'status: COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE8_WORKFLOW_NAMESPACE_NOT_GREEN');
requireText(quarantineRegistry, 'work_item_namespace_default: WORKFLOW_LOCAL_NOT_CURRENT', 'MEMORY_GUARD_PHASE8_WORK_ITEM_DEFAULT_MISSING');
requireText(quarantineRegistry, 'plan_namespace_default: WORKFLOW_LOCAL_NOT_CURRENT', 'MEMORY_GUARD_PHASE8_PLAN_DEFAULT_MISSING');

requireText(firewall, 'workflow_namespace_policy:', 'MEMORY_GUARD_WORKFLOW_NAMESPACE_POLICY_MISSING');
requireText(firewall, 'work_item_default_class: WORKFLOW_LOCAL_NOT_CURRENT', 'MEMORY_GUARD_WORK_ITEM_NAMESPACE_DEFAULT_MISSING');
requireText(firewall, 'plan_default_class: WORKFLOW_LOCAL_NOT_CURRENT', 'MEMORY_GUARD_PLAN_NAMESPACE_DEFAULT_MISSING');
requireText(firewall, 'active_or_open_status_alone_authorizes_current_read: false', 'MEMORY_GUARD_WORKFLOW_ACTIVE_FLAG_BYPASS');
requireText(docRegistry, 'docs/workflows/work-items/**: WORKFLOW_LOCAL', 'MEMORY_GUARD_WORK_ITEM_DOCREG_DEFAULT_MISSING');
requireText(docRegistry, 'docs/plans/**: WORKFLOW_LOCAL', 'MEMORY_GUARD_PLAN_DOCREG_DEFAULT_MISSING');

const currentWorkItemRefs = [...new Set(cycle.match(/docs\/workflows\/work-items\/[A-Za-z0-9._-]+\.ya?ml/g) || [])];
if (currentWorkItemRefs.length === 0) {
  throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_POINTERS_EMPTY');
}
for (const filePath of currentWorkItemRefs) {
  const full = path.join(root, filePath);
  if (!fs.existsSync(full)) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_FILE_MISSING:' + filePath);
  const text = fs.readFileSync(full, 'utf8');
  const workId = scalarField(text, 'work_id');
  const capId = scalarField(text, 'capability_id').toUpperCase();
  const capAction = scalarField(text, 'capability_action').toUpperCase();
  const planRef = scalarField(text, 'plan');
  const active = scalarField(text, 'ACTIVE').toLowerCase();
  if (!workId) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_ID_MISSING:' + filePath);
  if (!/^CAP-[A-Z0-9][A-Z0-9-]*$/.test(capId)) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_CAPABILITY_INVALID:' + filePath);
  if (!allowedCapabilityActions.has(capAction)) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_ACTION_INVALID:' + filePath + ':' + capAction);
  if (active !== 'true') throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_NOT_ACTIVE:' + filePath);
  if (!planRef) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_PLAN_MISSING:' + filePath);
  if (!fs.existsSync(path.join(root, planRef))) throw new Error('MEMORY_GUARD_CURRENT_WORK_ITEM_PLAN_NOT_FOUND:' + filePath + ':' + planRef);
}
const requiredCurrentWorkItemRefs = [
  'docs/workflows/work-items/TEAM-A-WI-A9-PRINT-ROUTING-SETTINGS-20260908.yaml',
  'docs/workflows/work-items/TEAM-C-WI-B0115-membership-level.yaml',
];
for (const filePath of requiredCurrentWorkItemRefs) {
  if (!currentWorkItemRefs.includes(filePath)) {
    throw new Error('MEMORY_GUARD_REQUIRED_CURRENT_WORK_ITEM_POINTER_MISSING:' + filePath);
  }
}
const sysBlockStart = cycle.indexOf('  sys_governance:');
if (sysBlockStart < 0) throw new Error('MEMORY_GUARD_SYS_GOVERNANCE_BLOCK_MISSING');
const sysBlockEnd = cycle.indexOf('\nnext_joint_gate:', sysBlockStart);
const sysBlock = cycle.slice(sysBlockStart, sysBlockEnd >= 0 ? sysBlockEnd : cycle.length);
const sysWorkItemMatch = sysBlock.match(/active_work_item_path:\s*([^\n]+)/);
if (!sysWorkItemMatch) throw new Error('MEMORY_GUARD_SYS_ACTIVE_WORK_ITEM_POINTER_MISSING');
const sysWorkItemRef = sysWorkItemMatch[1].trim();
if (!currentWorkItemRefs.includes(sysWorkItemRef)) {
  throw new Error('MEMORY_GUARD_SYS_CURRENT_WORK_ITEM_NOT_DISCOVERED:' + sysWorkItemRef);
}
const teamAWorkItem = fs.readFileSync(path.join(root, 'docs/workflows/work-items/TEAM-A-WI-A9-PRINT-ROUTING-SETTINGS-20260908.yaml'), 'utf8');
requireText(teamAWorkItem, 'code_linkup_status: CLOSED_ADMITTED_NO_REDO', 'MEMORY_GUARD_TEAM_A_LINKUP_REOPENED');
requireText(teamAWorkItem, 'physical_acceptance_status: PENDING_OWNER_REAL_DEVICE', 'MEMORY_GUARD_TEAM_A_PHYSICAL_ACCEPTANCE_STATE_MISSING');
requireText(cycle, 'active_mutation_work_item: NONE_READBACK_HANDSHAKE_GATE_ONLY', 'MEMORY_GUARD_TEAM_B_HANDSHAKE_ONLY_MARKER_MISSING');
requireText(cycle, 'active_mutation_work_item: TEAM-C-WI-B0115-membership-level', 'MEMORY_GUARD_TEAM_C_ACTIVE_WORK_ITEM_MISSING');


requireText(sourceCoverageAudit, 'status: PHASE_10_COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE10_SOURCE_COVERAGE_NOT_GREEN');
requireText(sourceCoverageAudit, 'builder_run: 34184854945', 'MEMORY_GUARD_PHASE10_BUILDER_PROOF_MISSING');
for (const id of [
  'CAP-EVENT-DURABILITY-001',
  'CAP-MERCHANT-STORE-001',
  'CAP-DEVICE-TRUST-001',
  'CAP-SECURITY-CONTEXT-001',
  'CAP-ORDER-INTAKE-001',
  'CAP-CHANNEL-SETTLEMENT-ESTIMATE-001',
]) {
  if (!capabilityIds.has(id)) throw new Error('MEMORY_GUARD_PHASE10_CAPABILITY_NOT_REGISTERED:' + id);
}
for (const p of [
  'packages/event-durability/durable-repositories.ts',
  'packages/merchant-store/merchant-store.ts',
  'packages/session-device-trust/session-device-trust.ts',
  'packages/security-context-gateway/security-context-gateway.ts',
  'packages/store-order-intake/store-order-intake.ts',
  'packages/channel-settlement/d1-third-party-net-estimate-policy.ts',
  'packages/pricing/d1-pricing-authority.ts',
  'packages/reporting-projection/d1-reporting-snapshot.ts',
  'packages/dine-in-service/dine-in-service.ts',
]) {
  if (!fs.existsSync(path.join(root, p))) throw new Error('MEMORY_GUARD_PHASE10_SOURCE_PATH_MISSING:' + p);
}
requireText(catalog, 'packages/pricing/d1-pricing-authority.ts', 'MEMORY_GUARD_PHASE10_PRICING_PATH_UNREGISTERED');
requireText(catalog, 'packages/reporting-projection/d1-reporting-snapshot.ts', 'MEMORY_GUARD_PHASE10_REPORTING_PATH_UNREGISTERED');
requireText(catalog, 'packages/dine-in-service/dine-in-service.ts', 'MEMORY_GUARD_PHASE10_DINEIN_PATH_UNREGISTERED');
requireText(sourceCoverageAudit, 'packages/production-persistence/postgres.ts', 'MEMORY_GUARD_PHASE10_POSTGRES_CLASSIFICATION_MISSING');
requireText(sourceCoverageAudit, 'POSTGRES_PRODUCTION_AUTHORITY_FORMALLY_EXCLUDED', 'MEMORY_GUARD_PHASE10_POSTGRES_EXCLUSION_MISSING');


const packagesRoot = path.join(root, 'packages');
const currentPackageDirs = fs.readdirSync(packagesRoot, {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

const catalogMappedPackages = new Set();
for (const match of catalog.matchAll(/packages\/([^/\s]+)\//g)) {
  catalogMappedPackages.add(match[1]);
}

const explicitMarker = '  explicit_noncapability_packages:';
const explicitStart = sourceCoverageAudit.indexOf(explicitMarker);
if (explicitStart < 0) throw new Error('MEMORY_GUARD_PACKAGE_TOPOLOGY_EXPLICIT_CLASSIFICATION_MISSING');
const explicitTail = sourceCoverageAudit.slice(explicitStart + explicitMarker.length);
const explicitEndMatch = explicitTail.match(/^\s{2}[a-zA-Z0-9_]+:/m);
const explicitBlock = explicitEndMatch ? explicitTail.slice(0, explicitEndMatch.index) : explicitTail;
const explicitNonCapabilityPackages = new Set(
  [...explicitBlock.matchAll(/^\s{4}-\s+([^\s]+)\s*$/gm)].map(m => m[1].trim())
);

const unclassifiedPackages = currentPackageDirs.filter(
  name => !catalogMappedPackages.has(name) && !explicitNonCapabilityPackages.has(name)
);
if (unclassifiedPackages.length > 0) {
  throw new Error('MEMORY_GUARD_PACKAGE_TOPOLOGY_UNCLASSIFIED:' + unclassifiedPackages.join(','));
}

const staleExplicitPackages = [...explicitNonCapabilityPackages].filter(
  name => !currentPackageDirs.includes(name)
);
if (staleExplicitPackages.length > 0) {
  throw new Error('MEMORY_GUARD_PACKAGE_TOPOLOGY_STALE_EXPLICIT_CLASSIFICATION:' + staleExplicitPackages.join(','));
}

requireText(sourceCoverageAudit, 'unclassified_packages: 0', 'MEMORY_GUARD_PACKAGE_TOPOLOGY_BASELINE_NOT_ZERO');
requireText(sourceCoverageAudit, 'rule: EVERY_PACKAGE_DIRECTORY_MUST_BE_CATALOG_MAPPED_OR_EXPLICITLY_CLASSIFIED_NONCAPABILITY', 'MEMORY_GUARD_PACKAGE_TOPOLOGY_RULE_MISSING');


requireText(sourceCoverageAudit, 'phase11_exact_proof:', 'MEMORY_GUARD_PHASE11_PROOF_MISSING');
requireText(sourceCoverageAudit, 'builder_run: 34185108832', 'MEMORY_GUARD_PHASE11_RUN_MISSING');
requireText(sourceCoverageAudit, 'runtime_surface_coverage:', 'MEMORY_GUARD_RUNTIME_SURFACE_COVERAGE_MISSING');
requireText(sourceCoverageAudit, 'status: PHASE_12_COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE12_RUNTIME_SURFACE_NOT_GREEN');
requireText(sourceCoverageAudit, 'builder_run: 34185608047', 'MEMORY_GUARD_PHASE12_RUNTIME_SURFACE_RUN_MISSING');
if (!capabilityIds.has('CAP-SMT-RUNTIME-OTA-001')) {
  throw new Error('MEMORY_GUARD_PHASE12_OTA_CAPABILITY_NOT_REGISTERED');
}
requireText(catalog, 'apps/smt-android/app/src/main/java/com/morefunos/smt/PrintCommandController.java', 'MEMORY_GUARD_PHASE12_NATIVE_PRINT_PATH_MISSING');
requireText(catalog, 'infra/cloudflare/smt-ota-worker/src/index.js', 'MEMORY_GUARD_PHASE12_OTA_WORKER_PATH_MISSING');
requireText(catalog, 'RuntimeBundleVerifier.java', 'MEMORY_GUARD_PHASE12_OTA_VERIFIER_PATH_MISSING');
requireText(catalog, 'RuntimeInstaller.java', 'MEMORY_GUARD_PHASE12_OTA_INSTALLER_PATH_MISSING');

const runtimeCoverageStart = sourceCoverageAudit.indexOf('runtime_surface_coverage:');
const runtimeCoverage = runtimeCoverageStart >= 0 ? sourceCoverageAudit.slice(runtimeCoverageStart) : '';

const appsMarker = '  apps:';
const infraMarker = '  infra_cloudflare:';
const appsStart = runtimeCoverage.indexOf(appsMarker);
const infraStart = runtimeCoverage.indexOf(infraMarker);
if (appsStart < 0 || infraStart < 0 || infraStart <= appsStart) {
  throw new Error('MEMORY_GUARD_RUNTIME_SURFACE_APPS_BLOCK_MISSING');
}
const appsBlock = runtimeCoverage.slice(appsStart, infraStart);
const explicitApps = new Set(
  [...appsBlock.matchAll(/^\s{6}- name:\s*([^\s]+)\s*$/gm)].map(m => m[1].trim())
);
const currentApps = fs.readdirSync(path.join(root, 'apps'), {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const catalogMappedApps = new Set([...catalog.matchAll(/apps\/([^/\s]+)\//g)].map(m => m[1]));
const unclassifiedApps = currentApps.filter(
  name => !catalogMappedApps.has(name) && !explicitApps.has(name)
);
if (unclassifiedApps.length > 0) {
  throw new Error('MEMORY_GUARD_RUNTIME_SURFACE_UNCLASSIFIED_APP:' + unclassifiedApps.join(','));
}
const staleExplicitApps = [...explicitApps].filter(name => !currentApps.includes(name));
if (staleExplicitApps.length > 0) {
  throw new Error('MEMORY_GUARD_RUNTIME_SURFACE_STALE_APP_CLASSIFICATION:' + staleExplicitApps.join(','));
}

const registeredMarker = '  registered_capability:';
const registeredStart = runtimeCoverage.indexOf(registeredMarker);
const infraBlock = runtimeCoverage.slice(
  infraStart,
  registeredStart > infraStart ? registeredStart : runtimeCoverage.length,
);
const explicitInfra = new Set(
  [...infraBlock.matchAll(/^\s{6}- name:\s*([^\s]+)\s*$/gm)].map(m => m[1].trim())
);
const cloudflareRoot = path.join(root, 'infra/cloudflare');
const currentInfra = fs.readdirSync(cloudflareRoot, {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const catalogMappedInfra = new Set([...catalog.matchAll(/infra\/cloudflare\/([^/\s]+)\//g)].map(m => m[1]));
const unclassifiedInfra = currentInfra.filter(
  name => !catalogMappedInfra.has(name) && !explicitInfra.has(name)
);
if (unclassifiedInfra.length > 0) {
  throw new Error('MEMORY_GUARD_RUNTIME_SURFACE_UNCLASSIFIED_CLOUDFLARE:' + unclassifiedInfra.join(','));
}
const staleExplicitInfra = [...explicitInfra].filter(name => !currentInfra.includes(name));
if (staleExplicitInfra.length > 0) {
  throw new Error('MEMORY_GUARD_RUNTIME_SURFACE_STALE_CLOUDFLARE_CLASSIFICATION:' + staleExplicitInfra.join(','));
}
requireText(sourceCoverageAudit, 'rule: EVERY_APP_AND_CLOUDFLARE_RUNTIME_SURFACE_MUST_BE_CATALOG_MAPPED_OR_EXPLICITLY_CLASSIFIED_ADAPTER', 'MEMORY_GUARD_RUNTIME_SURFACE_RULE_MISSING');


requireText(sourceCoverageAudit, 'd1_schema_authority_coverage:', 'MEMORY_GUARD_PHASE13_D1_COVERAGE_MISSING');
requireText(sourceCoverageAudit, 'status: PHASE_13_COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE13_D1_NOT_GREEN');
requireText(sourceCoverageAudit, 'builder_run: 34186509319', 'MEMORY_GUARD_PHASE13_D1_RUN_MISSING');
requireText(sourceCoverageAudit, 'migration_count: 52', 'MEMORY_GUARD_PHASE13_MIGRATION_COUNT_MISMATCH');
requireText(sourceCoverageAudit, 'unclassified_migrations: []', 'MEMORY_GUARD_PHASE13_UNCLASSIFIED_MIGRATIONS');
requireText(sourceCoverageAudit, 'CAP-PRODUCT-COMBO-001', 'MEMORY_GUARD_PHASE13_COMBO_ID_MISSING');
requireText(sourceCoverageAudit, 'CAP-CUSTOMER-AUTH-001', 'MEMORY_GUARD_PHASE13_CUSTOMER_AUTH_ID_MISSING');
requireText(catalog, 'capability_id: CAP-PRODUCT-COMBO-001', 'MEMORY_GUARD_PHASE13_COMBO_CATALOG_MISSING');
requireText(catalog, 'capability_id: CAP-CUSTOMER-AUTH-001', 'MEMORY_GUARD_PHASE13_CUSTOMER_AUTH_CATALOG_MISSING');
requireText(catalog, 'engineering_maturity: CANONICAL_CONTRACT_ADMITTED_CURRENT_D1_ADAPTER_GAP', 'MEMORY_GUARD_PHASE13_CUSTOMER_AUTH_MATURITY_MISCLASSIFIED');

const migrationDir = path.join(root, 'infra/cloudflare/d1/migrations');
const currentMigrations = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
if (currentMigrations.length !== 52) {
  throw new Error('MEMORY_GUARD_PHASE13_CURRENT_MIGRATION_COUNT:' + currentMigrations.length);
}
for (const migration of currentMigrations) {
  if (!sourceCoverageAudit.includes('migration: ' + migration)) {
    throw new Error('MEMORY_GUARD_PHASE13_MIGRATION_UNMAPPED:' + migration);
  }
}


requireText(sourceCoverageAudit, 'auxiliary_asset_surface_coverage:', 'MEMORY_GUARD_PHASE14_AUXILIARY_COVERAGE_MISSING');
requireText(sourceCoverageAudit, 'status: PHASE_14_COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE14_AUXILIARY_NOT_GREEN');
requireText(sourceCoverageAudit, 'builder_run: 34188356204', 'MEMORY_GUARD_PHASE14_BUILDER_RUN_MISSING');
requireText(sourceCoverageAudit, 'ASSET-MF01-MENU-IMPORT-20260905', 'MEMORY_GUARD_PHASE14_MENU_ASSET_MISSING');
requireText(sourceCoverageAudit, 'ASSET-KEETA-WORKER-RUNTIME-001', 'MEMORY_GUARD_PHASE14_KEETA_WORKER_ASSET_MISSING');
requireText(auxiliaryAssetRegistry, 'registry_id: MOREFUNOS-AUXILIARY-ASSET-REGISTRY', 'MEMORY_GUARD_AUXILIARY_REGISTRY_ID_MISSING');
requireText(auxiliaryAssetRegistry, 'important_unclassified_asset_is_governance_failure: true', 'MEMORY_GUARD_AUXILIARY_NO_DRIFT_RULE_MISSING');
requireText(authority, 'AUXILIARY-ASSET-REGISTRY.yaml', 'MEMORY_GUARD_AUTHORITY_ASSET_LOOKUP_MISSING');
requireText(index, 'AUXILIARY-ASSET-REGISTRY.yaml', 'MEMORY_GUARD_AI_INDEX_ASSET_LOOKUP_MISSING');
requireText(start, 'AUXILIARY-ASSET-REGISTRY.yaml', 'MEMORY_GUARD_START_HERE_ASSET_LOOKUP_MISSING');
requireText(catalog, 'workers/keeta/src/index.ts', 'MEMORY_GUARD_KEETA_WORKER_CANONICAL_PATH_MISSING');

const auxiliaryAssetIds = [...auxiliaryAssetRegistry.matchAll(/^  - asset_id:\s*(ASSET-[A-Z0-9-]+)\s*$/gm)].map(m => m[1]);
if (auxiliaryAssetIds.length !== new Set(auxiliaryAssetIds).size) throw new Error('MEMORY_GUARD_DUPLICATE_AUXILIARY_ASSET_ID');
for (const capRef of new Set([...auxiliaryAssetRegistry.matchAll(/CAP-[A-Z0-9-]+/g)].map(m => m[0]))) {
  if (!capabilityIds.has(capRef)) throw new Error('MEMORY_GUARD_AUXILIARY_PARENT_CAPABILITY_MISSING:' + capRef);
}

const auxiliarySurfaceRoots = ['data','scripts','workers'];
for (const surface of auxiliarySurfaceRoots) {
  const surfaceRoot = path.join(root, surface);
  for (const file of walkAllFiles(surfaceRoot)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!auxiliaryAssetRegistry.includes(relative)) {
      throw new Error('MEMORY_GUARD_AUXILIARY_FILE_UNCLASSIFIED:' + relative);
    }
  }
}

requireText(auxiliaryAssetRegistry, 'repository_shell:', 'MEMORY_GUARD_PHASE15_REPOSITORY_SHELL_MISSING');
requireText(auxiliaryAssetRegistry, 'status: PHASE_15_COMPLETE_BUILDER_GREEN', 'MEMORY_GUARD_PHASE15_REPOSITORY_SHELL_NOT_GREEN');
requireText(auxiliaryAssetRegistry, 'builder_run: 34188864145', 'MEMORY_GUARD_PHASE15_BUILDER_RUN_MISSING');
requireText(auxiliaryAssetRegistry, 'ASSET-REPOSITORY-GOVERNANCE-CONTROL-PLANE-001', 'MEMORY_GUARD_PHASE15_GOVERNANCE_ASSET_MISSING');
requireText(auxiliaryAssetRegistry, 'ASSET-AGENT-INSTRUCTION-SURFACE-001', 'MEMORY_GUARD_PHASE15_AGENT_ASSET_MISSING');
requireText(auxiliaryAssetRegistry, 'ASSET-ROOT-BUILD-CONFIG-001', 'MEMORY_GUARD_PHASE15_BUILD_ASSET_MISSING');
requireText(auxiliaryAssetRegistry, 'ASSET-PROJECT-METADATA-001', 'MEMORY_GUARD_PHASE15_METADATA_ASSET_MISSING');

const auxiliaryAssetPaths = new Set(
  [...auxiliaryAssetRegistry.matchAll(/^      -\s+(.+?)\s*$/gm)].map(m => m[1].trim())
);

const rootEntries = fs.readdirSync(root, {withFileTypes:true});
const rootFiles = rootEntries.filter(e => e.isFile()).map(e => e.name);
for (const fileName of rootFiles) {
  if (!auxiliaryAssetPaths.has(fileName)) {
    throw new Error('MEMORY_GUARD_PHASE15_UNCLASSIFIED_ROOT_FILE:' + fileName);
  }
}

const githubRoot = path.join(root, '.github');
const githubFiles = fs.existsSync(githubRoot) ? walkAllFiles(githubRoot).map(f => path.relative(root, f).split(path.sep).join('/')) : [];
for (const filePath of githubFiles) {
  if (!auxiliaryAssetPaths.has(filePath)) {
    throw new Error('MEMORY_GUARD_PHASE15_UNCLASSIFIED_GITHUB_FILE:' + filePath);
  }
}
if (fs.existsSync(path.join(root, '.github/workflows'))) {
  throw new Error('MEMORY_GUARD_V2_NATIVE_WORKFLOWS_REAPPEARED');
}
if (rootFiles.length !== 28) {
  throw new Error('MEMORY_GUARD_PHASE15_ROOT_FILE_COUNT_DRIFT:' + rootFiles.length);
}
if (githubFiles.length !== 2) {
  throw new Error('MEMORY_GUARD_PHASE15_GITHUB_FILE_COUNT_DRIFT:' + githubFiles.length);
}


requireText(firewall, 'docs_namespace_policy:', 'MEMORY_GUARD_PHASE16_DOCS_NAMESPACE_POLICY_MISSING');
requireText(firewall, 'current_structural_namespaces:', 'MEMORY_GUARD_PHASE16_CURRENT_STRUCTURAL_POLICY_MISSING');
requireText(firewall, 'workflow_local_namespaces:', 'MEMORY_GUARD_PHASE16_WORKFLOW_LOCAL_POLICY_MISSING');
requireText(firewall, 'evidence_only_namespaces:', 'MEMORY_GUARD_PHASE16_EVIDENCE_POLICY_MISSING');
requireText(firewall, 'mixed_exact_reference_required:', 'MEMORY_GUARD_PHASE16_MIXED_POLICY_MISSING');

requireText(docsGovernance, 'AI_IMPLEMENTATION_AUTHORITY: false', 'MEMORY_GUARD_PHASE16_DOCS_GOVERNANCE_AUTHORITY_STALE');
requireText(docsGovernance, 'docs/recovery/START-HERE.md', 'MEMORY_GUARD_PHASE16_DOCS_GOVERNANCE_GATEWAY_MISSING');
requireText(docsGovernance, 'CURRENT-CYCLE -> Capability Catalog', 'MEMORY_GUARD_PHASE16_DOCS_GOVERNANCE_CAPABILITY_FLOW_MISSING');

requireText(docsRooms, 'AI_IMPLEMENTATION_AUTHORITY: false', 'MEMORY_GUARD_PHASE16_ROOMS_AUTHORITY_STALE');
requireText(docsRooms, 'Memory Gateway -> CURRENT-CYCLE -> Capability Catalog', 'MEMORY_GUARD_PHASE16_ROOMS_CAPABILITY_FLOW_MISSING');
requireText(docsRooms, 'Room 係正式 workflow 嘅局部工作空間', 'MEMORY_GUARD_PHASE16_ROOMS_BOUNDARY_MISSING');

requireText(constitutionReadme, 'Repository 開工永遠先走 Memory Gateway', 'MEMORY_GUARD_PHASE16_CONSTITUTION_GATEWAY_MISSING');
requireText(constitutionReadme, '今日派工只由 CURRENT-CYCLE 決定', 'MEMORY_GUARD_PHASE16_CONSTITUTION_ASSIGNMENT_BOUNDARY_MISSING');

const governanceDocBlock = documentRegistryBlock('docs/GOVERNANCE.md');
const roomsDocBlock = documentRegistryBlock('docs/ROOMS.md');
const constitutionDocBlock = documentRegistryBlock('docs/constitution/README.md');
for (const [name, blockText] of [
  ['docs/GOVERNANCE.md', governanceDocBlock],
  ['docs/ROOMS.md', roomsDocBlock],
  ['docs/constitution/README.md', constitutionDocBlock],
]) {
  if (!blockText) throw new Error('MEMORY_GUARD_PHASE16_DOCREG_ENTRY_MISSING:' + name);
  requireText(blockText, 'authority: CURRENT_REFERENCE', 'MEMORY_GUARD_PHASE16_DOCREG_NOT_CURRENT_REFERENCE');
}

console.log('MoreFunOS V2 Memory Guard: PASS');
