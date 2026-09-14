import { freeze } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import type { ReadContext } from '@ptcg/application';
import { amazonAsin, amazonUrl } from '../url.js';
import { captureFailure, fulfillment, identifier, label, optionalRecord, record, source } from './contract.js';
import type { AmazonCapture, AmazonMoneyEvidence, AmazonOfferEvidence, AmazonProvider, AmazonProviderResult, AmazonTarget } from './contract.js';

/** Separate documented GET ProductsResult and GET OffersResult responses, not SP-API payload envelopes. */
export interface AmazonBusinessCapture extends AmazonCapture {
  readonly product: { readonly status: number; readonly body: string; };
  readonly offers: { readonly status: number; readonly body: string; };
}
/** Host owns any future authorization. M5.2 supplies only authored captures; no credentials cross this port. */
export interface AmazonBusinessFixtureTransport { readonly mode: 'FIXTURE_ONLY'; lookup(target: AmazonTarget, context: ReadContext): Promise<AmazonBusinessCapture>; }
function json(body: string): Record<string, unknown> {
  if (body.length > 100_000) throw new ReadFailure('BODY_TOO_LARGE');
  try {
    // Node 24 source lexemes preserve decimal money before binary floating-point rounding.
    return record(JSON.parse(body, (key: string, value: unknown, ctx?: { source?: string; }) => key === 'amount' && typeof value === 'number' ? ctx?.source ?? null : value));
  } catch (error) { if (error instanceof ReadFailure) throw error; throw new ReadFailure('MALFORMED_RESPONSE'); }
}
function money(value: unknown): AmazonMoneyEvidence | null {
  const v = optionalRecord(optionalRecord(value)['value']); const amount = label(v['amount']); const currency = label(v['currencyCode']);
  return amount && currency ? { amount, currency } : null;
}
function offer(value: unknown, featuredId: string | null): AmazonOfferEvidence {
  const o = record(value); const merchant = optionalRecord(o['merchant']); const fulfiller = optionalRecord(o['fulfiller']); const condition = optionalRecord(o['condition']);
  const legacy = o['fulfillmentType']; const current = fulfiller['fulfillmentType'];
  const conflict = legacy != null && current != null && legacy !== current;
  const options = o['shippingOptions']; if (options != null && !Array.isArray(options)) throw new ReadFailure('SCHEMA_MISMATCH');
  // No shipping-option selection or invented destination. A single quote remains evidence only.
  const shipping = Array.isArray(options) && options.length === 1 ? money(record(options[0])['shippingCost']) : null;
  const externalOfferId = identifier(o['offerId']);
  const rawCondition = label(condition['conditionValue']); const oldCondition = label(o['productCondition']);
  return {
    externalOfferId, sellerId: identifier(merchant['merchantId']), sellerDisplayName: label(merchant['name']),
    fulfillment: conflict ? 'UNKNOWN' : fulfillment(current ?? legacy), condition: rawCondition && oldCondition && rawCondition !== oldCondition ? null : rawCondition ?? oldCondition,
    subCondition: label(condition['subCondition']), price: money(o['price']), shipping,
    availability: label(o['availability']), featured: featuredId && externalOfferId ? featuredId === externalOfferId : null, buttonPresent: null
  };
}
function status(code: number): AmazonProviderResult | null {
  if (code === 200) return null;
  return { category: code === 401 || code === 403 ? 'AUTH_REQUIRED' : code === 429 ? 'THROTTLED' : code === 404 ? 'PAGE_UNAVAILABLE' : code >= 500 ? 'NETWORK_ERROR' : 'ACCESS_DENIED' };
}
export class AmazonBusinessApiProvider implements AmazonProvider {
  readonly kind = 'BUSINESS_API'; readonly mode = 'FIXTURE_ONLY';
  constructor(private readonly transport: AmazonBusinessFixtureTransport) { if (transport.mode !== 'FIXTURE_ONLY') throw new ReadFailure('NETWORK_DISABLED'); }
  async read(target: AmazonTarget, context: ReadContext): Promise<AmazonProviderResult> {
    const c = await this.transport.lookup(target, context); const failed = captureFailure(c, target, context) ?? status(c.product.status) ?? status(c.offers.status); if (failed) return failed;
    const p = json(c.product.body); const result = json(c.offers.body);
    if (amazonAsin(p['asin']) !== target.asin || (p['url'] != null && amazonUrl(String(p['url'])).asin !== target.asin)) throw new ReadFailure('CONTEXT_MISMATCH');
    if (!Array.isArray(result['offers']) || result['offers'].length > 100) throw new ReadFailure('SCHEMA_MISMATCH');
    const featured = optionalRecord(result['featuredOffer']); const featuredId = identifier(featured['offerId']);
    const offers = result['offers'].map(v => offer(v, featuredId));
    // featuredOffer may duplicate a page offer; the common normalizer detects contradictory duplicates.
    if (result['featuredOffer'] != null) offers.push(offer(result['featuredOffer'], featuredId));
    const variations = optionalRecord(p['productVariations'])['variations'];
    if (variations != null && (!Array.isArray(variations) || variations.length > 100)) throw new ReadFailure('SCHEMA_MISMATCH');
    const childAsins = Array.isArray(variations) ? variations.map(v => amazonAsin(record(v)['asin'])) : [];
    const type = p['asinType']; const asinType = type === 'STANDARD' || type === 'VARIATION_PARENT' || type === 'VARIATION_CHILD' ? type : 'UNKNOWN';
    return freeze({
      category: 'OBSERVED', evidence: {
        marketplace: 'MX', asin: target.asin, productUrl: target.url, title: label(p['title']), asinType, childAsins, offers,
        coverage: offers.length ? 'OBSERVED_SUBSET' : result['offerCount'] === 0 ? 'NO_OFFERS_IN_RESPONSE' : 'UNKNOWN', source: source(c, this.kind)
      }
    });
  }
}
