import { instant, nextAttemptState, nextIntentState, positiveInteger } from '@ptcg/core';
import type { AttemptState, IntentState } from '@ptcg/core';
import { PersistenceFailure } from './durable-contracts.js';
import type { MonitorSnapshot, RunCommand, SimulatedLimitPolicy } from './durable-contracts.js';

export const UTC_DAY_MS = 86_400_000;
export function utcDay(now: number): { readonly start: number; readonly end: number; } {
  const start = Math.floor(instant(now) / UTC_DAY_MS) * UTC_DAY_MS;
  return { start, end: instant(start + UTC_DAY_MS) };
}
export function stableKey(...parts: readonly (string | number)[]): string { return JSON.stringify(parts); }
export function operationSubject(m: MonitorSnapshot, command: RunCommand): string {
  const d = m.definition;
  // Time, run and trace are delivery metadata. Monitor revision/policy/subject changes are not retries.
  return stableKey(d.monitorId, command.revision, d.ownerId, d.campaignId, d.cycleId);
}
export function validateLimits(p: SimulatedLimitPolicy): void {
  positiveInteger(p.version);
  positiveInteger(p.productCampaignQuantity);
  positiveInteger(p.dailyAttempts);
  positiveInteger(p.cooldownMs);
  if (!p.ownerId.trim() || p.timezone !== 'UTC' || p.dailySpend.minor < 0n ||
    p.dailySpend.minor > 9_000_000_000_000_000n || !['MXN', 'USD'].includes(p.dailySpend.currency)) throw new PersistenceFailure('INVALID_INPUT');
}
export function guardTransition(
  aggregate: 'PurchaseIntent' | 'CheckoutAttempt', current: { readonly state: string; readonly version: number; },
  expected: { readonly state: string; readonly version: number; }, next: string
): number {
  if (current.state !== expected.state || current.version !== expected.version) throw new PersistenceFailure('STALE_VERSION');
  try {
    if (aggregate === 'PurchaseIntent') nextIntentState(current.state as IntentState, next as IntentState);
    else nextAttemptState(current.state as AttemptState, next as AttemptState);
  } catch { throw new PersistenceFailure('INVALID_TRANSITION'); }
  return positiveInteger(current.version + 1);
}
