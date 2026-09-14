#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from typing import Any


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_customer_sw_artifact(source: pathlib.Path, artifact: pathlib.Path) -> dict[str, Any]:
    source_bytes = source.read_bytes() if source.is_file() else b""
    artifact_bytes = artifact.read_bytes() if artifact.is_file() else b""
    source_text = source_bytes.decode("utf-8", errors="replace")
    artifact_text = artifact_bytes.decode("utf-8", errors="replace")
    checks = [
        ("CUSTOMER_SW_DIST_EXISTS", bool(artifact_bytes)),
        ("CUSTOMER_SW_PUSH_HANDLER", bool(re.search(r"addEventListener\s*\(\s*['\"]push['\"]", artifact_text))),
        ("CUSTOMER_SW_NOTIFICATIONCLICK_HANDLER", bool(re.search(r"addEventListener\s*\(\s*['\"]notificationclick['\"]", artifact_text))),
        ("CUSTOMER_SW_PUBLIC_DIST_CONSISTENCY", bool(source_bytes) and source_bytes == artifact_bytes),
        ("CUSTOMER_SW_HASH_EVIDENCE", bool(source_bytes) and _sha256(source_bytes) == _sha256(artifact_bytes)),
    ]
    first_failed = next((station for station, passed in checks if not passed), "NONE")
    return {
        "schema_version": 1,
        "canonical_source": str(source).replace("\\", "/"),
        "built_artifact": str(artifact).replace("\\", "/"),
        "source_sw_sha256": _sha256(source_bytes) if source_bytes else None,
        "dist_sw_sha256": _sha256(artifact_bytes) if artifact_bytes else None,
        "public_to_dist_equal": bool(source_bytes) and source_bytes == artifact_bytes,
        "checks": [{"station": station, "result": PASS if passed else FAIL} for station, passed in checks],
        "first_failed_station": first_failed,
        "passed": first_failed == "NONE",
    }


PASS = "PASS"
FAIL = "FAIL"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=pathlib.Path)
    parser.add_argument("--artifact", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    result = verify_customer_sw_artifact(args.source, args.artifact)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
