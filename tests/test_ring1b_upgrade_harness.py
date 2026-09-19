import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "ring1b_upgrade_contract.py"
SPEC = importlib.util.spec_from_file_location("ring1b_upgrade_contract", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

CHECKOUT_KEY = "morefunos.smt.checkout-context.v1"
CHECKOUT_CODE = "CHAIN3_LEGACY_CHECKOUT_CONTEXT_MIGRATION_REQUIRED"
OFFLINE_CODE = "CHAIN3_LEGACY_OFFLINE_INTENT_MIGRATION_REQUIRED"
STORE_ID = "11111111-1111-4111-8111-111111111111"
ACTOR_ID = "22222222-2222-4222-8222-222222222222"
INTENT_ID = "33333333-3333-4333-8333-333333333333"
ORDER_ID = "44444444-4444-4444-8444-444444444444"
PAYMENT_ID = "55555555-5555-4555-8555-555555555555"
FULFILLMENT_ID = "66666666-6666-4666-8666-666666666666"
RELEASE_ID = "77777777-7777-4777-8777-777777777777"
PRINT_ID = "88888888-8888-4888-8888-888888888888"


def pricing_checksum(request: dict) -> str:
    claim = request["pricingClaim"]
    checksum_input = {
        "pricingRevision": claim["pricingRevision"],
        "pricingRevisionToken": claim["pricingRevisionToken"],
        "currency": claim["currency"],
        "totalMinor": claim["totalMinor"],
        "lines": claim["lines"],
    }
    encoded = json.dumps(checksum_input, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def runtime_pending_snapshot() -> dict:
    order_line = {
        "lineId": "line-1",
        "productId": "product-1",
        "acceptedProductName": "Runtime product",
        "quantity": 1,
        "optionIds": ["option-1"],
        "selectedOptions": [{"optionId": "option-1", "acceptedOptionName": "Runtime option", "quantity": 1}],
        "finalUnitPriceMinor": 10000,
        "lineTotalMinor": 10000,
        "pricingProvenance": ["runtime-pricing:r1"],
    }
    request = {
        "submissionId": INTENT_ID,
        "idempotencyKey": f"smt-direct:{INTENT_ID}",
        "lines": [
            {
                "lineId": "line-1",
                "productId": "product-1",
                "quantity": 1,
                "selections": [{"optionGroupId": "group-1", "optionIds": ["option-1"]}],
            }
        ],
        "pricingClaim": {
            "pricingRevision": 7,
            "pricingRevisionToken": "runtime-price-token-r7",
            "currency": "HKD",
            "totalMinor": 10000,
            "lines": [{"lineId": "line-1", "finalUnitPriceMinor": 10000, "lineTotalMinor": 10000}],
        },
    }
    durable = {
        "intentId": INTENT_ID,
        "schemaVersion": 1,
        "port": "SMT",
        "storeId": STORE_ID,
        "actorId": ACTOR_ID,
        "authorizationContextRef": "runtime-session-1",
        "deviceId": "runtime-device-1",
        "runtimeBindingRef": "runtime-binding-1",
        "businessDate": "2026-09-19",
        "catalogRevision": "runtime-catalog-r3",
        "pricingRevision": "7",
        "pricingRevisionToken": "runtime-price-token-r7",
        "pricingChecksumSha256": pricing_checksum(request),
        "localCreatedAt": "2026-09-19T12:00:00.000Z",
        "request": request,
        "state": "PENDING_SYNC",
        "updatedAt": "2026-09-19T12:00:00.000Z",
    }
    checkout = {
        "intentId": INTENT_ID,
        "requestId": f"smt-store-checkout:{INTENT_ID}",
        "traceId": f"smt-store-checkout:{INTENT_ID}",
        "idempotencyKey": f"smt-store-checkout:{INTENT_ID}",
        "orderId": ORDER_ID,
        "paymentId": PAYMENT_ID,
        "fulfillmentId": FULFILLMENT_ID,
        "productionReleaseEventId": RELEASE_ID,
        "printAdmissionId": PRINT_ID,
        "amountMinor": 10000,
        "currency": "HKD",
        "cartLines": [
            {
                "lineId": "line-1",
                "name": "Runtime product",
                "quantityLabel": "1",
                "lineTotalLabel": "$100",
                "serviceMode": "takeaway",
            }
        ],
        "totalLabel": "$100",
        "order": {
            "storeId": STORE_ID,
            "port": "SMT",
            "actorId": ACTOR_ID,
            "deviceId": "runtime-device-1",
            "submissionId": INTENT_ID,
            "catalogRevision": "runtime-catalog-r3",
            "currency": "HKD",
            "totalMinor": 10000,
            "pricingProvenance": ["runtime-pricing:r1"],
            "lines": [order_line],
        },
        "state": "PENDING",
    }
    envelope = {
        "version": 1,
        "storeId": STORE_ID,
        "sessionId": "runtime-session-1",
        "deviceId": "runtime-device-1",
        "businessDate": "2026-09-19",
        "checkout": checkout,
        "savedAt": "2026-09-19T12:00:00.000Z",
    }
    return {
        "page_url": "https://appassets.androidplatform.net/baseline/index.html",
        "local_storage": {CHECKOUT_KEY: json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))},
        "indexed_db": [
            {
                "database": "morefunos.frontline.staff-order-intent.v1",
                "store": "staff-order-intents",
                "records": [durable],
            }
        ],
        "observable_codes": [],
    }


def snapshot_from_bundle(bundle: dict, codes: list[str]) -> dict:
    return {
        "page_url": "https://appassets.androidplatform.net/baseline/index.html",
        "local_storage": {
            CHECKOUT_KEY: json.dumps(bundle["checkout_context"], ensure_ascii=False, separators=(",", ":"))
        },
        "indexed_db": [
            {
                "database": "morefunos.frontline.staff-order-intent.v1",
                "store": "staff-order-intents",
                "records": [bundle["offline_intent"]],
            }
        ],
        "observable_codes": codes,
    }


class Ring1BUpgradeFixtureGateTests(unittest.TestCase):
    def test_real_pending_is_the_only_fixture_mother_and_derives_all_states(self):
        pending = runtime_pending_snapshot()
        for state in ("PENDING", "COMMITTING", "SETTLED"):
            bundle = MODULE.prepare_legacy_fixture(pending, state)
            result = MODULE.validate_pre_upgrade_fixture(snapshot_from_bundle(bundle, []), state)
            self.assertEqual(result["status"], "PRE_UPGRADE_FIXTURE_VALID")
            self.assertEqual(bundle["checkout_context"]["checkout"]["intentId"], INTENT_ID)
            self.assertEqual(bundle["offline_intent"]["intentId"], INTENT_ID)
        settled = MODULE.prepare_legacy_fixture(pending, "SETTLED")
        self.assertEqual(settled["offline_intent"]["state"], "SYNCED")
        self.assertEqual(settled["offline_intent"]["orderId"], ORDER_ID)

    def test_parser_loophole_checkout_is_rejected_before_upgrade(self):
        value = runtime_pending_snapshot()
        envelope = json.loads(value["local_storage"][CHECKOUT_KEY])
        del envelope["checkout"]["order"]["port"]
        value["local_storage"][CHECKOUT_KEY] = json.dumps(envelope)
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED"):
            MODULE.validate_pre_upgrade_fixture(value, "PENDING")

    def test_base_invalid_offline_intent_keeps_underlying_code(self):
        value = runtime_pending_snapshot()
        del value["indexed_db"][0]["records"][0]["schemaVersion"]
        with self.assertRaisesRegex(
            MODULE.UpgradeContractError,
            "R1B_LEGACY_OFFLINE_INTENT_FIXTURE_BASE_REJECTED.*FRONTLINE_OFFLINE_ORDER_SCHEMA_INVALID",
        ):
            MODULE.validate_pre_upgrade_fixture(value, "PENDING")

    def test_shape_valid_but_wrong_checksum_is_rejected(self):
        value = runtime_pending_snapshot()
        value["indexed_db"][0]["records"][0]["pricingChecksumSha256"] = "0" * 64
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_LEGACY_OFFLINE_INTENT_CHECKSUM_MISMATCH"):
            MODULE.validate_pre_upgrade_fixture(value, "PENDING")

    def test_individually_valid_but_different_transaction_is_rejected(self):
        value = runtime_pending_snapshot()
        other = "99999999-9999-4999-8999-999999999999"
        durable = value["indexed_db"][0]["records"][0]
        durable["intentId"] = other
        durable["request"]["submissionId"] = other
        durable["request"]["idempotencyKey"] = f"smt-direct:{other}"
        durable["pricingChecksumSha256"] = pricing_checksum(durable["request"])
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH"):
            MODULE.validate_pre_upgrade_fixture(value, "PENDING")

    def test_auth_deferred_non_uuid_commit_identity_fails_closed(self):
        value = runtime_pending_snapshot()
        envelope = json.loads(value["local_storage"][CHECKOUT_KEY])
        envelope["storeId"] = "auth-deferred-store"
        envelope["checkout"]["order"]["storeId"] = "auth-deferred-store"
        envelope["checkout"]["order"]["actorId"] = "AUTH_DEFERRED_OPERATOR"
        value["local_storage"][CHECKOUT_KEY] = json.dumps(envelope)
        durable = value["indexed_db"][0]["records"][0]
        durable["storeId"] = "auth-deferred-store"
        durable["actorId"] = "AUTH_DEFERRED_OPERATOR"
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED"):
            MODULE.prepare_legacy_fixture(value, "COMMITTING")

    def test_privacy_safe_evidence_contains_digests_not_raw_identities(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "COMMITTING")
        evidence = MODULE.validate_pre_upgrade_fixture(snapshot_from_bundle(bundle, []), "COMMITTING")
        encoded = json.dumps(evidence, sort_keys=True)
        for raw in (STORE_ID, ACTOR_ID, INTENT_ID, ORDER_ID, PAYMENT_ID, "runtime-session-1", "runtime-price-token-r7"):
            self.assertNotIn(raw, encoded)
        self.assertIn("checkout_digest_sha256", evidence)
        self.assertIn("store_checkout_intent_digest_sha256", evidence)

    def test_secret_field_evidence_leak_is_a_stable_red(self):
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_EVIDENCE_SECRET_FIELD_LEAK"):
            MODULE.assert_privacy_safe_evidence({"sessionToken": "must-not-escape"})
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_EVIDENCE_SECRET_FIELD_LEAK"):
            MODULE.assert_privacy_safe_evidence({"note": "Bearer must-not-escape"})


class Ring1BUpgradePostInstallTests(unittest.TestCase):
    def test_privacy_safe_projection_comparison_is_green_with_both_codes(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "COMMITTING")
        snapshot = snapshot_from_bundle(bundle, [])
        before = MODULE.validate_pre_upgrade_fixture(snapshot, "COMMITTING")
        after = json.loads(json.dumps(before))
        after["observable_codes"] = [CHECKOUT_CODE, OFFLINE_CODE]
        result = MODULE.evaluate_projected_upgrade(before, after, "COMMITTING")
        self.assertEqual(result["result"], "GREEN")

    def test_privacy_safe_projection_digest_change_is_red(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "PENDING")
        snapshot = snapshot_from_bundle(bundle, [])
        before = MODULE.validate_pre_upgrade_fixture(snapshot, "PENDING")
        after = json.loads(json.dumps(before))
        after["checkout_digest_sha256"] = "0" * 64
        after["observable_codes"] = [CHECKOUT_CODE, OFFLINE_CODE]
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_UPGRADE_CUSTODY_PROJECTION_CHANGED"):
            MODULE.evaluate_projected_upgrade(before, after, "PENDING")

    def test_preserved_checkout_and_durable_custody_are_green_with_both_recovery_codes(self):
        for state in ("PENDING", "COMMITTING", "SETTLED"):
            bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), state)
            before = snapshot_from_bundle(bundle, [])
            after = snapshot_from_bundle(bundle, [CHECKOUT_CODE, OFFLINE_CODE])
            result = MODULE.evaluate_upgrade(before, after, state)
            self.assertEqual(result["result"], "GREEN")
            self.assertTrue(result["checkout_context_preserved"])
            self.assertTrue(result["indexed_db_custody_preserved"])

    def test_silent_checkout_context_deletion_is_red(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "PENDING")
        before = snapshot_from_bundle(bundle, [])
        after = snapshot_from_bundle(bundle, [CHECKOUT_CODE, OFFLINE_CODE])
        after["local_storage"] = {}
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_UPGRADE_LEGACY_CONTEXT_DELETED"):
            MODULE.evaluate_upgrade(before, after, "PENDING")

    def test_committing_handle_mutation_is_red(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "COMMITTING")
        before = snapshot_from_bundle(bundle, [])
        after_bundle = json.loads(json.dumps(bundle))
        after_bundle["checkout_context"]["checkout"]["storeCheckoutIntent"]["commandOccurredAt"] = (
            "2026-09-19T12:01:00.000Z"
        )
        after = snapshot_from_bundle(after_bundle, [CHECKOUT_CODE, OFFLINE_CODE])
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_UPGRADE_COMMIT_HANDLE_CHANGED"):
            MODULE.evaluate_upgrade(before, after, "COMMITTING")

    def test_legacy_offline_intent_without_a2_recovery_code_is_red(self):
        bundle = MODULE.prepare_legacy_fixture(runtime_pending_snapshot(), "PENDING")
        before = snapshot_from_bundle(bundle, [])
        after = snapshot_from_bundle(bundle, [CHECKOUT_CODE])
        with self.assertRaisesRegex(MODULE.UpgradeContractError, "R1B_UPGRADE_OFFLINE_RECOVERY_CODE_NOT_VISIBLE"):
            MODULE.evaluate_upgrade(before, after, "PENDING")


class Ring1BUpgradeWiringTests(unittest.TestCase):
    def test_pre_upgrade_fixture_gate_precedes_replace_install(self):
        runner = (ROOT / "scripts" / "run-v2-android-ring1b-upgrade.sh").read_text(encoding="utf-8")
        gate = runner.index("PRE_UPGRADE_FIXTURE_VALID")
        replace_install = runner.index('adb install -r "$REPAIRED_APK_PATH"')
        self.assertLess(gate, replace_install)
        self.assertNotIn("adb uninstall", runner)
        self.assertNotIn("pm clear", runner)
        self.assertNotIn("install -r -d", runner)
        self.assertIn("R1B_UPGRADE_NO_CLEAR_NO_UNINSTALL_INVARIANT_BREACH", runner)
        self.assertIn("cmd[[:space:]]+package[[:space:]]+clear", runner)
        self.assertIn("/data/(data|user/[^/]+)/com\\.morefunos\\.smt", runner)

    def test_seed_transaction_is_force_stopped_before_replace_install(self):
        runner = (ROOT / "scripts" / "run-v2-android-ring1b-upgrade.sh").read_text(encoding="utf-8")
        seed_readback = runner.index('--phase pre')
        force_stop = runner.index('adb shell am force-stop "$PACKAGE_ID"', seed_readback)
        fixture_gate = runner.index('echo "PRE_UPGRADE_FIXTURE_VALID"', seed_readback)
        replace_install = runner.index('adb install -r "$REPAIRED_APK_PATH"')
        self.assertLess(seed_readback, force_stop)
        self.assertLess(force_stop, fixture_gate)
        self.assertLess(force_stop, replace_install)
        self.assertIn('test -z "$(adb shell pidof "$PACKAGE_ID"', runner)

    def test_post_upgrade_custody_is_rechecked_after_second_relaunch(self):
        runner = (ROOT / "scripts" / "run-v2-android-ring1b-upgrade.sh").read_text(encoding="utf-8")
        self.assertIn("post-upgrade-relaunch.json", runner)
        self.assertIn("post-upgrade-first-launch.json", runner)
        self.assertIn("upgrade-contract-result-first-launch.json", runner)

    def test_webview_probe_is_allowlisted_and_has_deterministic_protocol_reds(self):
        probe = (ROOT / "scripts" / "ring1b_webview_storage_probe.mjs").read_text(encoding="utf-8")
        for code in (
            "R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND",
            "R1B_WEBVIEW_DEBUG_TARGET_AMBIGUOUS",
            "R1B_WEBVIEW_STORAGE_ORIGIN_MISMATCH",
            "R1B_WEBVIEW_CDP_ATTACH_FAILED",
            "R1B_WEBVIEW_LOCAL_STORAGE_KEY_FORBIDDEN",
            "R1B_WEBVIEW_LOCAL_STORAGE_READ_FAILED",
            "R1B_WEBVIEW_LOCAL_STORAGE_WRITE_FAILED",
            "R1B_WEBVIEW_LOCAL_STORAGE_WRITE_READBACK_MISMATCH",
            "R1B_WEBVIEW_INDEXEDDB_SCOPE_FORBIDDEN",
            "R1B_WEBVIEW_INDEXEDDB_READ_FAILED",
            "R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED",
            "R1B_WEBVIEW_INDEXEDDB_TRANSACTION_TIMEOUT",
            "R1B_WEBVIEW_INDEXEDDB_WRITE_READBACK_MISMATCH",
            "R1B_WEBVIEW_STORAGE_FIXTURE_ROOT_MISMATCH",
            "R1B_WEBVIEW_STORAGE_UNTYPED_SCRIPT_FORBIDDEN",
            "R1B_WEBVIEW_INDEXEDDB_CREATE_FORBIDDEN",
            "R1B_WEBVIEW_STORAGE_IMMUTABLE_IDENTITY_MUTATION",
            "R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE",
            "R1B_WEBVIEW_STORAGE_EVIDENCE_SECRET_LEAK",
        ):
            self.assertIn(code, probe)
        for operation in ("READ_LOCAL_STORAGE", "READ_INDEXEDDB", "WRITE_LOCAL_STORAGE", "PUT_INDEXEDDB"):
            self.assertIn(operation, probe)
        self.assertNotIn("EVAL_JS", probe)
        self.assertIn("/baseline/index.html", probe)
        self.assertIn("/runtime/index.html", probe)
        self.assertIn("'tcp:0'", probe)
        self.assertNotIn(".getAll()", probe)
        self.assertIn(".get(${JSON.stringify(key)})", probe)
        self.assertNotIn("--seed-bundle", probe)

    def test_webview_probe_rejects_arbitrary_operation_before_adb_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "negative.json"
            completed = subprocess.run(
                [
                    "node",
                    str(ROOT / "scripts" / "ring1b_webview_storage_probe.mjs"),
                    "--phase",
                    "post",
                    "--fixture-case",
                    "PENDING",
                    "--operation",
                    "EVAL_JS",
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("R1B_WEBVIEW_STORAGE_UNTYPED_SCRIPT_FORBIDDEN", completed.stderr)
            evidence = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(evidence["verdict"], "RED")
            self.assertEqual(evidence["sideEffectCertainty"], "PROVEN_NONE")

    def test_runner_preflights_final_write_to_force_stop_ordering(self):
        runner = (ROOT / "scripts" / "run-v2-android-ring1b-upgrade.sh").read_text(encoding="utf-8")
        self.assertIn("R1B_UPGRADE_POST_WRITE_ORDERING_BREACH", runner)
        self.assertIn("POST_WRITE_LINE", runner)
        self.assertIn("FORCE_STOP_LINE", runner)

    def test_raw_storage_stays_out_of_uploaded_evidence_directory(self):
        runner = (ROOT / "scripts" / "run-v2-android-ring1b-upgrade.sh").read_text(encoding="utf-8")
        self.assertIn("raw_storage_evidence=never_persisted", runner)
        self.assertNotIn('$EVIDENCE_DIR/storage-before.json', runner)
        self.assertNotIn('$EVIDENCE_DIR/storage-after.json', runner)
        for raw_name in (
            "runtime-pending.json",
            "seed-bundle.json",
            "storage-before.json",
            "storage-after-first-launch.json",
            "storage-after-relaunch.json",
        ):
            self.assertNotIn(raw_name, runner)
        self.assertIn("pre-upgrade-custody.json", runner)
        self.assertIn("post-upgrade-first-launch.json", runner)
        self.assertIn("post-upgrade-relaunch.json", runner)

    def test_upgrade_workflow_is_manual_only_and_source_binds_legacy_checkout(self):
        workflow = (ROOT / ".github" / "workflows" / "v2-android-emulator-ring1b-upgrade.yml").read_text(
            encoding="utf-8"
        )
        on_block = workflow.split("concurrency:", 1)[0]
        self.assertIn("workflow_dispatch:", on_block)
        for forbidden in ("push:", "pull_request:", "repository_dispatch:", "schedule:"):
            self.assertNotIn(forbidden, on_block)
        self.assertIn("a64c72c9160e9c116db2e8ff99e54223f6bd8e2f", workflow)
        self.assertIn("Checkout exact legacy source for fixture gate", workflow)
        contract = (ROOT / "scripts" / "ring1b_upgrade_contract.py").read_text(encoding="utf-8")
        self.assertIn("apps/smt-clean/src/runtime/auth-deferred-development-runtime.ts", contract)
        self.assertIn("strategy:", workflow)
        for state in ("PENDING", "COMMITTING", "SETTLED"):
            self.assertIn(state, workflow)

    def test_upgrade_manifest_stops_at_staged_readback_without_normal_restart(self):
        manifest = json.loads((ROOT / "manifests" / "867-chain3-legacy-upgrade-pending.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["steps"][-1]["id"], "stage-checkout-intent")
        self.assertNotIn("restart", [step["action"] for step in manifest["steps"]])


if __name__ == "__main__":
    unittest.main()
