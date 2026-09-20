import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ring1b_functional_adb import AdbBackend, UiHierarchyUnavailable  # noqa: E402
from ring1b_functional_driver import FunctionalDriver  # noqa: E402
from ring1b_functional_core import (  # noqa: E402
    DriverFailure,
    ManifestError,
    R1B_ACTION_NO_STATE_CHANGE,
    R1B_EXPECTED_STATE_NOT_REACHED,
    R1B_SELECTOR_NOT_FOUND,
    R1B_RESTART_PERSISTENCE_MISMATCH,
    R1B_UI_HIERARCHY_UNAVAILABLE,
    R1B_UNEXPECTED_RECOVERY_SURFACE,
    expectation_matches,
    load_json,
    make_observation,
    resolve_tap_coordinates,
    selector_present,
    validate_manifest,
    validate_selector_map,
)

FIX = ROOT / "tests" / "fixtures"


class FakeBackend:
    def __init__(self, observations):
        self.observations = list(observations)
        self.last = self.observations[0]
        self.taps = []
        self.captures = []
        self.launches = 0
        self.stops = 0

    def observe(self):
        if self.observations:
            self.last = self.observations.pop(0)
        return self.last

    def capture_evidence(self, label, obs=None):
        self.captures.append(label)
        return obs or self.last

    def tap(self, x, y):
        self.taps.append((x, y))

    def force_stop(self):
        self.stops += 1

    def launch(self):
        self.launches += 1

    def sleep(self, seconds):
        pass


class ScriptedAdbBackend(AdbBackend):
    def __init__(self, evidence_dir, attempts, *, max_attempts=None, readback_max_attempts=1):
        self.scripted_attempts = list(attempts)
        self.current_dump_index = 0
        self.current_cat_index = 0
        self.dump_calls = 0
        self.cat_calls = 0
        super().__init__(
            "com.morefunos.smt",
            ".MainActivity",
            evidence_dir,
            hierarchy_max_attempts=max_attempts or len(self.scripted_attempts),
            hierarchy_retry_ms=0,
            hierarchy_readback_max_attempts=readback_max_attempts,
            hierarchy_readback_retry_ms=0,
        )

    def _run(self, args, *, check=True, timeout=30):
        if args[0] == "shell" and len(args) == 2 and args[1].startswith("rm -f "):
            return subprocess.CompletedProcess(args, 0, "", "")
        if args[:3] == ["shell", "uiautomator", "dump"]:
            self.current_dump_index = min(self.dump_calls, len(self.scripted_attempts) - 1)
            self.current_cat_index = 0
            self.dump_calls += 1
            item = self.scripted_attempts[self.current_dump_index]
            return subprocess.CompletedProcess(
                args,
                item.get("dump_rc", 0),
                item.get("dump_stdout", "UI hierchary dumped to: /sdcard/test.xml\n"),
                item.get("dump_stderr", ""),
            )
        if args[:2] == ["exec-out", "cat"]:
            item = self.scripted_attempts[self.current_dump_index]
            payloads = item.get("cat_payloads", [item.get("payload", "")])
            payload = payloads[min(self.current_cat_index, len(payloads) - 1)]
            self.current_cat_index += 1
            self.cat_calls += 1
            return subprocess.CompletedProcess(
                args,
                item.get("cat_rc", 0),
                payload,
                item.get("cat_stderr", ""),
            )
        if args == ["shell", "dumpsys activity activities"]:
            return subprocess.CompletedProcess(args, 0, "mResumedActivity: MainActivity\n", "")
        raise AssertionError(f"unexpected adb call: {args}")


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


class Ring1BFunctionalDriverTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load_json(FIX / "synthetic-manifest.json")
        self.selectors = validate_selector_map(load_json(FIX / "synthetic-selectors.json"))
        validate_manifest(self.manifest, self.selectors)
        self.before = make_observation(read("ui-before.xml"), "mResumedActivity: MainActivity")
        self.after = make_observation(read("ui-after.xml"), "mResumedActivity: MainActivity")
        self.fault = make_observation(read("ui-fault.xml"), "mResumedActivity: CarrierRecoveryActivity")

    def test_manifest_parsing_and_reference_validation(self):
        broken = json.loads(json.dumps(self.manifest))
        broken["steps"][1]["target"] = "missing_selector"
        with self.assertRaises(ManifestError):
            validate_manifest(broken, self.selectors)

    def test_chain4_auth_deferred_provenance_is_required_not_forbidden(self):
        names = (
            "867-chain4-payment-certainty-nominal-prep.json",
            "867-chain4-payment-certainty-unknown-retry-prep.json",
            "867-chain4-config-revision-missing-prep.json",
            "867-chain4-config-revision-invalid-prep.json",
        )
        for name in names:
            manifest = load_json(ROOT / "manifests" / name)
            boot_expect = manifest["steps"][0]["expect"]
            self.assertIn("auth_deferred", boot_expect.get("present", []), name)
            self.assertIn("mock_core_authority", boot_expect.get("absent", []), name)
            for step in manifest["steps"]:
                expect = step.get("expect", {})
                self.assertNotIn("auth_deferred", expect.get("absent", []), f"{name}:{step['id']}")

    def test_chain4_restart_contract_reads_terminal_attempt_without_restored_cart(self):
        nominal = load_json(ROOT / "manifests" / "867-chain4-payment-certainty-nominal-prep.json")
        nominal_steps = {step["id"]: step for step in nominal["steps"]}
        terminal = {
            "checkout_workspace",
            "payment_certainty",
            "payment_attempt_id",
            "payment_status_confirmed",
            "payment_replay_safe_true",
            "payment_result_confirmed",
            "payment_config_source_lkg",
            "payment_config_version_nonproduction",
            "payment_config_revision_one",
        }
        self.assertTrue(terminal.issubset(nominal_steps["confirm-cash-payment"]["expect"]["present"]))
        self.assertTrue(terminal.issubset(nominal_steps["restart-confirmed-payment-readback"]["persistence"]["after"]))
        self.assertTrue(
            {"payment_attempt_id", "payment_status_confirmed", "payment_result_confirmed"}.issubset(
                nominal_steps["restart-confirmed-payment-readback"]["persistence"]["before"]
            )
        )
        self.assertTrue(
            {"cart_product_riceball", "cart_combo_riceball", "cart_total_100"}.isdisjoint(
                nominal_steps["restart-confirmed-payment-readback"]["persistence"]["after"]
            )
        )
        self.assertNotIn("reopen-confirmed-payment-after-restart", nominal_steps)

    def test_chain4_fps_manual_confirmation_and_restart_require_real_provenance(self):
        scenario = load_json(ROOT / "manifests" / "867-chain4-payment-certainty-unknown-retry-prep.json")
        steps = {step["id"]: step for step in scenario["steps"]}
        unknown = {
            "checkout_workspace",
            "payment_certainty",
            "payment_attempt_id",
            "payment_status_unknown",
            "payment_replay_safe_true",
            "payment_result_unknown",
            "staff_confirm_payment",
        }
        confirmed = {
            "checkout_workspace",
            "payment_certainty",
            "payment_attempt_id",
            "payment_status_confirmed",
            "payment_replay_safe_true",
            "payment_result_confirmed",
            "payment_verification_provenance_staff_manual",
            "payment_verification_actor_simulation",
            "payment_verification_context_nonproduction",
        }
        self.assertTrue(unknown.issubset(steps["restart-unknown-payment-readback"]["persistence"]["after"]))
        self.assertTrue(confirmed.issubset(steps["confirm-same-payment-attempt-manually"]["expect"]["present"]))
        self.assertTrue(
            confirmed.issubset(steps["restart-manually-confirmed-payment-readback"]["persistence"]["before"])
        )
        self.assertTrue(
            confirmed.issubset(steps["restart-manually-confirmed-payment-readback"]["persistence"]["after"])
        )
        self.assertNotIn("reopen-unknown-payment-after-restart", steps)

        selectors = validate_selector_map(
            load_json(ROOT / "manifests" / "867-chain4-payment-certainty-selectors.json")
        )
        self.assertEqual(
            selectors["payment_verification_provenance_staff_manual"],
            {"text": "paymentVerificationProvenance STAFF_MANUAL_VERIFICATION"},
        )
        self.assertEqual(
            selectors["payment_verification_actor_simulation"],
            {"text": "paymentVerificationActor AUTH_DEFERRED_SIMULATION_ACTOR"},
        )
        self.assertEqual(
            selectors["payment_verification_context_nonproduction"],
            {"text": "paymentVerificationContext AUTH_DEFERRED/SIMULATION/NON_PRODUCTION"},
        )

    def test_exact_text_remains_exact_when_contains_exists(self):
        self.assertTrue(selector_present(self.before.ui_xml, {"text": "Rice Ball"}))
        self.assertFalse(selector_present(self.before.ui_xml, {"text": "Rice"}))
        self.assertEqual(resolve_tap_coordinates(self.before.ui_xml, {"text": "Rice Ball"}), (250, 200))

    def test_text_contains_matches_rule_fragment_in_multiline_node(self):
        xml = """<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0"><node text="可任意次序選擇；合法組合與價格由 Admin / Menu / Pricing Authority 自動判斷。&#10;M03_COMBO_REQUIRED_SELECTION_MISSING" resource-id="rule" class="android.view.View" package="synthetic" content-desc="" bounds="[0,0][100,100]" /></hierarchy>"""
        selector = {"text_contains": "可任意次序選擇；合法組合與價格由 Admin / Menu / Pricing Authority 自動判斷。"}
        self.assertTrue(selector_present(xml, selector))

    def test_text_contains_matches_code_fragment_in_same_multiline_node(self):
        xml = """<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0"><node text="可任意次序選擇；合法組合與價格由 Admin / Menu / Pricing Authority 自動判斷。&#10;M03_COMBO_REQUIRED_SELECTION_MISSING" resource-id="rule" class="android.view.View" package="synthetic" content-desc="" bounds="[0,0][100,100]" /></hierarchy>"""
        self.assertTrue(selector_present(xml, {"text_contains": "M03_COMBO_REQUIRED_SELECTION_MISSING"}))

    def test_text_contains_missing_substring_is_false(self):
        xml = """<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0"><node text="rule&#10;M03_COMBO_REQUIRED_SELECTION_MISSING" resource-id="rule" class="android.view.View" package="synthetic" content-desc="" bounds="[0,0][100,100]" /></hierarchy>"""
        self.assertFalse(selector_present(xml, {"text_contains": "M03_OTHER_CODE"}))

    def test_selector_schema_and_validator_accept_text_contains_but_reject_unknown_key(self):
        schema = load_json(ROOT / "schemas" / "ring1b-selector-map.schema.json")
        locator = schema["properties"]["selectors"]["additionalProperties"]
        self.assertEqual(locator["properties"]["text_contains"], {"type": "string", "minLength": 1})
        self.assertIn({"required": ["text_contains"]}, locator["anyOf"])
        validated = validate_selector_map(
            {"schema_version": 1, "selectors": {"rule": {"text_contains": "literal fragment"}}}
        )
        self.assertEqual(validated["rule"]["text_contains"], "literal fragment")
        with self.assertRaises(ManifestError):
            validate_selector_map(
                {"schema_version": 1, "selectors": {"bad": {"text_contains": "literal", "regex": ".*"}}}
            )

    def test_text_contains_cannot_be_used_as_tap_target(self):
        selectors = dict(self.selectors)
        selectors["contains_target"] = {"text_contains": "Rice"}
        manifest = json.loads(json.dumps(self.manifest))
        manifest["steps"][1]["target"] = "contains_target"
        with self.assertRaises(ManifestError):
            validate_manifest(manifest, selectors)
        self.assertIsNone(resolve_tap_coordinates(self.before.ui_xml, selectors["contains_target"]))

    def test_selector_fallback_order_reaches_text_when_resource_id_misses(self):
        selector = {
            "resource_id": "com.synthetic:id/does-not-exist",
            "text": "Rice Ball",
            "content_desc": "unused",
            "bounds": [1, 1, 2, 2],
        }
        self.assertEqual(resolve_tap_coordinates(self.before.ui_xml, selector), (250, 200))

    def test_expectation_match(self):
        self.assertFalse(expectation_matches(self.before, {"present": ["cart_line"]}, self.selectors))
        self.assertTrue(expectation_matches(self.after, {"present": ["cart_line"]}, self.selectors))

    def test_selector_fallback_reaches_content_desc(self):
        selector = {
            "resource_id": "com.synthetic:id/does-not-exist",
            "text": "does not exist",
            "content_desc": "product tile",
            "bounds": [1, 1, 2, 2],
        }
        self.assertEqual(resolve_tap_coordinates(self.before.ui_xml, selector), (250, 200))

    def test_selector_explicit_bounds_fallback(self):
        self.assertEqual(resolve_tap_coordinates(self.before.ui_xml, {"bounds": [10, 20, 30, 40]}), (20, 30))

    def test_synthetic_red_noop_then_green_transition(self):
        tap_step = self.manifest["steps"][1]
        red_manifest = dict(self.manifest)
        red_manifest["steps"] = [tap_step]
        red_backend = FakeBackend([self.before, self.before, self.before])
        red_driver = FunctionalDriver(red_manifest, self.selectors, red_backend)
        with self.assertRaises(DriverFailure) as ctx:
            red_driver.run()
        self.assertEqual(ctx.exception.code, R1B_ACTION_NO_STATE_CHANGE)

        green_backend = FakeBackend([self.before, self.after])
        green_driver = FunctionalDriver(red_manifest, self.selectors, green_backend)
        result = green_driver.run()
        self.assertEqual(result["result"], "GREEN")
        self.assertEqual(green_backend.taps, [(250, 200)])

    def test_preexisting_expected_state_does_not_hide_noop_tap(self):
        tap_step = self.manifest["steps"][1]
        manifest = dict(self.manifest)
        manifest["steps"] = [tap_step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.after, self.after, self.after]))
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_ACTION_NO_STATE_CHANGE)

    def test_restart_reset_expected_assertion(self):
        step = {
            "id": "restart-reset",
            "action": "restart",
            "timeout_ms": 50,
            "persistence": {"mode": "RESET_EXPECTED", "before": ["cart_line"], "after": ["product_tile"]},
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.after, self.before]))
        result = driver.run()
        self.assertEqual(result["result"], "GREEN")

    def test_restart_recover_assertion(self):
        step = {
            "id": "restart-recover",
            "action": "restart",
            "timeout_ms": 50,
            "persistence": {"mode": "RECOVER", "before": ["product_tile"], "after": ["cart_line"]},
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.before, self.after]))
        result = driver.run()
        self.assertEqual(result["result"], "GREEN")

    def test_tap_expectation_already_true_still_requires_transition(self):
        step = {
            "id": "tap-product-again",
            "action": "tap",
            "target": "product_tile",
            "expect": {"present": ["cart_line"]},
            "timeout_ms": 50,
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.after, self.after, self.after]))
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_ACTION_NO_STATE_CHANGE)

    def test_restart_modes_preserve_reset_and_recover_are_asserted(self):
        cases = [
            ("PRESERVE", self.after, self.after, ["cart_line"], ["cart_line"]),
            ("RESET_EXPECTED", self.after, self.before, ["cart_line"], ["product_tile"]),
            ("RECOVER", self.after, self.before, ["cart_line"], ["product_tile"]),
        ]
        for mode, before, after, before_names, after_names in cases:
            with self.subTest(mode=mode):
                step = {
                    "id": f"restart-{mode.lower()}",
                    "action": "restart",
                    "timeout_ms": 50,
                    "persistence": {
                        "mode": mode,
                        "before": before_names,
                        "after": after_names,
                    },
                }
                manifest = dict(self.manifest)
                manifest["steps"] = [step]
                driver = FunctionalDriver(manifest, self.selectors, FakeBackend([before, after]))
                result = driver.run()
                self.assertEqual(result["result"], "GREEN")

    def test_selector_not_found_has_stable_code(self):
        selectors = dict(self.selectors)
        selectors["missing_target"] = {"resource_id": "com.synthetic:id/missing"}
        step = {
            "id": "tap-missing",
            "action": "tap",
            "target": "missing_target",
            "expect": {"present": ["cart_line"]},
            "timeout_ms": 50,
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, selectors, FakeBackend([self.before]))
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_SELECTOR_NOT_FOUND)

    def test_changed_but_wrong_state_has_expected_state_not_reached_code(self):
        changed_wrong_xml = read("ui-before.xml").replace("Rice Ball", "Rice Ball Selected")
        changed_wrong = make_observation(changed_wrong_xml, "mResumedActivity: MainActivity")
        step = self.manifest["steps"][1]
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.before, changed_wrong, changed_wrong]))
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_EXPECTED_STATE_NOT_REACHED)

    def test_visible_fault_is_immediate_red(self):
        step = {"id": "boot", "action": "checkpoint", "expect": {"present": ["product_tile"]}, "timeout_ms": 50}
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        driver = FunctionalDriver(manifest, self.selectors, FakeBackend([self.fault]))
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_UNEXPECTED_RECOVERY_SURFACE)

    def test_restart_persistence_mismatch_has_stable_code(self):
        step = {
            "id": "restart-cart",
            "action": "restart",
            "timeout_ms": 50,
            "persistence": {"mode": "PRESERVE", "before": ["cart_line"], "after": ["cart_line"]},
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        backend = FakeBackend([self.after, self.before, self.before])
        driver = FunctionalDriver(manifest, self.selectors, backend)
        with self.assertRaises(DriverFailure) as ctx:
            driver.run()
        self.assertEqual(ctx.exception.code, R1B_RESTART_PERSISTENCE_MISMATCH)

    def test_ui_hierarchy_empty_readback_is_bounded_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(tmp, [{"payload": ""}, {"payload": ""}], max_attempts=2)
            with self.assertRaises(UiHierarchyUnavailable) as ctx:
                backend.observe()
            self.assertIn("attempts=2/2", ctx.exception.summary)
            self.assertIn("empty_readback", ctx.exception.summary)
            self.assertTrue((Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").is_file())

    def test_ui_hierarchy_valid_immediate_xml_uses_one_dump_and_one_readback(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(tmp, [{"payload": read("ui-before.xml")}], max_attempts=1)
            obs = backend.observe()
            self.assertIn("Rice Ball", obs.ui_xml)
            self.assertEqual(backend.dump_calls, 1)
            self.assertEqual(backend.cat_calls, 1)

    def test_ui_hierarchy_delayed_file_materialization_recovers_without_second_dump(self):
        missing = "cat: /sdcard/r1b.xml: No such file or directory\n"
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [{"cat_payloads": [missing, read("ui-before.xml")]}],
                max_attempts=1,
                readback_max_attempts=2,
            )
            obs = backend.observe()
            self.assertIn("Rice Ball", obs.ui_xml)
            self.assertEqual(backend.dump_calls, 1)
            self.assertEqual(backend.cat_calls, 2)
            summary = json.loads(
                (Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").read_text(encoding="utf-8")
            )
            self.assertTrue(summary["recovered"])
            self.assertEqual(summary["attempts"][0]["readback_count"], 2)

    def test_ui_hierarchy_rc0_file_absent_is_bounded_unavailable(self):
        missing = "cat: /sdcard/r1b.xml: No such file or directory\n"
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [{"payload": missing}, {"payload": missing}],
                max_attempts=2,
                readback_max_attempts=3,
            )
            with self.assertRaises(UiHierarchyUnavailable) as ctx:
                backend.observe()
            self.assertIn("file_absent", ctx.exception.summary)
            self.assertIn("attempts=2/2", ctx.exception.summary)
            self.assertEqual(backend.dump_calls, 2)
            self.assertEqual(backend.cat_calls, 6)
            summary = json.loads(
                (Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").read_text(encoding="utf-8")
            )
            self.assertFalse(summary["recovered"])
            self.assertEqual([item["readback_count"] for item in summary["attempts"]], [3, 3])

    def test_ui_hierarchy_null_root_recovers_within_bounded_attempts(self):
        missing = "cat: /sdcard/r1b.xml: No such file or directory\n"
        null_root = "ERROR: null root node returned by UiTestAutomationBridge.\n"
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [
                    {"payload": missing, "dump_stderr": null_root},
                    {"payload": missing, "dump_stderr": null_root},
                    {"payload": missing, "dump_stderr": null_root},
                    {"payload": missing, "dump_stderr": null_root},
                    {"payload": missing, "dump_stderr": null_root},
                    {"payload": read("ui-before.xml")},
                ],
                max_attempts=6,
            )
            obs = backend.observe()
            self.assertIn("Rice Ball", obs.ui_xml)
            self.assertEqual(backend.dump_calls, 6)
            summary = json.loads(
                (Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertTrue(summary["recovered"])
            self.assertEqual(
                [item["classification"] for item in summary["attempts"]],
                ["root_not_materialized"] * 5 + ["valid_xml"],
            )

    def test_ui_hierarchy_persistent_null_root_remains_deterministic_red(self):
        missing = "cat: /sdcard/r1b.xml: No such file or directory\n"
        null_root = "ERROR: null root node returned by UiTestAutomationBridge.\n"
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [{"payload": missing, "dump_stderr": null_root}] * 6,
                max_attempts=6,
            )
            with self.assertRaises(UiHierarchyUnavailable) as ctx:
                backend.observe()
            self.assertIn("attempts=6/6", ctx.exception.summary)
            self.assertIn("root_not_materialized", ctx.exception.summary)
            summary = json.loads(
                (Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertFalse(summary["recovered"])
            self.assertEqual(
                [item["classification"] for item in summary["attempts"]],
                ["root_not_materialized"] * 6,
            )

    def test_ui_hierarchy_non_xml_readback_is_bounded_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(tmp, [{"payload": "UI hierarchy unavailable"}], max_attempts=1)
            with self.assertRaises(UiHierarchyUnavailable) as ctx:
                backend.observe()
            self.assertIn("non_xml_readback", ctx.exception.summary)

    def test_ui_hierarchy_invalid_first_valid_later_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [{"payload": "<hierarchy"}, {"payload": read("ui-before.xml")}],
                max_attempts=2,
            )
            obs = backend.observe()
            self.assertIn("Rice Ball", obs.ui_xml)
            summary = json.loads(
                (Path(tmp) / "ui-hierarchy-observation" / "observation-0001" / "summary.json").read_text(encoding="utf-8")
            )
            self.assertTrue(summary["recovered"])
            self.assertEqual(summary["attempt_count"], 2)
            self.assertEqual(summary["attempts"][0]["classification"], "invalid_xml")
            self.assertEqual(summary["attempts"][1]["classification"], "valid_xml")

    def test_ui_hierarchy_dump_and_cat_failures_are_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(
                tmp,
                [
                    {"dump_rc": 1, "dump_stderr": "dump failed", "cat_rc": 1, "cat_stderr": "missing"},
                    {"dump_rc": 0, "cat_rc": 1, "cat_stderr": "cat failed"},
                ],
                max_attempts=2,
            )
            with self.assertRaises(UiHierarchyUnavailable) as ctx:
                backend.observe()
            self.assertIn("dump_failure", ctx.exception.summary)
            self.assertIn("cat_failure", ctx.exception.summary)

    def test_persistent_invalid_hierarchy_maps_to_stable_driver_failure(self):
        step = {
            "id": "boot-auth-deferred-menu",
            "action": "checkpoint",
            "expect": {"present": ["product_tile"]},
            "timeout_ms": 50,
        }
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        with tempfile.TemporaryDirectory() as tmp:
            backend = ScriptedAdbBackend(tmp, [{"payload": "<hierarchy"}, {"payload": "<hierarchy"}], max_attempts=2)
            driver = FunctionalDriver(manifest, self.selectors, backend)
            with self.assertRaises(DriverFailure) as ctx:
                driver.run()
            failure = ctx.exception
            self.assertEqual(failure.code, R1B_UI_HIERARCHY_UNAVAILABLE)
            self.assertEqual(failure.step_id, "boot-auth-deferred-menu")
            self.assertEqual(failure.expected, "valid UIAutomator hierarchy")
            self.assertEqual(failure.layer, "ANDROID_UI_OBSERVATION")
            self.assertIn("attempts=2/2", failure.actual)
            self.assertIn("invalid_xml", failure.actual)


if __name__ == "__main__":
    unittest.main()
