#!/usr/bin/env bash
set -euo pipefail

BASE_RUNNER="$GITHUB_WORKSPACE/scripts/run-v2-android-ring1b.sh"
EVIDENCE_DIR="${3:?evidence dir required}"
APK="${1:?apk required}"
SOURCE_SHA="${2:?source sha required}"
PACKAGE_ID="com.morefunos.smt"
ACTIVITY="com.morefunos.smt/.MainActivity"
mkdir -p "$EVIDENCE_DIR"

# Preserve the admitted Ring1B smoke/restart/fault checks first.
bash "$BASE_RUNNER" "$@"
sha256sum "$APK" | tee "$EVIDENCE_DIR/apk-sha256.txt"

ESBUILD="$GITHUB_WORKSPACE/source/apps/smt-clean/node_modules/.bin/esbuild"
test -x "$ESBUILD"
"$ESBUILD" "$GITHUB_WORKSPACE/scripts/ring1b_m07_browser_probe_entry.ts" \
  --bundle --format=iife --platform=browser --target=chrome83 \
  --global-name=Ring1BM07Bundle \
  --outfile="$EVIDENCE_DIR/m07-browser-probe.js"

wait_for_pid() {
  for _ in $(seq 1 40); do
    if adb shell pidof "$PACKAGE_ID" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  echo "R1B_APP_PID_TIMEOUT" >&2
  return 1
}

launch_app() {
  adb shell am force-stop "$PACKAGE_ID" || true
  adb shell am start -W -n "$ACTIVITY" | tee "$EVIDENCE_DIR/last-launch.txt"
  wait_for_pid
  sleep 1
}

inject_probe() {
  node "$GITHUB_WORKSPACE/scripts/ring1b_webview_cdp_eval.mjs" \
    --package "$PACKAGE_ID" --script "$EVIDENCE_DIR/m07-browser-probe.js" \
    > "$EVIDENCE_DIR/probe-inject.json"
}

run_expr() {
  local name="$1"
  local file="$EVIDENCE_DIR/${name}.expr.js"
  cat > "$file"
  node "$GITHUB_WORKSPACE/scripts/ring1b_webview_cdp_eval.mjs" \
    --package "$PACKAGE_ID" --expr-file "$file" \
    | tee "$EVIDENCE_DIR/${name}.json"
}

capture_android() {
  local prefix="$1"
  adb exec-out screencap -p > "$EVIDENCE_DIR/${prefix}-screen.png" || true
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb exec-out cat /sdcard/window.xml > "$EVIDENCE_DIR/${prefix}-ui.xml" 2>/dev/null || true
  adb shell dumpsys activity activities > "$EVIDENCE_DIR/${prefix}-activity.txt" || true
  adb logcat -d > "$EVIDENCE_DIR/${prefix}-logcat.txt" || true
}

# Deterministic non-physical TCP sink: accepts but deliberately does not read for a bounded window.
python3 -u - <<'PY' > "$EVIDENCE_DIR/m07-deterministic-sink.log" 2>&1 &
import socket, threading, time
s=socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
s.bind(("0.0.0.0", 19100))
s.listen(8)
print("LISTENING 19100", flush=True)
def hold(conn, addr):
    try:
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        print("ACCEPT", addr, flush=True)
        time.sleep(12)
    finally:
        try: conn.close()
        except Exception: pass
while True:
    conn, addr=s.accept()
    threading.Thread(target=hold,args=(conn,addr),daemon=True).start()
PY
SINK_PID=$!
trap 'kill "$SINK_PID" >/dev/null 2>&1 || true' EXIT
sleep 1

# ---- M07: native print gateway + exact TS timeout semantics ----
launch_app
inject_probe

run_expr m07-endpoint-apply <<'JS'
Ring1BM07.nativeRequest({
  type:'print.lan.endpoint.apply',
  requestId:'m07-endpoint-apply',
  endpointId:'ring1b-sink',
  host:'10.0.2.2',
  port:19100,
  displayName:'Ring1B deterministic sink',
  model:'NON_PHYSICAL',
  capability:'receipt-80mm/kitchen'
}, 'print.lan.endpoint.apply.result', 5000)
JS

run_expr m07-gateway-enqueue <<'JS'
Ring1BM07.nativeRequest({
  type:'print.gateway.enqueue',
  requestId:'m07-gateway-enqueue',
  canonicalPrintJobId:'cpj-ring1b-m07-001',
  dispatchAttemptId:'dispatch-ring1b-m07-gateway-001',
  payloadBase64:'TUYwNw==',
  target:{kind:'LAN',endpointId:'ring1b-sink'}
}, 'print.gateway.enqueue.result', 5000)
JS

run_expr m07-timeout-probe <<'JS'
Ring1BM07.runTimeoutProbe({
  endpointId:'ring1b-sink',
  dispatchAttemptId:'dispatch-ring1b-m07-timeout-001',
  timeoutMs:10,
  payloadBytes:262144
})
JS

node - "$EVIDENCE_DIR/m07-timeout-probe.json" <<'NODE'
const fs=require('fs');
const value=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(value.kind!=='OUTCOME_UNKNOWN' || value.uncertaintyCode!=='LAN_NATIVE_RESULT_TIMEOUT'){
  console.error('R1B_M07_TIMEOUT_CERTAINTY_MISMATCH', value); process.exit(1);
}
console.log('M07_TIMEOUT_OUTCOME_UNKNOWN_GREEN');
NODE

sleep 1
run_expr m07-gateway-snapshot-before-restart <<'JS'
Ring1BM07.nativeRequest({
  type:'print.gateway.snapshot',
  requestId:'m07-snapshot-before-restart'
}, 'print.gateway.snapshot.result', 5000)
JS

node - "$EVIDENCE_DIR/m07-gateway-snapshot-before-restart.json" <<'NODE'
const fs=require('fs');
const value=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const job=value?.value?.lastJob;
if(!job || job.canonicalPrintJobId!=='cpj-ring1b-m07-001' || job.dispatchAttemptId!=='dispatch-ring1b-m07-gateway-001'){
  console.error('R1B_M07_GATEWAY_IDENTITY_READBACK_MISMATCH', value); process.exit(1);
}
if(job?.target?.kind!=='LAN' || job?.target?.endpointId!=='ring1b-sink'){
  console.error('R1B_M07_ROUTE_DEVICE_READBACK_MISMATCH', value); process.exit(1);
}
console.log('M07_GATEWAY_ROUTE_DEVICE_READBACK_GREEN');
NODE
capture_android m07-before-restart

launch_app
inject_probe
run_expr m07-gateway-snapshot-after-restart <<'JS'
Ring1BM07.nativeRequest({
  type:'print.gateway.snapshot',
  requestId:'m07-snapshot-after-restart'
}, 'print.gateway.snapshot.result', 5000)
JS
node - "$EVIDENCE_DIR/m07-gateway-snapshot-after-restart.json" <<'NODE'
const fs=require('fs');
const value=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const job=value?.value?.lastJob;
if(!job || job.canonicalPrintJobId!=='cpj-ring1b-m07-001' || job.dispatchAttemptId!=='dispatch-ring1b-m07-gateway-001'){
  console.error('R1B_M07_RESTART_READBACK_MISMATCH', value); process.exit(1);
}
console.log('M07_RESTART_READBACK_GREEN');
NODE
capture_android m07-after-restart

# Real app-scoped uncaught WebView exception must deterministically RED under #859 guard.
adb logcat -c
run_expr m07-uncaught-injected <<'JS'
(()=>{setTimeout(()=>{throw new Error('RING1B_M07_UNCAUGHT_EXCEPTION_PROBE')},0);return 'scheduled';})()
//# sourceURL=https://appassets.androidplatform.net/baseline/assets/ring1b-m07-uncaught.js
JS
sleep 1
adb logcat -d > "$EVIDENCE_DIR/m07-uncaught-logcat.txt"
set +e
python3 "$GITHUB_WORKSPACE/scripts/ring1b_webview_exception_guard.py" \
  "$EVIDENCE_DIR/m07-uncaught-logcat.txt" --label m07-injected \
  --output-json "$EVIDENCE_DIR/m07-uncaught-guard.json" \
  >"$EVIDENCE_DIR/m07-uncaught-guard.stdout" 2>"$EVIDENCE_DIR/m07-uncaught-guard.stderr"
GUARD_RC=$?
set -e
if [[ "$GUARD_RC" -eq 0 ]] || ! grep -q 'R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION' "$EVIDENCE_DIR/m07-uncaught-guard.stderr"; then
  echo "R1B_M07_UNCAUGHT_EXCEPTION_GUARD_FALSE_GREEN" >&2
  exit 1
fi
echo "M07_WEBVIEW_UNCAUGHT_DETERMINISTIC_RED_GREEN" | tee "$EVIDENCE_DIR/m07-guard-proof.txt"
adb logcat -c
launch_app
inject_probe

# ---- M08: real Store Kernel durable outbox / restart / offline-restore / replay ----
run_expr m08-commit-first <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.commit.v1',
  requestId:'m08-commit-first',
  commandId:'cmd-m08-001',
  storeId:'MF_RING1B_863',
  operationId:'op-m08-001',
  idempotencyKey:'idem-m08-001',
  requestFingerprint:'0000000000000000000000000000000000000000000000000000000000000000',
  result:{probe:'m08',status:'pending'},
  traceId:'trace-m08-001',
  committedAt:'2026-09-19T05:00:00.000Z',
  mutations:[{
    aggregateType:'RING1B_PROBE',
    aggregateId:'m08-continuity',
    expectedRevision:0,
    state:{status:'PENDING'}
  }],
  outbox:[{
    eventId:'m08-event-001',
    aggregateType:'RING1B_PROBE',
    aggregateId:'m08-continuity',
    aggregateRevision:1,
    eventType:'RING1B_OUTBOX_PROBE',
    occurredAt:'2026-09-19T05:00:00.000Z',
    payload:{probe:'m08'}
  }]
}, 'store.kernel.commit.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-commit-first.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(v.type!=='store.kernel.commit.completed.v1'||v.status!=='committed'||v.replayed!==false){
  console.error('R1B_M08_COMMIT_NOT_DURABLE',v); process.exit(1);
}
console.log('M08_DURABLE_COMMIT_GREEN');
NODE

run_expr m08-outbox-before <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.outbox.snapshot.v1',
  requestId:'m08-outbox-before',
  storeId:'MF_RING1B_863',
  limit:10
}, 'store.kernel.outbox.snapshot.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-outbox-before.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const item=v?.items?.find(x=>x.eventId==='m08-event-001');
if(!item || item.status!=='PENDING' || item.attemptCount!==0 || item.leaseOwner!==null || item.acknowledgedAt!==null){
  console.error('R1B_M08_OUTBOX_SNAPSHOT_MUTATED_OR_MISSING',v); process.exit(1);
}
console.log('M08_OUTBOX_READONLY_SNAPSHOT_GREEN');
NODE
capture_android m08-before-offline

# Enter a deterministic device-offline mode without touching Store Kernel state.
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1 || true
adb shell settings put global airplane_mode_on 1 || true
adb shell svc wifi disable || true
adb shell svc data disable || true
adb shell dumpsys connectivity > "$EVIDENCE_DIR/m08-network-offline.txt" || true
adb shell settings get global airplane_mode_on >> "$EVIDENCE_DIR/m08-network-offline.txt" || true

launch_app
inject_probe
run_expr m08-outbox-offline-restart <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.outbox.snapshot.v1',
  requestId:'m08-outbox-offline-restart',
  storeId:'MF_RING1B_863',
  limit:10
}, 'store.kernel.outbox.snapshot.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-outbox-offline-restart.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const item=v?.items?.find(x=>x.eventId==='m08-event-001');
if(!item || item.status!=='PENDING' || item.attemptCount!==0 || item.leaseOwner!==null || item.acknowledgedAt!==null){
  console.error('R1B_M08_OFFLINE_RESTART_CONTINUITY_MISMATCH',v); process.exit(1);
}
console.log('M08_OFFLINE_RESTART_CONTINUITY_GREEN');
NODE
capture_android m08-offline-restart

# Restore network, then exact replay with unchanged operation/idempotency identity.
adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
adb shell settings put global airplane_mode_on 0 || true
adb shell svc wifi enable || true
adb shell svc data enable || true
sleep 3
adb shell dumpsys connectivity > "$EVIDENCE_DIR/m08-network-restored.txt" || true
adb shell settings get global airplane_mode_on >> "$EVIDENCE_DIR/m08-network-restored.txt" || true

run_expr m08-commit-replay <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.commit.v1',
  requestId:'m08-commit-replay',
  commandId:'cmd-m08-001',
  storeId:'MF_RING1B_863',
  operationId:'op-m08-001',
  idempotencyKey:'idem-m08-001',
  requestFingerprint:'0000000000000000000000000000000000000000000000000000000000000000',
  result:{probe:'m08',status:'pending'},
  traceId:'trace-m08-001',
  committedAt:'2026-09-19T05:00:00.000Z',
  mutations:[{
    aggregateType:'RING1B_PROBE',
    aggregateId:'m08-continuity',
    expectedRevision:0,
    state:{status:'PENDING'}
  }],
  outbox:[{
    eventId:'m08-event-001',
    aggregateType:'RING1B_PROBE',
    aggregateId:'m08-continuity',
    aggregateRevision:1,
    eventType:'RING1B_OUTBOX_PROBE',
    occurredAt:'2026-09-19T05:00:00.000Z',
    payload:{probe:'m08'}
  }]
}, 'store.kernel.commit.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-commit-replay.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(v.type!=='store.kernel.commit.completed.v1'||v.status!=='committed'||v.replayed!==true){
  console.error('R1B_M08_IDEMPOTENT_REPLAY_MISMATCH',v); process.exit(1);
}
console.log('M08_IDEMPOTENT_REPLAY_GREEN');
NODE

run_expr m08-command-receipt <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.command.receipt.read.v1',
  requestId:'m08-command-receipt',
  storeId:'MF_RING1B_863',
  operationId:'op-m08-001',
  idempotencyKey:'idem-m08-001',
  requestFingerprint:'0000000000000000000000000000000000000000000000000000000000000000'
}, 'store.kernel.command.receipt.read.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-command-receipt.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(v.type!=='store.kernel.command.receipt.read.completed.v1'||v.status!=='ok'||v.found!==true||v.commandId!=='cmd-m08-001'){
  console.error('R1B_M08_RECEIPT_READBACK_MISMATCH',v); process.exit(1);
}
console.log('M08_COMMAND_RECEIPT_READBACK_GREEN');
NODE

run_expr m08-outbox-after-restore <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.outbox.snapshot.v1',
  requestId:'m08-outbox-after-restore',
  storeId:'MF_RING1B_863',
  limit:10
}, 'store.kernel.outbox.snapshot.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-outbox-before.json" "$EVIDENCE_DIR/m08-outbox-after-restore.json" <<'NODE'
const fs=require('fs');
const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const after=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const b=before?.items?.find(x=>x.eventId==='m08-event-001');
const a=after?.items?.find(x=>x.eventId==='m08-event-001');
if(!b||!a||a.eventId!==b.eventId||a.payloadHash!==b.payloadHash||a.status!=='PENDING'||a.attemptCount!==0||a.leaseOwner!==null||a.acknowledgedAt!==null){
  console.error('R1B_M08_RESTORE_IDENTITY_OR_READONLY_MISMATCH',{before:b,after:a}); process.exit(1);
}
console.log('M08_RESTORE_IDENTITY_CONTINUITY_GREEN');
NODE

# Deterministic RED: invalid snapshot request must fail closed.
run_expr m08-invalid-snapshot-red <<'JS'
Ring1BM07.nativeRequest({
  protocolVersion:1,
  type:'store.kernel.outbox.snapshot.v1',
  requestId:'m08-invalid-snapshot-red',
  storeId:'MF_RING1B_863',
  limit:0
}, 'store.kernel.outbox.snapshot.completed.v1', 5000)
JS
node - "$EVIDENCE_DIR/m08-invalid-snapshot-red.json" <<'NODE'
const fs=require('fs'); const v=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(v.type!=='store.kernel.error.v1'||v.status!=='failed'||v.errorCode!=='STORE_KERNEL_OUTBOX_SNAPSHOT_LIMIT_INVALID'){
  console.error('R1B_M08_DETERMINISTIC_RED_MISMATCH',v); process.exit(1);
}
console.log('M08_DETERMINISTIC_RED_GREEN');
NODE

capture_android m08-final
cat > "$EVIDENCE_DIR/m07-m08-reality-summary.txt" <<EOF
source_sha=$SOURCE_SHA
M07_TIMEOUT=OUTCOME_UNKNOWN/LAN_NATIVE_RESULT_TIMEOUT
M07_GATEWAY=canonicalPrintJobId+dispatchAttemptId+route/device persisted
M07_RESTART=readback preserved
M07_WEBVIEW_EXCEPTION_GUARD=R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION deterministic RED
M08_OUTBOX=PENDING read-only snapshot
M08_RESTART_OFFLINE=preserved
M08_NETWORK=offline->restore exercised
M08_REPLAY=idempotent replayed=true
M08_RECEIPT=found=true
M08_INVALID_SNAPSHOT=STORE_KERNEL_OUTBOX_SNAPSHOT_LIMIT_INVALID
PHYSICAL_STATUS=PHYSICAL_PENDING
EOF

echo "POSPAL_M07_M08_ANDROID_REALITY_GREEN"
