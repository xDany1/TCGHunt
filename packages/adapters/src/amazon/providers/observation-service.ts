import { freeze, refKey } from '@ptcg/core';
import type { StoreRef } from '@ptcg/core';
import { adapterError, ReadFailure } from '@ptcg/application';
import type { AdapterError, ListingResolutionCapability, OfferObservationCapability, ReadContext, ReadResult } from '@ptcg/application';
import { amazonUrl } from '../url.js';
import { AMAZON_PROVIDER_VERSION } from './contract.js';
import type { AmazonProvider, AmazonProviderConfig, AmazonProviderDiagnostic, AmazonResultCategory, AmazonTarget } from './contract.js';
import { normalizeAmazon } from './normalize.js';
import { mapAmazonDomain } from './domain-map.js';
import type { AmazonProductReview } from './domain-map.js';

const ERRORS: Record<Exclude<AmazonResultCategory, 'OBSERVED' | 'CONTENT_INCOMPLETE'>, AdapterError['code']> = {
  PAGE_UNAVAILABLE: 'LISTING_NOT_FOUND', CHALLENGE_DETECTED: 'BLOCKED', ACCESS_DENIED: 'BLOCKED', PARSER_MISMATCH: 'SCHEMA_MISMATCH', NETWORK_ERROR: 'TRANSIENT_FAILURE', AUTH_REQUIRED: 'AUTH_REQUIRED', THROTTLED: 'RATE_LIMITED', TIMEOUT: 'DEADLINE_EXCEEDED'
};
/** Composition selects exactly one provider. There is no registry traversal, fallback or retry migration. */
export class AmazonObservationService implements ListingResolutionCapability, OfferObservationCapability {
  readonly descriptor = freeze({ id: 'amazon-m5.2-offline', version: AMAZON_PROVIDER_VERSION, contractVersion: 1 as const, automationLevel: 'OBSERVE_ONLY' as const, capabilities: ['RESOLUTION', 'OBSERVATION'] as const });
  private readonly history: AmazonProviderDiagnostic[] = [];
  private readonly config: AmazonProviderConfig;
  constructor(config: AmazonProviderConfig, private readonly provider: AmazonProvider, private readonly clock: () => number, private readonly retailIds: readonly string[] = [], private readonly review?: AmazonProductReview) {
    if (config.networkEnabled !== undefined && config.networkEnabled !== false) throw new ReadFailure('NETWORK_DISABLED');
    if (!['BUSINESS_API', 'BROWSER'].includes(config.provider) || config.provider !== provider.kind || provider.mode !== 'FIXTURE_ONLY' || config.marketplace !== 'MX' || !config.deliveryScope.trim()) throw new ReadFailure('CONTEXT_MISMATCH');
    this.config = freeze({ ...config, networkEnabled: false }); freeze(retailIds); if (review) freeze(review);
  }
  diagnostics(): readonly AmazonProviderDiagnostic[] { return freeze([...this.history]); }
  async inspect(input: string, context: ReadContext) {
    const url = amazonUrl(input); const startedAt = this.clock(); let result: AmazonResultCategory = 'PARSER_MISMATCH'; let count = 0; let complete: AmazonProviderDiagnostic['completeness'] = 'INCOMPLETE'; let errorClass: string | null = null;
    try {
      if (context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
      if (!Number.isSafeInteger(startedAt) || startedAt < context.now || startedAt >= context.deadlineAt) throw new ReadFailure('DEADLINE_EXCEEDED');
      if (context.currency !== 'MXN' || context.deliveryScope !== this.config.deliveryScope) throw new ReadFailure('CONTEXT_MISMATCH');
      const target: AmazonTarget = { asin: url.asin, url: url.canonical, marketplace: 'MX', deliveryScope: this.config.deliveryScope };
      const captured = await this.provider.read(target, context); result = captured.category;
      if (context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
      if (this.clock() >= context.deadlineAt) throw new ReadFailure('DEADLINE_EXCEEDED');
      if (!('evidence' in captured)) throw new ReadFailure(ERRORS[captured.category]);
      if (captured.evidence.asin !== target.asin || captured.evidence.source.provider !== this.config.provider || captured.evidence.marketplace !== 'MX') throw new ReadFailure('CONTEXT_MISMATCH');
      const normalized = normalizeAmazon(captured.evidence, this.retailIds); count = normalized.offers.length; complete = normalized.completeness;
      if (complete === 'INCOMPLETE') result = 'CONTENT_INCOMPLETE';
      return { normalized, ...mapAmazonDomain(normalized, target.deliveryScope, this.review) };
    } catch (error) {
      const safe = error instanceof ReadFailure ? error : new ReadFailure('TRANSIENT_FAILURE'); errorClass = safe.code;
      if (safe.code === 'DEADLINE_EXCEEDED') result = 'TIMEOUT';
      else if (['SCHEMA_MISMATCH', 'MALFORMED_RESPONSE', 'NORMALIZATION_FAILED', 'CONTEXT_MISMATCH', 'INVALID_URL', 'BODY_TOO_LARGE'].includes(safe.code)) result = 'PARSER_MISMATCH';
      else if (!(error instanceof ReadFailure)) result = 'NETWORK_ERROR';
      throw safe;
    } finally {
      this.history.push(freeze({ provider: this.config.provider, asin: url.asin, startedAt, endedAt: this.clock(), result, offerCount: count, completeness: complete, challengeDetected: result === 'CHALLENGE_DETECTED', parseFailure: result === 'PARSER_MISMATCH', authRequired: result === 'AUTH_REQUIRED', timeout: result === 'TIMEOUT', errorClass }));
      if (this.history.length > 100) this.history.shift();
    }
  }
  async resolve(input: string, context: ReadContext) {
    try {
      const q = await this.inspect(input, context);
      return { ok: true as const, resolution: { sourceReference: q.catalog.sourceReference, productRef: q.productRef, variants: q.observations.map(o => ({ variantRef: o.variant.ref, offerRef: o.offer.ref, sku: null, title: o.product.title })), selectedOffer: null } };
    } catch (error) { return { ok: false as const, error: adapterError(error instanceof ReadFailure ? error : new ReadFailure('TRANSIENT_FAILURE'), context.operationId) }; }
  }
  async observe(offerRef: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult> {
    try {
      if (!context.sourceReference) throw new ReadFailure('INVALID_URL');
      const q = await this.inspect(context.sourceReference, context); const observation = q.observations.find(o => refKey(o.offer.ref) === refKey(offerRef));
      if (!observation) throw new ReadFailure('LISTING_NOT_FOUND'); return { ok: true, observation, catalog: q.catalog };
    } catch (error) { return { ok: false, error: adapterError(error instanceof ReadFailure ? error : new ReadFailure('TRANSIENT_FAILURE'), context.operationId) }; }
  }
}
