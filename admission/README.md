# MoreFunOS Admission Control Plane

This directory is the live operational control plane for parallel Morefun-v2 work.

Rules:
- one work item = one candidate manifest;
- teams must not edit a shared queue file;
- candidate manifests are immutable after CANDIDATE_READY;
- changing the same work item means create a new candidate SHA/revision, not silently rewrite proof identity;
- live queue state belongs here, not in Morefun-v2 main;
- Morefun-v2 native Actions/CI/Workflow remain forbidden.

Candidate manifest path:
admission/candidates/<team>/<workId>.env

Required fields:
candidate_sha=<40 hex>
base_main_sha=<40 hex>
work_id=<id>
affected_ports=SMT,SMM,ADMIN,OWNER,CUSTOMER,CORE

Lease path:
admission/leases/<team>/<workId>.env

Queue result:
.ci-results/admission-queue/<workId>.txt

State:
LEASE_ACTIVE -> CANDIDATE_READY -> QUEUED -> INTEGRATION_PROVING -> READY_TO_ADMIT -> ADMITTED -> RELEASED

QUEUE success means READY_TO_ADMIT only.
