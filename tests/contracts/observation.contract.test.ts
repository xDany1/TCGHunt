import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeStoreAdapter } from '@ptcg/adapters';
import type { OfferObservationCapability, ReadContext } from '@ptcg/application';
import { assessEvidence, id, ref, sameRef } from '@ptcg/core';
import { fixture, NOW, scenarioNames } from '../fixtures/scenarios.js';

// Reusable contract suite: the factory is consumed here, not a production registry.
function observationContract(name: string, create: () => OfferObservationCapability): void {
  const f = fixture();
  const context: ReadContext = { now: NOW, deadlineAt: NOW + 1, currency: 'MXN', deliveryScope: 'synthetic-mx', operationId: 'contract-operation', traceId: 'contract-trace' };
  test(`${name}: advertises only observation and returns coherent immutable evidence`, async () => {
    const adapter = create();
    assert.deepEqual(adapter.descriptor.capabilities, ['OBSERVATION']);
    assert.equal(adapter.descriptor.automationLevel, 'OBSERVE_ONLY');
    assert.equal(adapter.descriptor.contractVersion, 1);
    const result = await adapter.observe(f.observation.offer.ref, context);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('Expected observation');
    const o = result.observation;
    assert.equal(sameRef(o.offer.variantRef, o.variant.ref), true);
    assert.equal(sameRef(o.offer.listingRef, o.listing.ref), true);
    assert.equal(o.seller.state, 'KNOWN');
    assert.equal(assessEvidence(o.unitPrice, NOW).status, 'PASS');
    assert.ok(Object.isFrozen(o));
    assert.ok(Object.isFrozen(o.variant.identity));
    assert.equal(Reflect.set(o.variant.identity, 'language', 'ja'), false);
    assert.equal('submit' in adapter, false);
    assert.equal('addToCart' in adapter, false);
    assert.equal('prepareCheckout' in adapter, false);
  });
  test(`${name}: repeated reads preserve capture time and value without consuming state`, async () => {
    const adapter = create();
    const results = await Promise.all(Array.from({ length: 4 }, () => adapter.observe(f.observation.offer.ref, context)));
    for (const result of results) assert.deepEqual(result, results[0]);
    const later = await adapter.observe(f.observation.offer.ref, { ...context, now: NOW + 120_000, deadlineAt: NOW + 120_001 });
    if (!later.ok) throw new Error('Expected observation');
    assert.equal(assessEvidence(later.observation.unitPrice, NOW + 120_000).code, 'STALE_EVIDENCE');
  });
  test(`${name}: scoped misses, expired deadlines and wrong delivery scope are typed failures`, async () => {
    const adapter = create();
    for (const [offerRef, ctx, code] of [
      [ref(id('store', 'another-store'), 'offer', f.observation.offer.ref.externalId), context, 'LISTING_NOT_FOUND'],
      [f.observation.offer.ref, { ...context, deadlineAt: NOW }, 'DEADLINE_EXCEEDED'],
      [f.observation.offer.ref, { ...context, deliveryScope: 'elsewhere' }, 'CONTEXT_MISMATCH'],
      [f.observation.offer.ref, { ...context, currency: 'USD' as const }, 'CONTEXT_MISMATCH']
    ] as const) {
      const result = await adapter.observe(offerRef, ctx);
      assert.deepEqual(result, { ok: false, error: { code, category: 'NON_RETRYABLE', externalEffect: 'NOT_SENT', operationId: context.operationId } });
    }
  });
}

observationContract('FakeStoreAdapter', () => new FakeStoreAdapter([fixture().observation]));

test('fake accepts the complete fixture corpus and rejects duplicate offer identities', () => {
  assert.doesNotThrow(() => new FakeStoreAdapter(scenarioNames.map(name => fixture(name).observation)));
  assert.throws(() => new FakeStoreAdapter([fixture().observation, fixture().observation]), /Duplicate fixture/);
});
