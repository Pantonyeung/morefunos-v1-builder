#!/usr/bin/env python3
"""Source-bound fixture and custody contract for Chain3 preserved-data upgrades."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


EXACT_LEGACY_SHA = "a64c72c9160e9c116db2e8ff99e54223f6bd8e2f"
CHECKOUT_KEY = "morefunos.smt.checkout-context.v1"
CHECKOUT_RECOVERY_CODE = "CHAIN3_LEGACY_CHECKOUT_CONTEXT_MIGRATION_REQUIRED"
OFFLINE_RECOVERY_CODE = "CHAIN3_LEGACY_OFFLINE_INTENT_MIGRATION_REQUIRED"
OFFLINE_INTENT_DB = "morefunos.frontline.staff-order-intent.v1"
OFFLINE_INTENT_STORE = "staff-order-intents"
STATES = {"PENDING", "COMMITTING", "SETTLED"}
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
HEX_64_PATTERN = re.compile(r"^[0-9a-f]{64}$")
BUSINESS_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TENDERS = ("CASH", "ALIPAY", "WECHAT_PAY", "FPS", "PAYME")
POLICY_GATES = (
    "installedCapability",
    "publishedConfig",
    "storeDeviceCapability",
    "actorPermission",
    "orderContext",
    "operationalState",
    "externalFacts",
)
CUSTODY_FIELDS = (
    "intentId",
    "requestId",
    "traceId",
    "idempotencyKey",
    "orderId",
    "paymentId",
    "fulfillmentId",
    "productionReleaseEventId",
    "printAdmissionId",
)
SOURCE_FILES = (
    "apps/smt-clean/src/runtime/auth-deferred-development-runtime.ts",
    "apps/smt-clean/src/runtime/network-production-runtime.ts",
    "packages/frontline-ui-integration/offline-staff-order-intent.ts",
    "packages/smt-ui-integration/store-checkout-commit-adapter.ts",
)


class UpgradeContractError(ValueError):
    """A stable fail-closed fixture or upgrade contract violation."""


def _fail(code: str, detail: str = "") -> None:
    raise UpgradeContractError(f"{code}{': ' + detail if detail else ''}")


def _checkout_reject(detail: str) -> None:
    _fail("R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED", detail)


def _offline_reject(detail: str) -> None:
    _fail("R1B_LEGACY_OFFLINE_INTENT_FIXTURE_BASE_REJECTED", detail)


def _record(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(code)
    return value


def _required(value: Any, detail: str, reject: Any = _checkout_reject) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        reject(detail)
    return value


def _iso(value: Any, detail: str, reject: Any = _checkout_reject) -> str:
    text = _required(value, detail, reject)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        reject(detail)
    return text


def _uuid(value: Any, detail: str) -> str:
    text = _required(value, detail)
    if not UUID_PATTERN.fullmatch(text):
        _checkout_reject(detail)
    return text


def _canonical(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonical(value[key]) for key in sorted(value)}
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(_canonical(value), ensure_ascii=False, separators=(",", ":"))


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode()).hexdigest()


def _prefix(value: Any) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:12]


def _contains_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(_contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(_contains_key(item, key) for item in value)
    return False


SENSITIVE_EVIDENCE_KEYS = {
    "accesstoken",
    "authorizationheader",
    "authheader",
    "cardnumber",
    "cookie",
    "credential",
    "credentials",
    "cvc",
    "cvv",
    "passcode",
    "password",
    "paymenttoken",
    "pin",
    "providertoken",
    "refreshtoken",
    "secret",
    "sessiontoken",
    "setcookie",
}


def assert_privacy_safe_evidence(value: Any, path: tuple[str, ...] = ()) -> None:
    """Reject secret-bearing fields before an object enters uploaded evidence."""
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            normalized = re.sub(r"[^a-z0-9]", "", key_text.lower())
            under_hashed_identity_map = bool(path) and path[-1] == "identity_sha256_prefixes"
            if not under_hashed_identity_map and normalized in SENSITIVE_EVIDENCE_KEYS:
                _fail("R1B_EVIDENCE_SECRET_FIELD_LEAK", ".".join((*path, key_text)))
            assert_privacy_safe_evidence(item, (*path, key_text))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            assert_privacy_safe_evidence(item, (*path, str(index)))
    elif isinstance(value, str) and re.search(
        r"(?i)(?:\bbearer\s+\S+|\b(?:sessiontoken|accesstoken|refreshtoken|providertoken|paymenttoken|password|passcode|secret)\s*[:=])",
        value,
    ):
        _fail("R1B_EVIDENCE_SECRET_FIELD_LEAK", ".".join(path))


def _checkout_envelope(snapshot: dict[str, Any], missing_code: str) -> dict[str, Any]:
    storage = _record(snapshot.get("local_storage"), "R1B_UPGRADE_STORAGE_SNAPSHOT_INVALID")
    serialized = storage.get(CHECKOUT_KEY)
    if not isinstance(serialized, str) or not serialized:
        _fail(missing_code)
    try:
        return _record(json.loads(serialized), "R1B_UPGRADE_CHECKOUT_JSON_INVALID")
    except json.JSONDecodeError as error:
        _fail("R1B_UPGRADE_CHECKOUT_JSON_INVALID", str(error))
    raise AssertionError("unreachable")


def _offline_records(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    databases = snapshot.get("indexed_db", [])
    if not isinstance(databases, list):
        _fail("R1B_UPGRADE_INDEXED_DB_SNAPSHOT_INVALID")
    records: list[dict[str, Any]] = []
    for entry in databases:
        if not isinstance(entry, dict):
            _fail("R1B_UPGRADE_INDEXED_DB_SNAPSHOT_INVALID")
        if entry.get("database") == OFFLINE_INTENT_DB and entry.get("store") == OFFLINE_INTENT_STORE:
            values = entry.get("records", [])
            if not isinstance(values, list) or any(not isinstance(record, dict) for record in values):
                _fail("R1B_UPGRADE_INDEXED_DB_SNAPSHOT_INVALID")
            records.extend(values)
    return records


def _correlated_offline(snapshot: dict[str, Any], intent_id: str, missing_code: str) -> dict[str, Any]:
    records = _offline_records(snapshot)
    matching = [record for record in records if record.get("intentId") == intent_id]
    if len(matching) == 1:
        return matching[0]
    if not matching and len(records) == 1:
        return records[0]
    _fail(missing_code, f"matching={len(matching)} total={len(records)}")
    raise AssertionError("unreachable")


def _validate_order_line(value: Any) -> dict[str, Any]:
    line = value if isinstance(value, dict) else None
    if line is None:
        _checkout_reject("CANONICAL_ORDER_LINE_INVALID")
    for field in ("lineId", "productId", "acceptedProductName"):
        _required(line.get(field), f"CANONICAL_ORDER_{field.upper()}_INVALID")
    if not isinstance(line.get("quantity"), int) or line["quantity"] < 1:
        _checkout_reject("CANONICAL_ORDER_QUANTITY_INVALID")
    for field in ("optionIds", "selectedOptions", "pricingProvenance"):
        if not isinstance(line.get(field), list):
            _checkout_reject(f"CANONICAL_ORDER_{field.upper()}_INVALID")
    if not line["pricingProvenance"]:
        _checkout_reject("CANONICAL_ORDER_PRICING_PROVENANCE_REQUIRED")
    for field in ("finalUnitPriceMinor", "lineTotalMinor"):
        if not isinstance(line.get(field), int) or line[field] < 0:
            _checkout_reject(f"CANONICAL_ORDER_{field.upper()}_INVALID")
    return line


def _validate_commit_handle(handle: Any, envelope: dict[str, Any], checkout: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(handle, dict):
        _checkout_reject("STORE_CHECKOUT_COMMIT_INTENT_REQUIRED")
    for field in ("requestId", "traceId", "idempotencyKey"):
        if handle.get(field) != checkout.get(field):
            _checkout_reject(f"STORE_CHECKOUT_{field.upper()}_MISMATCH")
    for field in ("orderId", "paymentId", "fulfillmentId", "productionReleaseEventId", "printAdmissionId"):
        _uuid(handle.get(field), f"STORE_CHECKOUT_{field.upper()}_INVALID")
        if handle.get(field) != checkout.get(field):
            _checkout_reject(f"STORE_CHECKOUT_{field.upper()}_MISMATCH")
    _uuid(handle.get("storeId"), "STORE_CHECKOUT_STORE_ID_INVALID")
    _uuid(handle.get("actorId"), "STORE_CHECKOUT_ACTOR_ID_INVALID")
    if handle["storeId"] != envelope.get("storeId") or handle["actorId"] != checkout["order"].get("actorId"):
        _checkout_reject("STORE_CHECKOUT_SESSION_SCOPE_MISMATCH")
    if handle.get("sessionRef") != envelope.get("sessionId"):
        _checkout_reject("STORE_CHECKOUT_SESSION_REF_INVALID")
    _iso(handle.get("commandOccurredAt"), "STORE_CHECKOUT_COMMAND_TIMESTAMP_INVALID")
    if handle.get("order") != checkout.get("order"):
        _checkout_reject("STORE_CHECKOUT_ORDER_MISMATCH")
    if handle["order"].get("port") != "SMT" or "customerId" in handle["order"]:
        _checkout_reject("STORE_CHECKOUT_ORDER_INVALID")
    tender = handle.get("tenderMethod")
    if tender not in TENDERS:
        _checkout_reject("STORE_CHECKOUT_TENDER_NOT_ADMITTED")
    if tender == "CASH":
        cash = handle.get("cashDetails")
        if not isinstance(cash, dict):
            _checkout_reject("STORE_CHECKOUT_CASH_DETAILS_REQUIRED")
        if not isinstance(cash.get("cashTenderedMinor"), int) or cash["cashTenderedMinor"] < checkout["amountMinor"]:
            _checkout_reject("STORE_CHECKOUT_CASH_DETAILS_INVALID")
        if cash.get("changeMinor") != cash["cashTenderedMinor"] - checkout["amountMinor"]:
            _checkout_reject("STORE_CHECKOUT_CASH_DETAILS_INVALID")
    elif "cashDetails" in handle:
        _checkout_reject("STORE_CHECKOUT_CASH_DETAILS_NON_CASH_FORBIDDEN")
    policy = handle.get("checkoutPolicy")
    if not isinstance(policy, dict):
        _checkout_reject("STORE_CHECKOUT_POLICY_INVALID")
    for gate in POLICY_GATES:
        if not isinstance(policy.get(gate), list) or tender not in policy[gate]:
            _checkout_reject("STORE_CHECKOUT_TENDER_NOT_ADMITTED")
    outputs = handle.get("requestedPrintOutputTypes")
    if outputs != ["RECEIPT", "PRODUCTION_TICKET"]:
        _checkout_reject("STORE_CHECKOUT_PRINT_OUTPUT_TYPES_INVALID")
    return handle


def validate_legacy_checkout_envelope(value: Any, expected_state: str) -> dict[str, Any]:
    if expected_state not in STATES:
        _fail("R1B_UPGRADE_STATE_INVALID", expected_state)
    if not isinstance(value, dict):
        _checkout_reject("WRAPPER_INVALID")
    envelope = value
    if envelope.get("version") != 1:
        _checkout_reject("WRAPPER_VERSION_INVALID")
    for field in ("storeId", "sessionId", "deviceId", "businessDate", "savedAt"):
        _required(envelope.get(field), f"WRAPPER_{field.upper()}_INVALID")
    if not BUSINESS_DATE_PATTERN.fullmatch(envelope["businessDate"]):
        _checkout_reject("WRAPPER_BUSINESS_DATE_INVALID")
    _iso(envelope["savedAt"], "WRAPPER_SAVED_AT_INVALID")
    checkout = envelope.get("checkout")
    if not isinstance(checkout, dict):
        _checkout_reject("CHECKOUT_INVALID")
    if checkout.get("state") != expected_state:
        _checkout_reject("CHECKOUT_STATE_MISMATCH")
    if _contains_key(checkout, "frozenQuoteIdentity"):
        _checkout_reject("FIXTURE_NOT_LEGACY_BASE_FORMAT")
    for field in CUSTODY_FIELDS:
        _required(checkout.get(field), f"CHECKOUT_{field.upper()}_INVALID")
    for field in CUSTODY_FIELDS[4:]:
        _uuid(checkout.get(field), f"CHECKOUT_{field.upper()}_INVALID")
    intent_id = _uuid(checkout.get("intentId"), "CHECKOUT_INTENT_ID_INVALID")
    expected_checkout_id = f"smt-store-checkout:{intent_id}"
    for field in ("requestId", "traceId", "idempotencyKey"):
        if checkout.get(field) != expected_checkout_id:
            _checkout_reject(f"CHECKOUT_{field.upper()}_INVALID")
    _required(checkout.get("currency"), "CHECKOUT_CURRENCY_INVALID")
    _required(checkout.get("totalLabel"), "CHECKOUT_TOTAL_LABEL_INVALID")
    if not isinstance(checkout.get("amountMinor"), int) or checkout["amountMinor"] <= 0:
        _checkout_reject("CHECKOUT_AMOUNT_INVALID")
    cart_lines = checkout.get("cartLines")
    if not isinstance(cart_lines, list) or not cart_lines:
        _checkout_reject("CHECKOUT_CART_LINES_INVALID")
    for line in cart_lines:
        if not isinstance(line, dict):
            _checkout_reject("CHECKOUT_CART_LINE_INVALID")
        for field in ("lineId", "name", "quantityLabel", "lineTotalLabel"):
            _required(line.get(field), f"CHECKOUT_CART_{field.upper()}_INVALID")
        if line.get("serviceMode") not in {"takeaway", "dine-in"}:
            _checkout_reject("CHECKOUT_CART_SERVICE_MODE_INVALID")
    order = checkout.get("order")
    if not isinstance(order, dict):
        _checkout_reject("CANONICAL_ORDER_INVALID")
    if order.get("storeId") != envelope["storeId"] or order.get("deviceId") != envelope["deviceId"]:
        _checkout_reject("CANONICAL_ORDER_SESSION_SCOPE_MISMATCH")
    if order.get("port") != "SMT" or order.get("submissionId") != intent_id:
        _checkout_reject("CANONICAL_ORDER_IDENTITY_INVALID")
    _required(order.get("actorId"), "CANONICAL_ORDER_ACTOR_INVALID")
    _required(order.get("catalogRevision"), "CANONICAL_ORDER_CATALOG_REVISION_INVALID")
    if order.get("currency") != checkout["currency"] or order.get("totalMinor") != checkout["amountMinor"]:
        _checkout_reject("CANONICAL_ORDER_TOTAL_MISMATCH")
    if not isinstance(order.get("pricingProvenance"), list) or not order["pricingProvenance"]:
        _checkout_reject("CANONICAL_ORDER_PRICING_PROVENANCE_REQUIRED")
    order_lines = order.get("lines")
    if not isinstance(order_lines, list) or not order_lines:
        _checkout_reject("CANONICAL_ORDER_LINES_REQUIRED")
    for line in order_lines:
        _validate_order_line(line)
    handle = checkout.get("storeCheckoutIntent")
    if expected_state == "PENDING":
        if handle is not None or "displayOrderCode" in checkout:
            _checkout_reject("PENDING_TERMINAL_FIELDS_FORBIDDEN")
    else:
        _validate_commit_handle(handle, envelope, checkout)
        if expected_state == "COMMITTING" and "displayOrderCode" in checkout:
            _checkout_reject("COMMITTING_DISPLAY_CODE_FORBIDDEN")
        if expected_state == "SETTLED":
            _required(checkout.get("displayOrderCode"), "SETTLED_DISPLAY_CODE_REQUIRED")
    return envelope


def _validate_offline_base(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_INTENT_INVALID")
    record = value
    if record.get("schemaVersion") != 1:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_SCHEMA_INVALID")
    if record.get("port") != "SMT":
        _offline_reject("FRONTLINE_OFFLINE_ORDER_PORT_INVALID")
    required = {
        "intentId": "FRONTLINE_OFFLINE_ORDER_INTENT_ID_REQUIRED",
        "storeId": "FRONTLINE_OFFLINE_ORDER_STORE_REQUIRED",
        "actorId": "FRONTLINE_OFFLINE_ORDER_ACTOR_REQUIRED",
        "authorizationContextRef": "FRONTLINE_OFFLINE_ORDER_AUTH_CONTEXT_REQUIRED",
        "deviceId": "FRONTLINE_OFFLINE_ORDER_DEVICE_REQUIRED",
        "runtimeBindingRef": "FRONTLINE_OFFLINE_ORDER_RUNTIME_BINDING_REQUIRED",
        "catalogRevision": "FRONTLINE_OFFLINE_ORDER_CATALOG_REVISION_REQUIRED",
        "pricingRevision": "FRONTLINE_OFFLINE_ORDER_PRICING_REVISION_REQUIRED",
        "pricingRevisionToken": "FRONTLINE_OFFLINE_ORDER_PRICING_TOKEN_REQUIRED",
    }
    for field, code in required.items():
        _required(record.get(field), code, _offline_reject)
    if not BUSINESS_DATE_PATTERN.fullmatch(str(record.get("businessDate", ""))):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_BUSINESS_DATE_INVALID")
    if not isinstance(record.get("pricingChecksumSha256"), str) or not HEX_64_PATTERN.fullmatch(
        record["pricingChecksumSha256"]
    ):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_PRICING_CHECKSUM_INVALID")
    _iso(record.get("localCreatedAt"), "FRONTLINE_OFFLINE_ORDER_CREATED_AT_INVALID", _offline_reject)
    _iso(record.get("updatedAt"), "FRONTLINE_OFFLINE_ORDER_UPDATED_AT_INVALID", _offline_reject)
    if record.get("state") not in {"PENDING_SYNC", "SYNCED", "CONFLICT", "QUARANTINED"}:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_STATE_INVALID")
    request = record.get("request")
    if not isinstance(request, dict):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_REQUEST_REQUIRED")
    if request.get("submissionId") != record["intentId"]:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_SUBMISSION_ID_MISMATCH")
    _required(request.get("idempotencyKey"), "FRONTLINE_OFFLINE_ORDER_IDEMPOTENCY_REQUIRED", _offline_reject)
    if not isinstance(request.get("lines"), list) or not request["lines"]:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_LINES_REQUIRED")
    claim = request.get("pricingClaim")
    if not isinstance(claim, dict):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_PRICING_CLAIM_REQUIRED")
    if str(claim.get("pricingRevision")) != str(record["pricingRevision"]) or claim.get(
        "pricingRevisionToken"
    ) != record["pricingRevisionToken"]:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_PRICING_IDENTITY_MISMATCH")
    if not isinstance(claim.get("lines"), list) or not claim["lines"]:
        _offline_reject("FRONTLINE_OFFLINE_ORDER_PRICING_LINES_REQUIRED")
    attempts = record.get("syncAttemptCount")
    if attempts is not None and (not isinstance(attempts, int) or attempts < 0):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_SYNC_ATTEMPT_INVALID")
    if record.get("lastSyncAt") is not None:
        _iso(record["lastSyncAt"], "FRONTLINE_OFFLINE_ORDER_LAST_SYNC_AT_INVALID", _offline_reject)
    if record["state"] == "SYNCED":
        _required(record.get("orderId"), "FRONTLINE_OFFLINE_ORDER_SYNCED_ORDER_REQUIRED", _offline_reject)
        if not isinstance(record.get("canonicalRevision"), int) or record["canonicalRevision"] < 1:
            _offline_reject("FRONTLINE_OFFLINE_ORDER_SYNCED_REVISION_INVALID")
    if _contains_key(record, "frozenQuoteIdentity"):
        _offline_reject("FRONTLINE_OFFLINE_ORDER_NOT_LEGACY_BASE_FORMAT")
    return record


def create_frontline_pricing_claim_checksum(request: dict[str, Any]) -> str:
    claim = _record(request.get("pricingClaim"), "R1B_LEGACY_OFFLINE_INTENT_FIXTURE_BASE_REJECTED")
    checksum_input = {
        "pricingRevision": claim.get("pricingRevision"),
        "pricingRevisionToken": claim.get("pricingRevisionToken"),
        "currency": claim.get("currency"),
        "totalMinor": claim.get("totalMinor"),
        "lines": claim.get("lines"),
    }
    encoded = json.dumps(checksum_input, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _validate_correlation(envelope: dict[str, Any], durable: dict[str, Any]) -> None:
    checkout = envelope["checkout"]
    order = checkout["order"]
    request = durable["request"]
    claim = request["pricingClaim"]
    pairs = (
        (durable.get("intentId"), checkout.get("intentId"), "intentId"),
        (request.get("submissionId"), checkout.get("intentId"), "submissionId"),
        (order.get("submissionId"), checkout.get("intentId"), "order.submissionId"),
        (durable.get("storeId"), envelope.get("storeId"), "storeId"),
        (order.get("storeId"), envelope.get("storeId"), "order.storeId"),
        (durable.get("actorId"), order.get("actorId"), "actorId"),
        (durable.get("deviceId"), envelope.get("deviceId"), "deviceId"),
        (order.get("deviceId"), envelope.get("deviceId"), "order.deviceId"),
        (durable.get("authorizationContextRef"), envelope.get("sessionId"), "sessionId"),
        (durable.get("businessDate"), envelope.get("businessDate"), "businessDate"),
        (durable.get("catalogRevision"), order.get("catalogRevision"), "catalogRevision"),
        (claim.get("currency"), checkout.get("currency"), "currency"),
        (claim.get("totalMinor"), checkout.get("amountMinor"), "totalMinor"),
    )
    for left, right, field in pairs:
        if left != right:
            _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", field)
    if request.get("idempotencyKey") != f"smt-direct:{checkout['intentId']}":
        _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", "request.idempotencyKey")
    if str(claim.get("pricingRevision")) != str(durable.get("pricingRevision")):
        _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", "pricingRevision")
    order_by_id = {line.get("lineId"): line for line in order["lines"]}
    request_by_id = {line.get("lineId"): line for line in request["lines"] if isinstance(line, dict)}
    claim_by_id = {line.get("lineId"): line for line in claim["lines"] if isinstance(line, dict)}
    cart_ids = {line.get("lineId") for line in checkout["cartLines"]}
    if set(order_by_id) != set(request_by_id) or set(order_by_id) != set(claim_by_id) or set(order_by_id) != cart_ids:
        _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", "line identities")
    for line_id, order_line in order_by_id.items():
        request_line = request_by_id[line_id]
        claim_line = claim_by_id[line_id]
        if request_line.get("productId") != order_line.get("productId") or request_line.get("quantity") != order_line.get(
            "quantity"
        ):
            _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", f"line request:{line_id}")
        if claim_line.get("finalUnitPriceMinor") != order_line.get("finalUnitPriceMinor") or claim_line.get(
            "lineTotalMinor"
        ) != order_line.get("lineTotalMinor"):
            _fail("R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH", f"line pricing:{line_id}")


def _privacy_evidence(envelope: dict[str, Any], durable: dict[str, Any], state: str) -> dict[str, Any]:
    checkout = envelope["checkout"]
    order = checkout["order"]
    handle = checkout.get("storeCheckoutIntent")
    identities = {
        "store_id": envelope["storeId"],
        "session_id": envelope["sessionId"],
        "device_id": envelope["deviceId"],
        "actor_id": order["actorId"],
        "intent_id": checkout["intentId"],
        "request_id": checkout["requestId"],
        "trace_id": checkout["traceId"],
        "idempotency_key": checkout["idempotencyKey"],
        "order_id": checkout["orderId"],
        "payment_id": checkout["paymentId"],
        "fulfillment_id": checkout["fulfillmentId"],
        "release_id": checkout["productionReleaseEventId"],
        "print_admission_id": checkout["printAdmissionId"],
        "authorization_context_ref": durable["authorizationContextRef"],
        "runtime_binding_ref": durable["runtimeBindingRef"],
        "pricing_revision_token": durable["pricingRevisionToken"],
    }
    return {
        "status": "PRE_UPGRADE_FIXTURE_VALID",
        "state": state,
        "fixture_semantics": "RUNTIME_PENDING_WITH_COMPATIBILITY_ONLY_TERMINAL_DELTA"
        if state != "PENDING"
        else "EXACT_BASE_RUNTIME_PENDING",
        "storage_key": CHECKOUT_KEY,
        "database": OFFLINE_INTENT_DB,
        "object_store": OFFLINE_INTENT_STORE,
        "checkout_digest_sha256": _digest(envelope),
        "durable_digest_sha256": _digest(durable),
        "order_digest_sha256": _digest(order),
        "store_checkout_intent_digest_sha256": _digest(handle) if handle is not None else None,
        "business_date": envelope["businessDate"],
        "amount_minor": checkout["amountMinor"],
        "currency": checkout["currency"],
        "line_count": len(order["lines"]),
        "durable_schema_version": durable["schemaVersion"],
        "durable_state": durable["state"],
        "pricing_checksum_sha256": durable["pricingChecksumSha256"],
        "identity_sha256_prefixes": {key: _prefix(value) for key, value in identities.items()},
        "correlations": {
            "runtime_session": True,
            "checkout_durable_transaction": True,
            "catalog_pricing": True,
            "line_identity_and_pricing": True,
            "commit_handle": handle is not None if state != "PENDING" else True,
        },
    }


def validate_pre_upgrade_fixture(snapshot: dict[str, Any], expected_state: str) -> dict[str, Any]:
    envelope = validate_legacy_checkout_envelope(
        _checkout_envelope(snapshot, "R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED"), expected_state
    )
    durable = _validate_offline_base(
        _correlated_offline(snapshot, envelope["checkout"]["intentId"], "R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH")
    )
    expected_checksum = create_frontline_pricing_claim_checksum(durable["request"])
    if durable["pricingChecksumSha256"] != expected_checksum:
        _fail("R1B_LEGACY_OFFLINE_INTENT_CHECKSUM_MISMATCH")
    _validate_correlation(envelope, durable)
    if expected_state in {"PENDING", "COMMITTING"}:
        if durable.get("state") != "PENDING_SYNC" or durable.get("updatedAt") != durable.get("localCreatedAt"):
            _offline_reject("FRONTLINE_OFFLINE_ORDER_RUNTIME_FRESH_STATE_INVALID")
    else:
        if (
            durable.get("state") != "SYNCED"
            or durable.get("orderId") != envelope["checkout"]["orderId"]
            or not isinstance(durable.get("canonicalRevision"), int)
            or durable["canonicalRevision"] < 1
            or not isinstance(durable.get("syncAttemptCount"), int)
            or durable["syncAttemptCount"] < 1
            or not durable.get("lastSyncAt")
        ):
            _offline_reject("FRONTLINE_OFFLINE_ORDER_SETTLED_TERMINAL_INVALID")
    return _privacy_evidence(envelope, durable, expected_state)


def _build_commit_handle(envelope: dict[str, Any]) -> dict[str, Any]:
    checkout = envelope["checkout"]
    order = checkout["order"]
    _uuid(envelope["storeId"], "STORE_CHECKOUT_STORE_ID_INVALID")
    _uuid(order["actorId"], "STORE_CHECKOUT_ACTOR_ID_INVALID")
    for field in CUSTODY_FIELDS[4:]:
        _uuid(checkout[field], f"STORE_CHECKOUT_{field.upper()}_INVALID")
    return {
        "requestId": checkout["requestId"],
        "traceId": checkout["traceId"],
        "idempotencyKey": checkout["idempotencyKey"],
        "storeId": envelope["storeId"],
        "actorId": order["actorId"],
        "sessionRef": envelope["sessionId"],
        "commandOccurredAt": envelope["savedAt"],
        "orderId": checkout["orderId"],
        "paymentId": checkout["paymentId"],
        "fulfillmentId": checkout["fulfillmentId"],
        "productionReleaseEventId": checkout["productionReleaseEventId"],
        "printAdmissionId": checkout["printAdmissionId"],
        "order": copy.deepcopy(order),
        "tenderMethod": "CASH",
        "cashDetails": {"cashTenderedMinor": checkout["amountMinor"], "changeMinor": 0},
        "checkoutPolicy": {gate: list(TENDERS) for gate in POLICY_GATES},
        "requestedPrintOutputTypes": ["RECEIPT", "PRODUCTION_TICKET"],
    }


def _snapshot_from_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "local_storage": {CHECKOUT_KEY: json.dumps(bundle["checkout_context"], ensure_ascii=False, separators=(",", ":"))},
        "indexed_db": [
            {"database": OFFLINE_INTENT_DB, "store": OFFLINE_INTENT_STORE, "records": [bundle["offline_intent"]]}
        ],
        "observable_codes": [],
    }


def prepare_legacy_fixture(runtime_pending_snapshot: dict[str, Any], target_state: str) -> dict[str, Any]:
    if target_state not in STATES:
        _fail("R1B_UPGRADE_STATE_INVALID", target_state)
    validate_pre_upgrade_fixture(runtime_pending_snapshot, "PENDING")
    pending_envelope = _checkout_envelope(runtime_pending_snapshot, "R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED")
    pending_durable = _correlated_offline(
        runtime_pending_snapshot, pending_envelope["checkout"]["intentId"], "R1B_LEGACY_FIXTURE_CORRELATION_MISMATCH"
    )
    envelope = copy.deepcopy(pending_envelope)
    durable = copy.deepcopy(pending_durable)
    checkout = envelope["checkout"]
    if target_state != "PENDING":
        checkout["storeCheckoutIntent"] = _build_commit_handle(envelope)
        checkout["state"] = target_state
    if target_state == "SETTLED":
        checkout["displayOrderCode"] = "0867"
        durable.update(
            {
                "state": "SYNCED",
                "orderId": checkout["orderId"],
                "canonicalRevision": 1,
                "syncAttemptCount": 1,
                "lastSyncAt": envelope["savedAt"],
                "updatedAt": envelope["savedAt"],
            }
        )
        durable.pop("lastSyncError", None)
        durable.pop("conflictCode", None)
        durable.pop("quarantineCode", None)
    bundle = {"checkout_context": envelope, "offline_intent": durable}
    validate_pre_upgrade_fixture(_snapshot_from_bundle(bundle), target_state)
    return bundle


def _observable_codes(snapshot: dict[str, Any]) -> set[str]:
    codes = snapshot.get("observable_codes", [])
    if not isinstance(codes, list) or any(not isinstance(code, str) for code in codes):
        _fail("R1B_UPGRADE_OBSERVABLE_CODES_INVALID")
    return set(codes)


def evaluate_upgrade(before: dict[str, Any], after: dict[str, Any], expected_state: str) -> dict[str, Any]:
    preflight = validate_pre_upgrade_fixture(before, expected_state)
    before_envelope = _checkout_envelope(before, "R1B_UPGRADE_LEGACY_CONTEXT_MISSING_BEFORE")
    after_envelope = _checkout_envelope(after, "R1B_UPGRADE_LEGACY_CONTEXT_DELETED")
    before_checkout = before_envelope["checkout"]
    after_checkout = after_envelope.get("checkout")
    if not isinstance(after_checkout, dict):
        _fail("R1B_UPGRADE_AFTER_CHECKOUT_INVALID")
    for field in CUSTODY_FIELDS:
        if after_checkout.get(field) != before_checkout.get(field):
            _fail("R1B_UPGRADE_CUSTODY_IDENTITY_CHANGED", field)
    if after_checkout.get("state") != before_checkout.get("state"):
        _fail("R1B_UPGRADE_CUSTODY_STATE_CHANGED")
    if expected_state == "SETTLED" and after_checkout.get("displayOrderCode") != before_checkout.get("displayOrderCode"):
        _fail("R1B_UPGRADE_SETTLED_READBACK_CHANGED")
    before_handle = before_checkout.get("storeCheckoutIntent")
    after_handle = after_checkout.get("storeCheckoutIntent")
    if expected_state in {"COMMITTING", "SETTLED"}:
        if not isinstance(after_handle, dict):
            _fail("R1B_UPGRADE_COMMIT_HANDLE_DELETED", expected_state)
        if _digest(after_handle) != _digest(before_handle):
            _fail("R1B_UPGRADE_COMMIT_HANDLE_CHANGED")
    before_durable = _correlated_offline(before, before_checkout["intentId"], "R1B_UPGRADE_INDEXED_DB_CUSTODY_MISSING_BEFORE")
    after_durable = _correlated_offline(after, before_checkout["intentId"], "R1B_UPGRADE_INDEXED_DB_CUSTODY_DELETED")
    for field in ("intentId", "storeId", "actorId", "authorizationContextRef", "deviceId", "runtimeBindingRef"):
        if after_durable.get(field) != before_durable.get(field):
            _fail("R1B_UPGRADE_INDEXED_DB_CUSTODY_CHANGED", field)
    codes = _observable_codes(after)
    checkout_legacy = "frozenQuoteIdentity" not in after_checkout
    offline_legacy = after_durable.get("schemaVersion") == 1 and not _contains_key(after_durable, "frozenQuoteIdentity")
    if checkout_legacy and CHECKOUT_RECOVERY_CODE not in codes:
        _fail("R1B_UPGRADE_RECOVERY_CODE_NOT_VISIBLE", CHECKOUT_RECOVERY_CODE)
    if offline_legacy and OFFLINE_RECOVERY_CODE not in codes:
        _fail("R1B_UPGRADE_OFFLINE_RECOVERY_CODE_NOT_VISIBLE", OFFLINE_RECOVERY_CODE)
    return {
        "result": "GREEN",
        "state": expected_state,
        "checkout_context_preserved": True,
        "store_checkout_intent_preserved": expected_state in {"COMMITTING", "SETTLED"},
        "indexed_db_custody_preserved": True,
        "legacy_checkout_shape_remains": checkout_legacy,
        "legacy_offline_shape_remains": offline_legacy,
        "checkout_recovery_code_observed": CHECKOUT_RECOVERY_CODE if checkout_legacy else None,
        "offline_recovery_code_observed": OFFLINE_RECOVERY_CODE if offline_legacy else None,
        "identity_sha256_prefix": _prefix(before_checkout["intentId"]),
        "checkout_digest_before_sha256": preflight["checkout_digest_sha256"],
        "checkout_digest_after_sha256": _digest(after_envelope),
        "durable_digest_before_sha256": preflight["durable_digest_sha256"],
        "durable_digest_after_sha256": _digest(after_durable),
        "store_checkout_intent_digest_before_sha256": _digest(before_handle) if before_handle is not None else None,
        "store_checkout_intent_digest_after_sha256": _digest(after_handle) if after_handle is not None else None,
    }


def evaluate_projected_upgrade(before: dict[str, Any], after: dict[str, Any], expected_state: str) -> dict[str, Any]:
    """Compare privacy-safe projections without persisting raw storage blobs."""
    assert_privacy_safe_evidence(before)
    assert_privacy_safe_evidence(after)
    if before.get("state") != expected_state or after.get("state") != expected_state:
        _fail("R1B_UPGRADE_CUSTODY_STATE_CHANGED")
    exact_fields = (
        "checkout_digest_sha256",
        "durable_digest_sha256",
        "order_digest_sha256",
        "store_checkout_intent_digest_sha256",
        "business_date",
        "amount_minor",
        "currency",
        "line_count",
        "durable_schema_version",
        "durable_state",
        "pricing_checksum_sha256",
        "identity_sha256_prefixes",
    )
    for field in exact_fields:
        if after.get(field) != before.get(field):
            _fail("R1B_UPGRADE_CUSTODY_PROJECTION_CHANGED", field)
    codes = set(_observable_codes(after))
    if CHECKOUT_RECOVERY_CODE not in codes:
        _fail("R1B_UPGRADE_RECOVERY_CODE_NOT_VISIBLE", CHECKOUT_RECOVERY_CODE)
    if OFFLINE_RECOVERY_CODE not in codes:
        _fail("R1B_UPGRADE_OFFLINE_RECOVERY_CODE_NOT_VISIBLE", OFFLINE_RECOVERY_CODE)
    result = {
        "result": "GREEN",
        "state": expected_state,
        "checkout_context_preserved": True,
        "store_checkout_intent_preserved": expected_state in {"COMMITTING", "SETTLED"},
        "indexed_db_custody_preserved": True,
        "checkout_recovery_code_observed": CHECKOUT_RECOVERY_CODE,
        "offline_recovery_code_observed": OFFLINE_RECOVERY_CODE,
        "checkout_digest_sha256": before["checkout_digest_sha256"],
        "durable_digest_sha256": before["durable_digest_sha256"],
        "store_checkout_intent_digest_sha256": before.get("store_checkout_intent_digest_sha256"),
    }
    assert_privacy_safe_evidence(result)
    return result


def verify_legacy_source(source: Path) -> dict[str, Any]:
    try:
        head = subprocess.run(
            ["git", "-C", str(source), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        _checkout_reject(f"LEGACY_SOURCE_UNREADABLE:{type(error).__name__}")
    if head != EXACT_LEGACY_SHA:
        _checkout_reject(f"LEGACY_SOURCE_SHA_MISMATCH:{head}")
    file_digests: dict[str, str] = {}
    for relative in SOURCE_FILES:
        path = source / relative
        if not path.is_file():
            _checkout_reject(f"LEGACY_SOURCE_FILE_MISSING:{relative}")
        file_digests[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"legacy_source_sha": head, "source_file_sha256": file_digests}


def _read_json(path: Path) -> dict[str, Any]:
    return _record(json.loads(path.read_text(encoding="utf-8")), "R1B_UPGRADE_JSON_INPUT_INVALID")


def _write_json(path: Path, value: Any, *, privacy_safe: bool = False) -> None:
    if privacy_safe:
        assert_privacy_safe_evidence(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare and evaluate source-bound Ring1B upgrade evidence")
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("stream-prepare")
    prepare.add_argument("--state", required=True, choices=sorted(STATES))
    prepare.add_argument("--legacy-source", required=True, type=Path)
    project = subparsers.add_parser("stream-project")
    project.add_argument("--state", required=True, choices=sorted(STATES))
    evaluate = subparsers.add_parser("evaluate-projected")
    evaluate.add_argument("--before", required=True, type=Path)
    evaluate.add_argument("--after", required=True, type=Path)
    evaluate.add_argument("--state", required=True, choices=sorted(STATES))
    evaluate.add_argument("--output-json", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "stream-prepare":
        source = verify_legacy_source(args.legacy_source)
        snapshot = _record(json.loads(sys.stdin.read()), "R1B_UPGRADE_JSON_INPUT_INVALID")
        bundle = prepare_legacy_fixture(snapshot, args.state)
        evidence = validate_pre_upgrade_fixture(_snapshot_from_bundle(bundle), args.state)
        evidence["source_binding"] = source
        assert_privacy_safe_evidence(evidence)
        sys.stdout.write(json.dumps({"bundle": bundle, "evidence": evidence}, ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.command == "stream-project":
        snapshot = _record(json.loads(sys.stdin.read()), "R1B_UPGRADE_JSON_INPUT_INVALID")
        evidence = validate_pre_upgrade_fixture(snapshot, args.state)
        evidence["status"] = "R1B_UPGRADE_CUSTODY_PROJECTION"
        evidence["observable_codes"] = sorted(_observable_codes(snapshot))
        assert_privacy_safe_evidence(evidence)
        sys.stdout.write(json.dumps(evidence, ensure_ascii=False, separators=(",", ":")))
        return 0
    result = evaluate_projected_upgrade(_read_json(args.before), _read_json(args.after), args.state)
    _write_json(args.output_json, result, privacy_safe=True)
    print("RING1B_LEGACY_UPGRADE_CUSTODY_GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
