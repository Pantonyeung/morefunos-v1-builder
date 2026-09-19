#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION = "R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION"

_UNCAUGHT_RE = re.compile(
    r"\bUncaught(?:\s+\(in promise\))?\s+(?:[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception))\s*:",
    re.IGNORECASE,
)
_APP_SOURCE_RE = re.compile(
    r"(?P<source>"
    r"https?://appassets\.androidplatform\.net/(?:assets|baseline)(?:/[^\s\"'),]+)*"
    r"|file:///android_asset/(?:assets|baseline)(?:/[^\s\"'),]+)*"
    r")",
    re.IGNORECASE,
)
_EXCEPTION_TEXT_RE = re.compile(
    r"(?P<exception>Uncaught(?:\s+\(in promise\))?\s+(?:[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception))\s*:[^\r\n\"]+)",
    re.IGNORECASE,
)


def detect_app_webview_uncaught(log_text: str) -> Optional[Dict[str, Any]]:
    """Return the first uncaught JS exception that is sourced from the shipped app bundle."""
    lines = log_text.splitlines()
    for index, line in enumerate(lines):
        if not _UNCAUGHT_RE.search(line):
            continue
        # Chromium normally keeps exception + source URI on one line, but tolerate a short wrapped context.
        context_lines: List[str] = lines[index : index + 3]
        context = "\n".join(context_lines)
        source_match = _APP_SOURCE_RE.search(context)
        if not source_match:
            continue
        exception_match = _EXCEPTION_TEXT_RE.search(context)
        exception = exception_match.group("exception").strip() if exception_match else line.strip()
        return {
            "code": R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION,
            "line": index + 1,
            "exception": exception,
            "source": source_match.group("source"),
            "raw": context,
        }
    return None


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Fail Ring1B on uncaught app-scoped WebView console exceptions")
    parser.add_argument("logcat")
    parser.add_argument("--label", default="unknown")
    parser.add_argument("--output-json")
    args = parser.parse_args(argv)

    try:
        log_text = Path(args.logcat).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"R1B_WEBVIEW_EXCEPTION_GUARD_IO_ERROR={exc}", file=sys.stderr)
        return 2

    match = detect_app_webview_uncaught(log_text)
    if match is None:
        return 0

    payload = {"result": "RED", "label": args.label, **match}
    if args.output_json:
        _write_json(Path(args.output_json), payload)

    print(f"CODE={R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION}", file=sys.stderr)
    print(f"LABEL={args.label}", file=sys.stderr)
    print(f"EXCEPTION={match['exception']}", file=sys.stderr)
    print(f"SOURCE={match['source']}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
