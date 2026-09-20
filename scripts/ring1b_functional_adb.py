from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ring1b_functional_core import HierarchyCaptureError, ManifestError, Observation, make_observation, validate_ui_hierarchy


class AdbBackend:
    SQLITE_HEADER = b"SQLite format 3\x00"
    SQLITE_WAL_MAGIC = {b"\x37\x7f\x06\x82", b"\x37\x7f\x06\x83"}
    REMOTE_DIAGNOSTIC_MARKERS = (
        "no such file or directory",
        "permission denied",
        "not found",
        "run-as:",
        "cat:",
    )

    def __init__(
        self,
        package_id: str,
        main_activity: str,
        evidence_dir: str | Path,
        *,
        store_kernel_readback_timeout_seconds: float = 10.0,
        store_kernel_readback_poll_seconds: float = 0.25,
    ) -> None:
        self.package_id = package_id
        self.main_activity = main_activity
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self._obs_counter = 0
        self.store_kernel_readback_timeout_seconds = max(0.0, store_kernel_readback_timeout_seconds)
        self.store_kernel_readback_poll_seconds = max(0.0, store_kernel_readback_poll_seconds)

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

    def rapid_tap(self, x: int, y: int, count: int, interval_ms: int, label: str) -> None:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        dest = self.evidence_dir / "actions" / safe
        dest.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        results: List[Dict[str, Any]] = []
        if interval_ms == 0:
            processes = [
                subprocess.Popen(
                    ["adb", "shell", f"input tap {x} {y}"],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                for _ in range(count)
            ]
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                results.append({"exit_code": process.returncode, "stdout": stdout, "stderr": stderr})
        else:
            for tap_index in range(count):
                result = self._run(["shell", f"input tap {x} {y}"], check=False, timeout=10)
                results.append({"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
                if tap_index + 1 < count:
                    time.sleep(interval_ms / 1000.0)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        payload = {"x": x, "y": y, "count": count, "interval_ms": interval_ms, "elapsed_ms": elapsed_ms, "results": results}
        (dest / "rapid-tap.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if any(result["exit_code"] != 0 for result in results):
            raise RuntimeError(f"R1B_RAPID_TAP_FAILED: {results!r}")

    def process_death_on_store_kernel_wal_change(
        self,
        x: int,
        y: int,
        timeout_ms: int,
        label: str,
    ) -> Dict[str, Any]:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        dest = self.evidence_dir / "process-death" / safe
        dest.mkdir(parents=True, exist_ok=True)
        pid_values = self._shell(f"pidof {self.package_id}", check=False, timeout=10).strip().split()
        if not pid_values or not pid_values[0].isdigit():
            raise RuntimeError("R1B_PROCESS_DEATH_APP_PID_UNAVAILABLE")
        pid = int(pid_values[0])
        loops = max(100, min(3000, timeout_ms // 10))
        remote_script = (
            f"pid={pid}; path=databases/morefun_store_kernel.db-wal; "
            "before=$(stat -c %s \"$path\" 2>/dev/null || echo 0); "
            "echo ARMED pid=$pid before=$before; i=0; "
            f"while [ $i -lt {loops} ] && kill -0 $pid 2>/dev/null; do "
            "now=$(stat -c %s \"$path\" 2>/dev/null || echo 0); "
            "if [ \"$now\" != \"$before\" ]; then "
            "echo WAL_CHANGED before=$before after=$now; kill -9 $pid; echo KILLED_ON_WAL_CHANGE; exit 0; fi; "
            "i=$((i+1)); sleep 0.01; done; echo WAL_CHANGE_NOT_OBSERVED; exit 9"
        )
        command = f"run-as {self.package_id} sh -c '{remote_script}'"
        watcher = subprocess.Popen(
            ["adb", "shell", command],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        time.sleep(0.15)
        self.tap(x, y)
        try:
            stdout, stderr = watcher.communicate(timeout=max(5.0, timeout_ms / 1000.0 + 2.0))
        except subprocess.TimeoutExpired:
            watcher.kill()
            stdout, stderr = watcher.communicate()
            result = {
                "pid": pid,
                "return_code": None,
                "stdout": stdout,
                "stderr": stderr,
                "result": "WATCHER_TIMEOUT",
            }
            (dest / "hook.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            raise RuntimeError("R1B_PROCESS_DEATH_WAL_WATCHER_TIMEOUT")
        result = {
            "pid": pid,
            "return_code": watcher.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "result": "KILLED_ON_WAL_CHANGE" if "KILLED_ON_WAL_CHANGE" in stdout else "WAL_CHANGE_NOT_OBSERVED",
        }
        (dest / "hook.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if result["result"] != "KILLED_ON_WAL_CHANGE" or watcher.returncode != 0:
            raise RuntimeError(
                f"R1B_PROCESS_DEATH_WAL_CHANGE_NOT_OBSERVED: return_code={watcher.returncode}; stdout={stdout.strip()!r}"
            )
        for _ in range(20):
            if str(pid) not in self._shell(f"pidof {self.package_id}", check=False, timeout=10).strip().split():
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("R1B_PROCESS_DEATH_OLD_PROCESS_STILL_PRESENT")
        return result

    def set_network_state(self, state: str, label: str) -> None:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        dest = self.evidence_dir / "network" / safe
        dest.mkdir(parents=True, exist_ok=True)
        offline = state == "OFFLINE"
        commands = [
            f"settings put global airplane_mode_on {'1' if offline else '0'}",
            f"am broadcast -a android.intent.action.AIRPLANE_MODE --ez state {'true' if offline else 'false'}",
            f"svc wifi {'disable' if offline else 'enable'}",
            f"svc data {'disable' if offline else 'enable'}",
        ]
        evidence: List[Dict[str, Any]] = []
        for command in commands:
            result, _ = self._run_for_evidence(["shell", command], timeout=20)
            evidence.append({"command": command, **result})
        expected = "1" if offline else "0"
        observed = ""
        route_probe: Optional[subprocess.CompletedProcess[str]] = None
        for _ in range(40):
            observed = self._shell("settings get global airplane_mode_on", check=False, timeout=10).strip()
            route_probe = self._run(["shell", "ip route get 1.1.1"], check=False, timeout=10)
            route_matches = route_probe.returncode != 0 if offline else route_probe.returncode == 0
            if observed == expected and route_matches:
                break
            time.sleep(0.25)
        connectivity = self._shell("dumpsys connectivity", check=False, timeout=20)
        payload = {
            "requested_state": state,
            "airplane_mode_expected": expected,
            "airplane_mode_observed": observed,
            "route_probe": {
                "command": "ip route get 1.1.1",
                "exit_code": None if route_probe is None else route_probe.returncode,
                "stdout": "" if route_probe is None else route_probe.stdout,
                "stderr": "" if route_probe is None else route_probe.stderr,
            },
            "commands": evidence,
        }
        (dest / "state.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        (dest / "dumpsys-connectivity.txt").write_text(connectivity, encoding="utf-8", errors="replace")
        if observed != expected:
            raise RuntimeError(f"R1B_NETWORK_STATE_MISMATCH: expected airplane_mode_on={expected}, actual={observed!r}")
        if route_probe is None or (offline and route_probe.returncode == 0) or (not offline and route_probe.returncode != 0):
            raise RuntimeError(
                "R1B_NETWORK_STATE_MISMATCH: "
                f"requested={state}; route_exit={None if route_probe is None else route_probe.returncode}; "
                f"route_stdout={'' if route_probe is None else route_probe.stdout.strip()!r}"
            )

    @staticmethod
    def _output_bytes(value: Any) -> bytes:
        if value is None:
            return b""
        if isinstance(value, bytes):
            return value
        return str(value).encode("utf-8", errors="replace")

    @classmethod
    def _is_remote_diagnostic(cls, payload: bytes) -> bool:
        preview = payload[:1024].decode("utf-8", errors="replace").strip().lower()
        return any(marker in preview for marker in cls.REMOTE_DIAGNOSTIC_MARKERS)

    def _capture_app_file(
        self,
        relative_path: str,
        attempt_dir: Path,
        role: str,
        command_timeout_seconds: float,
    ) -> Dict[str, Any]:
        started = time.monotonic()
        try:
            result = subprocess.run(
                ["adb", "exec-out", "run-as", self.package_id, "cat", relative_path],
                check=False,
                capture_output=True,
                timeout=command_timeout_seconds,
            )
            exit_code = result.returncode
            stdout = self._output_bytes(result.stdout)
            stderr = self._output_bytes(result.stderr)
            error = None
        except subprocess.TimeoutExpired as exc:
            exit_code = None
            stdout = self._output_bytes(exc.stdout)
            stderr = self._output_bytes(exc.stderr)
            error = f"TimeoutExpired after {command_timeout_seconds:.3f}s"
        except OSError as exc:
            exit_code = None
            stdout = b""
            stderr = b""
            error = f"{type(exc).__name__}: {exc}"
        elapsed_ms = int((time.monotonic() - started) * 1000)
        stdout_file = f"{role}.stdout.bin"
        stderr_file = f"{role}.stderr.txt"
        (attempt_dir / stdout_file).write_bytes(stdout)
        (attempt_dir / stderr_file).write_bytes(stderr)
        return {
            "relative_path": relative_path,
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "error": error,
            "elapsed_ms": elapsed_ms,
            "stdout_file": stdout_file,
            "stderr_file": stderr_file,
        }

    @staticmethod
    def _capture_metadata(capture: Dict[str, Any], validation: str, available: bool) -> Dict[str, Any]:
        stdout = capture["stdout"]
        stderr = capture["stderr"]
        return {
            "relative_path": capture["relative_path"],
            "exit_code": capture["exit_code"],
            "error": capture["error"],
            "elapsed_ms": capture["elapsed_ms"],
            "stdout_bytes": len(stdout),
            "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
            "stdout_preview": stdout[:512].decode("utf-8", errors="replace"),
            "stdout_file": capture["stdout_file"],
            "stderr_bytes": len(stderr),
            "stderr_preview": stderr[:512].decode("utf-8", errors="replace"),
            "stderr_file": capture["stderr_file"],
            "validation": validation,
            "available": available,
        }

    def _validate_main_database(self, capture: Dict[str, Any]) -> str:
        if capture["exit_code"] != 0:
            return "COMMAND_FAILED"
        payload = capture["stdout"]
        if not payload:
            return "EMPTY_BYTES"
        if payload.startswith(self.SQLITE_HEADER):
            return "SQLITE_HEADER_VALID"
        if self._is_remote_diagnostic(payload):
            return "REMOTE_DIAGNOSTIC_TEXT"
        return "SQLITE_HEADER_INVALID"

    def _validate_sidecar(self, capture: Dict[str, Any], role: str) -> Tuple[str, bool]:
        if capture["exit_code"] != 0:
            return "COMMAND_UNAVAILABLE", False
        payload = capture["stdout"]
        if not payload:
            return "EMPTY_BYTES", False
        if self._is_remote_diagnostic(payload):
            return "REMOTE_DIAGNOSTIC_TEXT", False
        if role == "wal" and (len(payload) < 32 or payload[:4] not in self.SQLITE_WAL_MAGIC):
            return "WAL_HEADER_INVALID", False
        if role == "shm" and len(payload) < 136:
            return "SHM_BYTES_INVALID", False
        return ("WAL_HEADER_VALID" if role == "wal" else "SHM_BYTES_PRESENT"), True

    @staticmethod
    def _read_store_kernel_snapshot(database: Path) -> Dict[str, Any]:
        table_queries = {
            "aggregates": "SELECT * FROM store_kernel_aggregate ORDER BY store_id, aggregate_type, aggregate_id",
            "receipts": "SELECT * FROM store_kernel_command_receipt ORDER BY commit_sequence",
            "inbox": "SELECT * FROM store_kernel_inbox ORDER BY store_id, source, source_event_id",
            "outbox": "SELECT * FROM store_kernel_outbox ORDER BY event_id",
            "journal": "SELECT * FROM store_kernel_diagnostic_journal ORDER BY trace_id, sequence",
        }
        snapshot: Dict[str, Any] = {}
        connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA query_only=ON")
            for table, query in table_queries.items():
                snapshot[table] = [dict(row) for row in connection.execute(query).fetchall()]
        finally:
            connection.close()
        return snapshot

    def capture_store_kernel(self, label: str) -> Dict[str, Any]:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        dest = self.evidence_dir / "store-kernel" / safe
        dest.mkdir(parents=True, exist_ok=True)
        attempts_dir = dest / "capture-attempts"
        attempts_dir.mkdir(parents=True, exist_ok=True)
        timeout_ms = int(self.store_kernel_readback_timeout_seconds * 1000)
        deadline = time.monotonic() + self.store_kernel_readback_timeout_seconds
        attempt = 0
        last_reason = "NO_CAPTURE_ATTEMPT"
        last_capture_ref = ""
        while True:
            attempt += 1
            attempt_dir = attempts_dir / f"{attempt:04d}"
            attempt_dir.mkdir(parents=True, exist_ok=True)
            main = self._capture_app_file(
                "databases/morefun_store_kernel.db",
                attempt_dir,
                "main",
                max(0.001, deadline - time.monotonic()),
            )
            wal = self._capture_app_file(
                "databases/morefun_store_kernel.db-wal",
                attempt_dir,
                "wal",
                max(0.001, deadline - time.monotonic()),
            )
            shm = self._capture_app_file(
                "databases/morefun_store_kernel.db-shm",
                attempt_dir,
                "shm",
                max(0.001, deadline - time.monotonic()),
            )
            main_validation = self._validate_main_database(main)
            wal_validation, wal_available = self._validate_sidecar(wal, "wal")
            shm_validation, shm_available = self._validate_sidecar(shm, "shm")
            ready = False
            snapshot: Dict[str, Any] = {}
            sqlite_error: Optional[str] = None
            if main_validation != "SQLITE_HEADER_VALID":
                last_reason = f"MAIN_{main_validation}"
            elif shm_available and not wal_available:
                last_reason = "ROOM_SHM_WITHOUT_WAL"
            elif wal["exit_code"] == 0 and wal["stdout"] and not wal_available:
                last_reason = wal_validation
            else:
                database = attempt_dir / "morefun_store_kernel.db"
                database.write_bytes(main["stdout"])
                if wal_available:
                    (attempt_dir / "morefun_store_kernel.db-wal").write_bytes(wal["stdout"])
                if shm_available:
                    (attempt_dir / "morefun_store_kernel.db-shm").write_bytes(shm["stdout"])
                try:
                    snapshot = self._read_store_kernel_snapshot(database)
                    ready = True
                    last_reason = "READY"
                except sqlite3.Error as exc:
                    sqlite_error = f"{type(exc).__name__}: {exc}"
                    last_reason = f"SQLITE_READ_FAILED:{exc}"
            capture_metadata = {
                "attempt": attempt,
                "timeout_ms": timeout_ms,
                "main": self._capture_metadata(main, main_validation, main_validation == "SQLITE_HEADER_VALID"),
                "wal": self._capture_metadata(wal, wal_validation, wal_available),
                "shm": self._capture_metadata(shm, shm_validation, shm_available),
                "ready": ready,
                "reason": last_reason,
                "sqlite_error": sqlite_error,
            }
            capture_file = attempt_dir / "capture.json"
            capture_file.write_text(
                json.dumps(capture_metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            last_capture_ref = capture_file.relative_to(self.evidence_dir).as_posix()
            if ready:
                (dest / "morefun_store_kernel.db").write_bytes(main["stdout"])
                if wal_available:
                    (dest / "morefun_store_kernel.db-wal").write_bytes(wal["stdout"])
                if shm_available:
                    (dest / "morefun_store_kernel.db-shm").write_bytes(shm["stdout"])
                (dest / "snapshot.json").write_text(
                    json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                return snapshot
            now = time.monotonic()
            if now >= deadline:
                raise RuntimeError(
                    "R1B_STORE_KERNEL_READBACK_UNAVAILABLE: "
                    f"attempts={attempt}; timeout_ms={timeout_ms}; last_reason={last_reason}; "
                    f"capture_evidence={last_capture_ref}"
                )
            remaining = deadline - now
            if self.store_kernel_readback_poll_seconds > 0:
                time.sleep(min(self.store_kernel_readback_poll_seconds, remaining))

    def force_stop(self) -> None:
        self._shell(f"am force-stop {self.package_id}", check=False, timeout=15)

    def launch(self) -> None:
        self._shell(f"am start -W -n {self.package_id}/{self.main_activity}", timeout=30)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)
