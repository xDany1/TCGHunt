import { freeze, parseMoney } from '@ptcg/core';
import type { Money } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import { amazonAsin } from './url.js';

export const AMAZON_MX_MARKETPLACE = 'A1AM78C64UM0Y8';
export interface AmazonCatalog { readonly asin: string; readonly title: string; readonly parents: readonly string[]; readonly children: readonly string[]; }
export interface AmazonOffer {
  readonly sellerId: string | null; readonly fulfillment: 'AMAZON' | 'MERCHANT' | 'UNKNOWN';
  readonly condition: string; readonly subCondition: string;
  readonly price: Money | null; readonly quotedShipping: Money | null;
  readonly availability: 'NOW' | 'FUTURE_WITH_DATE' | 'FUTURE_WITHOUT_DATE' | 'UNKNOWN';
  readonly featured: boolean | null; readonly prime: boolean | null;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value as Record<string, unknown>;
}
function list(value: unknown, max = 20): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
function boolean(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
function json(body: string): Record<string, unknown> {
  if (body.length > 100_000) throw new ReadFailure('BODY_TOO_LARGE');
  let value: unknown;
  try {
    // Node 24's source-text reviver preserves decimal tokens before binary rounding.
    value = JSON.parse(body, (key: string, v: unknown, context?: { source?: string; }) => {
      if (key !== 'Amount') return v;
      if (typeof v !== 'number' || !context?.source || !/^\d+(?:\.\d{1,2})?$/.test(context.source)) throw new ReadFailure('SCHEMA_MISMATCH');
      return context.source;
    });
  } catch (error) { if (error instanceof ReadFailure) throw error; throw new ReadFailure('MALFORMED_RESPONSE'); }
  const root = object(value);
  if (root['errors'] !== undefined && list(root['errors']).length) throw new ReadFailure('SCHEMA_MISMATCH');
  return root;
}
function amount(raw: unknown): Money | null {
  if (raw == null) return null;
  const v = object(raw);
  if (v['CurrencyCode'] !== 'MXN') throw new ReadFailure('CONTEXT_MISMATCH');
  try { return parseMoney(text(v['Amount'], 30), 'MXN'); } catch { throw new ReadFailure('SCHEMA_MISMATCH'); }
}
export function parseAmazonCatalog(body: string, expectedAsin: string): AmazonCatalog {
  const root = json(body); const asin = amazonAsin(root['asin']);
  if (asin !== expectedAsin) throw new ReadFailure('CONTEXT_MISMATCH');
  const summaries = list(root['summaries']).map(object).filter(s => s['marketplaceId'] === AMAZON_MX_MARKETPLACE);
  if (summaries.length !== 1) throw new ReadFailure('CONTEXT_MISMATCH');
  const parents: string[] = []; const children: string[] = [];
  for (const market of list(root['relationships'] ?? [])) {
    const m = object(market); if (m['marketplaceId'] !== AMAZON_MX_MARKETPLACE) continue;
    for (const relation of list(m['relationships'])) {
      const r = object(relation); if (r['type'] !== 'VARIATION') continue;
      parents.push(...list(r['parentAsins'] ?? []).map(amazonAsin));
      children.push(...list(r['childAsins'] ?? []).map(amazonAsin));
    }
  }
  if (parents.includes(asin) || children.includes(asin) || (parents.length && children.length)) throw new ReadFailure('SCHEMA_MISMATCH');
  return freeze({ asin, title: text(summaries[0]?.['itemName']), parents: [...new Set(parents)], children: [...new Set(children)] });
}
/** A deliberately bounded getItemOffers v0 subset, not a claim of complete market inventory. */
export function parseAmazonOffers(body: string, expectedAsin: string): readonly AmazonOffer[] {
  const p = object(json(body)['payload']);
  if (p['status'] !== 'Success') throw new ReadFailure('SCHEMA_MISMATCH');
  const identifier = object(p['Identifier']);
  if (p['ASIN'] !== expectedAsin || identifier['ASIN'] !== expectedAsin || identifier['MarketplaceId'] !== AMAZON_MX_MARKETPLACE || identifier['ItemCondition'] !== 'New') throw new ReadFailure('CONTEXT_MISMATCH');
  return freeze(list(p['Offers']).map(raw => {
    const o = object(raw); const fba = boolean(o['IsFulfilledByAmazon']);
    const availability = object(o['ShippingTime'] ?? {})['availabilityType'];
    const sellerId = o['SellerId'] == null ? null : text(o['SellerId'], 80);
    if (sellerId !== null && !/^[A-Z0-9_-]+$/.test(sellerId)) throw new ReadFailure('SCHEMA_MISMATCH');
    return {
      sellerId, fulfillment: fba === null ? 'UNKNOWN' as const : fba ? 'AMAZON' as const : 'MERCHANT' as const,
      condition: 'New', subCondition: o['SubCondition'] == null ? 'UNKNOWN' : text(o['SubCondition'], 40),
      price: amount(o['ListingPrice']), quotedShipping: amount(o['Shipping']),
      availability: availability === 'NOW' || availability === 'FUTURE_WITH_DATE' || availability === 'FUTURE_WITHOUT_DATE' ? availability : 'UNKNOWN' as const,
      featured: boolean(o['IsBuyBoxWinner']), prime: boolean(object(o['PrimeInformation'] ?? {})['IsPrime'])
    };
  }));
}
