import type { Currency, Id, ListingObservation, StoreRef } from '@ptcg/core';
import type { AdapterError, ReadContext } from './ports.js';

export interface StoreInstanceMetadata {
  readonly id: Id<'store'>; readonly family: string; readonly canonicalDomain: string;
  readonly region: string | null; readonly currency: Currency | null; readonly accessPolicyRef: string;
  readonly adapterVersion: string; readonly capabilities: readonly ['RESOLUTION', 'OBSERVATION'];
  readonly accessMode: 'FIXTURE_ONLY' | 'AUTHORIZED_VALIDATION'; readonly retention: 'AUTHORED_SYNTHETIC' | 'VALIDATION_EVIDENCE_ONLY'; readonly commercialUse: 'UNVALIDATED';
}
/** Normalized catalog facts, not raw provider response fields. */
export interface CatalogMetadata {
  readonly store: StoreInstanceMetadata; readonly sourceReference: string; readonly productType: string;
  readonly sku: string | null; readonly variantTitle: string; readonly options: readonly { readonly name: string; readonly value: string; }[];
  readonly evidenceBasis?: 'LIVE_CAPTURE' | 'USER_SUPPLIED_LIVE_SUMMARY';
  readonly saleAvailable?: boolean | null;
}
export interface ListingResolution {
  readonly sourceReference: string; readonly productRef: StoreRef<'product'>;
  readonly variants: readonly { readonly variantRef: StoreRef<'variant'>; readonly offerRef: StoreRef<'offer'>; readonly sku: string | null; readonly title: string; }[];
  readonly selectedOffer: StoreRef<'offer'> | null;
}
export interface ListingResolutionCapability {
  resolve(url: string, context: ReadContext): Promise<{ readonly ok: true; readonly resolution: ListingResolution; } | { readonly ok: false; readonly error: AdapterError; }>;
}
export interface ReadClock {
  now(): number;
  waitUntil(at: number, cancellation?: ReadContext['cancellation']): Promise<void>;
}
export interface ReadQuotaRepository {
  claimReadSlot(scope: string, now: number, intervalMs: number): { readonly granted: boolean; readonly nextAt: number; readonly blocked: AdapterError['code'] | null; };
  deferReads(scope: string, nextAt: number, blocked?: AdapterError['code']): void;
}
export interface ReadJob {
  readonly scope: string; readonly context: ReadContext; readonly minimumIntervalMs: number; readonly maxAttempts: number;
}
export interface ScheduledValue<T> { readonly value: T; readonly queueDelayMs: number; readonly attempts: number; }
export interface ReadScheduler {
  perform<T>(job: ReadJob, read: (attempt: number) => Promise<T>): Promise<ScheduledValue<T>>;
}
export class ReadFailure extends Error {
  constructor(readonly code: AdapterError['code'], readonly retryAfterMs = 0) { super(code); this.name = 'ReadFailure'; }
}
export function adapterError(error: ReadFailure, operationId: string): AdapterError {
  return {
    code: error.code, operationId, externalEffect: 'NOT_SENT', category:
      ['RATE_LIMITED', 'TRANSIENT_FAILURE'].includes(error.code) ? 'RETRYABLE_READ' : ['BLOCKED', 'AUTH_REQUIRED', 'POLICY_DENIED'].includes(error.code) ? 'USER_ACTION_REQUIRED' : 'NON_RETRYABLE',
    ...(error.retryAfterMs > 0 ? { retryAfterMs: error.retryAfterMs } : {})
  };
}
export interface ObservationHistoryItem { readonly observation: ListingObservation; readonly catalog: CatalogMetadata | null; }
