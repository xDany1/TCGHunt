import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { freeze, id, refKey, unknown } from '@ptcg/core';
import type { ListingObservation, StoreRef, Observed, Seller } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import type { CatalogMetadata, OfferObservationCapability, ReadContext, ReadResult } from '@ptcg/application';
import { parseProduct } from './parser.js';
import type { ParsedProduct } from './parser.js';
import { normalizeProduct } from './normalize.js';
import type { CapabilityHealth } from './adapter.js';

export const KANTOCARDS_HANDLES = ['perfect-order-booster-pack-espanol', 'booster-astral-radiance-espanol'] as const;
export function kantocardsUrl(input: string) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\\]|%(?:2e|2f|5c)/i.test(input)
    || /^https:\/\/([^/?#]+)/i.exec(input)?.[1]?.toLowerCase() !== 'kantocards.com' || /\/\.\.?\//.test(input)) throw new ReadFailure('POLICY_DENIED');
  const url = new URL(input);
  const handle = /^\/(?:collections\/booster-sueltos\/)?products\/([a-z0-9-]+)\/?$/.exec(url.pathname)?.[1];
  if (!handle || !KANTOCARDS_HANDLES.some(h => h === handle)) throw new ReadFailure('POLICY_DENIED');
  for (const key of url.searchParams.keys()) if (!['_pos', '_fid', '_ss', 'variant'].includes(key)) throw new ReadFailure('POLICY_DENIED');
  const variants = url.searchParams.getAll('variant');
  if (variants.length > 1 || variants.length === 1 && !/^[1-9][0-9]{0,19}$/.test(variants[0] ?? '')) throw new ReadFailure('POLICY_DENIED');
  return freeze({ storeId: id('store', 'shopify-kantocards'), handle, canonical: `https://kantocards.com/products/${handle}${variants[0] ? `?variant=${variants[0]}` : ''}`, variantId: variants[0] ?? null });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value as Record<string, unknown>;
}
function external(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value;
}
export interface AuthorizedEvidence { readonly observation: ListingObservation; readonly catalog: CatalogMetadata; }
function metadata(value: unknown) {
  const m = object(value);
  if (m['method'] !== 'POST' || m['host'] !== 'kantocards.com' || m['endpoint'] !== '/api/2026-07/graphql.json' || m['status'] !== 200 || m['apiVersion'] !== '2026-07'
    || typeof m['contentType'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(m['contentType'])
    || typeof m['startedAt'] !== 'number' || !Number.isSafeInteger(m['startedAt']) || m['startedAt'] < 0
    || typeof m['receivedAt'] !== 'number' || !Number.isSafeInteger(m['receivedAt']) || m['receivedAt'] < m['startedAt']
    || typeof m['bytes'] !== 'number' || !Number.isSafeInteger(m['bytes']) || m['bytes'] < 1 || m['bytes'] > 65536
    || m['deprecated'] !== false || typeof m['handle'] !== 'string') throw new ReadFailure('SCHEMA_MISMATCH');
  let age = 0;
  if (m['age'] != null) { if (typeof m['age'] !== 'string' || !/^\d{1,8}$/.test(m['age'])) throw new ReadFailure('SCHEMA_MISMATCH'); age = Number(m['age']) * 1000; }
  if (age > m['startedAt']) throw new ReadFailure('SCHEMA_MISMATCH');
  const source = kantocardsUrl(`https://kantocards.com/products/${m['handle']}`);
  return { handle: source.handle, capturedAt: m['startedAt'], receivedAt: m['receivedAt'], sourceObservedAt: m['startedAt'] - age, bytes: m['bytes'] };
}
const config = freeze({
  mode: 'AUTHORIZED_VALIDATION' as const, storeId: id('store', 'shopify-kantocards'), canonicalDomain: 'kantocards.com' as const, region: null,
  accessPolicyRef: 'kantocards-m3.5-user-authorized-v1', merchant: { id: 'kantocards' as const, name: 'Kantocards' as const }
});
function normalize(product: ParsedProduct, m: ReturnType<typeof metadata>, basis: NonNullable<CatalogMetadata['evidenceBasis']>, digestInput: string, sourceReference: string, deliveryScope: string): AuthorizedEvidence {
  const source = kantocardsUrl(sourceReference);
  if (source.handle !== product.handle || product.handle !== m.handle) throw new ReadFailure('CONTEXT_MISMATCH');
  const variant = source.variantId ? product.variants.find(v => v.id === source.variantId) : product.variants.length === 1 ? product.variants[0] : undefined;
  if (!variant) throw new ReadFailure('VARIANT_REQUIRED');
  const digest = createHash('sha256').update(digestInput).digest('hex');
  const result = normalizeProduct(config, product, variant, { ...m, id: `${basis === 'LIVE_CAPTURE' ? 'live-capture' : 'reported-live-summary'}:${digest}` }, deliveryScope);
  const summarized = <T>(field: Observed<T>): Observed<T> => ({ ...field, evidence: { ...field.evidence, parserVersion: 'm3.5-summary-1', sourceVersion: `${config.accessPolicyRef}:user-supplied-summary:2026-07` } });
  const o = result.observation;
  const observation = basis === 'LIVE_CAPTURE' ? o : {
    ...o, identity: summarized(o.identity),
    seller: summarized(unknown<Seller>('MERCHANT_RESPONSE_NOT_INCLUDED_IN_SUMMARY', { ...o.seller.evidence, field: 'seller-omitted-from-summary' })),
    fulfilledBy: summarized(o.fulfilledBy), unitPrice: summarized(o.unitPrice), stock: summarized(o.stock), availableQuantity: summarized(o.availableQuantity),
    shipping: summarized(o.shipping), additionalTax: summarized(o.additionalTax), purchaseLimit: summarized(o.purchaseLimit)
  };
  // A summary digest identifies the supplied summary, never a claimed hash of the absent HTTP body.
  return freeze({ observation, catalog: { ...result.catalog, evidenceBasis: basis, saleAvailable: variant.available } });
}
/** No network: validates already captured, authorized product evidence using the existing M3 parser. */
export function normalizeKantocardsCapture(body: string, responseMetadata: unknown, sourceReference: string, deliveryScope: string): AuthorizedEvidence {
  const m = metadata(responseMetadata);
  if (Buffer.byteLength(body, 'utf8') !== m.bytes) throw new ReadFailure('MALFORMED_RESPONSE');
  const product = parseProduct(body);
  const shop = object(object(object(JSON.parse(body))['data'])['shop']);
  if (shop['name'] !== 'Kantocards' || object(shop['primaryDomain'])['host'] !== 'kantocards.com') throw new ReadFailure('CONTEXT_MISMATCH');
  return normalize(product, m, 'LIVE_CAPTURE', JSON.stringify([m, body]), sourceReference, deliveryScope);
}
/** Partial real evidence: only the reported IDs/times, with all omitted commercial fields UNKNOWN. */
export function normalizeKantocardsSummary(value: unknown, deliveryScope: string): AuthorizedEvidence {
  const summary = object(value);
  if (summary['status'] !== 'PARTIAL' || summary['reason'] !== 'CAPTURE_PARSED_LIVE_DURABILITY_NOT_YET_QUALIFIED') throw new ReadFailure('SCHEMA_MISMATCH');
  const requests = summary['requests']; const variants = summary['variantIds'];
  if (!Array.isArray(requests) || requests.length !== 1 || !Array.isArray(variants) || variants.length !== 1) throw new ReadFailure('SCHEMA_MISMATCH');
  const m = metadata(requests[0]);
  const identity = { kind: 'UNKNOWN' as const, set: '', edition: '', language: null, packUnits: null };
  const product: ParsedProduct = { id: external(summary['productId']), handle: m.handle, title: '', type: '', variants: [{ id: external(variants[0]), title: '', sku: null, options: [], price: null, priceReason: 'PRICE_NOT_INCLUDED_IN_SUMMARY', available: null, quantity: null, backorder: null, identity, condition: 'UNKNOWN' }] };
  return normalize(product, m, 'USER_SUPPLIED_LIVE_SUMMARY', JSON.stringify([m, product.id, product.variants[0]?.id]), `https://kantocards.com/products/${m.handle}`, deliveryScope);
}
/** Snapshot replay for the existing coordinator; it never refreshes capture time or contacts a retailer. */
export class AuthorizedEvidenceAdapter implements OfferObservationCapability {
  readonly descriptor = freeze({ id: 'shopify-authorized-evidence', version: 'm3.5-authorized-evidence-1', contractVersion: 1 as const, automationLevel: 'OBSERVE_ONLY' as const, capabilities: ['OBSERVATION'] as const });
  constructor(private readonly evidence: AuthorizedEvidence) { freeze(evidence); }
  health(now: number): CapabilityHealth {
    const sourceTime = this.evidence.observation.identity.evidence.sourceObservedAt;
    return freeze({
      capability: 'OBSERVATION', observedAt: now, lastFailureAt: null,
      lastSuccessAt: this.evidence.catalog.evidenceBasis === 'LIVE_CAPTURE' ? this.evidence.observation.identity.evidence.receivedAt : null,
      ...(this.evidence.catalog.evidenceBasis !== 'LIVE_CAPTURE'
        ? { state: 'UNAVAILABLE' as const, reason: 'SUMMARY_ONLY_NOT_PROBED' }
        : now < sourceTime || now - sourceTime > 60000
          ? { state: 'DEGRADED' as const, reason: 'CAPTURE_NOT_FRESH' }
          : { state: 'HEALTHY' as const, reason: 'FRESH_CAPTURE_ONLY_NOT_ONGOING_HEALTH' })
    });
  }
  async observe(offer: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult> {
    const code = context.cancellation?.aborted ? 'CANCELLED' : context.deadlineAt <= context.now ? 'DEADLINE_EXCEEDED'
      : refKey(offer) !== refKey(this.evidence.observation.offer.ref) || context.deliveryScope !== this.evidence.observation.offer.deliveryScope ? 'CONTEXT_MISMATCH' : null;
    if (code) return { ok: false, error: { code, category: 'NON_RETRYABLE', operationId: context.operationId, externalEffect: 'NOT_SENT' } };
    if (context.sourceReference) {
      try {
        const source = kantocardsUrl(context.sourceReference);
        const captured = kantocardsUrl(this.evidence.catalog.sourceReference);
        if (source.handle !== captured.handle || source.variantId !== null && source.variantId !== captured.variantId) throw new ReadFailure('CONTEXT_MISMATCH');
      } catch { return { ok: false, error: { code: 'CONTEXT_MISMATCH', category: 'NON_RETRYABLE', operationId: context.operationId, externalEffect: 'NOT_SENT' } }; }
    }
    return { ok: true, ...this.evidence };
  }
}
