import { id, ref, unknown, money } from '@ptcg/core';
import { stableKey, PersistenceFailure } from '@ptcg/application';
import type { AnyMonitorDefinition } from '@ptcg/application';
import type { MonitorInput } from '@ptcg/contracts';
import { kantocardsUrl, amazonUrl } from '@ptcg/adapters';

export const OWNER = id('local-owner', 'astra-desktop');
export const DELIVERY = 'validation-destination-unknown';
export const AMAZON_ASINS = ['B0H78BB9TY', 'B0HG3C5JK6', 'B0GYVHLP4L'] as const;
export const AMAZON_STORE = id('store', 'amazon-mx-m5.4-browser-live');
export const AMAZON_DELIVERY = 'amazon-mx:anonymous:location-unvalidated';
export function resolveMonitorSource(url: string) {
  try {
    const host = new URL(url).hostname;
    if (host === 'kantocards.com') return { ...approvedSource(url), family: 'Shopify' as const, provider: 'SHOPIFY' as const };
    if (!['amazon.com.mx', 'www.amazon.com.mx'].includes(host)) throw new Error('HOST_DENIED');
    const parsed = amazonUrl(url);
    if (!AMAZON_ASINS.some(a => a === parsed.asin)) throw new Error('UNAPPROVED');
    return { ...parsed, family: 'Amazon' as const, provider: 'BROWSER' as const, storeId: AMAZON_STORE };
  } catch { throw new PersistenceFailure('INVALID_INPUT'); }
}
/** IDs qualified by the saved M3.5 full live result; no price or stock is assumed here. */
export const TARGETS = [
  { handle: 'perfect-order-booster-pack-espanol', product: '9600895451379', variant: '49183411208435' },
  { handle: 'booster-astral-radiance-espanol', product: '8086388375795', variant: '43896160256243' }
] as const;
export function approvedSource(url: string) {
  const source = kantocardsUrl(url); const target = TARGETS.find(t => t.handle === source.handle);
  if (!target || source.variantId !== null && source.variantId !== target.variant) throw new PersistenceFailure('INVALID_INPUT');
  return { ...target, storeId: source.storeId, canonical: `https://kantocards.com/products/${target.handle}?variant=${target.variant}` };
}
export function monitorDefinition(monitorId: string, input: MonitorInput, now: number): AnyMonitorDefinition {
  const routed = resolveMonitorSource(input.url);
  if (routed.family === 'Amazon') return {
    monitorId: id('monitor', monitorId), ownerId: OWNER, campaignId: 'desktop-validation', cycleId: `desktop:${monitorId}:${routed.asin}`,
    desktop: { name: input.name.trim(), cadenceSeconds: input.cadenceSeconds },
    configuration: { kind: 'PRODUCT', mode: 'DRY_RUN', provider: 'BROWSER', productRef: ref(routed.storeId, 'product', routed.asin), sourceReference: routed.canonical, deliveryScope: AMAZON_DELIVERY }
  };
  const source = approvedSource(input.url); const canonicalId = id('canonical', `unreviewed-kantocards:${source.variant}`);
  const variantRef = ref(source.storeId, 'variant', source.variant);
  const missing = (field: string) => unknown<ReturnType<typeof money>>('NO_MANUAL_ESTIMATE_PROVIDED', {
    id: `${monitorId}:manual:${field}:${now}`, sourceId: 'local-desktop-configuration', sourceVersion: 'm4-unknown-assumptions-1',
    captureId: `local-config:${monitorId}:${now}`, adapterVersion: 'none', parserVersion: 'none', field, rights: 'SYNTHETIC',
    sourceObservedAt: now, capturedAt: now, receivedAt: now, expiresAt: now + 60001
  });
  return {
    monitorId: id('monitor', monitorId), ownerId: OWNER, campaignId: 'desktop-validation', cycleId: `desktop:${monitorId}:${source.variant}`,
    desktop: { name: input.name.trim(), cadenceSeconds: input.cadenceSeconds },
    configuration: {
      target: { id: canonicalId, identity: { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null } },
      mapping: { state: 'UNREVIEWED', version: 'unreviewed-m4-1', canonicalId, variantRef },
      offerRef: ref(source.storeId, 'offer', stableKey('synthetic-offer-v1', source.product, source.variant, 'kantocards', 'UNKNOWN', DELIVERY)),
      sourceReference: source.canonical, deliveryScope: DELIVERY, quantity: 1, currency: 'MXN', mode: 'DRY_RUN',
      sellerPolicy: { version: 'kantocards-authorized-domain-1', mode: 'ALLOWLIST', allow: [ref(source.storeId, 'seller', 'kantocards')], deny: [], firstParty: [] },
      purchasePolicy: { version: 'm4-zero-spend-1', maximumOrderValue: money(0n, 'MXN'), expression: { op: 'ALL', rules: [] } },
      scenario: {
        id: 'm4-unknown-manual-scenario', benchmark: { kind: 'MANUAL_ESTIMATE', canonicalId, quantity: 1, grossResale: missing('benchmark') },
        otherAcquisition: missing('other-acquisition'), verifiedDiscount: missing('discount'), outbound: missing('outbound'), lossAllowance: missing('loss'), fixedFee: missing('fixed-fee'), feeBasisPoints: 0
      }
    }
  };
}
