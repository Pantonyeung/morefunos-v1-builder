# V2 Builder Guard Spec — Scope-Aware Admission

STATUS: ACTIVE
OWNER_DIRECTIVE_DATE: 2026-09-10
EXECUTOR: Pantonyeung/morefunos-v1-builder
PRODUCT_AUTHORITY: Pantonyeung/Morefun-v2

## Purpose

Builder Guard is a verification safety mechanism. It is not Product Authority, Business Authority, Work Assignment Authority, Memory storage, or a second governance engine.

Its job is to prevent an unsafe/unidentifiable candidate from being admitted while allowing useful engineering evidence to continue running.

## Allowed hard blocks

The Guard may hard-block final admission for:
- invalid candidate/base SHA identity;
- unknown/mismatched Work ID, Capability ID, Capability Action;
- missing exact bounded Accepted Plan where required;
- unauthorized NEW_BUILD / SUPERSEDE;
- proven authority collision or destructive/global mutation outside scope;
- second canonical authority / second engine;
- missing required proof for the changed scope.

## Forbidden behavior

The Guard must never:
- block a local Print/Order/etc runtime proof because an unrelated historical/current document drifts;
- turn old Team reports, historical TODOs or archive metadata into current work authority;
- stop all relevant compile/test/proof collection merely because governance failed;
- emit only a generic `Memory Guard failed` message;
- make product code depend on evidence/diagnostics;
- require product-runtime changes to satisfy a documentation-only inconsistency.

## Three stages

### G0 ENTRY
Runs for every candidate. Minimal inputs only:
- candidate_sha
- base_main_sha
- work_id
- capability_id
- capability_action
- exact Work Item / bounded Accepted Plan

ENTRY failure blocks admission but must emit structured failure fields.

### G1 SCOPE
Runs for every candidate against only the changed capability / affected paths / requested ports.

Examples:
- Print change -> Print capability + relevant CORE/SMT contracts/tests.
- Owner presentation change -> Owner/UI scope only.
- D1 migration -> D1/global-impact rules.

No unrelated cross-document sweep.

### G2 GLOBAL
Hard-blocking global audit only when the candidate truly changes global governance/authority/identity/schema, or action is NEW_BUILD/SUPERSEDE.

Ordinary LINKUP / REGRESSION_REPAIR / RUNTIME_PROOF must not be treated as global work by default.

## Execution order

Required Builder order:

1. Resolve request identity.
2. Checkout exact candidate and current main.
3. Run Guard and capture structured result.
4. Classify changed scope.
5. Continue relevant typecheck/tests/integration/runtime proof even if Guard failed, whenever technically possible.
6. Upload all evidence.
7. Make final Admission Decision.

A governance failure may produce:
`ADMISSION=BLOCKED_BY_GOVERNANCE`
while engineering evidence can still say:
`TYPECHECK=PASS`, `PRINT_TEST=PASS`, `SMT_BUILD=PASS`.

## Structured failure contract

Every failure must print:

GUARD_RESULT=FAIL
GUARD_STAGE=ENTRY|SCOPE|GLOBAL
ERROR_CODE=<stable code>
WORK_ID=<id>
CAPABILITY_ID=<id>
FILE=<exact path or request>
EXPECTED=<expected>
ACTUAL=<actual>
REMEDIATION=<one bounded correction>

No team should need a separate round merely to retrieve the real Guard error.

## Evidence vs authority

- Guard output = admission evidence.
- Builder logs/artifacts = verification evidence.
- Neither becomes Product/Business truth.
- Morefun-v2 D1/Core/canonical source remain their existing authorities.

## Document responsibility

`Morefun-v2/AUTHORITY.md` -> source and authority rules.
`Morefun-v2/docs/recovery/START-HERE.md` -> worker entry/routing.
`Morefun-v2/docs/governance/SYS-SPEC-0003-worker-context-document-governance.md` -> worker/document responsibility and context rules.
`Morefun-v2/CURRENT-CYCLE.yaml` -> current operational governance.
`Morefun-v2/CAPABILITY-CATALOG.yaml` -> capability identity/path truth.
This file -> Builder Guard behavior only.

## Success criteria

The Guard is healthy only when:
- it catches actual unsafe scope/identity problems;
- unrelated docs cannot stop a local engineering proof;
- one failure points directly to exact file/expected/actual/remediation;
- relevant evidence is retained even on governance failure;
- Guard maintenance cost is lower than the engineering time it saves.
