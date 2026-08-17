import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const EXPECTED_SOURCE_REPO = 'Pantonyeung/morefunos-v1';
const EXPECTED_SIGNING_CERT_SHA256 = '8f66270541c419a90ae0e8b94a2c7796e13d5c06805b0919ce3f7f5b3602857a';
const RUNTIME_FILENAME_PATTERN = /^MoreFunOS-SMT-runtime-(stable|candidate|dev)-([0-9a-f]{12})\.mfos$/;

function fail(message) {
  throw new Error(message);
}

function assertEqual(actual, expected, code) {
  if (actual !== expected) fail(`${code}: expected=${expected} actual=${actual}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const releaseDir = path.resolve(process.argv[2] ?? '');
const requestedTag = (process.argv[3] ?? '').trim();
if (!releaseDir || !requestedTag) fail('EXISTING_RUNTIME_RELEASE_ARGS_REQUIRED');
if (!fs.statSync(releaseDir).isDirectory()) fail('EXISTING_RUNTIME_RELEASE_DIR_INVALID');

const manifestPath = path.join(releaseDir, 'runtime-update.json');
const metadataPath = path.join(releaseDir, 'runtime-build-metadata.json');
const sumsPath = path.join(releaseDir, 'RUNTIME_SHA256SUMS');
for (const file of [manifestPath, metadataPath, sumsPath]) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`EXISTING_RUNTIME_RELEASE_FILE_MISSING:${path.basename(file)}`);
}

const manifest = readJson(manifestPath);
const metadata = readJson(metadataPath);
assertEqual(metadata.sourceRepository, EXPECTED_SOURCE_REPO, 'EXISTING_RUNTIME_SOURCE_REPO_MISMATCH');
if (!/^[0-9a-f]{40}$/.test(metadata.sourceSha ?? '')) fail('EXISTING_RUNTIME_SOURCE_SHA_INVALID');
assertEqual(metadata.runtimePackageContract, 'PASS', 'EXISTING_RUNTIME_PACKAGE_CONTRACT_REQUIRED');
assertEqual(metadata.releaseId, manifest.releaseId, 'EXISTING_RUNTIME_RELEASE_ID_MISMATCH');
assertEqual(metadata.runtimeVersion, manifest.runtimeVersion, 'EXISTING_RUNTIME_RUNTIME_VERSION_MISMATCH');
assertEqual(metadata.channel, manifest.channel, 'EXISTING_RUNTIME_CHANNEL_MISMATCH');
assertEqual(metadata.minCarrierVersionCode, manifest.minCarrierVersionCode, 'EXISTING_RUNTIME_MIN_CARRIER_MISMATCH');
assertEqual(metadata.bridgeVersion, manifest.bridgeVersion, 'EXISTING_RUNTIME_BRIDGE_MISMATCH');
assertEqual(metadata.signingCertificateSha256, EXPECTED_SIGNING_CERT_SHA256, 'EXISTING_RUNTIME_SIGNER_METADATA_MISMATCH');
assertEqual(manifest.runtimeVersion, manifest.releaseId, 'EXISTING_RUNTIME_VERSION_RELEASE_ID_REQUIRED');
assertEqual(manifest.minCarrierVersionCode, 21, 'EXISTING_RUNTIME_MIN_CARRIER_21_REQUIRED');
if (!['stable', 'candidate', 'dev'].includes(manifest.channel)) fail('EXISTING_RUNTIME_CHANNEL_INVALID');

const filename = metadata.runtimeFilename;
if (manifest.bundleUrl !== filename) fail('EXISTING_RUNTIME_BUNDLE_URL_MISMATCH');
const filenameMatch = RUNTIME_FILENAME_PATTERN.exec(filename ?? '');
if (!filenameMatch) fail('EXISTING_RUNTIME_FILENAME_INVALID');
assertEqual(filenameMatch[1], manifest.channel, 'EXISTING_RUNTIME_FILENAME_CHANNEL_MISMATCH');
assertEqual(filenameMatch[2], metadata.sourceSha.slice(0, 12), 'EXISTING_RUNTIME_FILENAME_SOURCE_MISMATCH');

const bundlePath = path.join(releaseDir, filename);
if (!fs.existsSync(bundlePath) || !fs.statSync(bundlePath).isFile()) fail('EXISTING_RUNTIME_BUNDLE_MISSING');
const actualSha = sha256(bundlePath);
const actualBytes = fs.statSync(bundlePath).size;
assertEqual(actualSha, manifest.archiveSha256, 'EXISTING_RUNTIME_BUNDLE_HASH_MANIFEST_MISMATCH');
assertEqual(actualSha, metadata.archiveSha256, 'EXISTING_RUNTIME_BUNDLE_HASH_METADATA_MISMATCH');
assertEqual(actualBytes, metadata.runtimeBytes, 'EXISTING_RUNTIME_BUNDLE_BYTES_MISMATCH');

const sums = fs.readFileSync(sumsPath, 'utf8').trim();
assertEqual(sums, `${actualSha}  ${filename}`, 'EXISTING_RUNTIME_SHA256SUMS_MISMATCH');

if (!/^\d+$/.test(String(metadata.builderRunId ?? ''))) fail('EXISTING_RUNTIME_BUILDER_RUN_ID_INVALID');
const expectedTag = `builder-v1-${manifest.releaseId}-run-${metadata.builderRunId}`;
assertEqual(requestedTag, expectedTag, 'EXISTING_RUNTIME_RELEASE_TAG_MISMATCH');

const outputFile = process.env.GITHUB_OUTPUT;
if (!outputFile) fail('GITHUB_OUTPUT_REQUIRED');
const outputs = {
  runtime_bundle: bundlePath,
  runtime_manifest: manifestPath,
  runtime_metadata: metadataPath,
  runtime_filename: filename,
  runtime_sha256: actualSha,
  runtime_bytes: String(actualBytes),
  release_id: manifest.releaseId,
  runtime_version: manifest.runtimeVersion,
  release_channel: manifest.channel,
  source_sha: metadata.sourceSha,
  signing_certificate_sha256: metadata.signingCertificateSha256,
};
fs.appendFileSync(outputFile, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));

console.log(`existing-runtime-release-id=${manifest.releaseId}`);
console.log(`existing-runtime-source-sha=${metadata.sourceSha}`);
console.log(`existing-runtime-sha256=${actualSha}`);
console.log(`existing-runtime-bytes=${actualBytes}`);
console.log('existing-runtime-release-metadata=PASS');
