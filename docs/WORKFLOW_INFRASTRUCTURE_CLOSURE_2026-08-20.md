# MoreFunOS V1 Builder｜Workflow Infrastructure Closure

Date: 2026-08-20 HKT
Status: UI/RUNTIME PRODUCTION LANE PASS
Scope: Builder control, SMT Mother verification, Runtime release/OTA, Android release boundary, workflow self-governance.

## 1. Final execution authority

`Pantonyeung/morefunos-v1` is Source / Product Authority / evidence sink. Its GitHub Actions are not the current execution path.

`Pantonyeung/morefunos-v1-builder` is the only active CI / verification / packaging / signing / release / OTA executor.

Official/current external references calibrate gates. PASS still requires actual exact-SHA Builder evidence.

## 2. Active production topology

The active command surface is reduced to one Owner router:

`Owner Control V2 -> reusable verification/release workflows -> one sanitized result`

Only `owner-control-v2.yml` may listen to `issue_comment`. Builder Self Check enforces this invariant.

Current first-class roles:
- `owner-control-v2.yml`
- `verify-ui-mother.yml`
- `runtime-release-v2.yml`
- `android-release-v2.yml`
- `builder-self-check.yml`

Historical direct listeners were removed from `.github/workflows` or converted to reusable/manual diagnostic roles. Archived workflow source remains available for evidence/history but is not an active parallel Authority.

## 3. Workflow hardening completed

Completed controls:
- immutable full-SHA pins for active GitHub/third-party Actions;
- Dependabot governance for GitHub Actions updates;
- least-privilege workflow permissions;
- single issue-comment router topology;
- exact source SHA validation and identity proof;
- source checkout before npm cache initialization;
- Node 22.12.0 toolchain floor for current Vite 8;
- clean lockfile install with `npm ci`;
- maintained dependency graph check;
- Mother contract, TypeScript, Vite and dist integrity as separate observable gates;
- verified immutable production-dist artifact handoff;
- Runtime Release V2 consumes the verified artifact instead of re-inventing a second UI verification policy;
- package-first / public hash proof / manifest-last OTA transaction retained;
- sanitized failure-stage reporting to Owner Control;
- `actionlint`-based Builder Self Check plus MoreFunOS-specific one-router topology policy.

## 4. Production smoke evidence

Verified MoreFunOS V1 Mother source:

`56f04230bc066418d95fc790078df05d42a07198`

Lineage:
- parent: `29a442fb306d389f56702dbf514b28579d30f1af`
- only source change after parent: `mother-ui-contract.test.mjs` corrected stale stylesheet path from `smt-mother.css` to the actually loaded `smt-mother-pos.css`.
- no Runtime, UI behavior, Native, Hardware or business-state behavior changed by that correction.

Production evidence:
- `/verify-ui-mother 56f04230bc066418d95fc790078df05d42a07198` -> PASS
- repeated same exact-SHA Mother Verify -> PASS / `stage=none`
- Mother contract -> PASS
- TypeScript project gate -> PASS
- Vite production build -> PASS
- dist/local startup dependency integrity -> PASS
- verified dist artifact -> PASS
- `/release-runtime 56f04230bc066418d95fc790078df05d42a07198 candidate` -> PASS
- `/runtime-status 56f04230bc066418d95fc790078df05d42a07198 candidate` -> PASS
- public OTA identity therefore matches the exact candidate source.

The original Mother branch `agent/smt-mother-ui-sdk-integration-20260820` was fast-forwarded to the exact tested/released SHA above, so PR #166 and OTA evidence refer to the same source identity.

## 5. Android / Carrier lane status

`android-release-v2.yml` is part of the active hardened replacement set and passes Builder Self Check/static workflow validation.

It has intentionally NOT been production-smoked in this UI-only closure because there is no genuine APK/Native/Carrier change. Building/releasing an APK only to test the workflow would violate the current Hardware/Carrier closure rule and would create unnecessary release risk.

Required policy:
- ordinary UI / Runtime mutation -> Runtime `.mfos` lane only;
- genuine Native / Carrier / Hardware boundary change -> Android Release V2, then its own production smoke and device evidence.

Therefore Android production execution is `NOT EXERCISED / NOT REQUIRED FOR THIS UI-RUNTIME CLOSURE`, not a claimed Device or Hardware PASS.

## 6. Supported Owner commands

Formal Builder commands are routed through Issue #2 / Owner Control V2. Relevant current commands include:

- `/verify-ui-mother <exact-40-char-source-sha>`
- `/release-runtime <exact-40-char-source-sha> candidate|stable|dev`
- `/runtime-status <exact-40-char-source-sha> candidate|stable|dev`
- `/release-android <exact-40-char-source-sha>` only when Native/Carrier scope is genuinely reopened.

Historical A/B/C verification and maintenance commands may remain callable through the router where explicitly required, but they are not substitutes for the current Mother UI/Runtime evidence path.

## 7. Current release state

SMT Mother candidate source:
`56f04230bc066418d95fc790078df05d42a07198`

State:
- Source: PASS
- Builder Self Check: PASS
- Mother Verify: PASS
- Runtime Release: PASS
- Public OTA identity: PASS
- Runtime Delivery: candidate published
- Device UI acceptance: PENDING OWNER REAL-DEVICE REVIEW
- APK/Native/Hardware: unchanged; no rebuild required
- PR #166: keep Draft / DO NOT MERGE until Owner device acceptance.

## 8. Known limits

This closure does not claim that every historical Builder diagnostic workflow has been modernized. Historical diagnostics remain archived or diagnostic-only and must not silently regain production blocking authority.

This closure also does not replace real-device UI acceptance. Browser/build/OTA PASS does not equal Device UI PASS.

## 9. Next gate

The infrastructure lane is no longer the blocker for SMT P01.

Next gate:
`Owner detects candidate OTA -> explicit Download -> explicit Install/Activate -> real 1920x1080 device review -> batch KEEP/MODIFY/DROP feedback`.

No SMT Mother source mutation should be made before that first device review unless a new production defect is discovered in the delivery infrastructure.

## 10. Self-Invention Audit

No new CI platform or second release authority was introduced. The closure uses GitHub reusable workflows, official GitHub setup/actions mechanisms, official TypeScript/Vite/Android/Gradle tooling, existing MoreFunOS packaging/publication scripts, and only thin MoreFunOS-specific routing/evidence adapters where vendor tooling cannot express exact product identity or OTA transaction invariants.