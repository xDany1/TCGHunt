import test from 'node:test';
import assert from 'node:assert/strict';
import { guardTransition, PersistenceFailure, utcDay, validateLimits } from '@ptcg/application';
import { id, money } from '@ptcg/core';
import type { SimulatedLimitPolicy } from '@ptcg/application';

function limits(patch: Partial<SimulatedLimitPolicy> = {}): SimulatedLimitPolicy {
  return { ownerId: id('local-owner', 'owner'), version: 1, timezone: 'UTC', dailySpend: money(250_000n, 'MXN'), productCampaignQuantity: 2, dailyAttempts: 1, cooldownMs: 60_000, ...patch };
}

test('durable transition guard rejects stale version/state before checking edges', () => {
  assert.throws(() => guardTransition('CheckoutAttempt', { state: 'READY', version: 1 }, { state: 'READY', version: 0 }, 'SIMULATED'), { code: 'STALE_VERSION' });
  assert.throws(() => guardTransition('PurchaseIntent', { state: 'SIMULATED', version: 4 }, { state: 'IN_PROGRESS', version: 4 }, 'SIMULATED'), { code: 'STALE_VERSION' });
  assert.equal(guardTransition('CheckoutAttempt', { state: 'READY', version: 1 }, { state: 'READY', version: 1 }, 'SIMULATED'), 2);
});
test('durable transition guard preserves M1 terminal states and forbids live edges', () => {
  for (const to of ['SUBMITTING', 'CREATED', 'READY', 'SIMULATED']) {
    assert.throws(() => guardTransition('CheckoutAttempt', { state: 'SIMULATED', version: 2 }, { state: 'SIMULATED', version: 2 }, to), { code: 'INVALID_TRANSITION' });
  }
  assert.equal(guardTransition('PurchaseIntent', { state: 'BLOCKED', version: 2 }, { state: 'BLOCKED', version: 2 }, 'VALIDATING'), 3);
});
test('daily bucket boundaries are explicit UTC, half-open, and independent of ambient time', () => {
  assert.deepEqual(utcDay(86_399_999), { start: 0, end: 86_400_000 });
  assert.deepEqual(utcDay(86_400_000), { start: 86_400_000, end: 172_800_000 });
  assert.throws(() => utcDay(-1));
});
test('simulated limit policy validates currency, caps, counts and timezone', () => {
  validateLimits(limits());
  assert.throws(() => validateLimits(limits({ dailySpend: money(-1n, 'MXN') })), PersistenceFailure);
  assert.throws(() => validateLimits(limits({ dailyAttempts: 0 })));
  assert.throws(() => validateLimits(limits({ productCampaignQuantity: 1.5 })));
  assert.throws(() => Reflect.apply(validateLimits, undefined, [{ ...limits(), timezone: 'LOCAL' }]), PersistenceFailure);
});
