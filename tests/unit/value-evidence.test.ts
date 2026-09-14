import test from 'node:test';
import assert from 'node:assert/strict';
import { add, assessEvidence, formatMoney, id, instant, known, MAX_MINOR, money, multiply, parseMoney, positiveInteger, ratio, ratioAtLeast, ref, sameRef, subtract, unknown } from '@ptcg/core';
import { evidence, NOW } from '../fixtures/scenarios.js';

test('money parses exact decimal minor units and serializes deterministically', () => {
  assert.deepEqual(parseMoney('1000.10', 'MXN'), money(100_010n, 'MXN'));
  assert.equal(formatMoney(parseMoney('-0.01', 'MXN')), '-0.01 MXN');
  assert.equal(formatMoney(add(parseMoney('0.1', 'MXN'), parseMoney('0.2', 'MXN'))), '0.30 MXN');
  assert.equal(subtract(money(0n, 'MXN'), money(1n, 'MXN')).minor, -1n);
  assert.equal(multiply(money(111n, 'MXN'), 3).minor, 333n);
  assert.ok(Object.isFrozen(money(1n, 'MXN')));
});

test('money rejects unsupported precision, floats, currency conversion and overflow', () => {
  for (const invalid of ['1.001', 'NaN', '1e3', '', ' 1', '1.', '+1', '1,000']) assert.throws(() => parseMoney(invalid, 'MXN'));
  assert.throws(() => add(money(1n, 'MXN'), money(1n, 'USD')), /Currency mismatch/);
  assert.throws(() => money(MAX_MINOR + 1n, 'MXN'));
  assert.throws(() => add(money(MAX_MINOR, 'MXN'), money(1n, 'MXN')));
  assert.throws(() => Reflect.apply(money, undefined, [0.1, 'MXN']));
  assert.throws(() => Reflect.apply(money, undefined, [1n, 'EUR']));
});

test('quantities and timestamps cannot accept unsafe or fractional inputs', () => {
  for (const n of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => positiveInteger(n));
  for (const n of [-1, 0.5, NaN, Infinity]) assert.throws(() => instant(n));
  assert.equal(instant(0), 0);
});

test('ratios use exact cross multiplication, including a value just below 20%', () => {
  assert.equal(ratio(1n, 0n), undefined);
  assert.throws(() => ratio(1n, -1n));
  assert.equal(ratioAtLeast({ numerator: 1n, denominator: 5n }, { numerator: 20n, denominator: 100n }), true);
  assert.equal(ratioAtLeast({ numerator: 19_999_999n, denominator: 100_000_000n }, { numerator: 1n, denominator: 5n }), false);
  assert.equal(ratioAtLeast({ numerator: -1n, denominator: 5n }, { numerator: 0n, denominator: 1n }), false);
});

test('external identifiers are scoped by store AND entity type', () => {
  const first = ref(id('store', 'a'), 'seller', '123');
  assert.equal(sameRef(first, ref(id('store', 'b'), 'seller', '123')), false);
  assert.equal(sameRef(first, ref(id('store', 'a'), 'offer', '123')), false);
  assert.equal(sameRef(first, ref(id('store', 'a'), 'seller', '123')), true);
  assert.throws(() => id('store', ' '));
  assert.throws(() => ref(id('store', 'a'), 'seller', ''));
});

test('known zero is distinct from unknown and not applicable', () => {
  assert.equal(assessEvidence(known(money(0n, 'MXN'), evidence('shipping')), NOW).status, 'PASS');
  assert.equal(assessEvidence(unknown('Not quoted', evidence('shipping')), NOW).status, 'INDETERMINATE');
  assert.equal(assessEvidence({ state: 'NOT_APPLICABLE', reason: 'Not supplied', evidence: evidence('shipping') }, NOW).status, 'INDETERMINATE');
});

test('fresh receipt does not refresh stale source evidence; expiry is exclusive', () => {
  const old = evidence('stock', NOW - 60_001);
  assert.equal(old.receivedAt, NOW);
  assert.equal(assessEvidence(known('IN_STOCK', { ...old, expiresAt: NOW + 1_000 }), NOW).code, 'STALE_EVIDENCE');
  assert.equal(assessEvidence(known(1, evidence('value', NOW - 60_000)), NOW).status, 'PASS');
  assert.equal(assessEvidence(known(1, { ...evidence('value'), expiresAt: NOW }), NOW).code, 'STALE_EVIDENCE');
});

test('invalid chronology, future time and missing provenance do not pass', () => {
  for (const e of [
    { ...evidence('price'), sourceObservedAt: NOW + 1 },
    { ...evidence('price'), receivedAt: NOW + 1 },
    { ...evidence('price'), capturedAt: NaN },
    { ...evidence('price'), sourceId: '' }
  ]) assert.equal(assessEvidence(known(1, e), NOW).code, 'INVALID_EVIDENCE');
});

test('compile-time IDs and money inputs reject cross-domain confusion', () => {
  if (false) {
    // @ts-expect-error Money cannot be constructed from binary floating point.
    money(1.5, 'MXN');
    // @ts-expect-error A canonical product ID is not a store ID.
    ref(id('canonical', 'p'), 'seller', 's');
  }
});
