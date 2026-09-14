import test from 'node:test';
import assert from 'node:assert/strict';
import { ref, refKey } from '@ptcg/core';
import { AuthorizedEvidenceAdapter, kantocardsUrl, normalizeKantocardsCapture, normalizeKantocardsSummary } from '@ptcg/adapters';
import { authoredCapture, DELIVERY, liveSummary, primary, secondary, START } from '../fixtures/kantocards.js';

test('reported live product/variant IDs retain original provenance without invented response fields', () => {
  const e = normalizeKantocardsSummary(liveSummary, DELIVERY); const o = e.observation;
  assert.equal(o.product.ref.externalId, '9600895451379'); assert.equal(o.variant.ref.externalId, '49183411208435');
  assert.equal(e.catalog.evidenceBasis, 'USER_SUPPLIED_LIVE_SUMMARY'); assert.equal(e.catalog.store.accessMode, 'AUTHORIZED_VALIDATION');
  assert.equal(e.catalog.store.retention, 'VALIDATION_EVIDENCE_ONLY'); assert.equal(e.catalog.store.currency, null);
  for (const field of [o.identity, o.seller, o.unitPrice, o.stock, o.availableQuantity, o.shipping, o.additionalTax]) {
    assert.equal(field.state, 'UNKNOWN'); assert.equal(field.evidence.rights, 'PERMITTED');
    assert.equal(field.evidence.capturedAt, START); assert.equal(field.evidence.receivedAt, START + 222);
    assert.equal(field.evidence.parserVersion, 'm3.5-summary-1');
    assert.match(field.evidence.captureId, /^reported-live-summary:/);
  }
  assert.equal(e.catalog.sku, null); assert.equal(e.catalog.saleAvailable, null); assert.deepEqual(e.catalog.options, []);
  assert.equal(o.product.title, ''); assert.equal(o.offer.condition, 'UNKNOWN');
  assert.deepEqual(normalizeKantocardsSummary(liveSummary, DELIVERY), e);
  assert.ok(Object.isFrozen(e.observation.offer));
});
test('both authorized locators share StoreInstance; tracking and collection paths never change resolution', () => {
  for (const url of [primary, secondary]) {
    const tracked = url.replace('/products/', '/collections/booster-sueltos/products/') + '?_pos=1&_fid=71e317a0e&_ss=c';
    assert.deepEqual(kantocardsUrl(tracked), kantocardsUrl(url));
    assert.deepEqual(kantocardsUrl(tracked.replace('_pos=1', '_pos=999').replace('71e317a0e', 'different')), kantocardsUrl(url));
  }
  assert.equal(kantocardsUrl(primary).storeId, kantocardsUrl(secondary).storeId);
  assert.notEqual(kantocardsUrl(primary).handle, kantocardsUrl(secondary).handle);
  assert.equal(kantocardsUrl(primary + '?variant=49183411208435&_ss=c').variantId, '49183411208435');
});
test('authorized locator rejects host confusion, unapproved paths, hidden traversal and arbitrary queries', () => {
  for (const url of ['http://kantocards.com/products/x', primary.replace('kantocards.com', 'kantocards.com.evil.invalid'), primary.replace('kantocards.com', 'user@kantocards.com'), primary + '?redirect=x', primary + '?variant=1&variant=2', primary.replace('/products/', '/private/../products/'), primary.replace('/products/', '/%2e%2e/products/'), primary.replace('/products/', '/cart/')]) assert.throws(() => kantocardsUrl(url));
});
test('summary ingestion rejects untrusted IDs and incompatible success metadata', () => {
  for (const patch of [{ productId: 9600895451379 }, { productId: 'gid://shopify/Product/1' }, { variantIds: ['01'] }, { variantIds: ['1', '2'] }, { status: 'PASS' }]) assert.throws(() => normalizeKantocardsSummary({ ...liveSummary, ...patch }, DELIVERY));
  for (const patch of [{ host: 'other.invalid' }, { method: 'GET' }, { status: 429 }, { apiVersion: '2026-04' }, { deprecated: true }, { receivedAt: START - 1 }, { bytes: 65537 }]) assert.throws(() => normalizeKantocardsSummary({ ...liveSummary, requests: [{ ...liveSummary.requests[0], ...patch }] }, DELIVERY));
});
test('snapshot adapter rejects context mismatch/cancellation and does not renew old source time', async () => {
  const e = normalizeKantocardsSummary(liveSummary, DELIVERY); const adapter = new AuthorizedEvidenceAdapter(e);
  const context = { now: START + 90000, deadlineAt: START + 95000, operationId: 'summary-replay', traceId: 'local-test', currency: 'MXN' as const, deliveryScope: DELIVERY, sourceReference: primary };
  const read = await adapter.observe(e.observation.offer.ref, context);
  assert.ok(read.ok); assert.equal(read.observation.identity.evidence.capturedAt, START); assert.equal(read.completedAt, undefined);
  assert.deepEqual(adapter.descriptor.capabilities, ['OBSERVATION']);
  assert.equal(adapter.health(START + 222).state, 'UNAVAILABLE'); assert.equal(adapter.health(START + 222).lastSuccessAt, null);
  for (const patch of [{ cancellation: { aborted: true } }, { deadlineAt: context.now }, { deliveryScope: 'elsewhere' }, { sourceReference: secondary }, { sourceReference: primary + '?variant=1' }]) assert.equal((await adapter.observe(e.observation.offer.ref, { ...context, ...patch })).ok, false);
  assert.equal((await adapter.observe(ref(e.observation.offer.ref.storeId, 'offer', 'different'), context)).ok, false);
});
test('authored tokenless shape retains exact decimal money and sale flag while quantity/identity/cost stay unknown', () => {
  const e = authoredCapture().normalized(); const o = e.observation;
  assert.equal(o.unitPrice.state === 'KNOWN' && o.unitPrice.value.minor, 1234n);
  assert.equal(o.unitPrice.state === 'KNOWN' && o.unitPrice.value.currency, 'MXN');
  assert.equal(e.catalog.saleAvailable, true); assert.equal(o.stock.state, 'UNKNOWN'); assert.equal(o.availableQuantity.state, 'UNKNOWN');
  assert.equal(o.identity.state, 'UNKNOWN'); assert.equal(o.offer.condition, 'UNKNOWN'); assert.equal(o.shipping.state, 'UNKNOWN'); assert.equal(o.additionalTax.state, 'UNKNOWN');
  assert.equal(o.seller.state === 'KNOWN' && o.seller.value.ref.storeId, e.catalog.store.id);
});
test('full capture bridge checks body size, API metadata and returned merchant domain/name', () => {
  const c = authoredCapture();
  assert.throws(() => normalizeKantocardsCapture(c.body, { ...c.metadata, bytes: 1 }, primary, DELIVERY));
  assert.throws(() => authoredCapture(false, START, {}, { primaryDomain: { host: 'other.invalid' } }).normalized());
  assert.throws(() => authoredCapture(false, START, {}, { name: 'Other merchant' }).normalized());
  assert.throws(() => normalizeKantocardsCapture(c.body, c.metadata, secondary, DELIVERY));
  assert.throws(() => normalizeKantocardsCapture(c.body, c.metadata, primary + '?variant=999', DELIVERY));
});
test('authored price/stock changes append evidence without changing scoped offer identity', () => {
  const first = authoredCapture().normalized(); const repeat = authoredCapture(false, START + 5000, { price: { amount: '99.99', currencyCode: 'MXN' }, availableForSale: false, sku: null }).normalized();
  assert.equal(refKey(first.observation.offer.ref), refKey(repeat.observation.offer.ref));
  assert.notEqual(first.observation.id, repeat.observation.id); assert.equal(repeat.catalog.sku, null);
  assert.equal(repeat.observation.stock.state === 'KNOWN' && repeat.observation.stock.value, 'OUT_OF_STOCK');
  const second = authoredCapture(true).normalized();
  for (const entity of ['product', 'variant', 'listing', 'offer'] as const) assert.notEqual(refKey(first.observation[entity].ref), refKey(second.observation[entity].ref));
  assert.deepEqual(first.observation.offer.sellerRef, second.observation.offer.sellerRef);
});
test('authored multiple variants require explicit selection and pagination never silently truncates', () => {
  const c = authoredCapture(); const payload = JSON.parse(c.body);
  payload.data.product.variants.nodes.push({ ...payload.data.product.variants.nodes[0], id: 'gid://shopify/ProductVariant/203' });
  const body = JSON.stringify(payload); const m = { ...c.metadata, bytes: Buffer.byteLength(body) };
  assert.throws(() => normalizeKantocardsCapture(body, m, primary, DELIVERY));
  const first = normalizeKantocardsCapture(body, m, primary + '?variant=201', DELIVERY);
  const second = normalizeKantocardsCapture(body, m, primary + '?variant=203&_pos=2', DELIVERY);
  assert.notDeepEqual(first.observation.variant.ref, second.observation.variant.ref);
  payload.data.product.variants.pageInfo.hasNextPage = true;
  const truncated = JSON.stringify(payload);
  assert.throws(() => normalizeKantocardsCapture(truncated, { ...m, bytes: Buffer.byteLength(truncated) }, primary + '?variant=201', DELIVERY));
});
test('live evidence health uses capture success timestamps and degrades on source age', () => {
  const e = authoredCapture().normalized(); const adapter = new AuthorizedEvidenceAdapter(e);
  assert.equal(adapter.health(START + 222).state, 'HEALTHY'); assert.equal(adapter.health(START + 222).lastSuccessAt, START + 222);
  assert.equal(adapter.health(START + 60001).state, 'DEGRADED');
  const c = authoredCapture(); const aged = normalizeKantocardsCapture(c.body, { ...c.metadata, age: '70' }, primary, DELIVERY);
  assert.equal(new AuthorizedEvidenceAdapter(aged).health(START + 222).state, 'DEGRADED');
});
