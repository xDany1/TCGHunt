import { freeze, id, known, ref, refKey, unknown } from '@ptcg/core';
import type { Evidence, ListingObservation, ProductIdentity } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import type { CatalogMetadata, ProductPageObservation } from '@ptcg/application';
import { AMAZON_PROVIDER_VERSION, amazonDigest } from './contract.js';
import type { NormalizedAmazonObservation } from './normalize.js';

export const AMAZON_PROVIDER_STORE = id('store', 'amazon-mx-m5.2-fixtures');
export interface AmazonProductReview { readonly asin: string; readonly identity: ProductIdentity; readonly factorySealed: boolean; readonly evidenceRef: string; }
const UNREVIEWED: ProductIdentity = { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null };
export function mapAmazonDomain(n: NormalizedAmazonObservation, deliveryScope: string, review?: AmazonProductReview) {
  const live = n.source.confidence === 'LIVE_CAPTURE';
  const storeId = live ? id('store', 'amazon-mx-m5.4-browser-live') : AMAZON_PROVIDER_STORE;
  if (review && (review.asin !== n.asin || !review.evidenceRef.trim() || review.identity.kind !== 'SEALED' || !review.identity.set || !review.identity.edition || !review.identity.language || !Number.isSafeInteger(review.identity.packUnits) || (review.identity.packUnits ?? 0) <= 0)) throw new ReadFailure('CONTEXT_MISMATCH');
  const identity = review?.identity ?? UNREVIEWED; const productRef = ref(storeId, 'product', n.asin);
  const variantRef = ref(storeId, 'variant', `singleton:${n.asin}`); const listingRef = ref(storeId, 'listing', `detail:${n.asin}`);
  const captureId = amazonDigest(JSON.stringify([n, deliveryScope, review ?? null], (_k, v: unknown) => typeof v === 'bigint' ? String(v) : v));
  const evidence = (field: string): Evidence => ({
    id: `${captureId}:${field}`, sourceId: `amazon:${n.source.provider}:${live ? 'live' : 'fixture'}:${n.source.fixtureId}`, sourceVersion: n.source.provider === 'BUSINESS_API' ? 'business-product-search-2020-08-26' : live ? n.source.parserVersion : 'authored-semantic-html-v1',
    captureId, adapterVersion: AMAZON_PROVIDER_VERSION, parserVersion: n.source.parserVersion, field, rights: live ? 'PERMITTED' : 'SYNTHETIC',
    sourceObservedAt: n.source.sourceObservedAt, capturedAt: n.source.capturedAt, receivedAt: n.source.capturedAt, expiresAt: n.source.sourceObservedAt + 60_000
  });
  const observations: ListingObservation[] = [];
  for (const o of n.offers) {
    // Parent/unknown variant and missing seller are findings, never invented purchasable identities.
    if (n.asinType === 'VARIATION_PARENT' || (n.asinType === 'UNKNOWN' && !n.selectedAsin) || n.childAsins.length || !o.sellerId) continue;
    const sellerRef = ref(storeId, 'seller', o.sellerId);
    const condition = review?.factorySealed && o.condition === 'NEW' && o.subCondition === 'NEW' ? 'NEW_SEALED' as const : 'UNKNOWN' as const;
    const offerRef = ref(storeId, 'offer', JSON.stringify(['amazon-offer-v2', n.asin, o.sellerId, o.fulfillment, o.condition, o.subCondition, condition, deliveryScope]));
    const e = (field: string) => evidence(`${amazonDigest(refKey(offerRef))}:${field}`);
    observations.push({
      ...(n.productState ? { purchaseMode: n.productState.purchaseMode === 'UNKNOWN' ? unknown('PURCHASE_MODE_UNKNOWN', e('purchaseMode')) : known(n.productState.purchaseMode, e('purchaseMode')) } : {}),
      id: id('observation', amazonDigest(`${captureId}:${refKey(offerRef)}`)), product: { ref: productRef, title: n.title ?? `ASIN ${n.asin}` },
      variant: { ref: variantRef, productRef, identity }, listing: { ref: listingRef, productRef, variantRef }, offer: { ref: offerRef, listingRef, variantRef, sellerRef, condition, deliveryScope },
      identity: review ? known(identity, e(`identity:${review.evidenceRef}`)) : unknown('PRODUCT_IDENTITY_UNREVIEWED', e('identity')),
      seller: known({ ref: sellerRef, displayName: o.sellerDisplayName ?? `Seller ID ${o.sellerId}` }, e('seller')),
      fulfilledBy: o.fulfillment === 'UNKNOWN' ? unknown('FULFILLMENT_UNKNOWN', e('fulfillment')) : known(o.fulfillment === 'AMAZON' ? ref(storeId, 'seller', 'fulfillment:amazon') : sellerRef, e('fulfillment')),
      unitPrice: o.price ? known(o.price, e('price')) : unknown('PRICE_UNKNOWN', e('price')),
      // Provider shipping is a quote, not verified buyer/quantity/tax evidence. Keep execution conservative.
      shipping: unknown('BUYER_SHIPPING_CONTEXT_UNVALIDATED', e('shipping')), additionalTax: unknown('TAX_UNKNOWN', e('tax')),
      stock: o.availability === 'UNKNOWN' ? unknown('AVAILABILITY_UNKNOWN', e('stock')) : known(o.availability === 'AVAILABLE' ? 'IN_STOCK' : 'OUT_OF_STOCK', e('stock')),
      availableQuantity: unknown('EXACT_QUANTITY_UNVALIDATED', e('quantity')), purchaseLimit: unknown('BUYER_LIMIT_UNKNOWN', e('limit'))
    });
  }
  const catalog: CatalogMetadata = {
    store: { id: storeId, family: 'Amazon', canonicalDomain: 'www.amazon.com.mx', region: 'MX', currency: 'MXN', accessPolicyRef: live ? 'amazon-m5.4-user-approved-read-only' : 'amazon-m5.2-authored-only', adapterVersion: AMAZON_PROVIDER_VERSION, capabilities: ['RESOLUTION', 'OBSERVATION'], accessMode: live ? 'AUTHORIZED_VALIDATION' : 'FIXTURE_ONLY', retention: live ? 'VALIDATION_EVIDENCE_ONLY' : 'AUTHORED_SYNTHETIC', commercialUse: 'UNVALIDATED' },
    ...(live ? { evidenceBasis: 'LIVE_CAPTURE' as const } : {}),
    sourceReference: n.productUrl, productType: 'UNREVIEWED_AMAZON_CATALOG', sku: null, variantTitle: n.title ?? n.asin, options: []
  };
  const productObservation: ProductPageObservation | undefined = n.productState && n.title ? {
    productRef, title: n.title,
    availability: n.productState.availability === 'UNKNOWN' ? unknown('PRODUCT_AVAILABILITY_UNKNOWN', evidence('productAvailability')) : known(n.productState.availability, evidence('productAvailability')),
    purchaseMode: n.productState.purchaseMode === 'UNKNOWN' ? unknown('PURCHASE_MODE_UNKNOWN', evidence('purchaseMode')) : known(n.productState.purchaseMode, evidence('purchaseMode')),
    releaseDate: n.productState.releaseDate ? known(n.productState.releaseDate, evidence('releaseDate')) : unknown('RELEASE_DATE_UNKNOWN', evidence('releaseDate'))
  } : undefined;
  return freeze({ productRef, observations, catalog, ...(productObservation ? { productObservation } : {}) });
}
