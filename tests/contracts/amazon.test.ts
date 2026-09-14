import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProduct, refKey, validateSeller } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import { amazonAsin, amazonUrl, AmazonQualificationAdapter, classifyAmazonSeller, parseAmazonOffers, qualifyAmazonFixture } from '@ptcg/adapters';
import { amazonFixtures as f, amazonMonitor, ambiguityCases, ASIN, CHILD, PARENT, RETAIL, THIRD, catalog, context, offer, response, review } from '../fixtures/amazon.js';

for (const input of [ASIN.toLowerCase(), `https://amazon.com.mx/dp/${ASIN}?ref=x&tag=tracking#detail`, `https://www.amazon.com.mx/name/dp/${ASIN}/ref=sr_1?th=1&psc=1`, `https://m.amazon.com.mx/gp/aw/d/${ASIN}`, `https://www.amazon.com.mx/gp/product/${ASIN}?_pos=1&_fid=tracking&_ss=c`]) {
  test(`Amazon locator normalizes ${input}`, () => assert.deepEqual(amazonUrl(input), { asin: ASIN, canonical: `https://www.amazon.com.mx/dp/${ASIN}` }));
}
for (const input of ['B123', 'B0M5FIX00!', `http://amazon.com.mx/dp/${ASIN}`, `https://amazon.com.mx.evil.invalid/dp/${ASIN}`, `https://amazon.com/dp/${ASIN}`, `https://user:password@amazon.com.mx/dp/${ASIN}`, `https://amazon.com.mx:444/dp/${ASIN}`, `https://amazon.com.mx/cart/${ASIN}`, `https://amzn.to/${ASIN}`, `https://amazon.com.mx/dp/${ASIN}?smid=OTHER`]) {
  test(`Amazon rejects unsafe/unsupported locator ${input}`, () => assert.throws(() => amazonUrl(input), ReadFailure));
}
test('ASIN is stable and identifiers are scoped; invalid ASIN is rejected', () => {
  assert.equal(amazonAsin(ASIN.toLowerCase()), ASIN); assert.throws(() => amazonAsin(null), ReadFailure);
  const a = qualifyAmazonFixture(ASIN, f.retailInStock, context, review); const b = qualifyAmazonFixture(ASIN, f.priceChange, context, review);
  assert.deepEqual(a.productRef, b.productRef); assert.deepEqual(a.observations[0]?.offer.ref, b.observations[0]?.offer.ref); assert.notEqual(a.observations[0]?.id, b.observations[0]?.id);
  assert.equal(a.observations[0]?.unitPrice.state, 'KNOWN'); if (a.observations[0]?.unitPrice.state === 'KNOWN') assert.deepEqual(a.observations[0].unitPrice.value, { minor: 9501n, currency: 'MXN' });
});
test('money parsing preserves the JSON decimal lexeme without rounding', () => {
  const body = f.retailInStock.offersBody.replace('95.01', '89999999999999.99');
  assert.equal(parseAmazonOffers(body, ASIN)[0]?.price?.minor, 8999999999999999n);
  for (const token of ['0.001', '-1', '1e3', '90000000000000.01', '"95.01"']) assert.throws(() => parseAmazonOffers(f.retailInStock.offersBody.replace('95.01', token), ASIN), ReadFailure);
  assert.throws(() => parseAmazonOffers(f.retailInStock.offersBody.replaceAll('MXN', 'USD'), ASIN), ReadFailure);
});
test('child is an independent product with singleton variant; parent is catalog-only', () => {
  const child = qualifyAmazonFixture(CHILD, f.child, context); const parent = qualifyAmazonFixture(PARENT, f.parent, context);
  assert.deepEqual(child.product.parents, [PARENT]); assert.equal(child.productRef.externalId, CHILD); assert.equal(child.observations[0]?.variant.productRef.externalId, CHILD);
  assert.deepEqual(parent.product.children, [ASIN, CHILD]); assert.equal(parent.state, 'PARENT_ONLY'); assert.equal(parent.observations.length, 0);
  assert.throws(() => qualifyAmazonFixture(ASIN, f.child, context), ReadFailure);
});
test('multiple sellers share detail listing, but offers and sellers stay distinct', () => {
  const q = qualifyAmazonFixture(ASIN, f.multipleOffers, context, review); assert.equal(q.observations.length, 2);
  assert.deepEqual(q.observations[0]?.listing, q.observations[1]?.listing);
  assert.notDeepEqual(q.observations[0]?.offer.ref, q.observations[1]?.offer.ref); assert.notDeepEqual(q.observations[0]?.offer.sellerRef, q.observations[1]?.offer.sellerRef);
});
test('retail classification needs reviewed seller IDs; FBA and reputation never approve a merchant', () => {
  const retail = qualifyAmazonFixture(ASIN, f.retailInStock, context); const third = qualifyAmazonFixture(ASIN, f.thirdPartyUnreviewed, context);
  assert.ok(retail.offers[0]); assert.ok(third.offers[0]); assert.equal(classifyAmazonSeller(retail.offers[0], [RETAIL]), 'AMAZON_RETAIL');
  assert.equal(classifyAmazonSeller(retail.offers[0], []), 'OTHER_IDENTIFIED'); assert.equal(classifyAmazonSeller(third.offers[0], [RETAIL]), 'OTHER_IDENTIFIED');
  assert.ok(third.observations[0]); assert.equal(validateSeller(third.observations[0], amazonMonitor().definition.configuration.sellerPolicy, context.now).result, 'REVIEW_REQUIRED');
  assert.equal(third.observations[0].offer.sellerRef.externalId, THIRD); assert.equal(third.observations[0].fulfilledBy.state, 'KNOWN');
});
test('fulfillment change preserves seller and listing, changes offer binding', () => {
  const a = qualifyAmazonFixture(ASIN, f.thirdPartyFba, context); const b = qualifyAmazonFixture(ASIN, f.thirdPartyMfn, context);
  assert.deepEqual(a.observations[0]?.offer.sellerRef, b.observations[0]?.offer.sellerRef); assert.deepEqual(a.observations[0]?.listing, b.observations[0]?.listing);
  assert.notDeepEqual(a.observations[0]?.offer.ref, b.observations[0]?.offer.ref); assert.notDeepEqual(a.observations[0]?.fulfilledBy, b.observations[0]?.fulfilledBy);
});
test('Amazon manual policy revision can approve a merchant; deny takes precedence', () => {
  const o = qualifyAmazonFixture(ASIN, f.thirdPartyFba, context, review).observations[0]; assert.ok(o);
  const policy = amazonMonitor().definition.configuration.sellerPolicy;
  const approved = { ...policy, version: 'review-v2', allow: [o.offer.sellerRef] };
  assert.equal(validateSeller(o, approved, context.now).result, 'APPROVED');
  assert.equal(validateSeller(o, { ...approved, deny: [o.offer.sellerRef] }, context.now).result, 'REJECTED');
});
test('late Amazon fixture reads cannot refresh seller approval or source timestamps', () => {
  const later = { ...context, now: context.now + 60001, deadlineAt: context.deadlineAt + 60001 };
  const o = qualifyAmazonFixture(ASIN, f.retailInStock, later, review).observations[0]; assert.ok(o);
  assert.equal(o.seller.evidence.sourceObservedAt, f.retailInStock.sourceObservedAt);
  assert.equal(validateSeller(o, amazonMonitor().definition.configuration.sellerPolicy, later.now).result, 'REVIEW_REQUIRED');
});
test('a sealed-condition review changes offer binding without changing product identity', () => {
  const a = qualifyAmazonFixture(ASIN, f.retailInStock, context); const b = qualifyAmazonFixture(ASIN, f.retailInStock, context, review);
  assert.deepEqual(a.productRef, b.productRef); assert.notDeepEqual(a.observations[0]?.offer.ref, b.observations[0]?.offer.ref);
});
for (const name of ['unknownShipping', 'missingPrice', 'missingFulfillment', 'incompleteAvailability', 'preorder', 'retailUnavailable'] as const) {
  test(`Amazon conservatively normalizes ${name}`, () => {
    const o = qualifyAmazonFixture(ASIN, f[name], context, review).observations[0]; assert.ok(o);
    assert.equal(o.shipping.state, 'UNKNOWN'); assert.equal(o.additionalTax.state, 'UNKNOWN'); assert.equal(o.availableQuantity.state, 'UNKNOWN'); assert.equal(o.purchaseLimit.state, 'UNKNOWN');
    if (name === 'missingPrice') assert.equal(o.unitPrice.state, 'UNKNOWN');
    if (name === 'missingFulfillment') assert.equal(o.fulfilledBy.state, 'UNKNOWN');
    if (['incompleteAvailability', 'preorder', 'retailUnavailable'].includes(name)) assert.equal(o.stock.state, 'UNKNOWN');
  });
}
test('no offer and unidentified seller never fabricate observations or purchasable references', () => {
  const empty = qualifyAmazonFixture(ASIN, f.noOffer, context); const missing = qualifyAmazonFixture(ASIN, f.missingSeller, context);
  assert.equal(empty.state, 'NO_OFFER_IN_RESPONSE'); assert.equal(missing.state, 'SELLER_UNIDENTIFIED'); assert.equal(empty.observations.length + missing.observations.length, 0);
  assert.ok(missing.offers[0]); assert.equal(classifyAmazonSeller(missing.offers[0], [RETAIL]), 'UNIDENTIFIED');
});
test('offer presence cycle retains product identity; absence is scoped, not a global out-of-stock fact', () => {
  const sequence = [f.retailInStock, f.noOffer, f.retailInStock].map(c => qualifyAmazonFixture(ASIN, c, context));
  assert.equal(new Set(sequence.map(q => refKey(q.productRef))).size, 1);
  assert.deepEqual(sequence.map(q => q.state), ['OFFERS_OBSERVED', 'NO_OFFER_IN_RESPONSE', 'OFFERS_OBSERVED']);
  assert.deepEqual(sequence[0]?.observations[0]?.offer.ref, sequence[2]?.observations[0]?.offer.ref);
});
for (const [name, title, identityPatch] of ambiguityCases) {
  test(`Pokémon identity remains unreviewed: ${name}`, () => {
    const c = response([offer()], catalog(ASIN, { summaries: [{ marketplaceId: 'A1AM78C64UM0Y8', itemName: title }], attributes: { authoredIdentifierMeaning: { ...review.identity, ...identityPatch } } }));
    const o = qualifyAmazonFixture(ASIN, c, context).observations[0]; assert.ok(o); assert.equal(o.identity.state, 'UNKNOWN'); assert.equal(o.offer.condition, 'UNKNOWN');
    const m = amazonMonitor(c, true, false).definition.configuration;
    assert.notEqual(matchProduct(m.target, o, m.mapping).checks.every(c => c.status === 'PASS'), true);
  });
}
test('reviewed wrong language and count cannot match the canonical target', () => {
  const o = qualifyAmazonFixture(ASIN, f.retailInStock, context, { ...review, identity: { ...review.identity, language: 'en', packUnits: 36 } }).observations[0]; assert.ok(o);
  const m = amazonMonitor().definition.configuration; assert.ok(matchProduct(m.target, o, m.mapping).checks.some(c => c.status === 'FAIL'));
});
test('duplicate rows deduplicate only when normalized terms agree', () => {
  assert.equal(qualifyAmazonFixture(ASIN, response([offer(), offer()]), context).observations.length, 1);
  assert.throws(() => qualifyAmazonFixture(ASIN, response([offer(), offer({ ListingPrice: { Amount: 90, CurrencyCode: 'MXN' } })]), context), ReadFailure);
  assert.deepEqual(qualifyAmazonFixture(ASIN, f.duplicateObservation, context), qualifyAmazonFixture(ASIN, f.retailInStock, context));
});
for (const [name, code] of [['malformed', 'MALFORMED_RESPONSE'], ['authFailure', 'AUTH_REQUIRED'], ['throttled', 'RATE_LIMITED'], ['timeout', 'DEADLINE_EXCEEDED'], ['networkFailure', 'TRANSIENT_FAILURE']] as const) {
  test(`Amazon typed failure ${name} does not become no-offer`, async () => {
    const a = new AmazonQualificationAdapter(f[name]); const result = await a.resolve(ASIN, context); assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.error.code, code); assert.equal(result.error.externalEffect, 'NOT_SENT'); if (name === 'throttled') assert.equal(result.error.retryAfterMs, 10000); }
  });
}
test('non-2xx, malformed schema, oversized body, mismatched scope and cancellation fail safely', async () => {
  for (const [status, code] of [[403, 'AUTH_REQUIRED'], [404, 'LISTING_NOT_FOUND'], [302, 'BLOCKED'], [503, 'TRANSIENT_FAILURE']] as const) {
    const r = await new AmazonQualificationAdapter(response([], catalog(), { status })).resolve(ASIN, context); assert.ok(!r.ok); assert.equal(r.error.code, code);
  }
  for (const body of ['{}', '{"payload":{"status":"Success"}}', f.retailInStock.offersBody.replace('"Offers":', '"missing":'), f.retailInStock.offersBody.replace('"NOW"', '12')]) {
    if (body.includes('availabilityType":12')) { assert.equal(parseAmazonOffers(body, ASIN)[0]?.availability, 'UNKNOWN'); continue; }
    assert.throws(() => parseAmazonOffers(body, ASIN), ReadFailure);
  }
  assert.throws(() => parseAmazonOffers(' '.repeat(100001), ASIN), ReadFailure);
  assert.throws(() => qualifyAmazonFixture(ASIN, f.retailInStock, { ...context, deliveryScope: 'different' }), ReadFailure);
  assert.throws(() => qualifyAmazonFixture(ASIN, f.retailInStock, { ...context, cancellation: { aborted: true } }), ReadFailure);
});
test('capability exposes resolution/observation only, never selects or substitutes an offer', async () => {
  const a = new AmazonQualificationAdapter(f.multipleOffers); assert.equal(a.liveAccess, 'AUTH_BLOCKED');
  assert.deepEqual(a.descriptor.capabilities, ['RESOLUTION', 'OBSERVATION']); assert.equal(a.descriptor.automationLevel, 'OBSERVE_ONLY');
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(a)).sort(), ['constructor', 'observe', 'resolve']);
  const resolved = await a.resolve(ASIN, context); assert.ok(resolved.ok); assert.equal(resolved.resolution.selectedOffer, null);
  const o = qualifyAmazonFixture(ASIN, f.retailInStock, context).observations[0]; assert.ok(o);
  assert.ok(!(await new AmazonQualificationAdapter(f.sellerChange).observe(o.offer.ref, context)).ok);
});
