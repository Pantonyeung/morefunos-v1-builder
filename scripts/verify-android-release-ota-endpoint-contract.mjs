import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/manual-android-release.yml', 'utf8');

const required = [
  'runtime_update_manifest_url:',
  "RUNTIME_UPDATE_MANIFEST_URL: ${{ inputs.runtime_update_manifest_url }}",
  'RUNTIME_UPDATE_ENDPOINT_INVALID',
  '-PmorefunRuntimeUpdateManifestUrl="$RUNTIME_UPDATE_MANIFEST_URL"',
  'runtimeUpdateManifestUrl: process.env.RUNTIME_UPDATE_MANIFEST_URL',
];

for (const needle of required) {
  if (!workflow.includes(needle)) {
    throw new Error(`ANDROID_RELEASE_OTA_ENDPOINT_REQUIRED:${needle}`);
  }
}

if (!/runtime_update_manifest_url:[\s\S]{0,240}required:\s*true/.test(workflow)) {
  throw new Error('ANDROID_RELEASE_OTA_ENDPOINT_INPUT_MUST_BE_REQUIRED');
}

const propertyUses = workflow.match(/-PmorefunRuntimeUpdateManifestUrl="\$RUNTIME_UPDATE_MANIFEST_URL"/g) ?? [];
if (propertyUses.length < 2) {
  throw new Error('ANDROID_RELEASE_OTA_ENDPOINT_MUST_APPLY_TO_LINT_AND_ASSEMBLE');
}

console.log('Android release OTA endpoint contract: PASS');
