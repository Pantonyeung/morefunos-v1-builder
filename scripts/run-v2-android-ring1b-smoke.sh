#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path required}"
SOURCE_SHA="${2:?source SHA required}"
EVIDENCE_DIR="${3:-$GITHUB_WORKSPACE/ring1b-evidence}"
PACKAGE_ID="com.morefunos.smt"
MAIN_ACTIVITY=".MainActivity"

mkdir -p "$EVIDENCE_DIR"
RESULT="FAIL"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

capture_common() {
  adb devices -l > "$EVIDENCE_DIR/adb-devices.txt" 2>&1 || true
  adb shell getprop > "$EVIDENCE_DIR/getprop.txt" 2>&1 || true
  adb shell dumpsys package "$PACKAGE_ID" > "$EVIDENCE_DIR/package-dumpsys.txt" 2>&1 || true
  adb shell dumpsys activity activities > "$EVIDENCE_DIR/activity-dumpsys.txt" 2>&1 || true
  adb shell dumpsys meminfo "$PACKAGE_ID" > "$EVIDENCE_DIR/meminfo.txt" 2>&1 || true
  adb exec-out screencap -p > "$EVIDENCE_DIR/screen-final.png" 2>/dev/null || true
  adb shell uiautomator dump /sdcard/morefun-window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/morefun-window.xml "$EVIDENCE_DIR/window.xml" >/dev/null 2>&1 || true
  adb logcat -d -v threadtime > "$EVIDENCE_DIR/logcat-final.txt" 2>&1 || true
  adb shell run-as "$PACKAGE_ID" sh -c 'for d in files shared_prefs databases; do [ -d "$d" ] && find "$d" -maxdepth 2 -type f -print; done'     > "$EVIDENCE_DIR/app-private-file-list.txt" 2>&1 || true
}

finish() {
  code=$?
  capture_common
  if [ "$code" -eq 0 ]; then RESULT="PASS"; fi
  {
    echo "ring=RING_1B_ANDROID_EMULATOR"
    echo "result=$RESULT"
    echo "source_sha=$SOURCE_SHA"
    echo "package_id=$PACKAGE_ID"
    echo "main_activity=$MAIN_ACTIVITY"
    echo "android_sdk=$(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || true)"
    echo "android_release=$(adb shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' || true)"
    echo "abi=$(adb shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || true)"
    echo "started_at=$STARTED_AT"
    echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$EVIDENCE_DIR/summary.txt"
  exit "$code"
}
trap finish EXIT

test -s "$APK_PATH"
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done' >/dev/null 2>&1 || true

# Match the SMT bench orientation. No visual inspection is required for this headless ring.
adb shell settings put system accelerometer_rotation 0 || true
adb shell settings put system user_rotation 1 || true

adb install -r "$APK_PATH" | tee "$EVIDENCE_DIR/install.txt"
adb shell dumpsys package "$PACKAGE_ID" | grep -E 'versionName=|versionCode=' > "$EVIDENCE_DIR/version.txt"

adb logcat -c
adb shell am force-stop "$PACKAGE_ID" || true
adb shell am start -W -n "$PACKAGE_ID/$MAIN_ACTIVITY" | tee "$EVIDENCE_DIR/launch-1.txt"
sleep 8

PID1="$(adb shell pidof "$PACKAGE_ID" | tr -d '\r' | awk '{print $1}')"
test -n "$PID1"
echo "$PID1" > "$EVIDENCE_DIR/pid-1.txt"
adb exec-out screencap -p > "$EVIDENCE_DIR/screen-launch-1.png"
adb logcat -d --pid="$PID1" -v threadtime > "$EVIDENCE_DIR/logcat-launch-1.txt" 2>&1 || true

if grep -Eq 'FATAL EXCEPTION|ANR in com\.morefunos\.smt|Process: com\.morefunos\.smt.*has died' "$EVIDENCE_DIR/logcat-launch-1.txt"; then
  echo "RING1B_APP_CRASH_AFTER_FIRST_LAUNCH" >&2
  exit 21
fi

# Recovery smoke: force-stop then relaunch the exact installed package.
adb shell am force-stop "$PACKAGE_ID"
sleep 2
if adb shell pidof "$PACKAGE_ID" >/dev/null 2>&1; then
  echo "RING1B_FORCE_STOP_PROCESS_STILL_PRESENT" >&2
  exit 22
fi

adb shell am start -W -n "$PACKAGE_ID/$MAIN_ACTIVITY" | tee "$EVIDENCE_DIR/launch-2.txt"
sleep 8
PID2="$(adb shell pidof "$PACKAGE_ID" | tr -d '\r' | awk '{print $1}')"
test -n "$PID2"
echo "$PID2" > "$EVIDENCE_DIR/pid-2.txt"
adb exec-out screencap -p > "$EVIDENCE_DIR/screen-launch-2.png"
adb logcat -d --pid="$PID2" -v threadtime > "$EVIDENCE_DIR/logcat-launch-2.txt" 2>&1 || true

if grep -Eq 'FATAL EXCEPTION|ANR in com\.morefunos\.smt|Process: com\.morefunos\.smt.*has died' "$EVIDENCE_DIR/logcat-launch-2.txt"; then
  echo "RING1B_APP_CRASH_AFTER_RELAUNCH" >&2
  exit 23
fi

# Require the intended activity to be present in the current task stack.
adb shell dumpsys activity activities | grep -F 'com.morefunos.smt/.MainActivity' > "$EVIDENCE_DIR/main-activity-check.txt"

echo "RING1B_ANDROID_EMULATOR_SMOKE_GREEN"
