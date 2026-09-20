import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ring1b_functional_adb import AdbBackend  # noqa: E402
from ring1b_functional_driver import FunctionalDriver  # noqa: E402
from ring1b_functional_core import (  # noqa: E402
    DriverFailure,
    HierarchyCaptureError,
    ManifestError,
    R1B_ACTION_NO_STATE_CHANGE,
    R1B_EXPECTED_STATE_NOT_REACHED,
    R1B_SELECTOR_NOT_FOUND,
    R1B_UI_HIERARCHY_UNAVAILABLE,
    R1B_RESTART_PERSISTENCE_MISMATCH,
    R1B_STORE_KERNEL_ASSERTION_FAILED,
    R1B_UNEXPECTED_RECOVERY_SURFACE,
    StoreKernelAssertionError,
    assert_store_kernel_transition,
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
        self.network_states = []
        self.process_deaths = []
        self.store_kernel_snapshots = []

    def observe(self):
        if self.observations:
            self.last = self.observations.pop(0)
        if isinstance(self.last, BaseException):
            raise self.last
        return self.last

    def capture_evidence(self, label, obs=None):
        self.captures.append(label)
        return obs or self.last

    def tap(self, x, y):
        self.taps.append((x, y))

    def rapid_tap(self, x, y, count, interval_ms, label):
        for _ in range(count):
            self.taps.append((x, y))

    def process_death_on_store_kernel_wal_change(self, x, y, timeout_ms, label):
        self.taps.append((x, y))
        self.process_deaths.append((timeout_ms, label))
        self.stops += 1
        return {"result": "KILLED_ON_WAL_CHANGE"}

    def set_network_state(self, state, label):
        self.network_states.append((state, label))

    def capture_store_kernel(self, label):
        if not self.store_kernel_snapshots:
            raise AssertionError(f"no Store Kernel snapshot queued for {label}")
        return self.store_kernel_snapshots.pop(0)

    def force_stop(self):
        self.stops += 1

    def launch(self):
        self.launches += 1

    def sleep(self, seconds):
        pass


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


def store_kernel_snapshot(*tenders):
    aggregates = []
    receipts = []
    outbox = []
    journal = []
    for index, tender in enumerate(tenders, start=1):
        order_id = f"order-{index}"
        payment_id = f"payment-{index}"
        fulfillment_id = f"fulfillment-{index}"
        print_id = f"print-{index}"
        display_code = f"#{index:04d}"
        trace_id = f"trace-{index}"
        result = {
            "ok": True,
            "orderId": order_id,
            "paymentId": payment_id,
            "fulfillmentId": fulfillment_id,
            "printAdmissionId": print_id,
            "displayOrderCode": display_code,
        }
        receipts.append({
            "store_id": "store-1",
            "operation_id": "STORE_CHECKOUT_COMMIT",
            "idempotency_key": f"idem-{index}",
            "command_id": f"command-{index}",
            "request_fingerprint": f"fingerprint-{index}",
            "result_json": json.dumps(result),
            "result_hash": f"result-hash-{index}",
            "trace_id": trace_id,
            "commit_sequence": index,
            "committed_at": f"2026-09-20T00:00:0{index}.000Z",
        })
        states = {
            "ORDER_DISPLAY_ASSIGNMENT": {
                "orderId": order_id,
                "displayOrderCode": display_code,
            },
            "ORDER": {"orderId": order_id, "localDisplayOrderCode": display_code},
            "PAYMENT": {
                "paymentId": payment_id,
                "orderId": order_id,
                "tenderMethod": tender,
                "lifecycleStatus": "COMPLETED",
                "evidenceProvenance": "STAFF_OBSERVED",
            },
            "FULFILLMENT": {"fulfillmentId": fulfillment_id, "orderId": order_id},
            "ORDER_PRINT_ADMISSION": {"printAdmissionId": print_id, "orderId": order_id, "status": "ADMITTED"},
        }
        for aggregate_type, state in states.items():
            aggregate_id = {
                "ORDER_DISPLAY_ASSIGNMENT": f"assignment-{index}",
                "ORDER": order_id,
                "PAYMENT": payment_id,
                "FULFILLMENT": fulfillment_id,
                "ORDER_PRINT_ADMISSION": print_id,
            }[aggregate_type]
            aggregates.append({
                "store_id": "store-1",
                "aggregate_type": aggregate_type,
                "aggregate_id": aggregate_id,
                "revision": 1,
                "state_json": json.dumps(state),
                "state_hash": f"state-hash-{aggregate_type}-{index}",
                "updated_at": f"2026-09-20T00:00:0{index}.000Z",
            })
        for event_type, aggregate_type, aggregate_id in (
            ("OrderAccepted", "ORDER", order_id),
            ("PaymentCompleted", "PAYMENT", payment_id),
            ("ProductionReleased", "FULFILLMENT", fulfillment_id),
            ("OrderPrintAdmissionRequested", "ORDER_PRINT_ADMISSION", print_id),
        ):
            outbox.append({
                "event_id": f"{event_type}-{index}",
                "store_id": "store-1",
                "aggregate_type": aggregate_type,
                "aggregate_id": aggregate_id,
                "aggregate_revision": 1,
                "event_type": event_type,
                "occurred_at": f"2026-09-20T00:00:0{index}.000Z",
                "payload_json": "{}",
                "payload_hash": f"payload-hash-{event_type}-{index}",
                "status": "PENDING",
                "attempt_count": 0,
                "lease_owner": None,
                "lease_expires_at_epoch_ms": 0,
                "last_attempt_at": None,
                "last_error": None,
                "acknowledged_at": None,
            })
        for sequence, stage in enumerate(("RECEIVED", "VALIDATED", "LOCAL_TX_COMMITTED"), start=1):
            journal.append({
                "trace_id": trace_id,
                "checkpoint_id": f"{trace_id}:{sequence}",
                "command_id": f"command-{index}",
                "sequence": sequence,
                "stage": stage,
                "outcome": "OK",
                "code": None,
                "detail_json": "{}",
                "observed_at": f"2026-09-20T00:00:0{index}.000Z",
            })
    return {
        "aggregates": aggregates,
        "receipts": receipts,
        "inbox": [],
        "outbox": outbox,
        "journal": journal,
    }


def store_kernel_database_bytes():
    with tempfile.TemporaryDirectory() as temp_dir:
        database = Path(temp_dir) / "morefun_store_kernel.db"
        connection = sqlite3.connect(database)
        try:
            connection.executescript(
                """
                CREATE TABLE store_kernel_aggregate (
                    store_id TEXT, aggregate_type TEXT, aggregate_id TEXT
                );
                CREATE TABLE store_kernel_command_receipt (commit_sequence INTEGER);
                CREATE TABLE store_kernel_inbox (
                    store_id TEXT, source TEXT, source_event_id TEXT
                );
                CREATE TABLE store_kernel_outbox (event_id TEXT);
                CREATE TABLE store_kernel_diagnostic_journal (
                    trace_id TEXT, sequence INTEGER
                );
                """
            )
        finally:
            connection.close()
        return database.read_bytes()


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

    def test_empty_and_non_xml_hierarchy_are_retried_inside_step_timeout(self):
        step = {"id": "boot", "action": "checkpoint", "expect": {"present": ["product_tile"]}, "timeout_ms": 50}
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        backend = FakeBackend(
            [
                make_observation(read("ui-empty.xml"), "mResumedActivity: MainActivity"),
                make_observation(read("ui-nonxml.txt"), "mResumedActivity: MainActivity"),
                self.before,
            ]
        )

        result = FunctionalDriver(manifest, self.selectors, backend).run()

        self.assertEqual(result["last_green"], "boot")

    def test_hierarchy_capture_timeout_is_deterministic_driver_failure(self):
        step = {"id": "boot", "action": "checkpoint", "expect": {"present": ["product_tile"]}, "timeout_ms": 1}
        manifest = dict(self.manifest)
        manifest["steps"] = [step]
        capture_error = HierarchyCaptureError(
            "UIAutomator hierarchy is empty",
            evidence_ref="hierarchy-captures/0001",
            dump_exit_code=0,
            readback_exit_code=0,
        )
        with patch("ring1b_functional_driver.time.monotonic", side_effect=[0.0, 0.002]):
            with self.assertRaises(DriverFailure) as ctx:
                FunctionalDriver(manifest, self.selectors, FakeBackend([capture_error])).run()
        self.assertEqual(ctx.exception.code, R1B_UI_HIERARCHY_UNAVAILABLE)
        self.assertEqual(ctx.exception.layer, "ANDROID_UI_HIERARCHY_CAPTURE")
        self.assertIn("hierarchy-captures/0001", ctx.exception.actual)

    def test_adb_backend_preserves_dump_and_raw_invalid_hierarchy_evidence(self):
        for fixture_name in ("ui-empty.xml", "ui-nonxml.txt"):
            with self.subTest(fixture=fixture_name), tempfile.TemporaryDirectory() as temp_dir:
                backend = AdbBackend("com.morefunos.smt", ".MainActivity", temp_dir)
                dump = subprocess.CompletedProcess(
                    ["adb", "shell", "uiautomator", "dump"], 0, "dump stdout\n", "dump stderr\n"
                )
                readback = subprocess.CompletedProcess(
                    ["adb", "exec-out", "cat"], 0, read(fixture_name), "readback stderr\n"
                )
                cleanup = subprocess.CompletedProcess(["adb", "shell", "rm"], 0, "", "")
                with patch.object(backend, "_run", side_effect=[dump, readback, cleanup]):
                    with self.assertRaises(HierarchyCaptureError):
                        backend.observe()

                capture_dir = Path(temp_dir) / "hierarchy-captures" / "0001"
                metadata = json.loads((capture_dir / "capture.json").read_text(encoding="utf-8"))
                self.assertEqual(metadata["dump"]["exit_code"], 0)
                self.assertEqual((capture_dir / "dump.stdout.txt").read_text(encoding="utf-8"), "dump stdout\n")
                self.assertEqual((capture_dir / "dump.stderr.txt").read_text(encoding="utf-8"), "dump stderr\n")
                self.assertEqual((capture_dir / "hierarchy.raw").read_text(encoding="utf-8"), read(fixture_name))
                self.assertFalse(metadata["hierarchy_valid"])

    def test_store_kernel_capture_rejects_remote_diagnostic_text_as_database(self):
        diagnostic = b"cat: databases/morefun_store_kernel.db: No such file or directory\n"
        missing_sidecar = subprocess.CompletedProcess(["adb"], 1, b"", b"No such file or directory\n")
        with tempfile.TemporaryDirectory() as temp_dir:
            backend = AdbBackend(
                "com.morefunos.smt",
                ".MainActivity",
                temp_dir,
                store_kernel_readback_timeout_seconds=0,
                store_kernel_readback_poll_seconds=0,
            )
            main = subprocess.CompletedProcess(["adb"], 0, diagnostic, b"remote diagnostic stderr\n")
            with patch("ring1b_functional_adb.subprocess.run", side_effect=[main, missing_sidecar, missing_sidecar]):
                with self.assertRaises(RuntimeError) as ctx:
                    backend.capture_store_kernel("diagnostic-text")

            self.assertIn("R1B_STORE_KERNEL_READBACK_UNAVAILABLE", str(ctx.exception))
            self.assertIn("MAIN_REMOTE_DIAGNOSTIC_TEXT", str(ctx.exception))
            capture_dir = Path(temp_dir) / "store-kernel" / "diagnostic-text" / "capture-attempts" / "0001"
            metadata = json.loads((capture_dir / "capture.json").read_text(encoding="utf-8"))
            self.assertFalse(metadata["ready"])
            self.assertEqual(metadata["main"]["validation"], "REMOTE_DIAGNOSTIC_TEXT")
            self.assertEqual((capture_dir / "main.stdout.bin").read_bytes(), diagnostic)
            self.assertEqual((capture_dir / "main.stderr.txt").read_bytes(), b"remote diagnostic stderr\n")

    def test_store_kernel_capture_rejects_empty_main_database_bytes(self):
        empty_main = subprocess.CompletedProcess(["adb"], 0, b"", b"")
        missing_sidecar = subprocess.CompletedProcess(["adb"], 1, b"", b"No such file or directory\n")
        with tempfile.TemporaryDirectory() as temp_dir:
            backend = AdbBackend(
                "com.morefunos.smt",
                ".MainActivity",
                temp_dir,
                store_kernel_readback_timeout_seconds=0,
                store_kernel_readback_poll_seconds=0,
            )
            with patch(
                "ring1b_functional_adb.subprocess.run",
                side_effect=[empty_main, missing_sidecar, missing_sidecar],
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    backend.capture_store_kernel("empty-main")

            self.assertIn("R1B_STORE_KERNEL_READBACK_UNAVAILABLE", str(ctx.exception))
            self.assertIn("MAIN_EMPTY_BYTES", str(ctx.exception))
            capture_file = (
                Path(temp_dir)
                / "store-kernel"
                / "empty-main"
                / "capture-attempts"
                / "0001"
                / "capture.json"
            )
            metadata = json.loads(capture_file.read_text(encoding="utf-8"))
            self.assertEqual(metadata["main"]["validation"], "EMPTY_BYTES")

    def test_store_kernel_capture_retries_until_main_sqlite_is_ready(self):
        diagnostic = b"cat: databases/morefun_store_kernel.db: No such file or directory\n"
        missing_sidecar = subprocess.CompletedProcess(["adb"], 1, b"", b"No such file or directory\n")
        delayed_shm = subprocess.CompletedProcess(["adb"], 0, b"\x00" * 32768, b"")
        first_main = subprocess.CompletedProcess(["adb"], 0, diagnostic, b"")
        ready_main = subprocess.CompletedProcess(["adb"], 0, store_kernel_database_bytes(), b"")
        with tempfile.TemporaryDirectory() as temp_dir:
            backend = AdbBackend(
                "com.morefunos.smt",
                ".MainActivity",
                temp_dir,
                store_kernel_readback_timeout_seconds=1,
                store_kernel_readback_poll_seconds=0,
            )
            command_results = [
                first_main,
                missing_sidecar,
                delayed_shm,
                ready_main,
                missing_sidecar,
                missing_sidecar,
            ]
            with patch("ring1b_functional_adb.subprocess.run", side_effect=command_results):
                snapshot = backend.capture_store_kernel("delayed-ready")

            self.assertEqual(snapshot, store_kernel_snapshot())
            capture_root = Path(temp_dir) / "store-kernel" / "delayed-ready" / "capture-attempts"
            first = json.loads((capture_root / "0001" / "capture.json").read_text(encoding="utf-8"))
            second = json.loads((capture_root / "0002" / "capture.json").read_text(encoding="utf-8"))
            self.assertFalse(first["ready"])
            self.assertTrue(first["shm"]["available"])
            self.assertNotEqual(first["main"]["validation"], "SQLITE_HEADER_VALID")
            self.assertTrue(second["ready"])
            self.assertEqual(second["main"]["validation"], "SQLITE_HEADER_VALID")

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

    def test_rapid_double_tap_proves_one_complete_store_kernel_identity_set(self):
        manifest = dict(self.manifest)
        manifest["steps"] = [
            {
                "id": "baseline",
                "action": "checkpoint",
                "expect": {"present": ["product_tile"]},
                "store_kernel": {"checkpoint": "baseline"},
            },
            {
                "id": "rapid-double-tap",
                "action": "tap",
                "target": "product_tile",
                "tap_count": 2,
                "tap_interval_ms": 0,
                "expect": {"present": ["cart_line"]},
                "store_kernel": {
                    "checkpoint": "committed",
                    "compare_to": "baseline",
                    "transaction_delta": [1],
                    "tenders": ["CASH"],
                },
            },
        ]
        validate_manifest(manifest, self.selectors)
        backend = FakeBackend([self.before, self.before, self.after])
        backend.store_kernel_snapshots = [store_kernel_snapshot(), store_kernel_snapshot("CASH")]

        result = FunctionalDriver(manifest, self.selectors, backend).run()

        self.assertEqual(result["result"], "GREEN")
        self.assertEqual(backend.taps, [(250, 200), (250, 200)])

    def test_zero_transaction_delta_requires_exact_logical_state_equality(self):
        before = store_kernel_snapshot("CASH")
        assert_store_kernel_transition(before, store_kernel_snapshot("CASH"), {
            "transaction_delta": [0],
        })
        changed = store_kernel_snapshot("CASH")
        changed["outbox"][0]["status"] = "PROCESSING"
        with self.assertRaises(StoreKernelAssertionError):
            assert_store_kernel_transition(before, changed, {"transaction_delta": [0]})

    def test_electronic_tender_must_be_completed_staff_observed_without_provider_alias(self):
        before = store_kernel_snapshot()
        after = store_kernel_snapshot("FPS")
        assert_store_kernel_transition(before, after, {
            "transaction_delta": [1],
            "tenders": ["FPS"],
            "require_pending_outbox": True,
        })
        payment = next(row for row in after["aggregates"] if row["aggregate_type"] == "PAYMENT")
        payment_state = json.loads(payment["state_json"])
        payment_state["providerPaymentAlias"] = {"provider": "FPS", "providerPaymentId": "fabricated"}
        payment["state_json"] = json.dumps(payment_state)
        with self.assertRaises(StoreKernelAssertionError):
            assert_store_kernel_transition(before, after, {
                "transaction_delta": [1],
                "tenders": ["FPS"],
            })

    def test_atomic_transition_rejects_torn_or_duplicate_checkout(self):
        before = store_kernel_snapshot()
        torn = store_kernel_snapshot("FPS")
        torn["outbox"].pop()
        with self.assertRaises(StoreKernelAssertionError):
            assert_store_kernel_transition(before, torn, {
                "transaction_delta": [0, 1],
                "tenders": ["FPS"],
            })

        duplicate = store_kernel_snapshot("FPS", "PAYME")
        with self.assertRaises(StoreKernelAssertionError):
            assert_store_kernel_transition(before, duplicate, {
                "transaction_delta": [0, 1],
            })

    def test_process_death_hook_accepts_atomic_zero_or_one_outcome_then_relaunches(self):
        manifest = dict(self.manifest)
        manifest["steps"] = [
            {
                "id": "baseline",
                "action": "checkpoint",
                "expect": {"present": ["product_tile"]},
                "store_kernel": {"checkpoint": "baseline"},
            },
            {
                "id": "commit-window-death",
                "action": "process_death",
                "target": "product_tile",
                "expect": {"present": ["product_tile"]},
                "store_kernel": {
                    "checkpoint": "after-death",
                    "compare_to": "baseline",
                    "transaction_delta": [0, 1],
                },
            },
        ]
        validate_manifest(manifest, self.selectors)
        backend = FakeBackend([self.before, self.before, self.before])
        backend.store_kernel_snapshots = [store_kernel_snapshot(), store_kernel_snapshot()]

        result = FunctionalDriver(manifest, self.selectors, backend).run()

        self.assertEqual(result["result"], "GREEN")
        self.assertEqual(len(backend.process_deaths), 1)
        self.assertEqual(backend.launches, 1)

    def test_network_action_is_explicit_and_does_not_require_ui_state_change(self):
        manifest = dict(self.manifest)
        manifest["steps"] = [
            {"id": "wan-offline", "action": "network", "state": "OFFLINE"},
            {"id": "wan-online", "action": "network", "state": "ONLINE"},
        ]
        validate_manifest(manifest, self.selectors)
        backend = FakeBackend([self.before])

        result = FunctionalDriver(manifest, self.selectors, backend).run()

        self.assertEqual(result["result"], "GREEN")
        self.assertEqual(backend.network_states, [("OFFLINE", "01-wan-offline"), ("ONLINE", "02-wan-online")])


if __name__ == "__main__":
    unittest.main()
