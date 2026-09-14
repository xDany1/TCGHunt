import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpportunity, evaluateRules, known, money, unknown } from '@ptcg/core';
import type { CostScenario, ListingObservation } from '@ptcg/core';
import { evidence, fixture, NOW } from '../fixtures/scenarios.js';

function calculate(o?: ListingObservation, scenario?: CostScenario) {
  const f = fixture('roi-below-threshold');
  return evaluateOpportunity({
    id: 'eval', target: f.request.target, observation: o ?? f.observation,
    scenario: scenario ?? f.request.scenario, quantity: 2, currency: 'MXN', now: NOW
  });
}

test('documented arithmetic: gross 900, net 300, exact ROI, margin and conservative break-even', () => {
  const result = calculate();
  assert.equal(result.status, 'COMPLETE');
  if (result.status !== 'COMPLETE') throw new Error('Expected complete');
  assert.equal(result.acquisitionCost.minor, 210_000n);
  assert.equal(result.fees.minor, 39_000n);
  assert.equal(result.grossProfit.minor, 90_000n);
  assert.equal(result.netProfit.minor, 30_000n);
  assert.deepEqual(result.roi, { numerator: 30_000n, denominator: 210_000n });
  assert.deepEqual(result.margin, { numerator: 30_000n, denominator: 300_000n });
  assert.equal(result.breakEven.minor, 265_518n);
  const f = fixture('roi-below-threshold');
  assert.equal(evaluateRules(f.request.purchasePolicy, f.observation, result, 2).checks.find(c => c.code === 'roi-limit')?.status, 'FAIL');
});

test('missing costs, currency mismatch and benchmark unit mismatch are indeterminate', () => {
  for (const name of ['missing-price', 'missing-shipping'] as const) assert.equal(calculate(fixture(name).observation).status, 'INDETERMINATE');
  const f = fixture();
  assert.equal(calculate({ ...f.observation, additionalTax: unknown('Not known', evidence('tax')) }).status, 'INDETERMINATE');
  assert.equal(calculate({ ...f.observation, shipping: known(money(0n, 'USD'), evidence('shipping')) }).status, 'INDETERMINATE');
  assert.equal(calculate(undefined, { ...f.request.scenario, benchmark: { ...f.request.scenario.benchmark, quantity: 1 } }).status, 'INDETERMINATE');
});

test('negative profit remains a negative estimate; fee rounding is conservative', () => {
  const f = fixture();
  const result = calculate(undefined, { ...f.request.scenario, benchmark: { ...f.request.scenario.benchmark, grossResale: known(money(101n, 'MXN'), evidence('resale')) } });
  if (result.status !== 'COMPLETE') throw new Error('Expected complete');
  assert.equal(result.fees.minor, 14n);
  assert.ok(result.netProfit.minor < 0n);
});

test('zero denominators produce unavailable ROI/margin, never infinity', () => {
  const f = fixture();
  const zero = known(money(0n, 'MXN'), evidence('zero'));
  const result = calculate({ ...f.observation, unitPrice: zero, shipping: zero },
    { ...f.request.scenario, outbound: zero, lossAllowance: zero, benchmark: { ...f.request.scenario.benchmark, grossResale: zero } });
  if (result.status !== 'COMPLETE') throw new Error('Expected complete');
  assert.equal(result.roi, undefined);
  assert.equal(result.margin, undefined);
  assert.equal(evaluateRules(f.request.purchasePolicy, f.observation, result, 2).checks.find(c => c.code === 'roi-limit')?.status, 'INDETERMINATE');
});

test('invalid fees and negative/over-discounted costs fail safely', () => {
  const f = fixture();
  for (const feeBasisPoints of [-1, 10_000, 1.5, NaN]) assert.throws(() => calculate(undefined, { ...f.request.scenario, feeBasisPoints }));
  assert.equal(calculate({ ...f.observation, shipping: known(money(-1n, 'MXN'), evidence('shipping')) }).status, 'INDETERMINATE');
  assert.equal(calculate(undefined, { ...f.request.scenario, verifiedDiscount: known(money(300_000n, 'MXN'), evidence('discount')) }).status, 'INDETERMINATE');
});

test('ALL is bounded and typed; a user rule cannot remove the maximum order cap', () => {
  const f = fixture();
  const empty = { ...f.request.purchasePolicy, expression: { op: 'ALL' as const, rules: [] }, maximumOrderValue: money(1n, 'MXN') };
  assert.equal(evaluateRules(empty, f.observation, calculate(), 2).status, 'FAIL');
  assert.throws(() => evaluateRules({ ...empty, expression: { op: 'ALL', rules: Array.from({ length: 33 }, (_, i) => ({ id: String(i), kind: 'QUANTITY_AT_MOST' as const, maximum: 2 })) } }, f.observation, calculate(), 2));
  const duplicate = { id: 'duplicate', kind: 'QUANTITY_AT_MOST' as const, maximum: 2 };
  assert.throws(() => evaluateRules({ ...empty, expression: { op: 'ALL', rules: [duplicate, duplicate] } }, f.observation, calculate(), 2));
});

test('rule comparisons preserve exact thresholds, unknown costs and currency', () => {
  const f = fixture('missing-price');
  assert.equal(evaluateRules(f.request.purchasePolicy, f.observation, calculate(f.observation), 2).checks.find(c => c.code === 'unit-price')?.status, 'INDETERMINATE');
  const good = fixture();
  const policy = {
    ...good.request.purchasePolicy, expression: {
      op: 'ALL' as const, rules: [
        { id: 'equal', kind: 'PRICE_AT_MOST' as const, maximum: money(100_000n, 'MXN') },
        { id: 'foreign', kind: 'SHIPPING_AT_MOST' as const, maximum: money(10_000n, 'USD') }
      ]
    }
  };
  const result = evaluateRules(policy, good.observation, calculate(), 2);
  assert.equal(result.checks.find(c => c.code === 'equal')?.status, 'PASS');
  assert.equal(result.checks.find(c => c.code === 'foreign')?.status, 'INDETERMINATE');
});
