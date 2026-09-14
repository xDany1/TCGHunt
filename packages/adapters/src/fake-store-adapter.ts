import { freeze, instant, refKey } from '@ptcg/core';
import type { ListingObservation, StoreRef } from '@ptcg/core';
import type { AdapterError, OfferObservationCapability, ReadContext, ReadResult } from '@ptcg/application';

/** Fixture playback only. There is no transport, URL fetch, clock, or mutation API. */
export class FakeStoreAdapter implements OfferObservationCapability {
  readonly descriptor = freeze({
    id: 'fake-store', version: '1.0.0', contractVersion: 1,
    automationLevel: 'OBSERVE_ONLY', capabilities: ['OBSERVATION']
  } as const);
  readonly #observations: ReadonlyMap<string, ListingObservation>;

  constructor(observations: readonly ListingObservation[]) {
    const entries = observations.map(o => [refKey(o.offer.ref), freeze(o)] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new RangeError('Duplicate fixture offer identity');
    this.#observations = new Map(entries);
    Object.freeze(this);
  }

  observe(offerRef: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult> {
    instant(context.now);
    instant(context.deadlineAt);
    const fail = (code: AdapterError['code']): Promise<ReadResult> => Promise.resolve(freeze({
      ok: false,
      error: { code, category: 'NON_RETRYABLE', externalEffect: 'NOT_SENT', operationId: context.operationId }
    }));
    if (context.now >= context.deadlineAt) return fail('DEADLINE_EXCEEDED');
    const observation = this.#observations.get(refKey(offerRef));
    if (!observation) return fail('LISTING_NOT_FOUND');
    if (observation.offer.deliveryScope !== context.deliveryScope ||
      (observation.unitPrice.state === 'KNOWN' && observation.unitPrice.value.currency !== context.currency)) return fail('CONTEXT_MISMATCH');
    return Promise.resolve(freeze({ ok: true, observation }));
  }
}
