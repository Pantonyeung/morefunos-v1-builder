#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
from typing import Any


PASS = "PASS"
FAIL = "FAIL"
HELD = "HELD"
PRE_EXISTING_GLOBAL_RED = "PRE_EXISTING_GLOBAL_RED"
NEW_GLOBAL_REGRESSION = "NEW_GLOBAL_REGRESSION"
OUTCOMES = {"success", "failure", "skipped", "cancelled"}
VERIFICATION_PHASES = {"CANDIDATE", "FINAL_MERGE_REQUEST", "POST_LANDING_READBACK"}
MERGE_REQUEST_GUARD_MODES = {
    "CANDIDATE": "CANDIDATE_PHASE_SKIP",
    "FINAL_MERGE_REQUEST": "FORMAL_MERGE_REQUEST",
    "POST_LANDING_READBACK": "POST_LANDING_READBACK_SKIP",
}
CORE_GATES = {
    "catalog": ("v2-core-catalog-tests.log", ("packages/catalog/",)),
    "pricing": ("v2-core-pricing-tests.log", ("packages/pricing/",)),
    "availability": ("v2-core-availability-tests.log", ("packages/availability/",)),
    "order": ("v2-core-order-tests.log", ("packages/order/", "packages/store-order-intake/")),
    "business_day_cash": ("v2-core-business-day-cash-tests.log", ("packages/business-day-cash/",)),
    "payment": ("v2-core-payment-tests.log", ("packages/payment/",)),
    "fulfillment": ("v2-core-fulfillment-tests.log", ("packages/fulfillment/",)),
    "human_custody": ("v2-core-human-custody-tests.log", ("packages/human-custody/",)),
    "production_operations": ("v2-core-production-operations-tests.log", ("packages/production-",)),
    "large_order_b2b": ("v2-core-large-order-b2b-tests.log", ("packages/large-order-b2b/",)),
    "system_diagnostics": ("v2-core-system-diagnostics-tests.log", ("packages/system-diagnostics/", "apps/diagnostics-web/")),
    "inventory": ("v2-core-inventory-tests.log", ("packages/inventory/",)),
    "integration": ("v2-integration-tests.log", ("packages/integration/",)),
    "typescript": ("v2-core-typecheck.log", ("tsconfig.json", "package.json", "packages/", "apps/", "infra/", "workers/")),
    "governance": ("v2-core-governance.log", ("docs/", "scripts/governance", "scripts/railway", "AI-INDEX.yaml", "AUTHORITY.md")),
    "merge_request": ("v2-core-merge-request.log", ("docs/merge-requests/", "scripts/merge_request_guard.py")),
}


def resolve_verification_intent(verification_phase: str, branch_name: str) -> tuple[str, str]:
    phase = verification_phase.strip().upper()
    branch = branch_name.strip()
    if phase not in VERIFICATION_PHASES:
        raise ValueError(f"VERIFICATION_PHASE_INVALID:{phase or 'EMPTY'}")
    if not branch:
        raise ValueError("BRANCH_NAME_REQUIRED")
    if phase == "POST_LANDING_READBACK" and branch != "main":
        raise ValueError(f"POST_LANDING_READBACK_REQUIRES_MAIN_BRANCH:{branch}")
    return phase, MERGE_REQUEST_GUARD_MODES[phase]


def _node_assert_match_tap_identity(lines: list[str]) -> str | None:
    not_ok: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = re.fullmatch(r"\s*not ok\s+\d+\s+-\s+(.+?)\s*", line)
        if match:
            not_ok.append((index, match.group(1).strip()))
    fail_counts = [
        int(match.group(1))
        for line in lines
        if (match := re.fullmatch(r"\s*#\s*fail\s+(\d+)\s*", line))
    ]
    if len(not_ok) != 1 or fail_counts != [1]:
        return None

    start, title = not_ok[0]
    if not title:
        return None
    previous = [line.strip() for line in lines[max(0, start - 3):start] if line.strip()]
    if f"# Subtest: {title}" not in previous:
        return None

    end = next(
        (index for index in range(start + 1, len(lines)) if re.fullmatch(r"\s*\.\.\.\s*", lines[index])),
        None,
    )
    if end is None:
        return None
    block = lines[start:end + 1]

    def single_field(name: str) -> str | None:
        values: list[str] = []
        pattern = re.compile(rf"\s*{re.escape(name)}:\s*(.*?)\s*")
        for line in block:
            match = pattern.fullmatch(line)
            if match:
                value = match.group(1).strip().rstrip(",").strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                values.append(value)
        if len(values) != 1 or not values[0]:
            return None
        return values[0]

    location = single_field("location")
    code = single_field("code")
    name = single_field("name")
    operator = single_field("operator")
    actual_markers = [line for line in block if re.match(r"\s*actual:\s*", line)]
    expected: list[str] = []
    message_pattern = re.compile(
        r"\s*The input did not match the regular expression (/(?:\\.|[^/])*/[a-z]*)\. Input:\s*"
    )
    for line in block:
        match = message_pattern.fullmatch(line)
        if match:
            expected.append(match.group(1))
    if (
        not location
        or code != "ERR_ASSERTION"
        or name != "AssertionError"
        or operator != "match"
        or len(actual_markers) != 1
        or len(expected) != 1
    ):
        return None

    return "\n".join((
        "node_assert_match",
        "format=tap",
        f"title={title}",
        f"location={location}",
        f"code={code}",
        f"name={name}",
        f"operator={operator}",
        f"expected_regex={expected[0]}",
    ))


def _node_assert_match_spec_identity(lines: list[str]) -> str | None:
    fail_counts = [
        int(match.group(1))
        for line in lines
        if (match := re.fullmatch(r"\s*ℹ\s*fail\s+(\d+)\s*", line))
    ]
    if fail_counts != [1]:
        return None

    marker_indices = [
        index
        for index, line in enumerate(lines)
        if re.fullmatch(r"\s*✖\s+failing tests:\s*", line)
    ]
    if len(marker_indices) != 1:
        return None
    block = lines[marker_indices[0] + 1:]

    location_pattern = re.compile(r"\s*test at\s+(.+?)\s*")
    title_pattern = re.compile(r"\s*✖\s+(.+?)\s+\(([0-9.]+)ms\)\s*")
    message_pattern = re.compile(
        r"\s*AssertionError \[ERR_ASSERTION\]: The input did not match the regular expression "
        r"(/(?:\\.|[^/])*/[a-z]*)\. Input:\s*"
    )
    code_pattern = re.compile(r"\s*code:\s*['\"]([^'\"]+)['\"],?\s*")
    expected_pattern = re.compile(r"\s*expected:\s*(/(?:\\.|[^/])*/[a-z]*),?\s*")
    operator_pattern = re.compile(r"\s*operator:\s*['\"]([^'\"]+)['\"],?\s*")

    locations: list[str] = []
    titles: list[str] = []
    message_expected: list[str] = []
    codes: list[str] = []
    structured_expected: list[str] = []
    operators: list[str] = []
    actual_markers = 0
    for line in block:
        if match := location_pattern.fullmatch(line):
            locations.append(match.group(1).strip())
        if match := title_pattern.fullmatch(line):
            titles.append(match.group(1).strip())
        if match := message_pattern.fullmatch(line):
            message_expected.append(match.group(1))
        if match := code_pattern.fullmatch(line):
            codes.append(match.group(1))
        if match := expected_pattern.fullmatch(line):
            structured_expected.append(match.group(1))
        if match := operator_pattern.fullmatch(line):
            operators.append(match.group(1))
        if re.match(r"\s*actual:\s*", line):
            actual_markers += 1

    if not (
        len(locations) == 1
        and len(titles) == 1
        and len(message_expected) == 1
        and len(codes) == 1
        and len(structured_expected) == 1
        and len(operators) == 1
        and actual_markers == 1
    ):
        return None
    if (
        codes[0] != "ERR_ASSERTION"
        or operators[0] != "match"
        or message_expected[0] != structured_expected[0]
    ):
        return None

    return "\n".join((
        "node_assert_match",
        "format=spec",
        f"title={titles[0]}",
        f"location={locations[0]}",
        "code=ERR_ASSERTION",
        "name=AssertionError",
        "operator=match",
        f"expected_regex={message_expected[0]}",
    ))


def _node_assert_match_semantic_identity(clean: str) -> str | None:
    lines = clean.splitlines()
    identities = [
        identity
        for identity in (
            _node_assert_match_tap_identity(lines),
            _node_assert_match_spec_identity(lines),
        )
        if identity is not None
    ]
    return identities[0] if len(identities) == 1 else None


def _looks_like_node_assert_match_failure(clean: str) -> bool:
    return (
        "The input did not match the regular expression" in clean
        and "ERR_ASSERTION" in clean
        and "AssertionError" in clean
    )


def _failure_signatures_are_equivalent(candidate_signature: Any, base_signature: Any) -> bool:
    if not isinstance(candidate_signature, str) or candidate_signature != base_signature:
        return False
    return bool(candidate_signature) and not candidate_signature.startswith("opaque-node-assert-match:")


def failure_signature(text: str) -> str:
    clean = re.sub(r"\x1b\[[0-9;]*m", "", text.replace("\r\n", "\n"))
    semantic_identity = _node_assert_match_semantic_identity(clean)
    if semantic_identity is not None:
        return "sha256:" + hashlib.sha256(semantic_identity.encode("utf-8")).hexdigest()
    if _looks_like_node_assert_match_failure(clean):
        return "opaque-node-assert-match:sha256:" + hashlib.sha256(clean.encode("utf-8")).hexdigest()
    stable: list[str] = []
    for line in clean.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        normalized = re.sub(r"\bduration_ms\s*[:=]\s*[0-9.]+", "duration_ms=<normalized>", normalized)
        normalized = re.sub(r"\([0-9.]+ms\)", "(<duration>)", normalized)
        normalized = re.sub(r"file:///[^ )]+", "file:///<path>", normalized)
        if re.search(r"(?i)(not ok|fail|error|assert|mismatch|missing|invalid|forbidden|unresolved|held)", normalized):
            stable.append(normalized)
    if not stable:
        stable = [line.strip() for line in clean.splitlines() if line.strip()][-50:]
    return "sha256:" + hashlib.sha256("\n".join(stable).encode("utf-8")).hexdigest()


def _layer_verdict(gates: list[dict[str, Any]], selector: str, *, empty_pass: bool = True) -> tuple[str, str]:
    selected = [gate for gate in gates if gate.get(selector)]
    if not selected:
        return (PASS if empty_pass else HELD, "NONE")
    for gate in selected:
        if gate.get("outcome") == "failure":
            return FAIL, str(gate.get("gate_id", "UNKNOWN"))
    for gate in selected:
        if gate.get("outcome") != "success":
            return HELD, str(gate.get("gate_id", "UNKNOWN"))
    return PASS, "NONE"


def classify(payload: dict[str, Any]) -> dict[str, Any]:
    gates = [dict(gate) for gate in payload.get("gates", [])]
    for gate in gates:
        if gate.get("outcome") not in OUTCOMES:
            raise ValueError(f"GATE_OUTCOME_INVALID:{gate.get('gate_id')}={gate.get('outcome')}")

    change, change_first = _layer_verdict(gates, "changed_domain")
    rail, rail_first = _layer_verdict(gates, "rail_required")
    if payload.get("rail_id") and not any(gate.get("rail_required") for gate in gates):
        rail, rail_first = HELD, "RAIL_GATE_BINDING_MISSING"
    global_gates = [gate for gate in gates if gate.get("global_scope")]
    global_failed = [gate for gate in global_gates if gate.get("outcome") == "failure"]
    global_incomplete = [gate for gate in global_gates if gate.get("outcome") in {"skipped", "cancelled"}]
    baseline_comparison: list[dict[str, Any]] = []
    new_regression: list[str] = []
    held: list[str] = []
    pre_existing: list[str] = []
    for gate in global_failed:
        gate_id = str(gate.get("gate_id", "UNKNOWN"))
        base_outcome = gate.get("base_outcome")
        candidate_signature = gate.get("failure_signature")
        base_signature = gate.get("base_failure_signature")
        if base_outcome is None:
            classification = HELD
            held.append(gate_id)
        elif base_outcome == "success":
            classification = NEW_GLOBAL_REGRESSION
            new_regression.append(gate_id)
        elif base_outcome == "failure" and _failure_signatures_are_equivalent(candidate_signature, base_signature):
            classification = PRE_EXISTING_GLOBAL_RED
            pre_existing.append(gate_id)
        else:
            classification = NEW_GLOBAL_REGRESSION
            new_regression.append(gate_id)
        baseline_comparison.append({
            "gate_id": gate_id,
            "candidate_outcome": gate.get("outcome"),
            "candidate_failure_signature": candidate_signature,
            "base_outcome": base_outcome,
            "base_failure_signature": base_signature,
            "classification": classification,
        })
    if new_regression:
        global_health = NEW_GLOBAL_REGRESSION
    elif held or global_incomplete or (global_failed and not payload.get("base_sha")):
        global_health = HELD
    elif global_failed:
        global_health = PRE_EXISTING_GLOBAL_RED
    elif global_gates and all(gate.get("outcome") == "success" for gate in global_gates):
        global_health = PASS
    else:
        global_health = HELD

    identity_ok = payload.get("source_identity") == PASS
    physical_required = bool(payload.get("physical_proof_required"))
    physical_ok = not physical_required or payload.get("physical_proof") == PASS
    eligible = (
        identity_ok
        and physical_ok
        and change == PASS
        and rail == PASS
        and global_health in {PASS, PRE_EXISTING_GLOBAL_RED}
    )
    blocking_reasons: list[str] = []
    if not identity_ok:
        blocking_reasons.append("SOURCE_IDENTITY_MISMATCH")
    if change != PASS:
        blocking_reasons.append(f"CHANGE_VERIFICATION_{change}")
    if rail != PASS:
        blocking_reasons.append(f"RAIL_VERIFICATION_{rail}")
    if global_health not in {PASS, PRE_EXISTING_GLOBAL_RED}:
        blocking_reasons.append(f"GLOBAL_SYSTEM_HEALTH_{global_health}")
    if not physical_ok:
        blocking_reasons.append("PHYSICAL_PROOF_MISSING")

    global_first = "NONE"
    if new_regression:
        global_first = new_regression[0]
    elif held:
        global_first = held[0]
    elif pre_existing:
        global_first = pre_existing[0]
    elif global_incomplete:
        global_first = str(global_incomplete[0].get("gate_id", "UNKNOWN"))

    return {
        "schema_version": 1,
        "identity": {
            "source_sha": payload.get("source_sha"),
            "base_sha": payload.get("base_sha"),
            "work_id": payload.get("work_id"),
            "request_id": payload.get("request_id"),
            "builder_run_id": payload.get("builder_run_id"),
            "builder_run_attempt": payload.get("builder_run_attempt"),
            "source_identity": payload.get("source_identity"),
            "branch_name": payload.get("branch_name"),
            "verification_phase": payload.get("verification_phase"),
            "merge_request_guard_mode": payload.get("merge_request_guard_mode"),
        },
        "gate_outcomes": gates,
        "first_failed_station": {
            "CHANGE": change_first,
            "RAIL": rail_first,
            "GLOBAL": global_first,
        },
        "verdicts": {
            "CHANGE_VERIFICATION": change,
            "RAIL_VERIFICATION": rail,
            "GLOBAL_SYSTEM_HEALTH": global_health,
        },
        "baseline_comparison": baseline_comparison,
        "artifacts": payload.get("artifacts", []),
        "admission": {"eligible": eligible, "blocking_reasons": blocking_reasons},
    }


def collect_core_payload(args: argparse.Namespace) -> dict[str, Any]:
    verification_phase, expected_merge_request_mode = resolve_verification_intent(
        args.verification_phase, args.branch_name
    )
    if args.merge_request_guard_mode != expected_merge_request_mode:
        raise ValueError(
            "MERGE_REQUEST_GUARD_MODE_MISMATCH:"
            f"expected={expected_merge_request_mode}:actual={args.merge_request_guard_mode}"
        )
    changed = []
    if args.changed_files.is_file():
        changed = [line.strip().replace("\\", "/") for line in args.changed_files.read_text(encoding="utf-8").splitlines() if line.strip()]
    base_results: dict[str, tuple[str | None, str | None]] = {}
    if args.base_results.is_file():
        for line in args.base_results.read_text(encoding="utf-8").splitlines():
            parts = line.split("|", 2)
            if len(parts) == 3:
                base_results[parts[0]] = (parts[1] or None, parts[2] or None)
    rail_gates = {value.strip() for value in args.rail_gates.split(",") if value.strip()}
    unknown_rail_gates = rail_gates - set(CORE_GATES)
    if unknown_rail_gates:
        raise ValueError("RAIL_GATE_UNKNOWN:" + ",".join(sorted(unknown_rail_gates)))
    gates: list[dict[str, Any]] = []
    for gate_id, (log_name, prefixes) in CORE_GATES.items():
        outcome = os.environ.get(f"GATE_{gate_id.upper()}", "skipped")
        log_path = args.runner_temp / log_name
        signature = failure_signature(log_path.read_text(encoding="utf-8", errors="replace")) if outcome == "failure" and log_path.is_file() else None
        base_outcome, base_signature = base_results.get(gate_id, (None, None))
        gates.append({
            "gate_id": gate_id,
            "outcome": outcome,
            "failure_signature": signature,
            "changed_domain": any(path == prefix or path.startswith(prefix) for path in changed for prefix in prefixes),
            "rail_required": gate_id in rail_gates,
            "global_scope": True,
            "base_outcome": base_outcome,
            "base_failure_signature": base_signature,
        })
    return {
        "source_sha": args.source_sha,
        "base_sha": args.base_sha or None,
        "work_id": args.work_id or None,
        "request_id": args.request_id or None,
        "builder_run_id": args.builder_run_id,
        "builder_run_attempt": args.builder_run_attempt,
        "source_identity": PASS,
        "branch_name": args.branch_name,
        "verification_phase": verification_phase,
        "merge_request_guard_mode": expected_merge_request_mode,
        "physical_proof_required": False,
        "physical_proof": "NOT_REQUIRED",
        "rail_id": args.rail_id or None,
        "gates": gates,
        "artifacts": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    signature_parser = subparsers.add_parser("signature")
    signature_parser.add_argument("log", type=pathlib.Path)
    classify_parser = subparsers.add_parser("classify")
    classify_parser.add_argument("input", type=pathlib.Path)
    classify_parser.add_argument("output", type=pathlib.Path)
    classify_parser.add_argument("--require-eligible", action="store_true")
    intent_parser = subparsers.add_parser("resolve-verification-intent")
    intent_parser.add_argument("--verification-phase", required=True)
    intent_parser.add_argument("--branch-name", required=True)
    collect_parser = subparsers.add_parser("collect-core")
    collect_parser.add_argument("--source-sha", required=True)
    collect_parser.add_argument("--base-sha", default="")
    collect_parser.add_argument("--work-id", default="")
    collect_parser.add_argument("--request-id", default="")
    collect_parser.add_argument("--builder-run-id", required=True)
    collect_parser.add_argument("--builder-run-attempt", required=True)
    collect_parser.add_argument("--branch-name", required=True)
    collect_parser.add_argument("--verification-phase", required=True)
    collect_parser.add_argument("--merge-request-guard-mode", required=True)
    collect_parser.add_argument("--rail-id", default="")
    collect_parser.add_argument("--rail-gates", default="")
    collect_parser.add_argument("--changed-files", required=True, type=pathlib.Path)
    collect_parser.add_argument("--base-results", required=True, type=pathlib.Path)
    collect_parser.add_argument("--runner-temp", required=True, type=pathlib.Path)
    collect_parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if args.command == "signature":
        print(failure_signature(args.log.read_text(encoding="utf-8", errors="replace")))
        return 0
    if args.command == "resolve-verification-intent":
        phase, merge_request_guard_mode = resolve_verification_intent(
            args.verification_phase, args.branch_name
        )
        print(f"{phase}|{merge_request_guard_mode}")
        return 0
    if args.command == "collect-core":
        result = classify(collect_core_payload(args))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(result["verdicts"], sort_keys=True))
        return 0
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    result = classify(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result["verdicts"], sort_keys=True))
    return 0 if result["admission"]["eligible"] or not args.require_eligible else 1


if __name__ == "__main__":
    sys.exit(main())