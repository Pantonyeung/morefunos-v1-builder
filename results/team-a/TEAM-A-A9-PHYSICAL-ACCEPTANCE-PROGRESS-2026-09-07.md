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
