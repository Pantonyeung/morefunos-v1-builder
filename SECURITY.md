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
- verification/release workflow identity;
- sanitized stage PASS/FAIL;
- Node/npm/TypeScript/Java/Gradle version identities;
- Builder commit SHA and run ID;
- safe test-count summaries;
- APK SHA-256, byte size, version/package identity and signing certificate SHA-256;
- private V1 Release tag name after successful delivery.

## Credential separation

### `V1_SOURCE_READ_TOKEN`
- fine-grained PAT;
- repository access: only `Pantonyeung/morefunos-v1`;
- Contents: read-only;
- no write/admin/actions/workflows permission;
- used only for exact immutable private source checkout.

### `V1_ARTIFACT_DELIVERY_TOKEN`
- separate fine-grained PAT;
- repository access: only `Pantonyeung/morefunos-v1`;
- Contents: read and write, the minimum GitHub permission used for private Release creation/assets;
- used only by `Owner Manual V1 Android Release` after build + signing PASS;
- never used for source checkout and never persisted as Git credentials;
- must not be reused as diagnostics/source-mutation credential.

### Stable Android signing secrets
These are separate from both PATs:
- `V1_ANDROID_KEYSTORE_B64`
- `V1_ANDROID_KEYSTORE_PASSWORD`
- `V1_ANDROID_KEY_ALIAS`
- `V1_ANDROID_KEY_PASSWORD`

Rules:
- secret values are never committed, echoed or included in metadata;
- keystore is materialized only under `$RUNNER_TEMP`;
- temporary keystore is removed in an `always()` cleanup step;
- signing output must verify exactly one signer;
- signer certificate SHA-256 must equal the locked MoreFunOS SMT certificate identity before Release delivery proceeds.

### Optional diagnostics credential
`V1_DIAGNOSTICS_WRITE_TOKEN` remains a separate optional future concern. Do not reuse source-read, signing or artifact-delivery credentials for diagnostics.

## APK delivery boundary
- Public Builder Actions artifacts for APKs are forbidden.
- Public Builder Releases for APKs are forbidden.
- Successful Android delivery must go directly to a private `Pantonyeung/morefunos-v1` prerelease.
- Release assets are limited to the signed APK, `build-metadata.json` and `SHA256SUMS`.
- Release target is the normalized exact V1 source SHA.
- Delivery is Build/Artifact evidence only; never relabel as Install/Device/Hardware/Operational/Production PASS.

## Workflow policy
- manual `workflow_dispatch` only;
- Owner actor guard;
- exact immutable source SHA;
- no automatic push/PR/schedule/workflow-run/repository-dispatch execution;
- default Builder `GITHUB_TOKEN` remains `contents: read`;
- no source mutation;
- private command output redirected away from public logs;
- failures reported publicly by stage only;
- private V1 source must never be committed/copied into this public repository;
- normal `manual-verify.yml` must never reference signing secrets, `V1_ARTIFACT_DELIVERY_TOKEN` or `gh release create`;
- release workflow must never reuse `V1_SOURCE_READ_TOKEN` as `GH_TOKEN`.
