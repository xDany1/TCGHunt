import test from 'node:test';
import assert from 'node:assert/strict';
import { externalId, parseProduct, productUrl, validateConfig } from '@ptcg/adapters';
import { ReadFailure } from '@ptcg/application';
import { matchProduct, known } from '@ptcg/core';
import { fixture } from '../fixtures/scenarios.js';
import { identity, product, response, shopConfig, shopifyFixtures, SOURCE, variant } from '../fixtures/shopify.js';

test('Shopify parser preserves exact IDs, options, price and explicit commercial identity', () => {
  const p = parseProduct(shopifyFixtures.normal.body);
  assert.equal(p.id, '100'); assert.equal(p.variants[0]?.id, '201');
  assert.deepEqual(p.variants[0]?.price, { minor: 100000n, currency: 'MXN' });
  assert.equal(p.variants[0]?.identity.language, 'en'); assert.equal(p.variants[0]?.identity.packUnits, 1);
  assert.equal(Object.isFrozen(p.variants), true);
});
test('multiple variants stay distinct despite title similarity; product titles never map canonical identity', () => {
  const p = parseProduct(shopifyFixtures.multiple.body);
  assert.deepEqual(p.variants.map(v => [v.id, v.identity.language, v.identity.packUnits]), [['201', 'en', 1], ['202', 'ja', 6]]);
  const same = parseProduct(shopifyFixtures.duplicateTitle.body);
  assert.equal(same.title, parseProduct(shopifyFixtures.normal.body).title); assert.equal(same.id, '101');
  assert.equal(parseProduct(shopifyFixtures.wrongType.body).variants[0]?.identity.kind, 'UNKNOWN');
});
test('missing optional identity, SKU, currency, quantity and price remain unknown', () => {
  const parsed = parseProduct(response(product({}, [variant({ sku: null, identity: null, quantityAvailable: null, availableForSale: null, price: null })])).body).variants[0];
  assert.ok(parsed); assert.equal(parsed.sku, null); assert.equal(parsed.price, null); assert.equal(parsed.quantity, null); assert.equal(parsed.available, null);
  assert.deepEqual(parsed.identity, { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null }); assert.equal(parsed.condition, 'UNKNOWN');
  for (const currencyCode of [null, 'EUR']) assert.equal(parseProduct(response(product({}, [variant({ price: { amount: '1000.00', currencyCode } })])).body).variants[0]?.price, null);
});
test('unknown product kind cannot pass a reviewed UNKNOWN-to-UNKNOWN mapping', () => {
  const f = fixture(); const value = { ...f.observation.variant.identity, kind: 'UNKNOWN' as const };
  const result = matchProduct({ ...f.request.target, identity: value }, { ...f.observation, identity: known(value, f.observation.identity.evidence), variant: { ...f.observation.variant, identity: value } }, f.request.mapping);
  assert.equal(result.checks.find(c => c.code === 'PRODUCT_KIND')?.status, 'INDETERMINATE');
});
const malformedVariants: Record<string, unknown>[] = [
  { id: 201 }, { id: 'gid://shopify/Product/201' }, { id: 'gid://shopify/ProductVariant/0201' }, { availableForSale: 'true' },
  { quantityAvailable: '2' }, { quantityAvailable: -1 }, { quantityAvailable: 1.2 }, { currentlyNotInStock: 1 },
  { price: { amount: 1000, currencyCode: 'MXN' } }, { price: { amount: '-1', currencyCode: 'MXN' } },
  { price: { amount: '1.001', currencyCode: 'MXN' } }, { price: { amount: '1e3', currencyCode: 'MXN' } },
  { price: { amount: '99999999999999999', currencyCode: 'MXN' } }, { price: { amount: '1', currencyCode: 'mxn' } },
  { identity: { value: '{' } }, { selectedOptions: [{ name: 'x', value: 'a' }, { name: 'x', value: 'b' }] }, { sku: 'x'.repeat(101) }
];
for (const [index, patch] of malformedVariants.entries()) test(`Shopify schema rejects malformed scalar/identity case ${index + 1}`, () => {
  assert.throws(() => parseProduct(response(product({}, [variant(patch)])).body), (e: unknown) => e instanceof ReadFailure && e.code === 'SCHEMA_MISMATCH');
});
test('malformed JSON, schema drift, duplicate IDs and truncated connections fail without best-effort guessing', () => {
  for (const body of [shopifyFixtures.malformed.body, shopifyFixtures.schemaDrift.body, response(product({}, [variant(), variant()])).body, response(product({ variants: { nodes: [variant()], pageInfo: { hasNextPage: true } } })).body]) assert.throws(() => parseProduct(body), ReadFailure);
  assert.throws(() => externalId('9007199254740993', 'Product'), ReadFailure);
  assert.equal(externalId('gid://shopify/Product/9007199254740993', 'Product'), '9007199254740993');
});
test('GraphQL error payloads map to typed failures and never include provider messages', () => {
  for (const [code, expected] of [['THROTTLED', 'RATE_LIMITED'], ['ACCESS_DENIED', 'AUTH_REQUIRED'], ['OTHER', 'SCHEMA_MISMATCH']]) {
    assert.throws(() => parseProduct(JSON.stringify({ errors: [{ message: 'PRIVATE-CANARY', extensions: { code } }] })), (e: unknown) => e instanceof ReadFailure && e.code === expected && !e.message.includes('CANARY'));
  }
});
test('language and pack size come only from explicit structured facts', () => {
  const p = parseProduct(response(product({}, [variant({ title: 'English single ETB', identity: { value: JSON.stringify({ ...identity, language: null, packUnits: null }) } })])).body);
  assert.equal(p.variants[0]?.identity.language, null); assert.equal(p.variants[0]?.identity.packUnits, null);
});
test('canonical URL allows approved host, selected variant and harmless tracking only', () => {
  assert.deepEqual(productUrl(`${SOURCE}&utm_source=owned#section`, shopConfig), { canonical: SOURCE, handle: 'fixture-etb', variantId: '201' });
  assert.equal(productUrl('https://MERCHANT.invalid/products/fixture-etb/', shopConfig).canonical, 'https://merchant.invalid/products/fixture-etb');
});
const invalidUrls = ['http://merchant.invalid/products/x', 'file:///products/x', 'https://user:pass@merchant.invalid/products/x', 'https://merchant.invalid.evil/products/x', 'https://127.0.0.1/products/x', 'https://169.254.169.254/products/x', 'https://10.0.0.1/products/x', 'https://[::1]/products/x', 'https://localhost/products/x', 'https://merchant.invalid:443/products/x', 'https://merchant.invalid/products/../x', 'https://merchant.invalid/products/%2e%2e', 'https://merchant.invalid/products/x?variant=1&variant=2', 'https://merchant.invalid/products/x?access_token=secret', 'https://merchant.invalid/products/x?variant=1e3', 'https://merchant.invalid/products/x?url=http://localhost', 'https://merchant.invalid\\@evil/products/x'];
for (const [i, url] of invalidUrls.entries()) test(`URL policy rejects unsafe or ambiguous source ${i + 1}`, () => assert.throws(() => productUrl(url, shopConfig), ReadFailure));
test('fixture policy cannot be switched to real domains or live access', () => {
  assert.throws(() => validateConfig({ ...shopConfig, canonicalDomain: 'example.com' }), ReadFailure);
  assert.throws(() => validateConfig({ ...shopConfig, mode: 'LIVE' as 'FIXTURE_ONLY' }), (e: unknown) => e instanceof ReadFailure && e.code === 'NETWORK_DISABLED');
});
