# D-103 Builder `cancelled stage=none` Incident

Date: 2026-08-23 HKT
Status: ROOT-CAUSE INVESTIGATION ACTIVE / FAILURE BOUNDARY NARROWED TO V1-OWNED D-103 PROFILE STEP
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

This is Builder execution evidence, not an SMT regression stage, because no application stage was reported.

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

Current script implementation also runs the heavyweight child commands through `spawnSync` without per-stage child-process timeout. Therefore a hung install/test/typecheck/build/browser-install process can keep the outer profile step alive until its enclosing workflow timeout. This is a confirmed observability weakness, but not yet proof that any specific child stage caused the historical cancellations.

### Working control workflow
Current `verify-v1.yml` has a 30-minute job timeout but performs locked install + contracts + typecheck + SMT functional tests + SMT build only. It does not install Chromium, start preview, capture geometry or copy fidelity evidence.

This comparison shows that the former D-103 35-minute ceiling was disproportionately tight after browser/fidelity work moved into the V1-owned profile. It does not by itself prove that timeout was the historical cancellation cause.

## GitHub official behavior / corrected interpretation

Context7 was queried against official GitHub Actions documentation.

Confirmed:
- `jobs.<job_id>.timeout-minutes` imposes a job execution ceiling;
- `steps[*].timeout-minutes` imposes a step ceiling;
- cancellation semantics and `if: always()` mean it is NOT valid to state that a job timeout necessarily prevents every later diagnostic step from running.

Therefore the previous stronger statement — “35-minute timeout definitely caused `stage=none` because Derive Failure Stage could not run” — is withdrawn.

Current classification:
- stale timeout = plausible contributing factor;
- exact historical root cause = not proven from old sanitized comments alone;
- direct workflow run/job evidence is required.

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

## Direct run instrumentation

Owner Control was instrumented to publish `github.run_id` immediately after a D-103 command is accepted, before entering the reusable D-103 job.

Current instrumented exact-SHA run:
- source SHA: `58b8dcc88fcadd83ef8994c4b362477ee6e7baaf`
- command comment: `5384677917`
- accepted comment: `5384678529`
- Actions run ID: `32623683123`
- D-103 job ID: `97155653957`

Direct Actions job evidence for run `32623683123`:
- `prepare` = PASS
- exact request validation = PASS
- Node 22 setup = PASS
- exact V1 source checkout = PASS
- Shared Fixture Registry checkout = PASS
- exact source identity + fixture verification = PASS
- `Run V1-owned D-103 profile` = IN_PROGRESS at last inspection
- subsequent artifact/stage/enforcement steps = pending

This is the narrowest verified failure/latency boundary so far:

`Owner Control / checkout / fixture / identity PASS -> V1-owned D-103 profile step -> unresolved internal stage`

No SMT source change is authorized from this evidence alone.

## Repairs / diagnostics applied

### `448dd83838508added54c5ad23e74a2ffeb25342`
- D-103 job timeout: 35 -> 90 minutes
- heavy V1-owned profile receives a separate 70-minute step timeout
- `continue-on-error: true` retained so later stage derivation can run after an ordinary step failure

### `dac682411a41ca0bc43ee1a4b00a7b857646a6a2`
- Owner Control cancellation fallback added

### `be09acfadb2f0389d4c156c79329c40d8987b17c`
- Builder Self Check hard-gates `verify-smt-p01-d103.yml` with actionlint

### `4eaed09137cf9d4f97631f1f1c0ac66a5545a1b4`
- cancellation fallback corrected to treat both empty stage and literal `stage=none` as `job-level-cancel`

### `59d836a6d89bf6701e84776d704d179384ade100`
- Builder Self Check now runs on direct `main` workflow/script changes as well as PR/manual dispatch

### `6b3372d2227388640a18ba22241909e60df9c697`
- final sanitized result includes `github.run_id`

### `e30fe97b13afa6439b120aa14e8de74cda89c393`
- D-103 accepted event publishes `github.run_id` before entering the reusable workflow, enabling in-progress job inspection

## Next diagnostic action

Do not post repeated blind retries.

For run `32623683123`:
1. inspect workflow jobs until the profile step reaches a terminal state;
2. once the job log blob is available, inspect job `97155653957` logs;
3. identify the last emitted `[D-103] stage=...` line;
4. classify the first failing/hanging child stage;
5. correct only that smallest responsible layer;
6. add per-stage timeout/heartbeat only where evidence justifies it.

If the profile reaches success, fetch the D-103 evidence artifact and continue to browser/geometry/Golden evaluation instead of treating the historical cancellation as current application failure.

## PASS condition for this incident

The incident is closed only when a fresh exact-SHA run does one of the following:

1. returns a real D-103 stage and direct job/log evidence identifies the responsible layer; or
2. returns D-103 PASS with expected evidence artifacts.

A new opaque `cancelled stage=none` is not acceptable.

## Rejected approaches

- repeatedly posting the same Owner Control command without changing evidence;
- treating `cancelled stage=none` as an SMT application failure;
- reintroducing D-103 concurrency locks;
- changing SMT product code to address Builder cancellation;
- claiming timeout as proven root cause without run/job evidence;
- claiming PASS before exact-SHA Builder evidence;
- assuming the Owner Control bus is broken without a control experiment.

## Self-Invention Audit

No Product/Business/Runtime/Native authority was introduced or changed. Changes are confined to Builder observability/execution diagnostics and follow Context7 + official GitHub Actions behavior.