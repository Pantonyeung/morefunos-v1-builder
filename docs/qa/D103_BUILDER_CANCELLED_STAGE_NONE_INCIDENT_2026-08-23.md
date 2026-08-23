# D-103 Builder `cancelled stage=none` Incident

Date: 2026-08-23 HKT
Status: ROOT-CAUSE HYPOTHESIS NARROWED TO D-103 HEAVY EXECUTION PATH / POST-REPAIR RUN PENDING
Scope: `Pantonyeung/morefunos-v1-builder` execution plane only
Product source authority: `Pantonyeung/morefunos-v1`

## Symptom

Repeated Owner Control D-103 exact-SHA runs returned:

`result=cancelled stage=none`

Observed on multiple different MoreFunOS V1 source SHAs, including:
- `af69f500261edd8baefdcc146d6b136fe17d055c`
- `cfe20d71e07b15abde6412f90927dce650363f64`
- `d8a3c415bedc318b9bc42e02ba1624ce1dbe46cc`
- `a76f89b4038243e0bad5ef36ba5d2c87faf0d5e3`

This is not evidence of an SMT regression stage because no application stage was reported.

## Evidence reviewed

### Owner Control
`.github/workflows/owner-control-v2.yml`

- trigger: `issue_comment.created`
- concurrency group is unique per `github.event.comment.id`
- `cancel-in-progress: false`

Conclusion: current Owner Control concurrency does not explain cancellation of independent comments.

### D-103 reusable workflow
`.github/workflows/verify-smt-p01-d103.yml`

Before repair:
- no current reusable-workflow concurrency lock
- job-level timeout: 35 minutes
- V1-owned profile executed as one long step

Historical commits confirm D-103 previously had a concurrency lock, first global and then per-source-SHA, but that lock was removed by `4e64df6e2b2989b99fa27c1a0ea79631abd469ca`.

Conclusion: the old concurrency defect is not the current explanation.

### V1-owned D-103 workload
Current `scripts/verify-smt-p01-d103.mjs` performs:

`npm install -> full Vitest -> typecheck -> build -> Playwright Chromium + OS deps install -> preview -> 1920x1080 fidelity capture -> evidence copy`

This is materially heavier than the original D-103 relay, which began as install + one D-103 test + typecheck + build with a 20-minute timeout.

### Working control workflow
Current `verify-v1.yml` has a 30-minute job timeout but performs locked install + contracts + typecheck + SMT functional tests + SMT build only. It does not install Chromium, start preview, capture geometry or copy fidelity evidence.

This comparison reinforces that the former D-103 35-minute ceiling was disproportionately tight after browser/fidelity work moved into the V1-owned profile.

## GitHub official behavior

GitHub Actions `jobs.<job_id>.timeout-minutes` automatically cancels the job after the configured maximum. Step-level `timeout-minutes` kills the step rather than the whole job, allowing later diagnostic steps to run when the workflow is structured correctly.

This behavior matches the observed caller result `cancelled stage=none` when a job-level timeout kills the reusable job before `Derive failure stage` can publish an output.

## Control experiment — Owner Control bus health

A lightweight read-only command was posted through the exact same Owner Control bus:

`/runtime-status 58b8dcc88fcadd83ef8994c4b362477ee6e7baaf candidate`

Fresh comment ID:
`5384642717`

Bot result:

`owner-control-v2 command=runtime-status source_sha=58b8dcc88fcadd83ef8994c4b362477ee6e7baaf result=failure channel=candidate`

Bot result comment ID:
`5384643928`

Interpretation:
- `issue_comment.created` trigger works;
- Owner Control `prepare` works;
- GitHub-hosted runner can be provisioned;
- Owner Control `report` works;
- issue write permission works;
- a failure result can be returned normally.

Therefore the incident is not a general Owner Control / runner / issue-write outage. It is narrowed to the D-103 reusable/heavy execution path.

## Current root-cause hypothesis

`35-minute D-103 job timeout became stale after the V1-owned D-103 profile expanded into full browser/fidelity verification.`

Confidence: HIGH.

The control experiment materially strengthens this hypothesis by proving the common Owner Control execution bus is healthy.

## Repairs applied

### `448dd83838508added54c5ad23e74a2ffeb25342`
- D-103 job timeout: 35 -> 90 minutes
- heavy V1-owned profile receives a separate 70-minute step timeout
- `continue-on-error: true` retained so Derive Failure Stage can execute after step failure

### `dac682411a41ca0bc43ee1a4b00a7b857646a6a2`
- Owner Control cancellation fallback added

### `be09acfadb2f0389d4c156c79329c40d8987b17c`
- Builder Self Check hard-gates `verify-smt-p01-d103.yml` with actionlint

### `4eaed09137cf9d4f97631f1f1c0ac66a5545a1b4`
- cancellation fallback corrected to treat both empty stage and literal `stage=none` as `job-level-cancel`

### `59d836a6d89bf6701e84776d704d179384ade100`
- Builder Self Check now runs on direct `main` workflow/script changes as well as PR/manual dispatch

## Verification experiment

Current exact MoreFunOS V1 source under test:

`58b8dcc88fcadd83ef8994c4b362477ee6e7baaf`

Fresh Owner Control D-103 comment created after the complete repair chain:

`5384626777`

## PASS condition for this incident

The fresh run must do one of the following:

1. return an actual D-103 application stage (`test-*`, `typecheck-*`, `build`, `browser-install`, `preview`, `geometry`, `evidence-artifact`), proving the execution/diagnostic path is restored; or
2. return D-103 PASS with evidence artifact.

A new `cancelled stage=none` is NOT acceptable. With the updated Owner Control fallback, a true outer cancellation must at minimum classify as `job-level-cancel`.

If cancellation remains after the increased job timeout, the next classification is D-103 runner/platform execution and must be investigated from workflow run/job metadata rather than by changing SMT source.

## Rejected approaches

- repeatedly posting the same Owner Control command without changing evidence;
- treating `cancelled stage=none` as an SMT application failure;
- reintroducing D-103 concurrency locks;
- changing SMT product code to address Builder cancellation;
- claiming PASS before exact-SHA Builder evidence;
- assuming the Owner Control bus is broken without a control experiment.

## Self-Invention Audit

No Product/Business/Runtime/Native authority was introduced or changed. Repairs are confined to the Builder execution/diagnostic plane and follow GitHub Actions timeout/reusable-workflow behavior.