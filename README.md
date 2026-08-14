# MoreFunOS V1 Builder

Public **verification/build relay only** for the private MoreFunOS V1 authority repository.

## Authority boundary

- `Pantonyeung/morefunos-v1` (private) is the **sole** Source / Runtime / Business / UI / Native / Product / Development Authority.
- `Pantonyeung/morefunos-v1-builder` (public) is an execution plane only.
- This repository must never contain MoreFun business source, menu/pricing/order/payment/fulfillment truth, production UI source, private fixtures, secrets or a parallel runtime.

## Why this repository exists

MoreFunOS uses two equivalent verification execution planes:

1. **Private V1 Actions** when private Actions budget/minutes are available.
2. **This public Builder** when private Actions is blocked by budget/minutes/billing/quota.

The executor may change; the verification standard does not. Every accepted result must bind to an exact immutable V1 source SHA and an allowlisted V1-owned command profile.

Canonical policy lives in the private source repository:
- `docs/authority/VERIFICATION_EXECUTION_AUTHORITY.md`
- `docs/authority/BUILDER_TOKEN_AND_SECRET_SETUP.md`

## Security model

- Owner/manual `workflow_dispatch` only.
- Exact 40-character private source SHA required.
- Private source checkout uses `V1_SOURCE_READ_TOKEN` with repository access restricted to `Pantonyeung/morefunos-v1` and **Contents: read-only**.
- Public logs contain only sanitized stage/result information.
- Private diagnostics/artifacts, when enabled, use separately scoped credentials and are delivered only to the private source repository.
- Builder source is not allowed to modify the private V1 source branch.

## Current verification profiles

- `g4` — current G4 Runtime targeted tests + current regression + strict G4 typecheck.
- `current` — current regression + current strict typecheck.
- `smt-web` — reserved for G5; fails closed until the private SMT Web app has a committed lockfile.
- `android` — reserved for G6; fails closed until the private V1 Native/APK build contract is explicitly landed.

## Current budget policy

When private Actions is known blocked, do not repeatedly probe it. Use this Builder. At the next expected billing-cycle reset or explicit budget increase, one lightweight private verification probe may be attempted. If it executes, private Actions becomes preferred again; when its budget is exhausted, switch back here.
