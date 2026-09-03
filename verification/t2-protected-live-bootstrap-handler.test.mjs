import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairDirectAuthoritySchema } from '../source/packages/production-persistence/d1-direct-authority-schema-repair.ts';
import { handleProtectedAdminDirectAuthorityBootstrap } from '../source/packages/order/d1-direct-authority-bootstrap-admin-handler.ts';

class StatementAdapter {
  constructor(statement, sql) { this.statement = statement; this.sql = sql.trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { return this.runSync(); }
  runSync() {
    if (/^(SELECT|PRAGMA)\b/i.test(this.sql)) return { success: true, results: this.statement.all(...this.values), meta: { changes: 0 } };
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async first(column) {
    const row = this.statement.get(...this.values);
    if (row === undefined) return null;
    return column === undefined ? row : row[column] ?? null;
  }
  async all() { return { success: true, results: this.statement.all(...this.values) }; }
}
class SqliteD1Adapter {
  constructor(database) { this.database = database; }
  prepare(sql) { return new StatementAdapter(this.database.prepare(sql), sql); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.runSync()); this.database.exec('COMMIT'); return results; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}

const STORE_ID = '550e8400-e29b-41d4-a716-446655440001';
const STAFF_ID = '550e8400-e29b-41d4-a716-446655440002';
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440101';
const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440102';
const BUSINESS_DAY_ID = '550e8400-e29b-41d4-a716-446655440201';
const PRICE_ID = '550e8400-e29b-41d4-a716-446655440301';
const NOW = '2026-09-03T08:20:00.000Z';

function foundation(sqlite) {
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0001-zero-cost-order-payment-proof.sql', 'utf8'));
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0003-order-outbox-store-scope.sql', 'utf8'));
}
function body(overrides = {}) {
  return {
    storeId: STORE_ID,
    idempotencyKey: 'live-bootstrap-idem-1',
    catalogIdempotencyKey: 'live-catalog-idem-1',
    catalogSnapshot: {
      storeId: STORE_ID,
      catalogRevision: 'catalog-live-1',
      categories: [{ categoryId: CATEGORY_ID, name: 'Live', lifecycleStatus: 'ACTIVE', position: 1, revision: 1, createdAt: NOW, updatedAt: NOW }],
      products: [{ productId: PRODUCT_ID, name: 'Live Product', lifecycleStatus: 'ACTIVE', revision: 1, createdAt: NOW, updatedAt: NOW, categoryMemberships: [{ categoryId: CATEGORY_ID, position: 1 }], optionGroups: [] }],
    },
    selectedProductId: PRODUCT_ID,
    storeOperational: { status: 'OPEN', reasonCode: 'AUTHORIZED_BOOTSTRAP_OPEN' },
    availability: [{ availabilityId: 'availability-live-1', targetType: 'PRODUCT', targetId: PRODUCT_ID, status: 'AVAILABLE', reasonCode: 'AUTHORIZED_BOOTSTRAP_AVAILABLE' }],
    pricing: [{ pricingProfileId: PRICE_ID, subjectType: 'PRODUCT', subjectId: PRODUCT_ID, currency: 'HKD', fixedPriceMinor: 4100 }],
    businessDay: { businessDayId: BUSINESS_DAY_ID, businessDate: '2026-09-03', timezone: 'Asia/Hong_Kong', boundaryLocalTime: '05:00', policyRevision: 1 },
    ...overrides,
  };
}
function request(payload = body(), headers = {}) {
  return new Request('https://admin.example/internal/bootstrap/direct-authorities', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-morefun-session-id': 'session-live-1',
      'x-morefun-actor-id': 'untrusted-edge-actor-label',
      'x-morefun-authenticated-at': NOW,
      'x-request-id': 'request-live-1',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function gateway({ allowed = true, scope = STORE_ID } = {}) {
  return {
    calls: [],
    async authorize(command, at) {
      this.calls.push({ command, at });
      if (!allowed) return { allowed: false, reason: 'PRIMARY_SESSION_INVALID' };
      return {
        allowed: true,
        securityContext: {
          actorId: command.ingress.actorId,
          staffId: STAFF_ID,
          authenticatedAt: command.ingress.authenticatedAt,
          requestId: command.ingress.requestId,
          sessionId: command.ingress.sessionId,
          scopeRef: scope,
        },
        decision: { allowed: true, actorStaffId: STAFF_ID, permission: command.permission, viaOverride: false },
      };
    },
  };
}

test('protected handler rejects methods, content type, caller trust assertions and denied sessions before D1 mutation', async () => {
  const g = gateway();
  const noDb = { DB: {} };
  assert.equal((await handleProtectedAdminDirectAuthorityBootstrap(new Request('https://x', { method: 'GET' }), noDb, { gateway: g, now: () => NOW })).status, 405);
  assert.equal((await handleProtectedAdminDirectAuthorityBootstrap(new Request('https://x', { method: 'POST', body: '{}' }), noDb, { gateway: g, now: () => NOW })).status, 415);
  const asserted = await handleProtectedAdminDirectAuthorityBootstrap(request({ ...body(), actorId: 'forged-admin' }), noDb, { gateway: g, now: () => NOW });
  assert.equal(asserted.status, 400);
  assert.equal((await asserted.json()).code, 'ADMIN_BOOTSTRAP_TRUST_FIELD_FORBIDDEN');
  const denied = await handleProtectedAdminDirectAuthorityBootstrap(request(), noDb, { gateway: gateway({ allowed: false }), now: () => NOW });
  assert.equal(denied.status, 403);
});

test('protected handler derives bootstrap authority from verified staff context and invokes canonical D1 composition idempotently', async () => {
  const sqlite = new DatabaseSync(':memory:');
  foundation(sqlite);
  const db = new SqliteD1Adapter(sqlite);
  await repairDirectAuthoritySchema(db);
  const g = gateway();

  const firstResponse = await handleProtectedAdminDirectAuthorityBootstrap(request(), { DB: db }, { gateway: g, now: () => NOW });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.ok, true);
  assert.equal(first.storeId, STORE_ID);
  assert.equal(first.catalogRevision, 'catalog-live-1');
  assert.equal(g.calls[0].command.permission, 'admin.direct_authority.bootstrap.v1');
  assert.equal(g.calls[0].command.ingress.scopeRef, STORE_ID);

  const catalogAudit = sqlite.prepare('SELECT actor_id, authorization_context_ref, request_id FROM mfos_catalog_audit WHERE store_id=?').get(STORE_ID);
  assert.equal(catalogAudit.actor_id, STAFF_ID);
  assert.notEqual(catalogAudit.actor_id, 'untrusted-edge-actor-label');
  assert.match(catalogAudit.authorization_context_ref, /^admin-bootstrap:[0-9a-f]{32}$/);
  assert.equal(catalogAudit.request_id, 'request-live-1');
  assert.equal(sqlite.prepare('SELECT changed_by_actor_id FROM mfos_store_operational_state WHERE store_id=?').get(STORE_ID).changed_by_actor_id, STAFF_ID);

  const replayResponse = await handleProtectedAdminDirectAuthorityBootstrap(request(), { DB: db }, { gateway: g, now: () => NOW });
  assert.equal(replayResponse.status, 200);
  assert.deepEqual(await replayResponse.json(), first);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_store_operational_state').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_state').get().n, 1);
  sqlite.close();
});

test('protected handler fails closed when verified security scope differs from requested store', async () => {
  const response = await handleProtectedAdminDirectAuthorityBootstrap(request(), { DB: {} }, { gateway: gateway({ scope: 'other-store' }), now: () => NOW });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'ADMIN_BOOTSTRAP_SECURITY_CONTEXT_MISMATCH');
});