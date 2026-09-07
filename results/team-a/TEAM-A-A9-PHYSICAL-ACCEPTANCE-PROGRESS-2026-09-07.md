# Team A A9 Physical Acceptance Progress — 2026-09-07

STATUS: AUTOMATED_PREPARATION_PARTIAL_GREEN__PHYSICAL_NOT_EXECUTED
WORK_ID: TEAM_A_A9_PHYSICAL_ACCEPTANCE
SOURCE_SHA: f1da65ddc8ce27d2c75748c859d4403c7c072165

CONFIRMED_GREEN:
- SMT 1920x1080 Preview: run 34093414641 — SUCCESS
- SMT signed Runtime package: successful exact-source package evidence
- SMT OTA online publication: successful exact-source public publication evidence
- public OTA origin: https://morefunos-v2-smt-ota.pantonyeung.workers.dev/
- Morefun-v2 native CI/Actions/Workflow: 0

SMM:
- production build/deploy/PWA smoke repeatedly GREEN
- Chromium E2E failures so far classified as stale/brittle Builder locators against current retained/hidden React views
- Builder E2E corrected toward visible/active-role/state scoped locators per Playwright official guidance
- current rerun: R7, request commit 3433bb633b01563b96f095621a571e59c6c983cb
- physical iPhone acceptance: NOT_EXECUTED

PHYSICAL GATES STILL REQUIRED:
- SMT real 1920x1080 device
- real USB/LAN/native printer health + physical output
- OTA install/update on device
- offline Menu/Pricebook + restart + reconnect
- SMM real iPhone/PWA safe-area + one-hand
- SMM offline pending sync + reconnect
- delegated print to SMT
- exactly-once physical print observation

NO CLAIM:
A9 is NOT CLOSED until real-device gates pass.


## 2026-09-07 16:15 HKT — SMM AUTOMATED PRODUCTION GATE GREEN

STATUS: AUTOMATED_FRONTLINE_PREP_GREEN__PHYSICAL_NOT_EXECUTED

Business Day repair:
- root cause: production had OPEN Business Day 2026-09-03 but zero mfos_business_day_control rows
- migration: 0048-business-day-control-backfill.sql
- candidate: c5e4ab878a8982eb042f837601fe80ff61e5b1a1
- queue run: 34098483064 — SUCCESS
- PR: 566 — MERGED
- admitted main: c4ed75174b2e25fdec8d63674dd0a829bc383991
- post-admission verify: 34098766103 — SUCCESS
- production migration run: 34098828542 — SUCCESS
- production readback: Business Day control exists for the same open day with intake_status=PAUSED
- product availability readback: 204 rows / 204 distinct products / no duplicates

SMM complete production gate:
- exact source: f1da65ddc8ce27d2c75748c859d4403c7c072165
- final Builder run: 34099457234 — SUCCESS
- production D1 diagnostic: PASS
- build/typecheck/source tests: PASS
- public Worker deploy: PASS
- PWA/fail-closed smoke: PASS
- Chromium functional E2E: PASS
- frontline.operational-context.read.v1: HTTP 200
- order.direct.staff.submit.v1: HTTP 200 / ACCEPT
- canonical orderId: 5796b3d1-d197-4594-875a-c2004659e84f
- canonical readback: HTTP 200
- cleanup cancel: PASS
- post-cleanup open list: HTTP 200 / cancelledStillOpen=false
- browser productCount: 188
- browser orderCount: 16
- pricing totalMinor test value: 4700
- approved cross-origin distribution is limited to exact read-only pricing revision/active endpoints and the exact pricing WebSocket; all other cross-origin API remains forbidden

Builder-only test corrections:
- Playwright visible/active control scoping
- operational-context readiness gate before direct order
- explicit WebSocket observation
- exact public pricing distribution allowlist

Still NOT EXECUTED:
- real iPhone/PWA safe-area + one-hand
- SMM offline pending sync + reconnect on real iPhone
- delegated print to SMT on real hardware
- real 1920x1080 SMT device
- real USB/LAN/native printer health/output
- OTA install/update on physical SMT
- offline Menu/Pricebook + restart/reconnect on physical devices
- exactly-once physical print observation

NO CLAIM:
A9 remains OPEN until all physical gates pass.
