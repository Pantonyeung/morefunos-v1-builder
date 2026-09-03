import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairDirectAuthoritySchema } from '../source/packages/production-persistence/d1-direct-authority-schema-repair.ts';
import { bootstrapD1DirectAuthorities } from '../source/packages/order/d1-direct-authority-bootstrap.ts';

class StatementAdapter {
  constructor(statement, sql) { this.statement = statement; this.sql = sql.trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { return this.runSync(); }
  runSync() {
    if (/^(SELECT|PRAGMA)\b/i.test(this.sql)) {
      return { success: true, results: this.statement.all(...this.values), meta: { changes: 0 } };
    }
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

const STORE_ID = '550e8400-e29b-41d4-a716-446655440001';
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440002';
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440101';
const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440102';
const BUSINESS_DAY_ID = '550e8400-e29b-41d4-a716-446655440201';
const PRICE_ID = '550e8400-e29b-41d4-a716-446655440301';
const AVAILABILITY_ID = 'availability-real-input-1';
const NOW = '2026-09-03T05:45:00.000Z';

function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function createFoundation(database) {
  database.exec(readFileSync('source/infra/cloudflare/d1/migrations/0001-zero-cost-order-payment-proof.sql', 'utf8'));
  database.exec(readFileSync('source/infra/cloudflare/d1/migrations/0003-order-outbox-store-scope.sql', 'utf8'));
}

function createExactLegacyAvailability(database) {
  database.exec(`CREATE TABLE mfos_availability_state (
    availability_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

const EXPECTED_AVAILABILITY = [
  'availability_id', 'store_id', 'target_type', 'target_id', 'status', 'revision', 'changed_at',
  'changed_by_actor_id', 'change_source', 'reason_code', 'reason_note',
];

const catalogSnapshot = Object.freeze({
  storeId: STORE_ID,
  catalogRevision: 'catalog-operator-approved-1',
  categories: Object.freeze([{
    categoryId: CATEGORY_ID,
    name: 'operator input category',
    lifecycleStatus: 'ACTIVE',
    position: 1,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }]),
  products: Object.freeze([{
    productId: PRODUCT_ID,
    name: 'operator input product',
    lifecycleStatus: 'ACTIVE',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    categoryMemberships: Object.freeze([{ categoryId: CATEGORY_ID, position: 1 }]),
    optionGroups: Object.freeze([]),
  }]),
});

test('exact empty legacy Availability upgrades to admitted current shape and rerun is safe', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createFoundation(sqlite);
  createExactLegacyAvailability(sqlite);
  const db = new SqliteD1Adapter(sqlite);

  const first = await repairDirectAuthoritySchema(db);
  assert.equal(first.availability, 'UPGRADED_EMPTY_LEGACY');
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), EXPECTED_AVAILABILITY);
  assert.ok(columns(sqlite, 'mfos_availability_audit').length > 0);
  assert.ok(columns(sqlite, 'mfos_store_operational_state').length > 0);
  assert.ok(columns(sqlite, 'mfos_store_operational_audit').length > 0);
  assert.ok(columns(sqlite, 'mfos_pricing_profile').length > 0);
  assert.ok(columns(sqlite, 'mfos_business_day').length > 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_availability_state').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_store_operational_state').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_pricing_profile').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_business_day').get().count, 0);

  const second = await repairDirectAuthoritySchema(db);
  assert.equal(second.availability, 'ALREADY_CURRENT');
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), EXPECTED_AVAILABILITY);
  sqlite.close();
});

test('legacy Availability with any business row fails closed without schema mutation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createFoundation(sqlite);
  createExactLegacyAvailability(sqlite);
  sqlite.prepare(`INSERT INTO mfos_availability_state
    (availability_id, store_id, target_type, target_id, revision, record_json, updated_at)
    VALUES (?, ?, 'PRODUCT', ?, 1, '{}', ?)`)
    .run('legacy-1', STORE_ID, PRODUCT_ID, NOW);
  const before = columns(sqlite, 'mfos_availability_state');
  const db = new SqliteD1Adapter(sqlite);

  await assert.rejects(() => repairDirectAuthoritySchema(db), /D1_AVAILABILITY_LEGACY_DATA_PRESENT/);
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), before);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_availability_state').get().count, 1);
  assert.equal(columns(sqlite, 'mfos_store_operational_state').length, 0);
  sqlite.close();
});

test('unexpected same-name Availability shape fails closed', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createFoundation(sqlite);
  sqlite.exec('CREATE TABLE mfos_availability_state (availability_id TEXT PRIMARY KEY, mystery TEXT NOT NULL)');
  const db = new SqliteD1Adapter(sqlite);
  await assert.rejects(() => repairDirectAuthoritySchema(db), /D1_AVAILABILITY_UNEXPECTED_SHAPE/);
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), ['availability_id', 'mystery']);
  sqlite.close();
});

test('trusted bootstrap uses explicit operator inputs, server time, one D1 batch and idempotent replay', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createFoundation(sqlite);
  const db = new SqliteD1Adapter(sqlite);
  await repairDirectAuthoritySchema(db);

  let authorizationCalls = 0;
  let catalogCalls = 0;
  const options = {
    now: () => NOW,
    authorize: async context => {
      authorizationCalls += 1;
      assert.equal(context.storeId, STORE_ID);
      assert.equal(context.actorId, ACTOR_ID);
      assert.equal(context.authorizationContextRef, 'adm-core-auth-real-input');
    },
    catalog: {
      async bootstrapActiveCatalog(input) {
        catalogCalls += 1;
        assert.equal(input.storeId, STORE_ID);
        assert.equal(input.actorId, ACTOR_ID);
        assert.equal(input.occurredAt, NOW);
        assert.equal(input.idempotencyKey, 'catalog-idem-1');
        return input.snapshot;
      },
    },
  };

  const input = {
    storeId: STORE_ID,
    actorId: ACTOR_ID,
    authorizationContextRef: 'adm-core-auth-real-input',
    requestId: 'bootstrap-request-1',
    idempotencyKey: 'bootstrap-idem-1',
    catalogIdempotencyKey: 'catalog-idem-1',
    catalogSnapshot,
    selectedProductId: PRODUCT_ID,
    storeOperational: { status: 'OPEN', reasonCode: 'AUTHORIZED_BOOTSTRAP_OPEN' },
    availability: [{ availabilityId: AVAILABILITY_ID, targetType: 'PRODUCT', targetId: PRODUCT_ID, status: 'AVAILABLE', reasonCode: 'AUTHORIZED_BOOTSTRAP_AVAILABLE' }],
    pricing: [{ pricingProfileId: PRICE_ID, subjectType: 'PRODUCT', subjectId: PRODUCT_ID, currency: 'HKD', fixedPriceMinor: 4100 }],
    businessDay: { businessDayId: BUSINESS_DAY_ID, businessDate: '2026-09-03', timezone: 'Asia/Hong_Kong', boundaryLocalTime: '05:00', policyRevision: 1 },
  };

  const first = await bootstrapD1DirectAuthorities(db, input, options);
  assert.equal(first.storeId, STORE_ID);
  assert.equal(first.recordedAt, NOW);
  assert.equal(sqlite.prepare('SELECT operational_status FROM mfos_store_operational_state WHERE store_id=?').get(STORE_ID).operational_status, 'OPEN');
  assert.equal(sqlite.prepare('SELECT status FROM mfos_availability_state WHERE store_id=?').get(STORE_ID).status, 'AVAILABLE');
  assert.deepEqual(sqlite.prepare('SELECT currency, fixed_price_minor FROM mfos_pricing_profile WHERE store_id=?').get(STORE_ID), { currency: 'HKD', fixed_price_minor: 4100 });
  assert.equal(sqlite.prepare('SELECT lifecycle_status FROM mfos_business_day WHERE store_id=?').get(STORE_ID).lifecycle_status, 'OPEN');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM mfos_d1_idempotency WHERE scope='direct.authority.bootstrap'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM mfos_outbox WHERE domain='DIRECT_AUTHORITY_BOOTSTRAP'").get().count, 1);

  const replay = await bootstrapD1DirectAuthorities(db, input, options);
  assert.deepEqual(replay, first);
  assert.equal(catalogCalls, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_store_operational_state').get().count, 1);

  await assert.rejects(() => bootstrapD1DirectAuthorities(db, { ...input, storeOperational: { ...input.storeOperational, status: 'PAUSED' } }, options), /IDEMPOTENCY_KEY_REUSED/);
  assert.ok(authorizationCalls >= 3);
  assert.equal(sqlite.prepare('SELECT operational_status FROM mfos_store_operational_state WHERE store_id=?').get(STORE_ID).operational_status, 'OPEN');

  console.log(JSON.stringify({
    schemaRepair: 'PASS',
    storeId: first.storeId,
    selectedProductId: first.selectedProductId,
    directPriceMinor: 4100,
    availability: 'AVAILABLE',
    storeOperational: 'OPEN',
    businessDay: 'OPEN',
    idempotentReplay: 'PASS',
    changedPayloadConflict: 'PASS',
    productionValues: 'OPERATOR_INPUT_ONLY_NOT_SEEDED_BY_MIGRATION',
  }));
  sqlite.close();
});
