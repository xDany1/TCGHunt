import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { openDurableStore } from '@ptcg/infrastructure';
import type { FaultPoint } from '@ptcg/infrastructure';
import { durableFixture, harness, OWNER } from '../fixtures/durable.js';
import { prepare } from '../fixtures/prepared.js';
import { NOW } from '../fixtures/scenarios.js';

const criticalTables = ['purchase_intents', 'checkout_attempts', 'simulated_reservations', 'simulated_reservation_lines', 'simulated_consumption', 'simulated_limit_buckets', 'simulated_product_guards', 'simulated_operations', 'audit_events', 'event_outbox'];
function assertNoCriticalFragments(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    for (const table of criticalTables) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0, table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM decision_evaluations').get()?.['n'], 1, 'Independent completed evidence remains available');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
}

for (const point of ['AFTER_INTENT', 'AFTER_RESERVATION', 'BEFORE_AUDIT', 'BEFORE_COMMIT'] as const) test(`critical rollback at ${point} leaves no partial success and retry is safe`, async t => {
  let enabled = true;
  const h = harness(t, { fault: current => { if (enabled && current === point) throw new Error('Injected failure: SECRET_CANARY'); } });
  const f = h.seed();
  const result = await h.store.coordinator.run(f.adapter, f.command);
  assert.deepEqual(result, { status: 'FAILED', code: 'STORAGE_FAILURE', externalEffect: 'NOT_SENT' });
  assert.equal(JSON.stringify(result).includes('SECRET_CANARY'), false);
  assertNoCriticalFragments(h.path);
  enabled = false;
  const retry = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(retry.status, 'COMMITTED');
  assert.equal(h.store.outbox.getOutbox().length, 1);
});

test('actual SQLite audit INSERT failure rolls back intent, reservation and transitions', async t => {
  const h = harness(t);
  const f = h.seed();
  const db = new DatabaseSync(h.path);
  try {
    db.exec("CREATE TRIGGER fail_final_audit BEFORE INSERT ON audit_events WHEN NEW.action='PURCHASE_WOULD_HAVE_EXECUTED' BEGIN SELECT RAISE(ABORT,'injected unavailable audit'); END;");
    assert.deepEqual(await h.store.coordinator.run(f.adapter, f.command), { status: 'FAILED', code: 'STORAGE_FAILURE', externalEffect: 'NOT_SENT' });
    assertNoCriticalFragments(h.path);
    db.exec('DROP TRIGGER fail_final_audit');
    assert.equal((await h.store.coordinator.run(f.adapter, f.command)).status, 'COMMITTED');
  } finally { db.close(); }
});

for (const point of ['AFTER_RESERVATION', 'BEFORE_COMMIT'] as const) test(`process exit at ${point} recovers an entirely uncommitted critical transaction`, async t => {
  const h = harness(t);
  const f = h.seed();
  const evidence = await prepare(h.store, f);
  h.store.close();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./process-child.js', import.meta.url)), h.path, evidence.evaluation.opportunity.id, point], { timeout: 15_000, windowsHide: true });
  assert.equal(child.status, 91, child.stderr.toString());
  assertNoCriticalFragments(h.path);
  const reopened = h.open();
  assert.equal(reopened.execution.commitSimulatedDecision(reopened.evidence.getEvaluation(evidence.evaluation.opportunity.id)).status, 'COMMITTED');
});

test('process loss after commit preserves pending outbox, monitor, attempts, ledger and history', async t => {
  const h = harness(t);
  const f = h.seed();
  const evidence = await prepare(h.store, f);
  h.store.close();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./process-child.js', import.meta.url)), h.path, evidence.evaluation.opportunity.id, 'AFTER_COMMIT'], { timeout: 15_000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr.toString());
  const reopened = h.open();
  const duplicate = await reopened.coordinator.run(f.adapter, f.command);
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(reopened.outbox.getOutbox()[0]?.status, 'PENDING');
  assert.equal(reopened.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailySpent, 210_000n);
  assert.deepEqual(reopened.coordinator.recover(NOW), { interruptedRuns: 0, delivered: 1, failed: 0 });
  assert.equal(reopened.outbox.getNotifications().length, 1);
});

for (const point of ['AFTER_HANDLER_EFFECT', 'AFTER_HANDLER_RECEIPT'] as const) test(`outbox retry after ${point} produces one local effect and durable receipt`, async t => {
  let fault: FaultPoint | null = point;
  const h = harness(t, { fault: current => { if (fault === current) throw new Error('Injected handler failure'); } });
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  assert.deepEqual(h.store.outbox.deliverPendingNotifications(NOW), { delivered: 0, failed: 1 });
  assert.equal(h.store.outbox.getOutbox()[0]?.status, 'PENDING');
  assert.equal(h.store.outbox.getNotifications().length, point === 'AFTER_HANDLER_EFFECT' ? 0 : 1);
  fault = null;
  h.store.close();
  const reopened = h.open();
  assert.equal(reopened.outbox.deliverPendingNotifications(NOW + 1_000).delivered, 1);
  assert.equal(reopened.outbox.getNotifications().length, 1);
  const db = new DatabaseSync(h.path);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM handler_receipts').get()?.['n'], 1);
    db.exec("UPDATE event_outbox SET status='PENDING'");
    assert.equal(reopened.outbox.deliverPendingNotifications(NOW + 2_000).delivered, 1);
    assert.equal(reopened.outbox.getNotifications().length, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM handler_receipts').get()?.['n'], 1);
    assert.throws(() => db.exec('INSERT INTO handler_receipts SELECT * FROM handler_receipts'), /UNIQUE/);
  } finally { db.close(); }
});

test('hard process exit after handler receipt commits before acknowledgement safely replays', async t => {
  const h = harness(t);
  const f = h.seed();
  const r = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(r.status, 'COMMITTED');
  h.store.close();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./process-child.js', import.meta.url)), h.path, r.simulation.scope.evaluationId, 'AFTER_HANDLER_RECEIPT'], { timeout: 15_000, windowsHide: true });
  assert.equal(child.status, 91, child.stderr.toString());
  const reopened = h.open();
  assert.equal(reopened.outbox.getOutbox()[0]?.status, 'PENDING');
  assert.equal(reopened.outbox.getNotifications().length, 1);
  assert.equal(reopened.outbox.deliverPendingNotifications(NOW).delivered, 1);
  assert.equal(reopened.outbox.getNotifications().length, 1);
});

test('poison outbox retries are bounded and incompatible schema is retained for inspection', async t => {
  const h = harness(t, { fault: point => { if (point === 'AFTER_HANDLER_EFFECT') throw new Error('Persistent failure'); } });
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  for (const offset of [0, 1_000, 3_000]) assert.equal(h.store.outbox.deliverPendingNotifications(NOW + offset).failed, 1);
  assert.equal(h.store.outbox.getOutbox()[0]?.status, 'DEAD_LETTER');
  assert.equal(h.store.outbox.getOutbox()[0]?.attempts, 3);
  assert.equal(h.store.outbox.getNotifications().length, 0);
  const db = new DatabaseSync(h.path);
  try { db.exec("UPDATE event_outbox SET schema_version=99,status='PENDING',attempts=0,next_attempt_at=0"); } finally { db.close(); }
  const reopened = h.open();
  assert.equal(reopened.outbox.deliverPendingNotifications(NOW).failed, 1);
  assert.equal(reopened.outbox.getOutbox()[0]?.lastError, 'INCOMPATIBLE_EVENT');
  assert.equal(reopened.outbox.getOutbox()[0]?.status, 'DEAD_LETTER');
});

test('interrupted read run recovers as failed with an audit reason, never auto-replays an adapter', t => {
  const h = harness(t);
  const f = h.seed();
  h.store.monitors.startRun(f.command);
  h.store.close();
  const reopened = h.open();
  assert.equal(reopened.coordinator.recover(NOW + 1).interruptedRuns, 1);
  assert.equal(reopened.monitors.getRun(f.command.runId).reason, 'RESTART_INTERRUPTED');
  assert.equal(reopened.coordinator.recover(NOW + 2).interruptedRuns, 0);
  assert.equal(reopened.outbox.getOutbox().length, 0);
});

test('consistent backup of open WAL database reopens read-only with complete history and no runnable authority', async t => {
  const h = harness(t);
  const f = h.seed();
  const result = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(result.status, 'COMMITTED');
  const backupPath = join(h.directory, 'snapshot.sqlite');
  await h.store.backupTo(backupPath);
  const recovery = h.open(backupPath, { recoveryReadOnly: true });
  assert.deepEqual(recovery.execution.getDecisionHistory(result.simulation.scope.intentId), h.store.execution.getDecisionHistory(result.simulation.scope.intentId));
  assert.deepEqual(recovery.evidence.getEvaluation(result.simulation.scope.evaluationId), h.store.evidence.getEvaluation(result.simulation.scope.evaluationId));
  assert.equal(recovery.outbox.getOutbox()[0]?.status, 'PENDING');
  assert.throws(() => recovery.coordinator.recover(NOW), { code: 'RECOVERY_READ_ONLY' });
  assert.throws(() => recovery.outbox.deliverPendingNotifications(NOW), { code: 'RECOVERY_READ_ONLY' });
  assert.deepEqual(await recovery.coordinator.run(f.adapter, { ...f.command, operationId: 'fresh', runId: 'fresh' }), { status: 'FAILED', code: 'RECOVERY_READ_ONLY', externalEffect: 'NOT_SENT' });
  const defaultReopen = h.open(backupPath);
  assert.throws(() => defaultReopen.coordinator.recover(NOW), { code: 'RECOVERY_READ_ONLY' });
  assert.equal(h.store.outbox.deliverPendingNotifications(NOW).delivered, 1, 'Successful backup releases source write pause');
});

test('corrupt or newer schema is rejected without reset or overwrite', t => {
  const h = harness(t);
  const path = join(h.directory, 'corrupt.sqlite');
  writeFileSync(path, 'definitely not a SQLite database');
  const original = readFileSync(path);
  assert.throws(() => openDurableStore(path), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(readFileSync(path), original);
  const future = join(h.directory, 'future.sqlite');
  const db = new DatabaseSync(future);
  db.exec('PRAGMA user_version=999');
  db.close();
  assert.throws(() => openDurableStore(future), { code: 'SCHEMA_UNSUPPORTED' });
});

test('closed database surfaces a typed failure and no committed simulation', async t => {
  const h = harness(t);
  const f = h.seed(durableFixture());
  h.store.close();
  assert.deepEqual(await h.store.coordinator.run(f.adapter, f.command), { status: 'FAILED', code: 'STORAGE_FAILURE', externalEffect: 'NOT_SENT' });
});

test('missing critical audit on reopen is an integrity failure, never an empty-ledger reset', async t => {
  const h = harness(t);
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  h.store.close();
  const db = new DatabaseSync(h.path);
  try {
    db.exec("DELETE FROM audit_events WHERE action='PURCHASE_WOULD_HAVE_EXECUTED'");
    assert.throws(() => openDurableStore(h.path), { code: 'STORAGE_FAILURE' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM purchase_intents').get()?.['n'], 1);
    assert.equal(db.prepare('SELECT sum(consumed) AS total FROM simulated_limit_buckets WHERE kind=\'DAILY_SPEND\'').get()?.['total'], 210_000);
  } finally { db.close(); }
});

test('backup failure leaves the source in durable recovery mode instead of silently restoring write authority', async t => {
  const h = harness(t);
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  await assert.rejects(() => h.store.backupTo(join(h.directory, 'missing-directory', 'snapshot.sqlite')), { code: 'STORAGE_FAILURE' });
  assert.throws(() => h.store.outbox.deliverPendingNotifications(NOW), { code: 'RECOVERY_READ_ONLY' });
  h.store.close();
  assert.throws(() => h.open().coordinator.recover(NOW), { code: 'RECOVERY_READ_ONLY' });
});
