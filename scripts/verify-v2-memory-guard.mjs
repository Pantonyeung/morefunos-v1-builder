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
  'docs/recovery/commander/CAPABILITY-MASTER-REGISTRY.md',
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
requireText(phase5Block, 'status: COMPLETE_AWAITING_EXACT_BUILDER_PROOF', 'MEMORY_GUARD_PHASE5_COMMANDER_NOT_READY');
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

console.log('MoreFunOS V2 Memory Guard: PASS');
