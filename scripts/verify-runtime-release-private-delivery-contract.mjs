import fs from 'node:fs';

const path = '.github/workflows/manual-runtime-release.yml';
const workflow = fs.readFileSync(path, 'utf8');

const staleRuntimeProductionPaths = [
  '.github/workflows/manual-runtime-ota.yml',
  'scripts/verify-runtime-ota-policy.mjs',
  'scripts/verify-runtime-ota-manifest-contract.mjs',
];
for (const stalePath of staleRuntimeProductionPaths) {
  if (fs.existsSync(stalePath)) throw new Error(`RUNTIME_RELEASE_SECOND_PRODUCTION_AUTHORITY_FORBIDDEN:${stalePath}`);
}

const required = [
  'SOURCE_REPO: Pantonyeung/morefunos-v1',
  "MIN_CARRIER_VERSION_CODE: '15'",
  'V1_ARTIFACT_DELIVERY_TOKEN',
  'GH_TOKEN: ${{ secrets.V1_ARTIFACT_DELIVERY_TOKEN }}',
  '--repo "$SOURCE_REPO"',
  '--target "$NORMALIZED_SOURCE_SHA"',
  'run_stage "runtime-g6-static" npm run test:g6',
  'run_stage "runtime-smt-web-tests" npm --prefix apps/smt-web test',
  'run_stage "runtime-package-candidate-stable-bootstrap-ready" node --experimental-strip-types --test apps/smt-web/src/smt-device-gate-bootstrap-consumer.test.ts apps/smt-web/src/runtime-carrier-ready.test.ts',
  'run_stage "runtime-smt-web-build" npm --prefix apps/smt-web run build',
  'jarsigner -verify -strict',
  '-keystore "$KEYSTORE" -storetype PKCS12',
  '-storepass "$V1_ANDROID_KEYSTORE_PASSWORD"',
  '"$RUNTIME_BUNDLE" "$V1_ANDROID_KEY_ALIAS"',
  'Verify signed Runtime Package P0 contract',
  "test -f \"$EXTRACT_DIR/index.html\"",
  "test -f \"$EXTRACT_DIR/META-INF/MANIFEST.MF\"",
  "normalize_manifest_value 'MoreFun-Release-Id'",
  "normalize_manifest_value 'MoreFun-Runtime-Version'",
  "normalize_manifest_value 'MoreFun-Channel'",
  "normalize_manifest_value 'MoreFun-Min-Carrier-Version-Code'",
  "normalize_manifest_value 'MoreFun-Bridge-Version'",
  'RUNTIME_PACKAGE_REMOTE_',
  'RUNTIME_PACKAGE_MISSING_',
  'RUNTIME_PACKAGE_REMOTE_CORE_DEPENDENCY_FORBIDDEN',
  'package_contract=PASS',
  'runtimePackageContract: process.env.PACKAGE_CONTRACT',
  'Verify external OTA manifest matches signed package',
  'RUNTIME_EXTERNAL_MANIFEST_MISMATCH_',
  'external_contract=PASS',
  'runtime-package-contract=PASS',
  'runtime-package-candidate-stable-bootstrap-ready=PASS',
  'runtime-package-internal-external-identity=PASS',
  'Private V1 Runtime delivery: PASS',
];
for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PRIVATE_DELIVERY_REQUIRED:${needle}`);
}

const forbidden = [
  'permissions:\n  contents: write',
  'GH_TOKEN: ${{ github.token }}',
  '--repo "$GITHUB_REPOSITORY"',
  'Signed runtime GitHub Release delivery: PASS',
  "MIN_CARRIER_VERSION_CODE: '13'",
  'npm run test:g6:web',
];
for (const needle of forbidden) {
  if (workflow.includes(needle)) throw new Error(`RUNTIME_RELEASE_PUBLIC_OR_STALE_CONTRACT_FORBIDDEN:${needle}`);
}

if (!/permissions:\s*\n\s*contents:\s*read/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_DEFAULT_CONTENTS_MUST_BE_READ_ONLY');
}
if (/persist-credentials:\s*true/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
}
if (!/jarsigner\s+-verify\s+-strict[\s\S]{0,240}-keystore\s+"\$KEYSTORE"[\s\S]{0,240}"\$RUNTIME_BUNDLE"\s+"\$V1_ANDROID_KEY_ALIAS"/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_LOCKED_SIGNER_STRICT_VERIFY_REQUIRED');
}
if (!/if:\s*steps\.external_contract\.outcome == 'success'[\s\S]{0,2200}gh release create/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_DELIVERY_MUST_REQUIRE_PACKAGE_EXTERNAL_CONTRACT_PASS');
}
if (/actions\/upload-artifact|--repo\s+"\$GITHUB_REPOSITORY"/.test(workflow)) {
  throw new Error('RUNTIME_RELEASE_PUBLIC_ARTIFACT_DELIVERY_FORBIDDEN');
}

console.log('Runtime release single-authority private delivery + package P0 contract: PASS');
