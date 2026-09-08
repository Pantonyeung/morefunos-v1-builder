import fs from 'node:fs';

const workflowPath = '.github/workflows/v2-android-release.yml';
if (!fs.existsSync(workflowPath)) throw new Error('V2_ANDROID_RELEASE_WORKFLOW_MISSING');
const text = fs.readFileSync(workflowPath, 'utf8');

const requireAll = (needles) => {
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error('V2_ANDROID_RELEASE_REQUIRED:' + needle);
  }
};

requireAll([
  'name: V2 Android Signed Release',
  "repository: Pantonyeung/Morefun-v2",
  'V2_SOURCE_READ_TOKEN',
  'V1_ANDROID_KEYSTORE_B64',
  'V1_ANDROID_KEYSTORE_PASSWORD',
  'V1_ANDROID_KEY_ALIAS',
  'V1_ANDROID_KEY_PASSWORD',
  'EXPECTED_APP_SIGNING_CERT_SHA256',
  ':app:testDebugUnitTest',
  ':app:compileReleaseJavaWithJavac',
  ':app:lintRelease',
  ':app:assembleRelease',
  'zipalign -v -p 4',
  'apksigner sign',
  'apksigner verify --verbose --print-certs',
  'certificate SHA-256 digest',
  'release_kind=SIGNED_RELEASE_APK',
  'actions/upload-artifact@v4',
]);

if (/contents:\s*write/.test(text)) throw new Error('V2_ANDROID_RELEASE_CONTENTS_WRITE_FORBIDDEN');
if (/persist-credentials:\s*true/.test(text)) throw new Error('V2_ANDROID_RELEASE_PERSIST_CREDENTIALS_FORBIDDEN');
if (/:app:assembleDebug/.test(text)) throw new Error('V2_ANDROID_RELEASE_DEBUG_ASSEMBLE_FORBIDDEN');
if (/app-debug\.apk/.test(text)) throw new Error('V2_ANDROID_RELEASE_DEBUG_APK_FORBIDDEN');
if (/source_repo=Pantonyeung\/morefunos-v1\b/.test(text)) throw new Error('V2_ANDROID_RELEASE_V1_SOURCE_FORBIDDEN');

console.log('V2 Android signed release contract: PASS');
