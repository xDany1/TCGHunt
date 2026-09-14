import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { evaluateSimulation } from '@ptcg/application';
import type { EvaluationResult, SimulationRequest } from '@ptcg/application';
import { FakeStoreAdapter } from '@ptcg/adapters';
import { id, known, money, nextAttemptState, nextIntentState, ref, simulate, unknown } from '@ptcg/core';
import type { AttemptState, IntentState, SimulationResult } from '@ptcg/core';
import { evidence, fixture, NOW, scenarioNames } from '../fixtures/scenarios.js';
import type { ScenarioName } from '../fixtures/scenarios.js';

function evaluated(result: EvaluationResult) {
  if (result.status !== 'EVALUATED') throw new Error(`Unexpected adapter error: ${result.error.code}`);
  return result;
}
const expected: Readonly<Record<ScenarioName, { state: 'SIMULATED' | 'BLOCKED'; reason?: string; }>> = {
  'correct-product-match': { state: 'SIMULATED' },
  'wrong-language': { state: 'BLOCKED', reason: 'PRODUCT_LANGUAGE' },
  'wrong-pack-size': { state: 'BLOCKED', reason: 'PRODUCT_PACKUNITS' },
  'seller-rejection': { state: 'BLOCKED', reason: 'SELLER_DENYLIST' },
  'seller-approval': { state: 'SIMULATED' },
  'missing-price': { state: 'BLOCKED', reason: 'MISSING_EVIDENCE' },
  'missing-shipping': { state: 'BLOCKED', reason: 'MISSING_EVIDENCE' },
  'stale-observation': { state: 'BLOCKED', reason: 'STALE_EVIDENCE' },
  'out-of-stock': { state: 'BLOCKED', reason: 'IN_STOCK' },
  'roi-below-threshold': { state: 'BLOCKED', reason: 'roi-limit' },
  'valid-simulated-opportunity': { state: 'SIMULATED' }
};

for (const name of scenarioNames) test(`M1 slice: ${name}`, async () => {
  const f = fixture(name);
  const result = evaluated(await evaluateSimulation(new FakeStoreAdapter([f.observation]), f.request));
  assert.equal(result.simulation.intentState, expected[name].state);
  assert.equal(result.simulation.mode, 'DRY_RUN');
  assert.equal(result.simulation.audit.action, expected[name].state === 'SIMULATED' ? 'PURCHASE_WOULD_HAVE_EXECUTED' : 'PURCHASE_BLOCKED');
  if (expected[name].reason) assert.ok(result.simulation.checks.some(c => c.code === expected[name].reason && c.status !== 'PASS'));
  assert.equal(result.simulation.scope.observationId, f.observation.id);
  assert.equal(result.simulation.scope.mappingVersion, 'mapping-v1');
  assert.equal(result.simulation.scope.sellerPolicyVersion, 'seller-v1');
  assert.equal(result.simulation.scope.purchasePolicyVersion, 'rules-v1');
  assert.ok(result.simulation.audit.evidenceIds.length > 0);
  assert.ok(Object.isFrozen(result.simulation.transitions));
});

test('the passing slice uses only explicit intent/attempt DRY_RUN transitions', async () => {
  const f = fixture();
  const { simulation } = evaluated(await evaluateSimulation(new FakeStoreAdapter([f.observation]), f.request));
  assert.deepEqual(simulation.transitions.filter(t => t.aggregate === 'PurchaseIntent').map(t => [t.from, t.to]), [
    ['CREATED', 'VALIDATING'], ['VALIDATING', 'READY'], ['READY', 'IN_PROGRESS'], ['IN_PROGRESS', 'SIMULATED']
  ]);
  assert.deepEqual(simulation.transitions.filter(t => t.aggregate === 'CheckoutAttempt').map(t => [t.from, t.to]), [
    ['CREATED', 'READY'], ['READY', 'SIMULATED']
  ]);
  assert.ok(simulation.transitions.every(t => t.at === NOW));
  assert.equal(simulation.attemptState, 'SIMULATED');
});

test('invalid transitions and all post-simulation transitions are rejected', () => {
  const intentStates: readonly IntentState[] = ['CREATED', 'VALIDATING', 'READY', 'IN_PROGRESS', 'SIMULATED', 'BLOCKED'];
  for (const next of intentStates) assert.throws(() => nextIntentState('SIMULATED', next));
  const attemptStates: readonly AttemptState[] = ['CREATED', 'READY', 'SIMULATED'];
  for (const next of attemptStates) assert.throws(() => nextAttemptState('SIMULATED', next));
  assert.throws(() => nextIntentState('CREATED', 'SIMULATED'));
  assert.throws(() => nextAttemptState('CREATED', 'SIMULATED'));
  assert.throws(() => Reflect.apply(nextAttemptState, undefined, ['READY', 'SUBMITTING']));
});

test('mode cannot be changed by runtime input or mutable result references', async () => {
  const f = fixture();
  const adapter = new FakeStoreAdapter([f.observation]);
  for (const mode of ['LIVE', 'ASSISTED', false, true, null]) {
    await assert.rejects(() => Reflect.apply(evaluateSimulation, undefined, [adapter, { ...f.request, mode }]), /DRY_RUN/);
  }
  const { simulation } = evaluated(await evaluateSimulation(adapter, f.request));
  assert.equal(Reflect.set(simulation, 'mode', 'LIVE'), false);
  assert.equal(Reflect.set(simulation.scope, 'quantity', 99), false);
  assert.throws(() => Reflect.apply(simulate, undefined, [simulation.scope, simulation.checks, NOW, 'LIVE']));
  assert.equal(simulate(simulation.scope, [], NOW).intentState, 'BLOCKED');
});

test('all fixture paths and repeated evaluations make zero network calls', async t => {
  const attempted: string[] = [];
  const deny = (name: string) => () => { attempted.push(name); throw new Error(`Unexpected external effect: ${name}`); };
  t.mock.method(globalThis, 'fetch', deny('fetch'));
  t.mock.method(http, 'request', deny('http.request'));
  t.mock.method(https, 'request', deny('https.request'));
  t.mock.method(net.Socket.prototype, 'connect', deny('socket.connect'));
  for (const name of scenarioNames) {
    const f = fixture(name);
    const adapter = new FakeStoreAdapter([f.observation]);
    const first = await evaluateSimulation(adapter, f.request);
    const again = await evaluateSimulation(adapter, f.request);
    assert.deepEqual(first, again);
    assert.equal('order' in evaluated(first), false);
  }
  assert.deepEqual(attempted, []);
});

test('empty user rules cannot bypass stock, seller, identity, freshness, or missing costs', async () => {
  for (const name of ['out-of-stock', 'seller-rejection', 'wrong-language', 'missing-price', 'missing-shipping', 'stale-observation'] as const) {
    const f = fixture(name);
    const request = { ...f.request, purchasePolicy: { ...f.request.purchasePolicy, expression: { op: 'ALL' as const, rules: [] } } };
    const result = evaluated(await evaluateSimulation(new FakeStoreAdapter([f.observation]), request));
    assert.equal(result.simulation.intentState, 'BLOCKED');
  }
});

test('unknown, invalid, and exceeded purchase limits do not simulate a buy', async () => {
  const f = fixture();
  for (const purchaseLimit of [unknown<number>('Not provided', evidence('purchaseLimit')), known(1, evidence('purchaseLimit')), known(-1, evidence('purchaseLimit')), known(NaN, evidence('purchaseLimit'))]) {
    const o = { ...f.observation, purchaseLimit };
    assert.equal(evaluated(await evaluateSimulation(new FakeStoreAdapter([o]), f.request)).simulation.intentState, 'BLOCKED');
  }
  const r = { ...f.request, purchasePolicy: { ...f.request.purchasePolicy, maximumOrderValue: money(1n, 'MXN') } };
  assert.equal(evaluated(await evaluateSimulation(new FakeStoreAdapter([f.observation]), r)).simulation.intentState, 'BLOCKED');
});

test('an adapter cannot silently substitute a different offer', async () => {
  const f = fixture();
  const adapter = new FakeStoreAdapter([f.observation]);
  const substituted = { descriptor: adapter.descriptor, observe: () => Promise.resolve({ ok: true as const, observation: f.observation }) };
  const r = { ...f.request, offerRef: ref(id('store', 'fake-mx'), 'offer', 'another-offer') };
  assert.equal(evaluated(await evaluateSimulation(substituted, r)).simulation.intentState, 'BLOCKED');
});

test('typed adapter failure does not fabricate a domain decision or audit event', async () => {
  const f = fixture();
  const result = await evaluateSimulation(new FakeStoreAdapter([]), f.request);
  assert.equal(result.status, 'READ_FAILED');
  assert.equal('simulation' in result, false);
});

test('request policies cannot change while an asynchronous observation is pending', async () => {
  const f = fixture();
  const request = { ...f.request, purchasePolicy: { ...f.request.purchasePolicy } };
  const adapter = new FakeStoreAdapter([f.observation]);
  const delayed = {
    descriptor: adapter.descriptor, observe: async () => {
      await Promise.resolve();
      assert.equal(Reflect.set(request.purchasePolicy, 'maximumOrderValue', money(1n, 'MXN')), false);
      return { ok: true as const, observation: f.observation };
    }
  };
  assert.equal(evaluated(await evaluateSimulation(delayed, request)).simulation.intentState, 'SIMULATED');
});

test('compile-time mode and attempt types contain no live execution path', () => {
  if (false) {
    const r = fixture().request;
    // @ts-expect-error M1 cannot request LIVE.
    const forbidden: SimulationRequest = { ...r, mode: 'LIVE' };
    void forbidden;
    // @ts-expect-error M1 cannot submit an order.
    nextAttemptState('READY', 'SUBMITTING');
  }
  const ensureMode = (value: SimulationResult['mode']) => value;
  assert.equal(ensureMode('DRY_RUN'), 'DRY_RUN');
});
