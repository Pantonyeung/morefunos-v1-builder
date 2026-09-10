# V2 Scope-Aware Admission Requests

Use this queue for current Morefun-v2 bounded verification where Guard failures must not erase relevant engineering evidence.

One immutable `.txt` request per candidate.

Required fields:

```text
candidate_sha=<40-char Morefun-v2 SHA>
base_main_sha=<40-char base SHA>
work_id=<exact Work ID>
capability_id=<exact CAP-* ID>
capability_action=<REUSE|LINKUP|EXTEND|REGRESSION_REPAIR|PHYSICAL_ACCEPTANCE|RUNTIME_PROOF|NEW_BUILD|SUPERSEDE>
affected_ports=<comma-separated SMT,SMM,ADMIN,OWNER,CUSTOMER,CORE>
required_core_tests=<comma-separated PRINT,DIAGNOSTICS,ORDER,PAYMENT,PRICING,AVAILABILITY,BUSINESS_DAY,CATALOG>
```

Current PRINT ROUND rule:
- TEAM1 forward candidate: normally `affected_ports=CORE,SMT`, `required_core_tests=PRINT`.
- TEAM2 reverse evidence candidate: use only actual affected ports; normally include `PRINT` and `DIAGNOSTICS` only when those exact packages are touched.

The workflow runs Guard as an admission signal but continues relevant engineering proof whenever technically possible. Final output distinguishes governance, install, typecheck, print, diagnostics and SMT blockers.

Do not use Morefun-v2 native Actions/CI/Workflow.
