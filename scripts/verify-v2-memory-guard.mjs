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

console.log('MoreFunOS V2 Memory Guard: PASS');
