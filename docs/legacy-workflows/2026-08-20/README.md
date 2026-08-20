# Archived legacy issue-comment workflows — 2026-08-20

These workflow definitions were moved out of `.github/workflows` during Builder infrastructure hardening.

They are retained for audit/history only and MUST NOT execute automatically.

Formal Owner command routing is consolidated in `.github/workflows/owner-control-v2.yml`.

Legacy A/B/C reusable verification workflows may remain live when they are called by the V2 router; the archived files here are specifically retired direct listeners and superseded control/release/status workflows.

Rollback is available through Git history or by deliberately restoring a file into `.github/workflows` after review.
