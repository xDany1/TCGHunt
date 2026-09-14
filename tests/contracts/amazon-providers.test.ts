import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AmazonBusinessApiProvider, AmazonBrowserProvider, AmazonObservationService, normalizeAmazon, mapAmazonDomain } from '@ptcg/adapters';
import type { AmazonProviderConfig, AmazonProviderResult } from '@ptcg/adapters';
import { ReadFailure } from '@ptcg/application';
import { ref, validateSeller } from '@ptcg/core';
import { apiProvider, browserProvider, businessCapture, businessFixtures, businessOffer, businessProduct, htmlCapture, htmlNames, pContext, pReview, pService, pTarget, P_ASIN, P_CHILD, P_NOW, P_RETAIL, P_SCOPE, P_THIRD } from '../fixtures/amazon-providers.js';

function evidence(result: AmazonProviderResult) { assert.ok('evidence' in result); return result.evidence; }
for (const [name, fixture] of Object.entries(businessFixtures)) {
  test(`Business documented fixture: ${name}`, async () => {
    const service = pService('BUSINESS_API', fixture, name !== 'child'); const r = await service.resolve(fixture.target.asin, pContext);
    const errors: Record<string, string> = { malformed: 'MALFORMED_RESPONSE', auth: 'AUTH_REQUIRED', throttled: 'RATE_LIMITED', timeout: 'DEADLINE_EXCEEDED', network: 'TRANSIENT_FAILURE' };
    const code = errors[name];
    if (code) { assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.error.code, code); assert.equal(r.error.externalEffect, 'NOT_SENT'); } return; }
    assert.ok(r.ok); assert.equal(r.resolution.selectedOffer, null);
    const q = await service.inspect(fixture.target.asin, pContext); assert.equal(q.normalized.asin, fixture.target.asin); assert.equal(q.normalized.source.provider, 'BUSINESS_API');
    const o = q.normalized.offers[0];
    if (['parent', 'noOffer', 'missingSeller'].includes(name)) assert.equal(q.observations.length, 0);
    if (name === 'multiple') assert.equal(q.normalized.offers.length, 2);
    if (name === 'parent') assert.deepEqual(q.normalized.childAsins, [P_CHILD]);
    if (name === 'child') assert.equal(q.normalized.asinType, 'VARIATION_CHILD');
    if (name === 'unavailable') assert.equal(o?.availability, 'UNAVAILABLE');
    if (name === 'missingSeller') assert.equal(o?.sellerKind, 'UNKNOWN');
    if (name === 'missingFulfillment') assert.equal(o?.fulfillment, 'UNKNOWN');
    if (name === 'missingShipping') assert.equal(o?.shipping, null);
    if (name === 'missingPrice') assert.equal(o?.price, null);
    if (name === 'fba' || name === 'thirdParty') { assert.equal(o?.sellerKind, 'THIRD_PARTY'); assert.equal(o?.fulfillment, name === 'fba' ? 'AMAZON' : 'MERCHANT'); }
    if (name === 'retail') { assert.equal(o?.sellerKind, 'AMAZON_RETAIL'); assert.equal(o?.price?.minor, 9501n); assert.equal(o?.shipping?.minor, 0n); assert.equal(o?.featured, true); }
  });
}
for (const name of htmlNames) {
  test(`Browser local HTML fixture: ${name}`, async () => {
    const provider = browserProvider(htmlCapture(name)); const result = await provider.read(pTarget, pContext);
    const categories: Record<string, string> = { challenge: 'CHALLENGE_DETECTED', denied: 'ACCESS_DENIED', mismatch: 'PARSER_MISMATCH' };
    if (categories[name]) { assert.equal(result.category, categories[name]); assert.equal('evidence' in result, false); return; }
    const n = normalizeAmazon(evidence(result), [P_RETAIL]); const o = n.offers[0];
    assert.equal(n.asin, P_ASIN); assert.equal(n.title, 'Synthetic Spanish booster pack'); assert.equal(n.source.provider, 'BROWSER');
    if (['retail', 'alternate'].includes(name)) { assert.equal(o?.sellerId, P_RETAIL); assert.equal(o?.sellerDisplayName, 'Amazon'); assert.equal(o?.price?.minor, 9501n); assert.equal(o?.fulfillment, 'AMAZON'); assert.equal(o?.availability, 'AVAILABLE'); }
    if (['thirdParty', 'fba', 'separateSellerShipper'].includes(name)) { assert.equal(o?.sellerId, P_THIRD); assert.equal(o?.sellerKind, 'THIRD_PARTY'); assert.equal(o?.fulfillment, name === 'thirdParty' ? 'MERCHANT' : 'AMAZON'); }
    if (name === 'missingPrice' || name === 'incomplete') assert.equal(o?.price, null);
    if (name === 'missingSeller') assert.equal(o?.sellerId, null);
    if (name === 'missingFulfillment') assert.equal(o?.fulfillment, 'UNKNOWN');
    if (name === 'unavailable') assert.equal(o?.availability, 'UNAVAILABLE');
    if (name === 'buttonOnly' || name === 'incomplete') { assert.equal(o?.availability, 'UNKNOWN'); assert.equal(o.buttonPresent, true); }
    if (name === 'noOffer') { assert.equal(n.offers.length, 0); assert.equal(n.coverage, 'NO_OFFERS_IN_RESPONSE'); }
  });
}
for (const name of ['retail', 'unavailable', 'thirdParty', 'fba'] as const) {
  test(`cross-provider equivalence including domain identities: ${name}`, async () => {
    const a = await pService('BUSINESS_API', businessFixtures[name]).inspect(P_ASIN, pContext);
    const b = await pService('BROWSER', htmlCapture(name)).inspect(P_ASIN, pContext);
    const comparable = (n: typeof a.normalized) => ({ ...n, source: null, offers: n.offers.map(o => ({ ...o, externalOfferId: null, buttonPresent: null })) });
    assert.deepEqual(comparable(a.normalized), comparable(b.normalized));
    const domain = (o: typeof a.observations[number]) => ({ ...o, id: null, ...Object.fromEntries(['identity', 'seller', 'fulfilledBy', 'unitPrice', 'shipping', 'additionalTax', 'stock', 'availableQuantity', 'purchaseLimit'].map(key => { const v = o[key as 'identity']; return [key, { ...v, evidence: null }]; })) });
    assert.deepEqual(a.observations.map(domain), b.observations.map(domain));
    assert.notEqual(a.observations[0]?.id, b.observations[0]?.id); assert.notEqual(a.observations[0]?.seller.evidence.sourceId, b.observations[0]?.seller.evidence.sourceId);
  });
}
for (const provider of ['BUSINESS_API', 'BROWSER'] as const) {
  test(`${provider} seller evaluation never approves by FBA or display name`, async () => {
    const q = await pService(provider, provider === 'BUSINESS_API' ? businessFixtures.fba : htmlCapture('fba')).inspect(P_ASIN, pContext); const o = q.observations[0]; assert.ok(o);
    const policy = { version: 'test-policy', mode: 'ALLOWLIST' as const, allow: [ref(o.offer.ref.storeId, 'seller', P_RETAIL)], deny: [], firstParty: [] };
    assert.equal(validateSeller(o, policy, P_NOW).result, 'REVIEW_REQUIRED');
    assert.equal(validateSeller(o, { ...policy, allow: [o.offer.sellerRef] }, P_NOW).result, 'APPROVED');
    assert.equal(validateSeller(o, { ...policy, allow: [o.offer.sellerRef], deny: [o.offer.sellerRef] }, P_NOW).result, 'REJECTED');
  });
}
test('selection is explicit, offline by default, rejects mismatch and network opt-in', () => {
  const config: AmazonProviderConfig = { provider: 'BUSINESS_API', marketplace: 'MX', deliveryScope: P_SCOPE };
  assert.throws(() => new AmazonObservationService(config, browserProvider(), () => P_NOW), ReadFailure);
  assert.throws(() => new AmazonObservationService({ ...config, networkEnabled: true } as unknown as AmazonProviderConfig, apiProvider(), () => P_NOW), /NETWORK_DISABLED/);
  assert.throws(() => new AmazonObservationService({ ...config, provider: undefined } as unknown as AmazonProviderConfig, apiProvider(), () => P_NOW), ReadFailure);
});
test('API auth failure makes exactly one call and never switches to browser', async () => {
  let calls = 0; const provider = new AmazonBusinessApiProvider({ mode: 'FIXTURE_ONLY', async lookup() { calls++; return businessFixtures.auth; } });
  const service = new AmazonObservationService({ provider: 'BUSINESS_API', marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => P_NOW);
  assert.equal((await service.resolve(P_ASIN, pContext)).ok, false); assert.equal(calls, 1);
  assert.deepEqual(service.diagnostics().map(d => [d.provider, d.authRequired, d.errorClass]), [['BUSINESS_API', true, 'AUTH_REQUIRED']]);
});
test('challenge performs one local read, no solve/retry and diagnostics are nonactionable', async () => {
  let calls = 0; const provider = new AmazonBrowserProvider({ mode: 'FIXTURE_ONLY', async readPage() { calls++; return htmlCapture('challenge'); } });
  const service = new AmazonObservationService({ provider: 'BROWSER', marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => P_NOW);
  assert.equal((await service.resolve(P_ASIN, pContext)).ok, false); assert.equal(calls, 1); assert.equal(service.diagnostics()[0]?.challengeDetected, true);
});
test('cancellation and expired deadline stop before transport', async () => {
  let calls = 0; const provider = new AmazonBusinessApiProvider({ mode: 'FIXTURE_ONLY', async lookup() { calls++; return businessFixtures.retail; } });
  const service = new AmazonObservationService({ provider: 'BUSINESS_API', marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => P_NOW);
  for (const ctx of [{ ...pContext, cancellation: { aborted: true } }, { ...pContext, deadlineAt: P_NOW }]) assert.equal((await service.resolve(P_ASIN, ctx)).ok, false);
  assert.equal(calls, 0);
});
test('late capture is discarded and timeout is diagnosed', async () => {
  let time = P_NOW; const provider = new AmazonBusinessApiProvider({ mode: 'FIXTURE_ONLY', async lookup() { time += 2000; return businessFixtures.retail; } });
  const s = new AmazonObservationService({ provider: 'BUSINESS_API', marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => time);
  assert.equal((await s.resolve(P_ASIN, pContext)).ok, false); assert.equal(s.diagnostics()[0]?.timeout, true);
});
test('raw thrown errors and unknown payload fields are not diagnostics', async () => {
  const canary = 'RAW-SECRET-CANARY'; const p = new AmazonBusinessApiProvider({ mode: 'FIXTURE_ONLY', async lookup() { throw new Error(canary); } });
  const s = new AmazonObservationService({ provider: 'BUSINESS_API', marketplace: 'MX', deliveryScope: P_SCOPE }, p, () => P_NOW);
  const r = await s.resolve(P_ASIN, pContext); assert.equal(JSON.stringify([r, s.diagnostics()]).includes(canary), false);
  assert.equal(s.diagnostics()[0]?.result, 'NETWORK_ERROR');
  const e = evidence(await apiProvider(businessCapture([businessOffer({ accessToken: canary })], businessProduct({ customer: canary }))).read(pTarget, pContext));
  assert.equal(JSON.stringify(e).includes(canary), false);
});
test('Business conflicting fulfillment/condition degrades to UNKNOWN', async () => {
  const e = evidence(await apiProvider(businessCapture([businessOffer({ fulfillmentType: 'MERCHANT_FULFILLMENT', productCondition: 'USED' })])).read(pTarget, pContext));
  const n = normalizeAmazon(e, [P_RETAIL]); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN'); assert.equal(n.offers[0]?.condition, null);
});
for (const amount of ['95.011', '1e2', '-1', '9007199254740992.01']) {
  test(`Business decimal precision rejects unsafe money ${amount}`, async () => {
    const c = businessCapture(); const body = c.offers.body.replaceAll('95.01', amount);
    const n = normalizeAmazon(evidence(await apiProvider({ ...c, offers: { status: 200, body } }).read(pTarget, pContext)));
    assert.equal(n.offers[0]?.price, null);
  });
}
test('Business currency mismatch never becomes MXN', async () => {
  const c = businessCapture(); const n = normalizeAmazon(evidence(await apiProvider({ ...c, offers: { status: 200, body: c.offers.body.replaceAll('MXN', 'USD') } }).read(pTarget, pContext)));
  assert.equal(n.offers[0]?.price, null); assert.equal(n.offers[0]?.shipping, null);
});
test('Business SP-API envelopes cannot pass the new contract', async () => {
  const c = businessCapture([], businessProduct(), { offers: { status: 200, body: '{"payload":{"Offers":[]}}' } });
  assert.equal((await pService('BUSINESS_API', c).resolve(P_ASIN, pContext)).ok, false);
});
test('conflicting same-seller terms reject rather than collapse offers', async () => {
  const c = businessCapture([businessOffer(), businessOffer({ offerId: 'SECOND', price: { value: { amount: 80, currencyCode: 'MXN' } } })]);
  const r = await pService('BUSINESS_API', c).resolve(P_ASIN, pContext); assert.ok(!r.ok); assert.equal(r.error.code, 'NORMALIZATION_FAILED');
});
test('empty partial response is UNKNOWN coverage, not total unavailability', async () => {
  const c = businessCapture([], businessProduct(), { offers: { status: 200, body: '{"offers":[],"offerCount":20,"numberOfPages":2}' } });
  const q = await pService('BUSINESS_API', c).inspect(P_ASIN, pContext); assert.equal(q.normalized.coverage, 'UNKNOWN'); assert.equal(q.observations.length, 0);
});
test('title cannot establish canonical pack identity or sealing', async () => {
  const q = await pService('BUSINESS_API', undefined, false).inspect(P_ASIN, pContext);
  assert.equal(q.observations[0]?.identity.state, 'UNKNOWN'); assert.equal(q.observations[0]?.offer.condition, 'UNKNOWN');
  assert.throws(() => mapAmazonDomain(q.normalized, P_SCOPE, { ...pReview, asin: P_CHILD }), ReadFailure);
});
test('tracking, price and provider do not change stable identity; delivery context does', async () => {
  const s = pService('BUSINESS_API'); const a = await s.inspect(P_ASIN, pContext); const b = await s.inspect(`${pTarget.url}?tag=authored&ref_=x`, pContext);
  assert.deepEqual(a.observations, b.observations);
  const changed = { ...a.normalized, offers: a.normalized.offers.map(o => ({ ...o, price: null })) };
  assert.deepEqual(mapAmazonDomain(changed, P_SCOPE, pReview).observations[0]?.offer, a.observations[0]?.offer);
  assert.notDeepEqual(mapAmazonDomain(a.normalized, 'different-buyer-context', pReview).observations[0]?.offer, a.observations[0]?.offer);
});
test('wrong captured target/context/time rejected', async () => {
  for (const c of [businessCapture([], businessProduct(), { target: { ...pTarget, asin: P_CHILD } }), businessCapture([], businessProduct(), { sourceObservedAt: P_NOW + 1 })]) {
    assert.equal((await pService('BUSINESS_API', c).resolve(P_ASIN, pContext)).ok, false);
  }
  assert.equal((await pService('BUSINESS_API').resolve(P_ASIN, { ...pContext, deliveryScope: 'wrong' })).ok, false);
});
test('HTML conflicts cannot choose a seller or shipper by source order', async () => {
  const c = htmlCapture(); const html = c.html.replace('</section>', '<span aria-label="Seller ID">OTHER</span><span aria-label="Ships from">Merchant</span></section>');
  const n = normalizeAmazon(evidence(await browserProvider({ ...c, html }).read(pTarget, pContext)));
  assert.equal(n.offers[0]?.sellerId, null); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN');
});
test('HTML malformed structure fails and script content is inert', async () => {
  const c = htmlCapture(); assert.equal((await browserProvider({ ...c, html: c.html.replace('</section>', '</article>') }).read(pTarget, pContext)).category, 'PARSER_MISMATCH');
  const html = c.html.replace('</body>', '<script>throw new Error("MUST_NOT_RUN");</script></body>');
  assert.equal((await browserProvider({ ...c, html }).read(pTarget, pContext)).category, 'OBSERVED');
});
for (const [status, category] of [[404, 'PAGE_UNAVAILABLE'], [403, 'ACCESS_DENIED'], [503, 'NETWORK_ERROR']] as const) {
  test(`HTML status ${status} is ${category}`, async () => { assert.equal((await browserProvider(htmlCapture('retail', { status })).read(pTarget, pContext)).category, category); });
}
test('provider diagnostics bounded and contain explicit required fields', async () => {
  const s = pService('BUSINESS_API'); for (let i = 0; i < 102; i++) await s.inspect(P_ASIN, pContext);
  assert.equal(s.diagnostics().length, 100); assert.deepEqual(s.diagnostics()[0], { provider: 'BUSINESS_API', asin: P_ASIN, startedAt: P_NOW, endedAt: P_NOW, result: 'OBSERVED', offerCount: 1, completeness: 'COMPLETE_FIELDS', challengeDetected: false, parseFailure: false, authRequired: false, timeout: false, errorClass: null });
});
test('new provider boundary contains data reads only, no network/runtime/action imports', () => {
  for (const p of [apiProvider(), browserProvider()]) assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(p)).sort(), ['constructor', 'read']);
  const folder = 'packages/adapters/src/amazon/providers';
  for (const file of readdirSync(folder)) {
    const text = readFileSync(`${folder}/${file}`, 'utf8');
    assert.doesNotMatch(text, /(?:from\s+['"](?:playwright|puppeteer|node:(?:http|https|net|child_process))|\bfetch\s*\(|\.goto\s*\(|\.click\s*\(|\.fill\s*\(|launchPersistentContext|connectOverCDP|addCookies|AutomationControlled)/);
  }
});
