#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PACKAGE_ID = 'com.morefunos.smt';
const MAIN_ACTIVITY = '.MainActivity';
const TARGET_ORIGIN = 'https://appassets.androidplatform.net';
const TARGET_PATHS = new Set(['/baseline/index.html', '/runtime/index.html']);
const CHECKOUT_KEY = 'morefunos.smt.checkout-context.v1';
const OFFLINE_DB = 'morefunos.frontline.staff-order-intent.v1';
const OFFLINE_STORE = 'staff-order-intents';
const TRANSACTION_TIMEOUT_MS = 5000;
const CONTRACT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ring1b_upgrade_contract.py');
const OPERATIONS = new Set(['READ_LOCAL_STORAGE', 'READ_INDEXEDDB', 'WRITE_LOCAL_STORAGE', 'PUT_INDEXEDDB']);
const TERMINAL_CASES = new Set(['COMMITTING', 'SETTLED']);
const execution = {
  args: null,
  operation: 'POLICY_VALIDATION',
  storageMutationAttempted: false,
  sideEffectCertainty: 'PROVEN_NONE',
  digests: {},
};

function fail(code) {
  throw new Error(code);
}

function parseArgs(argv) {
  const args = {operations: [], timeoutMs: 20000};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--operation' && value) args.operations.push(value);
    else if (key === '--phase' && value) args.phase = value;
    else if (key === '--fixture-case' && value) args.fixtureCase = value;
    else if (key === '--legacy-source' && value) args.legacySource = value;
    else if (key === '--output' && value) args.output = value;
    else if (key === '--timeout-ms' && value) args.timeoutMs = Number(value);
    else fail(key === '--script' || key === '--expression' || key === '--function'
      ? 'R1B_WEBVIEW_STORAGE_UNTYPED_SCRIPT_FORBIDDEN'
      : 'R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
    index += 1;
  }
  if (
    !args.output
    || !['pre', 'post'].includes(args.phase)
    || !['PENDING', 'COMMITTING', 'SETTLED'].includes(args.fixtureCase)
    || !Number.isSafeInteger(args.timeoutMs)
    || args.timeoutMs < 1
  ) {
    fail('R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
  }
  if (args.operations.some((operation) => !OPERATIONS.has(operation))) {
    fail('R1B_WEBVIEW_STORAGE_UNTYPED_SCRIPT_FORBIDDEN');
  }
  const reads = ['READ_LOCAL_STORAGE', 'READ_INDEXEDDB'];
  const expected = args.phase === 'pre' && TERMINAL_CASES.has(args.fixtureCase)
    ? [...reads, 'PUT_INDEXEDDB', 'WRITE_LOCAL_STORAGE']
    : reads;
  if (JSON.stringify(args.operations) !== JSON.stringify(expected)) {
    fail('R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
  }
  if (args.phase === 'pre' && !args.legacySource) {
    fail('R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
  }
  return args;
}

function adb(argumentsList, failureCode, allowFailure = false) {
  const result = spawnSync('adb', argumentsList, {encoding: 'utf8'});
  if (!allowFailure && (result.error || result.status !== 0)) fail(failureCode);
  return result;
}

function establishForward() {
  const pidResult = adb(['shell', 'pidof', PACKAGE_ID], 'R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND');
  const pids = pidResult.stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) fail('R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND');
  if (pids.length !== 1) fail('R1B_WEBVIEW_DEBUG_TARGET_AMBIGUOUS');
  const task = adb(['shell', 'dumpsys', 'activity', 'activities'], 'R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND').stdout;
  if (!task.includes(PACKAGE_ID) || !task.includes(MAIN_ACTIVITY)) fail('R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND');
  const forward = adb(
    ['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pids[0]}`],
    'R1B_WEBVIEW_CDP_ATTACH_FAILED',
  );
  const port = Number(forward.stdout.trim());
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('R1B_WEBVIEW_CDP_ATTACH_FAILED');
  return port;
}

function removeForward(port) {
  if (Number.isSafeInteger(port)) {
    adb(['forward', '--remove', `tcp:${port}`], 'R1B_WEBVIEW_CDP_ATTACH_FAILED', true);
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function allowedTarget(entry) {
  if (entry?.type !== 'page' || typeof entry.url !== 'string') return false;
  try {
    const url = new URL(entry.url);
    return url.origin === TARGET_ORIGIN && TARGET_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}

async function discoverPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(1000)});
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const pages = await response.json();
      const pageTargets = Array.isArray(pages) ? pages.filter((entry) => entry?.type === 'page') : [];
      const targets = pageTargets.filter(allowedTarget);
      if (targets.length > 1) fail('R1B_WEBVIEW_DEBUG_TARGET_AMBIGUOUS');
      if (targets.length === 1) {
        if (!targets[0].webSocketDebuggerUrl) fail('R1B_WEBVIEW_CDP_ATTACH_FAILED');
        return targets[0];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'R1B_WEBVIEW_DEBUG_TARGET_AMBIGUOUS' || message === 'R1B_WEBVIEW_CDP_ATTACH_FAILED') throw error;
    }
    await delay(250);
  }
  fail('R1B_WEBVIEW_DEBUG_TARGET_NOT_FOUND');
}

async function connect(url) {
  try {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('R1B_WEBVIEW_CDP_ATTACH_FAILED')), TRANSACTION_TIMEOUT_MS);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error); }, {once: true});
    });
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(handlers.timer);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('R1B_WEBVIEW_CDP_ATTACH_FAILED'));
      }, TRANSACTION_TIMEOUT_MS);
      pending.set(id, {resolve, reject, timer});
      socket.send(JSON.stringify({id, method, params}));
    });
    return {socket, command};
  } catch {
    fail('R1B_WEBVIEW_CDP_ATTACH_FAILED');
  }
}

function stableCode(detail, fallbackCode) {
  const match = String(detail).match(/(?:R1B|CHAIN3|FRONTLINE|STORE)_[A-Z0-9_]+/);
  return match?.[0] ?? fallbackCode;
}

async function evaluate(command, expression, fallbackCode) {
  try {
    const result = await command('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? '';
      fail(stableCode(detail, fallbackCode));
    }
    return result.result?.value;
  } catch (error) {
    fail(stableCode(error instanceof Error ? error.message : error, fallbackCode));
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function parseCheckout(serialized) {
  if (serialized === null) return null;
  try { return JSON.parse(serialized); }
  catch { return null; }
}

async function readLocalStorage(command, key) {
  execution.operation = 'READ_LOCAL_STORAGE';
  if (key !== CHECKOUT_KEY) fail('R1B_WEBVIEW_LOCAL_STORAGE_KEY_FORBIDDEN');
  const expression = `(() => { try { return localStorage.getItem(${JSON.stringify(CHECKOUT_KEY)}); } catch { throw new Error('R1B_WEBVIEW_LOCAL_STORAGE_READ_FAILED'); } })()`;
  const value = await evaluate(command, expression, 'R1B_WEBVIEW_LOCAL_STORAGE_READ_FAILED');
  if (value !== null && typeof value !== 'string') fail('R1B_WEBVIEW_LOCAL_STORAGE_READ_FAILED');
  return value;
}

function idbReadExpression(key) {
  return `
    (async () => {
      let databases;
      try { databases = await indexedDB.databases(); }
      catch { throw new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED'); }
      if (!databases.some((entry) => entry.name === ${JSON.stringify(OFFLINE_DB)})) return JSON.stringify(null);
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(${JSON.stringify(OFFLINE_DB)});
        const timer = setTimeout(() => { request.transaction?.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_TRANSACTION_TIMEOUT')); }, ${TRANSACTION_TIMEOUT_MS});
        request.onupgradeneeded = () => { clearTimeout(timer); request.transaction?.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED')); };
        request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
        request.onerror = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED')); };
      });
      try {
        if (!db.objectStoreNames.contains(${JSON.stringify(OFFLINE_STORE)})) throw new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED');
        return await new Promise((resolve, reject) => {
          let record = null;
          const transaction = db.transaction(${JSON.stringify(OFFLINE_STORE)}, 'readonly');
          const timer = setTimeout(() => { transaction.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_TRANSACTION_TIMEOUT')); }, ${TRANSACTION_TIMEOUT_MS});
          const request = transaction.objectStore(${JSON.stringify(OFFLINE_STORE)}).get(${JSON.stringify(key)});
          request.onsuccess = () => { record = request.result ?? null; };
          request.onerror = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED')); };
          transaction.oncomplete = () => { clearTimeout(timer); resolve(JSON.stringify(record)); };
          transaction.onerror = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED')); };
          transaction.onabort = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_READ_FAILED')); };
        });
      } finally { db.close(); }
    })()
  `;
}

async function readIndexedDb(command, database, store, key) {
  execution.operation = 'READ_INDEXEDDB';
  if (database !== OFFLINE_DB || store !== OFFLINE_STORE || typeof key !== 'string' || !key) {
    fail('R1B_WEBVIEW_INDEXEDDB_SCOPE_FORBIDDEN');
  }
  const serialized = await evaluate(command, idbReadExpression(key), 'R1B_WEBVIEW_INDEXEDDB_READ_FAILED');
  try { return JSON.parse(serialized); }
  catch { fail('R1B_WEBVIEW_INDEXEDDB_READ_FAILED'); }
}

function checkoutRoot(value) {
  const root = structuredClone(value);
  if (root?.checkout) {
    delete root.checkout.state;
    delete root.checkout.storeCheckoutIntent;
    delete root.checkout.displayOrderCode;
  }
  return root;
}

function durableRoot(value) {
  const root = structuredClone(value);
  for (const field of ['state', 'orderId', 'canonicalRevision', 'syncAttemptCount', 'lastSyncAt', 'updatedAt', 'lastSyncError', 'conflictCode', 'quarantineCode']) {
    delete root[field];
  }
  return root;
}

function assertFixtureRoot(before, intended, kind) {
  const left = kind === 'checkout' ? checkoutRoot(before) : durableRoot(before);
  const right = kind === 'checkout' ? checkoutRoot(intended) : durableRoot(intended);
  if (canonicalSha256(left) !== canonicalSha256(right)) {
    fail('R1B_WEBVIEW_STORAGE_IMMUTABLE_IDENTITY_MUTATION');
  }
}

async function putIndexedDb(command, database, store, key, record, expectedBeforeDigest, fixtureCase) {
  execution.operation = 'PUT_INDEXEDDB';
  if (!TERMINAL_CASES.has(fixtureCase)) fail('R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
  if (database !== OFFLINE_DB || store !== OFFLINE_STORE || record?.intentId !== key) {
    fail('R1B_WEBVIEW_INDEXEDDB_SCOPE_FORBIDDEN');
  }
  const current = await readIndexedDb(command, database, store, key);
  if (current === null) fail('R1B_WEBVIEW_INDEXEDDB_CREATE_FORBIDDEN');
  if (canonicalSha256(current) !== expectedBeforeDigest) fail('R1B_WEBVIEW_STORAGE_FIXTURE_ROOT_MISMATCH');
  assertFixtureRoot(current, record, 'durable');
  execution.operation = 'PUT_INDEXEDDB';
  const serializedRecord = JSON.stringify(record);
  execution.digests = {beforeSha256: expectedBeforeDigest, intendedSha256: canonicalSha256(record)};
  execution.storageMutationAttempted = true;
  execution.sideEffectCertainty = 'UNKNOWN';
  const expression = `
    (async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(${JSON.stringify(OFFLINE_DB)});
        const timer = setTimeout(() => { request.transaction?.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_TRANSACTION_TIMEOUT')); }, ${TRANSACTION_TIMEOUT_MS});
        request.onupgradeneeded = () => { clearTimeout(timer); request.transaction?.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED')); };
        request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
        request.onerror = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED')); };
      });
      try {
        if (!db.objectStoreNames.contains(${JSON.stringify(OFFLINE_STORE)})) throw new Error('R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED');
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(${JSON.stringify(OFFLINE_STORE)}, 'readwrite');
          const timer = setTimeout(() => { transaction.abort(); reject(new Error('R1B_WEBVIEW_INDEXEDDB_TRANSACTION_TIMEOUT')); }, ${TRANSACTION_TIMEOUT_MS});
          transaction.objectStore(${JSON.stringify(OFFLINE_STORE)}).put(JSON.parse(${JSON.stringify(serializedRecord)}));
          transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
          transaction.onerror = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED')); };
          transaction.onabort = () => { clearTimeout(timer); reject(new Error('R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED')); };
        });
      } finally { db.close(); }
      return true;
    })()
  `;
  await evaluate(command, expression, 'R1B_WEBVIEW_INDEXEDDB_WRITE_FAILED');
  const readback = await readIndexedDb(command, database, store, key);
  const intendedDigest = canonicalSha256(record);
  const readbackDigest = readback === null ? null : canonicalSha256(readback);
  if (readbackDigest !== intendedDigest) fail('R1B_WEBVIEW_INDEXEDDB_WRITE_READBACK_MISMATCH');
  return {beforeSha256: expectedBeforeDigest, intendedSha256: intendedDigest, readbackSha256: readbackDigest, matched: true};
}

async function writeLocalStorage(command, key, record, expectedBeforeDigest, fixtureCase) {
  execution.operation = 'WRITE_LOCAL_STORAGE';
  if (!TERMINAL_CASES.has(fixtureCase)) fail('R1B_WEBVIEW_STORAGE_MUTATION_OUTSIDE_FIXTURE_MODE');
  if (key !== CHECKOUT_KEY) fail('R1B_WEBVIEW_LOCAL_STORAGE_KEY_FORBIDDEN');
  const currentSerialized = await readLocalStorage(command, key);
  const current = parseCheckout(currentSerialized);
  if (current === null || canonicalSha256(current) !== expectedBeforeDigest) fail('R1B_WEBVIEW_STORAGE_FIXTURE_ROOT_MISMATCH');
  assertFixtureRoot(current, record, 'checkout');
  execution.operation = 'WRITE_LOCAL_STORAGE';
  const serializedRecord = JSON.stringify(record);
  execution.digests = {beforeSha256: expectedBeforeDigest, intendedSha256: canonicalSha256(record)};
  execution.storageMutationAttempted = true;
  execution.sideEffectCertainty = 'UNKNOWN';
  const expression = `(() => { try { localStorage.setItem(${JSON.stringify(CHECKOUT_KEY)}, ${JSON.stringify(serializedRecord)}); return localStorage.getItem(${JSON.stringify(CHECKOUT_KEY)}); } catch { throw new Error('R1B_WEBVIEW_LOCAL_STORAGE_WRITE_FAILED'); } })()`;
  const readbackSerialized = await evaluate(command, expression, 'R1B_WEBVIEW_LOCAL_STORAGE_WRITE_FAILED');
  const readback = parseCheckout(readbackSerialized);
  const intendedDigest = canonicalSha256(record);
  const readbackDigest = readback === null ? null : canonicalSha256(readback);
  if (readbackDigest !== intendedDigest) fail('R1B_WEBVIEW_LOCAL_STORAGE_WRITE_READBACK_MISMATCH');
  return {beforeSha256: expectedBeforeDigest, intendedSha256: intendedDigest, readbackSha256: readbackDigest, matched: true};
}

async function observableCodes(command) {
  const expression = `(() => Array.from(new Set((document.body?.innerText ?? '').match(/\\b[A-Z][A-Z0-9_]{5,}\\b/g) ?? [])).sort())()`;
  const codes = await evaluate(command, expression, 'R1B_WEBVIEW_LOCAL_STORAGE_READ_FAILED');
  return Array.isArray(codes) && codes.every((code) => typeof code === 'string') ? codes : [];
}

async function readSnapshot(command) {
  const checkoutSerialized = await readLocalStorage(command, CHECKOUT_KEY);
  const checkout = parseCheckout(checkoutSerialized);
  const intentId = typeof checkout?.checkout?.intentId === 'string' ? checkout.checkout.intentId : null;
  const durable = intentId === null ? null : await readIndexedDb(command, OFFLINE_DB, OFFLINE_STORE, intentId);
  return {
    snapshot: {
      local_storage: checkoutSerialized === null ? {} : {[CHECKOUT_KEY]: checkoutSerialized},
      indexed_db: [{database: OFFLINE_DB, store: OFFLINE_STORE, records: durable === null ? [] : [durable]}],
      observable_codes: await observableCodes(command),
    },
    checkout,
    durable,
    intentId,
  };
}

function contract(commandName, state, snapshot, legacySource) {
  const commandArgs = [CONTRACT_PATH, commandName, '--state', state];
  if (legacySource) commandArgs.push('--legacy-source', legacySource);
  const result = spawnSync('python3', commandArgs, {
    input: JSON.stringify(snapshot),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(stableCode(result.stderr, 'R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED'));
  }
  try { return JSON.parse(result.stdout); }
  catch { fail('R1B_LEGACY_CHECKOUT_FIXTURE_BASE_REJECTED'); }
}

function assertPrivacySafeEvidence(value) {
  const forbiddenKey = /^(?:sessiontoken|accesstoken|refreshtoken|providertoken|paymenttoken|password|passcode|pin|secret|credential|credentials|cookie|setcookie|cardnumber|cvv|cvc)$/;
  const visit = (item, parent = '') => {
    if (Array.isArray(item)) {
      for (const valueItem of item) visit(valueItem, parent);
    } else if (item && typeof item === 'object') {
      for (const [key, valueItem] of Object.entries(item)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (parent !== 'identity_sha256_prefixes' && forbiddenKey.test(normalized)) {
          fail('R1B_WEBVIEW_STORAGE_EVIDENCE_SECRET_LEAK');
        }
        visit(valueItem, key);
      }
    } else if (typeof item === 'string' && /(?:\bbearer\s+\S+|\b(?:sessiontoken|accesstoken|refreshtoken|providertoken|paymenttoken|password|passcode|secret)\s*[:=])/i.test(item)) {
      fail('R1B_WEBVIEW_STORAGE_EVIDENCE_SECRET_LEAK');
    }
  };
  visit(value);
}

async function execute(command, args) {
  const root = await readSnapshot(command);
  if (args.phase === 'post') {
    const evidence = contract('stream-project', args.fixtureCase, root.snapshot);
    return {...evidence, phase: 'post', operations: args.operations};
  }

  const prepared = contract('stream-prepare', args.fixtureCase, root.snapshot, args.legacySource);
  let evidence = prepared.evidence;
  const writeProof = {};
  if (TERMINAL_CASES.has(args.fixtureCase)) {
    if (root.checkout === null || root.durable === null || root.intentId === null) {
      fail('R1B_WEBVIEW_STORAGE_FIXTURE_ROOT_MISMATCH');
    }
    writeProof.indexedDb = await putIndexedDb(
      command,
      OFFLINE_DB,
      OFFLINE_STORE,
      root.intentId,
      prepared.bundle.offline_intent,
      canonicalSha256(root.durable),
      args.fixtureCase,
    );
    writeProof.localStorage = await writeLocalStorage(
      command,
      CHECKOUT_KEY,
      prepared.bundle.checkout_context,
      canonicalSha256(root.checkout),
      args.fixtureCase,
    );
    const readback = await readSnapshot(command);
    evidence = contract('stream-project', args.fixtureCase, readback.snapshot);
    evidence.source_binding = prepared.evidence.source_binding;
  }
  return {...evidence, phase: 'pre', operations: args.operations, write_proof: writeProof};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  execution.args = args;
  let forwardPort;
  let socket;
  try {
    forwardPort = establishForward();
    const page = await discoverPage(forwardPort, args.timeoutMs);
    const connection = await connect(page.webSocketDebuggerUrl);
    socket = connection.socket;
    try { await connection.command('Runtime.enable'); }
    catch { fail('R1B_WEBVIEW_CDP_ATTACH_FAILED'); }
    const location = await evaluate(
      connection.command,
      '({origin: location.origin, pathname: location.pathname})',
      'R1B_WEBVIEW_CDP_ATTACH_FAILED',
    );
    if (location?.origin !== TARGET_ORIGIN || !TARGET_PATHS.has(location?.pathname)) {
      fail('R1B_WEBVIEW_STORAGE_ORIGIN_MISMATCH');
    }
    const evidence = await execute(connection.command, args);
    assertPrivacySafeEvidence(evidence);
    fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(args.phase === 'pre' ? 'PRE_UPGRADE_FIXTURE_VALID\n' : 'R1B_WEBVIEW_CUSTODY_PROJECTION_READY\n');
  } finally {
    socket?.close();
    removeForward(forwardPort);
  }
}

function argumentValue(name) {
  const index = process.argv.lastIndexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function errorLayer(code) {
  if (code.includes('DEBUG_TARGET') || code.includes('ORIGIN_MISMATCH')) return 'ANDROID_WEBVIEW_DISCOVERY';
  if (code.includes('CDP_ATTACH')) return 'ANDROID_WEBVIEW_CDP';
  if (code.includes('EVIDENCE_SECRET')) return 'BUILDER_EVIDENCE_PRIVACY';
  if (code.includes('UNTYPED') || code.includes('FORBIDDEN') || code.includes('FIXTURE_ROOT') || code.includes('IMMUTABLE') || code.includes('MUTATION_OUTSIDE')) {
    return 'BUILDER_TEST_HELPER_POLICY';
  }
  return 'WEBVIEW_STORAGE';
}

function writeNegativeEvidence(code) {
  const output = execution.args?.output ?? argumentValue('--output');
  if (!output) return;
  const requestedOperations = process.argv
    .map((value, index) => process.argv[index - 1] === '--operation' ? value : null)
    .filter(Boolean);
  const fixtureCase = execution.args?.fixtureCase ?? argumentValue('--fixture-case') ?? null;
  const evidence = {
    caseId: `security-${code.toLowerCase()}`,
    verdict: 'RED',
    code,
    layer: errorLayer(code),
    operation: execution.operation === 'POLICY_VALIDATION' ? requestedOperations.join(',') : execution.operation,
    fixtureCase,
    sourceSha: null,
    builderSha: null,
    packageName: PACKAGE_ID,
    ...execution.digests,
    matched: false,
    storageMutationAttempted: execution.storageMutationAttempted,
    packageMutationExecuted: false,
    sideEffectCertainty: execution.sideEffectCertainty,
    privacyScanPassed: code !== 'R1B_WEBVIEW_STORAGE_EVIDENCE_SECRET_LEAK',
    forceStopRequired: execution.args?.phase === 'pre' && TERMINAL_CASES.has(fixtureCase),
    forceStopObserved: false,
  };
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  const code = stableCode(error instanceof Error ? error.message : error, 'R1B_WEBVIEW_CDP_ATTACH_FAILED');
  try { writeNegativeEvidence(code); } catch {}
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
