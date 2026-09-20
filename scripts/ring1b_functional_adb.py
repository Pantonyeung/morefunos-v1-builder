from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ring1b_functional_core import HierarchyCaptureError, ManifestError, Observation, make_observation, validate_ui_hierarchy


class AdbBackend:
    def __init__(self, package_id: str, main_activity: str, evidence_dir: str | Path) -> None:
        self.package_id = package_id
        self.main_activity = main_activity
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self._obs_counter = 0

    def _run(self, args: List[str], *, check: bool = True, timeout: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(["adb", *args], check=check, text=True, capture_output=True, timeout=timeout)

    def _shell(self, command: str, *, check: bool = True, timeout: int = 30) -> str:
        return self._run(["shell", command], check=check, timeout=timeout).stdout

    @staticmethod
    def _output_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    def _run_for_evidence(self, args: List[str], *, timeout: int) -> Tuple[Dict[str, Any], str]:
        try:
            result = self._run(args, check=False, timeout=timeout)
            return (
                {
                    "exit_code": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "error": None,
                },
                result.stdout,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = self._output_text(exc.stdout)
            return (
                {
                    "exit_code": None,
                    "stdout": stdout,
                    "stderr": self._output_text(exc.stderr),
                    "error": f"TimeoutExpired after {timeout}s",
                },
                stdout,
            )
        except OSError as exc:
            return (
                {
                    "exit_code": None,
                    "stdout": "",
                    "stderr": "",
                    "error": f"{type(exc).__name__}: {exc}",
                },
                "",
            )

    def _save_hierarchy_capture(
        self,
        remote: str,
        dump: Dict[str, Any],
        readback: Dict[str, Any],
        raw_hierarchy: str,
        validation_error: Optional[str],
    ) -> str:
        capture_dir = self.evidence_dir / "hierarchy-captures" / f"{self._obs_counter:04d}"
        capture_dir.mkdir(parents=True, exist_ok=True)
        (capture_dir / "dump.stdout.txt").write_text(dump["stdout"], encoding="utf-8", errors="replace")
        (capture_dir / "dump.stderr.txt").write_text(dump["stderr"], encoding="utf-8", errors="replace")
        (capture_dir / "readback.stderr.txt").write_text(readback["stderr"], encoding="utf-8", errors="replace")
        (capture_dir / "hierarchy.raw").write_text(raw_hierarchy, encoding="utf-8", errors="replace")
        metadata = {
            "observation": self._obs_counter,
            "remote_path": remote,
            "dump": dump,
            "readback": {**readback, "stdout": "PRESERVED_IN_hierarchy.raw"},
            "raw_hierarchy_file": "hierarchy.raw",
            "hierarchy_valid": validation_error is None,
            "validation_error": validation_error,
        }
        (capture_dir / "capture.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return capture_dir.relative_to(self.evidence_dir).as_posix()

    def observe(self) -> Observation:
        self._obs_counter += 1
        remote = f"/sdcard/r1b-functional-{os.getpid()}-{self._obs_counter}.xml"
        try:
            dump, _ = self._run_for_evidence(["shell", f"uiautomator dump {remote}"], timeout=15)
            readback, xml = self._run_for_evidence(["exec-out", "cat", remote], timeout=15)
        finally:
            try:
                self._shell(f"rm -f {remote}", check=False, timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                pass
        if dump["exit_code"] != 0:
            validation_error = f"UIAutomator dump failed: exit_code={dump['exit_code']}; error={dump['error']}"
        elif readback["exit_code"] != 0:
            validation_error = f"UI hierarchy readback failed: exit_code={readback['exit_code']}; error={readback['error']}"
        else:
            try:
                validate_ui_hierarchy(xml)
                validation_error = None
            except ManifestError as exc:
                validation_error = str(exc)
        evidence_ref = self._save_hierarchy_capture(remote, dump, readback, xml, validation_error)
        if validation_error is not None:
            raise HierarchyCaptureError(
                validation_error,
                evidence_ref=evidence_ref,
                dump_exit_code=dump["exit_code"],
                readback_exit_code=readback["exit_code"],
            )
        activity = self._shell("dumpsys activity activities", check=False, timeout=15)
        return make_observation(xml, activity)

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
