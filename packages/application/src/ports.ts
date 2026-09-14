import type { Currency, ListingObservation, StoreRef } from '@ptcg/core';

export interface ReadContext {
  readonly now: number; readonly deadlineAt: number;
  readonly operationId: string; readonly traceId: string;
  readonly currency: Currency; readonly deliveryScope: string;
  readonly cancellation?: { readonly aborted: boolean; };
  readonly monitorId?: string; readonly runId?: string;
  readonly sourceReference?: string;
}
export interface AdapterError {
  readonly code: 'LISTING_NOT_FOUND' | 'DEADLINE_EXCEEDED' | 'CONTEXT_MISMATCH' | 'INVALID_URL' | 'POLICY_DENIED' | 'NETWORK_DISABLED'
  | 'CANCELLED' | 'BODY_TOO_LARGE' | 'CONTENT_TYPE' | 'REDIRECT_DENIED' | 'RATE_LIMITED' | 'TRANSIENT_FAILURE'
  | 'BLOCKED' | 'AUTH_REQUIRED' | 'SCHEMA_MISMATCH' | 'MALFORMED_RESPONSE' | 'NORMALIZATION_FAILED' | 'VARIANT_REQUIRED' | 'QUEUE_FULL';
  readonly category: 'NON_RETRYABLE' | 'RETRYABLE_READ' | 'USER_ACTION_REQUIRED'; readonly externalEffect: 'NOT_SENT';
  readonly operationId: string;
  readonly retryAfterMs?: number;
}
export type ReadResult = { readonly ok: true; readonly observation: ListingObservation; readonly catalog?: import('./source-contracts.js').CatalogMetadata; readonly completedAt?: number; }
  | { readonly ok: false; readonly error: AdapterError; };

// Only the capability M1 actually consumes; no future checkout stubs.
export interface OfferObservationCapability {
  readonly descriptor: {
    readonly id: string; readonly version: string; readonly contractVersion: 1;
    readonly automationLevel: 'OBSERVE_ONLY'; readonly capabilities: readonly ['OBSERVATION'] | readonly ['RESOLUTION', 'OBSERVATION'];
  };
  observe(offerRef: StoreRef<'offer'>, context: ReadContext): Promise<ReadResult>;
}
