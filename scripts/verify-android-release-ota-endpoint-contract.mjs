import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/android-release-v2.yml', 'utf8');

const required = [
  'source_sha:',
  'uses: ./.github/workflows/verify-v1.yml',
  'uses: ./.github/workflows/verify-carrier.yml',
  'needs: [verify-v1, verify-carrier]',
  'npm --prefix source/apps/smt-web run build',
  'gradle -p source/apps/smt-android :app:lintDebug --no-daemon',
  'gradle -p source/apps/smt-android :app:assembleDebug --no-daemon',
];

for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`ANDROID_RELEASE_CURRENT_REQUIRED:${needle}`);
}

const forbidden = [
  'runtime_update_manifest_url:',
  'RUNTIME_UPDATE_MANIFEST_URL: ${{ inputs.runtime_update_manifest_url }}',
  '-PmorefunRuntimeUpdateManifestUrl=',
  'verify-ui-mother.yml',
  'test:g6',
  'typecheck:g6',
];

for (const needle of forbidden) {
  if (workflow.includes(needle)) throw new Error(`ANDROID_RELEASE_LEGACY_OR_BUILD_URL_FORBIDDEN:${needle}`);
}

console.log('Android release current endpoint and verification contract: PASS');
