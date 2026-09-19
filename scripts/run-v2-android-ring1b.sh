#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path required}"
SOURCE_SHA="${2:?source SHA required}"
EVIDENCE_DIR="${3:?evidence dir required}"
SCENARIO_PATH="${4:-}"
SELECTOR_MAP_PATH="${5:-}"
REALITY_PROBE="${6:-}"
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

mkdir -p "$EVIDENCE_DIR"

bash "$WORKSPACE/scripts/run-v2-android-ring1b-smoke.sh" \
  "$APK_PATH" \
  "$SOURCE_SHA" \
  "$EVIDENCE_DIR"

if [[ -n "$REALITY_PROBE" ]]; then
  if [[ "$REALITY_PROBE" != "M07_M08" ]]; then
    echo "R1B_REALITY_PROBE_INVALID" >&2
    exit 44
  fi
  python3 "$WORKSPACE/scripts/ring1b_m07_m08_reality_probe.py" \
    "$EVIDENCE_DIR/m07-m08-reality" \
    "$APK_PATH"
fi

if [[ -z "$SCENARIO_PATH" && -z "$SELECTOR_MAP_PATH" ]]; then
  echo "RING1B_FUNCTIONAL_SCENARIO_PENDING_SELECTOR_MAP"
  exit 0
fi

if [[ -z "$SCENARIO_PATH" || -z "$SELECTOR_MAP_PATH" ]]; then
  echo "R1B_FUNCTIONAL_SCENARIO_SELECTOR_PAIR_REQUIRED" >&2
  exit 41
fi

case "$SCENARIO_PATH" in
  /*|*..*) echo "R1B_FUNCTIONAL_SCENARIO_PATH_INVALID" >&2; exit 42 ;;
esac
case "$SELECTOR_MAP_PATH" in
  /*|*..*) echo "R1B_FUNCTIONAL_SELECTOR_MAP_PATH_INVALID" >&2; exit 43 ;;
esac

MANIFEST="$WORKSPACE/$SCENARIO_PATH"
SELECTORS="$WORKSPACE/$SELECTOR_MAP_PATH"
test -s "$MANIFEST"
test -s "$SELECTORS"

python3 "$WORKSPACE/scripts/ring1b_functional_driver.py" \
  --manifest "$MANIFEST" \
  --selector-map "$SELECTORS" \
  --evidence-dir "$EVIDENCE_DIR/functional"
