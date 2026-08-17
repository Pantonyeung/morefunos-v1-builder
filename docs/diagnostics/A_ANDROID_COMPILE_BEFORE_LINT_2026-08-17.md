# A Android Compile-Before-Lint Diagnostic

Status: ACTIVE EXECUTION DIAGNOSTIC
Date: 2026-08-17 HKT

Purpose: distinguish Java/Android compilation failure from Android Lint-only failure while preserving the public/private log boundary.

Builder verification now runs `:app:compileDebugJavaWithJavac` immediately before `:app:lintDebug` for A-line exact-SHA verification.

Rules:
- source remains read-only;
- no private source/raw build output is published;
- compile stage exposes only PASS/FAIL;
- this diagnostic does not alter V1 product/runtime/native authority;
- it is not Device/Hardware/Operational evidence.

Current target source SHA: `490e84a7728412bacba97d3da56b0576c57618bc`.
