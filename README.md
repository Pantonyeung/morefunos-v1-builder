# MoreFunOS V1 Builder

Public **verification / build / release execution relay only** for the private MoreFunOS V1 authority repository.

## Authority boundary
- `Pantonyeung/morefunos-v1` = sole Source / Runtime / Business / UI / Native / Product / Development Authority.
- `Pantonyeung/morefunos-v1-builder` = sole current CI / Workflow / Build / Verify / Release executor under Owner Decision D-105.
- Builder never becomes Product or Business authority and must never contain private MoreFun source, menu/pricing/order/payment/fulfillment truth, production UI source, private fixtures, signing keys or a parallel runtime.

## Why Builder is mandatory
`morefunos-v1` GitHub Actions budget is exhausted. Current MoreFunOS development does **not** use or probe V1 Actions.

Canonical execution chain:
`V1 exact source SHA -> Builder workflow_dispatch -> exact private checkout -> HEAD identity proof -> V1-owned commands -> Builder run/log/artifact evidence`.

If Builder execution is unavailable, the Gate remains pending/blocked. Do not fall back to V1 Actions and do not reinterpret missing execution as Product PASS or Product FAIL.

Canonical private policy:
- `docs/authority/OWNER_DIRECTIVE_2026-08-23_D105_BUILDER_ONLY_EXECUTION_AUTHORITY.md`
- `docs/authority/VERIFICATION_EXECUTION_AUTHORITY.md`
- `docs/authority/BUILDER_TOKEN_AND_SECRET_SETUP.md`

## Trigger policy
Builder execution is Owner/manual `workflow_dispatch` only unless the Owner explicitly changes this later.

Automatic `push`, `pull_request`, `issue_comment`, `schedule`, `workflow_run` and `repository_dispatch` execution are not the canonical verification path.

## Security model
- exact 40-character private V1 source SHA required;
- private checkout uses `V1_SOURCE_READ_TOKEN` restricted to `Pantonyeung/morefunos-v1` with Contents read-only;
- actual checkout SHA must equal requested SHA before evidence is accepted;
- normal verification is read-only toward V1 source;
- release/delivery/signing credentials are separate from source-read credentials;
- public logs contain sanitized identity/result metadata only;
- Builder source must not mutate private V1 source except through separately Owner-approved bounded release/writeback procedures.

## V2 Core verification
Workflow:
`.github/workflows/verify-v2-core-bootstrap.yml`

Manual input:
- `source_sha`: exact 40-character `morefunos-v1` verification SHA.

Execution:
1. validate exact SHA;
2. checkout exact private V1 source;
3. prove checked-out HEAD identity;
4. run `npm run test:v2-core`;
5. run `npm run typecheck:v2-core`;
6. run `npm run test:current`;
7. record Builder repository/SHA/run ID + V1 source SHA + outcomes;
8. upload evidence artifact;
9. fail the workflow if any required command fails.

## Evidence boundary
Builder PASS can establish only the evidence rung actually executed for the exact V1 SHA. It does not automatically establish Runtime / Install / Device / Hardware / Operational / Production / Owner acceptance.

## Native / OTA
The accepted Android Carrier remains governed by D-090 and is not rebuilt for ordinary UI/Business Runtime changes.
Approved Runtime `.mfos` verification/release/OTA publication workflows also execute from Builder while Product/Runtime authority remains in V1.


## V2 Builder Admission Queue

Workflow:
`.github/workflows/v2-builder-admission-queue.yml`

Purpose:
reduce repeated replay/rebase and full reruns when multiple Morefun-v2 teams work in parallel.

The queue does not mutate Morefun-v2.
It checks out:
- current Morefun-v2 main;
- one frozen candidate SHA;
- the candidate base main SHA.

Then it:
1. compares candidate delta vs main delta;
2. classifies collision C0-C4;
3. classifies verification impact V0-V4;
4. builds a temporary latest-main integration working tree;
5. uses exact-file overlay for disjoint candidates;
6. uses three-way apply only when same files actually overlap;
7. runs integration checks appropriate to the declared affected ports;
8. seals durable evidence under `.ci-results/admission-queue/`.

Request submission:
- canonical: one immutable file per candidate under `requests/v2-admission-queue/<work-id>__<candidate-prefix>.txt`;
- legacy shared file `requests/v2-admission-queue-request.txt` is compatibility-only and must not be used for concurrent work.

Each push should add exactly one immutable request file. This prevents Team A / Team B from overwriting each other's queue manifest.

Fields for every new request:
- `candidate_sha`
- `base_main_sha`
- `work_id`
- `capability_id` — stable ID from MoreFunOS `CAPABILITY-CATALOG.yaml`
- `capability_action` — `REUSE | LINKUP | EXTEND | REGRESSION_REPAIR | PHYSICAL_ACCEPTANCE | NEW_BUILD | SUPERSEDE`
- `affected_ports`

The queue fails closed when capability identity/action is missing or invalid. `NEW_BUILD` cannot be used to recreate an already active `no_redo` capability.

Queue / Work Item / Plan capability identity must match exactly. Every new request `work_id` must resolve to exactly one V2 Work Item, and its referenced Plan must carry the same `capability_id` and `capability_action`.

The candidate SHA is immutable after CANDIDATE_READY.

Important:
- Candidate Proof still belongs to the existing dedicated Builder workflows.
- Admission Queue Proof answers a different question: whether the frozen candidate still integrates with current main.
- A moving main alone must not force the author to replay a candidate.
- C0/V1 disjoint work should integrate without author rebase.
- Morefun-v2 native Actions/CI/Workflow remain forbidden.


### Concurrent request proof — 2026-09-07

The queue was hardened from one shared request file to one immutable file per candidate.

Proof:
- Team A real candidate run 34077480242: SUCCESS.
  - candidate 8f6bb7de4556d13ec999243079268d950fccd998
  - base 472fe0c227079082db682d8dc9fea5ca601c4c85
  - latest main bd394af0cc2359e7001ba17083f4d90ac1986e00
  - collision C0
  - impact V1
  - apply DISJOINT_OVERLAY
  - SMT/SMM/Admin integration proof passed.
- Independent no-op request run 34077482839: SUCCESS after being queued behind the first run.
  - collision C0
  - impact V0
  - no product rerun.

This proves concurrent submissions are preserved instead of overwriting one shared request file.
