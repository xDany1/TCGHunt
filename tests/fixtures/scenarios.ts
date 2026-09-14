import { freeze, id, known, money, ref, unknown } from '@ptcg/core';
import type { Evidence, ListingObservation, ProductIdentity } from '@ptcg/core';
import type { SimulationRequest } from '@ptcg/application';

export const NOW = 1_800_000_000_000;
export const FIXTURE_VERSION = 'synthetic-v1';
export const scenarioNames = ['correct-product-match', 'wrong-language', 'wrong-pack-size', 'seller-rejection',
  'seller-approval', 'missing-price', 'missing-shipping', 'stale-observation', 'out-of-stock', 'roi-below-threshold', 'valid-simulated-opportunity'] as const;
export type ScenarioName = typeof scenarioNames[number];

export function evidence(field: string, observedAt = NOW - 1_000): Evidence {
  return {
    id: `evidence:${field}:${observedAt}`, sourceId: 'synthetic-owned-fixture', sourceVersion: FIXTURE_VERSION,
    captureId: `capture:${observedAt}`, adapterVersion: '1.0.0', parserVersion: 'synthetic-v1', field,
    rights: 'SYNTHETIC', sourceObservedAt: observedAt, capturedAt: observedAt, receivedAt: NOW,
    expiresAt: observedAt + 60_001
  };
}

export function fixture(name: ScenarioName = 'valid-simulated-opportunity'): { readonly observation: ListingObservation; readonly request: SimulationRequest; } {
  const store = id('store', 'fake-mx');
  const productRef = ref(store, 'product', 'sealed-product');
  const variantRef = ref(store, 'variant', 'variant-en-1');
  const listingRef = ref(store, 'listing', 'listing-1');
  const sellerRef = ref(store, 'seller', name === 'seller-rejection' ? 'denied' : 'merchant-1');
  const targetIdentity: ProductIdentity = { kind: 'SEALED', set: 'fixture-set', edition: 'standard-etb', language: 'en', packUnits: 1 };
  const identity = { ...targetIdentity, language: name === 'wrong-language' ? 'ja' : 'en', packUnits: name === 'wrong-pack-size' ? 6 : 1 };
  const observedAt = name === 'stale-observation' ? NOW - 60_001 : NOW - 1_000;
  const e = (field: string) => evidence(field, observedAt);
  const observation: ListingObservation = {
    id: id('observation', name), product: { ref: productRef, title: 'Synthetic sealed Pokémon product' },
    variant: { ref: variantRef, productRef, identity }, listing: { ref: listingRef, productRef, variantRef },
    offer: { ref: ref(store, 'offer', name), listingRef, variantRef, sellerRef, condition: 'NEW_SEALED', deliveryScope: 'synthetic-mx' },
    identity: known(identity, e('identity')), seller: known({ ref: sellerRef, displayName: 'Synthetic Merchant' }, e('seller')),
    fulfilledBy: known(ref(store, 'seller', 'platform-fulfillment'), e('fulfilledBy')),
    unitPrice: name === 'missing-price' ? unknown('Not provided', e('price')) : known(money(100_000n, 'MXN'), e('price')),
    shipping: name === 'missing-shipping' ? unknown('Not provided', e('shipping')) : known(money(10_000n, 'MXN'), e('shipping')),
    additionalTax: known(money(0n, 'MXN'), e('additionalTax')),
    stock: known(name === 'out-of-stock' ? 'OUT_OF_STOCK' : 'IN_STOCK', e('stock')),
    availableQuantity: known(2, e('availableQuantity')), purchaseLimit: known(2, e('purchaseLimit'))
  };
  const canonicalId = id('canonical', 'sealed-en-etb-1');
  const manualMoney = (field: string, minor: bigint) => known(money(minor, 'MXN'), evidence(field));
  const request: SimulationRequest = {
    target: { id: canonicalId, identity: targetIdentity }, mapping: { version: 'mapping-v1', state: 'REVIEWED', canonicalId, variantRef },
    offerRef: observation.offer.ref, quantity: 2, currency: 'MXN', now: NOW,
    operationId: `operation:${name}`, traceId: `trace:${name}`, cycleId: `cycle:${name}`, deliveryScope: 'synthetic-mx',
    sellerPolicy: { version: 'seller-v1', mode: 'ALLOWLIST', allow: [ref(store, 'seller', 'merchant-1')], deny: [ref(store, 'seller', 'denied')], firstParty: [ref(store, 'seller', 'platform-fulfillment')] },
    purchasePolicy: {
      version: 'rules-v1', maximumOrderValue: money(250_000n, 'MXN'), expression: {
        op: 'ALL', rules: [
          { id: 'unit-price', kind: 'PRICE_AT_MOST', maximum: money(120_000n, 'MXN') },
          { id: 'shipping-limit', kind: 'SHIPPING_AT_MOST', maximum: money(10_000n, 'MXN') },
          { id: 'quantity-limit', kind: 'QUANTITY_AT_MOST', maximum: 2 },
          { id: 'roi-limit', kind: 'ROI_AT_LEAST', minimum: { numerator: 20n, denominator: 100n } }
        ]
      }
    },
    scenario: {
      id: `scenario:${name}`, benchmark: {
        kind: 'MANUAL_ESTIMATE', canonicalId, quantity: 2,
        grossResale: manualMoney('resale', name === 'roi-below-threshold' ? 300_000n : 350_000n)
      },
      otherAcquisition: manualMoney('other-acquisition', 0n), verifiedDiscount: manualMoney('discount', 0n),
      outbound: manualMoney('outbound', 15_000n), lossAllowance: manualMoney('loss', 6_000n),
      fixedFee: manualMoney('fixed-fee', 0n), feeBasisPoints: 1_300
    }
  };
  return freeze({ observation, request });
}
