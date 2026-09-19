from __future__ import annotations

import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ring1b_functional_core import Observation, make_observation


class UiHierarchyUnavailable(RuntimeError):
    def __init__(self, summary: str) -> None:
        super().__init__(summary)
        self.summary = summary


class AdbBackend:
    def __init__(
        self,
        package_id: str,
        main_activity: str,
        evidence_dir: str | Path,
        *,
        hierarchy_max_attempts: int = 3,
        hierarchy_retry_ms: int = 200,
    ) -> None:
        if hierarchy_max_attempts <= 0 or hierarchy_max_attempts > 10:
            raise ValueError("hierarchy_max_attempts must be 1..10")
        if hierarchy_retry_ms < 0 or hierarchy_retry_ms > 5000:
            raise ValueError("hierarchy_retry_ms must be 0..5000")
        self.package_id = package_id
        self.main_activity = main_activity
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self.hierarchy_max_attempts = hierarchy_max_attempts
        self.hierarchy_retry_ms = hierarchy_retry_ms
        self._obs_counter = 0

    def _run(self, args: List[str], *, check: bool = True, timeout: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(["adb", *args], check=check, text=True, capture_output=True, timeout=timeout)

    def _shell(self, command: str, *, check: bool = True, timeout: int = 30) -> str:
        return self._run(["shell", command], check=check, timeout=timeout).stdout


    @staticmethod
    def _text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    @staticmethod
    def _preview(value: str, limit: int = 240) -> str:
        normalized = value.replace("\r", "\\r").replace("\n", "\\n")
        if len(normalized) <= limit:
            return normalized
        return normalized[:limit] + f"…(+{len(normalized) - limit} chars)"

    def _run_recorded(self, args: List[str], *, timeout: int) -> Tuple[Dict[str, Any], str]:
        started = time.monotonic()
        try:
            result = self._run(args, check=False, timeout=timeout)
            stdout = self._text(result.stdout)
            stderr = self._text(result.stderr)
            record = {
                "args": args,
                "returncode": result.returncode,
                "timed_out": False,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "stdout_preview": self._preview(stdout),
                "stderr_preview": self._preview(stderr),
                "stdout": stdout,
                "stderr": stderr,
            }
            return record, stdout
        except subprocess.TimeoutExpired as exc:
            stdout = self._text(exc.stdout)
            stderr = self._text(exc.stderr)
            record = {
                "args": args,
                "returncode": None,
                "timed_out": True,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "stdout_preview": self._preview(stdout),
                "stderr_preview": self._preview(stderr),
                "stdout": stdout,
                "stderr": stderr,
            }
            return record, stdout

    @staticmethod
    def _classify_xml(payload: str) -> Tuple[str, str]:
        stripped = payload.strip()
        if not stripped:
            return "empty_readback", "payload is empty"
        if not stripped.startswith("<"):
            return "non_xml_readback", "payload does not start with '<'"
        try:
            root = ET.fromstring(payload)
        except ET.ParseError as exc:
            return "invalid_xml", str(exc)
        if root.tag != "hierarchy":
            return "non_uiautomator_xml", f"root tag is {root.tag!r}, expected 'hierarchy'"
        return "valid_xml", ""

    def _write_attempt_evidence(self, observation_dir: Path, attempt: Dict[str, Any]) -> None:
        attempt_dir = observation_dir / f"attempt-{attempt['attempt']:02d}"
        attempt_dir.mkdir(parents=True, exist_ok=True)
        dump = attempt["dump_result"]
        cat = attempt["cat_result"]
        (attempt_dir / "dump.stdout.txt").write_text(dump["stdout"], encoding="utf-8", errors="replace")
        (attempt_dir / "dump.stderr.txt").write_text(dump["stderr"], encoding="utf-8", errors="replace")
        (attempt_dir / "cat.stdout.txt").write_text(cat["stdout"], encoding="utf-8", errors="replace")
        (attempt_dir / "cat.stderr.txt").write_text(cat["stderr"], encoding="utf-8", errors="replace")
        compact = {
            "attempt": attempt["attempt"],
            "classification": attempt["classification"],
            "detail": attempt["detail"],
            "elapsed_ms": attempt["elapsed_ms"],
            "payload_preview": attempt["payload_preview"],
            "dump_result": {k: dump[k] for k in ("returncode", "timed_out", "elapsed_ms", "stdout_preview", "stderr_preview")},
            "cat_result": {k: cat[k] for k in ("returncode", "timed_out", "elapsed_ms", "stdout_preview", "stderr_preview")},
        }
        (attempt_dir / "attempt.json").write_text(
            json.dumps(compact, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def _write_observation_summary(
        self,
        observation_dir: Path,
        attempts: List[Dict[str, Any]],
        *,
        elapsed_ms: int,
        recovered: bool,
    ) -> None:
        payload = {
            "attempt_count": len(attempts),
            "elapsed_ms": elapsed_ms,
            "recovered": recovered,
            "attempts": [
                {
                    "attempt": item["attempt"],
                    "classification": item["classification"],
                    "detail": item["detail"],
                    "elapsed_ms": item["elapsed_ms"],
                    "payload_preview": item["payload_preview"],
                    "dump_returncode": item["dump_result"]["returncode"],
                    "dump_timed_out": item["dump_result"]["timed_out"],
                    "cat_returncode": item["cat_result"]["returncode"],
                    "cat_timed_out": item["cat_result"]["timed_out"],
                }
                for item in attempts
            ],
        }
        observation_dir.mkdir(parents=True, exist_ok=True)
        (observation_dir / "summary.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def _diagnostic_summary(self, attempts: List[Dict[str, Any]], elapsed_ms: int, observation_dir: Path) -> str:
        outcomes = []
        for item in attempts:
            outcomes.append(
                f"{item['attempt']}:{item['classification']}"
                f" dump_rc={item['dump_result']['returncode']}"
                f" cat_rc={item['cat_result']['returncode']}"
                f" payload={item['payload_preview']!r}"
            )
        return (
            f"attempts={len(attempts)}/{self.hierarchy_max_attempts}; elapsed_ms={elapsed_ms}; "
            f"outcomes=[{' | '.join(outcomes)}]; evidence={observation_dir}"
        )

    def observe(self) -> Observation:
        self._obs_counter += 1
        remote = f"/sdcard/r1b-functional-{os.getpid()}-{self._obs_counter}.xml"
        observation_dir = self.evidence_dir / "ui-hierarchy-observation" / f"observation-{self._obs_counter:04d}"
        started = time.monotonic()
        attempts: List[Dict[str, Any]] = []

        for attempt_no in range(1, self.hierarchy_max_attempts + 1):
            attempt_started = time.monotonic()
            self._shell(f"rm -f {remote}", check=False, timeout=10)
            try:
                dump_result, _ = self._run_recorded(["shell", "uiautomator", "dump", remote], timeout=15)
                cat_result, payload = self._run_recorded(["exec-out", "cat", remote], timeout=15)

                if dump_result["timed_out"] or dump_result["returncode"] != 0:
                    classification, detail = "dump_failure", "uiautomator dump failed or timed out"
                elif cat_result["timed_out"] or cat_result["returncode"] != 0:
                    classification, detail = "cat_failure", "exec-out cat failed or timed out"
                else:
                    classification, detail = self._classify_xml(payload)

                attempt = {
                    "attempt": attempt_no,
                    "classification": classification,
                    "detail": detail,
                    "elapsed_ms": int((time.monotonic() - attempt_started) * 1000),
                    "payload_preview": self._preview(payload),
                    "dump_result": dump_result,
                    "cat_result": cat_result,
                }
                attempts.append(attempt)

                if classification == "valid_xml":
                    if attempt_no > 1:
                        self._write_attempt_evidence(observation_dir, attempt)
                        self._write_observation_summary(
                            observation_dir,
                            attempts,
                            elapsed_ms=int((time.monotonic() - started) * 1000),
                            recovered=True,
                        )
                    activity = self._shell("dumpsys activity activities", check=False, timeout=15)
                    return make_observation(payload, activity)

                self._write_attempt_evidence(observation_dir, attempt)
            finally:
                self._shell(f"rm -f {remote}", check=False, timeout=10)

            if attempt_no < self.hierarchy_max_attempts and self.hierarchy_retry_ms:
                self.sleep(self.hierarchy_retry_ms / 1000.0)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        self._write_observation_summary(observation_dir, attempts, elapsed_ms=elapsed_ms, recovered=False)
        raise UiHierarchyUnavailable(self._diagnostic_summary(attempts, elapsed_ms, observation_dir))

    def capture_evidence(self, label: str, obs: Optional[Observation] = None) -> Observation:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        dest = self.evidence_dir / safe
        dest.mkdir(parents=True, exist_ok=True)
        obs = obs or self.observe()
        (dest / "ui.xml").write_text(obs.ui_xml, encoding="utf-8")
        (dest / "activity.txt").write_text(obs.activity, encoding="utf-8")
        (dest / "fingerprint.txt").write_text(obs.fingerprint + "\n", encoding="utf-8")
        with open(dest / "screen.png", "wb") as fh:
            subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=fh, stderr=subprocess.DEVNULL, check=False, timeout=20)
        pid = self._shell(f"pidof {self.package_id}", check=False, timeout=10).strip().split()
        log_args = ["logcat", "-d", "-v", "threadtime"]
        if pid:
            log_args[2:2] = [f"--pid={pid[0]}"]
        log = self._run(log_args, check=False, timeout=20)
        (dest / "app-logcat.txt").write_text(log.stdout, encoding="utf-8", errors="replace")
        return obs

    def tap(self, x: int, y: int) -> None:
        self._shell(f"input tap {x} {y}", timeout=10)

    def force_stop(self) -> None:
        self._shell(f"am force-stop {self.package_id}", check=False, timeout=15)

    def launch(self) -> None:
        self._shell(f"am start -W -n {self.package_id}/{self.main_activity}", timeout=30)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)
