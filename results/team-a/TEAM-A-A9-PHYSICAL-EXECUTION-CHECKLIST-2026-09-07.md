# Team A A9 Physical Execution Checklist — 2026-09-07

STATUS: READY_FOR_OWNER_PHYSICAL_EXECUTION
WORK_ID: TEAM_A_A9_PHYSICAL_ACCEPTANCE

## Exact sources / Builder evidence
- latest product main observed at start: abcd27d9a357d48ff4374d108c97e8f2db166891
- A9 Frontline acceptance source: f1da65ddc8ce27d2c75748c859d4403c7c072165
- SMM automated production gate: run 34099457234 — SUCCESS
- SMT signed package run: 34094754993
- SMT online publish run: 34094913754 — SUCCESS
- public OTA origin: https://morefunos-v2-smt-ota.pantonyeung.workers.dev/
- Morefun-v2 native Actions/CI/Workflow: FORBIDDEN / 0

Latest main movement after A9 source is Team B Management-side and does not invalidate the frozen A9 Frontline physical acceptance object unless a fresh Frontline regression is observed.

## Physical gate order

### P1 — SMT device / OTA
1. Use primary 1920x1080 SMT hardware.
2. Open the public OTA origin.
3. Install/update the signed A9 runtime.
4. Record visible version/source identity if exposed.
5. Cold restart the device.
PASS:
- runtime launches after restart;
- no blank/loading dead screen;
- 1920x1080 shell remains usable;
- no Morefun-v2 native CI used.

### P2 — SMT printer health + physical output
1. Connect the real production printer by the actual USB/LAN/native route.
2. Verify printer health in SMT.
3. Trigger one safe test Print Job through the canonical path.
4. Observe one physical ticket.
PASS:
- printer is detected/reachable;
- exactly one physical ticket is produced;
- canonical Print Job identity/status remains one logical job;
- no browser/mobile printer engine is introduced.

### P3 — SMT offline Menu/Pricebook + restart/reconnect
1. While online, confirm current Menu + Pricebook are loaded.
2. Disconnect WAN.
3. Navigate/order using the local operational copies.
4. Restart SMT while still offline.
5. Confirm Menu + Pricebook still render locally.
6. Reconnect WAN.
PASS:
- no blank Menu;
- local ACTIVE Menu/Pricebook survive restart;
- reconnect refreshes/reconciles without replacing truth with local cache;
- no duplicate Order/Print side effect.

### P4 — SMM real iPhone/PWA
1. Use the real iPhone PWA, not browser emulation.
2. Verify safe-area top/bottom, portrait layout, one-hand controls and touch targets.
3. Confirm current Menu/Pricebook and operational context.
PASS:
- no clipped controls;
- primary actions reachable one-handed;
- no hidden/duplicate active view;
- real device behavior matches the automated gate.

### P5 — SMM offline pending sync
1. While online, load the current operational bundle.
2. Disconnect WAN.
3. Create one explicitly eligible staff Order.
4. Confirm it is visibly PENDING_SYNC before any success claim.
5. Restart/close-reopen SMM while still offline.
6. Confirm pending intent survives.
7. Reconnect WAN.
PASS:
- one stable submission/request identity;
- one canonical Order only;
- pending becomes SYNCED after canonical readback;
- no silent loss / no last-write-wins.

### P6 — delegated print SMM -> SMT
1. From SMM, request Print for the accepted test Order.
2. Observe the same canonical Print Job on SMT.
3. Let SMT execute the physical print.
PASS:
- SMM requests/observes only;
- SMT executes physically;
- exactly one ticket is printed;
- reconnect/retry does not cause a second print.

## Closure gate
A9 may become CLOSED only when P1-P6 all PASS with real-device evidence.
If any physical step fails:
- classify the fresh failure only;
- do not reopen already-green automated A9 evidence;
- do not start A10.

After A9 durable closure:
NEXT = TEAM_A_A10_FRONTLINE_GOLDEN_DAY
