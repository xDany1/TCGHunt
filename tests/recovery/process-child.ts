import { openDurableStore } from '@ptcg/infrastructure';
const [path, evaluationId, point] = process.argv.slice(2);
if (!path || !evaluationId || !point) throw new Error('Missing child fixture parameters');
const store = openDurableStore(path, { fault: current => { if (current === point) process.exit(91); } });
if (point === 'AFTER_HANDLER_RECEIPT') store.outbox.deliverPendingNotifications(1_800_000_000_000);
else store.execution.commitSimulatedDecision(store.evidence.getEvaluation(evaluationId));
// Intentionally omit close: emulate process loss after a successful commit too.
process.exit(0);
