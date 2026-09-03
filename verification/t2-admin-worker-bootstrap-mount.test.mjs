import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workerModule = await import('../source/infra/cloudflare/admin-web-worker/index.ts');
const worker = workerModule.default;

const STORE_ID = '550e8400-e29b-41d4-a716-446655440001';
const STAFF_ID = '550e8400-e29b-41d4-a716-446655440002';
const TOKEN = 'builder-only-admin-session-token';
const bootstrap = JSON.stringify([{
  sessionToken: TOKEN,
  actorId: 'builder-admin-actor',
  staffId: STAFF_ID,
  deviceId: 'builder-admin-device',
  scopeRef: STORE_ID,
  expiresAt: '2099-01-01T00:00:00.000Z',
  permissions: ['admin.direct_authority.bootstrap.v1'],
}]);

const env = {
  DB: new Proxy({}, { get() { throw new Error('D1_MUST_NOT_BE_TOUCHED_FOR_AUTH_GATE_TEST'); } }),
  ASSETS: { async fetch() { return new Response('asset-ok', { status: 200 }); } },
  ADMIN_SESSION_BOOTSTRAP_JSON: bootstrap,
};

function req(path, init = {}) {
  return new Request(`https://admin.example${path}`, init);
}
function authHeaders(extra = {}) {
  return { cookie: `mf_admin_session=${TOKEN}`, ...extra };
}

test('deployable Admin Worker config is bound to the accepted production D1 and routes admin API through Worker first', () => {
  const raw = readFileSync('source/infra/cloudflare/admin-web-worker/wrangler.jsonc', 'utf8');
  const config = JSON.parse(raw);
  assert.equal(config.name, 'morefun-v2-admin');
  assert.equal(config.main, './index.ts');
  assert.equal(config.workers_dev, true);
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  const db = config.d1_databases.find((item) => item.binding === 'DB');
  assert.equal(db.database_name, 'morefun-v2-production');
  assert.equal(db.database_id, '1ed17fcb-7e7a-4e13-a922-ae141aff4142');
  assert.deepEqual(config.assets.run_worker_first, ['/api/admin/*']);
});

test('Worker keeps assets available while anonymous Admin session and bootstrap fail closed', async () => {
  assert.equal((await worker.fetch(req('/'), env)).status, 200);
  assert.equal((await worker.fetch(req('/api/admin/session'), env)).status, 401);
  assert.equal((await worker.fetch(req('/api/admin/direct-authority/bootstrap', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE_ID }),
  }), env)).status, 401);
});

test('authenticated session resolves server staff/store scope and canonical RBAC permission', async () => {
  const response = await worker.fetch(req('/api/admin/session', { headers: authHeaders() }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.staffId, STAFF_ID);
  assert.equal(body.scopeRef, STORE_ID);
  assert.equal(body.bootstrapAuthorized, true);
});

test('protected bootstrap uses canonical gateway/RBAC scope and denies wrong store before D1', async () => {
  const response = await worker.fetch(req('/api/admin/direct-authority/bootstrap', {
    method: 'POST',
    headers: authHeaders({
      'content-type': 'application/json',
      'x-morefun-session-id': 'forged-session',
      'x-morefun-actor-id': 'forged-actor',
      'x-morefun-authenticated-at': '2000-01-01T00:00:00.000Z',
    }),
    body: JSON.stringify({ storeId: 'wrong-store-scope' }),
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'ADMIN_BOOTSTRAP_FORBIDDEN');
});

test('caller trust assertions in bootstrap body fail closed and Worker source rebuilds identity headers server-side', async () => {
  const response = await worker.fetch(req('/api/admin/direct-authority/bootstrap', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ storeId: STORE_ID, actorId: 'forged-admin' }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'ADMIN_BOOTSTRAP_TRUST_FIELD_FORBIDDEN');

  const source = readFileSync('source/infra/cloudflare/admin-web-worker/index.ts', 'utf8');
  assert.match(source, /createSecurityContextAuthorizationGateway/);
  assert.match(source, /createIdentityRbacService/);
  assert.match(source, /headers\.delete\('x-morefun-session-id'\)/);
  assert.match(source, /headers\.set\('x-morefun-session-id', session\.sessionId\)/);
  assert.doesNotMatch(source, /authorize\s*:\s*true/);
  assert.doesNotMatch(source, /raw\s+sql/i);
});

test('handler permission conforms to canonical Identity RBAC grammar', () => {
  const handler = readFileSync('source/packages/order/d1-direct-authority-bootstrap-admin-handler.ts', 'utf8');
  assert.match(handler, /admin\.direct_authority\.bootstrap\.v1/);
  assert.doesNotMatch(handler, /admin\.direct-authority\.bootstrap\.v1/);
});
