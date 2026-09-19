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
R1B_UI_HIERARCHY_UNAVAILABLE = "R1B_UI_HIERARCHY_UNAVAILABLE"
R1B_MANIFEST_INVALID = "R1B_MANIFEST_INVALID"

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


def load_json(path: str | Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    if not isinstance(value, dict):
        raise ManifestError("top-level JSON must be an object")
    return value


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


def _iter_nodes(xml_text: str) -> Iterable[ET.Element]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ManifestError(f"UIAutomator XML parse error: {exc}") from exc
    return root.iter("node")


def find_node(xml_text: str, selector: Dict[str, Any]) -> Optional[ET.Element]:
    nodes = list(_iter_nodes(xml_text))
    for key, attr in (("resource_id", "resource-id"), ("text", "text"), ("content_desc", "content-desc")):
        value = selector.get(key)
        if value is not None:
            for node in nodes:
                if node.attrib.get(attr) == str(value):
                    return node
    text_contains = selector.get("text_contains")
    if text_contains is not None:
        needle = str(text_contains)
        for node in nodes:
            if needle in node.attrib.get("text", ""):
                return node
    if selector.get("bounds") is not None:
        target = bounds_text(parse_bounds(selector["bounds"]))
        for node in nodes:
            if node.attrib.get("bounds") == target:
                return node
    return None


def resolve_tap_coordinates(xml_text: str, selector: Dict[str, Any]) -> Optional[Tuple[int, int]]:
    if "text_contains" in selector:
        return None
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
    allowed = {"resource_id", "text", "text_contains", "content_desc", "bounds"}
    out: Dict[str, Dict[str, Any]] = {}
    for name, spec in selectors.items():
        if not isinstance(name, str) or not name:
            raise ManifestError("selector names must be non-empty strings")
        if not isinstance(spec, dict) or not any(k in spec for k in allowed):
            raise ManifestError(f"selector {name!r} must define a supported locator")
        extra = set(spec) - allowed
        if extra:
            raise ManifestError(f"selector {name!r} has unsupported fields: {sorted(extra)}")
        if "text_contains" in spec and (not isinstance(spec["text_contains"], str) or not spec["text_contains"]):
            raise ManifestError(f"selector {name!r} text_contains must be a non-empty string")
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
        if action not in {"launch", "tap", "checkpoint", "restart"}:
            raise ManifestError(f"{where}.action unsupported: {action!r}")
        if action in {"launch", "tap", "checkpoint"}:
            _validate_expect(step.get("expect"), where)
        if action == "tap":
            target = step.get("target")
            if not isinstance(target, str) or not target:
                raise ManifestError(f"{where}.target required")
            if target in selectors and "text_contains" in selectors[target]:
                raise ManifestError(f"{where}.target cannot use text_contains locator")
            referenced.add(target)
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
