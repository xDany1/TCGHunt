import { freeze, parseMoney } from '@ptcg/core';
import type { Money } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import { AMAZON_RETAIL_MX_SELLER } from './contract.js';
import type { AmazonMoneyEvidence, AmazonOfferEvidence, AmazonProviderEvidence } from './contract.js';

export interface NormalizedAmazonOffer extends Omit<AmazonOfferEvidence, 'price' | 'shipping' | 'availability'> {
  readonly price: Money | null; readonly shipping: Money | null; readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly availabilityEvidence: { readonly raw: string | null; readonly quality: 'EXPLICIT_FIXTURE_TEXT' | 'EXPLICIT_LIVE_TEXT' | 'UNKNOWN'; };
  readonly sellerKind: 'AMAZON_RETAIL' | 'THIRD_PARTY' | 'UNKNOWN'; readonly completeness: 'COMPLETE_FIELDS' | 'INCOMPLETE';
}
export interface NormalizedAmazonObservation extends Omit<AmazonProviderEvidence, 'offers'> {
  readonly currency: 'MXN'; readonly observedAt: number; readonly offers: readonly NormalizedAmazonOffer[];
  readonly completeness: 'COMPLETE_FIELDS' | 'INCOMPLETE';
}
function money(value: AmazonMoneyEvidence | null): Money | null {
  if (!value || value.currency !== 'MXN') return null;
  try { const result = parseMoney(value.amount, 'MXN'); return result.minor < 0n ? null : result; } catch { return null; }
}
function availability(value: string | null): NormalizedAmazonOffer['availability'] {
  if (value === 'In stock' || value === 'Disponible' || value === 'https://schema.org/InStock') return 'AVAILABLE';
  if (value === 'Currently unavailable' || value === 'No disponible' || value === 'https://schema.org/OutOfStock') return 'UNAVAILABLE';
  return 'UNKNOWN';
}
/** Classification uses reviewed IDs or explicit scoped Retail role evidence; seller approval remains separate. */
export function normalizeAmazon(e: AmazonProviderEvidence, reviewedRetailIds: readonly string[] = []): NormalizedAmazonObservation {
  const offers: NormalizedAmazonOffer[] = []; const seen = new Map<string, NormalizedAmazonOffer>();
  for (const raw of e.offers) {
    const price = money(raw.price); const shipping = money(raw.shipping); const stock = availability(raw.availability);
    const o: NormalizedAmazonOffer = {
      ...raw, price, shipping, availability: stock,
      availabilityEvidence: { raw: raw.availability, quality: stock === 'UNKNOWN' ? 'UNKNOWN' : e.source.confidence === 'LIVE_CAPTURE' ? 'EXPLICIT_LIVE_TEXT' : 'EXPLICIT_FIXTURE_TEXT' },
      sellerKind: !raw.sellerId ? 'UNKNOWN' : reviewedRetailIds.includes(raw.sellerId) || (raw.sellerId === AMAZON_RETAIL_MX_SELLER && e.marketplace === 'MX' && e.source.provider === 'BROWSER' && e.renderedEvidence?.sellerIdentityBasis === 'EXPLICIT_AMAZON_RETAIL_MX_SELLER') ? 'AMAZON_RETAIL' : e.source.confidence === 'LIVE_CAPTURE' ? 'UNKNOWN' : 'THIRD_PARTY',
      completeness: raw.sellerId && price && shipping && stock !== 'UNKNOWN' && raw.fulfillment !== 'UNKNOWN' && raw.condition && raw.subCondition ? 'COMPLETE_FIELDS' : 'INCOMPLETE'
    };
    // IDs exposed by providers are evidence only. Seller + condition + fulfillment defines a comparable offer within this captured context.
    const key = JSON.stringify([o.sellerId, o.fulfillment, o.condition, o.subCondition]); const prior = seen.get(key);
    if (prior) {
      const comparable = (v: NormalizedAmazonOffer) => JSON.stringify({ ...v, externalOfferId: null }, (_k, x: unknown) => typeof x === 'bigint' ? String(x) : x);
      if (comparable(prior) !== comparable(o)) throw new ReadFailure('NORMALIZATION_FAILED');
      continue;
    }
    seen.set(key, o); offers.push(o);
  }
  return freeze({
    ...e, currency: 'MXN', observedAt: e.source.sourceObservedAt, offers,
    completeness: e.title && e.asinType !== 'UNKNOWN' && e.coverage !== 'UNKNOWN' && offers.every(o => o.completeness === 'COMPLETE_FIELDS') ? 'COMPLETE_FIELDS' : 'INCOMPLETE'
  });
}
