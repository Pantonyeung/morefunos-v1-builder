import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/mfk-runtime-ota.yml',import.meta.url),'utf8');
const sourceVerify=readFileSync(new URL('../.github/workflows/mfp-v3-runtime-ota-source-verify.yml',import.meta.url),'utf8');
const request=readFileSync(new URL('../requests/mfk-runtime-ota-request.txt',import.meta.url),'utf8');

const required=[
  'RUNTIME_TARGET: MFP_V3','RUNTIME_SOURCE_DIR: source/v3smt','git -C source rev-parse HEAD',
  'source/v3smt/dist','npm run test','npm run typecheck','npm run build','dist/build-identity.json',
  'jarsigner -verify -strict','EXPECTED_CERT_SHA256','archiveSha256','runtime-update.json',
  'runtimeTarget','sourceSha','MFP_V3','Public readback','MFK_RUNTIME_OTA_PUBLISHED',
  'runtime-${CHANNEL}-mfk-${SHORT_SHA}','minCarrierVersionCode','bridgeVersion',
];
for(const value of required)if(!workflow.includes(value))throw new Error(`MFP_V3_OTA_GUARD_MISSING:${value}`);
for(const value of ['source/v2local','workflow_dispatch','pull_request:','runtime.update.activate','runtime.rollback']){
  if(workflow.includes(value))throw new Error(`MFP_V3_OTA_FORBIDDEN:${value}`);
}
if(!workflow.includes("branches: [main]")||!workflow.includes("'requests/mfk-runtime-ota-request.txt'"))throw new Error('MFP_V3_OTA_PUBLISH_TRIGGER_INVALID');
if(!/^source_sha=[0-9a-f]{40}\nchannel=(candidate|stable)\nrequest_id=\S+\n?$/m.test(request.replace(/\r/g,'')))throw new Error('MFP_V3_OTA_REQUEST_FORMAT_INVALID');
for(const value of ['MFP_SOURCE_SHA: 69adb11215677d506545c5428f8deea4b89e7db2','source/v3smt','npm test','npm run typecheck','npm run build','Confirm source verification cannot publish']){
  if(!sourceVerify.includes(value))throw new Error(`MFP_V3_SOURCE_VERIFY_GUARD_MISSING:${value}`);
}
for(const value of ['wrangler r2 object put','runtime.update.activate','runtime.rollback']){
  if(sourceVerify.includes(value))throw new Error(`MFP_V3_SOURCE_VERIFY_PUBLISH_CAPABILITY:${value}`);
}
console.log('MFP_V3_RUNTIME_OTA_SOURCE_VERIFIED');
