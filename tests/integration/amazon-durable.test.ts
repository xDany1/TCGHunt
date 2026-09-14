import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { refKey } from '@ptcg/core';
import { AmazonQualificationAdapter, AMAZON_FIXTURE_STORE } from '@ptcg/adapters';
import { harness, limits, OWNER } from '../fixtures/durable.js';
import { amazonFixtures, amazonMonitor, catalog, offer, response, review } from '../fixtures/amazon.js';

for (const [name, capture, approved, reviewed, seller] of [
  ['approved retail, incomplete costs', amazonFixtures.retailInStock, true, true, 'APPROVED'],
  ['unreviewed third-party FBA', amazonFixtures.thirdPartyUnreviewed, true, true, 'REVIEW_REQUIRED'],
  ['no approved seller', amazonFixtures.retailInStock, false, true, 'REVIEW_REQUIRED'],
  ['ambiguous product', amazonFixtures.ambiguousTitle, true, false, 'APPROVED'],
  ['unavailable retail', amazonFixtures.retailUnavailable, true, true, 'APPROVED']
] as const) {
  test(`Amazon durable safety gate: ${name}`, async t => {
    const h = harness(t); const f = amazonMonitor(capture, approved, reviewed); h.store.execution.configureLimits(limits(), null, f.command.now); h.store.monitors.publishRevision(f.definition, null, f.command.now);
    const r = await h.store.coordinator.run(f.adapter, f.command); assert.ok(r.status === 'COMMITTED'); assert.equal(r.simulation.intentState, 'BLOCKED'); assert.equal(r.simulation.mode, 'DRY_RUN');
    const e = h.store.evidence.getEvaluation(r.simulation.scope.evaluationId); assert.equal(e.evaluation.seller.result, seller); assert.equal(e.evaluation.opportunity.status, 'INDETERMINATE');
    assert.equal(e.evaluation.observation.availableQuantity.state, 'UNKNOWN'); assert.equal(e.request.mapping.state, reviewed ? 'REVIEWED' : 'UNREVIEWED');
    const history = h.store.execution.getDecisionHistory(r.simulation.scope.intentId); assert.equal(history.attemptVersion, null); assert.equal(history.reservation, null); assert.equal(history.audit.at(-1)?.action, 'PURCHASE_BLOCKED');
    assert.equal(h.store.evidence.getStoreMetadata(AMAZON_FIXTURE_STORE)?.accessMode, 'FIXTURE_ONLY');
    assert.deepEqual(h.store.execution.getUsage(OWNER, f.definition.campaignId, f.definition.configuration.target.id, f.command.now), { currency: 'MXN', dailySpent: 0n, dailyHeld: 0n, campaignQuantity: 0n, dailyAttempts: 0n });
    h.store.close(); const reopened = h.open(); assert.deepEqual(reopened.evidence.getObservationHistory(f.observation.offer.ref)[0]?.observation, e.evaluation.observation);
    assert.equal(reopened.coordinator.recover(f.command.now).delivered, 1); assert.equal(reopened.coordinator.recover(f.command.now).delivered, 0);
    assert.equal(reopened.outbox.getNotifications()[0]?.action, 'PurchaseBlocked');
    assert.equal((await reopened.coordinator.run(f.adapter, f.command)).status, 'DUPLICATE');
    const db = new DatabaseSync(h.path, { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) AS n FROM checkout_attempts').get()?.['n'], 0); } finally { db.close(); }
  });
}
test('Amazon price history and repeated captures preserve stable identities after reopen', async t => {
  const h = harness(t); const f = amazonMonitor(); h.store.execution.configureLimits(limits(), null, f.command.now); h.store.monitors.publishRevision(f.definition, null, f.command.now);
  assert.equal((await h.store.coordinator.run(f.adapter, f.command)).status, 'COMMITTED'); h.store.close(); const s = h.open();
  const changed = new AmazonQualificationAdapter(amazonFixtures.priceChange, review);
  const cmd2 = { ...f.command, runId: 'second-run', operationId: 'second-operation' };
  assert.equal((await s.coordinator.run(changed, cmd2)).status, 'DUPLICATE');
  assert.equal((await s.coordinator.run(changed, { ...cmd2, runId: 'third-run', operationId: 'third-operation' })).status, 'DUPLICATE');
  const history = s.evidence.getObservationHistory(f.observation.offer.ref); assert.equal(history.length, 2);
  assert.deepEqual(new Set(history.map(h => h.observation.unitPrice.state === 'KNOWN' ? h.observation.unitPrice.value.minor : null)), new Set([9501n, 9001n]));
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    for (const table of ['store_instances', 'store_products', 'variants', 'listings', 'offers', 'purchase_intents', 'event_outbox']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1, table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sellers').get()?.['n'], 2, 'retail seller and distinct fulfillment operator');
    assert.equal(db.prepare('SELECT count(*) AS n FROM checkout_attempts').get()?.['n'], 0);
    assert.equal(db.prepare('PRAGMA quick_check').get()?.['quick_check'], 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
test('multiple Amazon seller/fulfillment offers persist separately without changing catalog identity', async t => {
  const h = harness(t); h.store.execution.configureLimits(limits(), null, 1800000000000);
  for (const [i, capture] of [amazonFixtures.retailInStock, amazonFixtures.thirdPartyFba, amazonFixtures.thirdPartyMfn].entries()) {
    const f = amazonMonitor(capture); const monitorId = `${f.definition.monitorId}-${i}` as typeof f.definition.monitorId;
    const definition = { ...f.definition, monitorId, cycleId: `amazon-cycle-${i}` }; h.store.monitors.publishRevision(definition, null, f.command.now);
    const r = await h.store.coordinator.run(f.adapter, { ...f.command, monitorId, runId: `amazon-run-${i}`, operationId: `amazon-op-${i}` }); assert.ok(r.status === 'COMMITTED'); assert.equal(r.simulation.intentState, 'BLOCKED');
  }
  h.store.close(); const reopened = h.open(); assert.equal(reopened.coordinator.recover(1800000000000).delivered, 3);
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    for (const table of ['store_products', 'variants', 'listings']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM offers').get()?.['n'], 3); assert.equal(db.prepare('SELECT count(*) AS n FROM sellers').get()?.['n'], 3);
  } finally { db.close(); }
});
test('no offer and auth failures retain prior catalog evidence without fake stock or attempts', async t => {
  const h = harness(t); const f = amazonMonitor(); h.store.execution.configureLimits(limits(), null, f.command.now); h.store.monitors.publishRevision(f.definition, null, f.command.now); await h.store.coordinator.run(f.adapter, f.command);
  for (const [i, capture] of [amazonFixtures.noOffer, amazonFixtures.missingSeller, amazonFixtures.authFailure].entries()) {
    const r = await h.store.coordinator.run(new AmazonQualificationAdapter(capture), { ...f.command, runId: `absent-${i}`, operationId: `absent-${i}` }); assert.equal(r.status, 'FAILED');
  }
  const history = h.store.evidence.getObservationHistory(f.observation.offer.ref); assert.equal(history.length, 1); assert.equal(refKey(history[0]?.observation.product.ref ?? f.observation.product.ref), refKey(f.observation.product.ref));
  assert.equal(h.store.outbox.getOutbox().length, 1);
});
test('unrecognized raw fields never enter Amazon durable evidence or audit', async t => {
  const h = harness(t); const canary = 'M5-UNRECOGNIZED-RAW-CANARY';
  const f = amazonMonitor(response([offer({ Authorization: canary })], catalog(undefined, { rawCredentials: canary }))); h.store.execution.configureLimits(limits(), null, f.command.now); h.store.monitors.publishRevision(f.definition, null, f.command.now);
  assert.equal((await h.store.coordinator.run(f.adapter, f.command)).status, 'COMMITTED');
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    for (const table of ['listing_observations', 'observation_metadata', 'store_metadata', 'decision_evaluations', 'audit_events']) assert.equal(JSON.stringify(db.prepare(`SELECT snapshot FROM ${table}`).all()).includes(canary), false);
  } finally { db.close(); }
});
