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
- test counts only when they do not reveal private fixture/source content;
- artifact SHA-256 and non-secret build metadata.

## Secret separation
`V1_SOURCE_READ_TOKEN`
- fine-grained PAT;
- repository access: only `Pantonyeung/morefunos-v1`;
- Contents: read-only;
- no write/admin/actions/workflows permission.

Optional private delivery credentials are separate secrets and must never reuse the source-read token.

`V1_DIAGNOSTICS_WRITE_TOKEN`
- only for delivering private failure diagnostics to the private V1 repository;
- repository access: only `Pantonyeung/morefunos-v1`;
- Contents: read/write;
- no Administration/Actions/Workflows permission.

`V1_ARTIFACT_DELIVERY_TOKEN`
- reserved for later approved G6 artifact/release delivery;
- repository access: only `Pantonyeung/morefunos-v1`;
- minimum permission required by the approved release-delivery method;
- keep separate from diagnostics and source-read credentials.

## Workflow policy
- manual `workflow_dispatch` only;
- Owner actor guard;
- exact immutable source SHA;
- no automatic push/PR/schedule/repository-dispatch execution;
- no source mutation;
- private command output redirected away from public logs;
- failures are reported publicly by stage only, with full diagnostics delivered privately only when a dedicated private-delivery secret is configured.
