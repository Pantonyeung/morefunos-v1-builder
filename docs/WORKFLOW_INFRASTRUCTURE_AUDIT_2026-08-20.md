# MoreFunOS V1 Builder｜Workflow Infrastructure Audit

Date: 2026-08-20 HKT
Status: REVIEW / IMPLEMENTATION BASIS
Branch: `agent/workflow-infrastructure-hardening-20260820`
Scope: Builder verification, Runtime OTA, Android/Carrier release, control, diagnostics and workflow self-governance.

## 1. Owner direction

`Pantonyeung/morefunos-v1` is Source / Product Authority / Evidence Sink only. Its GitHub Actions quota is exhausted and its workflows MUST NOT be used as current execution infrastructure.

`Pantonyeung/morefunos-v1-builder` is the only CI / verification / packaging / signing / release / OTA execution repository.

External references define and calibrate gates. PASS still requires actual exact-SHA execution evidence from Builder.

Reference priority:
1. Context7 current official documentation;
2. vendor/official package documentation;
3. maintained mature third-party SDK/action documentation;
4. MoreFunOS thin adapter only when necessary.

## 2. Current-state findings

### F1｜Workflow proliferation
Builder currently contains more than 30 workflow files, including many one-off P01 diagnostic, repair, legacy verification and status workflows. This creates overlapping control surfaces and makes the execution graph difficult to reason about.

Classification: ARCHITECTURAL DEBT.

### F2｜Issue-comment fan-out
At least these workflows independently subscribe to `issue_comment`:
- `owner-verification-control.yml`;
- `manual-runtime-release.yml`;
- `runtime-release-status.yml`;
- `p01-trigger-diagnostic.yml`.

One issue comment can therefore create multiple workflow runs before job-level `if` conditions skip irrelevant jobs. This is execution noise and a likely contributor to unnecessary Actions run volume.

Decision: ONE issue-comment router only.

### F3｜Verification logic is duplicated and divergent
`verify-b` delegates to `verify-core.yml`, which still hard-gates legacy `test:g5`, `test:current`, `typecheck:g5`, old SMT tests and build.

`manual-runtime-release.yml` independently repeats a different old verification stack (`test:g6`, `typecheck:g6`, `apps/smt-web test`, bootstrap tests and build).

The new SMT Mother gate uses a third set (`verify:mother`).

Result: a source SHA can pass one path and be blocked by a different historical path during release.

Decision: verification contract must be single-source and reusable. Release must not contain a second hidden UI verification policy.

### F4｜Builder policy protects historical implementation details
`scripts/verify-builder-policy.mjs` currently requires literal legacy commands and workflow text such as `test:g5`, `test:current`, G6 commands and specific old workflow structures.

Result: governance itself prevents modernizing the execution architecture.

Decision: policy must validate invariants (exact SHA, least privilege, immutable action refs, approved commands, artifact integrity, release ordering), not freeze obsolete test names.

### F5｜Action dependencies are mutable
Current workflows use moving refs such as `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-java@v5`, `android-actions/setup-android@v4`, `gradle/actions/setup-gradle@v6`.

GitHub secure-use guidance states full-length commit SHA is the immutable way to reference an action.

Decision: active production workflows pin third-party and GitHub actions to audited full commit SHAs, with human-readable release comments. Dependabot for `github-actions` manages update PRs.

Audited current refs as of 2026-08-20:
- actions/checkout v7 -> `3d3c42e5aac5ba805825da76410c181273ba90b1`;
- actions/setup-node v7 -> `820762786026740c76f36085b0efc47a31fe5020`;
- actions/setup-java v5 -> `b6effb05e454b25005698d916606bdc6ffcbf961`;
- android-actions/setup-android v4 -> `40fd30fb8d7440372e1316f5d1809ec01dcd3699`;
- gradle/actions/setup-gradle v6 -> `9c971963bec38e04b3d30dcc455b5382be2fdbfb`.

### F6｜Mother verify cache ordering defect
`verify-ui-mother.yml` runs `setup-node` with `cache-dependency-path: source/apps/smt-web/package-lock.json` before the private source checkout creates `source/`.

Decision: exact source checkout precedes dependency-cache initialization.

### F7｜No GitHub Actions Dependabot governance
No `.github/dependabot.yml` currently manages action references.

Decision: add weekly GitHub Actions updates with small PR grouping; do not auto-merge workflow supply-chain changes.

### F8｜Runtime publish combines build policy and publication policy in one very large job
`manual-runtime-release.yml` is large and contains request parsing, source verification, old tests, build, JAR signing, package contract, metadata, private Release creation, OTA delivery source checkout, Wrangler installation and Cloudflare publication.

The package-first / manifest-last publication logic is sound and should be preserved, but orchestration is too coupled.

Decision: retain the proven `publish-runtime-online.mjs` package-first/manifest-last transaction; simplify orchestration around it.

### F9｜OTA Worker migration belongs to bounded recovery, not ordinary release
`publish-runtime-online.mjs` can deploy the Worker if the live manifest-source marker is missing. This is useful as migration/self-heal, but normal Runtime publication should not routinely combine Runtime release with infrastructure deployment.

Decision: normal path = publish package + publication manifest only. Worker deploy/migration becomes an explicit bounded recovery/infra path. Existing read-only Worker remains canonical.

### F10｜Android workflow uses historical cross-line G6 gates
The Carrier release workflow hard-gates `test:g6/typecheck:g6` before the direct Android compile/lint/build evidence.

Decision: Native release gates should be based on current Carrier contracts, Android SDK/Gradle compile/lint/assemble, Web Runtime compatibility where actually required, APK signer/package/version checks and device acceptance. Historical line labels may remain diagnostic only.

## 3. Official / mature reference conclusions

- GitHub Actions: reusable workflows are first-class for shared execution contracts.
- GitHub Actions: explicit `permissions` and least privilege.
- GitHub Actions secure-use: pin actions to full commit SHA for immutable references.
- GitHub Actions: use setup actions for package-manager dependency caching.
- GitHub Actions: concurrency group names should include workflow identity when appropriate to avoid accidental cross-workflow coupling.
- GitHub Actions: Dependabot / Dependency Graph / Dependency Review are recommended for action dependency governance.
- Vite 8: Node `^20.19.0 || >=22.12.0`; production evidence is `vite build` output.
- TypeScript: static type validation is an independent gate; do not use historical business tests as a substitute for compiler evidence.
- Gradle Actions: Gradle Wrapper is preferred when a project owns a valid wrapper; otherwise an explicitly pinned setup-gradle version is acceptable.

## 4. Target architecture

Only five first-class workflow roles remain after migration:

1. `owner-control.yml`
   - the only `issue_comment` listener;
   - parses exact command + SHA/channel;
   - routes to reusable workflows;
   - publishes one sanitized result.

2. `verify-source.yml` / current Mother specialization
   - exact private source SHA;
   - clean locked install;
   - maintained dependency graph;
   - current contract tests;
   - TypeScript;
   - Vite production build;
   - dist/local-asset integrity;
   - no release credentials.

3. `release-runtime.yml`
   - uses the same current verification contract;
   - Runtime lifecycle/bootstrap contract;
   - sign one atomic `.mfos`;
   - verify package identity/hash/signer;
   - private immutable evidence;
   - package-first / manifest-last Cloudflare OTA publication;
   - no APK rebuild.

4. `release-android.yml`
   - only for genuine Native/Carrier changes;
   - Android SDK/Gradle/compile/lint/assemble;
   - stable signing + signer verification;
   - immutable artifact evidence;
   - no ordinary UI release responsibility.

5. `builder-self-check.yml`
   - validates Builder workflow changes without V1 source secrets;
   - workflow lint/static policy;
   - checks immutable action refs;
   - detects duplicate command listeners / forbidden triggers;
   - runs on Builder infrastructure PRs, not on MoreFunOS V1.

Legacy diagnostic workflows remain available only until the replacement proves equivalent evidence. They must not stay permanent parallel Authorities.

## 5. Gate model

Hard PASS gates:
- exact source identity;
- committed lockfile / clean install;
- official compiler/build tooling;
- current product/runtime/native contract tests;
- artifact/package integrity;
- signing identity;
- release transaction integrity.

Diagnostic-only:
- historical G4/G5/G6 labels;
- superseded P01 layout assumptions;
- old one-off repair workflows;
- compatibility tests whose business/UI premise has been explicitly superseded.

A diagnostic failure can create a finding. It cannot silently become a new production block without a current Authority reason.

## 6. Runtime OTA transaction retained

Retain:
`exact SHA -> verify -> build -> sign -> package contract -> private evidence -> R2 package upload -> public package SHA proof -> manifest upload last -> public manifest identity proof`.

Do not change this ordering merely for simplification.

The simplification target is orchestration, not weakening atomic publication safety.

## 7. Migration rule

Do not delete old workflows first.

Migration sequence:
1. implement hardened replacement on isolated Builder branch;
2. static/self validation;
3. run replacement against known source SHA;
4. compare evidence to working reference;
5. prove Runtime candidate publication;
6. only then disable/archive superseded workflows from `.github/workflows`;
7. update Builder policy to enforce the reduced active workflow set.

## 8. Self-Invention Audit

No new CI framework is authorized. The target uses GitHub reusable workflows, official GitHub setup actions, official TypeScript/Vite tooling, official Android/Gradle tooling and existing proven MoreFunOS packaging/publication scripts. Custom code is limited to thin policy/evidence adapters where GitHub/vendor tooling does not encode MoreFunOS-specific package identity or OTA transaction invariants.