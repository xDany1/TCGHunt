import { freeze, id, known, ref, unknown } from '@ptcg/core';
import type { Evidence, ListingObservation } from '@ptcg/core';
import type { CatalogMetadata } from '@ptcg/application';
import { ReadFailure, stableKey } from '@ptcg/application';
import type { ParsedProduct, ParsedVariant } from './parser.js';
import type { ShopifyFixtureConfig } from './config.js';
import { SHOPIFY_VERSION, SHOPIFY_API_VERSION } from './config.js';
import type { Capture } from './capture.js';

export type ShopifyNormalizationConfig = ShopifyFixtureConfig | {
  readonly mode: 'AUTHORIZED_VALIDATION'; readonly storeId: ShopifyFixtureConfig['storeId'];
  readonly canonicalDomain: 'kantocards.com'; readonly region: null; readonly accessPolicyRef: string;
  readonly merchant: { readonly id: 'kantocards'; readonly name: 'Kantocards'; };
};

export function offerIdentity(config: ShopifyNormalizationConfig, product: ParsedProduct, variant: ParsedVariant, deliveryScope: string) {
  return ref(config.storeId, 'offer', stableKey('synthetic-offer-v1', product.id, variant.id, config.merchant?.id ?? 'UNKNOWN', variant.condition, deliveryScope));
}
export function normalizeProduct(config: ShopifyNormalizationConfig, product: ParsedProduct, variant: ParsedVariant, capture: Omit<Capture, 'body'>, deliveryScope: string): { readonly observation: ListingObservation; readonly catalog: CatalogMetadata; } {
  if (!deliveryScope.trim() || deliveryScope.length > 100) throw new ReadFailure('NORMALIZATION_FAILED');
  const evidence = (field: string): Evidence => ({
    id: `${capture.id}:${variant.id}:${field}`, sourceId: config.storeId, sourceVersion: `${config.accessPolicyRef}:${SHOPIFY_API_VERSION}`, captureId: capture.id,
    adapterVersion: config.mode === 'FIXTURE_ONLY' ? SHOPIFY_VERSION : 'm3.5-authorized-evidence-1', parserVersion: SHOPIFY_VERSION, field, rights: config.mode === 'FIXTURE_ONLY' ? 'SYNTHETIC' : 'PERMITTED', sourceObservedAt: capture.sourceObservedAt, capturedAt: capture.capturedAt,
    receivedAt: capture.receivedAt, expiresAt: capture.sourceObservedAt + 60_001
  });
  const productRef = ref(config.storeId, 'product', product.id);
  const variantRef = ref(config.storeId, 'variant', variant.id);
  const listingRef = ref(config.storeId, 'listing', stableKey(product.id, variant.id));
  const sellerRef = ref(config.storeId, 'seller', config.merchant?.id ?? 'UNKNOWN');
  const stock = variant.available === false ? 'OUT_OF_STOCK' : variant.backorder === true ? 'BACKORDER'
    : variant.available === true && variant.quantity !== null && variant.quantity > 0 ? 'IN_STOCK' : 'UNKNOWN';
  const observation: ListingObservation = {
    id: id('observation', `${capture.id}:${variant.id}`), product: { ref: productRef, title: product.title },
    variant: { ref: variantRef, productRef, identity: variant.identity }, listing: { ref: listingRef, productRef, variantRef },
    offer: { ref: offerIdentity(config, product, variant, deliveryScope), listingRef, variantRef, sellerRef, condition: variant.condition, deliveryScope },
    identity: variant.identity.kind === 'UNKNOWN' ? unknown('EXACT_PRODUCT_IDENTITY_UNRESOLVED', evidence('identity')) : known(variant.identity, evidence('identity')),
    seller: config.merchant ? known({ ref: sellerRef, displayName: config.merchant.name }, evidence('merchant-policy-identity')) : unknown('MERCHANT_IDENTITY_UNREVIEWED', evidence('seller')),
    fulfilledBy: unknown('FULFILLMENT_NOT_PROVIDED', evidence('fulfillment')),
    unitPrice: variant.price ? known(variant.price, evidence('unit-price')) : unknown(variant.priceReason, evidence('unit-price')),
    stock: stock === 'UNKNOWN' ? unknown('INVENTORY_DETAIL_UNAVAILABLE', evidence('stock')) : known(stock, evidence('stock')),
    availableQuantity: variant.quantity === null ? unknown('QUANTITY_NOT_PROVIDED', evidence('quantity')) : known(variant.quantity, evidence('quantity')),
    // Product reads cannot establish destination-specific landed cost or an order purchase limit.
    shipping: unknown('SHIPPING_REQUIRES_DESTINATION_QUOTE', evidence('shipping')),
    additionalTax: unknown('ADDITIONAL_TAX_UNCONFIRMED', evidence('tax')),
    purchaseLimit: unknown('PURCHASE_LIMIT_NOT_PROVIDED', evidence('purchase-limit'))
  };
  return freeze({
    observation, catalog: {
      store: {
        id: config.storeId, family: 'Shopify', canonicalDomain: config.canonicalDomain, region: config.region, currency: variant.price?.currency ?? null,
        accessPolicyRef: config.accessPolicyRef, adapterVersion: config.mode === 'FIXTURE_ONLY' ? SHOPIFY_VERSION : 'm3.5-authorized-evidence-1', capabilities: ['RESOLUTION', 'OBSERVATION'], accessMode: config.mode, retention: config.mode === 'FIXTURE_ONLY' ? 'AUTHORED_SYNTHETIC' : 'VALIDATION_EVIDENCE_ONLY', commercialUse: 'UNVALIDATED'
      },
      sourceReference: `https://${config.canonicalDomain}/products/${product.handle}?variant=${variant.id}`, productType: product.type, sku: variant.sku, variantTitle: variant.title, options: variant.options
    }
  });
}
