import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "ring1b_webview_exception_guard.py"
SPEC = importlib.util.spec_from_file_location("ring1b_webview_exception_guard", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

FIX = ROOT / "tests" / "fixtures"
OLD_CRASH_RE = re.compile(r"FATAL EXCEPTION|ANR in com\.morefunos\.smt|Process: com\.morefunos\.smt.*has died")


class Ring1BWebViewExceptionGuardTests(unittest.TestCase):
    def read(self, name: str) -> str:
        return (FIX / name).read_text(encoding="utf-8")

    def test_old_syntax_error_fixture_was_false_green_but_is_now_red(self):
        log = self.read("logcat-webview-syntax-error.txt")
        self.assertIsNone(OLD_CRASH_RE.search(log), "fixture must prove old crash-only smoke would not fail")
        match = MODULE.detect_app_webview_uncaught(log)
        self.assertIsNotNone(match)
        self.assertEqual(match["code"], MODULE.R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION)
        self.assertIn("Unexpected token '='", match["exception"])
        self.assertIn("appassets.androidplatform.net/assets/", match["source"])

    def test_intl_supported_values_of_fixture_is_red(self):
        log = self.read("logcat-webview-intl-typeerror.txt")
        self.assertIsNone(OLD_CRASH_RE.search(log), "fixture must prove old crash-only smoke would not fail")
        match = MODULE.detect_app_webview_uncaught(log)
        self.assertIsNotNone(match)
        self.assertEqual(match["code"], MODULE.R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION)
        self.assertIn("Intl.supportedValuesOf is not a function", match["exception"])

    def test_clean_app_log_and_external_origin_uncaught_remain_green(self):
        self.assertIsNone(MODULE.detect_app_webview_uncaught(self.read("logcat-webview-clean.txt")))

    def test_cli_emits_stable_code_and_json_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "guard.json"
            rc = MODULE.main([
                str(FIX / "logcat-webview-intl-typeerror.txt"),
                "--label",
                "launch-2",
                "--output-json",
                str(output),
            ])
            self.assertEqual(rc, 1)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["code"], "R1B_APP_WEBVIEW_UNCAUGHT_EXCEPTION")
            self.assertEqual(payload["label"], "launch-2")
            self.assertEqual(payload["result"], "RED")


if __name__ == "__main__":
    unittest.main()
