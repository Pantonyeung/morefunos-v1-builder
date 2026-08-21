# Legacy ABC Verification Archive｜2026-08-21

Status: **ARCHIVED / REFERENCE ONLY / NOT CURRENT AUTHORITY**

## Why this was archived

MoreFunOS V1 previously used separate A / B / C development lanes. The verification system mirrored that organization with A, B, C, ABC integration, G5, G6, B3 and Mother-specific gates. That topology was useful while separate lanes owned different responsibilities, but it became counterproductive after the product converged on one canonical Runtime, one SMT implementation stream and one Owner product authority.

The legacy system mixed three different concerns:
- durable Business/Runtime invariants;
- real functional regression tests;
- historical implementation-shape/static tests tied to old component locations and lane names.

From 2026-08-21 the current verification authority is:
- `/verify-v1 <exact-sha>` — current Business/Runtime contracts, UI authority boundary, SMT functional regression, TypeScript and Web production build.
- `/verify-carrier <exact-sha>` — explicit Android/Native/OTA Carrier/Hardware verification only when that boundary changes.

Runtime release, Android release, runtime-status and lockfile repair remain separate operational commands and are not part of the retired ABC verification topology.

## Last active legacy workflow identities

The following files are archived by Git history and must not be restored to active Owner Control without a new explicit Owner decision:

| Legacy workflow | Last recorded blob SHA | Historical purpose |
| --- | --- | --- |
| `.github/workflows/manual-verify.yml` | `ac7584e701340b4dd9a864a2ae746b8acd1bf3ee` | Multi-profile manual verification including current/G5/Android |
| `.github/workflows/manual-android-release.yml` | `a75a9bcd122f804ce2c39dedea0a239f4e7c00ba` | Duplicate pre-convergence Android release path that directly invoked G6 naming |
| `.github/workflows/verify-a.yml` | `752664078b5444ec579d182f56ad0ab76fa1b322` | A-line / Android carrier verification wrapper |
| `.github/workflows/verify-b.yml` | `59f6a199e257f68a86fda69fb6068877956a720d` | B-line / SMT Web verification wrapper |
| `.github/workflows/verify-c.yml` | `d06d48401a8db446c2f60d4e2372fdc8562c17a1` | C-line / Runtime-contract verification wrapper |
| `.github/workflows/verify-abc-integration.yml` | `171cf558230cd8a900b8e252188bfeae151ee950` | Combined A/B/C integration wrapper |
| `.github/workflows/verify-core.yml` | `1869d3c71f8831d8ee743b6fc1e9e0370e8f043a` | Reusable profile switch containing A/B/C/integration and G5/G6 logic |
| `.github/workflows/verify-ui-mother.yml` | `7a582eb783982ddf10cdb44bbe770e8696040be0` | Mother/P01-specific UI verification gate |
| `.github/workflows/verify-b-smm.yml` | `26ff9f494084a26e1ff385d1c4fb125fc99f1c7e` | Historical B/SMM-specific verification |
| `.github/workflows/p01-builder-control.yml` | `8041d3dd2d96adadaa15b61bf12e134cc8e5466e` | Historical P01 control chain that repaired lockfile then invoked verify-b |
| `.github/workflows/diagnose-channel-attribution.yml` | `b435ff926ab65f962aeb49c200c9d90e66bc236a` | Temporary diagnostic used while locating legacy static-gate drift |

Git history is the canonical archival copy. Do not duplicate these workflows back into `.github/workflows` merely for reference.

## What was retained from the old system

The new V1 gate keeps the parts that still protect the product:
- canonical Business/Runtime contract tests;
- Order/Pricing/Payment/Fulfillment/Channel/Reporting and workspace tests;
- UI authority boundary and SDK passthrough tests;
- SMT current functional tests for Cart/Checkout shell, Orders, Dine, Soldout, Business Day, Reporting and Printing;
- Mother/Golden contract verification where it still represents a current invariant;
- exact-SHA checkout, lockfile install, TypeScript and production build.

The Carrier gate keeps:
- Native/Printing/Durability contracts;
- Runtime OTA/Web-to-carrier compatibility tests;
- Android carrier static contract;
- Android compile, lint and assemble.

## What is no longer a current blocker

Historical only:
- A-line, B-line and C-line verification ownership;
- `/verify-a`, `/verify-b`, `/verify-c`, `/verify-abc`, `/verify-ui-mother`;
- G5/G6/B3 as release-gate identities;
- component-location/static regex tests whose only purpose is to preserve old file/class/prop placement.

A historical test may still be useful as research evidence or migration parity reference. It does not regain blocking authority unless its underlying semantic invariant is deliberately promoted into a current V1 or Carrier test.

## Migration evidence

The first current V1 verification was run against MoreFunOS V1 exact SHA:
`b2ca59f9730120d2b292bd58c59923af5cbb3ff8`

Result:
`/verify-v1 ... -> success`

This PASS was obtained before retiring the legacy Owner commands, preventing a verification vacuum.
