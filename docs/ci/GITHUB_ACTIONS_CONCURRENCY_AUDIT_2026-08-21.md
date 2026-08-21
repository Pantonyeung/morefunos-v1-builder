# GitHub Actions Concurrency Audit — 2026-08-21

Status: ACTIVE REPAIR RECORD

## Finding

GitHub Actions concurrency groups are repository-wide mutual-exclusion keys. By default, a group allows at most one running and one pending run/job; a newer pending member replaces the older pending member. This is inappropriate for read-only verification workflows that do not mutate shared resources.

## Correct boundary

- Read-only verification workflows: no concurrency lock.
- Runtime OTA publication: serialize by publication channel because each channel owns one mutable public manifest.
- Candidate/dev publication: newer release may cancel an older in-progress release for the same channel. Publication is package-first and manifest-last, so cancellation before manifest publication cannot expose a half-updated public manifest.
- Stable publication: never auto-cancel an in-progress stable release.

## Repaired workflows

- verify-smt-p01-d103.yml — remove concurrency.
- verify-v1.yml — remove concurrency.
- verify-carrier.yml — remove concurrency.
- runtime-release-v2.yml — group by release channel; cancel in progress for non-stable channels only.

## Authority

This is Builder execution-plane behavior only. Product, Runtime, OTA, UI, and Business Authority remain in MoreFunOS V1.
