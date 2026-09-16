import unittest
from pathlib import Path


WORKFLOW = Path(__file__).parents[1] / ".github/workflows/verify-v2-smt-ui-integration.yml"


class V2SmtUiRequestLineageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_manual_dispatch_requires_explicit_request_identity(self) -> None:
        self.assertIn(
            "request_id:\n"
            "        description: Request or attempt identity for evidence lineage\n"
            "        required: true\n"
            "        type: string",
            self.workflow,
        )
        self.assertIn("INPUT_REQUEST_ID: ${{ inputs.request_id }}", self.workflow)

    def test_resolver_uses_manual_identity_but_preserves_request_file_path(self) -> None:
        self.assertIn(
            'REQUEST_ID="$(printf \'%s\' "$INPUT_REQUEST_ID" | tr -d \'\\r\\n\')"',
            self.workflow,
        )
        self.assertIn(
            'REQUEST_ID="$(sed -n \'s/^request_id=//p\' requests/v2-smt-ui-integration-request.txt | tr -d \'\\r\\n\')"',
            self.workflow,
        )
        self.assertIn(
            'if [[ -z "$REQUEST_ID" ]]; then REQUEST_ID="$(sed -n \'s/^attempt=//p\' requests/v2-smt-ui-integration-request.txt | tr -d \'\\r\\n\')"; fi',
            self.workflow,
        )
        self.assertIn('[[ -n "$REQUEST_ID" ]]', self.workflow)
        self.assertIn('echo "request_id=$REQUEST_ID" >> "$GITHUB_OUTPUT"', self.workflow)

    def test_durable_seal_consumes_resolved_identity_only(self) -> None:
        seal = self.workflow.split("- name: Seal durable Builder result", 1)[1]
        self.assertIn("REQUEST_ID: ${{ steps.request.outputs.request_id }}", seal)
        self.assertNotIn("sed -n 's/^request_id=//p' requests/v2-smt-ui-integration-request.txt", seal)
        self.assertNotIn("sed -n 's/^attempt=//p' requests/v2-smt-ui-integration-request.txt", seal)
        self.assertIn('echo "request_id=${REQUEST_ID:-UNKNOWN}"', seal)


if __name__ == "__main__":
    unittest.main()
