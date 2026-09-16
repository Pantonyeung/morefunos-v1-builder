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
        self.assertIn("global_green={str(global_health == \"PASS\").lower()}", workflow)
        self.assertIn("PHYSICAL_PROOF_REFERENCE_REQUIRED", workflow)


if __name__ == "__main__":
    unittest.main()
