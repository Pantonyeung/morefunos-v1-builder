from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

R1B_SELECTOR_NOT_FOUND = "R1B_SELECTOR_NOT_FOUND"
R1B_ACTION_NO_STATE_CHANGE = "R1B_ACTION_NO_STATE_CHANGE"
R1B_EXPECTED_STATE_NOT_REACHED = "R1B_EXPECTED_STATE_NOT_REACHED"
R1B_UNEXPECTED_RECOVERY_SURFACE = "R1B_UNEXPECTED_RECOVERY_SURFACE"
R1B_RESTART_PERSISTENCE_MISMATCH = "R1B_RESTART_PERSISTENCE_MISMATCH"
R1B_MANIFEST_INVALID = "R1B_MANIFEST_INVALID"
R1B_UI_HIERARCHY_UNAVAILABLE = "R1B_UI_HIERARCHY_UNAVAILABLE"
R1B_STORE_KERNEL_ASSERTION_FAILED = "R1B_STORE_KERNEL_ASSERTION_FAILED"
R1B_STORE_KERNEL_READBACK_UNAVAILABLE = "R1B_STORE_KERNEL_READBACK_UNAVAILABLE"
R1B_PROCESS_DEATH_HOOK_NOT_TRIGGERED = "R1B_PROCESS_DEATH_HOOK_NOT_TRIGGERED"
R1B_NETWORK_STATE_MISMATCH = "R1B_NETWORK_STATE_MISMATCH"

DEFAULT_FAULT_TEXT_PATTERNS = (
    r"SMT 發生故障",
    r"故障代碼",
    r"NATIVE_[A-Z0-9_]+",
    r"打開 RECOVERY / 診斷工具",
)
DEFAULT_FAULT_ACTIVITY_PATTERNS = (r"CarrierRecoveryActivity",)
BOUNDS_RE = re.compile(r"^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$")


@dataclass(frozen=True)
class Observation:
    ui_xml: str
    activity: str
    fingerprint: str


class DriverFailure(RuntimeError):
    def __init__(self, code: str, *, step_id: str, expected: str, actual: str, layer: str = "ANDROID_UI") -> None:
        super().__init__(f"{code}: {step_id}: {actual}")
        self.code = code
        self.step_id = step_id
        self.expected = expected
        self.actual = actual
        self.layer = layer


class ManifestError(ValueError):
    pass


class StoreKernelAssertionError(AssertionError):
    pass


class HierarchyCaptureError(RuntimeError):
    def __init__(
        self,
        reason: str,
        *,
        evidence_ref: str,
        dump_exit_code: Optional[int],
        readback_exit_code: Optional[int],
    ) -> None:
        self.reason = reason
        self.evidence_ref = evidence_ref
        self.dump_exit_code = dump_exit_code
        self.readback_exit_code = readback_exit_code
        super().__init__(
            f"{reason}; evidence={evidence_ref}; dump_exit_code={dump_exit_code}; "
            f"readback_exit_code={readback_exit_code}"
        )


def load_json(path: str | Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    if not isinstance(value, dict):
        raise ManifestError("top-level JSON must be an object")
    return value


STORE_KERNEL_TABLES = ("aggregates", "receipts", "inbox", "outbox", "journal")
STORE_CHECKOUT_TRANSACTION_TYPES = (
    "ORDER_DISPLAY_ASSIGNMENT",
    "ORDER",
    "PAYMENT",
    "FULFILLMENT",
    "ORDER_PRINT_ADMISSION",
)
STORE_CHECKOUT_EVENT_TYPES = (
    "OrderAccepted",
    "PaymentCompleted",
    "ProductionReleased",
    "OrderPrintAdmissionRequested",
)
STORE_CHECKOUT_TENDERS = ("CASH", "ALIPAY", "WECHAT_PAY", "FPS", "PAYME")


def _snapshot_rows(snapshot: Dict[str, Any], table: str) -> List[Dict[str, Any]]:
    rows = snapshot.get(table)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise StoreKernelAssertionError(f"Store Kernel snapshot table {table!r} is invalid")
    return rows


def logical_store_kernel_fingerprint(snapshot: Dict[str, Any]) -> str:
    canonical = {
        table: sorted(
            (dict(sorted(row.items())) for row in _snapshot_rows(snapshot, table)),
            key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")),
        )
        for table in STORE_KERNEL_TABLES
    }
    encoded = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _row_map(rows: List[Dict[str, Any]], keys: Tuple[str, ...], table: str) -> Dict[Tuple[Any, ...], Dict[str, Any]]:
    result: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
    for row in rows:
        key = tuple(row.get(field) for field in keys)
        if any(value is None for value in key) or key in result:
            raise StoreKernelAssertionError(f"Store Kernel {table} key invalid or duplicated: {key!r}")
        result[key] = row
    return result


def _json_object(row: Dict[str, Any], field: str, where: str) -> Dict[str, Any]:
    raw = row.get(field)
    if not isinstance(raw, str):
        raise StoreKernelAssertionError(f"{where}.{field} is not JSON text")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StoreKernelAssertionError(f"{where}.{field} is invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise StoreKernelAssertionError(f"{where}.{field} must decode to an object")
    return value


def assert_store_kernel_transition(
    before: Dict[str, Any],
    current: Dict[str, Any],
    assertion: Dict[str, Any],
) -> Dict[str, Any]:
    allowed_delta = assertion.get("transaction_delta")
    if not isinstance(allowed_delta, list) or not allowed_delta:
        raise StoreKernelAssertionError("transaction_delta must be a non-empty integer list")

    before_receipts = _row_map(
        _snapshot_rows(before, "receipts"),
        ("store_id", "operation_id", "idempotency_key"),
        "receipts",
    )
    current_receipts = _row_map(
        _snapshot_rows(current, "receipts"),
        ("store_id", "operation_id", "idempotency_key"),
        "receipts",
    )
    removed_receipts = sorted(set(before_receipts) - set(current_receipts))
    if removed_receipts:
        raise StoreKernelAssertionError(f"Store Kernel receipts were removed: {removed_receipts!r}")
    added_receipts = [
        current_receipts[key]
        for key in set(current_receipts) - set(before_receipts)
    ]
    added_receipts.sort(key=lambda row: int(row.get("commit_sequence", 0)))
    actual_delta = len(added_receipts)
    if actual_delta not in allowed_delta:
        raise StoreKernelAssertionError(
            f"transaction delta {actual_delta} not in allowed {allowed_delta!r}"
        )

    if actual_delta == 0:
        before_fingerprint = logical_store_kernel_fingerprint(before)
        current_fingerprint = logical_store_kernel_fingerprint(current)
        if before_fingerprint != current_fingerprint:
            raise StoreKernelAssertionError(
                f"zero transaction delta mutated Store Kernel: {before_fingerprint} != {current_fingerprint}"
            )
        return {"transaction_delta": 0, "fingerprint": current_fingerprint, "transactions": []}

    current_aggregates = _row_map(
        _snapshot_rows(current, "aggregates"),
        ("store_id", "aggregate_type", "aggregate_id"),
        "aggregates",
    )
    before_aggregates = _row_map(
        _snapshot_rows(before, "aggregates"),
        ("store_id", "aggregate_type", "aggregate_id"),
        "aggregates",
    )
    current_outbox = _row_map(_snapshot_rows(current, "outbox"), ("event_id",), "outbox")
    before_outbox = _row_map(_snapshot_rows(before, "outbox"), ("event_id",), "outbox")
    current_journal = _row_map(
        _snapshot_rows(current, "journal"), ("trace_id", "checkpoint_id"), "journal"
    )
    before_journal = _row_map(
        _snapshot_rows(before, "journal"), ("trace_id", "checkpoint_id"), "journal"
    )
    for table, previous, latest in (
        ("aggregates", before_aggregates, current_aggregates),
        ("outbox", before_outbox, current_outbox),
        ("journal", before_journal, current_journal),
    ):
        removed = sorted(set(previous) - set(latest))
        if removed:
            raise StoreKernelAssertionError(f"Store Kernel {table} rows were removed: {removed!r}")

    added_aggregates = [current_aggregates[key] for key in set(current_aggregates) - set(before_aggregates)]
    added_outbox = [current_outbox[key] for key in set(current_outbox) - set(before_outbox)]
    added_journal = [current_journal[key] for key in set(current_journal) - set(before_journal)]
    allowed_new_aggregate_types = set(STORE_CHECKOUT_TRANSACTION_TYPES) | {"ORDER_DISPLAY_COUNTER", "BUSINESS_DAY_CURRENT"}
    unexpected_aggregate_types = sorted({
        str(row.get("aggregate_type"))
        for row in added_aggregates
        if row.get("aggregate_type") not in allowed_new_aggregate_types
    })
    if unexpected_aggregate_types:
        raise StoreKernelAssertionError(f"unexpected new aggregate types: {unexpected_aggregate_types!r}")
    for aggregate_type in STORE_CHECKOUT_TRANSACTION_TYPES:
        count = sum(1 for row in added_aggregates if row.get("aggregate_type") == aggregate_type)
        if count != actual_delta:
            raise StoreKernelAssertionError(
                f"new {aggregate_type} aggregate count {count} != transaction delta {actual_delta}"
            )
    if len(added_outbox) != actual_delta * len(STORE_CHECKOUT_EVENT_TYPES):
        raise StoreKernelAssertionError(
            f"new outbox count {len(added_outbox)} != {actual_delta * len(STORE_CHECKOUT_EVENT_TYPES)}"
        )
    if len(added_journal) != actual_delta * 3:
        raise StoreKernelAssertionError(f"new journal count {len(added_journal)} != {actual_delta * 3}")

    expected_tenders = assertion.get("tenders", [])
    if expected_tenders and actual_delta != 0 and len(expected_tenders) != actual_delta:
        raise StoreKernelAssertionError(
            f"expected tender count {len(expected_tenders)} != transaction delta {actual_delta}"
        )

    transactions: List[Dict[str, Any]] = []
    actual_tenders: List[str] = []
    for receipt in added_receipts:
        if receipt.get("operation_id") != "STORE_CHECKOUT_COMMIT":
            raise StoreKernelAssertionError(f"unexpected new operation_id: {receipt.get('operation_id')!r}")
        result = _json_object(receipt, "result_json", "receipt")
        required_ids = ("orderId", "paymentId", "fulfillmentId", "printAdmissionId", "displayOrderCode")
        if result.get("ok") is not True or any(
            not isinstance(result.get(field), str) or not result[field] for field in required_ids
        ):
            raise StoreKernelAssertionError(f"checkout receipt identity set incomplete: {result!r}")
        store_id = receipt.get("store_id")
        order_id = result["orderId"]
        payment_id = result["paymentId"]
        fulfillment_id = result["fulfillmentId"]
        print_id = result["printAdmissionId"]
        display_code = result["displayOrderCode"]

        def aggregate_state(aggregate_type: str, aggregate_id: str) -> Dict[str, Any]:
            row = current_aggregates.get((store_id, aggregate_type, aggregate_id))
            if row is None:
                raise StoreKernelAssertionError(
                    f"missing {aggregate_type} aggregate {aggregate_id!r} for receipt {receipt.get('command_id')!r}"
                )
            return _json_object(row, "state_json", f"{aggregate_type}:{aggregate_id}")

        order = aggregate_state("ORDER", order_id)
        payment = aggregate_state("PAYMENT", payment_id)
        fulfillment = aggregate_state("FULFILLMENT", fulfillment_id)
        print_admission = aggregate_state("ORDER_PRINT_ADMISSION", print_id)
        assignments = [
            _json_object(row, "state_json", "ORDER_DISPLAY_ASSIGNMENT")
            for row in current_aggregates.values()
            if row.get("store_id") == store_id and row.get("aggregate_type") == "ORDER_DISPLAY_ASSIGNMENT"
        ]
        assignments = [state for state in assignments if state.get("orderId") == order_id]
        if len(assignments) != 1 or assignments[0].get("displayOrderCode") != display_code:
            raise StoreKernelAssertionError(f"display assignment mismatch for order {order_id!r}")
        if order.get("orderId") != order_id or order.get("localDisplayOrderCode") != display_code:
            raise StoreKernelAssertionError(f"Order identity/display mismatch for {order_id!r}")
        tender = payment.get("tenderMethod")
        if (
            payment.get("paymentId") != payment_id
            or payment.get("orderId") != order_id
            or tender not in STORE_CHECKOUT_TENDERS
            or payment.get("lifecycleStatus") != "COMPLETED"
            or payment.get("evidenceProvenance") != "STAFF_OBSERVED"
            or payment.get("providerPaymentAlias") is not None
        ):
            raise StoreKernelAssertionError(f"operator-recorded Payment state invalid: {payment!r}")
        if fulfillment.get("fulfillmentId") != fulfillment_id or fulfillment.get("orderId") != order_id:
            raise StoreKernelAssertionError(f"Fulfillment identity mismatch for order {order_id!r}")
        if (
            print_admission.get("printAdmissionId") != print_id
            or print_admission.get("orderId") != order_id
            or print_admission.get("status") != "ADMITTED"
        ):
            raise StoreKernelAssertionError(f"Print Admission identity mismatch for order {order_id!r}")

        event_rows = [row for row in current_outbox.values() if row.get("aggregate_id") in {
            order_id, payment_id, fulfillment_id, print_id
        }]
        if sorted(str(row.get("event_type")) for row in event_rows) != sorted(STORE_CHECKOUT_EVENT_TYPES):
            raise StoreKernelAssertionError(f"outbox event identity set mismatch for order {order_id!r}")
        stages = sorted(
            (int(row.get("sequence", 0)), str(row.get("stage")))
            for row in current_journal.values()
            if row.get("trace_id") == receipt.get("trace_id")
        )
        if stages != [(1, "RECEIVED"), (2, "VALIDATED"), (3, "LOCAL_TX_COMMITTED")]:
            raise StoreKernelAssertionError(f"commit journal incomplete for trace {receipt.get('trace_id')!r}: {stages!r}")
        actual_tenders.append(str(tender))
        transactions.append({
            "orderId": order_id,
            "displayOrderCode": display_code,
            "paymentId": payment_id,
            "fulfillmentId": fulfillment_id,
            "printAdmissionId": print_id,
            "tenderMethod": tender,
            "traceId": receipt.get("trace_id"),
            "commitSequence": receipt.get("commit_sequence"),
        })

    if expected_tenders and actual_delta != 0 and actual_tenders != expected_tenders:
        raise StoreKernelAssertionError(f"tenders {actual_tenders!r} != expected {expected_tenders!r}")
    if assertion.get("require_pending_outbox") and any(row.get("status") != "PENDING" for row in added_outbox):
        raise StoreKernelAssertionError("new offline outbox rows are not all PENDING")
    return {
        "transaction_delta": actual_delta,
        "fingerprint": logical_store_kernel_fingerprint(current),
        "transactions": transactions,
    }


def parse_bounds(value: Any) -> Tuple[int, int, int, int]:
    if isinstance(value, list) and len(value) == 4 and all(isinstance(v, int) for v in value):
        x1, y1, x2, y2 = value
    elif isinstance(value, str):
        match = BOUNDS_RE.match(value)
        if not match:
            raise ManifestError(f"invalid bounds: {value!r}")
        x1, y1, x2, y2 = (int(match.group(i)) for i in range(1, 5))
    else:
        raise ManifestError(f"invalid bounds: {value!r}")
    if x2 <= x1 or y2 <= y1:
        raise ManifestError(f"non-positive bounds: {value!r}")
    return x1, y1, x2, y2


def bounds_text(bounds: Tuple[int, int, int, int]) -> str:
    x1, y1, x2, y2 = bounds
    return f"[{x1},{y1}][{x2},{y2}]"


def canonical_ui_fingerprint(xml_text: str, activity_text: str) -> str:
    try:
        root = ET.fromstring(xml_text)
        attrs = ("resource-id", "text", "content-desc", "bounds", "checked", "enabled", "selected", "focused")
        ui = "\n".join("\x1f".join(node.attrib.get(k, "") for k in attrs) for node in root.iter("node"))
    except ET.ParseError:
        ui = xml_text.strip()
    resumed = "\n".join(
        line.strip()
        for line in activity_text.splitlines()
        if "mResumedActivity" in line or "topResumedActivity" in line or "ResumedActivity" in line
    )
    return hashlib.sha256((ui + "\n--activity--\n" + resumed).encode("utf-8")).hexdigest()


def make_observation(xml_text: str, activity_text: str = "") -> Observation:
    return Observation(xml_text, activity_text, canonical_ui_fingerprint(xml_text, activity_text))


def validate_ui_hierarchy(xml_text: str) -> ET.Element:
    if not xml_text.strip():
        raise ManifestError("UIAutomator hierarchy is empty")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ManifestError(f"UIAutomator hierarchy is not valid XML: {exc}") from exc
    if root.tag.rsplit("}", 1)[-1] != "hierarchy":
        raise ManifestError(f"UIAutomator hierarchy root is {root.tag!r}, expected 'hierarchy'")
    return root


def _iter_nodes(xml_text: str) -> Iterable[ET.Element]:
    root = validate_ui_hierarchy(xml_text)
    return root.iter("node")


def find_node(xml_text: str, selector: Dict[str, Any]) -> Optional[ET.Element]:
    nodes = list(_iter_nodes(xml_text))
    for key, attr in (("resource_id", "resource-id"), ("text", "text"), ("content_desc", "content-desc")):
        value = selector.get(key)
        if value is not None:
            for node in nodes:
                if node.attrib.get(attr) == str(value):
                    return node
    if selector.get("bounds") is not None:
        target = bounds_text(parse_bounds(selector["bounds"]))
        for node in nodes:
            if node.attrib.get("bounds") == target:
                return node
    return None


def resolve_tap_coordinates(xml_text: str, selector: Dict[str, Any]) -> Optional[Tuple[int, int]]:
    node = find_node(xml_text, selector)
    if node is not None and node.attrib.get("bounds"):
        x1, y1, x2, y2 = parse_bounds(node.attrib["bounds"])
        return ((x1 + x2) // 2, (y1 + y2) // 2)
    if selector.get("bounds") is not None:
        x1, y1, x2, y2 = parse_bounds(selector["bounds"])
        return ((x1 + x2) // 2, (y1 + y2) // 2)
    return None


def selector_present(xml_text: str, selector: Dict[str, Any]) -> bool:
    return find_node(xml_text, selector) is not None


def validate_selector_map(selector_map: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    if selector_map.get("schema_version") != 1:
        raise ManifestError("selector map schema_version must be 1")
    selectors = selector_map.get("selectors")
    if not isinstance(selectors, dict) or not selectors:
        raise ManifestError("selector map requires non-empty selectors object")
    allowed = {"resource_id", "text", "content_desc", "bounds"}
    out: Dict[str, Dict[str, Any]] = {}
    for name, spec in selectors.items():
        if not isinstance(name, str) or not name:
            raise ManifestError("selector names must be non-empty strings")
        if not isinstance(spec, dict) or not any(k in spec for k in allowed):
            raise ManifestError(f"selector {name!r} must define a supported locator")
        extra = set(spec) - allowed
        if extra:
            raise ManifestError(f"selector {name!r} has unsupported fields: {sorted(extra)}")
        if "bounds" in spec:
            parse_bounds(spec["bounds"])
        out[name] = dict(spec)
    return out


def _validate_expect(expect: Any, where: str) -> None:
    if not isinstance(expect, dict):
        raise ManifestError(f"{where} expect must be an object")
    for key in ("present", "absent"):
        if key in expect and (not isinstance(expect[key], list) or not all(isinstance(x, str) and x for x in expect[key])):
            raise ManifestError(f"{where} expect.{key} must be a string list")
    if "activity_contains" in expect and not isinstance(expect["activity_contains"], str):
        raise ManifestError(f"{where} expect.activity_contains must be string")
    if not any(k in expect for k in ("present", "absent", "activity_contains")):
        raise ManifestError(f"{where} expect must declare a visible/activity condition")


def _validate_store_kernel_assertion(value: Any, where: str) -> None:
    if not isinstance(value, dict):
        raise ManifestError(f"{where}.store_kernel must be an object")
    allowed = {"checkpoint", "compare_to", "transaction_delta", "tenders", "require_pending_outbox"}
    extra = set(value) - allowed
    if extra:
        raise ManifestError(f"{where}.store_kernel has unsupported fields: {sorted(extra)}")
    checkpoint = value.get("checkpoint")
    if not isinstance(checkpoint, str) or not checkpoint:
        raise ManifestError(f"{where}.store_kernel.checkpoint required")
    compare_to = value.get("compare_to")
    if compare_to is not None and (not isinstance(compare_to, str) or not compare_to):
        raise ManifestError(f"{where}.store_kernel.compare_to must be a non-empty string")
    transaction_delta = value.get("transaction_delta")
    if compare_to is None and transaction_delta is not None:
        raise ManifestError(f"{where}.store_kernel.transaction_delta requires compare_to")
    if compare_to is not None:
        if (
            not isinstance(transaction_delta, list)
            or not transaction_delta
            or any(not isinstance(item, int) or isinstance(item, bool) or item < 0 or item > 16 for item in transaction_delta)
            or len(set(transaction_delta)) != len(transaction_delta)
        ):
            raise ManifestError(f"{where}.store_kernel.transaction_delta must be unique integers in 0..16")
    tenders = value.get("tenders", [])
    if not isinstance(tenders, list) or any(item not in STORE_CHECKOUT_TENDERS for item in tenders):
        raise ManifestError(f"{where}.store_kernel.tenders invalid")
    if tenders and len(tenders) not in transaction_delta:
        raise ManifestError(f"{where}.store_kernel.tenders count must be an allowed transaction_delta")
    if "require_pending_outbox" in value and not isinstance(value["require_pending_outbox"], bool):
        raise ManifestError(f"{where}.store_kernel.require_pending_outbox must be boolean")


def validate_manifest(manifest: Dict[str, Any], selectors: Dict[str, Dict[str, Any]]) -> None:
    if manifest.get("schema_version") != 1:
        raise ManifestError("manifest schema_version must be 1")
    for field in ("scenario_id", "package_id", "main_activity"):
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            raise ManifestError(f"manifest requires {field}")
    timeouts = manifest.get("timeouts", {})
    if timeouts and not isinstance(timeouts, dict):
        raise ManifestError("timeouts must be an object")
    for key, default in (("transition_ms", 5000), ("poll_ms", 250)):
        value = int(timeouts.get(key, default))
        if value <= 0 or value > 60000:
            raise ManifestError(f"timeouts.{key} must be 1..60000")
    steps = manifest.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ManifestError("manifest requires non-empty steps")
    seen: set[str] = set()
    referenced: set[str] = set()
    for i, step in enumerate(steps):
        where = f"steps[{i}]"
        if not isinstance(step, dict):
            raise ManifestError(f"{where} must be an object")
        step_id = step.get("id")
        if not isinstance(step_id, str) or not step_id or step_id in seen:
            raise ManifestError(f"{where}.id must be unique non-empty string")
        seen.add(step_id)
        action = step.get("action")
        if action not in {"launch", "tap", "checkpoint", "restart", "process_death", "network"}:
            raise ManifestError(f"{where}.action unsupported: {action!r}")
        if action in {"launch", "tap", "checkpoint", "process_death"}:
            _validate_expect(step.get("expect"), where)
        if action in {"tap", "process_death"}:
            target = step.get("target")
            if not isinstance(target, str) or not target:
                raise ManifestError(f"{where}.target required")
            referenced.add(target)
        if action == "tap":
            tap_count = step.get("tap_count", 1)
            if not isinstance(tap_count, int) or isinstance(tap_count, bool) or tap_count < 1 or tap_count > 4:
                raise ManifestError(f"{where}.tap_count must be an integer in 1..4")
            interval = step.get("tap_interval_ms", 0)
            if not isinstance(interval, int) or isinstance(interval, bool) or interval < 0 or interval > 1000:
                raise ManifestError(f"{where}.tap_interval_ms must be an integer in 0..1000")
            if "allow_preexisting_expectation" in step and not isinstance(step["allow_preexisting_expectation"], bool):
                raise ManifestError(f"{where}.allow_preexisting_expectation must be boolean")
        if action == "network" and step.get("state") not in {"OFFLINE", "ONLINE"}:
            raise ManifestError(f"{where}.state must be OFFLINE or ONLINE")
        if "expect" in step:
            for key in ("present", "absent"):
                referenced.update(step["expect"].get(key, []))
        if action == "restart":
            persistence = step.get("persistence")
            if not isinstance(persistence, dict):
                raise ManifestError(f"{where}.persistence required")
            mode = persistence.get("mode")
            if mode not in {"PRESERVE", "RESET_EXPECTED", "RECOVER"}:
                raise ManifestError(f"{where}.persistence.mode invalid")
            before = persistence.get("before", [])
            after = persistence.get("after")
            if not isinstance(before, list) or not all(isinstance(x, str) and x for x in before):
                raise ManifestError(f"{where}.persistence.before must be a string list")
            if mode == "PRESERVE" and after is None:
                after = before
                persistence["after"] = list(before)
            if not isinstance(after, list) or not after or not all(isinstance(x, str) and x for x in after):
                raise ManifestError(f"{where}.persistence.after must be a non-empty string list")
            referenced.update(before)
            referenced.update(after)
        if "store_kernel" in step:
            _validate_store_kernel_assertion(step["store_kernel"], where)
        if "timeout_ms" in step:
            timeout = int(step["timeout_ms"])
            if timeout <= 0 or timeout > 60000:
                raise ManifestError(f"{where}.timeout_ms must be 1..60000")
    missing = sorted(referenced - set(selectors))
    if missing:
        raise ManifestError(f"selector map missing logical selectors: {missing}")


def expectation_matches(obs: Observation, expect: Dict[str, Any], selectors: Dict[str, Dict[str, Any]]) -> bool:
    return (
        all(selector_present(obs.ui_xml, selectors[name]) for name in expect.get("present", []))
        and all(not selector_present(obs.ui_xml, selectors[name]) for name in expect.get("absent", []))
        and (expect.get("activity_contains") is None or expect["activity_contains"] in obs.activity)
    )


def expectation_text(expect: Dict[str, Any]) -> str:
    return json.dumps(expect, sort_keys=True, ensure_ascii=False)


def fault_match(obs: Observation, manifest: Dict[str, Any]) -> Optional[str]:
    for pattern in [*DEFAULT_FAULT_TEXT_PATTERNS, *manifest.get("fault_text_patterns", [])]:
        if re.search(pattern, obs.ui_xml):
            return f"ui:{pattern}"
    for pattern in [*DEFAULT_FAULT_ACTIVITY_PATTERNS, *manifest.get("fault_activity_patterns", [])]:
        if re.search(pattern, obs.activity):
            return f"activity:{pattern}"
    return None
