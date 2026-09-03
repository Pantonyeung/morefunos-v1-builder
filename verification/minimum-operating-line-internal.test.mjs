import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { InternalPortCompositionResolver } from '../source/packages/internal-port-runtime/composition.ts';
import { createD1DirectOrderFinalGate } from '../source/packages/order/d1-direct-order-final-gate.ts';
import { createCustomerDirectOrderService } from '../source/packages/order/direct-order-bindings.ts';
import { readD1AcceptedOrderProjection } from '../source/packages/order/d1-acceptance.ts';
import { createSmmOrderDetailBinding, createSmtOrderDetailBinding } from '../source/packages/order/order-query-binding.ts';
import { readSmmOrderDetail } from '../source/packages/smm-ui-integration/order-runtime.ts';
import { readSmtOrderDetail } from '../source/packages/smt-ui-integration/order-runtime.ts';

class StatementAdapter {
  constructor(statement) { this.statement = statement; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { return this.runSync(); }
  runSync() {
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
  prepare(sql) { return new StatementAdapter(this.database.prepare(sql)); }
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

const STORE_ID = 'store-1';
const CUSTOMER_ID = 'customer-1';
const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440101';
const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440102';
const GROUP_ID = '550e8400-e29b-41d4-a716-446655440103';
const OPTION_ID = '550e8400-e29b-41d4-a716-446655440104';
const ORDER_ID = 'order-minimum-line-1';
const NOW = '2026-09-03T03:30:00.000Z';

function applyMigrations(database) {
  for (const name of [
    '0001-zero-cost-order-payment-proof.sql',
    '0003-order-outbox-store-scope.sql',
    '0004-accepted-order-projection.sql',
    '0006-availability-store-operational.sql',
    '0007-direct-final-gate-read-authorities.sql',
  ]) {
    database.exec(readFileSync(`source/infra/cloudflare/d1/migrations/${name}`, 'utf8'));
  }
}

function seedAuthorities(database) {
  database.prepare(`INSERT INTO mfos_store_operational_state
    (store_id, operational_status, revision, changed_at, changed_by_actor_id, change_source, reason_code, reason_note)
    VALUES (?, 'OPEN', 1, ?, 'system', 'SYSTEM', 'BOOTSTRAP_OPEN', NULL)`).run(STORE_ID, NOW);

  const availability = database.prepare(`INSERT INTO mfos_availability_state
    (availability_id, store_id, target_type, target_id, status, revision, changed_at, changed_by_actor_id, change_source, reason_code, reason_note)
    VALUES (?, ?, ?, ?, 'AVAILABLE', 1, ?, 'system', 'SYSTEM', 'BOOTSTRAP', NULL)`);
  availability.run('availability-product-1', STORE_ID, 'PRODUCT', PRODUCT_ID, NOW);
  availability.run('availability-option-1', STORE_ID, 'PRODUCT_OPTION', OPTION_ID, NOW);

  database.prepare(`INSERT INTO mfos_business_day
    (business_day_id, store_id, business_date, timezone, boundary_local_time, policy_revision, lifecycle_status, opened_at, opened_by_actor_id, revision, note)
    VALUES ('business-day-1', ?, '2026-09-03', 'Asia/Hong_Kong', '05:00', 1, 'OPEN', ?, 'staff-1', 1, NULL)`).run(STORE_ID, NOW);

  const pricing = database.prepare(`INSERT INTO mfos_pricing_profile
    (pricing_profile_id, store_id, subject_type, subject_id, sales_price_context, pricing_mode, currency, fixed_price_minor, lifecycle_status, revision, effective_from, effective_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'DIRECT', 'FIXED', 'HKD', ?, 'ACTIVE', 1, NULL, NULL, ?, ?)`);
  pricing.run('550e8400-e29b-41d4-a716-446655440201', STORE_ID, 'PRODUCT', PRODUCT_ID, 4100, NOW, NOW);
  pricing.run('550e8400-e29b-41d4-a716-446655440202', STORE_ID, 'PRODUCT_OPTION', OPTION_ID, 0, NOW, NOW);
}

const catalogSnapshot = Object.freeze({
  storeId: STORE_ID,
  catalogRevision: 'catalog-minimum-line-1',
  categories: Object.freeze([{
    categoryId: CATEGORY_ID, name: '飯團', lifecycleStatus: 'ACTIVE', position: 1, revision: 1,
    createdAt: NOW, updatedAt: NOW,
  }]),
  products: Object.freeze([{
    productId: PRODUCT_ID, name: '紫米飯團', lifecycleStatus: 'ACTIVE', revision: 1,
    createdAt: NOW, updatedAt: NOW,
    categoryMemberships: Object.freeze([{ categoryId: CATEGORY_ID, position: 1 }]),
    optionGroups: Object.freeze([{
      optionGroupId: GROUP_ID, name: '飯底', selectionMode: 'SINGLE', required: true,
      minSelections: 1, maxSelections: 1, allowQuantities: false, position: 1,
      options: Object.freeze([{ optionId: OPTION_ID, name: '紫米', position: 1, status: 'ACTIVE' }]),
    }]),
  }]),
});

function createReadPort(db) {
  return {
    async listOpen() { throw new Error('MINIMUM_LINE_LIST_NOT_REQUIRED'); },
    async listHistory() { throw new Error('MINIMUM_LINE_LIST_NOT_REQUIRED'); },
    getById: orderId => readD1AcceptedOrderProjection(db, orderId),
  };
}

function smtProvider(resolver) {
  return {
    resolver,
    contextProvider: {
      getAuthorization: () => ({ actorId: 'staff-smt', authorizationContextRef: 'auth-smt', scopeRef: STORE_ID }),
      getDevice: () => null,
      nextRequestId: () => 'smt-read-1',
    },
  };
}

function smmProvider(resolver) {
  return {
    resolver,
    authorization: () => ({ actorId: 'staff-smm', authorizationContextRef: 'auth-smm', scopeRef: STORE_ID }),
    nextRequestId: () => 'smm-read-1',
  };
}

test('minimum operating line correlates one DIRECT submit to one D1 order seen by SMT and SMM', async () => {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  seedAuthorities(sqlite);
  const db = new SqliteD1Adapter(sqlite);
  const catalog = { readActive: async ({ storeId }) => storeId === STORE_ID ? catalogSnapshot : null };

  const gate = createD1DirectOrderFinalGate({
    db,
    catalog,
    now: () => NOW,
    decideAcceptance: async context => {
      assert.equal(context.request.storeId, STORE_ID);
      assert.equal(context.request.payload.totalMinor, 4100);
      assert.equal(context.request.payload.currency, 'HKD');
      const projection = Object.freeze({
        orderId: ORDER_ID,
        orderRevision: 1,
        storeId: STORE_ID,
        lifecycleStatus: 'ACCEPTED',
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        canonicalPayload: context.request.payload,
      });
      return {
        result: { ok: true, orderId: ORDER_ID, orderRevision: 1 },
        acceptanceId: 'acceptance-minimum-line-1',
        recordedAt: NOW,
        event: {
          metadata: { eventId: 'event-minimum-line-1', aggregateId: ORDER_ID, aggregateRevision: 1, eventType: 'ORDER_ACCEPTED', occurredAt: NOW, correlationId: context.request.requestId },
          payload: { orderId: ORDER_ID },
        },
        evidenceRef: 'order:minimum-line-1',
        acceptedOrderProjection: projection,
      };
    },
  });

  const customer = createCustomerDirectOrderService(gate, async () => ({ status: 'unused' }));
  const submitInput = {
    requestId: 'request-minimum-line-1', customerId: CUSTOMER_ID, storeId: STORE_ID,
    submissionId: 'submission-minimum-line-1', idempotencyKey: 'idem-minimum-line-1',
    lines: [{ productId: PRODUCT_ID, quantity: 1, selections: [{ optionGroupId: GROUP_ID, optionId: OPTION_ID }] }],
  };

  const accepted = await customer.submit(submitInput);
  assert.equal(accepted.disposition, 'ACCEPT');
  assert.equal(accepted.orderId, ORDER_ID);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_order_state WHERE order_id = ?').get(ORDER_ID).count, 1);

  const resolver = new InternalPortCompositionResolver();
  const read = createReadPort(db);
  resolver.register(createSmtOrderDetailBinding(read));
  resolver.register(createSmmOrderDetailBinding(read));

  const smt = await readSmtOrderDetail(smtProvider(resolver), { orderId: ORDER_ID, storeId: 'caller-spoof-store' });
  const smm = await readSmmOrderDetail(smmProvider(resolver), { orderId: ORDER_ID, storeId: 'caller-spoof-store' });
  assert.equal(smt?.orderId, ORDER_ID);
  assert.equal(smm?.orderId, ORDER_ID);
  assert.equal(smt?.storeId, STORE_ID);
  assert.equal(smm?.storeId, STORE_ID);
  assert.deepEqual(smt, smm);
  assert.equal(smt?.canonicalPayload.totalMinor, 4100);

  const replay = await customer.submit(submitInput);
  assert.equal(replay.disposition, 'ACCEPT');
  assert.equal(replay.orderId, ORDER_ID);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_order_state').get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM mfos_d1_idempotency WHERE scope='order.acceptance'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM mfos_outbox WHERE domain='ORDER'").get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_order_acceptance_audit').get().count, 1);

  console.log(JSON.stringify({
    source: 'CUSTOMER', orderId: ORDER_ID, storeId: STORE_ID, totalMinor: 4100,
    canonicalD1Rows: 1, smtOrderId: smt.orderId, smmOrderId: smm.orderId,
    idempotentReplayOrderId: replay.orderId,
  }));
  sqlite.close();
});
