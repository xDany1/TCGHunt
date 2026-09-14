import { freeze, sameRef, known, unknown } from '@ptcg/core';
import type { ListingObservation } from '@ptcg/core';
import type { RestockInput, RestockScope } from '@ptcg/application';
import { ReadFailure } from '@ptcg/application';
import type { NormalizedAmazonObservation } from './normalize.js';
import { mapAmazonDomain } from './domain-map.js';

/** Translate a successful provider projection; neither provider currently proves complete product/seller coverage. */
export function amazonRestockInput(normalized: NormalizedAmazonObservation, observations: readonly ListingObservation[], scope: RestockScope, inputId: string, receivedAt: number, monitoringDetails = false): RestockInput {
  if (normalized.asin !== scope.productRef.externalId) throw new ReadFailure('CONTEXT_MISMATCH');
  const scoped = observations.filter(o => sameRef(o.product.ref, scope.productRef) && (scope.kind === 'PRODUCT' || (scope.kind === 'OFFER' ? sameRef(o.offer.ref, scope.offerRef) : sameRef(o.offer.sellerRef, scope.sellerRef))));
  const explicit = scope.kind === 'OFFER' && scoped.length === 1 && normalized.asinType !== 'VARIATION_PARENT' && (normalized.asinType !== 'UNKNOWN' || normalized.selectedAsin === true);
  const product = scope.kind === 'PRODUCT' ? mapAmazonDomain(normalized, scope.deliveryScope).productObservation : undefined;
  const selected = normalized.offers.length === 1 ? normalized.offers[0] : undefined;
  const e = (field: string) => { if (!product) throw new ReadFailure('CONTEXT_MISMATCH'); return { ...product.availability.evidence, field, id: `${product.availability.evidence.captureId}:${field}` }; };
  // Additive monitor presentation evidence; historical M5.4 sample fingerprints remain unchanged by default.
  const details = product && monitoringDetails ? {
    unitPrice: selected?.price ? known(selected.price, e('productPrice')) : unknown<import('@ptcg/core').Money>('PRICE_UNKNOWN', e('productPrice')),
    seller: selected?.sellerId ? known(selected.sellerDisplayName ?? selected.sellerId, e('productSeller')) : unknown<string>('SELLER_IDENTITY_UNKNOWN', e('productSeller')),
    fulfillment: selected?.fulfillment && selected.fulfillment !== 'UNKNOWN' ? known(selected.fulfillment, e('productFulfillment')) : unknown<string>('FULFILLMENT_UNKNOWN', e('productFulfillment'))
  } : {};
  return freeze({
    id: inputId, mode: 'DRY_RUN', scope, observedAt: normalized.observedAt, receivedAt, expiresAt: normalized.observedAt + 60_000,
    status: product || explicit ? 'OBSERVED' : normalized.coverage === 'NO_OFFERS_IN_RESPONSE' ? 'NO_OFFER_OBSERVED' : 'PARTIAL_COVERAGE',
    coverage: product ? 'PRODUCT_PAGE' : explicit ? 'EXPLICIT_OFFER' : 'PARTIAL', observations: scoped,
    ...(product ? { productObservation: { ...product, ...details } } : {}),
    provenance: { provider: normalized.source.provider, reference: normalized.source.fixtureId }
  });
}
