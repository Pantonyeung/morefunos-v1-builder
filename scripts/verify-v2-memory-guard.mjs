import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'candidate');

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

const requireText = (text, needle, code) => {
  if (!text.includes(needle)) throw new Error(`${code}:${needle}`);
};

requireText(authority, 'Read Firewall', 'MEMORY_GUARD_AUTHORITY_FIREWALL_MISSING');
requireText(authority, 'Capability-first hard rule', 'MEMORY_GUARD_CAPABILITY_FIRST_MISSING');

requireText(index, 'docs/recovery/READ-FIREWALL.yaml', 'MEMORY_GUARD_AI_INDEX_FIREWALL_MISSING');
requireText(index, 'historical_reports_cross_read_for_current_truth: FORBIDDEN', 'MEMORY_GUARD_CROSS_REPORT_DENY_MISSING');
requireText(index, 'evidence_mode_requires_capability_id: true', 'MEMORY_GUARD_EVIDENCE_MODE_ID_MISSING');

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
requireText(governance, 'room_current_handoff_as_default_current_truth: FORBIDDEN', 'MEMORY_GUARD_ROOM_BYPASS_PRESENT');
requireText(workPolicy, 'resolve_capability_id_in_catalog', 'MEMORY_GUARD_WORK_CAPABILITY_RESOLUTION_MISSING');
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

console.log('MoreFunOS V2 Memory Guard: PASS');
