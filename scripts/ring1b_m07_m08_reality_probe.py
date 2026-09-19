#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

EVIDENCE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
APK = Path(sys.argv[2]) if len(sys.argv) > 2 else None
SOURCE_SHA = sys.argv[3].strip().lower() if len(sys.argv) > 3 else ""
EXACT_PRINT_TRANSPORT_JS = Path(sys.argv[4]) if len(sys.argv) > 4 else None
if (
    EVIDENCE is None
    or APK is None
    or not re.fullmatch(r"[0-9a-f]{40}", SOURCE_SHA)
    or EXACT_PRINT_TRANSPORT_JS is None
    or not EXACT_PRINT_TRANSPORT_JS.is_file()
):
    raise SystemExit("R1B_REALITY_ARGS_REQUIRED")
EVIDENCE.mkdir(parents=True, exist_ok=True)

PACKAGE = "com.morefunos.smt"
ACTIVITY = ".MainActivity"
ADAPTER_PORT = 39107
ENDPOINT = "r1b-m07-adapter"
CANONICAL_JOB = "r1b-m07-print-job-863"
ATTEMPT = "r1b-m07-attempt-863"
last_green = "NONE"

def run(args, check=True, binary=False):
    return subprocess.run(args, check=check, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=not binary, timeout=30)

def adb(*args, check=True, binary=False):
    return run(["adb", *args], check=check, binary=binary)

def shell(command, check=True):
    return adb("shell", command, check=check).stdout

def write_json(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def write_text(name, value):
    (EVIDENCE / name).write_text(str(value), encoding="utf-8")

def fail(code, detail):
    write_json("diagnostic.json", {
        "result": "RED", "code": code, "detail": detail,
        "lastGreen": last_green, "firstBreak": code,
    })
    print("CODE=" + code, file=sys.stderr)
    print("ACTUAL=" + detail, file=sys.stderr)
    raise SystemExit(1)

def require(condition, code, detail):
    if not condition:
        fail(code, detail)

def green(name):
    global last_green
    last_green = name
    print("GREEN=" + name)

def capture(label):
    dest = EVIDENCE / label
    dest.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/" + re.sub(r"[^A-Za-z0-9_.-]+", "_", label) + ".xml"
    adb("shell", "uiautomator dump " + remote, check=False)
    xml = adb("exec-out", "cat", remote, check=False).stdout
    (dest / "ui.xml").write_text(xml, encoding="utf-8", errors="replace")
    (dest / "activity.txt").write_text(shell("dumpsys activity activities", check=False), encoding="utf-8")
    pid = shell("pidof " + PACKAGE, check=False).strip().split()
    log_args = ["logcat", "-d", "-v", "threadtime"] + (["--pid=" + pid[0]] if pid else [])
    (dest / "app-logcat.txt").write_text(adb(*log_args, check=False).stdout, encoding="utf-8", errors="replace")
    png = adb("exec-out", "screencap", "-p", check=False, binary=True).stdout
    (dest / "screen.png").write_bytes(png)

class Ws:
    def __init__(self, url):
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            "GET " + (u.path or "/") + ("?" + u.query if u.query else "") + " HTTP/1.1\r\n"
            "Host: " + u.hostname + ":" + str(u.port) + "\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key +
            "\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(4096)
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("CDP_WEBSOCKET_UPGRADE_FAILED:" + response[:200].decode(errors="replace"))

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

    def send_text(self, text):
        payload = text.encode()
        first = 0x81
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = bytes([first, 0x80 | n])
        elif n < 65536:
            header = bytes([first, 0x80 | 126]) + struct.pack("!H", n)
        else:
            header = bytes([first, 0x80 | 127]) + struct.pack("!Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _read_exact(self, n):
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise EOFError("CDP_WEBSOCKET_CLOSED")
            data += chunk
        return data

    def recv_text(self):
        while True:
            h = self._read_exact(2)
            opcode = h[0] & 0x0F
            n = h[1] & 0x7F
            masked = bool(h[1] & 0x80)
            if n == 126:
                n = struct.unpack("!H", self._read_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else None
            data = self._read_exact(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 8:
                raise EOFError("CDP_WEBSOCKET_CLOSE")
            if opcode == 9:
                continue
            if opcode == 1:
                return data.decode()

class Cdp:
    def __init__(self, url):
        self.ws = Ws(url)
        self.seq = 0
        self.call("Runtime.enable")

    def close(self):
        self.ws.close()

    def call(self, method, params=None):
        self.seq += 1
        ident = self.seq
        self.ws.send_text(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv_text())
            if message.get("id") != ident:
                continue
            if "error" in message:
                raise RuntimeError("CDP_CALL_ERROR:" + json.dumps(message["error"]))
            return message.get("result", {})

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", {
            "expression": expression, "awaitPromise": True,
            "returnByValue": True, "userGesture": True,
        })
        if result.get("exceptionDetails"):
            raise RuntimeError("CDP_EVAL_EXCEPTION:" + json.dumps(result["exceptionDetails"]))
        return result.get("result", {}).get("value")

def connect_cdp():
    socket_name = None
    for _ in range(60):
        unix = shell("cat /proc/net/unix", check=False)
        matches = re.findall(r"@?(webview_devtools_remote(?:_[0-9]+)?)", unix)
        if matches:
            socket_name = matches[-1]
            break
        time.sleep(0.5)
    require(bool(socket_name), "R1B_CDP_WEBVIEW_SOCKET_NOT_FOUND", "no debuggable WebView socket")
    adb("forward", "tcp:9223", "localabstract:" + socket_name)
    targets = []
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:9223/json/list", timeout=2) as response:
                targets = json.loads(response.read().decode())
            if targets:
                break
        except Exception:
            pass
        time.sleep(0.3)
    target = next((x for x in targets if "appassets.androidplatform.net" in str(x.get("url", ""))), targets[0] if targets else None)
    require(bool(target and target.get("webSocketDebuggerUrl")), "R1B_CDP_TARGET_NOT_FOUND", json.dumps(targets))
    return Cdp(target["webSocketDebuggerUrl"])

def bridge_request(cdp, request, terminal_types, timeout_ms=12000):
    req = json.dumps(request, separators=(",", ":"))
    terminals = json.dumps(terminal_types)
    expression = (
        "(async()=>{const req=" + req + ";const terminal=new Set(" + terminals + ");"
        "const events=[];const bridge=globalThis.moreFunNative;"
        "if(!bridge)return {ok:false,code:'R1B_NATIVE_BRIDGE_UNAVAILABLE',events};"
        "return await new Promise(resolve=>{let done=false;let timer;"
        "const finish=v=>{if(done)return;done=true;clearTimeout(timer);"
        "try{bridge.removeEventListener?.('message',on)}catch{};"
        "try{globalThis.removeEventListener?.('message',on)}catch{};resolve(v)};"
        "const on=e=>{const raw=e?.data;let p;try{p=typeof raw==='string'?JSON.parse(raw):raw}catch{return};"
        "if(!p||p.requestId!==req.requestId)return;events.push(p);"
        "if(p.type==='carrier.error'||p.type==='store.kernel.error.v1'||terminal.has(p.type))"
        "finish({ok:true,events,last:p})};"
        "try{bridge.addEventListener?.('message',on);globalThis.addEventListener?.('message',on);"
        "bridge.postMessage(JSON.stringify(req))}catch(error){finish({ok:false,code:'R1B_NATIVE_BRIDGE_POST_FAILED',error:String(error),events});return};"
        "timer=setTimeout(()=>finish({ok:false,code:'R1B_NATIVE_BRIDGE_RESPONSE_TIMEOUT',events})," + str(timeout_ms) + ")})})()"
    )
    result = cdp.evaluate(expression)
    write_json("bridge-" + request["requestId"] + ".json", result)
    return result

def wait_gateway_snapshot(cdp, request_id, attempt_id, expected_state=None, timeout_s=10):
    deadline = time.time() + timeout_s
    count = 0
    last = None
    while time.time() < deadline:
        count += 1
        rid = request_id + "-" + str(count)
        last = bridge_request(cdp, {"type": "print.gateway.snapshot", "requestId": rid},
                              ["print.gateway.snapshot.result"], 3000)
        job = ((last or {}).get("last") or {}).get("value", {}).get("lastJob")
        if job and job.get("dispatchAttemptId") == attempt_id and (expected_state is None or job.get("state") == expected_state):
            return last
        time.sleep(0.25)
    return last

def find_outbox(result, event_id):
    items = ((result or {}).get("last") or {}).get("items")
    if not isinstance(items, list):
        return None
    return next((x for x in items if x.get("eventId") == event_id), None)

class AdapterServer:
    def __init__(self):
        self.received = []
        self.stop = threading.Event()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("0.0.0.0", ADAPTER_PORT))
        self.sock.listen(4)
        self.sock.settimeout(0.5)
        self.thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self.thread.start()

    def run(self):
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except socket.timeout:
                continue
            with conn:
                chunks = []
                while True:
                    data = conn.recv(65536)
                    if not data:
                        break
                    chunks.append(data)
                payload = b"".join(chunks)
                self.received.append(payload)
                write_text("adapter-payload-" + str(len(self.received)) + ".hex", payload.hex() + "\n")

    def close(self):
        self.stop.set()
        try:
            self.sock.close()
        except Exception:
            pass

apk_sha256 = hashlib.sha256(APK.read_bytes()).hexdigest()
write_text("apk-sha256.txt", apk_sha256 + "\n")
print("APK_SHA256=" + apk_sha256)
adapter = AdapterServer()
adapter.start()

cdp = connect_cdp()
env = cdp.evaluate("({href:location.href,bridge:typeof globalThis.moreFunNative,canonicalSource:Boolean(globalThis.__MORE_FUN_OS_SMT_CANONICAL_SOURCE__),ua:navigator.userAgent})")
write_json("runtime-environment.json", env)
require(env and env.get("bridge") == "object", "R1B_NATIVE_BRIDGE_UNAVAILABLE", json.dumps(env))
green("RING1B_NATIVE_BRIDGE_READY")
capture("m07-00-bridge-ready")

apply_result = bridge_request(cdp, {
    "type": "print.lan.endpoint.apply", "requestId": "m07-endpoint-apply-863",
    "endpointId": ENDPOINT, "host": "10.0.2.2", "port": ADAPTER_PORT,
    "displayName": "Ring1B deterministic adapter", "model": "RING1B_TEST_ONLY",
    "capability": "receipt-80mm/kitchen",
}, ["print.lan.endpoint.apply.result"])
require((apply_result.get("last") or {}).get("status") == "success",
        "M07_ENDPOINT_APPLY_FAILED", json.dumps(apply_result))
green("M07_ENDPOINT_PERSISTED")

# Execute the exact product transport module inside the API30 WebView.  The
# native dispatch is allowed to continue after this deliberately tiny callback
# wait expires; that post-dispatch uncertainty must stay OUTCOME_UNKNOWN.
exact_print_transport_js = EXACT_PRINT_TRANSPORT_JS.read_text(encoding="utf-8")
cdp.evaluate(exact_print_transport_js + "\ntrue")
adapter_count_before_timeout = len(adapter.received)
timeout_probe = cdp.evaluate(
    "(async()=>{"
    "const m=globalThis.__R1B_EXACT_PRINT_TRANSPORT__;"
    "if(!m||typeof m.TrustedAndroidPrintBridge!=='function'||typeof m.AndroidNativeIpSocketTransport!=='function')"
    "return {kind:'MODULE_MISSING'};"
    "const trusted=new m.TrustedAndroidPrintBridge({port:globalThis.moreFunNative,windowEvents:window,timeoutMs:1});"
    "const transport=new m.AndroidNativeIpSocketTransport(trusted);"
    "const payload=new Uint8Array(20);payload.fill(65);"
    "return await transport.send({"
    "endpoint:{endpointId:'r1b-m07-adapter',host:'10.0.2.2',port:39107,enabled:true},"
    "payload,dispatchAttemptId:'r1b-m07-timeout-attempt-863'"
    "});"
    "})()"
)
write_json("m07-exact-transport-timeout.json", timeout_probe)
require(
    timeout_probe
    and timeout_probe.get("kind") == "OUTCOME_UNKNOWN"
    and timeout_probe.get("uncertaintyCode") == "LAN_NATIVE_RESULT_TIMEOUT",
    "M07_CALLBACK_TIMEOUT_CERTAINTY_MISMATCH",
    json.dumps(timeout_probe),
)
for _ in range(70):
    if len(adapter.received) > adapter_count_before_timeout:
        break
    time.sleep(0.1)
require(
    len(adapter.received) > adapter_count_before_timeout,
    "M07_CALLBACK_TIMEOUT_DISPATCH_NOT_OBSERVED",
    "exact transport timed out but deterministic adapter never received the dispatched payload",
)
green("M07_CALLBACK_TIMEOUT_OUTCOME_UNKNOWN")

dispatch = bridge_request(cdp, {
    "type": "print.gateway.enqueue", "requestId": "m07-gateway-enqueue-863",
    "canonicalPrintJobId": CANONICAL_JOB, "dispatchAttemptId": ATTEMPT,
    "target": {"kind": "LAN", "endpointId": ENDPOINT},
    "payloadBase64": base64.b64encode(b"MOREFUN-R1B-M07-863\n").decode(),
}, ["print.lan.dispatch.completed"], 12000)
events = dispatch.get("events") or []
accepted = any(x.get("type") == "print.gateway.enqueue.result" and x.get("status") == "accepted" and x.get("state") == "DISPATCHING" for x in events)
terminal = next((x for x in events if x.get("type") == "print.lan.dispatch.completed"), None)
require(accepted, "M07_GATEWAY_DISPATCH_NOT_ACCEPTED", json.dumps(dispatch))
require(terminal and terminal.get("outcome") != "REJECTED_BEFORE_SEND",
        "M07_POST_DISPATCH_MISCLASSIFIED_BEFORE_SEND", json.dumps(dispatch))
require(terminal.get("outcome") in ("WRITE_COMPLETED_NO_DEVICE_ACK", "OUTCOME_UNKNOWN"),
        "M07_POST_DISPATCH_CERTAINTY_INVALID", json.dumps(terminal))
for _ in range(20):
    if adapter.received:
        break
    time.sleep(0.1)
require(bool(adapter.received), "M07_DETERMINISTIC_ADAPTER_DID_NOT_RECEIVE", "host adapter received no bytes")
write_json("m07-dispatch-sequence.json", dispatch)
green("M07_NATIVE_GATEWAY_DISPATCH_ACCEPTED")

snap = wait_gateway_snapshot(cdp, "m07-snapshot-863", ATTEMPT, "AMBIGUOUS_AFTER_SEND")
job = ((snap or {}).get("last") or {}).get("value", {}).get("lastJob")
require(job and job.get("canonicalPrintJobId") == CANONICAL_JOB,
        "M07_GATEWAY_CANONICAL_JOB_READBACK_MISMATCH", json.dumps(job))
require(job.get("dispatchAttemptId") == ATTEMPT,
        "M07_GATEWAY_ATTEMPT_READBACK_MISMATCH", json.dumps(job))
require(job.get("target", {}).get("kind") == "LAN" and job.get("target", {}).get("endpointId") == ENDPOINT,
        "M07_GATEWAY_ROUTE_DEVICE_READBACK_MISMATCH", json.dumps(job))
require(job.get("state") == "AMBIGUOUS_AFTER_SEND",
        "M07_GATEWAY_CERTAINTY_NOT_UNKNOWN", json.dumps(job))
require(job.get("state") != "FAILED_BEFORE_SEND",
        "M07_POST_DISPATCH_BECAME_REJECTED_BEFORE_SEND", json.dumps(job))
write_json("m07-gateway-snapshot-before-restart.json", snap)
green("M07_GATEWAY_SNAPSHOT_UNKNOWN")
capture("m07-01-dispatched-unknown")

runtime_executor = cdp.evaluate(
    "(async()=>{const ex=globalThis.__MORE_FUN_OS_SMT_CANONICAL_SOURCE__?.nativePrint?.executor;"
    "if(!ex||typeof ex.dispatch!=='function')return {available:false};"
    "try{const out=await ex.dispatch({printJobId:'r1b-runtime-job-863',dispatchAttemptId:'r1b-runtime-attempt-863',"
    "printerId:'r1b',routeKey:'receipt.front',renderedDocument:{printOutputId:'r1b-out',outputType:'RECEIPT',"
    "templateRevisionId:'r1b-tpl',templateLayoutRevision:1,routeKeys:['receipt.front'],copyCount:1,"
    "languageResolution:{mode:'STORE_PRIMARY_ONLY',resolvedLocales:['zh-HK']},"
    "elements:[{kind:'TEXT',elementId:'e1',text:'R1B',emphasis:'STRONG',alignment:'CENTER'}]}});"
    "return {available:true,out}}catch(error){return {available:true,error:String(error)}}})()"
)
write_json("m07-production-executor-attempt.json", runtime_executor)

cdp.close()
shell("am force-stop " + PACKAGE)
time.sleep(0.8)
shell("am start -W -n " + PACKAGE + "/" + ACTIVITY)
time.sleep(2.5)
cdp = connect_cdp()
snap_restart = wait_gateway_snapshot(cdp, "m07-restart-snapshot-863", ATTEMPT, None, 6)
restart_job = ((snap_restart or {}).get("last") or {}).get("value", {}).get("lastJob")
require(restart_job and restart_job.get("canonicalPrintJobId") == CANONICAL_JOB and restart_job.get("dispatchAttemptId") == ATTEMPT,
        "M07_RESTART_READBACK_MISMATCH", json.dumps(restart_job))
require(restart_job.get("state") == "AMBIGUOUS_AFTER_SEND",
        "M07_RESTART_CERTAINTY_MISMATCH", json.dumps(restart_job))
write_json("m07-gateway-snapshot-after-restart.json", snap_restart)
green("M07_RESTART_READBACK_GREEN")
capture("m07-02-restart-readback")

bad_print = bridge_request(cdp, {
    "type": "print.gateway.enqueue", "requestId": "m07-red-missing-canonical-863",
    "canonicalPrintJobId": "", "dispatchAttemptId": "r1b-bad-attempt",
    "target": {"kind": "LAN", "endpointId": ENDPOINT},
    "payloadBase64": base64.b64encode(b"bad").decode(),
}, ["carrier.error"])
bad_last = bad_print.get("last") or {}
require(bad_last.get("type") == "carrier.error" and bad_last.get("outcome") == "REJECTED_BEFORE_SEND"
        and bad_last.get("failureCode") == "PRINT_GATEWAY_CANONICAL_JOB_REQUIRED",
        "M07_DETERMINISTIC_RED_MISSING", json.dumps(bad_print))
green("M07_DETERMINISTIC_RED_PROVEN")

# Real API30 app-scoped uncaught WebView exception: #859 guard must classify
# this as deterministic RED even though the Android process may stay alive.
adb("logcat", "-c", check=False)
uncaught_probe = cdp.evaluate(
    "(()=>{setTimeout(()=>{throw new Error('RING1B_M07_UNCAUGHT_EXCEPTION_PROBE')},0);"
    "return 'scheduled';})()\n"
    "//# sourceURL=https://appassets.androidplatform.net/baseline/assets/ring1b-m07-uncaught.js"
)
write_json("m07-uncaught-injection.json", {"result": uncaught_probe})
time.sleep(1.0)
uncaught_log_path = EVIDENCE / "m07-uncaught-logcat.txt"
write_text("m07-uncaught-logcat.txt", adb("logcat", "-d", "-v", "threadtime", check=False).stdout)
workspace = Path(os.environ.get("GITHUB_WORKSPACE", ""))
guard_script = workspace / "scripts" / "ring1b_webview_exception_guard.py"
guard_json_path = EVIDENCE / "m07-uncaught-guard.json"
guard = run([
    sys.executable,
    str(guard_script),
    str(uncaught_log_path),
    "--label",
    "m07-api30-injected",
    "--output-json",
    str(guard_json_path),
], check=False)
write_text("m07-uncaught-guard.stdout", guard.stdout)
write_text("m07-uncaught-guard.stderr", guard.stderr)
require(
    guard.returncode != 0 and "R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION" in guard.stderr,
    "M07_WEBVIEW_EXCEPTION_GUARD_FALSE_GREEN",
    json.dumps({"returncode": guard.returncode, "stderr": guard.stderr[-4000:]}),
)
green("M07_WEBVIEW_UNCAUGHT_DETERMINISTIC_RED")
capture("m07-03-webview-exception-red")
adb("logcat", "-c", check=False)

ts = "2026-09-19T04:55:00.000Z"
event_id = "r1b-m08-event-863"
commit_base = {
    "protocolVersion": 1, "type": "store.kernel.commit.v1", "requestId": "m08-commit-863",
    "commandId": "r1b-m08-command-863", "storeId": "r1b-store-863", "operationId": "ORDER_ACCEPT",
    "idempotencyKey": "r1b-m08-idempotency-863", "requestFingerprint": "a" * 64,
    "result": {"orderId": "r1b-order-863", "status": "ACCEPTED"},
    "traceId": "r1b-m08-trace-863", "committedAt": ts,
    "mutations": [{"aggregateType": "ORDER", "aggregateId": "r1b-order-863",
                   "expectedRevision": 0, "state": {"status": "ACCEPTED"}}],
    "outbox": [{"eventId": event_id, "aggregateType": "ORDER", "aggregateId": "r1b-order-863",
                "aggregateRevision": 1, "eventType": "ORDER_ACCEPTED", "occurredAt": ts,
                "payload": {"orderId": "r1b-order-863"}}],
}
commit = bridge_request(cdp, commit_base, ["store.kernel.commit.completed.v1"])
commit_last = commit.get("last") or {}
require(commit_last.get("type") == "store.kernel.commit.completed.v1" and commit_last.get("status") == "committed"
        and commit_last.get("replayed") is False, "M08_STORE_COMMIT_FAILED", json.dumps(commit))
green("M08_DURABLE_OUTBOX_CREATED")

def read_outbox(cdp_obj, rid):
    return bridge_request(cdp_obj, {
        "protocolVersion": 1, "type": "store.kernel.outbox.snapshot.v1",
        "requestId": rid, "storeId": "r1b-store-863", "limit": 100,
    }, ["store.kernel.outbox.snapshot.completed.v1"])

outbox = read_outbox(cdp, "m08-snapshot-before-restart-863")
item = find_outbox(outbox, event_id)
require(item and item.get("status") == "PENDING" and item.get("attemptCount") == 0
        and item.get("leaseOwner") is None and item.get("acknowledgedAt") is None,
        "M08_SNAPSHOT_MUTATED_CUSTODY", json.dumps(item))
write_json("m08-outbox-before-restart.json", outbox)
green("M08_OUTBOX_SNAPSHOT_READONLY")
capture("m08-01-pending-before-restart")

cdp.close()
shell("am force-stop " + PACKAGE)
time.sleep(0.8)
shell("am start -W -n " + PACKAGE + "/" + ACTIVITY)
time.sleep(2.5)
cdp = connect_cdp()
outbox = read_outbox(cdp, "m08-snapshot-after-restart-863")
item = find_outbox(outbox, event_id)
require(item and item.get("status") == "PENDING" and item.get("attemptCount") == 0
        and item.get("leaseOwner") is None and item.get("acknowledgedAt") is None,
        "M08_RESTART_OUTBOX_PERSISTENCE_MISMATCH", json.dumps(item))
write_json("m08-outbox-after-restart.json", outbox)
green("M08_RESTART_PENDING_READBACK")
capture("m08-02-after-restart")

shell("svc wifi disable", check=False)
shell("svc data disable", check=False)
shell("settings put global airplane_mode_on 1", check=False)
shell("am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true", check=False)
time.sleep(1.2)
write_text("m08-network-offline.txt", shell("dumpsys connectivity", check=False))
outbox = read_outbox(cdp, "m08-snapshot-offline-863")
item = find_outbox(outbox, event_id)
require(item and item.get("status") == "PENDING" and item.get("attemptCount") == 0 and item.get("leaseOwner") is None,
        "M08_OFFLINE_CONTINUITY_FAILED", json.dumps(item))
write_json("m08-outbox-offline.json", outbox)
green("M08_OFFLINE_CONTINUITY_GREEN")
capture("m08-03-offline")

shell("settings put global airplane_mode_on 0", check=False)
shell("am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false", check=False)
shell("svc wifi enable", check=False)
shell("svc data enable", check=False)
time.sleep(1.8)
write_text("m08-network-restored.txt", shell("dumpsys connectivity", check=False))

replay_request = dict(commit_base)
replay_request["requestId"] = "m08-commit-replay-863"
replay = bridge_request(cdp, replay_request, ["store.kernel.commit.completed.v1"])
replay_last = replay.get("last") or {}
require(replay_last.get("type") == "store.kernel.commit.completed.v1" and replay_last.get("status") == "committed"
        and replay_last.get("replayed") is True,
        "M08_DUPLICATE_RETRY_IDENTITY_NOT_REPLAYED", json.dumps(replay))
outbox = read_outbox(cdp, "m08-snapshot-after-restore-863")
items = ((outbox or {}).get("last") or {}).get("items") or []
matches = [x for x in items if x.get("eventId") == event_id]
require(len(matches) == 1, "M08_DUPLICATE_OUTBOX_EFFECT", json.dumps(matches))
item = matches[0]
require(item.get("status") == "PENDING" and item.get("attemptCount") == 0
        and item.get("leaseOwner") is None and item.get("acknowledgedAt") is None,
        "M08_RESTORE_SNAPSHOT_MUTATED_CUSTODY", json.dumps(item))
write_json("m08-replay-result.json", replay)
write_json("m08-outbox-after-restore.json", outbox)
green("M08_REPLAY_RECONCILE_IDENTITY_GREEN")
capture("m08-04-restored-replayed")

bad_snapshot = bridge_request(cdp, {
    "protocolVersion": 1, "type": "store.kernel.outbox.snapshot.v1",
    "requestId": "m08-red-invalid-limit-863", "storeId": "r1b-store-863", "limit": 0,
}, ["store.kernel.error.v1"])
bad_snapshot_last = bad_snapshot.get("last") or {}
require(bad_snapshot_last.get("type") == "store.kernel.error.v1"
        and bad_snapshot_last.get("errorCode") == "STORE_KERNEL_OUTBOX_SNAPSHOT_LIMIT_INVALID",
        "M08_DETERMINISTIC_RED_MISSING", json.dumps(bad_snapshot))
green("M08_DETERMINISTIC_RED_PROVEN")
capture("m08-05-final")

cdp.close()
adapter.close()

write_json("result.json", {
    "result": "GREEN",
    "sourceSha": SOURCE_SHA,
    "apkSha256": apk_sha256,
    "m07": {
        "nativeGateway": True,
        "deterministicAdapterBytes": sum(len(x) for x in adapter.received),
        "canonicalPrintJobId": CANONICAL_JOB,
        "dispatchAttemptId": ATTEMPT,
        "route": {"kind": "LAN", "endpointId": ENDPOINT},
        "state": restart_job.get("state"),
        "stage": restart_job.get("lastStage"),
        "code": restart_job.get("lastCode"),
        "postDispatchOutcome": terminal.get("outcome"),
        "callbackTimeoutOutcome": timeout_probe,
        "webViewExceptionGuardCode": "R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION",
        "productionExecutorAttempt": runtime_executor,
        "physicalStatus": "PHYSICAL_PENDING",
    },
    "m08": {
        "eventId": event_id, "status": item.get("status"), "attemptCount": item.get("attemptCount"),
        "leaseOwner": item.get("leaseOwner"), "acknowledgedAt": item.get("acknowledgedAt"),
        "restartPreserved": True, "offlineReadback": True, "restoreReadback": True,
        "replayed": True, "duplicateCount": len(matches),
    },
    "lastGreen": "M08_DETERMINISTIC_RED_PROVEN",
    "firstBreak": None,
})
print("POSPAL_M07_M08_ANDROID_REALITY_GREEN")
