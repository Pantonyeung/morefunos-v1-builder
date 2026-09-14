from __future__ import annotations

import pathlib
import tempfile
import unittest

from scripts.verify_customer_sw_artifact import verify_customer_sw_artifact


VALID_SW = """self.addEventListener('push', () => {});\nself.addEventListener('notificationclick', () => {});\n"""


class CustomerServiceWorkerArtifactTest(unittest.TestCase):
    def test_drift_fails_and_records_distinct_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "public-service-worker.js"
            artifact = root / "dist-service-worker.js"
            source.write_text(VALID_SW, encoding="utf-8")
            artifact.write_text("self.addEventListener('push', () => {});\n", encoding="utf-8")
            result = verify_customer_sw_artifact(source, artifact)
        self.assertFalse(result["passed"])
        self.assertEqual(result["first_failed_station"], "CUSTOMER_SW_NOTIFICATIONCLICK_HANDLER")
        self.assertNotEqual(result["source_sw_sha256"], result["dist_sw_sha256"])

    def test_correct_build_passes_and_hashes_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "public-service-worker.js"
            artifact = root / "dist-service-worker.js"
            source.write_text(VALID_SW, encoding="utf-8")
            artifact.write_text(VALID_SW, encoding="utf-8")
            result = verify_customer_sw_artifact(source, artifact)
        self.assertTrue(result["passed"])
        self.assertEqual(result["first_failed_station"], "NONE")
        self.assertEqual(result["source_sw_sha256"], result["dist_sw_sha256"])

    def test_workflow_proves_built_artifact_before_wrangler_and_seals_upload_identity(self) -> None:
        workflow = (pathlib.Path(__file__).resolve().parents[1] / ".github/workflows/verify-v2-customer-production-integration.yml").read_text(encoding="utf-8")
        build = workflow.index("name: Customer web production build")
        proof = workflow.index("name: Customer production Service Worker artifact proof")
        wrangler = workflow.index("name: Customer Worker Wrangler dry-run")
        self.assertLess(build, proof)
        self.assertLess(proof, wrangler)
        self.assertIn("steps.customer_evidence.outputs.artifact-id", workflow)
        self.assertIn("steps.customer_evidence.outputs.artifact-digest", workflow)


if __name__ == "__main__":
    unittest.main()
