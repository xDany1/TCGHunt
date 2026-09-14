import type { MonitorSnapshot, DecisionEvidence, SafeAudit } from './durable-contracts.js';
import type { ObservationHistoryItem } from './source-contracts.js';
export class DesktopFailure extends Error { constructor(readonly code: 'STORE_DISABLED' | 'READ_BUDGET_EXHAUSTED' | 'NOT_DUE' | 'STORE_COOLDOWN' | 'NETWORK_NOT_ENABLED' | 'BUSY' | 'SUSPENDED' | 'READ_ONLY_MONITOR') { super(code); } }

export interface DesktopSettings {
  readonly version: number; readonly refreshSeconds: number; readonly storeEnabled: boolean; readonly liveReadsUsed: number;
  readonly lastFailureAt: number | null; readonly lastFailure: string | null;
}
export interface DesktopMonitorRecord { readonly monitor: MonitorSnapshot; readonly nextDueAt: number | null; readonly lastRunAt: number | null; readonly lastResult: string | null; readonly lastObservation: ObservationHistoryItem | null; }
export interface DesktopEvaluationRecord { readonly evidence: DecisionEvidence; readonly outcome: string; readonly intentId: string | null; readonly decision: 'BLOCKED' | 'SIMULATED' | 'NOT_ADMITTED'; readonly decisionEvaluationId: string | null; }
export interface DesktopAuditRecord { readonly audit: SafeAudit; readonly runId: string | null; readonly observationId: string | null; readonly outbox: string | null; }
/** Indexed read projections and the small persisted desktop scheduler/settings state. */
export interface DesktopRepository {
  settings(): DesktopSettings;
  updateSettings(input: { readonly expectedVersion: number; readonly refreshSeconds: number; readonly storeEnabled: boolean; }, now: number): void;
  listMonitors(): readonly DesktopMonitorRecord[];
  latestProducts(): readonly ObservationHistoryItem[];
  productHistory(offerId: string): readonly ObservationHistoryItem[];
  evaluations(): readonly DesktopEvaluationRecord[];
  evaluation(id: string): DesktopEvaluationRecord;
  audits(): readonly DesktopAuditRecord[];
  claimScheduledRead(monitorId: string, now: number, manual: boolean, live: boolean): void;
  coalesceOverdue(now: number): void;
  recordFailure(code: string, now: number, scope?: string): void;
  sourceReady(scope: string, now: number): boolean;
  ensureSimulationOwner(ownerId: string, now: number): void;
  counts(now: number): { readonly active: number; readonly delayed: number; readonly productsToday: number; readonly opportunities: number; readonly blockedToday: number; readonly simulatedToday: number; readonly lastObservationAt: number | null; readonly pendingOutbox: number; };
  runtimeInfo(): { readonly schemaVersion: number; readonly sqliteVersion: string; };
}
