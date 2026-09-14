import test from 'node:test';
import assert from 'node:assert/strict';
import { known, money, ref } from '@ptcg/core';
import { PersistenceFailure, restockSample, restockScopeKey, transitionRestock } from '@ptcg/application';
import type { RestockInput, RestockScope, RestockState } from '@ptcg/application';
import { amazonReading, restockFixture, step, R_NOW } from '../fixtures/restock.js';

for (const stock of [true, false, null]) test(`initial ${stock} establishes baseline without restock`, () => {
  const f = restockFixture(0, stock); const r = step(null, f); assert.equal(r.events.length, 0); assert.equal(r.outcome, stock === null ? 'INCOMPLETE' : 'INITIALIZED');
});
for (const [a, b, event] of [[false, true, 'RESTOCK_DETECTED'], [true, false, 'AVAILABILITY_LOST'], [true, true, null], [false, false, null]] as const) test(`explicit stock ${a} -> ${b}`, () => {
  const x = step(null, restockFixture(0, a)); const y = step(x.state, restockFixture(1000, b)); assert.deepEqual(y.events.map(e => e.type), event ? [event] : []);
});
for (const reason of ['CHALLENGE', 'TIMEOUT', 'PARSER_MISMATCH', 'AUTH_FAILURE', 'NETWORK_FAILURE', 'ACCESS_DENIED']) test(`${reason} preserves availability without false loss`, () => {
  const a = step(null, restockFixture()); const f = restockFixture(1000); const input: RestockInput = { ...f.input, status: 'OBSERVATION_FAILED', coverage: 'UNKNOWN', observations: [], provenance: { provider: 'BROWSER', reference: reason } };
  const b = step(a.state, f, input); assert.equal(b.events.length, 0); assert.equal(b.state.baseline?.availability, 'AVAILABLE'); assert.equal(b.state.baseline?.expiresAt, a.state.baseline?.expiresAt);
  const recovered = step(b.state, restockFixture(2000)); assert.equal(recovered.outcome, 'RECOVERED'); assert.equal(recovered.events.length, 0);
});
for (const status of ['NO_OFFER_OBSERVED', 'PARTIAL_COVERAGE', 'UNKNOWN'] as const) test(`${status} without coverage cannot flip state`, () => {
  const a = step(null, restockFixture()); const f = restockFixture(1000, false);
  const b = step(a.state, f, { ...f.input, status, coverage: 'PARTIAL', observations: [] }); assert.equal(b.events.length, 0); assert.equal(b.state.baseline?.availability, 'AVAILABLE');
});
test('even explicit stock on a partial product snapshot cannot flip aggregate state', () => {
  const f = restockFixture(); const scope: RestockScope = { watchId: f.scope.watchId, productRef: f.scope.productRef, deliveryScope: f.scope.deliveryScope, kind: 'PRODUCT' };
  const a = step(null, f, { ...f.input, scope, coverage: 'COMPLETE_SCOPE' }); const g = restockFixture(1000, false);
  assert.equal(step(a.state, g, { ...g.input, scope, coverage: 'PARTIAL' }).events.length, 0);
});
test('a brief failure retains qualifying fresh unavailable evidence', () => {
  const a = step(null, restockFixture(0, false)); const f = restockFixture(1000); const b = step(a.state, f, { ...f.input, status: 'OBSERVATION_FAILED', observations: [], coverage: 'UNKNOWN' });
  assert.equal(step(b.state, restockFixture(2000)).events[0]?.type, 'RESTOCK_DETECTED');
});
test('long outage expires unavailable baseline and recovery is not a restock', () => {
  const a = step(null, restockFixture(0, false)); const b = step(a.state, restockFixture(120000)); assert.equal(b.outcome, 'RECOVERED'); assert.equal(b.events.length, 0);
});
test('first unknown then known is initialization, not restock', () => {
  const a = step(null, restockFixture(0, null)); const b = step(a.state, restockFixture(1000)); assert.equal(b.outcome, 'INITIALIZED'); assert.equal(b.events.length, 0);
});
test('stale current evidence cannot update known availability', () => {
  const f = restockFixture(); const a = step(null, f); const g = restockFixture(1000, false);
  const sample = restockSample(g.input, g.policy, R_NOW + 120000); const b = transitionRestock(a.state, sample, g.scope, R_NOW + 120000);
  assert.equal(b.outcome, 'INCOMPLETE'); assert.equal(b.events.length, 0);
});
for (const [a, b, type] of [[11000n, 10000n, 'PRICE_ENTERED_RANGE'], [10000n, 10001n, 'PRICE_LEFT_RANGE'], [null, 9000n, null], [9000n, null, null]] as const) test(`price ${a} -> ${b} remains distinct from restock`, () => {
  const x = step(null, restockFixture(0, true, a)); const y = step(x.state, restockFixture(1000, true, b)); assert.deepEqual(y.events.map(e => e.type), type ? [type] : []);
});
test('currency mismatch makes price indeterminate', () => {
  const f = restockFixture(); const o = { ...f.observation, unitPrice: known(money(100n, 'USD'), f.observation.unitPrice.evidence) };
  assert.equal(restockSample({ ...f.input, observations: [o] }, f.policy, f.now).price, 'UNKNOWN');
});
test('expired prior price is not a price crossing', () => {
  const f = restockFixture(0, true, 11000n); const o = { ...f.observation, unitPrice: { ...f.observation.unitPrice, evidence: { ...f.observation.unitPrice.evidence, expiresAt: R_NOW + 500 } } };
  const a = step(null, f, { ...f.input, observations: [o] }); assert.equal(step(a.state, restockFixture(1000)).events.length, 0);
});
test('unapproved FBA cannot produce an actionable restock', () => {
  const f = restockFixture(0, false); const policy = { ...f.policy, seller: { ...f.policy.seller, mode: 'MANUAL_REVIEW' as const } };
  const a = step(null, f, f.input, policy); const g = restockFixture(1000); const b = step(a.state, g, g.input, policy); assert.equal(b.events.length, 0); assert.equal(b.state.baseline?.approvedAvailable, false);
});
for (const kind of ['PRODUCT', 'SELLER'] as const) test(`${kind}: complete no approved offer -> approved available`, () => {
  const f = restockFixture(); const scope: RestockScope = { watchId: 'aggregate', productRef: f.scope.productRef, deliveryScope: f.scope.deliveryScope, ...(kind === 'SELLER' ? { kind, sellerRef: f.observation.offer.sellerRef } : { kind }) };
  const a = step(null, f, { ...f.input, scope, coverage: 'COMPLETE_SCOPE', status: 'NO_OFFER_OBSERVED', observations: [] });
  const g = restockFixture(1000); const b = step(a.state, g, { ...g.input, scope, coverage: 'COMPLETE_SCOPE' }); assert.deepEqual(b.events.map(e => e.type), ['APPROVED_OFFER_BECAME_AVAILABLE']);
  const h = restockFixture(2000, false); assert.deepEqual(step(b.state, h, { ...h.input, scope, coverage: 'COMPLETE_SCOPE' }).events.map(e => e.type), ['APPROVED_OFFER_BECAME_UNAVAILABLE']);
});
test('different sellers remain separate offer baselines', () => {
  const f = restockFixture(0, false); const a = step(null, f); const g = restockFixture(1000); const newOffer = ref(g.scope.productRef.storeId, 'offer', 'seller-two-offer');
  const input: RestockInput = { ...g.input, scope: { ...g.scope, kind: 'OFFER', offerRef: newOffer }, observations: [{ ...g.observation, offer: { ...g.observation.offer, ref: newOffer } }] };
  assert.notEqual(restockScopeKey(input.scope), restockScopeKey(f.scope)); assert.throws(() => step(a.state, g, input), PersistenceFailure); assert.equal(step(null, g, input).events.length, 0);
});
test('same stable offer cannot silently change seller or known fulfillment', () => {
  const f = restockFixture(0, false); const a = step(null, f); const g = restockFixture(1000); const other = ref(g.scope.productRef.storeId, 'seller', 'other');
  for (const o of [{ ...g.observation, offer: { ...g.observation.offer, sellerRef: other } }, { ...g.observation, fulfilledBy: known(other, g.observation.fulfilledBy.evidence) }]) assert.throws(() => step(a.state, g, { ...g.input, observations: [o] }), PersistenceFailure);
});
test('child/product and delivery scopes cannot cross-contaminate', () => {
  const f = restockFixture(); const other = ref(f.scope.productRef.storeId, 'product', 'child-two');
  assert.throws(() => restockSample({ ...f.input, scope: { ...f.scope, productRef: other } }, f.policy, f.now), PersistenceFailure);
  assert.throws(() => restockSample({ ...f.input, scope: { ...f.scope, deliveryScope: 'different' } }, f.policy, f.now), PersistenceFailure);
});
test('policy revision starts a baseline; policy rollback is ignored; silent policy edits conflict', () => {
  const f = restockFixture(0, false); const a = step(null, f); const g = restockFixture(1000); const p = { ...g.policy, revision: 2, version: 'v2' };
  const b = step(a.state, g, g.input, p); assert.equal(b.events.length, 0); assert.equal(b.outcome, 'RECOVERED');
  assert.equal(step(b.state, restockFixture(2000)).outcome, 'IGNORED_OLD');
  assert.throws(() => step(a.state, g, g.input, { ...g.policy, maximumPrice: money(1n, 'MXN') }), PersistenceFailure);
});
test('old and equal timestamp observations never roll state backwards', () => {
  const a = step(null, restockFixture(1000)); assert.equal(step(a.state, restockFixture(0, false)).outcome, 'IGNORED_OLD'); assert.equal(step(a.state, restockFixture(1000, false)).events.length, 0);
});
test('unknown price breaks crossing continuity', () => {
  const a = step(null, restockFixture(0, true, 11000n)); const b = step(a.state, restockFixture(1000, true, null)); assert.equal(step(b.state, restockFixture(2000)).events.length, 0);
});
for (const kind of ['BUSINESS_API', 'BROWSER'] as const) test(`${kind} equivalent unavailable -> available produces restock`, async () => {
  const a = await amazonReading(kind, 'unavailable'); const b = await amazonReading(kind, 'retail', 1000);
  const baseline = transitionRestock(null, restockSample(a.input, a.policy, a.now), a.scope, a.now);
  const r = transitionRestock(baseline.state, restockSample(b.input, b.policy, b.now), b.scope, b.now); assert.deepEqual(r.events.map(e => e.type), ['RESTOCK_DETECTED']);
});
test('Business -> Browser equivalent unavailable switch has no event; later availability does', async () => {
  let state: RestockState | null = null; const results = [];
  for (const [kind, name, offset] of [['BUSINESS_API', 'unavailable', 0], ['BROWSER', 'unavailable', 1000], ['BROWSER', 'retail', 2000]] as const) {
    const f = await amazonReading(kind, name, offset); const r = transitionRestock(state, restockSample(f.input, f.policy, f.now), f.scope, f.now); state = r.state; results.push(r.events.map(e => e.type));
  }
  assert.deepEqual(results, [[], [], ['RESTOCK_DETECTED']]);
});
test('Amazon parent and no-offer subset cannot establish child absence', async () => {
  const parent = await amazonReading('BUSINESS_API', 'parent'); assert.equal(restockSample(parent.input, parent.policy, parent.now).comparable, false);
  const offer = await amazonReading('BROWSER'); const missing = await amazonReading('BROWSER', 'noOffer', 1000, offer.scope);
  assert.equal(missing.input.coverage, 'PARTIAL'); assert.equal(restockSample(missing.input, offer.policy, missing.now).availability, 'UNKNOWN');
});
test('runtime mode injection is rejected before generating an event', () => {
  const f = restockFixture(); assert.throws(() => restockSample({ ...f.input, mode: 'LIVE' } as unknown as RestockInput, f.policy, f.now), PersistenceFailure);
});
test('relabeling old stock evidence with a new envelope time is rejected', () => {
  const f = restockFixture(); assert.throws(() => restockSample({ ...f.input, observedAt: f.input.observedAt + 1000 }, f.policy, f.now), PersistenceFailure);
});
test('retail unavailable and third-party FBA remain seller-scoped through both providers', async () => {
  for (const kind of ['BUSINESS_API', 'BROWSER'] as const) {
    const retail = await amazonReading(kind, 'unavailable'); const third = await amazonReading(kind, 'fba', 1000);
    assert.notEqual(restockScopeKey(retail.scope), restockScopeKey(third.scope));
    assert.equal(restockSample(third.input, third.policy, third.now).approvedAvailable, false);
  }
});
