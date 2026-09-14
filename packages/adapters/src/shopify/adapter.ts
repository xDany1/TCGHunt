import { freeze, ref, refKey } from '@ptcg/core';
import type { StoreRef } from '@ptcg/core';
import { adapterError, ReadFailure } from '@ptcg/application';
import type { AdapterError, ListingResolution, ListingResolutionCapability, OfferObservationCapability, ReadClock, ReadContext, ReadResult, ReadScheduler } from '@ptcg/application';
import { captureProduct, ShopifyFixtureTransport } from './capture.js';
import type { Capture } from './capture.js';
import { SHOPIFY_VERSION, validateConfig } from './config.js';
import type { ShopifyFixtureConfig } from './config.js';
import { normalizeProduct, offerIdentity } from './normalize.js';
import { parseProduct } from './parser.js';
import type { ParsedProduct } from './parser.js';
import { productUrl } from './url.js';

type Capability = 'RESOLUTION' | 'OBSERVATION';
export interface CapabilityHealth {
  readonly capability: Capability; readonly state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'BLOCKED';
  readonly observedAt: number; readonly reason: string; readonly lastSuccessAt: number | null; readonly lastFailureAt: number | null;
}
export interface ReadDiagnostic {
  readonly storeId: string; readonly capability: Capability; readonly operationId: string; readonly traceId: string;
  readonly monitorId: string | null; readonly runId: string | null; readonly adapterVersion: string; readonly parserVersion: string;
  readonly at: number; readonly status: 'QUEUED' | 'SUCCESS' | AdapterError['code']; readonly durationMs: number;
  readonly captureId: string | null; readonly productId: string | null; readonly variantId: string | null;
}
// Hash-free bounded identifiers only; never log URLs, titles, body fragments, GraphQL messages or headers.
function safeId(value: string | undefined): string | null {
  return value !== undefined && /^[a-zA-Z0-9:_,\[\]" -]{1,300}$/.test(value) ? value : null;
}
export class ShopifyAdapter implements OfferObservationCapability, ListingResolutionCapability {
  readonly descriptor = freeze({ id: 'shopify-fixture', version: SHOPIFY_VERSION, contractVersion: 1 as const, automationLevel: 'OBSERVE_ONLY' as const, capabilities: ['RESOLUTION', 'OBSERVATION'] as const });
  readonly config: ShopifyFixtureConfig;
  readonly #health: Record<Capability, CapabilityHealth>;
  readonly #diagnostics: ReadDiagnostic[] = [];
  readonly #counts = { readAttempts: 0, successfulReads: 0, failedReads: 0, parserFailures: 0, normalizationFailures: 0, rateLimitedReads: 0, blockedReads: 0, productsObserved: 0, variantsObserved: 0, totalLatencyMs: 0, queueDelayMs: 0, lastSuccessAt: null as number | null };
  constructor(config: ShopifyFixtureConfig, private readonly transport: ShopifyFixtureTransport, private readonly scheduler: ReadScheduler, private readonly clock: ReadClock) {
    this.config = validateConfig(config);
    const initial = (capability: Capability): CapabilityHealth => ({ capability, state: 'UNAVAILABLE', observedAt: clock.now(), reason: 'NOT_PROBED', lastSuccessAt: null, lastFailureAt: null });
    this.#health = { RESOLUTION: initial('RESOLUTION'), OBSERVATION: initial('OBSERVATION') };
  }
  health(capability: Capability): CapabilityHealth {
    const health = this.#health[capability];
    return freeze(health.state === 'HEALTHY' && health.lastSuccessAt !== null && this.clock.now() - health.lastSuccessAt > 60_000
      ? { ...health, state: 'DEGRADED', reason: 'STALE_SUCCESS', observedAt: this.clock.now() } : { ...health });
  }
  diagnostics(): readonly ReadDiagnostic[] { return freeze([...this.#diagnostics]); }
  metrics() { return freeze({ ...this.#counts, lastSuccessAgeMs: this.#counts.lastSuccessAt === null ? null : this.clock.now() - this.#counts.lastSuccessAt }); }

  async resolve(url: string, context: ReadContext): Promise<{ readonly ok: true; readonly resolution: ListingResolution; } | { readonly ok: false; readonly error: AdapterError; }> {
    try {
      const source = productUrl(url, this.config);
      const resolution = await this.read('RESOLUTION', source.handle, context, (product, capture) => {
        const variants = product.variants.map(v => ({ variantRef: ref(this.config.storeId, 'variant', v.id), offerRef: offerIdentity(this.config, product, v, context.deliveryScope), sku: v.sku, title: v.title }));
        const selected = source.variantId === null ? variants.length === 1 ? variants[0] : undefined : variants.find(v => v.variantRef.externalId === source.variantId);
        if (source.variantId !== null && !selected) throw new ReadFailure('LISTING_NOT_FOUND');
        this.log('RESOLUTION', context, 'SUCCESS', capture.capturedAt, capture.id, product.id, selected?.variantRef.externalId);
        return freeze({ sourceReference: source.canonical, productRef: ref(this.config.storeId, 'product', product.id), variants, selectedOffer: selected?.offerRef ?? null });
      });
      return { ok: true, resolution };
    } catch (error) { return this.failure('RESOLUTION', context, error); }
  }
  async observe(offerRef: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult> {
    try {
      if (offerRef.storeId !== this.config.storeId || offerRef.kind !== 'offer') throw new ReadFailure('CONTEXT_MISMATCH');
      if (!context.sourceReference) throw new ReadFailure('INVALID_URL');
      const source = productUrl(context.sourceReference, this.config);
      const normalized = await this.read('OBSERVATION', source.handle, context, (product, capture) => {
        const variant = product.variants.find(v => refKey(offerIdentity(this.config, product, v, context.deliveryScope)) === refKey(offerRef));
        if (!variant || (source.variantId !== null && variant.id !== source.variantId)) throw new ReadFailure('CONTEXT_MISMATCH');
        const result = normalizeProduct(this.config, product, variant, capture, context.deliveryScope);
        this.log('OBSERVATION', context, 'SUCCESS', capture.capturedAt, capture.id, product.id, variant.id);
        return result;
      });
      return { ok: true, ...normalized, completedAt: this.clock.now() };
    } catch (error) { return this.failure('OBSERVATION', context, error); }
  }
  private async read<T>(capability: Capability, handle: string, context: ReadContext, normalize: (product: ParsedProduct, capture: Capture) => T): Promise<T> {
    if (!Number.isSafeInteger(context.now) || context.now < 0 || !Number.isSafeInteger(context.deadlineAt) || context.deadlineAt <= context.now || context.deadlineAt - context.now > 60_000) throw new ReadFailure('CONTEXT_MISMATCH');
    if (!context.deliveryScope.trim() || context.deliveryScope.length > 100) throw new ReadFailure('CONTEXT_MISMATCH');
    this.#health[capability] = { ...this.#health[capability], state: 'DEGRADED', observedAt: this.clock.now(), reason: 'QUEUED' };
    this.log(capability, context, 'QUEUED', this.clock.now());
    const scheduled = await this.scheduler.perform({ scope: `shopify:${this.config.storeId}`, context, minimumIntervalMs: this.config.minimumIntervalMs, maxAttempts: this.config.maxAttempts }, async () => {
      this.#counts.readAttempts++;
      const start = this.clock.now();
      let stage: 'CAPTURE' | 'PARSE' | 'NORMALIZE' = 'CAPTURE';
      try {
        const capture = await captureProduct(this.config, handle, context, this.clock, this.transport);
        stage = 'PARSE';
        const product = parseProduct(capture.body);
        if (product.handle !== handle) throw new ReadFailure('SCHEMA_MISMATCH');
        stage = 'NORMALIZE';
        const value = normalize(product, capture);
        this.#counts.successfulReads++; this.#counts.productsObserved++; this.#counts.variantsObserved += product.variants.length;
        this.#counts.lastSuccessAt = this.clock.now();
        return value;
      } catch (error) {
        this.#counts.failedReads++;
        if (error instanceof ReadFailure) {
          if (stage === 'PARSE' && ['SCHEMA_MISMATCH', 'MALFORMED_RESPONSE'].includes(error.code)) this.#counts.parserFailures++;
          if (stage === 'NORMALIZE') this.#counts.normalizationFailures++;
          if (error.code === 'RATE_LIMITED') this.#counts.rateLimitedReads++;
          if (error.code === 'BLOCKED') this.#counts.blockedReads++;
          this.log(capability, context, error.code, start);
          this.setFailure(capability, error);
        }
        throw error;
      } finally { this.#counts.totalLatencyMs += this.clock.now() - start; }
    });
    this.#counts.queueDelayMs += scheduled.queueDelayMs;
    this.#health[capability] = { ...this.#health[capability], state: 'HEALTHY', reason: 'FIXTURE_READ_OK', observedAt: this.clock.now(), lastSuccessAt: this.clock.now() };
    return scheduled.value;
  }
  private failure(capability: Capability, context: ReadContext, error: unknown): { readonly ok: false; readonly error: AdapterError; } {
    if (!(error instanceof ReadFailure)) throw error;
    this.setFailure(capability, error);
    this.log(capability, context, error.code, context.now);
    return { ok: false, error: adapterError(error, context.operationId) };
  }
  private setFailure(capability: Capability, error: ReadFailure): void {
    const state = error.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : ['BLOCKED', 'POLICY_DENIED', 'NETWORK_DISABLED', 'REDIRECT_DENIED'].includes(error.code) ? 'BLOCKED'
      : ['RATE_LIMITED', 'TRANSIENT_FAILURE', 'DEADLINE_EXCEEDED', 'QUEUE_FULL', 'CANCELLED'].includes(error.code) ? 'DEGRADED' : 'UNAVAILABLE';
    this.#health[capability] = { ...this.#health[capability], state, reason: error.code, observedAt: this.clock.now(), lastFailureAt: this.clock.now() };
  }
  private log(capability: Capability, context: ReadContext, status: ReadDiagnostic['status'], start: number, captureId?: string, productId?: string, variantId?: string): void {
    this.#diagnostics.push(freeze({
      storeId: this.config.storeId, capability, operationId: safeId(context.operationId) ?? 'REDACTED', traceId: safeId(context.traceId) ?? 'REDACTED', monitorId: safeId(context.monitorId), runId: safeId(context.runId), adapterVersion: SHOPIFY_VERSION, parserVersion: SHOPIFY_VERSION,
      at: this.clock.now(), status, durationMs: Math.max(0, this.clock.now() - start), captureId: captureId ?? null, productId: productId ?? null, variantId: variantId ?? null
    }));
    if (this.#diagnostics.length > 100) this.#diagnostics.shift();
  }
}
