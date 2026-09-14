import { evaluateSimulation, stableKey } from '@ptcg/application';
import type { DecisionEvidence } from '@ptcg/application';
import type { DurableStore } from '@ptcg/infrastructure';
import type { durableFixture } from './durable.js';

/** Prepare both competitors before starting real concurrent admission transactions. */
export async function prepare(store: DurableStore, f: ReturnType<typeof durableFixture>): Promise<DecisionEvidence> {
  const monitor = store.monitors.getMonitor(f.definition.monitorId);
  store.monitors.startRun(f.command);
  const request = {
    ...f.definition.configuration, now: f.command.now, traceId: f.command.traceId,
    operationId: stableKey('DRY_RUN', f.definition.ownerId, f.command.operationId),
    cycleId: stableKey('DRY_RUN', f.definition.ownerId, f.definition.cycleId)
  };
  const evaluation = await evaluateSimulation(f.adapter, request);
  if (evaluation.status !== 'EVALUATED') throw new Error('Fixture did not evaluate');
  const evidence = { monitor, command: f.command, request, evaluation };
  store.evidence.recordEvaluation(evidence);
  return evidence;
}
