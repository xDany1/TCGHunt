import { ref } from '@ptcg/core';
import type { MonitorDefinition, ReadContext } from '@ptcg/application';
import { AMAZON_FIXTURE_SCOPE, AMAZON_FIXTURE_STORE, AMAZON_MX_MARKETPLACE, AmazonQualificationAdapter, qualifyAmazonFixture } from '@ptcg/adapters';
import type { AmazonFixtureCapture, AmazonFixtureReview } from '@ptcg/adapters';
import { durableFixture } from './durable.js';
import { NOW } from './scenarios.js';

// Entirely authored data, including these fictitious ASIN-shaped IDs and seller IDs.
// Not captured from Amazon; no assertion that any identifier names a real product/merchant.
export const ASIN = 'B0M5FIX001';
export const CHILD = 'B0M5FIX002';
export const PARENT = 'B0M5FIX000';
export const RETAIL = 'SYNTHETIC_RETAIL';
export const THIRD = 'SYNTHETIC_THIRD';
export const context: ReadContext = { now: NOW, deadlineAt: NOW + 15000, operationId: 'amazon-test', traceId: 'amazon-test', currency: 'MXN', deliveryScope: AMAZON_FIXTURE_SCOPE, sourceReference: ASIN };
export const review: AmazonFixtureReview = { asin: ASIN, identity: { kind: 'SEALED', set: 'fixture-set', edition: 'booster-pack', language: 'es', packUnits: 1 }, factorySealed: true, evidenceRef: 'authored-product-review-v1' };
export function catalog(asin = ASIN, patch: Record<string, unknown> = {}) {
  return { asin, summaries: [{ marketplaceId: AMAZON_MX_MARKETPLACE, itemName: 'Synthetic Pokémon Spanish booster pack' }], relationships: [], ...patch };
}
export function offer(patch: Record<string, unknown> = {}) {
  return {
    SellerId: RETAIL, SubCondition: 'New', IsFulfilledByAmazon: true, ListingPrice: { Amount: 95.01, CurrencyCode: 'MXN' }, Shipping: { Amount: 0, CurrencyCode: 'MXN' },
    ShippingTime: { availabilityType: 'NOW' }, IsBuyBoxWinner: true, PrimeInformation: { IsPrime: true, IsNationalPrime: false }, ...patch
  };
}
export function response(offers = [offer()], product = catalog(), patch: Partial<AmazonFixtureCapture> = {}): AmazonFixtureCapture {
  return { catalogBody: JSON.stringify(product), offersBody: JSON.stringify({ payload: { ASIN: product.asin, status: 'Success', Identifier: { ASIN: product.asin, MarketplaceId: AMAZON_MX_MARKETPLACE, ItemCondition: 'New' }, Offers: offers } }), status: 200, capturedAt: NOW - 1000, sourceObservedAt: NOW - 1000, ...patch };
}
export const amazonFixtures = {
  retailInStock: response(), retailUnavailable: response([offer({ ShippingTime: { availabilityType: 'FUTURE_WITHOUT_DATE' } })]),
  thirdPartyInStock: response([offer({ SellerId: THIRD })]), thirdPartyUnreviewed: response([offer({ SellerId: THIRD, SellerFeedbackRating: { FeedbackCount: 5000, SellerPositiveFeedbackRating: 100 } })]),
  thirdPartyFba: response([offer({ SellerId: THIRD, IsFulfilledByAmazon: true })]), thirdPartyMfn: response([offer({ SellerId: THIRD, IsFulfilledByAmazon: false })]),
  multipleOffers: response([offer(), offer({ SellerId: THIRD, IsBuyBoxWinner: false })]), noOffer: response([]),
  priceChange: response([offer({ ListingPrice: { Amount: 90.01, CurrencyCode: 'MXN' } })]), sellerChange: response([offer({ SellerId: THIRD })]), fulfillmentChange: response([offer({ IsFulfilledByAmazon: false })]),
  child: response([offer()], catalog(CHILD, { relationships: [{ marketplaceId: AMAZON_MX_MARKETPLACE, relationships: [{ type: 'VARIATION', parentAsins: [PARENT] }] }] })),
  parent: response([], catalog(PARENT, { relationships: [{ marketplaceId: AMAZON_MX_MARKETPLACE, relationships: [{ type: 'VARIATION', childAsins: [ASIN, CHILD] }] }] })),
  unknownShipping: response([offer({ Shipping: undefined })]), incompleteAvailability: response([offer({ ShippingTime: {} })]),
  ambiguousTitle: response([offer()], catalog(ASIN, { summaries: [{ marketplaceId: AMAZON_MX_MARKETPLACE, itemName: 'Pokémon pack box bundle English Español x1 x6' }] })),
  duplicateObservation: response(), malformed: response([], catalog(), { offersBody: '{' }), authFailure: response([], catalog(), { status: 401 }), throttled: response([], catalog(), { status: 429, retryAfterMs: 10000 }),
  missingSeller: response([offer({ SellerId: undefined })]), missingFulfillment: response([offer({ IsFulfilledByAmazon: undefined })]), missingPrice: response([offer({ ListingPrice: undefined })]),
  preorder: response([offer({ ShippingTime: { availabilityType: 'FUTURE_WITH_DATE', availableDate: '2027-02-01T00:00:00Z' } })]),
  timeout: response([], catalog(), { failure: 'TIMEOUT' }), networkFailure: response([], catalog(), { failure: 'NETWORK' })
};
export const ambiguityCases = [
  ['English vs Spanish', 'English booster pack', { language: 'en' }],
  ['pack vs box', 'Spanish booster box', { edition: 'booster-box', packUnits: 36 }],
  ['bundle vs ETB', 'Elite Trainer Box booster bundle', { edition: 'etb', packUnits: 9 }],
  ['single pack vs multipack', 'Booster pack 6 count', { packUnits: 6 }],
  ['resealed open box', 'Resealed opened booster', { kind: 'UNKNOWN' }],
  ['individual card', 'One rare Pokémon card', { kind: 'UNKNOWN' }],
  ['import', 'Japanese import international edition', { language: 'ja', edition: 'import' }],
  ['preorder', 'Preorder Spanish booster', {}],
  ['accessory bundle', 'Booster with sleeves and binder', { edition: 'accessory-bundle' }],
  ['variation counts', 'Choose one or 36 packs', { packUnits: null }],
  ['identifier conflict', 'Spanish booster (identifier points to English box)', { language: 'en', edition: 'booster-box', packUnits: 36 }]
] as const;

export function amazonMonitor(capture = amazonFixtures.retailInStock, approved = true, reviewed = true) {
  const q = qualifyAmazonFixture(ASIN, capture, context, reviewed ? review : undefined);
  const o = q.observations[0]; if (!o) throw new Error('Fixture needs a resolved offer');
  const f = durableFixture(); const target = { ...f.definition.configuration.target, identity: review.identity };
  const definition: MonitorDefinition = {
    ...f.definition, configuration: {
      ...f.definition.configuration,
      target, mapping: { version: 'amazon-fixture-map-v1', canonicalId: target.id, variantRef: o.variant.ref, state: reviewed ? 'REVIEWED' : 'UNREVIEWED' },
      offerRef: o.offer.ref, sourceReference: ASIN, deliveryScope: AMAZON_FIXTURE_SCOPE,
      sellerPolicy: { version: 'amazon-seller-v1', mode: 'ALLOWLIST', allow: approved ? [ref(AMAZON_FIXTURE_STORE, 'seller', RETAIL)] : [], deny: [], firstParty: [ref(AMAZON_FIXTURE_STORE, 'seller', RETAIL)] }
    }
  };
  return { ...f, definition, observation: o, adapter: new AmazonQualificationAdapter(capture, reviewed ? review : undefined) };
}
