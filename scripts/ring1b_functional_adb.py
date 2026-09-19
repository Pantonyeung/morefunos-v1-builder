from __future__ import annotations

import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional

from ring1b_functional_core import Observation, make_observation


class UiHierarchyUnavailable(RuntimeError):
    pass


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

    def observe(self) -> Observation:
        self._obs_counter += 1
        last_actual = "UIAutomator hierarchy unavailable"
        for attempt in range(1, 6):
            remote = f"/sdcard/r1b-functional-{os.getpid()}-{self._obs_counter}-{attempt}.xml"
            dump = None
            readback = None
            xml = ""
            try:
                dump = self._run(["shell", "uiautomator", "dump", remote], check=False, timeout=15)
                readback = self._run(["exec-out", "cat", remote], check=False, timeout=15)
                xml = readback.stdout if readback.returncode == 0 else ""
                try:
                    ET.fromstring(xml)
                except ET.ParseError as exc:
                    stderr = ((dump.stderr if dump else "") or "").strip().replace("\n", " ")[:240]
                    last_actual = (
                        f"attempt={attempt}; dump_rc={getattr(dump, 'returncode', -1)}; "
                        f"read_rc={getattr(readback, 'returncode', -1)}; "
                        f"xml_bytes={len(xml.encode('utf-8'))}; parse={exc}; dump_stderr={stderr}"
                    )
                else:
                    activity = self._shell("dumpsys activity activities", check=False, timeout=15)
                    return make_observation(xml, activity)
            finally:
                self._shell(f"rm -f {remote}", check=False, timeout=10)
            time.sleep(0.3)
        raise UiHierarchyUnavailable(last_actual)

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
