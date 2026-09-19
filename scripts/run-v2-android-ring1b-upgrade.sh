#!/usr/bin/env bash
set -euo pipefail

LEGACY_APK_PATH="${1:?legacy APK path required}"
REPAIRED_APK_PATH="${2:?repaired APK path required}"
LEGACY_SOURCE_SHA="${3:?legacy source SHA required}"
REPAIRED_SOURCE_SHA="${4:?repaired source SHA required}"
UPGRADE_STATE="${5:?upgrade state required}"
EVIDENCE_DIR="${6:?evidence dir required}"
SCENARIO_PATH="${7:?legacy UI scenario path required}"
SELECTOR_MAP_PATH="${8:?legacy selector map path required}"
LEGACY_SOURCE_PATH="${9:?exact legacy source checkout required}"
WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PACKAGE_ID="com.morefunos.smt"
MAIN_ACTIVITY=".MainActivity"

FORBIDDEN_COMMAND_PATTERN='adb[[:space:]]+uninstall|pm[[:space:]]+clear|cmd[[:space:]]+package[[:space:]]+clear|/data/(data|user/[^/]+)/com\.morefunos\.smt|install[[:space:]]+-r[[:space:]]+-d'
if grep -Eq "$FORBIDDEN_COMMAND_PATTERN" "$0"; then
  echo "R1B_UPGRADE_NO_CLEAR_NO_UNINSTALL_INVARIANT_BREACH" >&2
  exit 30
fi
POST_WRITE_LINE="$(grep -n '^pre_upgrade_probe > ' "$0" | cut -d: -f1)"
FORCE_STOP_LINE="$(grep -n '^adb shell am force-stop "\$PACKAGE_ID"$' "$0" | head -n 1 | cut -d: -f1)"
if [[ -z "$POST_WRITE_LINE" || -z "$FORCE_STOP_LINE" || $((POST_WRITE_LINE + 1)) -ne "$FORCE_STOP_LINE" ]]; then
  echo "R1B_UPGRADE_POST_WRITE_ORDERING_BREACH" >&2
  exit 32
fi

test "$LEGACY_SOURCE_SHA" = "a64c72c9160e9c116db2e8ff99e54223f6bd8e2f"
[[ "$REPAIRED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
case "$UPGRADE_STATE" in
  PENDING|COMMITTING|SETTLED) ;;
  *) echo "R1B_UPGRADE_STATE_INVALID" >&2; exit 31 ;;
esac
for path in "$LEGACY_APK_PATH" "$REPAIRED_APK_PATH" "$WORKSPACE/$SCENARIO_PATH" "$WORKSPACE/$SELECTOR_MAP_PATH"; do
  test -s "$path"
done
test -d "$LEGACY_SOURCE_PATH/.git"
test "$(git -C "$LEGACY_SOURCE_PATH" rev-parse HEAD)" = "$LEGACY_SOURCE_SHA"
mkdir -p "$EVIDENCE_DIR"

printf '%s\n' \
  '01=fresh_install_exact_legacy_apk' \
  '02=stage_runtime_pending_through_real_ui' \
  '03=typed_allowlisted_storage_read_and_fixture_update' \
  '04=force_stop_and_assert_pid_absent' \
  '05=replace_install_preserving_app_data' \
  '06=first_repaired_launch_read_only_custody_projection' \
  '07=second_repaired_launch_read_only_custody_projection' \
  > "$EVIDENCE_DIR/command-journal.txt"

package_uid() {
  adb shell dumpsys package "$PACKAGE_ID" | sed -n 's/^[[:space:]]*userId=//p' | tr -d '\r' | head -n 1
}

capture_ui() {
  local label="$1"
  adb exec-out screencap -p > "$EVIDENCE_DIR/screen-$label.png"
  adb shell uiautomator dump "/sdcard/morefun-upgrade-$label.xml" >/dev/null
  adb pull "/sdcard/morefun-upgrade-$label.xml" "$EVIDENCE_DIR/window-$label.xml" >/dev/null
  adb logcat -d -v threadtime > "$EVIDENCE_DIR/logcat-$label.txt" 2>&1 || true
  adb shell dumpsys package "$PACKAGE_ID" > "$EVIDENCE_DIR/package-$label.txt"
  adb shell run-as "$PACKAGE_ID" sh -c 'for d in app_webview databases shared_prefs files; do [ -d "$d" ] && find "$d" -maxdepth 4 -type f -print; done' \
    > "$EVIDENCE_DIR/app-private-files-$label.txt" 2>&1 || true
}

pre_upgrade_probe() {
  local operations=(
    --operation READ_LOCAL_STORAGE
    --operation READ_INDEXEDDB
  )
  if [[ "$UPGRADE_STATE" != "PENDING" ]]; then
    operations+=(--operation PUT_INDEXEDDB --operation WRITE_LOCAL_STORAGE)
  fi
  node "$WORKSPACE/scripts/ring1b_webview_storage_probe.mjs" \
    --phase pre \
    --fixture-case "$UPGRADE_STATE" \
    --legacy-source "$LEGACY_SOURCE_PATH" \
    "${operations[@]}" \
    --output "$EVIDENCE_DIR/pre-upgrade-custody.json"
}

post_upgrade_probe() {
  local output="$1"
  node "$WORKSPACE/scripts/ring1b_webview_storage_probe.mjs" \
    --phase post \
    --fixture-case "$UPGRADE_STATE" \
    --operation READ_LOCAL_STORAGE \
    --operation READ_INDEXEDDB \
    --output "$output"
}

adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done' >/dev/null 2>&1 || true
adb shell settings put system accelerometer_rotation 0 || true
adb shell settings put system user_rotation 1 || true

sha256sum "$LEGACY_APK_PATH" "$REPAIRED_APK_PATH" > "$EVIDENCE_DIR/apk-sha256.txt"
adb install "$LEGACY_APK_PATH" | tee "$EVIDENCE_DIR/install-legacy.txt"
adb shell dumpsys package "$PACKAGE_ID" | grep -E 'versionName=|versionCode=' > "$EVIDENCE_DIR/version-legacy.txt"

# The exact base runtime/UI must create the PENDING mother identity and pricing facts.
python3 "$WORKSPACE/scripts/ring1b_functional_driver.py" \
  --manifest "$WORKSPACE/$SCENARIO_PATH" \
  --selector-map "$WORKSPACE/$SELECTOR_MAP_PATH" \
  --evidence-dir "$EVIDENCE_DIR/legacy-ui-setup"
capture_ui "before-upgrade"

# The helper keeps raw storage in memory, validates the exact source-bound root,
# writes only governed terminal deltas, and emits privacy-safe projections.
pre_upgrade_probe > "$EVIDENCE_DIR/probe-pre-status.txt"
adb shell am force-stop "$PACKAGE_ID"
test -z "$(adb shell pidof "$PACKAGE_ID" | tr -d '\r[:space:]')"
grep -Fx 'PRE_UPGRADE_FIXTURE_VALID' "$EVIDENCE_DIR/probe-pre-status.txt" >/dev/null
echo "PRE_UPGRADE_FIXTURE_VALID"

LEGACY_UID="$(package_uid)"
test -n "$LEGACY_UID"
printf '%s\n' "$LEGACY_UID" > "$EVIDENCE_DIR/package-uid-before.txt"

adb install -r "$REPAIRED_APK_PATH" | tee "$EVIDENCE_DIR/install-repaired.txt"
REPAIRED_UID="$(package_uid)"
test "$REPAIRED_UID" = "$LEGACY_UID"
printf '%s\n' "$REPAIRED_UID" > "$EVIDENCE_DIR/package-uid-after.txt"
adb shell dumpsys package "$PACKAGE_ID" | grep -E 'versionName=|versionCode=' > "$EVIDENCE_DIR/version-repaired.txt"

adb logcat -c
adb shell am start -W -n "$PACKAGE_ID/$MAIN_ACTIVITY" | tee "$EVIDENCE_DIR/launch-repaired.txt"
sleep 8
post_upgrade_probe "$EVIDENCE_DIR/post-upgrade-first-launch.json"
capture_ui "after-first-launch"

python3 "$WORKSPACE/scripts/ring1b_upgrade_contract.py" evaluate-projected \
  --before "$EVIDENCE_DIR/pre-upgrade-custody.json" \
  --after "$EVIDENCE_DIR/post-upgrade-first-launch.json" \
  --state "$UPGRADE_STATE" \
  --output-json "$EVIDENCE_DIR/upgrade-contract-result-first-launch.json"

adb shell am force-stop "$PACKAGE_ID"
test -z "$(adb shell pidof "$PACKAGE_ID" | tr -d '\r[:space:]')"
adb logcat -c
adb shell am start -W -n "$PACKAGE_ID/$MAIN_ACTIVITY" | tee "$EVIDENCE_DIR/launch-repaired-relaunch.txt"
sleep 8
post_upgrade_probe "$EVIDENCE_DIR/post-upgrade-relaunch.json"
capture_ui "after-relaunch"

python3 "$WORKSPACE/scripts/ring1b_upgrade_contract.py" evaluate-projected \
  --before "$EVIDENCE_DIR/pre-upgrade-custody.json" \
  --after "$EVIDENCE_DIR/post-upgrade-relaunch.json" \
  --state "$UPGRADE_STATE" \
  --output-json "$EVIDENCE_DIR/upgrade-contract-result.json"

{
  echo "result=PASS"
  echo "legacy_source_sha=$LEGACY_SOURCE_SHA"
  echo "repaired_source_sha=$REPAIRED_SOURCE_SHA"
  echo "state=$UPGRADE_STATE"
  echo "package_id=$PACKAGE_ID"
  echo "package_uid=$REPAIRED_UID"
  echo "install_semantics=adb_install_r_preserve_data"
  echo "raw_storage_evidence=never_persisted"
} > "$EVIDENCE_DIR/summary.txt"

echo "RING1B_ANDROID_LEGACY_UPGRADE_GREEN"
