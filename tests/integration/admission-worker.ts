import { parentPort, workerData } from 'node:worker_threads';
import { openDurableStore } from '@ptcg/infrastructure';
import { PersistenceFailure } from '@ptcg/application';

const input = workerData as { readonly path: string; readonly evaluationId: string; readonly gate: SharedArrayBuffer; readonly hold: boolean; };
const gate = new Int32Array(input.gate);
const store = openDurableStore(input.path, {
  fault: point => {
    if (input.hold && point === 'AFTER_RESERVATION') {
      parentPort?.postMessage({ type: 'HELD' });
      if (Atomics.wait(gate, 0, 0, 10_000) === 'timed-out') throw new Error('Parent did not release test transaction');
    }
  }
});
const evidence = store.evidence.getEvaluation(input.evaluationId);
parentPort?.postMessage({ type: 'READY' });
parentPort?.once('message', () => {
  try { parentPort?.postMessage({ type: 'RESULT', result: store.execution.commitSimulatedDecision(evidence) }); }
  catch (error) { parentPort?.postMessage({ type: 'RESULT', result: { status: 'FAILED', code: error instanceof PersistenceFailure ? error.code : 'UNEXPECTED' } }); }
  finally { store.close(); parentPort?.close(); }
});
