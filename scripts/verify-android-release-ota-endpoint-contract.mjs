import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/manual-android-release.yml', 'utf8');

const required = [
  'source_sha:',
  'runtimeUpdateEndpointMode: "built-in-default-plus-persistent-owner-override"',
  'gradle -p apps/smt-android :app:lintDebug --no-daemon',
  'gradle -p apps/smt-android :app:assembleDebug --no-daemon',
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    throw new Error(`ANDROID_RELEASE_D089_REQUIRED:${needle}`);
  }
}

const forbidden = [
  'runtime_update_manifest_url:',
  'RUNTIME_UPDATE_MANIFEST_URL: ${{ inputs.runtime_update_manifest_url }}',
  '-PmorefunRuntimeUpdateManifestUrl=',
];

for (const needle of forbidden) {
  if (workflow.includes(needle)) {
    throw new Error(`ANDROID_RELEASE_D089_BUILD_URL_INPUT_FORBIDDEN:${needle}`);
  }
}

console.log('Android release D-089 endpoint contract: PASS');
