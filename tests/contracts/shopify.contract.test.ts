import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { id, ref, refKey } from '@ptcg/core';
import { evaluateSimulation } from '@ptcg/application';
import type { AdapterError } from '@ptcg/application';
import { harness } from '../fixtures/durable.js';
import { adapterFixture, product, readContext, response, shopConfig, shopifyFixtures, shopifyMonitor, SOURCE, variant } from '../fixtures/shopify.js';

test('Shopify read-only contract resolves explicit variants with independent capability health', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.multiple, shopifyFixtures.multiple, shopifyFixtures.multiple]);
  assert.deepEqual(a.adapter.descriptor.capabilities, ['RESOLUTION', 'OBSERVATION']);
  assert.equal(a.adapter.descriptor.automationLevel, 'OBSERVE_ONLY');
  const ambiguous = await a.adapter.resolve('https://merchant.invalid/products/fixture-etb', readContext(a.clock));
  assert.ok(ambiguous.ok); assert.equal(ambiguous.resolution.selectedOffer, null); assert.equal(ambiguous.resolution.variants.length, 2);
  assert.equal(a.adapter.health('RESOLUTION').state, 'HEALTHY'); assert.equal(a.adapter.health('OBSERVATION').state, 'UNAVAILABLE');
  const resolved = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(resolved.ok); assert.ok(resolved.resolution.selectedOffer);
  const observed = await a.adapter.observe(resolved.resolution.selectedOffer, readContext(a.clock)); assert.ok(observed.ok);
  assert.equal(observed.observation.variant.ref.externalId, '201'); assert.equal(a.adapter.health('OBSERVATION').state, 'HEALTHY');
  assert.equal(a.adapter.metrics().queueDelayMs, 2000); assert.equal(a.transport.attempts, 3);
});
test('normalized observation retains exact provenance, unknown landed costs and separate IDs', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal]);
  const monitor = await shopifyMonitor(a);
  const read = await a.adapter.observe(monitor.configuration.offerRef, readContext(a.clock)); assert.ok(read.ok);
  const o = read.observation;
  assert.equal(o.unitPrice.state, 'KNOWN'); assert.equal(o.shipping.state, 'UNKNOWN'); assert.equal(o.additionalTax.state, 'UNKNOWN'); assert.equal(o.purchaseLimit.state, 'UNKNOWN');
  assert.equal(o.identity.evidence.rights, 'SYNTHETIC'); assert.equal(o.identity.evidence.adapterVersion, a.adapter.descriptor.version);
  assert.ok(o.identity.evidence.captureId.startsWith('capture:')); assert.equal(o.identity.evidence.sourceId, shopConfig.storeId);
  assert.equal(new Set([o.product.ref, o.variant.ref, o.listing.ref, o.offer.ref, o.offer.sellerRef].map(refKey)).size, 5);
  assert.equal(read.catalog?.store.canonicalDomain, 'merchant.invalid'); assert.equal(read.catalog?.store.region, null);
  assert.equal(Object.isFrozen(o), true); assert.equal(JSON.stringify(a.adapter.diagnostics()).includes('SYNTHETIC-201'), false);
});
test('same external IDs across stores never collide and cross-store observation is rejected before capture', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal]);
  const b = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal], { ...shopConfig, storeId: id('store', 'another-store') });
  const ar = await a.adapter.resolve(SOURCE, readContext(a.clock)); const br = await b.adapter.resolve(SOURCE, readContext(b.clock));
  assert.ok(ar.ok && br.ok && ar.resolution.selectedOffer && br.resolution.selectedOffer);
  assert.notEqual(refKey(ar.resolution.selectedOffer), refKey(br.resolution.selectedOffer));
  const read = await b.adapter.observe(ar.resolution.selectedOffer, readContext(b.clock)); assert.equal(read.ok, false); assert.equal(b.transport.attempts, 1);
});
test('seller identity from reviewed fixture policy is still decided only by core seller rules', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, Array.from({ length: 4 }, () => shopifyFixtures.normal));
  const monitor = await shopifyMonitor(a); const configuration = monitor.configuration;
  const run = (sellerPolicy: typeof configuration.sellerPolicy) => evaluateSimulation(a.adapter, { ...configuration, sellerPolicy, now: a.clock.now(), operationId: 'op', traceId: 'trace', cycleId: 'cycle' });
  const approved = await run(configuration.sellerPolicy); assert.equal(approved.status, 'EVALUATED'); if (approved.status !== 'EVALUATED') return;
  assert.equal(approved.seller.result, 'APPROVED'); assert.equal(approved.simulation.intentState, 'BLOCKED'); assert.equal(approved.opportunity.status, 'INDETERMINATE');
  const rejected = await run({ ...configuration.sellerPolicy, deny: [ref(shopConfig.storeId, 'seller', 'fixture-merchant')] });
  assert.equal(rejected.status === 'EVALUATED' && rejected.seller.result, 'REJECTED');
  const unknown = await run({ ...configuration.sellerPolicy, allow: [] }); assert.equal(unknown.status === 'EVALUATED' && unknown.seller.result, 'REVIEW_REQUIRED');
});
const failures: readonly [keyof typeof shopifyFixtures, AdapterError['code'], number][] = [['malformed', 'MALFORMED_RESPONSE', 1], ['schemaDrift', 'SCHEMA_MISMATCH', 1], ['redirect', 'REDIRECT_DENIED', 1], ['rateLimit', 'RATE_LIMITED', 3], ['serverError', 'TRANSIENT_FAILURE', 3], ['blocked', 'BLOCKED', 1], ['unauthorized', 'AUTH_REQUIRED', 1]];
for (const [fixture, code, attempts] of failures) test(`Shopify contract reports ${code} with bounded attempts`, async t => {
  const a = adapterFixture(harness(t).store.readQuotas, Array.from({ length: 4 }, () => shopifyFixtures[fixture]));
  const r = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!r.ok); assert.equal(r.error.code, code); assert.equal(r.error.externalEffect, 'NOT_SENT');
  assert.equal(a.transport.attempts, attempts); assert.equal(a.adapter.metrics().failedReads, attempts);
  assert.notEqual(a.adapter.health('RESOLUTION').state, 'HEALTHY'); assert.equal(a.adapter.health('OBSERVATION').state, 'UNAVAILABLE');
});
test('unsupported or absent currency is unknown; supported foreign currency remains foreign', async t => {
  for (const currencyCode of [null, 'EUR', 'USD']) {
    const h = harness(t); const data = response(product({}, [variant({ price: { amount: '1000.00', currencyCode } })]));
    const a = adapterFixture(h.store.readQuotas, [data, data]); const m = await shopifyMonitor(a);
    const r = await evaluateSimulation(a.adapter, { ...m.configuration, now: a.clock.now(), operationId: 'op', traceId: 'trace', cycleId: 'cycle' });
    assert.ok(r.status === 'EVALUATED'); assert.equal(r.simulation.intentState, 'BLOCKED');
    if (currencyCode === 'USD') { assert.equal(r.observation.unitPrice.state === 'KNOWN' && r.observation.unitPrice.value.currency, 'USD'); }
    else assert.equal(r.observation.unitPrice.state, 'UNKNOWN');
  }
});
test('all fixture reads have zero HTTP, socket, browser or checkout effects', async t => {
  const forbidden = () => { throw new Error('External network must not be used'); };
  t.mock.method(globalThis, 'fetch', forbidden); t.mock.method(http, 'request', forbidden); t.mock.method(https, 'request', forbidden); t.mock.method(net.Socket.prototype, 'connect', forbidden);
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal]); const m = await shopifyMonitor(a);
  const r = await a.adapter.observe(m.configuration.offerRef, readContext(a.clock)); assert.ok(r.ok);
  assert.equal('checkout' in a.adapter, false); assert.equal('addToCart' in a.adapter, false);
});

test('a different product under the same handle is a typed normalization failure, never a substituted offer', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.duplicateTitle]);
  const m = await shopifyMonitor(a); const r = await a.adapter.observe(m.configuration.offerRef, readContext(a.clock));
  assert.ok(!r.ok); assert.equal(r.error.code, 'CONTEXT_MISMATCH'); assert.equal(a.adapter.metrics().normalizationFailures, 1);
});
test('missing SKU does not change identity; stale health cannot imply a recent successful read', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.missingSku]);
  const m = await shopifyMonitor(a); const r = await a.adapter.observe(m.configuration.offerRef, readContext(a.clock));
  assert.ok(r.ok); assert.equal(r.catalog?.sku, null); assert.deepEqual(r.observation.offer.ref, m.configuration.offerRef);
  a.clock.at += 60_001; assert.equal(a.adapter.health('OBSERVATION').state, 'DEGRADED'); assert.equal(a.adapter.health('OBSERVATION').reason, 'STALE_SUCCESS');
});
test('observation blocking closes the shared store quota for resolution as well', async t => {
  const a = adapterFixture(harness(t).store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.blocked, shopifyFixtures.normal]);
  const m = await shopifyMonitor(a); const blocked = await a.adapter.observe(m.configuration.offerRef, readContext(a.clock)); assert.ok(!blocked.ok); assert.equal(blocked.error.code, 'BLOCKED');
  const resolved = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!resolved.ok); assert.equal(resolved.error.code, 'BLOCKED'); assert.equal(a.transport.attempts, 2);
});
