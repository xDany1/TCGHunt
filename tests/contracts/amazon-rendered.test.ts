import test from 'node:test';
import assert from 'node:assert/strict';
import { AmazonBrowserProvider, amazonDisplayMoney, normalizeAmazon, mapAmazonDomain } from '@ptcg/adapters';
import { rendered } from '../fixtures/amazon-rendered.js';
import type { AmazonRenderedCapture } from '@ptcg/adapters';
import { pTarget, pContext } from '../fixtures/amazon-providers.js';

async function read(patch: Partial<AmazonRenderedCapture> = {}) {
  return new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return rendered(patch); } }).read(pTarget, pContext);
}
test('rendered projection uses exact Money, live provenance and separate seller/fulfillment', async () => {
  const r = await read(); assert.ok('evidence' in r); const n = normalizeAmazon(r.evidence);
  assert.deepEqual(n.offers[0]?.price, { minor: 129501n, currency: 'MXN' });
  assert.equal(n.offers[0]?.fulfillment, 'AMAZON'); assert.equal(n.offers[0]?.sellerId, 'AUTHOREDSELLER');
  const m = mapAmazonDomain(n, pContext.deliveryScope); const o = m.observations[0]; assert.ok(o);
  assert.equal(o.offer.ref.storeId, 'amazon-mx-m5.4-browser-live'); assert.equal(o.identity.state, 'UNKNOWN');
  assert.equal(o.availableQuantity.state, 'UNKNOWN'); assert.equal(o.shipping.state, 'UNKNOWN');
  assert.match(o.seller.evidence.sourceId, /:BROWSER:live:/);
});
for (const [patch, category] of [
  [{ challenge: true }, 'CHALLENGE_DETECTED'], [{ status: 403 }, 'ACCESS_DENIED'], [{ accessDenied: true }, 'ACCESS_DENIED'],
  [{ status: 404 }, 'PAGE_UNAVAILABLE'], [{ missingProduct: true }, 'PAGE_UNAVAILABLE'], [{ status: 503 }, 'NETWORK_ERROR'],
  [{ asins: ['B0M5WRONG1'] }, 'PARSER_MISMATCH'], [{ asins: ['malformed'] }, 'PARSER_MISMATCH'], [{ titles: [] }, 'PARSER_MISMATCH'], [{ asins: [] }, 'PARSER_MISMATCH'],
  [{ titles: ['one', 'two'] }, 'PARSER_MISMATCH']
] as const) test(`rendered failure ${JSON.stringify(patch)} is typed and has no evidence`, async () => {
  assert.deepEqual(await read(patch), { category });
});
for (const [values, currencies, expected] of [
  [['$95.00'], [], null], [['$95.00'], ['MXN'], { amount: '95.00', currency: 'MXN' }],
  [['MXN 1,295.01'], [], { amount: '1295.01', currency: 'MXN' }], [['1.295,01'], ['MXN'], null],
  [['MX$95.00', 'MX$99.00'], [], null], [['$95.00'], ['USD'], null], [['MX$95.00'], ['MXN', 'USD'], null],
  [['-95.00'], ['MXN'], null], [[], [], null]
] as const) test(`rendered currency/price ambiguity ${JSON.stringify(values)} ${JSON.stringify(currencies)}`, () => {
  assert.deepEqual(amazonDisplayMoney(values, currencies), expected);
});
for (const [availability, expected] of [
  [['Disponible.'], 'AVAILABLE'], [['Actualmente no disponible.'], 'UNAVAILABLE'], [['In stock'], 'AVAILABLE'],
  [['Disponible', 'Actualmente no disponible'], 'UNKNOWN'], [['Solo quedan 2'], 'UNKNOWN'], [[], 'UNKNOWN']
] as const) test(`rendered stock ${JSON.stringify(availability)} remains conservative`, async () => {
  const r = await read({ availability }); assert.ok('evidence' in r); assert.equal(normalizeAmazon(r.evidence).offers[0]?.availability, expected);
});
test('missing seller ID does not fabricate durable offer identity from Amazon fulfillment', async () => {
  const r = await read({ sellerIds: [], sellers: ['Amazon'] }); assert.ok('evidence' in r);
  const n = normalizeAmazon(r.evidence); assert.equal(n.offers[0]?.sellerId, null); assert.equal(mapAmazonDomain(n, pContext.deliveryScope).observations.length, 0);
});
test('unknown selected ASIN is not automatically a concrete variant', async () => {
  const r = await read({ selectedAsin: false }); assert.ok('evidence' in r); assert.equal(mapAmazonDomain(normalizeAmazon(r.evidence), pContext.deliveryScope).observations.length, 0);
});
test('conflicting shipper and seller evidence remain unknown', async () => {
  const r = await read({ shippers: ['Amazon', 'Other'], sellerIds: ['A', 'B'] }); assert.ok('evidence' in r);
  const n = normalizeAmazon(r.evidence); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN'); assert.equal(n.offers[0]?.sellerId, null);
});
test('late and oversized rendered capture cannot enter normalization', async () => {
  await assert.rejects(read({ capturedAt: pContext.deadlineAt }), /CONTEXT_MISMATCH/);
  await assert.rejects(read({ titles: ['x'.repeat(501)] }), /BODY_TOO_LARGE/);
});
