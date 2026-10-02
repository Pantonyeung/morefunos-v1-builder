# MFP V3 A9｜Builder Runtime OTA Migration Handoff｜2026-10-02

Status: PREPARE / SOURCE MIGRATION REQUIRED
Builder Repository: Pantonyeung/morefunos-v1-builder
Branch: feat/MFP-V3-A9-BUILDER-RUNTIME-OTA-2026-10-02
Parent Builder main SHA: fe2692ac8e979e7d9e1d211758b9f9dfa9846190

MFP source repository:
Pantonyeung/mfk

A9 accepted parent MFP SHA:
83adb14c21170bc3a34a0022c62b1a2bea2f68c4

## Current verified Builder state

Workflow:
`.github/workflows/mfk-runtime-ota.yml`

Current workflow blob:
`70969c65ecf37d163e56ffbeeeb9d5410d470c15`

Current request:
`requests/mfk-runtime-ota-request.txt`

Current request still points to legacy V2 containment source:
`9e713380f860bc33cf4b859e5b51451d1abf9df3`

Current Builder workflow explicitly builds:
`source/v2local`

It checks:
- source/v2local/index.html
- source/v2local/src/App.tsx
- source/v2local/src/runtime/local-runtime.ts
- source/v2local/src/runtime/native-print.ts

and packages:
`source/v2local/dist`

Therefore the existing Builder workflow MUST NOT be used to publish MFP V3 as-is.

## A9 requirement

Adapt the Builder source-selection/build lane so an explicitly requested MFP V3 runtime source:
- checks out exact MFK SHA
- verifies the requested product/runtime target
- builds `v3smt`
- packages the exact `v3smt/dist`
- preserves existing signed .mfos / SHA-256 / runtime-update manifest / public readback / rollback protocol
- does NOT alter signing identity
- does NOT create a second OTA protocol
- does NOT publish merely because this branch/PR exists

## Safety

DO NOT edit `requests/mfk-runtime-ota-request.txt` during source migration.
That request file is the main-branch publish trigger.

No publish, deploy, R2 upload, OTA activation, or production cutover is authorized by this Builder PR.

The Builder migration must be SOURCE_VERIFIED before any A9 candidate publish request is authorized.

## Candidate naming

Keep existing format:
`runtime-candidate-mfk-<exact MFK SHA first 12>`

Do not invent a second release identity format unless an existing contract requires it.

## Required Builder tests/guards

1. V3 target selects `source/v3smt`
2. exact MFK SHA readback required
3. V3 package.json / index / critical source guards exist
4. V3 test passes before build
5. V3 typecheck passes before package
6. V3 production build passes
7. packaged dist source is `v3smt/dist`
8. .mfos signing remains existing signing path
9. archive SHA-256 preserved
10. runtime manifest includes exact source SHA
11. public manifest/bundle readback checks retained
12. minCarrierVersionCode / bridgeVersion retained unless formal compatibility evidence requires change
13. request path remains the only publish trigger
14. PR/source verification cannot publish
15. rollback semantics unchanged
16. legacy V2 target cannot be silently selected for an MFP V3 request

## Completion target

SOURCE_VERIFIED only.

Return:
- changed files
- exact Builder SHA
- tests
- workflow/static validation
- proof request file unchanged
- proof no publish run triggered
- next exact action for Commander

MILESTONE:
MFP_V3_A9_BUILDER_RUNTIME_OTA_MIGRATION_2026_10_02
