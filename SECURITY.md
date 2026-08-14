# Security Policy｜MoreFunOS V1 Builder

This repository is public. Treat every workflow log and committed file here as public information.

## Never commit or print
- private `morefunos-v1` source contents;
- menu/pricing/order/payment/customer/business data;
- private test fixtures or raw private build logs;
- PATs, Actions secrets, signing keys, passwords or environment secret values;
- production Firebase/Cloudflare/vendor credentials.

## Allowed public evidence
- exact source commit SHA;
- verification profile name;
- sanitized stage PASS/FAIL;
- Node/npm/TypeScript/Java/Gradle version identities;
- Builder commit SHA and run ID;
- safe test-count summaries;
- artifact SHA-256 and non-secret build metadata after a later approved artifact profile exists.

## Current G4 secret boundary
Only one cross-repository credential is required now:

`V1_SOURCE_READ_TOKEN`
- fine-grained PAT;
- repository access: only `Pantonyeung/morefunos-v1`;
- Contents: read-only;
- no write/admin/actions/workflows permission.

The current G4/current workflow has **no private write-back path**. On failure it reveals only the failed stage. Raw private logs are neither published nor written back.

## Future credentials
If a later Gate proves a need for private diagnostics or artifact delivery, use a separately scoped credential. Never upgrade/reuse `V1_SOURCE_READ_TOKEN`.

`V1_DIAGNOSTICS_WRITE_TOKEN`
- optional future only;
- prefer private Issues transport with Issues write and no source Contents write.

`V1_ARTIFACT_DELIVERY_TOKEN`
- reserved for later approved G6 artifact/release delivery;
- repository access restricted to `Pantonyeung/morefunos-v1`;
- minimum permission required by the approved transport;
- must remain separate from source-read credentials.

## Workflow policy
- manual `workflow_dispatch` only;
- Owner actor guard;
- exact immutable source SHA;
- no automatic push/PR/schedule/repository-dispatch execution;
- no source mutation;
- private command output redirected away from public logs;
- failures reported publicly by stage only;
- private V1 source must never be committed/copied into this public repository.
