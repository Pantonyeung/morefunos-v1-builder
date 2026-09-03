import assert from 'node:assert/strict';
import test from 'node:test';
import { InternalPortCompositionResolver } from '../source/packages/internal-port-runtime/composition.ts';
import { DirectOrderFinalGate, validateDirectCatalogIntent } from '../source/packages/order/direct-order-final-gate.ts';
import { createStaffDirectOrderBindings, createCustomerDirectOrderService, STAFF_DIRECT_ORDER_SUBMIT_V1 } from '../source/packages/order/direct-order-bindings.ts';
import { D1FixedPricingAuthority } from '../source/packages/pricing/d1-pricing-authority.ts';

const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440001';
const CATEGORY_ID = '550e8400-e29b-41d4-a716-446655440002';
const GROUP_ID = '550e8400-e29b-41d4-a716-446655440003';
const OPTION_ID = '550e8400-e29b-41d4-a716-446655440004';
const STALE_OPTION_ID = '550e8400-e29b-41d4-a716-446655440099';
const CREATED_AT = '2026-09-01T00:00:00.000Z';

const projectedMenu = Object.freeze({
  storeId: 'store-1',
  catalogRevision: 'catalog-7',
  categories: Object.freeze([{ categoryId: CATEGORY_ID, name: '飯團', position: 1, revision: 1 }]),
  products: Object.freeze([{
    productId: PRODUCT_ID, name: '飯團', revision: 2,
    categoryMemberships: Object.freeze([{ categoryId: CATEGORY_ID, position: 1 }]),
    optionGroups: Object.freeze([{
      optionGroupId: GROUP_ID, name: '飯底', selectionMode: 'SINGLE', required: true,
      minSelections: 1, maxSelections: 1, allowQuantities: false, position: 1,
      options: Object.freeze([{ optionId: OPTION_ID, name: '紫米', position: 1 }]),
    }]),
  }]),
});

const rawCatalogSnapshot = Object.freeze({
  storeId: 'store-1',
  catalogRevision: 'catalog-7',
  categories: Object.freeze([{
    categoryId: CATEGORY_ID, name: '飯團', lifecycleStatus: 'ACTIVE', position: 1, revision: 1,
    createdAt: CREATED_AT, updatedAt: CREATED_AT,
  }]),
  products: Object.freeze([{
    productId: PRODUCT_ID, name: '飯團', lifecycleStatus: 'ACTIVE', revision: 2,
    createdAt: CREATED_AT, updatedAt: CREATED_AT,
    categoryMemberships: Object.freeze([{ categoryId: CATEGORY_ID, position: 1 }]),
    optionGroups: Object.freeze([{
      optionGroupId: GROUP_ID, name: '飯底', selectionMode: 'SINGLE', required: true,
      minSelections: 1, maxSelections: 1, allowQuantities: false, position: 1,
      options: Object.freeze([{ optionId: OPTION_ID, name: '紫米', position: 1, status: 'ACTIVE' }]),
    }]),
  }]),
});

const catalog = { readActive: async () => rawCatalogSnapshot };
const pricing = {
  quote: async ({storeId, consumerChannel, lines}) => Object.freeze({
    storeId, salesPriceContext: 'DIRECT', currency: 'HKD', totalMinor: 4100,
    pricingRevisionOrRuleProvenance: Object.freeze(['price-profile@3']),
    lines: Object.freeze(lines.map(line => Object.freeze({
      lineId: line.lineId, currency: 'HKD', quantity: line.quantity, listUnitPriceMinor: 4100,
      adjustments: Object.freeze([]), finalUnitPriceMinor: 4100, lineTotalMinor: 4100 * line.quantity,
      pricingRevisionOrRuleProvenance: Object.freeze([`price:${consumerChannel}@3`]),
    }))),
  }),
};
const allow = (name) => ({ disposition: 'ALLOW', reasonCode: `${name}_ALLOW`, evidenceRef: `${name}:1`, authorityRevision: 1 });

function gate(overrides = {}) {
  return new DirectOrderFinalGate({
    catalog, pricing,
    evaluateStore: async () => allow('store'),
    evaluateBusinessDay: async () => allow('day'),
    evaluateAvailability: async () => allow('availability'),
    acceptOrder: async () => ({ disposition: 'ACCEPTED', orderId: 'order-1', canonicalRevision: 1, evidenceRef: 'order:1' }),
    readAcceptedOrder: async () => ({ orderId: 'order-1' }),
    now: () => '2026-09-03T03:00:00.000Z',
    ...overrides,
  });
}

const intent = Object.freeze({
  requestId: 'request-1', idempotencyKey: 'idem-1',
  lines: Object.freeze([{ lineId: 'line-1', productId: PRODUCT_ID, quantity: 1, selections: Object.freeze([{ optionGroupId: GROUP_ID, optionId: OPTION_ID }]) }]),
});

test('r8 catalog validator fails closed for stale option and required group', () => {
  assert.doesNotThrow(() => validateDirectCatalogIntent(projectedMenu, intent.lines));
  assert.throws(() => validateDirectCatalogIntent(projectedMenu, [{ lineId:'x', productId:PRODUCT_ID, quantity:1, selections:[] }]), /DIRECT_ORDER_REQUIRED_GROUP_MISSING/);
  assert.throws(() => validateDirectCatalogIntent(projectedMenu, [{ lineId:'x', productId:PRODUCT_ID, quantity:1, selections:[{optionGroupId:GROUP_ID,optionId:STALE_OPTION_ID}] }]), /DIRECT_ORDER_OPTION_NOT_ACTIVE/);
});

test('r8 shared gate keeps canonical pricing and existing intake authorities authoritative', async () => {
  let acceptanceContext;
  const result = await gate({ acceptOrder: async context => { acceptanceContext = context; return { disposition:'ACCEPTED', orderId:'order-1', canonicalRevision:1, evidenceRef:'order:1' }; } }).submit(intent, { storeId:'store-1', actorId:'customer-1', customerId:'customer-1', port:'CUS' });
  assert.equal(result.disposition, 'ACCEPT');
  assert.equal(acceptanceContext.request.payload.totalMinor, 4100);
  assert.deepEqual(acceptanceContext.authorityEvidenceRefs, ['store:1','day:1','availability:1']);
  const blocked = await gate({ evaluateBusinessDay: async () => ({disposition:'DENY',reasonCode:'BUSINESS_DAY_CLOSED',evidenceRef:'day:closed'}) }).submit(intent, { storeId:'store-1', actorId:'staff-1', port:'SMT' });
  assert.notEqual(blocked.disposition, 'ACCEPT');
});

test('r8 post-commit signal failure cannot erase accepted canonical D1-equivalent result', async () => {
  const result = await gate({ signalCommitted: async () => { throw new Error('signal down'); } }).submit(intent, { storeId:'store-1', actorId:'staff-1', port:'SMM' });
  assert.equal(result.disposition, 'ACCEPT');
  assert.equal(result.orderId, 'order-1');
});

test('r8 SMT/SMM bindings derive store and actor from trusted authorization, not body', async () => {
  const seen = [];
  const fakeGate = { submit: async (i,c) => { seen.push({i,c}); return {disposition:'REJECT',stage:'REQUEST',reasonCode:'TEST',evidenceRefs:[]}; } };
  const resolver = new InternalPortCompositionResolver();
  for (const binding of createStaffDirectOrderBindings(fakeGate)) resolver.register(binding);
  for (const port of ['SMT','SMM']) {
    await resolver.invoke(port, STAFF_DIRECT_ORDER_SUBMIT_V1.operationId, {submissionId:'s',idempotencyKey:'i',lines:intent.lines}, {port,requestId:`r-${port}`,authorization:{actorId:'staff-real',authorizationContextRef:'auth',scopeRef:'store-real'}});
  }
  assert.deepEqual(seen.map(x => [x.c.port,x.c.storeId,x.c.actorId]), [['SMT','store-real','staff-real'],['SMM','store-real','staff-real']]);
});

test('r8 Customer service uses same gate with CUS trusted context', async () => {
  let seen;
  const fakeGate = { submit: async (i,c) => { seen={i,c}; return {disposition:'REJECT',stage:'REQUEST',reasonCode:'TEST',evidenceRefs:[]}; } };
  const service = createCustomerDirectOrderService(fakeGate, async () => ({status:'ok'}));
  await service.submit({requestId:'cus-r',customerId:'customer-real',storeId:'store-real',submissionId:'sub',idempotencyKey:'idem',lines:[{productId:PRODUCT_ID,quantity:1,selections:[{optionGroupId:GROUP_ID,optionId:OPTION_ID}]}]});
  assert.equal(seen.c.port,'CUS'); assert.equal(seen.c.storeId,'store-real'); assert.equal(seen.c.customerId,'customer-real');
});

test('r8 D1 pricing fails closed on missing and preserves canonical active fixed price', async () => {
  const rows = [{pricing_profile_id:'550e8400-e29b-41d4-a716-446655440000',subject_type:'PRODUCT',subject_id:PRODUCT_ID,sales_price_context:'DIRECT',pricing_mode:'FIXED',currency:'HKD',fixed_price_minor:4100,lifecycle_status:'ACTIVE',revision:3,effective_from:null,effective_to:null,created_at:CREATED_AT,updated_at:CREATED_AT}];
  class Statement { constructor(rows){this.rows=rows} bind(){return this} async all(){return {success:true,results:this.rows}} }
  class DB { constructor(rows){this.rows=rows} prepare(){return new Statement(this.rows)} async batch(){return []} }
  const authority = new D1FixedPricingAuthority(new DB(rows));
  const resolved = await authority.resolve({storeId:'store-1',salesPriceContext:'DIRECT',subjectType:'PRODUCT',subjectId:rows[0].subject_id,at:'2026-09-03T03:00:00.000Z'});
  assert.equal(resolved.ok,true); if(resolved.ok) assert.equal(resolved.finalPriceMinor,4100);
  const missing = await new D1FixedPricingAuthority(new DB([])).resolve({storeId:'store-1',salesPriceContext:'DIRECT',subjectType:'PRODUCT',subjectId:rows[0].subject_id,at:'2026-09-03T03:00:00.000Z'});
  assert.equal(missing.ok,false);
});
