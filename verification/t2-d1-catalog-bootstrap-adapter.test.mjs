import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { D1CatalogBootstrapAdapter, repairD1CatalogSchema } from '../source/packages/catalog/d1-catalog-bootstrap-adapter.ts';
import { bootstrapD1DirectAuthoritiesWithCanonicalCatalog } from '../source/packages/order/d1-direct-authority-bootstrap-composition.ts';

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
    try {
      const results = statements.map(statement => statement.runSync());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

class FailingBatchD1Adapter extends SqliteD1Adapter {
  constructor(database) { super(database); this.failNext = true; }
  async batch(statements) {
    if (!this.failNext) return super.batch(statements);
    this.failNext = false;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      statements[0].runSync();
      throw new Error('SIMULATED_BATCH_FAILURE');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const STORE_ID = '550e8400-e29b-41d4-a716-446655440001';
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440002';
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440101';
const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440102';
const BUSINESS_DAY_ID = '550e8400-e29b-41d4-a716-446655440201';
const PRICE_ID = '550e8400-e29b-41d4-a716-446655440301';
const NOW = '2026-09-03T08:00:00.000Z';

const snapshot = Object.freeze({
  storeId: STORE_ID,
  catalogRevision: 'catalog-live-1',
  categories: Object.freeze([{
    categoryId: CATEGORY_ID, name: '飯團', lifecycleStatus: 'ACTIVE', position: 1, revision: 1, createdAt: NOW, updatedAt: NOW,
  }]),
  products: Object.freeze([{
    productId: PRODUCT_ID, name: '招牌飯團', lifecycleStatus: 'ACTIVE', revision: 1, createdAt: NOW, updatedAt: NOW,
    categoryMemberships: Object.freeze([{ categoryId: CATEGORY_ID, position: 1 }]), optionGroups: Object.freeze([]),
  }]),
});

function foundation(sqlite) {
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0001-zero-cost-order-payment-proof.sql', 'utf8'));
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0003-order-outbox-store-scope.sql', 'utf8'));
}

function legacyCatalog(sqlite) {
  sqlite.exec(`CREATE TABLE mfos_catalog_state (
    store_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function catalogInput(overrides = {}) {
  return {
    storeId: STORE_ID,
    actorId: ACTOR_ID,
    authorizationContextRef: 'adm-core-auth-live',
    requestId: 'catalog-request-1',
    idempotencyKey: 'catalog-idem-1',
    occurredAt: NOW,
    snapshot,
    ...overrides,
  };
}

function directInput(overrides = {}) {
  return {
    storeId: STORE_ID,
    actorId: ACTOR_ID,
    authorizationContextRef: 'adm-core-auth-live',
    requestId: 'direct-request-1',
    idempotencyKey: 'direct-idem-1',
    catalogIdempotencyKey: 'catalog-idem-1',
    catalogSnapshot: snapshot,
    selectedProductId: PRODUCT_ID,
    storeOperational: { status: 'OPEN', reasonCode: 'AUTHORIZED_BOOTSTRAP_OPEN' },
    availability: [{ availabilityId: 'availability-live-1', targetType: 'PRODUCT', targetId: PRODUCT_ID, status: 'AVAILABLE', reasonCode: 'AUTHORIZED_BOOTSTRAP_AVAILABLE' }],
    pricing: [{ pricingProfileId: PRICE_ID, subjectType: 'PRODUCT', subjectId: PRODUCT_ID, currency: 'HKD', fixedPriceMinor: 4100 }],
    businessDay: { businessDayId: BUSINESS_DAY_ID, businessDate: '2026-09-03', timezone: 'Asia/Hong_Kong', boundaryLocalTime: '05:00', policyRevision: 1 },
    ...overrides,
  };
}

const allowCatalog = { authorize: request => request.subject.authorizationContextRef === 'adm-core-auth-live' && request.resourceId === STORE_ID };

test('exact empty legacy catalog shell upgrades, unknown/non-empty shapes fail closed', async () => {
  {
    const sqlite = new DatabaseSync(':memory:'); foundation(sqlite); legacyCatalog(sqlite);
    const result = await repairD1CatalogSchema(new SqliteD1Adapter(sqlite));
    assert.equal(result, 'UPGRADED_EMPTY_LEGACY');
    assert.deepEqual(sqlite.prepare('PRAGMA table_info(mfos_catalog_state)').all().map(x => x.name), ['store_id','catalog_revision','snapshot_json','revision','created_at','updated_at']);
    assert.ok(sqlite.prepare('PRAGMA table_info(mfos_catalog_audit)').all().length > 0);
    sqlite.close();
  }
  {
    const sqlite = new DatabaseSync(':memory:'); foundation(sqlite); legacyCatalog(sqlite);
    sqlite.prepare('INSERT INTO mfos_catalog_state VALUES (?,1,?,?)').run(STORE_ID, '{}', NOW);
    await assert.rejects(() => repairD1CatalogSchema(new SqliteD1Adapter(sqlite)), /D1_CATALOG_LEGACY_DATA_PRESENT/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_state').get().n, 1);
    sqlite.close();
  }
  {
    const sqlite = new DatabaseSync(':memory:'); foundation(sqlite);
    sqlite.exec('CREATE TABLE mfos_catalog_state (store_id TEXT PRIMARY KEY, mystery TEXT NOT NULL)');
    await assert.rejects(() => repairD1CatalogSchema(new SqliteD1Adapter(sqlite)), /D1_CATALOG_UNEXPECTED_SHAPE/);
    sqlite.close();
  }
});

test('canonical adapter authorizes, persists atomically, replays and serves same active snapshot', async () => {
  const sqlite = new DatabaseSync(':memory:'); foundation(sqlite);
  const db = new SqliteD1Adapter(sqlite);
  await repairD1CatalogSchema(db);
  const adapter = new D1CatalogBootstrapAdapter(db, { authorization: allowCatalog });
  const first = await adapter.bootstrapActiveCatalog(catalogInput());
  assert.deepEqual(first, snapshot);
  assert.deepEqual(await adapter.readActive({ storeId: STORE_ID, channel: 'CUS' }), snapshot);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_state').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_audit').get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mfos_outbox WHERE domain='CATALOG'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mfos_d1_idempotency WHERE scope='catalog.bootstrap.active'").get().n, 1);
  assert.deepEqual(await adapter.bootstrapActiveCatalog(catalogInput()), snapshot);
  await assert.rejects(() => adapter.bootstrapActiveCatalog(catalogInput({ snapshot: { ...snapshot, catalogRevision: 'catalog-live-2' } })), /IDEMPOTENCY_KEY_REUSED/);
  sqlite.close();
});

test('unauthorized, wrong-store and invalid active snapshot fail closed', async () => {
  const sqlite = new DatabaseSync(':memory:'); foundation(sqlite);
  const db = new SqliteD1Adapter(sqlite); await repairD1CatalogSchema(db);
  const denied = new D1CatalogBootstrapAdapter(db, { authorization: { authorize: () => false } });
  await assert.rejects(() => denied.bootstrapActiveCatalog(catalogInput()), /CATALOG_COMMAND_FORBIDDEN/);
  const adapter = new D1CatalogBootstrapAdapter(db, { authorization: allowCatalog });
  await assert.rejects(() => adapter.bootstrapActiveCatalog(catalogInput({ storeId: 'different-store' })), /CATALOG_BOOTSTRAP_STORE_MISMATCH/);
  await assert.rejects(() => adapter.bootstrapActiveCatalog(catalogInput({ snapshot: { ...snapshot, products: [] } })), /CATALOG_BOOTSTRAP_ACTIVE_PRODUCT_REQUIRED/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_state').get().n, 0);
  sqlite.close();
});

test('catalog batch failure rolls back state, audit, outbox and idempotency', async () => {
  const sqlite = new DatabaseSync(':memory:'); foundation(sqlite);
  const normal = new SqliteD1Adapter(sqlite); await repairD1CatalogSchema(normal);
  const db = new FailingBatchD1Adapter(sqlite);
  const adapter = new D1CatalogBootstrapAdapter(db, { authorization: allowCatalog });
  await assert.rejects(() => adapter.bootstrapActiveCatalog(catalogInput()), /SIMULATED_BATCH_FAILURE/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_state').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mfos_catalog_audit').get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mfos_outbox WHERE domain='CATALOG'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mfos_d1_idempotency WHERE scope='catalog.bootstrap.active'").get().n, 0);
  sqlite.close();
});

test('live composition uses canonical catalog adapter before the existing DIRECT bootstrap', async () => {
  const sqlite = new DatabaseSync(':memory:'); foundation(sqlite);
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0006-availability-store-operational.sql', 'utf8'));
  sqlite.exec(readFileSync('source/infra/cloudflare/d1/migrations/0007-direct-final-gate-read-authorities.sql', 'utf8'));
  const db = new SqliteD1Adapter(sqlite);
  let outerAuth = 0;
  const result = await bootstrapD1DirectAuthoritiesWithCanonicalCatalog(db, directInput(), {
    authorize: context => { outerAuth += 1; assert.equal(context.authorizationContextRef, 'adm-core-auth-live'); },
    catalogAuthorization: allowCatalog,
    now: () => NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.catalogRevision, snapshot.catalogRevision);
  assert.equal(sqlite.prepare('SELECT catalog_revision FROM mfos_catalog_state WHERE store_id=?').get(STORE_ID).catalog_revision, snapshot.catalogRevision);
  assert.equal(sqlite.prepare('SELECT fixed_price_minor FROM mfos_pricing_profile WHERE store_id=?').get(STORE_ID).fixed_price_minor, 4100);
  assert.ok(outerAuth >= 1);
  sqlite.close();
});
