import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AMAZON_PROVIDER_STORE } from '@ptcg/adapters';
import { harness, limits, OWNER } from '../fixtures/durable.js';
import { businessFixtures, htmlCapture, pService, providerMonitor, P_ASIN, P_NOW, pContext } from '../fixtures/amazon-providers.js';

for (const kind of ['BUSINESS_API', 'BROWSER'] as const) {
  for (const [name, seller] of [['retail', 'APPROVED'], ['fba', 'REVIEW_REQUIRED'], ['thirdParty', 'REVIEW_REQUIRED'], ['unavailable', 'APPROVED']] as const) {
    test(`${kind} durable DRY_RUN ${name}: seller, opportunity, audit, reopen, replay`, async t => {
      const h = harness(t); const f = await providerMonitor(kind, kind === 'BUSINESS_API' ? businessFixtures[name] : htmlCapture(name));
      h.store.execution.configureLimits(limits(), null, P_NOW); h.store.monitors.publishRevision(f.definition, null, P_NOW);
      const r = await h.store.coordinator.run(f.adapter, f.command); assert.ok(r.status === 'COMMITTED'); assert.equal(r.simulation.mode, 'DRY_RUN'); assert.equal(r.simulation.intentState, 'BLOCKED');
      const evaluation = h.store.evidence.getEvaluation(r.simulation.scope.evaluationId);
      assert.equal(evaluation.evaluation.seller.result, seller); assert.equal(evaluation.evaluation.opportunity.status, 'INDETERMINATE');
      assert.equal(evaluation.evaluation.observation.availableQuantity.state, 'UNKNOWN'); assert.equal(evaluation.evaluation.observation.shipping.state, 'UNKNOWN');
      const history = h.store.execution.getDecisionHistory(r.simulation.scope.intentId); assert.equal(history.reservation, null); assert.equal(history.attemptVersion, null); assert.equal(history.audit.at(-1)?.action, 'PURCHASE_BLOCKED');
      assert.equal(h.store.evidence.getStoreMetadata(AMAZON_PROVIDER_STORE)?.accessMode, 'FIXTURE_ONLY');
      assert.deepEqual(h.store.execution.getUsage(OWNER, f.definition.campaignId, f.definition.configuration.target.id, P_NOW), { currency: 'MXN', dailySpent: 0n, dailyHeld: 0n, campaignQuantity: 0n, dailyAttempts: 0n });
      h.store.close(); const s = h.open(); const o = s.evidence.getObservationHistory(f.observation.offer.ref)[0]?.observation;
      assert.deepEqual(o, f.observation); assert.ok(o?.seller.evidence.sourceId.includes(`:${kind}:fixture:`)); assert.ok(o?.seller.evidence.parserVersion.includes(kind));
      assert.equal(s.coordinator.recover(P_NOW).delivered, 1); assert.equal(s.coordinator.recover(P_NOW).delivered, 0);
      assert.equal((await s.coordinator.run(f.adapter, f.command)).status, 'DUPLICATE'); assert.equal(s.outbox.getNotifications()[0]?.action, 'PurchaseBlocked');
      const db = new DatabaseSync(h.path, { readOnly: true }); try {
        for (const table of ['store_instances', 'store_products', 'variants', 'listings', 'offers', 'listing_observations', 'event_outbox']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1, table);
        assert.equal(db.prepare('SELECT count(*) AS n FROM checkout_attempts').get()?.['n'], 0);
      } finally { db.close(); }
    });
  }
}
test('API and HTML captures share stable entities but retain independent durable provenance', async t => {
  const h = harness(t); const f = await providerMonitor('BUSINESS_API'); h.store.execution.configureLimits(limits(), null, P_NOW); h.store.monitors.publishRevision(f.definition, null, P_NOW);
  assert.equal((await h.store.coordinator.run(f.adapter, f.command)).status, 'COMMITTED');
  h.store.close(); const s = h.open(); const browser = pService('BROWSER');
  assert.equal((await s.coordinator.run(browser, { ...f.command, runId: 'html-read', operationId: 'html-op' })).status, 'DUPLICATE');
  const observations = s.evidence.getObservationHistory(f.observation.offer.ref); assert.equal(observations.length, 2);
  assert.deepEqual(new Set(observations.map(o => o.observation.seller.evidence.sourceId.split(':')[1])), new Set(['BUSINESS_API', 'BROWSER']));
  assert.equal((await s.coordinator.run(browser, { ...f.command, runId: 'html-repeat', operationId: 'html-repeat-op' })).status, 'DUPLICATE');
  assert.equal(s.evidence.getObservationHistory(f.observation.offer.ref).length, 2); assert.equal(s.coordinator.recover(P_NOW).delivered, 1);
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    for (const table of ['store_instances', 'store_products', 'variants', 'listings', 'offers', 'purchase_intents', 'event_outbox']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1, table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sellers').get()?.['n'], 2);
    assert.equal(db.prepare('PRAGMA quick_check').get()?.['quick_check'], 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
test('challenge/no offer/auth failures cannot erase last-known evidence or create decisions', async t => {
  const h = harness(t); const f = await providerMonitor('BUSINESS_API'); h.store.execution.configureLimits(limits(), null, P_NOW); h.store.monitors.publishRevision(f.definition, null, P_NOW);
  await h.store.coordinator.run(f.adapter, f.command);
  const providers = [pService('BROWSER', htmlCapture('challenge')), pService('BROWSER', htmlCapture('noOffer')), pService('BUSINESS_API', businessFixtures.auth), pService('BUSINESS_API', businessFixtures.missingSeller)];
  for (const [i, p] of providers.entries()) assert.equal((await h.store.coordinator.run(p, { ...f.command, runId: `failed-${i}`, operationId: `failed-${i}` })).status, 'FAILED');
  assert.equal(h.store.evidence.getObservationHistory(f.observation.offer.ref).length, 1); assert.equal(h.store.outbox.getOutbox().length, 1);
});
test('unreviewed product and unknown availability stay blocked in both provider paths', async t => {
  const h = harness(t); h.store.execution.configureLimits(limits(), null, P_NOW);
  for (const kind of ['BUSINESS_API', 'BROWSER'] as const) {
    const f = await providerMonitor(kind, kind === 'BROWSER' ? htmlCapture('buttonOnly') : businessFixtures.retail, false);
    h.store.monitors.publishRevision(f.definition, null, P_NOW);
    const r = await h.store.coordinator.run(f.adapter, { ...f.command, runId: kind, operationId: kind }); assert.ok(r.status === 'COMMITTED' || r.status === 'DUPLICATE');
    if (r.status === 'COMMITTED') { assert.equal(r.simulation.mode, 'DRY_RUN'); assert.equal(r.simulation.intentState, 'BLOCKED'); }
    const q = await f.adapter.inspect(P_ASIN, pContext); assert.equal(q.observations[0]?.identity.state, 'UNKNOWN');
    if (kind === 'BROWSER') assert.equal(q.observations[0]?.stock.state, 'UNKNOWN');
  }
});
