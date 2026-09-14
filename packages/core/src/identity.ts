import { check, combine, freeze } from './value.js';
import type { Check, Id, Status } from './value.js';
import type { Money } from './money.js';
import type { Observed } from './evidence.js';

export interface StoreRef<Kind extends string> {
  readonly storeId: Id<'store'>;
  readonly kind: Kind;
  readonly externalId: string;
}
export function ref<Kind extends string>(storeId: Id<'store'>, kind: Kind, externalId: string): StoreRef<Kind> {
  if (!storeId || !kind || !externalId.trim()) throw new RangeError('Invalid store-scoped reference');
  return Object.freeze({ storeId, kind, externalId });
}
export function refKey(value: StoreRef<string>): string { return JSON.stringify([value.storeId, value.kind, value.externalId]); }
export function sameRef(a: StoreRef<string>, b: StoreRef<string>): boolean { return refKey(a) === refKey(b); }

export interface ProductIdentity {
  readonly kind: 'SEALED' | 'UNKNOWN'; readonly set: string; readonly edition: string;
  readonly language: string | null; readonly packUnits: number | null;
}
export interface CanonicalProduct { readonly id: Id<'canonical'>; readonly identity: ProductIdentity; }
export interface StoreProduct { readonly ref: StoreRef<'product'>; readonly title: string; }
export interface Variant { readonly ref: StoreRef<'variant'>; readonly productRef: StoreRef<'product'>; readonly identity: ProductIdentity; }
export interface Listing { readonly ref: StoreRef<'listing'>; readonly productRef: StoreRef<'product'>; readonly variantRef: StoreRef<'variant'>; }
export interface Seller { readonly ref: StoreRef<'seller'>; readonly displayName: string; }
export interface Offer {
  readonly ref: StoreRef<'offer'>; readonly listingRef: StoreRef<'listing'>;
  readonly variantRef: StoreRef<'variant'>; readonly sellerRef: StoreRef<'seller'>;
  readonly condition: 'NEW_SEALED' | 'UNKNOWN'; readonly deliveryScope: string;
}
export interface ProductMapping {
  readonly version: string; readonly state: 'REVIEWED' | 'UNREVIEWED';
  readonly canonicalId: Id<'canonical'>; readonly variantRef: StoreRef<'variant'>;
}
export interface ListingObservation {
  readonly purchaseMode?: Observed<'IMMEDIATE' | 'PREORDER'>;
  readonly id: Id<'observation'>;
  readonly product: StoreProduct; readonly variant: Variant; readonly listing: Listing; readonly offer: Offer;
  readonly identity: Observed<ProductIdentity>;
  readonly seller: Observed<Seller>;
  readonly fulfilledBy: Observed<StoreRef<'seller'>>;
  readonly unitPrice: Observed<Money>;
  readonly shipping: Observed<Money>;
  /** Additional acquisition taxes only: explicitly zero when price already includes all tax. */
  readonly additionalTax: Observed<Money>;
  readonly stock: Observed<'IN_STOCK' | 'OUT_OF_STOCK' | 'PREORDER' | 'BACKORDER' | 'UNKNOWN'>;
  readonly availableQuantity: Observed<number>;
  readonly purchaseLimit: Observed<number>;
}

export function matchProduct(target: CanonicalProduct, observation: ListingObservation, mapping: ProductMapping): { readonly status: Status; readonly checks: readonly Check[]; } {
  const o = observation;
  const coherent = sameRef(o.variant.productRef, o.product.ref) && sameRef(o.listing.productRef, o.product.ref)
    && sameRef(o.listing.variantRef, o.variant.ref) && sameRef(o.offer.variantRef, o.variant.ref)
    && sameRef(o.offer.listingRef, o.listing.ref)
    && [o.product.ref, o.variant.ref, o.listing.ref, o.offer.sellerRef].every(r => r.storeId === o.offer.ref.storeId);
  const checks: Check[] = [check('IDENTITY_GRAPH', coherent ? 'PASS' : 'FAIL')];
  const mapped = mapping.state === 'REVIEWED' && !!mapping.version && mapping.canonicalId === target.id && sameRef(mapping.variantRef, o.variant.ref);
  checks.push(check('REVIEWED_MAPPING', mapped ? 'PASS' : 'INDETERMINATE'));
  for (const field of ['kind', 'set', 'edition', 'language', 'packUnits'] as const) {
    const expected = target.identity[field];
    const actual = o.identity.state === 'KNOWN' ? o.identity.value[field] : null;
    const invalid = expected === null || actual === null || expected === '' || actual === ''
      || (field === 'kind' && (expected === 'UNKNOWN' || actual === 'UNKNOWN'))
      || (field === 'packUnits' && (!Number.isSafeInteger(actual) || Number(actual) <= 0 || !Number.isSafeInteger(expected) || Number(expected) <= 0));
    const matches = !invalid && expected === actual && actual === o.variant.identity[field];
    checks.push(check(`PRODUCT_${field.toUpperCase()}`, invalid ? 'INDETERMINATE' : matches ? 'PASS' : 'FAIL', { expected: String(expected), actual: String(actual) }, [o.identity.evidence.id]));
  }
  return freeze({ status: combine(checks), checks });
}
