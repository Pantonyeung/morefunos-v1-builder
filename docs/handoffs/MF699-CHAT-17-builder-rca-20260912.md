# MF699-CHAT-17 Builder RCA — 2026-09-12

## Status
GREEN / CLOSED

## Root cause
V1 Builder itself was healthy. Run 34665078254 was successfully dispatched and failed at V2 Memory Guard with `ENTRY_WORK_ACTION_MISMATCH` because the frozen candidate 5bf4269235af1f6abd7b537c66c4182570df7d3d still declared `capability_action: LINKUP`, while the dispatch requested `REGRESSION_REPAIR`.

## Why prior successful runs worked
The same MF699-CHAT-17 governance envelope was internally consistent for R3–R6 (`LINKUP`), and Builder runs 34656356034, 34656871943, 34657011446 and 34657152231 succeeded.

## Corrected governance
Current Morefun-v2 exact SHA `d37266077847e9c0c46cdfa73eb4b4afc2673875` declares `capability_action: REGRESSION_REPAIR` in both the authoritative work item and accepted plan. Base exact SHA is `7d3c39c05693ca2150476348fd635d5637ae3f6c`.

## Formal proof
Existing queue request: `requests/v2-admission-queue/MF699-CHAT-17-r12-d3726607.txt`.
Formal V1 Builder Run: `34667870541`.
Conclusion: `success`.
Passed: queue manifest, source credential, candidate checkout, Memory Guard, impact analysis, Node/dependencies, root typecheck, required ORDER/BUSINESS_DAY proof, SMM proof, Customer proof, evidence upload and durable result seal.

Durable result seal: `.ci-results/admission-queue/MF699-CHAT-17.txt`.

## Operational note
Do not rerun 34665078254: reruns retain the old event/candidate envelope and will continue evaluating the stale LINKUP candidate. Use a new exact-SHA queue request when governance/candidate changes.

## Cleanup
A duplicate diagnostic queue request created during RCA was removed after the existing R12 request was discovered. No Morefun-v2 workflow/CI was run.
