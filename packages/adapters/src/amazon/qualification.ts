import { createHash } from 'node:crypto';
import { freeze, id, instant, known, ref, refKey, unknown } from '@ptcg/core';
import type { Evidence, ListingObservation, ProductIdentity, StoreRef } from '@ptcg/core';
import { adapterError, ReadFailure } from '@ptcg/application';
import type { CatalogMetadata, ListingResolutionCapability, OfferObservationCapability, ReadContext, ReadResult } from '@ptcg/application';
import { amazonUrl } from './url.js';
import { parseAmazonCatalog, parseAmazonOffers } from './parser.js';
import type { AmazonOffer } from './parser.js';

export const AMAZON_FIXTURE_STORE = id('store', 'amazon-mx-m5-fixture');
export const AMAZON_FIXTURE_SCOPE = 'amazon-mx:consumer:unspecified-destination';
const VERSION = 'amazon-m5-v1';
const UNREVIEWED: ProductIdentity = { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null };
export interface AmazonFixtureCapture {
  readonly catalogBody: string; readonly offersBody: string; readonly status: number;
  readonly capturedAt: number; readonly sourceObservedAt: number;
  readonly failure?: 'TIMEOUT' | 'NETWORK'; readonly retryAfterMs?: number;
}
/** An authored review assertion, not fields inferred from a retail title or an API extension. */
export interface AmazonFixtureReview {
  readonly asin: string; readonly identity: ProductIdentity; readonly factorySealed: boolean; readonly evidenceRef: string;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function captureCheck(c: AmazonFixtureCapture, context: ReadContext): void {
  if (context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
  instant(context.now); instant(context.deadlineAt); instant(c.capturedAt); instant(c.sourceObservedAt);
  if (context.deadlineAt <= context.now || c.failure === 'TIMEOUT') throw new ReadFailure('DEADLINE_EXCEEDED');
  if (c.failure === 'NETWORK') throw new ReadFailure('TRANSIENT_FAILURE');
  if (context.currency !== 'MXN' || context.deliveryScope !== AMAZON_FIXTURE_SCOPE || c.sourceObservedAt > c.capturedAt || c.capturedAt > context.now) throw new ReadFailure('CONTEXT_MISMATCH');
  if (c.status === 401 || c.status === 403) throw new ReadFailure('AUTH_REQUIRED');
  if (c.status === 429) throw new ReadFailure('RATE_LIMITED', Number.isSafeInteger(c.retryAfterMs) && (c.retryAfterMs ?? 0) > 0 ? Math.min(c.retryAfterMs ?? 0, 3_600_000) : 2000);
  if (c.status === 404) throw new ReadFailure('LISTING_NOT_FOUND');
  if (c.status >= 500 && c.status <= 599) throw new ReadFailure('TRANSIENT_FAILURE');
  if (c.status !== 200) throw new ReadFailure('BLOCKED');
}

export function qualifyAmazonFixture(input: string, capture: AmazonFixtureCapture, context: ReadContext, review?: AmazonFixtureReview) {
  captureCheck(capture, context);
  const source = amazonUrl(input); const product = parseAmazonCatalog(capture.catalogBody, source.asin);
  const offers = parseAmazonOffers(capture.offersBody, source.asin);
  if (review && (review.asin !== source.asin || !review.evidenceRef.trim() || review.identity.kind !== 'SEALED' || !review.identity.set || !review.identity.edition || !review.identity.language || !Number.isSafeInteger(review.identity.packUnits) || (review.identity.packUnits ?? 0) <= 0)) throw new ReadFailure('CONTEXT_MISMATCH');
  const productRef = ref(AMAZON_FIXTURE_STORE, 'product', product.asin);
  const variantRef = ref(AMAZON_FIXTURE_STORE, 'variant', `singleton:${product.asin}`);
  const listingRef = ref(AMAZON_FIXTURE_STORE, 'listing', `detail:${product.asin}`);
  const identity = review?.identity ?? UNREVIEWED;
  const captureId = digest(JSON.stringify([VERSION, source.asin, capture.sourceObservedAt, capture.capturedAt, capture.catalogBody, capture.offersBody, review ?? null]));
  const evidence = (field: string): Evidence => ({
    id: `${captureId}:${field}`, sourceId: 'amazon-authored-fixture', sourceVersion: 'catalog-2022-04-01/pricing-v0', captureId,
    adapterVersion: VERSION, parserVersion: VERSION, field, rights: 'SYNTHETIC', sourceObservedAt: capture.sourceObservedAt, capturedAt: capture.capturedAt, receivedAt: capture.capturedAt, expiresAt: capture.sourceObservedAt + 60_000
  });
  const observations: ListingObservation[] = []; const seen = new Map<string, string>();
  for (const o of offers) {
    if (product.children.length || o.sellerId === null) continue;
    const sellerRef = ref(AMAZON_FIXTURE_STORE, 'seller', o.sellerId);
    const condition = review?.factorySealed && o.subCondition === 'New' ? 'NEW_SEALED' as const : 'UNKNOWN' as const;
    const offerRef = ref(AMAZON_FIXTURE_STORE, 'offer', JSON.stringify([VERSION, product.asin, o.sellerId, o.condition, o.subCondition, condition, o.fulfillment, AMAZON_FIXTURE_SCOPE]));
    const fingerprint = JSON.stringify(o, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value);
    const old = seen.get(refKey(offerRef));
    if (old !== undefined) { if (old !== fingerprint) throw new ReadFailure('NORMALIZATION_FAILED'); continue; }
    seen.set(refKey(offerRef), fingerprint);
    const e = (field: string) => evidence(`${digest(refKey(offerRef))}:${field}`);
    observations.push({
      id: id('observation', digest(`${captureId}:${refKey(offerRef)}`)), product: { ref: productRef, title: product.title },
      variant: { ref: variantRef, productRef, identity }, listing: { ref: listingRef, productRef, variantRef },
      offer: { ref: offerRef, listingRef, variantRef, sellerRef, condition, deliveryScope: AMAZON_FIXTURE_SCOPE },
      identity: review ? known(identity, e(`identity:${review.evidenceRef}`)) : unknown('PRODUCT_IDENTITY_UNREVIEWED', e('identity')),
      // Display ID explicitly: getItemOffers does not supply a merchant display name.
      seller: known({ ref: sellerRef, displayName: `Seller ID ${o.sellerId}` }, e('seller')),
      fulfilledBy: o.fulfillment === 'UNKNOWN' ? unknown('FULFILLMENT_UNKNOWN', e('fulfilledBy')) : known(o.fulfillment === 'AMAZON' ? ref(AMAZON_FIXTURE_STORE, 'seller', 'fulfillment:amazon') : sellerRef, e('fulfilledBy')),
      unitPrice: o.price ? known(o.price, e('price')) : unknown('PRICE_UNKNOWN', e('price')),
      // API quote has no verified buyer destination/tax/quantity context in this spike.
      shipping: unknown('BUYER_SHIPPING_CONTEXT_UNVALIDATED', e('shipping')), additionalTax: unknown('TAX_UNKNOWN', e('additionalTax')),
      stock: o.availability === 'NOW' ? known('IN_STOCK', e('stock:shipping-now-signal')) : unknown(o.availability === 'UNKNOWN' ? 'AVAILABILITY_UNKNOWN' : 'CURRENTLY_UNAVAILABLE_FOR_SHIPPING', e('stock')),
      availableQuantity: unknown('EXACT_QUANTITY_UNAVAILABLE', e('availableQuantity')), purchaseLimit: unknown('BUYER_LIMIT_UNKNOWN', e('purchaseLimit'))
    });
  }
  const catalog: CatalogMetadata = {
    store: {
      id: AMAZON_FIXTURE_STORE, family: 'Amazon', canonicalDomain: 'www.amazon.com.mx', region: 'MX', currency: 'MXN', accessPolicyRef: 'amazon-m5-authored-only', adapterVersion: VERSION,
      capabilities: ['RESOLUTION', 'OBSERVATION'], accessMode: 'FIXTURE_ONLY', retention: 'AUTHORED_SYNTHETIC', commercialUse: 'UNVALIDATED'
    },
    sourceReference: source.canonical, productType: 'UNREVIEWED_AMAZON_CATALOG', sku: null, variantTitle: product.title, options: []
  };
  return freeze({ product, productRef, offers, observations, catalog, state: product.children.length ? 'PARENT_ONLY' as const : offers.length === 0 ? 'NO_OFFER_IN_RESPONSE' as const : observations.length === 0 ? 'SELLER_UNIDENTIFIED' as const : 'OFFERS_OBSERVED' as const });
}

/** No transport, credentials, live opt-in or mutation methods. Only authored fixture captures. */
export class AmazonQualificationAdapter implements OfferObservationCapability, ListingResolutionCapability {
  readonly liveAccess = 'AUTH_BLOCKED';
  readonly descriptor = freeze({ id: 'amazon-m5-fixture', version: VERSION, contractVersion: 1 as const, automationLevel: 'OBSERVE_ONLY' as const, capabilities: ['RESOLUTION', 'OBSERVATION'] as const });
  constructor(private readonly capture: AmazonFixtureCapture, private readonly review?: AmazonFixtureReview) { freeze(capture); if (review) freeze(review); }
  async resolve(input: string, context: ReadContext) {
    try {
      const q = qualifyAmazonFixture(input, this.capture, context, this.review);
      return {
        ok: true as const, resolution: {
          sourceReference: q.catalog.sourceReference, productRef: q.productRef,
          variants: q.observations.map(o => ({ variantRef: o.variant.ref, offerRef: o.offer.ref, sku: null, title: q.product.title })),
          // Never pick cheapest, featured or even a lone seller implicitly.
          selectedOffer: null
        }
      };
    } catch (error) { if (!(error instanceof ReadFailure)) throw error; return { ok: false as const, error: adapterError(error, context.operationId) }; }
  }
  async observe(offer: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult> {
    try {
      if (!context.sourceReference) throw new ReadFailure('INVALID_URL');
      const q = qualifyAmazonFixture(context.sourceReference, this.capture, context, this.review);
      const observation = q.observations.find(o => refKey(o.offer.ref) === refKey(offer));
      if (!observation) throw new ReadFailure('LISTING_NOT_FOUND');
      return { ok: true, observation, catalog: q.catalog };
    } catch (error) { if (!(error instanceof ReadFailure)) throw error; return { ok: false, error: adapterError(error, context.operationId) }; }
  }
}

/** Classification requires a separately reviewed marketplace seller-ID mapping, never FBA. */
export function classifyAmazonSeller(offer: AmazonOffer, reviewedRetailIds: readonly string[]): 'AMAZON_RETAIL' | 'OTHER_IDENTIFIED' | 'UNIDENTIFIED' {
  return offer.sellerId === null ? 'UNIDENTIFIED' : reviewedRetailIds.includes(offer.sellerId) ? 'AMAZON_RETAIL' : 'OTHER_IDENTIFIED';
}
