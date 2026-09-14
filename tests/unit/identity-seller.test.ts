import test from 'node:test';
import assert from 'node:assert/strict';
import { id, known, matchProduct, ref, validateSeller } from '@ptcg/core';
import { evidence, fixture, NOW } from '../fixtures/scenarios.js';

for (const [name, status, code] of [
  ['correct-product-match', 'PASS', 'PRODUCT_LANGUAGE'],
  ['wrong-language', 'FAIL', 'PRODUCT_LANGUAGE'],
  ['wrong-pack-size', 'FAIL', 'PRODUCT_PACKUNITS']
] as const) test(`identity: ${name}`, () => {
  const f = fixture(name);
  const result = matchProduct(f.request.target, f.observation, f.request.mapping);
  assert.equal(result.status, status);
  assert.equal(result.checks.find(c => c.code === code)?.status, status);
});

test('unknown language and unreviewed mapping never silently become a match', () => {
  const f = fixture();
  const identity = { ...f.observation.variant.identity, language: null };
  const o = { ...f.observation, variant: { ...f.observation.variant, identity }, identity: known(identity, evidence('identity')) };
  assert.equal(matchProduct(f.request.target, o, f.request.mapping).status, 'INDETERMINATE');
  assert.equal(matchProduct(f.request.target, f.observation, { ...f.request.mapping, state: 'UNREVIEWED' }).status, 'INDETERMINATE');
});

test('mapping, seller and offer graph cannot cross store boundaries', () => {
  const f = fixture();
  const foreignVariant = ref(id('store', 'foreign'), 'variant', f.observation.variant.ref.externalId);
  assert.equal(matchProduct(f.request.target, { ...f.observation, offer: { ...f.observation.offer, variantRef: foreignVariant } }, f.request.mapping).status, 'FAIL');
  assert.equal(matchProduct(f.request.target, f.observation, { ...f.request.mapping, variantRef: foreignVariant }).status, 'INDETERMINATE');
});

test('allowlist approves exact seller; deny overrides an allow entry', () => {
  const f = fixture('seller-approval');
  assert.equal(validateSeller(f.observation, f.request.sellerPolicy, NOW).result, 'APPROVED');
  assert.equal(validateSeller(f.observation, { ...f.request.sellerPolicy, deny: [f.observation.offer.sellerRef] }, NOW).result, 'REJECTED');
});

test('display name and fulfillment do not establish a first-party seller', () => {
  const f = fixture();
  const p = { ...f.request.sellerPolicy, mode: 'FIRST_PARTY_ONLY' as const };
  assert.equal(validateSeller(f.observation, p, NOW).result, 'REVIEW_REQUIRED');
  assert.equal(validateSeller(f.observation, { ...p, firstParty: [f.observation.offer.sellerRef] }, NOW).result, 'APPROVED');
});

test('manual review and unlisted seller stay review-required; denylist mode still needs identity', () => {
  const f = fixture();
  assert.equal(validateSeller(f.observation, { ...f.request.sellerPolicy, mode: 'MANUAL_REVIEW' }, NOW).result, 'REVIEW_REQUIRED');
  assert.equal(validateSeller(f.observation, { ...f.request.sellerPolicy, allow: [] }, NOW).result, 'REVIEW_REQUIRED');
  assert.equal(validateSeller(f.observation, { ...f.request.sellerPolicy, mode: 'DENYLIST' }, NOW).result, 'APPROVED');
  const swapped = { ...f.observation, seller: known({ ref: ref(id('store', 'fake-mx'), 'seller', 'other'), displayName: 'Synthetic Merchant' }, evidence('seller')) };
  assert.equal(validateSeller(swapped, { ...f.request.sellerPolicy, mode: 'DENYLIST' }, NOW).result, 'REVIEW_REQUIRED');
});

test('stale seller evidence cannot approve even an allowlisted seller', () => {
  const f = fixture('stale-observation');
  const result = validateSeller(f.observation, f.request.sellerPolicy, NOW);
  assert.equal(result.result, 'REVIEW_REQUIRED');
  assert.ok(result.checks.some(c => c.code === 'STALE_EVIDENCE'));
});
