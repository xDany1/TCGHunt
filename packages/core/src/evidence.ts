import { check, freeze, instant, positiveInteger } from './value.js';
import type { Check } from './value.js';

export interface Evidence {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly captureId: string;
  readonly adapterVersion: string;
  readonly parserVersion: string;
  readonly field: string;
  readonly rights: 'SYNTHETIC' | 'PERMITTED';
  readonly sourceObservedAt: number;
  readonly capturedAt: number;
  readonly receivedAt: number;
  readonly expiresAt: number;
}
export type Observed<T> =
  | { readonly state: 'KNOWN'; readonly value: T; readonly evidence: Evidence; }
  | { readonly state: 'UNKNOWN' | 'NOT_APPLICABLE'; readonly reason: string; readonly evidence: Evidence; };

export function known<T>(value: T, evidence: Evidence): Observed<T> { return freeze({ state: 'KNOWN', value, evidence }); }
export function unknown<T>(reason: string, evidence: Evidence): Observed<T> { return freeze({ state: 'UNKNOWN', reason, evidence }); }

export function assessEvidence<T>(field: Observed<T>, now: number, maxAgeMs = 60_000): Check {
  instant(now);
  positiveInteger(maxAgeMs);
  const e = field.evidence;
  const times = [e.sourceObservedAt, e.capturedAt, e.receivedAt, e.expiresAt];
  const validTimes = times.every(t => Number.isSafeInteger(t) && t >= 0);
  const provenance = [e.id, e.sourceId, e.sourceVersion, e.captureId, e.adapterVersion, e.parserVersion, e.field].every(s => typeof s === 'string' && s.trim().length > 0);
  if (!validTimes || !provenance || !['SYNTHETIC', 'PERMITTED'].includes(e.rights) || e.sourceObservedAt > e.capturedAt || e.capturedAt > e.receivedAt || e.receivedAt > now || e.expiresAt < e.sourceObservedAt) {
    return check('INVALID_EVIDENCE', 'INDETERMINATE', { field: e.field }, [e.id]);
  }
  if (field.state !== 'KNOWN') return check('MISSING_EVIDENCE', 'INDETERMINATE', { field: e.field, reason: field.reason }, [e.id]);
  if (now - e.sourceObservedAt > maxAgeMs || now >= e.expiresAt) return check('STALE_EVIDENCE', 'INDETERMINATE', { field: e.field }, [e.id]);
  return check('FRESH_EVIDENCE', 'PASS', { field: e.field }, [e.id]);
}
