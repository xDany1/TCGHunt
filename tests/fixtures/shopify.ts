import { id, ref } from '@ptcg/core';
import { LocalReadScheduler, ReadFailure } from '@ptcg/application';
import type { MonitorDefinition, ReadClock, ReadContext, ReadQuotaRepository, SimulationRequest } from '@ptcg/application';
import { ShopifyAdapter, ShopifyFixtureTransport } from '@ptcg/adapters';
import type { FixtureResponse, ShopifyFixtureConfig } from '@ptcg/adapters';
import { fixture, NOW } from './scenarios.js';
import { OWNER } from './durable.js';

export class FixtureClock implements ReadClock {
  constructor(public at = NOW) { }
  readonly waits: number[] = [];
  now(): number { return this.at; }
  async waitUntil(at: number, cancellation?: ReadContext['cancellation']): Promise<void> {
    if (cancellation?.aborted) throw new ReadFailure('CANCELLED');
    this.waits.push(at); this.at = Math.max(this.at, at); await Promise.resolve();
  }
}
export const shopConfig: ShopifyFixtureConfig = { storeId: id('store', 'shopify-synthetic'), canonicalDomain: 'merchant.invalid', region: null, accessPolicyRef: 'authored-fixtures-v1', mode: 'FIXTURE_ONLY', minimumIntervalMs: 1_000, maxAttempts: 3, merchant: { id: 'fixture-merchant', name: 'Authored fixture merchant' } };
export const SOURCE = 'https://merchant.invalid/products/fixture-etb?variant=201';
export const identity = { kind: 'SEALED', set: 'fixture-set', edition: 'standard-etb', language: 'en', packUnits: 1, condition: 'NEW_SEALED' };
export function variant(patch: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/ProductVariant/201', title: 'English / Single', sku: 'SYNTHETIC-201', selectedOptions: [{ name: 'Language', value: 'English' }],
    price: { amount: '1000.00', currencyCode: 'MXN' }, availableForSale: true, quantityAvailable: 2, currentlyNotInStock: false,
    identity: { value: JSON.stringify(identity) }, ...patch
  };
}
export function product(patch: Record<string, unknown> = {}, variants: readonly Record<string, unknown>[] = [variant()]) {
  return { id: 'gid://shopify/Product/100', handle: 'fixture-etb', title: 'Authored Sealed TCG Fixture', productType: 'Sealed TCG', variants: { nodes: variants, pageInfo: { hasNextPage: false } }, ...patch };
}
export function response(p = product(), patch: Partial<FixtureResponse> = {}): FixtureResponse { return { status: 200, contentType: 'application/json', body: JSON.stringify({ data: { product: p } }), ...patch }; }
// Authored data only. IDs, SKUs, names, inventory and prices do not identify a retailer.
export const shopifyFixtures = {
  normal: response(), multiple: response(product({}, [variant(), variant({ id: 'gid://shopify/ProductVariant/202', title: 'Japanese / Six', identity: { value: JSON.stringify({ ...identity, language: 'ja', packUnits: 6 }) } })])),
  wrongType: response(product({ productType: 'Single card' })), unavailable: response(product({}, [variant({ availableForSale: false, quantityAvailable: 0 })])),
  priceChange: response(product({}, [variant({ price: { amount: '1099.99', currencyCode: 'MXN' } })])), missingSku: response(product({}, [variant({ sku: null })])),
  unknownAvailability: response(product({}, [variant({ availableForSale: null, quantityAvailable: null })])), malformed: response(product(), { body: '{"data":' }),
  schemaDrift: response(product({ variants: { edges: [] } })), wrongCurrency: response(product({}, [variant({ price: { amount: '1000.00', currencyCode: 'USD' } })])),
  duplicateTitle: response(product({ id: 'gid://shopify/Product/101' }, [variant({ id: 'gid://shopify/ProductVariant/203' })])),
  redirect: response(product(), { status: 302, location: 'https://127.0.0.1/internal' }), rateLimit: response(product(), { status: 429, retryAfterMs: 2_000 }),
  serverError: response(product(), { status: 503 }), blocked: response(product(), { status: 403 }), unauthorized: response(product(), { status: 401 })
};
export function readContext(clock: ReadClock, patch: Partial<ReadContext> = {}): ReadContext {
  return { now: clock.now(), deadlineAt: clock.now() + 15_000, operationId: 'shopify-operation', traceId: 'shopify-trace', currency: 'MXN', deliveryScope: 'synthetic-mx', sourceReference: SOURCE, ...patch };
}
export function adapterFixture(quotas: ReadQuotaRepository, responses: readonly FixtureResponse[], config = shopConfig, clock = new FixtureClock()) {
  const transport = new ShopifyFixtureTransport(clock, responses);
  const scheduler = new LocalReadScheduler(quotas, clock, () => 0.5);
  const adapter = new ShopifyAdapter(config, transport, scheduler, clock);
  return { adapter, transport, scheduler, clock };
}
export async function shopifyMonitor(a: ReturnType<typeof adapterFixture>, patch: Partial<SimulationRequest> = {}): Promise<MonitorDefinition> {
  const resolved = await a.adapter.resolve(SOURCE, readContext(a.clock));
  if (!resolved.ok || !resolved.resolution.selectedOffer) throw new Error('Fixture resolution failed');
  const base = fixture().request;
  const configuration = {
    ...base, offerRef: resolved.resolution.selectedOffer, sourceReference: resolved.resolution.sourceReference,
    mapping: { ...base.mapping, variantRef: ref(shopConfig.storeId, 'variant', '201') },
    sellerPolicy: { ...base.sellerPolicy, allow: [ref(shopConfig.storeId, 'seller', 'fixture-merchant')] }, ...patch
  };
  return { monitorId: id('monitor', 'shopify-monitor'), ownerId: OWNER, campaignId: 'shopify-campaign', cycleId: 'shopify-cycle', configuration };
}
