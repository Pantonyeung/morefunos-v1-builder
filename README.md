# MoreFunOS V1 Builder

Public **verification/build/release execution relay only** for the private MoreFunOS V1 authority repository.

## Authority boundary

- `Pantonyeung/morefunos-v1` (private) is the **sole** Source / Runtime / Business / UI / Native / Product / Development Authority.
- `Pantonyeung/morefunos-v1-builder` (public) is an execution plane only.
- This repository must never contain MoreFun business source, menu/pricing/order/payment/fulfillment truth, production UI source, private fixtures, signing keys, secrets or a parallel runtime.

## Why this repository exists

MoreFunOS uses two equivalent verification execution planes:

1. **Private V1 Actions** when private Actions budget/minutes are available.
2. **This public Builder** when private Actions is blocked by budget/minutes/billing/quota.

The executor may change; the verification standard does not. Every accepted result must bind to an exact immutable V1 source SHA and V1-owned verification/build commands.

Canonical policy lives in the private source repository:
- `docs/authority/VERIFICATION_EXECUTION_AUTHORITY.md`
- `docs/authority/BUILDER_TOKEN_AND_SECRET_SETUP.md`

## Security model

- Owner/manual `workflow_dispatch` only.
- Exact 40-character private source SHA required and normalized before checkout/use.
- Private source checkout uses `V1_SOURCE_READ_TOKEN` restricted to `Pantonyeung/morefunos-v1` with **Contents: read-only**.
- Normal verification remains read-only toward private V1 and has no release/delivery/signing credential.
- Android Release delivery uses separate `V1_ARTIFACT_DELIVERY_TOKEN` plus separate stable-signing secrets.
- Public logs contain only sanitized stage/result/identity information.
- APKs are never uploaded to this public Builder's Actions artifacts or Releases.
- Approved Android APK delivery goes directly to a **private `Pantonyeung/morefunos-v1` prerelease** together with `build-metadata.json` and `SHA256SUMS`.
- Builder source is not allowed to modify the private V1 source branch.

## Manual workflows

### `Owner Manual V1 Verify`
`.github/workflows/manual-verify.yml`

Read-only verification profiles:
- `g4`
- `g5`
- `current`
- `smt-lock`
- `smt-lock-audit`
- `smt-web`
- `android`

The `android` profile verifies G6 static/typecheck, locked SMT Web build, Android SDK readiness, strict Lint, `assembleDebug`, and sanitized APK identity. It does **not** deliver/sign a release APK.

### `Owner Manual V1 Android Release`
`.github/workflows/manual-android-release.yml`

Purpose after APK Build PASS:
1. checkout exact private V1 SHA;
2. rerun G6 static/typecheck/Web build/Lint/assemble gates;
3. stable-sign the APK with the locked MoreFunOS SMT app-signing certificate;
4. verify signer certificate SHA-256;
5. verify package/versionCode continuity;
6. generate immutable build metadata and `SHA256SUMS`;
7. create a prerelease directly in private `morefunos-v1` with the APK attached.

This workflow is artifact delivery evidence only. A successful Release does not imply Install, Device, Hardware, Operational or Production PASS.

## Current budget policy

When private Actions is known blocked, do not repeatedly probe it. Use this Builder. At the next expected billing-cycle reset or explicit budget increase, one lightweight private verification probe may be attempted. If it executes, private Actions becomes preferred again; when its budget is exhausted, switch back here.
