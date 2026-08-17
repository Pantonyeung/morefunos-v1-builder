import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const OTA_BUCKET = 'morefunos-v1-ota';
const OTA_PUBLIC_ORIGIN = 'https://morefunos-v1-ota.pantonyeung.workers.dev';
const PUBLIC_MANIFEST_PATH = 'runtime-update.json';
const PUBLISHED_MANIFEST_KEY = 'runtime-update-published.json';
const EXPECTED_WRANGLER_VERSION = '4.118.0';
const EXPECTED_SIGNING_CERT_SHA256 = '8f66270541c419a90ae0e8b94a2c7796e13d5c06805b0919ce3f7f5b3602857a';
const RUNTIME_FILENAME_PATTERN = /^MoreFunOS-SMT-runtime-(stable|candidate|dev)-[0-9a-f]{12}\.mfos$/;

function fail(message) {
  throw new Error(message);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`ONLINE_OTA_CONFIGURATION_MISSING_${name}`);
  return value;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) fail(`${code}: expected=${expected} actual=${actual}`);
}

function runWrangler(args, options = {}) {
  execFileSync('wrangler', args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) fail(`ONLINE_OTA_HTTP_${response.status}:${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}

async function fetchManifest() {
  const { response, bytes } = await fetchBytes(`${OTA_PUBLIC_ORIGIN}/${PUBLIC_MANIFEST_PATH}`);
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('ONLINE_OTA_PUBLIC_MANIFEST_INVALID_JSON');
  }
  return { response, bytes, json };
}

function assertManifestIdentity(actual, expected) {
  for (const key of [
    'releaseId',
    'runtimeVersion',
    'channel',
    'minCarrierVersionCode',
    'bridgeVersion',
    'bundleUrl',
    'archiveSha256',
  ]) {
    assertEqual(actual[key], expected[key], `ONLINE_OTA_MANIFEST_MISMATCH_${key}`);
  }
}

const bundlePath = path.resolve(requiredEnv('RUNTIME_BUNDLE'));
const manifestPath = path.resolve(requiredEnv('RUNTIME_MANIFEST'));
const metadataPath = path.resolve(requiredEnv('RUNTIME_METADATA'));
const otaWorkerDir = path.resolve(requiredEnv('OTA_WORKER_DIR'));
requiredEnv('CLOUDFLARE_API_TOKEN');
requiredEnv('CLOUDFLARE_ACCOUNT_ID');

for (const file of [bundlePath, manifestPath, metadataPath]) {
  if (!fs.statSync(file).isFile()) fail(`ONLINE_OTA_REQUIRED_FILE_INVALID:${file}`);
}
if (!fs.statSync(otaWorkerDir).isDirectory()) fail('ONLINE_OTA_WORKER_DIR_INVALID');

const workerSource = fs.readFileSync(path.join(otaWorkerDir, 'src/index.js'), 'utf8');
if (!workerSource.includes(`PUBLISHED_MANIFEST_KEY = "${PUBLISHED_MANIFEST_KEY}"`)) {
  fail('ONLINE_OTA_CANONICAL_WORKER_PUBLISHED_MANIFEST_KEY_REQUIRED');
}
if (!workerSource.includes('X-MoreFunOS-Manifest-Source')) {
  fail('ONLINE_OTA_CANONICAL_WORKER_SOURCE_HEADER_REQUIRED');
}

const manifest = readJson(manifestPath);
const metadata = readJson(metadataPath);
const runtimeFilename = path.basename(bundlePath);
if (!RUNTIME_FILENAME_PATTERN.test(runtimeFilename)) fail('ONLINE_OTA_RUNTIME_FILENAME_INVALID');
assertEqual(manifest.bundleUrl, runtimeFilename, 'ONLINE_OTA_FILENAME_MANIFEST_MISMATCH');
assertEqual(metadata.runtimeFilename, runtimeFilename, 'ONLINE_OTA_FILENAME_METADATA_MISMATCH');
assertEqual(metadata.releaseId, manifest.releaseId, 'ONLINE_OTA_RELEASE_ID_METADATA_MISMATCH');
assertEqual(metadata.runtimeVersion, manifest.runtimeVersion, 'ONLINE_OTA_RUNTIME_VERSION_METADATA_MISMATCH');
assertEqual(metadata.channel, manifest.channel, 'ONLINE_OTA_CHANNEL_METADATA_MISMATCH');
assertEqual(metadata.minCarrierVersionCode, manifest.minCarrierVersionCode, 'ONLINE_OTA_MIN_CARRIER_METADATA_MISMATCH');
assertEqual(metadata.bridgeVersion, manifest.bridgeVersion, 'ONLINE_OTA_BRIDGE_METADATA_MISMATCH');
assertEqual(metadata.signingCertificateSha256, EXPECTED_SIGNING_CERT_SHA256, 'ONLINE_OTA_SIGNER_METADATA_MISMATCH');
assertEqual(metadata.runtimePackageContract, 'PASS', 'ONLINE_OTA_PACKAGE_CONTRACT_REQUIRED');
assertEqual(manifest.runtimeVersion, manifest.releaseId, 'ONLINE_OTA_RUNTIME_VERSION_RELEASE_ID_REQUIRED');
if (manifest.minCarrierVersionCode !== 21) fail('ONLINE_OTA_MIN_CARRIER_21_REQUIRED');

const bundleBytes = fs.readFileSync(bundlePath);
const localBundleSha = sha256(bundleBytes);
assertEqual(localBundleSha, manifest.archiveSha256, 'ONLINE_OTA_LOCAL_BUNDLE_HASH_MISMATCH');
assertEqual(metadata.runtimeBytes, bundleBytes.byteLength, 'ONLINE_OTA_LOCAL_BUNDLE_BYTES_MISMATCH');

const wranglerVersion = execFileSync('wrangler', ['--version'], { encoding: 'utf8', env: process.env }).trim();
if (!wranglerVersion.includes(EXPECTED_WRANGLER_VERSION)) {
  fail(`ONLINE_OTA_WRANGLER_VERSION_MISMATCH:${wranglerVersion}`);
}

console.log(`online-ota-release-id=${manifest.releaseId}`);
console.log(`online-ota-runtime-filename=${runtimeFilename}`);
console.log(`online-ota-runtime-sha256=${localBundleSha}`);
console.log(`online-ota-runtime-bytes=${bundleBytes.byteLength}`);

// P1: package first. Never mutate the manifest before this package is publicly proven.
runWrangler([
  'r2', 'object', 'put', `${OTA_BUCKET}/${runtimeFilename}`,
  `--file=${bundlePath}`,
  '--remote',
  '--content-type=application/octet-stream',
]);

const packagePublic = await fetchBytes(`${OTA_PUBLIC_ORIGIN}/${encodeURIComponent(runtimeFilename)}`);
assertEqual(packagePublic.bytes.byteLength, bundleBytes.byteLength, 'ONLINE_OTA_PUBLIC_BUNDLE_BYTES_MISMATCH');
assertEqual(sha256(packagePublic.bytes), localBundleSha, 'ONLINE_OTA_PUBLIC_BUNDLE_HASH_MISMATCH');
console.log('online-ota-package-public-get=PASS');

// Migration/self-heal: deploy the canonical read-only Worker only if the live origin
// does not yet expose the R2/source-fallback marker. This runs after package proof and
// before the new publication-switch object is written.
let liveManifest = await fetchManifest();
let manifestSource = liveManifest.response.headers.get('x-morefunos-manifest-source');
if (manifestSource !== 'r2' && manifestSource !== 'source-fallback') {
  console.log('online-ota-worker-migration=REQUIRED');
  runWrangler(['deploy', '--config', 'wrangler.jsonc'], { cwd: otaWorkerDir });
  liveManifest = await fetchManifest();
  manifestSource = liveManifest.response.headers.get('x-morefunos-manifest-source');
  if (manifestSource !== 'r2' && manifestSource !== 'source-fallback') {
    fail('ONLINE_OTA_WORKER_MIGRATION_NOT_OBSERVED');
  }
  console.log('online-ota-worker-migration=PASS');
} else {
  console.log('online-ota-worker-migration=NOT_REQUIRED');
}

// P2: manifest last. Internal R2 key is intentionally isolated from historical
// dashboard-created runtime-update.json objects; public path remains unchanged.
runWrangler([
  'r2', 'object', 'put', `${OTA_BUCKET}/${PUBLISHED_MANIFEST_KEY}`,
  `--file=${manifestPath}`,
  '--remote',
  '--content-type=application/json',
]);

const finalManifest = await fetchManifest();
assertEqual(finalManifest.response.headers.get('x-morefunos-manifest-source'), 'r2', 'ONLINE_OTA_PUBLIC_MANIFEST_SOURCE_MISMATCH');
assertManifestIdentity(finalManifest.json, manifest);
assertEqual(finalManifest.bytes.toString('utf8'), fs.readFileSync(manifestPath, 'utf8'), 'ONLINE_OTA_PUBLIC_MANIFEST_BYTES_MISMATCH');
console.log('online-ota-manifest-public-get=PASS');
console.log('online-ota-publication=PASS');
