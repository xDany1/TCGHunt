import { freeze, instant, positiveInteger } from '@ptcg/core';
import { evaluateSimulation } from './evaluate-simulation.js';
import type { AdapterError, OfferObservationCapability } from './ports.js';
import { PersistenceFailure, isProductMonitor } from './durable-contracts.js';
import type { CommittedDecision, EvidenceRepository, ExecutionRepository, MonitorRepository, OutboxRepository, PersistenceCode, RunCommand } from './durable-contracts.js';

export type DurableRunResult = CommittedDecision | {
  readonly status: 'FAILED'; readonly code: PersistenceCode | 'READ_FAILED'; readonly externalEffect: 'NOT_SENT';
  readonly adapterError?: AdapterError;
};
/** One host-owned instance. Adapters and outbox handlers never receive this authority. */
export class DurableCoordinator {
  constructor(
    private readonly monitors: MonitorRepository,
    private readonly evidence: EvidenceRepository,
    private readonly execution: ExecutionRepository,
    private readonly outbox: OutboxRepository
  ) { }

  async run(adapter: OfferObservationCapability, command: RunCommand): Promise<DurableRunResult> {
    try {
      freeze(command);
      instant(command.now);
      positiveInteger(command.revision);
      const monitor = this.monitors.getMonitor(command.monitorId);
      const configuration = monitor.definition.configuration;
      if (isProductMonitor(configuration)) throw new PersistenceFailure('INVALID_INPUT');
      const previous = this.execution.findOperation(monitor, command);
      if (previous) return previous;
      this.monitors.startRun(command);
      const request = freeze({
        ...configuration, now: command.now, traceId: command.traceId, monitorId: command.monitorId, runId: command.runId,
        operationId: JSON.stringify(['DRY_RUN', monitor.definition.ownerId, command.operationId]),
        cycleId: JSON.stringify(['DRY_RUN', monitor.definition.ownerId, monitor.definition.cycleId])
      });
      const evaluation = await evaluateSimulation(adapter, request);
      if (evaluation.status === 'READ_FAILED') {
        this.monitors.failRun(command, evaluation.error.code);
        return freeze({ status: 'FAILED', code: 'READ_FAILED', externalEffect: 'NOT_SENT', adapterError: evaluation.error });
      }
      const completedAt = evaluation.simulation.audit.occurredAt;
      const evidence = freeze({ monitor, command: { ...command, now: completedAt }, request: { ...request, now: completedAt }, evaluation });
      this.evidence.recordEvaluation(evidence);
      return this.execution.commitSimulatedDecision(evidence);
    } catch (error) {
      if (error instanceof PersistenceFailure) return freeze({ status: 'FAILED', code: error.code, externalEffect: 'NOT_SENT' });
      if (error instanceof RangeError || error instanceof TypeError) return freeze({ status: 'FAILED', code: 'INVALID_INPUT', externalEffect: 'NOT_SENT' });
      // Unexpected exceptions are surfaced without serializing untrusted adapter/driver messages.
      return freeze({ status: 'FAILED', code: 'STORAGE_FAILURE', externalEffect: 'NOT_SENT' });
    }
  }

  recover(now: number): { readonly interruptedRuns: number; readonly delivered: number; readonly failed: number; } {
    instant(now);
    const interruptedRuns = this.monitors.recoverInterruptedRuns(now);
    return { interruptedRuns, ...this.outbox.deliverPendingNotifications(now) };
  }
}
