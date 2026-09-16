from __future__ import annotations

import unittest
from pathlib import Path

import scripts.v2_verification_classifier as classifier


classify = classifier.classify


def gate(gate_id: str, outcome: str = "success", **overrides: object) -> dict:
    value = {
        "gate_id": gate_id,
        "outcome": outcome,
        "failure_signature": None if outcome == "success" else f"sig:{gate_id}",
        "changed_domain": False,
        "rail_required": False,
        "global_scope": True,
        "base_outcome": "success",
        "base_failure_signature": None,
    }
    value.update(overrides)
    return value


def payload(*gates: dict, **metadata: object) -> dict:
    value = {
        "source_sha": "a" * 40,
        "base_sha": "b" * 40,
        "work_id": "WORK-1",
        "request_id": "REQUEST-1",
        "builder_run_id": "123",
        "builder_run_attempt": "1",
        "source_identity": "PASS",
        "branch_name": "work/CORE/WORK-1",
        "verification_phase": "CANDIDATE",
        "merge_request_guard_mode": "CANDIDATE_PHASE_SKIP",
        "physical_proof_required": False,
        "physical_proof": "NOT_REQUIRED",
        "gates": list(gates),
        "artifacts": [],
    }
    value.update(metadata)
    return value


def node_assert_match_log(
    *,
    title: str = "SMT Catalog endpoint records APPLIED only after canonical Menu readback",
    location: str = "packages/system-diagnostics/catalog-readback-wiring.test.ts:75:1",
    expected_regex: str = r"/refreshMenu=async\(signal\?:CatalogRealtimeDoorbell\)/",
    actual: str = "export function assertMenu() { throw new Error('payload'); }",
    include_operator: bool = True,
    fail_count: int = 1,
) -> str:
    operator = "  operator: 'match'\n" if include_operator else ""
    return (
        "TAP version 13\n"
        f"# Subtest: {title}\n"
        f"not ok 1 - {title}\n"
        "  ---\n"
        "  duration_ms: 1.234\n"
        "  type: 'test'\n"
        f"  location: '{location}'\n"
        "  failureType: 'testCodeFailure'\n"
        "  error: |-\n"
        f"    The input did not match the regular expression {expected_regex}. Input:\n"
        "    \n"
        f"    {actual!r}\n"
        "  code: 'ERR_ASSERTION'\n"
        "  name: 'AssertionError'\n"
        f"  actual: {actual!r}\n"
        f"{operator}"
        "  stack: |-\n"
        f"    TestContext.<anonymous> ({location})\n"
        "  ...\n"
        "# tests 152\n"
        "# pass 151\n"
        f"# fail {fail_count}\n"
    )


def node_spec_assert_match_log(
    *,
    title: str = "SMT Catalog endpoint records APPLIED only after canonical Menu readback",
    location: str = "packages/system-diagnostics/catalog-readback-wiring.test.ts:75:1",
    expected_regex: str = r"/refreshMenu=async\(signal\?:CatalogRealtimeDoorbell\)/",
    actual: str = "export function assertMenu() { throw new Error('payload'); }",
    include_operator: bool = True,
    fail_count: int = 1,
) -> str:
    operator = "    operator: 'match',\n" if include_operator else ""
    return (
        f"✖ {title} (8.868653ms)\n"
        "✔ another test stays green (1.0ms)\n"
        "ℹ tests 152\n"
        "ℹ suites 0\n"
        "ℹ pass 151\n"
        f"ℹ fail {fail_count}\n"
        "ℹ cancelled 0\n"
        "ℹ skipped 0\n"
        "ℹ todo 0\n"
        "ℹ duration_ms 2748.225351\n\n"
        "✖ failing tests:\n\n"
        f"test at {location}\n"
        f"✖ {title} (8.868653ms)\n"
        f"  AssertionError [ERR_ASSERTION]: The input did not match the regular expression {expected_regex}. Input:\n\n"
        f"  {actual!r}\n\n"
        "    code: 'ERR_ASSERTION',\n"
        f"    actual: {actual!r},\n"
        f"    expected: {expected_regex},\n"
        f"{operator}"
        "    diff: 'simple'\n"
        "  }\n"
    )


def classified_global_failure(
    base_log: str,
    candidate_log: str,
    **gate_overrides: object,
) -> dict:
    return classify(payload(gate(
        "system_diagnostics",
        "failure",
        base_outcome="failure",
        failure_signature=classifier.failure_signature(candidate_log),
        base_failure_signature=classifier.failure_signature(base_log),
        **gate_overrides,
    )))


class V2VerificationClassifierTest(unittest.TestCase):
    def test_worker_candidate_keeps_candidate_skip(self) -> None:
        self.assertEqual(
            classifier.resolve_verification_intent("CANDIDATE", "work/CORE/WORK-1"),
            ("CANDIDATE", "CANDIDATE_PHASE_SKIP"),
        )

    def test_worker_final_merge_request_keeps_formal_guard(self) -> None:
        self.assertEqual(
            classifier.resolve_verification_intent("FINAL_MERGE_REQUEST", "work/CORE/WORK-1"),
            ("FINAL_MERGE_REQUEST", "FORMAL_MERGE_REQUEST"),
        )

    def test_main_post_landing_readback_skips_only_merge_admission(self) -> None:
        self.assertEqual(
            classifier.resolve_verification_intent("POST_LANDING_READBACK", "main"),
            ("POST_LANDING_READBACK", "POST_LANDING_READBACK_SKIP"),
        )
        with self.assertRaisesRegex(ValueError, "POST_LANDING_READBACK_REQUIRES_MAIN_BRANCH"):
            classifier.resolve_verification_intent("POST_LANDING_READBACK", "work/CORE/WORK-1")

    def test_all_green(self) -> None:
        result = classify(payload(gate("catalog", changed_domain=True, rail_required=True)))
        self.assertEqual(result["verdicts"], {
            "CHANGE_VERIFICATION": "PASS",
            "RAIL_VERIFICATION": "PASS",
            "GLOBAL_SYSTEM_HEALTH": "PASS",
        })
        self.assertTrue(result["admission"]["eligible"])

    def test_changed_domain_failure_blocks(self) -> None:
        result = classify(payload(gate("catalog", "failure", changed_domain=True)))
        self.assertEqual(result["verdicts"]["CHANGE_VERIFICATION"], "FAIL")
        self.assertFalse(result["admission"]["eligible"])

    def test_rail_failure_blocks(self) -> None:
        result = classify(payload(gate("fulfillment", "failure", rail_required=True)))
        self.assertEqual(result["verdicts"]["RAIL_VERIFICATION"], "FAIL")
        self.assertFalse(result["admission"]["eligible"])

    def test_named_rail_without_bound_gate_is_held(self) -> None:
        result = classify(payload(gate("catalog"), rail_id="RAIL-FULFILLMENT"))
        self.assertEqual(result["verdicts"]["RAIL_VERIFICATION"], "HELD")
        self.assertFalse(result["admission"]["eligible"])

    def test_same_base_and_candidate_global_failure_is_pre_existing(self) -> None:
        result = classify(payload(
            gate("catalog", changed_domain=True),
            gate("system_diagnostics", "failure", base_outcome="failure", base_failure_signature="sig:system_diagnostics"),
        ))
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "PRE_EXISTING_GLOBAL_RED")
        self.assertEqual(result["verdicts"]["CHANGE_VERIFICATION"], "PASS")
        self.assertTrue(result["admission"]["eligible"])

    def test_base_pass_candidate_fail_is_new_global_regression(self) -> None:
        result = classify(payload(gate("system_diagnostics", "failure")))
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_same_identity_ignores_only_mutable_actual(self) -> None:
        base_log = node_assert_match_log(actual="export function assertMenu() { throw new Error('BASE-' + 'x'.repeat(200)); }")
        candidate_log = node_assert_match_log(actual="export function assertMenu() { throw new Error('CANDIDATE-' + 'y'.repeat(200)); }")
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "PRE_EXISTING_GLOBAL_RED")
        self.assertTrue(result["admission"]["eligible"])

    def test_node_spec_assert_match_same_identity_ignores_only_mutable_actual(self) -> None:
        base_log = node_spec_assert_match_log(actual="export const version='BASE-' + 'x'.repeat(500)")
        candidate_log = node_spec_assert_match_log(actual="export const version='CANDIDATE-' + 'y'.repeat(500)")
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "PRE_EXISTING_GLOBAL_RED")
        self.assertTrue(result["admission"]["eligible"])

    def test_node_spec_assert_match_different_test_identity_stays_new(self) -> None:
        base_log = node_spec_assert_match_log(actual="base")
        candidate_log = node_spec_assert_match_log(title="different semantic test identity", actual="candidate")
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_node_spec_assert_match_different_missing_regex_stays_new(self) -> None:
        base_log = node_spec_assert_match_log(actual="base")
        candidate_log = node_spec_assert_match_log(expected_regex=r"/differentExpectedContract/", actual="candidate")
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_node_spec_assert_match_truncated_identity_fails_closed(self) -> None:
        base_log = node_spec_assert_match_log(actual="base", include_operator=False)
        candidate_log = node_spec_assert_match_log(actual="candidate", include_operator=False)
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_node_spec_assert_match_ambiguous_failure_count_fails_closed(self) -> None:
        base_log = node_spec_assert_match_log(actual="base", fail_count=2)
        candidate_log = node_spec_assert_match_log(actual="candidate", fail_count=2)
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_base_pass_candidate_fail_stays_new(self) -> None:
        candidate_log = node_assert_match_log(actual="throw new Error('candidate only')")
        result = classify(payload(gate(
            "system_diagnostics",
            "failure",
            base_outcome="success",
            failure_signature=classifier.failure_signature(candidate_log),
            base_failure_signature=None,
        )))
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_different_test_identity_stays_new(self) -> None:
        base_log = node_assert_match_log(actual="throw new Error('base')")
        candidate_log = node_assert_match_log(
            title="different semantic test identity",
            actual="throw new Error('candidate')",
        )
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_different_missing_regex_stays_new(self) -> None:
        base_log = node_assert_match_log(actual="throw new Error('base')")
        candidate_log = node_assert_match_log(
            expected_regex=r"/differentExpectedContract/",
            actual="throw new Error('candidate')",
        )
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_truncated_identity_fails_closed(self) -> None:
        base_log = node_assert_match_log(actual="throw new Error('base')", include_operator=False)
        candidate_log = node_assert_match_log(actual="throw new Error('candidate')", include_operator=False)
        result = classified_global_failure(base_log, candidate_log)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_ambiguous_multiple_failures_fail_closed(self) -> None:
        first_base = node_assert_match_log(actual="throw new Error('base one')", fail_count=2)
        second_base = node_assert_match_log(
            title="second failing assertion",
            location="packages/example/second.test.ts:20:1",
            expected_regex=r"/secondExpected/",
            actual="throw new Error('base two')",
            fail_count=2,
        ).replace("not ok 1 -", "not ok 2 -", 1)
        first_candidate = node_assert_match_log(actual="throw new Error('candidate one')", fail_count=2)
        second_candidate = node_assert_match_log(
            title="second failing assertion",
            location="packages/example/second.test.ts:20:1",
            expected_regex=r"/secondExpected/",
            actual="throw new Error('candidate two')",
            fail_count=2,
        ).replace("not ok 1 -", "not ok 2 -", 1)
        result = classified_global_failure(first_base + second_base, first_candidate + second_candidate)
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_equivalence_does_not_weaken_change(self) -> None:
        base_log = node_assert_match_log(actual="throw new Error('base')")
        candidate_log = node_assert_match_log(actual="throw new Error('candidate')")
        result = classified_global_failure(base_log, candidate_log, changed_domain=True)
        self.assertEqual(result["verdicts"]["CHANGE_VERIFICATION"], "FAIL")
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "PRE_EXISTING_GLOBAL_RED")
        self.assertFalse(result["admission"]["eligible"])

    def test_structured_node_assert_match_equivalence_does_not_weaken_rail(self) -> None:
        base_log = node_assert_match_log(actual="throw new Error('base')")
        candidate_log = node_assert_match_log(actual="throw new Error('candidate')")
        result = classified_global_failure(base_log, candidate_log, rail_required=True)
        self.assertEqual(result["verdicts"]["RAIL_VERIFICATION"], "FAIL")
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "PRE_EXISTING_GLOBAL_RED")
        self.assertFalse(result["admission"]["eligible"])

    def test_post_landing_core_regression_still_fails(self) -> None:
        result = classify(payload(
            gate("order", "failure", changed_domain=True),
            gate("merge_request"),
            branch_name="main",
            verification_phase="POST_LANDING_READBACK",
            merge_request_guard_mode="POST_LANDING_READBACK_SKIP",
        ))
        self.assertEqual(result["verdicts"]["CHANGE_VERIFICATION"], "FAIL")
        self.assertFalse(result["admission"]["eligible"])

    def test_post_landing_mode_cannot_wash_global_system_health_red(self) -> None:
        result = classify(payload(
            gate("system_diagnostics", "failure"),
            gate("merge_request"),
            branch_name="main",
            verification_phase="POST_LANDING_READBACK",
            merge_request_guard_mode="POST_LANDING_READBACK_SKIP",
        ))
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "NEW_GLOBAL_REGRESSION")
        self.assertFalse(result["admission"]["eligible"])

    def test_verification_intent_is_sealed_in_evidence_identity(self) -> None:
        result = classify(payload(gate("merge_request")))
        self.assertEqual(result["identity"]["branch_name"], "work/CORE/WORK-1")
        self.assertEqual(result["identity"]["verification_phase"], "CANDIDATE")
        self.assertEqual(result["identity"]["merge_request_guard_mode"], "CANDIDATE_PHASE_SKIP")

    def test_missing_baseline_is_held(self) -> None:
        result = classify(payload(
            gate("system_diagnostics", "failure", base_outcome=None),
            base_sha=None,
        ))
        self.assertEqual(result["verdicts"]["GLOBAL_SYSTEM_HEALTH"], "HELD")
        self.assertFalse(result["admission"]["eligible"])

    def test_later_gate_evidence_survives_earlier_failure(self) -> None:
        result = classify(payload(
            gate("system_diagnostics", "failure", base_outcome="failure", base_failure_signature="sig:system_diagnostics"),
            gate("inventory"),
            gate("integration"),
            gate("typescript"),
            gate("governance"),
        ))
        outcomes = {entry["gate_id"]: entry["outcome"] for entry in result["gate_outcomes"]}
        self.assertEqual(outcomes["system_diagnostics"], "failure")
        self.assertEqual(outcomes["governance"], "success")
        self.assertEqual(len(outcomes), 5)

    def test_formal_core_workflow_collects_later_gate_evidence_before_final_verdict(self) -> None:
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/verify-v2-core.yml").read_text(encoding="utf-8")
        for gate_id in ("system_diagnostics", "inventory", "integration", "typescript", "governance", "merge_request"):
            marker = f"        id: {gate_id}\n        continue-on-error: true"
            self.assertIn(marker, workflow)
        ordered = [
            workflow.index("id: system_diagnostics"), workflow.index("id: inventory"),
            workflow.index("id: integration"), workflow.index("id: typescript"),
            workflow.index("id: governance"), workflow.index("id: merge_request"),
            workflow.index("name: Write evidence manifest"), workflow.index("name: Enforce classified final verdict"),
        ]
        self.assertEqual(ordered, sorted(ordered))

    def test_formal_core_workflow_routes_post_landing_intent_without_weakening_final_merge(self) -> None:
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/verify-v2-core.yml").read_text(encoding="utf-8")
        self.assertIn("- POST_LANDING_READBACK", workflow)
        self.assertIn("merge_request_guard_mode=$MERGE_REQUEST_GUARD_MODE", workflow)
        self.assertIn("POST_LANDING_READBACK_PHASE_SKIP", workflow)
        self.assertIn("formal_merge_request_not_applicable=already_landed", workflow)
        self.assertIn("FORMAL_MERGE_REQUEST)", workflow)
        self.assertGreaterEqual(workflow.count("python3 scripts/merge_request_guard.py"), 2)

    def test_admission_consumes_formal_verdict_without_false_global_green(self) -> None:
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/v2-builder-admission-queue.yml").read_text(encoding="utf-8")
        self.assertIn(".ci-results/v2-core.json", workflow)
        self.assertIn('global_green={str(global_health == "PASS").lower()}', workflow)
        self.assertIn("PHYSICAL_PROOF_REFERENCE_REQUIRED", workflow)


if __name__ == "__main__":
    unittest.main()
