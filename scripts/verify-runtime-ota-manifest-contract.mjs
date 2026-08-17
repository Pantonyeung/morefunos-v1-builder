import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/manual-runtime-ota.yml', 'utf8');

const required = [
  'node scripts/verify-runtime-ota-manifest-contract.mjs',
  'runtime-update.json',
  'bundleUrl: process.env.BUNDLE',
  'archiveSha256: process.env.BUNDLE_SHA256',
  'releaseId: process.env.RELEASE_ID',
  'runtimeVersion: process.env.RUNTIME_VERSION',
  'channel: process.env.CHANNEL',
  'minCarrierVersionCode: Number(process.env.MIN_CARRIER)',
  'bridgeVersion: Number(process.env.BRIDGE_VERSION)',
];

for (const needle of required) {
  if (!workflow.includes(needle)) throw new Error(`BUILDER_RUNTIME_OTA_MANIFEST_REQUIRED:${needle}`);
}

if (/bundleUrl:\s*['"]https?:\/\//.test(workflow)) {
  throw new Error('BUILDER_RUNTIME_OTA_PROVIDER_URL_MUST_NOT_BE_HARDCODED');
}

console.log('Builder Runtime OTA manifest contract: PASS');
