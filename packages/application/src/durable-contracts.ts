import type { Currency, Id, Money, SimulationResult } from '@ptcg/core';
import type { EvaluationResult, SimulationRequest } from './evaluate-simulation.js';

export type PersistenceCode = 'STORAGE_FAILURE' | 'STORAGE_BUSY' | 'CONFLICT' | 'NOT_FOUND' | 'STALE_VERSION' | 'INVALID_TRANSITION' | 'INVALID_INPUT' | 'RECOVERY_READ_ONLY' | 'SCHEMA_UNSUPPORTED';
/** Deliberately excludes driver messages, SQL and captured payloads. */
export class PersistenceFailure extends Error {
  constructor(readonly code: PersistenceCode) { super(code); this.name = 'PersistenceFailure'; }
}
export type LocalOwnerId = Id<'local-owner'>;
export type MonitorConfiguration = Omit<SimulationRequest, 'now' | 'operationId' | 'traceId' | 'cycleId' | 'monitorId' | 'runId'>;
export interface ProductMonitorConfiguration {
  readonly kind: 'PRODUCT'; readonly mode: 'DRY_RUN'; readonly sourceReference: string;
  readonly productRef: import('@ptcg/core').StoreRef<'product'>; readonly deliveryScope: string;
  readonly provider: string;
}
export type AnyMonitorDefinition = MonitorDefinition<MonitorConfiguration | ProductMonitorConfiguration>;
export function isProductMonitor(c: MonitorConfiguration | ProductMonitorConfiguration): c is ProductMonitorConfiguration { return 'kind' in c && c.kind === 'PRODUCT'; }
export interface MonitorDefinition<C = MonitorConfiguration> {
  readonly desktop?: { readonly name: string; readonly cadenceSeconds: number; };
  readonly monitorId: Id<'monitor'>; readonly ownerId: LocalOwnerId;
  readonly campaignId: string; readonly cycleId: string;
  readonly configuration: C;
}
export interface MonitorSnapshot {
  readonly definition: AnyMonitorDefinition; readonly revision: number;
  readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; readonly version: number;
}
export interface RunCommand {
  readonly monitorId: Id<'monitor'>; readonly revision: number; readonly runId: string;
  readonly operationId: string; readonly traceId: string; readonly now: number;
}
export interface MonitorRun {
  readonly command: RunCommand; readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly version: number; readonly reason: string | null;
}
export interface SimulatedLimitPolicy {
  readonly ownerId: LocalOwnerId; readonly version: number; readonly timezone: 'UTC';
  readonly dailySpend: Money; readonly productCampaignQuantity: number;
  readonly dailyAttempts: number; readonly cooldownMs: number;
}
export interface MonitorRepository {
  publishRevision(definition: AnyMonitorDefinition, expectedVersion: number | null, now: number): MonitorSnapshot;
  changeStatus(monitorId: Id<'monitor'>, status: MonitorSnapshot['status'], expectedVersion: number, now: number): MonitorSnapshot;
  getMonitor(monitorId: Id<'monitor'>): MonitorSnapshot;
  startRun(command: RunCommand): MonitorRun;
  failRun(command: RunCommand, reason: 'READ_FAILED' | 'INVALID_INPUT' | import('./ports.js').AdapterError['code']): void;
  getRun(runId: string): MonitorRun;
  recoverInterruptedRuns(now: number): number;
}
export type CompletedEvaluation = Extract<EvaluationResult, { status: 'EVALUATED'; }>;
export interface DecisionEvidence {
  readonly monitor: MonitorSnapshot; readonly command: RunCommand;
  readonly request: SimulationRequest; readonly evaluation: CompletedEvaluation;
}
export type Eligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'INDETERMINATE';
export interface EvidenceRepository {
  recordEvaluation(evidence: DecisionEvidence): void;
  getEvaluation(evaluationId: string): DecisionEvidence;
  getObservationHistory(offer: import('@ptcg/core').StoreRef<'offer'>, limit?: number): readonly import('./source-contracts.js').ObservationHistoryItem[];
  getStoreMetadata(storeId: Id<'store'>): import('./source-contracts.js').StoreInstanceMetadata | null;
}
export interface CommittedDecision {
  readonly status: 'COMMITTED' | 'DUPLICATE';
  readonly reason: 'NEW_DECISION' | 'OPERATION' | 'CYCLE' | 'PRODUCT_GUARD';
  readonly simulation: SimulationResult;
}
export interface DecisionHistory {
  readonly simulation: SimulationResult; readonly intentVersion: number; readonly attemptVersion: number | null;
  readonly reservation: null | { readonly state: 'CONSUMED'; readonly upperBound: Money; readonly consumed: Money; readonly quantity: number; };
  readonly audit: readonly SafeAudit[];
}
export interface SafeAudit {
  readonly action: string; readonly aggregateId: string; readonly aggregateVersion: number;
  readonly occurredAt: number; readonly traceId: string; readonly operationId: string;
  readonly monitorId: string; readonly offerId: string; readonly evaluationId: string;
  readonly intentId: string; readonly checkoutAttemptId: string | null;
  readonly mode: 'DRY_RUN'; readonly from: string | null; readonly to: string | null;
}
export interface ExecutionRepository {
  configureLimits(policy: SimulatedLimitPolicy, expectedVersion: number | null, now: number): void;
  findOperation(monitor: MonitorSnapshot, command: RunCommand): CommittedDecision | null;
  commitSimulatedDecision(evidence: DecisionEvidence): CommittedDecision;
  getDecisionHistory(intentId: string): DecisionHistory;
  getUsage(ownerId: LocalOwnerId, campaignId: string, canonicalId: string, now: number): {
    readonly currency: Currency; readonly dailySpent: bigint; readonly dailyHeld: bigint;
    readonly campaignQuantity: bigint; readonly dailyAttempts: bigint;
  };
}
export interface OutboxEvent {
  readonly eventId: string; readonly eventType: 'PurchaseWouldHaveExecuted' | 'PurchaseBlocked'; readonly schemaVersion: 1;
  readonly aggregateType: 'PurchaseIntent'; readonly aggregateId: string; readonly aggregateVersion: number;
  readonly correlationId: string; readonly causationId: string; readonly traceId: string;
  readonly occurredAt: number; readonly recordedAt: number; readonly mode: 'DRY_RUN';
  readonly payload: { readonly evaluationId: string; readonly intentId: string; };
}
export interface OutboxStatus {
  readonly eventId: string; readonly status: 'PENDING' | 'DELIVERED' | 'DEAD_LETTER';
  readonly attempts: number; readonly lastError: 'HANDLER_FAILED' | 'INCOMPATIBLE_EVENT' | null;
}
export interface OutboxRepository {
  deliverPendingNotifications(now: number, limit?: number): { readonly delivered: number; readonly failed: number; };
  getOutbox(): readonly OutboxStatus[];
  getNotifications(): readonly { readonly eventId: string; readonly intentId: string; readonly action: OutboxEvent['eventType']; }[];
}
