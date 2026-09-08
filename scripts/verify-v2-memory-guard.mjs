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

const workItemRoot = path.join(root, 'docs/workflows/work-items');
const workItemMatches = [];
for (const file of walkFiles(workItemRoot)) {
  const text = fs.readFileSync(file, 'utf8');
  const workMatch = text.match(/^work_id:\s*(.+?)\s*$/m);
  if (workMatch && workMatch[1].replace(/^["']|["']$/g,'') === requestedWorkId) {
    workItemMatches.push({file, text});
  }
}
if (workItemMatches.length === 0) throw new Error('MEMORY_GUARD_WORK_ITEM_NOT_FOUND:' + requestedWorkId);
if (workItemMatches.length !== 1) throw new Error('MEMORY_GUARD_WORK_ITEM_NOT_UNIQUE:' + requestedWorkId + ':' + workItemMatches.length);

const workItem = workItemMatches[0];
const field = (text, key) => {
  const m = text.match(new RegExp('^' + key + ':\\s*(.+?)\\s*
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_ID_INVALID:' + requestedCapabilityId);
}
const allowedCapabilityActions = new Set(['REUSE','LINKUP','EXTEND','REGRESSION_REPAIR','PHYSICAL_ACCEPTANCE','NEW_BUILD','SUPERSEDE']);
if (!allowedCapabilityActions.has(requestedCapabilityAction)) {
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_ACTION_INVALID:' + requestedCapabilityAction);
}
if (!capabilityIds.has(requestedCapabilityId)) {
  throw new Error('MEMORY_GUARD_REQUEST_CAPABILITY_NOT_IN_CATALOG:' + requestedCapabilityId);
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

console.log('MoreFunOS V2 Memory Guard: PASS');
, 'm'));
  return m ? m[1].replace(/^["']|["']$/g,'').trim() : '';
};
const wiCapabilityId = field(workItem.text, 'capability_id').toUpperCase();
const wiCapabilityAction = field(workItem.text, 'capability_action').toUpperCase();
if (wiCapabilityId !== requestedCapabilityId) {
  throw new Error('MEMORY_GUARD_WORK_ITEM_CAPABILITY_ID_MISMATCH:' + requestedWorkId + ':' + wiCapabilityId + ':' + requestedCapabilityId);
}
if (wiCapabilityAction !== requestedCapabilityAction) {
  throw new Error('MEMORY_GUARD_WORK_ITEM_CAPABILITY_ACTION_MISMATCH:' + requestedWorkId + ':' + wiCapabilityAction + ':' + requestedCapabilityAction);
}

const planRef = field(workItem.text, 'plan');
if (!planRef) throw new Error('MEMORY_GUARD_WORK_ITEM_PLAN_MISSING:' + requestedWorkId);
const planFile = path.join(root, planRef);
if (!fs.existsSync(planFile)) throw new Error('MEMORY_GUARD_WORK_ITEM_PLAN_NOT_FOUND:' + requestedWorkId + ':' + planRef);
const planText = fs.readFileSync(planFile, 'utf8');
const planCapabilityId = field(planText, 'capability_id').toUpperCase();
const planCapabilityAction = field(planText, 'capability_action').toUpperCase();
if (planCapabilityId !== requestedCapabilityId) {
  throw new Error('MEMORY_GUARD_PLAN_CAPABILITY_ID_MISMATCH:' + requestedWorkId + ':' + planCapabilityId + ':' + requestedCapabilityId);
}
if (planCapabilityAction !== requestedCapabilityAction) {
  throw new Error('MEMORY_GUARD_PLAN_CAPABILITY_ACTION_MISMATCH:' + requestedWorkId + ':' + planCapabilityAction + ':' + requestedCapabilityAction);
}

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

console.log('MoreFunOS V2 Memory Guard: PASS');
