import { readFileSync } from 'node:fs';
import { AmazonBusinessApiProvider, AmazonBrowserProvider, AmazonObservationService, amazonUrl } from '@ptcg/adapters';
import type { AmazonBusinessCapture, AmazonHtmlCapture, AmazonProviderKind, AmazonTarget, AmazonProductReview } from '@ptcg/adapters';
import { id, ref } from '@ptcg/core';
import type { MonitorDefinition, ReadContext } from '@ptcg/application';
import { durableFixture } from './durable.js';

export const P_ASIN = 'B0M5TEST01'; export const P_CHILD = 'B0M5TEST02'; export const P_RETAIL = 'SYNTHETIC_RETAIL'; export const P_THIRD = 'SYNTHETIC_THIRD';
export const P_NOW = 1800000000000; export const P_SCOPE = 'amazon-mx:authored-equivalent-context';
export const pTarget: AmazonTarget = { asin: P_ASIN, url: amazonUrl(P_ASIN).canonical, marketplace: 'MX', deliveryScope: P_SCOPE };
export const pContext: ReadContext = { now: P_NOW, deadlineAt: P_NOW + 1000, currency: 'MXN', deliveryScope: P_SCOPE, operationId: 'm5.2-op', traceId: 'm5.2-trace', sourceReference: P_ASIN };
export const pReview: AmazonProductReview = { asin: P_ASIN, evidenceRef: 'authored-pack-review', factorySealed: true, identity: { kind: 'SEALED', set: 'synthetic-set', edition: 'booster-pack', language: 'es', packUnits: 1 } };
export function businessProduct(patch: Record<string, unknown> = {}) {
  return { asin: P_ASIN, asinType: 'STANDARD', signedProductId: 'SYNTHETIC_NOT_A_CREDENTIAL', title: 'Synthetic Spanish booster pack', url: pTarget.url, ...patch };
}
export function businessOffer(patch: Record<string, unknown> = {}) {
  return {
    offerId: 'SYNTHETIC_OFFER', availability: 'In stock', buyingGuidance: 'NONE', buyingRestrictions: [],
    merchant: { merchantId: P_RETAIL, name: 'Amazon', meanFeedbackRating: 5, totalFeedbackCount: 1, certificates: [] },
    fulfillmentType: 'AMAZON_FULFILLMENT', fulfiller: { name: 'Amazon', fulfillmentType: 'AMAZON_FULFILLMENT' },
    price: { value: { amount: 95.01, currencyCode: 'MXN' }, formattedPrice: 'MXN 95.01', priceType: 'BUSINESS' },
    productCondition: 'NEW', condition: { conditionValue: 'NEW', conditionNote: '', subCondition: 'NEW' }, quantityLimits: { minQuantity: 1, maxQuantity: 10 },
    shippingOptions: [{ shippingCost: { value: { amount: 0, currencyCode: 'MXN' } }, deliveryRange: { min: '2027-01-15T12:00:00Z', max: '2027-01-16T12:00:00Z' }, deliveryInformation: 'Authored delivery quote', thresholdCost: { value: { amount: 500, currencyCode: 'MXN' } } }], badges: [], ...patch
  };
}
export function businessCapture(offers = [businessOffer()], product = businessProduct(), patch: Partial<AmazonBusinessCapture> = {}): AmazonBusinessCapture {
  return {
    fixtureId: 'business-authored', target: pTarget, capturedAt: P_NOW - 1000, sourceObservedAt: P_NOW - 1000,
    product: { status: 200, body: JSON.stringify(product) }, offers: { status: 200, body: JSON.stringify({ offers, offerCount: offers.length, numberOfPages: 1, ...(offers[0] ? { featuredOffer: offers[0] } : {}) }) }, ...patch
  };
}
const third = { merchantId: P_THIRD, name: 'Fixture Merchant', meanFeedbackRating: 5, totalFeedbackCount: 9999, certificates: [] };
export const businessFixtures = {
  retail: businessCapture(), unavailable: businessCapture([businessOffer({ availability: 'Currently unavailable' })]),
  fba: businessCapture([businessOffer({ merchant: third })]),
  thirdParty: businessCapture([businessOffer({ merchant: third, fulfillmentType: 'MERCHANT_FULFILLMENT', fulfiller: { name: 'Fixture Merchant', fulfillmentType: 'MERCHANT_FULFILLMENT' } })]),
  multiple: businessCapture([businessOffer(), businessOffer({ offerId: 'SYNTHETIC_OTHER', merchant: third })]), noOffer: businessCapture([]),
  missingSeller: businessCapture([businessOffer({ merchant: undefined })]), missingFulfillment: businessCapture([businessOffer({ fulfillmentType: undefined, fulfiller: undefined })]),
  missingShipping: businessCapture([businessOffer({ shippingOptions: undefined })]), missingPrice: businessCapture([businessOffer({ price: undefined })]),
  parent: businessCapture([], businessProduct({ asinType: 'VARIATION_PARENT', productVariations: { dimensions: [{ index: 0, displayString: 'Language', dimensionValues: [{ index: 0, displayString: 'Spanish' }] }], variations: [{ asin: P_CHILD, variationValues: [{ index: 0, value: 0 }] }] } })),
  child: businessCapture([businessOffer()], businessProduct({ asin: P_CHILD, url: amazonUrl(P_CHILD).canonical, asinType: 'VARIATION_CHILD' }), { target: { ...pTarget, asin: P_CHILD, url: amazonUrl(P_CHILD).canonical } }),
  malformed: businessCapture([], businessProduct(), { offers: { status: 200, body: '{' } }),
  auth: businessCapture([], businessProduct(), { product: { status: 401, body: '{"errors":[{"code":"Unauthorized","message":"Synthetic access denied"}]}' } }),
  throttled: businessCapture([], businessProduct(), { offers: { status: 429, body: '{"errors":[{"code":"TooManyRequests","message":"Synthetic rate limit"}]}' } }),
  timeout: businessCapture([], businessProduct(), { failure: 'TIMEOUT' }), network: businessCapture([], businessProduct(), { failure: 'NETWORK' })
};
export const htmlNames = ['retail', 'unavailable', 'thirdParty', 'fba', 'separateSellerShipper', 'missingPrice', 'missingSeller', 'alternate', 'challenge', 'denied', 'noOffer', 'incomplete', 'buttonOnly', 'mismatch', 'missingFulfillment'] as const;
export function htmlCapture(name: typeof htmlNames[number] = 'retail', patch: Partial<AmazonHtmlCapture> = {}): AmazonHtmlCapture {
  return { fixtureId: `html-${name}`, target: pTarget, capturedAt: P_NOW - 1000, sourceObservedAt: P_NOW - 1000, status: 200, html: readFileSync(`tests/fixtures/amazon-providers/${name}.html`, 'utf8'), ...patch };
}
export function apiProvider(c = businessFixtures.retail) { return new AmazonBusinessApiProvider({ mode: 'FIXTURE_ONLY', async lookup() { return c; } }); }
export function browserProvider(c = htmlCapture()) { return new AmazonBrowserProvider({ mode: 'FIXTURE_ONLY', async readPage() { return c; } }); }
export function pService(kind: AmazonProviderKind, c?: AmazonBusinessCapture | AmazonHtmlCapture, reviewed = true) {
  const provider = kind === 'BUSINESS_API' ? apiProvider(c && 'product' in c ? c : businessFixtures.retail) : browserProvider(c && 'html' in c ? c : htmlCapture());
  return new AmazonObservationService({ provider: kind, marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => P_NOW, [P_RETAIL], reviewed ? pReview : undefined);
}
export async function providerMonitor(kind: AmazonProviderKind, capture?: AmazonBusinessCapture | AmazonHtmlCapture, reviewed = true) {
  const adapter = pService(kind, capture, reviewed); const q = await adapter.inspect(P_ASIN, pContext); const observation = q.observations[0]; if (!observation) throw new Error('Expected fixture offer');
  const f = durableFixture(); const target = { ...f.definition.configuration.target, identity: pReview.identity };
  const definition: MonitorDefinition = {
    ...f.definition, monitorId: id('monitor', `m5.2-${kind}`), configuration: {
      ...f.definition.configuration, target, mapping: { version: 'm5.2-map', canonicalId: target.id, variantRef: observation.variant.ref, state: reviewed ? 'REVIEWED' : 'UNREVIEWED' },
      offerRef: observation.offer.ref, sourceReference: P_ASIN, deliveryScope: P_SCOPE,
      sellerPolicy: { version: 'm5.2-policy', mode: 'ALLOWLIST', allow: [ref(observation.offer.ref.storeId, 'seller', P_RETAIL)], deny: [], firstParty: [ref(observation.offer.ref.storeId, 'seller', P_RETAIL)] }
    }
  };
  return { ...f, definition, adapter, observation, command: { ...f.command, monitorId: definition.monitorId, now: P_NOW } };
}
