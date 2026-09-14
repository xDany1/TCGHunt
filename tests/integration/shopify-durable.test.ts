import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { id, ref } from '@ptcg/core';
import type { RunCommand } from '@ptcg/application';
import { harness, limits, OWNER } from '../fixtures/durable.js';
import { NOW } from '../fixtures/scenarios.js';
import { adapterFixture, identity, product, response, shopConfig, shopifyFixtures, shopifyMonitor, variant } from '../fixtures/shopify.js';

const command = (now: number, sequence = 1): RunCommand => ({ monitorId: id('monitor', 'shopify-monitor'), revision: 1, runId: `shopify-run-${sequence}`, operationId: `shopify-operation-${sequence}`, traceId: 'shopify-trace', now });
test('Shopify URL monitor persists observation, seller decision, blocked costs, audit and history through M2', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  const result = await h.store.coordinator.run(a.adapter, command(a.clock.now())); assert.ok(result.status === 'COMMITTED'); assert.equal(result.simulation.intentState, 'BLOCKED');
  const evidence = h.store.evidence.getEvaluation(result.simulation.scope.evaluationId);
  assert.equal(evidence.evaluation.seller.result, 'APPROVED'); assert.equal(evidence.evaluation.opportunity.status, 'INDETERMINATE');
  assert.equal(evidence.command.now, a.clock.now()); assert.equal(evidence.evaluation.observation.shipping.state, 'UNKNOWN');
  const metadata = h.store.evidence.getStoreMetadata(shopConfig.storeId); assert.equal(metadata?.family, 'Shopify'); assert.equal(metadata?.commercialUse, 'UNVALIDATED');
  const history = h.store.execution.getDecisionHistory(result.simulation.scope.intentId); assert.equal(history.reservation, null); assert.equal(history.audit.at(-1)?.action, 'PURCHASE_BLOCKED');
  assert.equal(h.store.evidence.getObservationHistory(m.configuration.offerRef).length, 1);
  assert.deepEqual(h.store.execution.getUsage(OWNER, m.campaignId, m.configuration.target.id, a.clock.now()), { currency: 'MXN', dailySpent: 0n, dailyHeld: 0n, campaignQuantity: 0n, dailyAttempts: 0n });
  assert.ok(a.adapter.diagnostics().some(d => d.monitorId === m.monitorId && d.runId === 'shopify-run-1'));
  h.store.close(); const reopened = h.open(); assert.deepEqual(reopened.evidence.getObservationHistory(m.configuration.offerRef)[0]?.observation, evidence.evaluation.observation);
  assert.equal(reopened.coordinator.recover(a.clock.now()).delivered, 1); assert.equal(reopened.coordinator.recover(a.clock.now()).delivered, 0);
});
test('price and availability history append across restart while offer identity and cycle receipt remain stable', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  const first = await h.store.coordinator.run(a.adapter, command(a.clock.now())); assert.ok(first.status === 'COMMITTED');
  h.store.close(); const reopened = h.open(); const b = adapterFixture(reopened.readQuotas, [shopifyFixtures.priceChange, shopifyFixtures.unavailable], shopConfig, a.clock);
  const repeated = await reopened.coordinator.run(b.adapter, command(a.clock.now())); assert.equal(repeated.status, 'DUPLICATE'); assert.equal(b.transport.attempts, 0);
  for (const sequence of [2, 3]) { const r = await reopened.coordinator.run(b.adapter, command(b.clock.now(), sequence)); assert.equal(r.status, 'DUPLICATE'); }
  const observations = reopened.evidence.getObservationHistory(m.configuration.offerRef); assert.equal(observations.length, 3);
  assert.equal(new Set(observations.map(o => o.observation.id)).size, 3); assert.equal(new Set(observations.map(o => o.observation.offer.ref.externalId)).size, 1);
  assert.equal(observations[0]?.observation.stock.state === 'KNOWN' && observations[0].observation.stock.value, 'OUT_OF_STOCK');
  assert.equal(observations[1]?.observation.unitPrice.state === 'KNOWN' && observations[1].observation.unitPrice.value.minor, 109999n);
  assert.equal(reopened.outbox.getOutbox().length, 1);
});
test('parser failure persists typed failed run without overwriting good observation or creating a decision', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal, shopifyFixtures.schemaDrift]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  await h.store.coordinator.run(a.adapter, command(a.clock.now()));
  const failed = await h.store.coordinator.run(a.adapter, command(a.clock.now(), 2)); assert.ok(failed.status === 'FAILED'); assert.equal(failed.adapterError?.code, 'SCHEMA_MISMATCH');
  assert.equal(h.store.monitors.getRun('shopify-run-2').reason, 'SCHEMA_MISMATCH'); assert.equal(h.store.evidence.getObservationHistory(m.configuration.offerRef).length, 1); assert.equal(h.store.outbox.getOutbox().length, 1);
});
const variants = {
  wrongLanguage: variant({ identity: { value: JSON.stringify({ ...identity, language: 'ja' }) } }),
  wrongPack: variant({ identity: { value: JSON.stringify({ ...identity, packUnits: 6 }) } }),
  missingIdentity: variant({ identity: null }), missingPrice: variant({ price: null }),
  unknownStock: variant({ availableForSale: true, quantityAvailable: null }), backorder: variant({ currentlyNotInStock: true })
};
for (const [name, v] of Object.entries(variants)) test(`durable Shopify ${name} remains reviewable and cannot authorize a simulated buy`, async t => {
  const h = harness(t); const data = response(product({}, [v])); const a = adapterFixture(h.store.readQuotas, [data, data]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  const r = await h.store.coordinator.run(a.adapter, command(a.clock.now())); assert.ok(r.status === 'COMMITTED'); assert.equal(r.simulation.intentState, 'BLOCKED');
  assert.equal(h.store.evidence.getObservationHistory(m.configuration.offerRef).length, 1);
  if (name === 'missingIdentity') assert.equal(h.store.evidence.getObservationHistory(m.configuration.offerRef)[0]?.observation.offer.condition, 'UNKNOWN');
});
test('unreviewed mapping is persisted; an allowlisted fulfillment identity cannot approve an unknown merchant', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal, shopifyFixtures.normal], { ...shopConfig, merchant: null });
  const m = await shopifyMonitor(a); const unresolved = { ...m, configuration: { ...m.configuration, mapping: { ...m.configuration.mapping, state: 'UNREVIEWED' as const }, sellerPolicy: { ...m.configuration.sellerPolicy, mode: 'FIRST_PARTY_ONLY' as const, firstParty: [ref(shopConfig.storeId, 'seller', 'UNKNOWN')] } } };
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(unresolved, null, NOW);
  const r = await h.store.coordinator.run(a.adapter, command(a.clock.now())); assert.ok(r.status === 'COMMITTED');
  const e = h.store.evidence.getEvaluation(r.simulation.scope.evaluationId); assert.equal(e.request.mapping.state, 'UNREVIEWED'); assert.equal(e.evaluation.seller.result, 'REVIEW_REQUIRED'); assert.equal(r.simulation.intentState, 'BLOCKED');
});
test('aged source evidence cannot become fresh because the queued read just finished', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal, response(product(), { ageMs: 60001 })]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  const r = await h.store.coordinator.run(a.adapter, command(a.clock.now())); assert.ok(r.status === 'COMMITTED'); assert.equal(r.simulation.intentState, 'BLOCKED');
  const e = h.store.evidence.getEvaluation(r.simulation.scope.evaluationId); assert.notEqual(e.evaluation.seller.result, 'APPROVED');
  assert.ok(e.evaluation.observation.identity.evidence.sourceObservedAt < e.command.now - 60000);
});
test('raw source body secrets never enter SQLite normalized snapshots', async t => {
  const h = harness(t); const data = response(product({ authorization: 'SECRET-RAW-CANARY', cookies: 'SECRET-RAW-CANARY' })); const a = adapterFixture(h.store.readQuotas, [data, data]); const m = await shopifyMonitor(a);
  h.store.execution.configureLimits(limits(), null, NOW); h.store.monitors.publishRevision(m, null, NOW);
  assert.equal((await h.store.coordinator.run(a.adapter, command(a.clock.now()))).status, 'COMMITTED');
  const db = new DatabaseSync(h.path); try {
    for (const table of ['listing_observations', 'observation_metadata', 'store_metadata', 'decision_evaluations', 'audit_events']) {
      const rows = db.prepare(`SELECT snapshot FROM ${table}`).all(); assert.equal(JSON.stringify(rows).includes('SECRET-RAW-CANARY'), false);
    }
  } finally { db.close(); }
});
