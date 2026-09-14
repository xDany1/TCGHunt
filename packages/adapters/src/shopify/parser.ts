import { freeze, parseMoney } from '@ptcg/core';
import type { Money, ProductIdentity } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';

export interface ParsedVariant {
  readonly id: string; readonly title: string; readonly sku: string | null;
  readonly options: readonly { readonly name: string; readonly value: string; }[];
  readonly price: Money | null; readonly priceReason: string; readonly available: boolean | null;
  readonly quantity: number | null; readonly backorder: boolean | null;
  readonly identity: ProductIdentity; readonly condition: 'NEW_SEALED' | 'UNKNOWN';
}
export interface ParsedProduct { readonly id: string; readonly handle: string; readonly title: string; readonly type: string; readonly variants: readonly ParsedVariant[]; }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
export function externalId(value: unknown, kind: 'Product' | 'ProductVariant'): string {
  if (typeof value !== 'string' || !new RegExp(`^gid://shopify/${kind}/[1-9][0-9]{0,19}$`).test(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value.slice(value.lastIndexOf('/') + 1);
}
function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
function quantity(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
function commercialIdentity(input: unknown): { identity: ProductIdentity; condition: 'NEW_SEALED' | 'UNKNOWN'; } {
  if (input === null || input === undefined) return { identity: { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null }, condition: 'UNKNOWN' };
  let data: unknown;
  try { data = JSON.parse(text(object(input)['value'], 2048)); } catch { throw new ReadFailure('SCHEMA_MISMATCH'); }
  const v = object(data);
  return {
    identity: {
      kind: v['kind'] === 'SEALED' ? 'SEALED' : 'UNKNOWN', set: v['set'] == null ? '' : text(v['set'], 80), edition: v['edition'] == null ? '' : text(v['edition'], 80),
      language: v['language'] == null ? null : text(v['language'], 20), packUnits: quantity(v['packUnits'])
    },
    condition: v['condition'] === 'NEW_SEALED' ? 'NEW_SEALED' : 'UNKNOWN'
  };
}
export function parseProduct(body: string): ParsedProduct {
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new ReadFailure('MALFORMED_RESPONSE'); }
  const root = object(data);
  if (root['errors'] !== undefined) {
    const errors = root['errors'];
    if (!Array.isArray(errors) || errors.length > 20) throw new ReadFailure('SCHEMA_MISMATCH');
    if (errors.length) {
      const codes = errors.map(error => object(object(error)['extensions'] ?? {})['code']);
      if (codes.includes('THROTTLED')) throw new ReadFailure('RATE_LIMITED', 1_000);
      if (codes.includes('ACCESS_DENIED')) throw new ReadFailure('AUTH_REQUIRED');
      throw new ReadFailure('SCHEMA_MISMATCH');
    }
  }
  const product = object(root['data'])['product'];
  if (product === null) throw new ReadFailure('LISTING_NOT_FOUND');
  const p = object(product);
  const id = externalId(p['id'], 'Product');
  const handle = text(p['handle'], 128);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) throw new ReadFailure('SCHEMA_MISMATCH');
  const connection = object(p['variants']);
  const nodes = connection['nodes'];
  if (!Array.isArray(nodes) || nodes.length > 50 || object(connection['pageInfo'])['hasNextPage'] !== false) throw new ReadFailure('SCHEMA_MISMATCH');
  const variants = nodes.map(node => {
    const v = object(node);
    const options = v['selectedOptions'];
    if (!Array.isArray(options) || options.length > 3) throw new ReadFailure('SCHEMA_MISMATCH');
    const selectedOptions = options.map(option => { const o = object(option); return { name: text(o['name'], 80), value: text(o['value'], 100) }; });
    if (new Set(selectedOptions.map(o => o.name)).size !== selectedOptions.length) throw new ReadFailure('SCHEMA_MISMATCH');
    let price: Money | null = null;
    let priceReason = 'PRICE_NOT_PROVIDED';
    if (v['price'] != null) {
      const raw = object(v['price']);
      const amount = text(raw['amount'], 30);
      if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new ReadFailure('SCHEMA_MISMATCH');
      const currency = raw['currencyCode'];
      if (currency === 'MXN' || currency === 'USD') {
        try { price = parseMoney(amount, currency); } catch { throw new ReadFailure('SCHEMA_MISMATCH'); }
      } else {
        if (currency != null && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) throw new ReadFailure('SCHEMA_MISMATCH');
        priceReason = 'CURRENCY_UNSUPPORTED_OR_UNKNOWN';
      }
    }
    const identity = commercialIdentity(v['identity']);
    if (p['productType'] !== 'Sealed TCG') identity.identity = { ...identity.identity, kind: 'UNKNOWN' };
    return {
      id: externalId(v['id'], 'ProductVariant'), title: text(v['title']), sku: v['sku'] == null ? null : text(v['sku'], 100), options: selectedOptions,
      price, priceReason, available: nullableBoolean(v['availableForSale']), quantity: quantity(v['quantityAvailable']), backorder: nullableBoolean(v['currentlyNotInStock']), ...identity
    };
  });
  if (new Set(variants.map(v => v.id)).size !== variants.length) throw new ReadFailure('SCHEMA_MISMATCH');
  return freeze({ id, handle, title: text(p['title']), type: text(p['productType']), variants });
}
