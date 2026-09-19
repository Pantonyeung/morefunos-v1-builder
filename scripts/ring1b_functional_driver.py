#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from ring1b_functional_adb import AdbBackend
from ring1b_functional_core import (
    DriverFailure,
    ManifestError,
    Observation,
    R1B_ACTION_NO_STATE_CHANGE,
    R1B_EXPECTED_STATE_NOT_REACHED,
    R1B_MANIFEST_INVALID,
    R1B_RESTART_PERSISTENCE_MISMATCH,
    R1B_SELECTOR_NOT_FOUND,
    R1B_UNEXPECTED_RECOVERY_SURFACE,
    expectation_matches,
    expectation_text,
    fault_match,
    load_json,
    resolve_tap_coordinates,
    selector_present,
    validate_manifest,
    validate_selector_map,
)


class FunctionalDriver:
    def __init__(self, manifest: Dict[str, Any], selectors: Dict[str, Dict[str, Any]], backend: Any) -> None:
        self.manifest = manifest
        self.selectors = selectors
        self.backend = backend
        self.last_green = "NONE"
        timeouts = manifest.get("timeouts", {})
        self.default_transition_ms = int(timeouts.get("transition_ms", 5000))
        self.poll_ms = int(timeouts.get("poll_ms", 250))

    def _check_fault(self, obs: Observation, step_id: str) -> None:
        match = fault_match(obs, self.manifest)
        if match:
            raise DriverFailure(
                R1B_UNEXPECTED_RECOVERY_SURFACE,
                step_id=step_id,
                expected="no visible recovery/fault surface",
                actual=match,
                layer="ANDROID_UI_RECOVERY",
            )

    def _observe_checked(self, step_id: str) -> Observation:
        obs = self.backend.observe()
        self._check_fault(obs, step_id)
        return obs

    def _wait_expect(self, step: Dict[str, Any], before: Optional[Observation] = None) -> Observation:
        step_id = step["id"]
        expect = step["expect"]
        timeout_ms = int(step.get("timeout_ms", self.default_transition_ms))
        deadline = time.monotonic() + timeout_ms / 1000.0
        latest = self._observe_checked(step_id)
        if expectation_matches(latest, expect, self.selectors) and (
            before is None or latest.fingerprint != before.fingerprint
        ):
            return latest
        while time.monotonic() < deadline:
            self.backend.sleep(self.poll_ms / 1000.0)
            latest = self._observe_checked(step_id)
            if expectation_matches(latest, expect, self.selectors) and (
                before is None or latest.fingerprint != before.fingerprint
            ):
                return latest
        if before is not None and latest.fingerprint == before.fingerprint:
            raise DriverFailure(
                R1B_ACTION_NO_STATE_CHANGE,
                step_id=step_id,
                expected=expectation_text(expect),
                actual=f"observable fingerprint unchanged: {latest.fingerprint}",
            )
        raise DriverFailure(
            R1B_EXPECTED_STATE_NOT_REACHED,
            step_id=step_id,
            expected=expectation_text(expect),
            actual=f"timeout after {timeout_ms}ms; fingerprint={latest.fingerprint}",
        )

    def _assert_named_present(self, obs: Observation, names: List[str]) -> bool:
        return all(selector_present(obs.ui_xml, self.selectors[name]) for name in names)

    def _run_restart(self, step: Dict[str, Any], index: int) -> Observation:
        step_id = step["id"]
        persistence = step["persistence"]
        before = self._observe_checked(step_id)
        self.backend.capture_evidence(f"{index:02d}-{step_id}-before-restart", before)
        before_names = persistence.get("before", [])
        if before_names and not self._assert_named_present(before, before_names):
            raise DriverFailure(
                R1B_RESTART_PERSISTENCE_MISMATCH,
                step_id=step_id,
                expected=f"before restart present={before_names}",
                actual="declared pre-restart state not visible",
                layer="ANDROID_PERSISTENCE",
            )
        self.backend.force_stop()
        self.backend.launch()
        timeout_ms = int(step.get("timeout_ms", self.default_transition_ms))
        deadline = time.monotonic() + timeout_ms / 1000.0
        after_names = persistence["after"]
        latest = self._observe_checked(step_id)
        while not self._assert_named_present(latest, after_names) and time.monotonic() < deadline:
            self.backend.sleep(self.poll_ms / 1000.0)
            latest = self._observe_checked(step_id)
        self.backend.capture_evidence(f"{index:02d}-{step_id}-after-restart", latest)
        if not self._assert_named_present(latest, after_names):
            raise DriverFailure(
                R1B_RESTART_PERSISTENCE_MISMATCH,
                step_id=step_id,
                expected=f"{persistence['mode']} after restart present={after_names}",
                actual=f"state not reached within {timeout_ms}ms; fingerprint={latest.fingerprint}",
                layer="ANDROID_PERSISTENCE",
            )
        return latest

    def run(self) -> Dict[str, Any]:
        for index, step in enumerate(self.manifest["steps"], start=1):
            step_id = step["id"]
            action = step["action"]
            try:
                if action == "launch":
                    self.backend.force_stop()
                    self.backend.launch()
                    after = self._wait_expect(step)
                    self.backend.capture_evidence(f"{index:02d}-{step_id}-after", after)
                elif action == "checkpoint":
                    after = self._wait_expect(step)
                    self.backend.capture_evidence(f"{index:02d}-{step_id}", after)
                elif action == "tap":
                    before = self._observe_checked(step_id)
                    self.backend.capture_evidence(f"{index:02d}-{step_id}-before", before)
                    if expectation_matches(before, step["expect"], self.selectors):
                        raise DriverFailure(
                            R1B_ACTION_NO_STATE_CHANGE,
                            step_id=step_id,
                            expected=expectation_text(step["expect"]),
                            actual="expected post-action state was already present before tap; transition is not provable",
                        )
                    target = self.selectors[step["target"]]
                    coords = resolve_tap_coordinates(before.ui_xml, target)
                    if coords is None:
                        raise DriverFailure(
                            R1B_SELECTOR_NOT_FOUND,
                            step_id=step_id,
                            expected=f"target selector {step['target']} resolved by resource-id/text/content-desc/bounds",
                            actual=json.dumps(target, ensure_ascii=False, sort_keys=True),
                        )
                    self.backend.tap(*coords)
                    after = self._wait_expect(step, before=before)
                    self.backend.capture_evidence(f"{index:02d}-{step_id}-after", after)
                elif action == "restart":
                    self._run_restart(step, index)
                else:
                    raise ManifestError(f"unhandled action: {action}")
            except DriverFailure:
                try:
                    self.backend.capture_evidence(f"{index:02d}-{step_id}-failure")
                except Exception:
                    pass
                raise
            self.last_green = step_id
        return {"scenario_id": self.manifest["scenario_id"], "last_green": self.last_green, "result": "GREEN"}


def write_diagnostic(path: Path, failure: DriverFailure, last_green: str, scenario_id: str) -> None:
    payload = {
        "scenario_id": scenario_id,
        "result": "RED",
        "last_green": last_green,
        "first_break": failure.step_id,
        "code": failure.code,
        "expected": failure.expected,
        "actual": failure.actual,
        "layer": failure.layer,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Manifest-driven MoreFunOS Android Ring1B functional driver")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--selector-map", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)
    evidence_dir = Path(args.evidence_dir)
    evidence_dir.mkdir(parents=True, exist_ok=True)
    try:
        manifest = load_json(args.manifest)
        selectors = validate_selector_map(load_json(args.selector_map))
        validate_manifest(manifest, selectors)
    except (OSError, json.JSONDecodeError, ManifestError, ValueError) as exc:
        print(f"CODE={R1B_MANIFEST_INVALID}", file=sys.stderr)
        print(f"ACTUAL={exc}", file=sys.stderr)
        return 2
    if args.validate_only:
        print("RING1B_FUNCTIONAL_MANIFEST_VALID")
        return 0
    backend = AdbBackend(manifest["package_id"], manifest["main_activity"], evidence_dir)
    driver = FunctionalDriver(manifest, selectors, backend)
    try:
        result = driver.run()
    except DriverFailure as failure:
        write_diagnostic(evidence_dir / "diagnostic.json", failure, driver.last_green, manifest["scenario_id"])
        print("RING1B_FUNCTIONAL_RED", file=sys.stderr)
        print(f"LAST_GREEN={driver.last_green}", file=sys.stderr)
        print(f"FIRST_BREAK={failure.step_id}", file=sys.stderr)
        print(f"CODE={failure.code}", file=sys.stderr)
        print(f"EXPECTED={failure.expected}", file=sys.stderr)
        print(f"ACTUAL={failure.actual}", file=sys.stderr)
        print(f"LAYER={failure.layer}", file=sys.stderr)
        return 1
    (evidence_dir / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("RING1B_FUNCTIONAL_DRIVER_GREEN")
    print(f"LAST_GREEN={result['last_green']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
