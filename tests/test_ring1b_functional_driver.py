import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ring1b_functional_driver import FunctionalDriver  # noqa: E402
from ring1b_functional_core import (  # noqa: E402
    DriverFailure,
    ManifestError,
    R1B_ACTION_NO_STATE_CHANGE,
    R1B_EXPECTED_STATE_NOT_REACHED,
    R1B_SELECTOR_NOT_FOUND,
    R1B_RESTART_PERSISTENCE_MISMATCH,
    R1B_UNEXPECTED_RECOVERY_SURFACE,
    expectation_matches,
    load_json,
    make_observation,
    resolve_tap_coordinates,
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


if __name__ == "__main__":
    unittest.main()
