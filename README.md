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
