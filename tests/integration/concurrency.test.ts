import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { money } from '@ptcg/core';
import type { CommittedDecision } from '@ptcg/application';
import { durableFixture, harness, limits, OWNER } from '../fixtures/durable.js';
import { prepare } from '../fixtures/prepared.js';
import { NOW } from '../fixtures/scenarios.js';

interface Message { readonly type: string; readonly result?: CommittedDecision | { readonly status: 'FAILED'; readonly code: string; }; }
function message(worker: Worker, expected: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.off('message', onMessage); reject(new Error(`Missing worker message ${expected}`)); }, 15_000);
    const onMessage = (value: Message) => { if (value.type === expected) { clearTimeout(timeout); worker.off('message', onMessage); resolve(value); } };
    worker.on('message', onMessage);
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
  });
}

for (const competition of ['budget', 'product guard'] as const) test(`actual competing SQLite writers serialize ${competition} admission`, { timeout: 30_000 }, async t => {
  const h = harness(t);
  const first = h.seed(undefined, limits({ dailySpend: money(competition === 'budget' ? 250_000n : 1_000_000n, 'MXN'), dailyAttempts: 10, productCampaignQuantity: 10 }));
  const second = durableFixture({ product: competition === 'budget' ? 'two' : 'one', monitor: 'second', operation: 'second', run: 'second', cycle: 'second' });
  h.store.monitors.publishRevision(second.definition, null, NOW);
  const e1 = await prepare(h.store, first);
  const e2 = await prepare(h.store, second);
  const gate = new SharedArrayBuffer(4);
  const worker1 = new Worker(new URL('./admission-worker.js', import.meta.url), { workerData: { path: h.path, evaluationId: e1.evaluation.opportunity.id, gate, hold: true } });
  const worker2 = new Worker(new URL('./admission-worker.js', import.meta.url), { workerData: { path: h.path, evaluationId: e2.evaluation.opportunity.id, gate, hold: false } });
  try {
    await Promise.all([message(worker1, 'READY'), message(worker2, 'READY')]);
    const held = message(worker1, 'HELD');
    const firstResult = message(worker1, 'RESULT');
    worker1.postMessage('ADMIT');
    await held;
    // Writer one holds real uncommitted reservations. Writer two must hit SQLite's bounded busy timeout.
    const contended = message(worker2, 'RESULT');
    worker2.postMessage('ADMIT');
    assert.deepEqual((await contended).result, { status: 'FAILED', code: 'STORAGE_BUSY' });
    assert.equal(h.store.outbox.getOutbox().length, 0, 'WAL reader cannot see uncommitted success');
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    const committed = (await firstResult).result;
    assert.equal(committed?.status, 'COMMITTED');
    const retry = h.store.execution.commitSimulatedDecision(e2);
    if (competition === 'budget') {
      assert.equal(retry.status, 'COMMITTED');
      assert.equal(retry.simulation.intentState, 'BLOCKED');
      assert.ok(retry.simulation.checks.some(c => c.code === 'SIMULATED_DAILY_SPEND' && c.status === 'FAIL'));
    } else {
      assert.equal(retry.status, 'DUPLICATE');
      assert.equal(retry.reason, 'PRODUCT_GUARD');
    }
    assert.equal(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailySpent, 210_000n);
    assert.equal(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailyAttempts, 1n);
  } finally {
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    await Promise.all([worker1.terminate(), worker2.terminate()]);
  }
});
