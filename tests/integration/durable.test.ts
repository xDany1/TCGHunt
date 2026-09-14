import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { evaluateSimulation, guardTransition, utcDay } from '@ptcg/application';
import { FakeStoreAdapter } from '@ptcg/adapters';
import { money } from '@ptcg/core';
import { durableFixture, harness, limits, OWNER } from '../fixtures/durable.js';
import { NOW, scenarioNames } from '../fixtures/scenarios.js';

test('SQLite v2 schema verifies WAL/FULL/foreign keys and distinct domain identities', async t => {
  const h = harness(t);
  assert.deepEqual(h.store.diagnostics(), { journalMode: 'wal', synchronous: 2, foreignKeys: true, schemaVersion: 4 });
  const f = h.seed();
  const r = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(r.status, 'COMMITTED');
  const db = new DatabaseSync(h.path, { enableForeignKeyConstraints: true });
  try {
    assert.throws(() => db.prepare('INSERT INTO variants VALUES(?,?,?,?)').run('bad', 'fake-mx', 'bad', 'missing'), /FOREIGN KEY/);
    assert.throws(() => db.prepare('INSERT INTO store_products SELECT * FROM store_products LIMIT 1').run(), /UNIQUE/);
    assert.throws(() => db.exec("UPDATE purchase_intents SET mode='LIVE'"), /immutable/);
    assert.throws(() => db.exec("UPDATE checkout_attempts SET state='READY',version=version+1"), /invalid attempt transition/);
    assert.throws(() => db.exec('UPDATE purchase_intents SET version=version+1'), /invalid intent transition/);
    assert.throws(() => db.exec('UPDATE checkout_attempts SET version=version-1'), /invalid attempt transition/);
    for (const name of ['canonical_products', 'store_products', 'variants', 'listings', 'offers', 'sellers', 'product_mappings']) {
      const count = db.prepare(`SELECT count(*) AS n FROM ${name}`).get();
      assert.ok(Number(count?.['n']) >= 1, name);
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row['name']);
    for (const absent of ['orders', 'sessions', 'accounts', 'subscriptions', 'licenses', 'devices']) assert.equal(tables.includes(absent), false);
  } finally { db.close(); }
});

test('full fake flow records reproducible evidence, scope, reservation, consumption, audit and outbox', async t => {
  const h = harness(t);
  const f = h.seed();
  const result = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.simulation.intentState, 'SIMULATED');
  const history = h.store.execution.getDecisionHistory(result.simulation.scope.intentId);
  assert.equal(history.intentVersion, 4);
  assert.equal(history.attemptVersion, 2);
  assert.deepEqual(history.reservation, { state: 'CONSUMED', upperBound: money(250_000n, 'MXN'), consumed: money(210_000n, 'MXN'), quantity: 2 });
  assert.equal(history.audit.length, 9);
  assert.equal(history.audit.at(-1)?.action, 'PURCHASE_WOULD_HAVE_EXECUTED');
  assert.ok(history.audit.every(a => a.mode === 'DRY_RUN' && a.traceId === f.command.traceId && a.monitorId === f.definition.monitorId));
  const evidence = h.store.evidence.getEvaluation(result.simulation.scope.evaluationId);
  assert.deepEqual(evidence.evaluation, await evaluateSimulation(f.adapter, evidence.request));
  assert.deepEqual(evidence.evaluation.observation, f.observation);
  assert.equal(h.store.outbox.getOutbox()[0]?.status, 'PENDING');
  assert.equal(h.store.monitors.getRun(f.command.runId).status, 'SUCCEEDED');
  assert.deepEqual(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW), { currency: 'MXN', dailySpent: 210_000n, dailyHeld: 0n, campaignQuantity: 2n, dailyAttempts: 1n });
});

for (const name of scenarioNames) test(`durable M1 fixture: ${name}`, async t => {
  const h = harness(t);
  const f = h.seed(durableFixture({ name }));
  const result = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(result.status, 'COMMITTED');
  const pass = ['correct-product-match', 'seller-approval', 'valid-simulated-opportunity'].includes(name);
  assert.equal(result.simulation.intentState, pass ? 'SIMULATED' : 'BLOCKED');
  assert.equal(h.store.execution.getDecisionHistory(result.simulation.scope.intentId).reservation !== null, pass);
  h.store.close();
  const reopened = h.open();
  assert.deepEqual(reopened.execution.getDecisionHistory(result.simulation.scope.intentId).simulation, result.simulation);
});

test('duplicate operation after restart returns its committed identity without reading the adapter', async t => {
  const h = harness(t);
  const f = h.seed();
  const first = await h.store.coordinator.run(f.adapter, f.command);
  assert.notEqual(first.status, 'FAILED');
  if (first.status === 'FAILED') return;
  h.store.close();
  const reopened = h.open();
  const duplicate = await reopened.coordinator.run(new FakeStoreAdapter([]), { ...f.command, now: NOW + 86_400_000, runId: 'another-delivery' });
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.deepEqual(duplicate.simulation, first.simulation);
  assert.equal(reopened.outbox.getOutbox().length, 1);
});

test('repeated observations and overlapping monitors reuse an owner/cycle commitment', async t => {
  const h = harness(t);
  const first = h.seed();
  const r1 = await h.store.coordinator.run(first.adapter, first.command);
  const second = durableFixture({ monitor: 'second', operation: 'operation-two', run: 'run-two', now: NOW + 1 });
  h.store.monitors.publishRevision(second.definition, null, NOW);
  const r2 = await h.store.coordinator.run(second.adapter, second.command);
  assert.equal(r1.status, 'COMMITTED');
  assert.equal(r2.status, 'DUPLICATE');
  assert.equal(r2.reason, 'CYCLE');
  assert.equal(r1.simulation.scope.intentId, r2.simulation.scope.intentId);
  assert.equal(h.store.outbox.getOutbox().length, 1);
  assert.equal(h.store.monitors.getRun(second.command.runId).status, 'SUCCEEDED');
});

test('product guard spans different cycles and monitor revisions', async t => {
  const h = harness(t);
  const f = h.seed(undefined, limits({ dailySpend: money(1_000_000n, 'MXN'), dailyAttempts: 10, productCampaignQuantity: 10 }));
  const first = await h.store.coordinator.run(f.adapter, f.command);
  const next = durableFixture({ monitor: 'next-monitor', cycle: 'next-cycle', campaign: 'new-campaign', operation: 'next-operation', run: 'next-run' });
  h.store.monitors.publishRevision(next.definition, null, NOW);
  const second = await h.store.coordinator.run(next.adapter, next.command);
  assert.equal(second.status, 'DUPLICATE');
  if (first.status === 'FAILED') return;
  assert.equal(second.reason, 'PRODUCT_GUARD');
  assert.equal(second.simulation.scope.intentId, first.simulation.scope.intentId);
});

for (const limiting of ['DAILY_SPEND', 'PRODUCT_QUANTITY', 'DAILY_ATTEMPTS'] as const) test(`durable ${limiting} rejects another cycle after cooldown`, async t => {
  const h = harness(t);
  const p = limits({ dailySpend: money(limiting === 'DAILY_SPEND' ? 459_999n : 1_000_000n, 'MXN'), dailyAttempts: limiting === 'DAILY_ATTEMPTS' ? 1 : 10, productCampaignQuantity: limiting === 'PRODUCT_QUANTITY' ? 2 : 10, cooldownMs: 1 });
  const f = h.seed(undefined, p);
  await h.store.coordinator.run(f.adapter, f.command);
  const n = durableFixture({ monitor: 'next', cycle: 'next', operation: 'next', run: 'next', now: NOW + 2 });
  h.store.monitors.publishRevision(n.definition, null, NOW);
  const result = await h.store.coordinator.run(n.adapter, n.command);
  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.simulation.intentState, 'BLOCKED');
  assert.ok(result.simulation.checks.some(c => c.code === `SIMULATED_${limiting}` && c.status === 'FAIL'));
  assert.equal(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailySpent, 210_000n);
});

test('deliberate later cycle can consume verified surplus when every limit permits it', async t => {
  const h = harness(t);
  const f = h.seed(undefined, limits({ dailySpend: money(460_000n, 'MXN'), dailyAttempts: 2, productCampaignQuantity: 4, cooldownMs: 1 }));
  await h.store.coordinator.run(f.adapter, f.command);
  const n = durableFixture({ monitor: 'next', cycle: 'next', operation: 'next', run: 'next', now: NOW + 2 });
  h.store.monitors.publishRevision(n.definition, null, NOW);
  const result = await h.store.coordinator.run(n.adapter, n.command);
  assert.notEqual(result.status, 'FAILED');
  if (result.status === 'FAILED') return;
  assert.equal(result.simulation.intentState, 'SIMULATED');
  assert.equal(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailySpent, 420_000n);
});

test('monitor definitions preserve revisions, pause/archive states and optimistic versions', t => {
  const h = harness(t);
  const f = h.seed();
  assert.throws(() => h.store.monitors.changeStatus(f.definition.monitorId, 'PAUSED', 0, NOW), { code: 'STALE_VERSION' });
  assert.equal(h.store.monitors.changeStatus(f.definition.monitorId, 'PAUSED', 1, NOW).version, 2);
  assert.throws(() => h.store.monitors.startRun(f.command), { code: 'CONFLICT' });
  const revision = h.store.monitors.publishRevision({ ...f.definition, cycleId: 'changed' }, 2, NOW);
  assert.equal(revision.revision, 2);
  assert.equal(revision.status, 'PAUSED');
  h.store.monitors.changeStatus(f.definition.monitorId, 'ACTIVE', 3, NOW);
  assert.throws(() => h.store.monitors.startRun(f.command), { code: 'STALE_VERSION' });
  h.store.monitors.changeStatus(f.definition.monitorId, 'ARCHIVED', 4, NOW);
  assert.throws(() => h.store.monitors.changeStatus(f.definition.monitorId, 'ACTIVE', 5, NOW), { code: 'INVALID_TRANSITION' });
  h.store.close();
  assert.equal(h.open().monitors.getMonitor(f.definition.monitorId).status, 'ARCHIVED');
});

test('a revision or pause change during adapter read retains evidence but cannot authorize admission', async t => {
  for (const change of ['revision', 'pause'] as const) {
    const h = harness(t);
    const f = h.seed();
    const adapter = {
      descriptor: f.adapter.descriptor, observe: async () => {
        if (change === 'revision') h.store.monitors.publishRevision({ ...f.definition, cycleId: 'changed' }, 1, NOW);
        else h.store.monitors.changeStatus(f.definition.monitorId, 'PAUSED', 1, NOW);
        return { ok: true as const, observation: f.observation };
      }
    };
    const result = await h.store.coordinator.run(adapter, f.command);
    assert.deepEqual(result, { status: 'FAILED', code: 'STALE_VERSION', externalEffect: 'NOT_SENT' });
    assert.equal(h.store.monitors.getRun(f.command.runId).status, 'SUCCEEDED');
    assert.equal(h.store.outbox.getOutbox().length, 0);
  }
});

test('same immutable observation ID cannot silently acquire new price or evidence', async t => {
  const h = harness(t);
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  const observation = { ...f.observation, shipping: { ...f.observation.shipping, state: 'KNOWN' as const, value: money(0n, 'MXN') } };
  const result = await h.store.coordinator.run(new FakeStoreAdapter([observation]), { ...f.command, operationId: 'new-operation', runId: 'new-run' });
  assert.deepEqual(result, { status: 'FAILED', code: 'CONFLICT', externalEffect: 'NOT_SENT' });
});

test('limit policy updates retain consumption and reject currency/timezone resets', async t => {
  const h = harness(t);
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  h.store.execution.configureLimits(limits({ version: 2, dailySpend: money(1n, 'MXN') }), 1, NOW);
  assert.equal(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', NOW).dailySpent, 210_000n);
  assert.throws(() => h.store.execution.configureLimits(limits({ version: 3, dailySpend: money(100n, 'USD') }), 2, NOW), { code: 'CONFLICT' });
  assert.throws(() => h.store.execution.configureLimits(limits({ version: 3 }), 1, NOW), { code: 'STALE_VERSION' });
});

test('durable execution and outbox have zero network effects and reject non-DRY_RUN input', async t => {
  const calls: string[] = [];
  const deny = (name: string) => () => { calls.push(name); throw new Error('Network forbidden'); };
  t.mock.method(globalThis, 'fetch', deny('fetch'));
  t.mock.method(http, 'request', deny('http'));
  t.mock.method(https, 'request', deny('https'));
  t.mock.method(net.Socket.prototype, 'connect', deny('socket'));
  const h = harness(t);
  const f = h.seed();
  assert.throws(() => Reflect.apply(h.store.monitors.publishRevision.bind(h.store.monitors), undefined, [{ ...f.definition, configuration: { ...f.definition.configuration, mode: 'LIVE' } }, 1, NOW]), { code: 'INVALID_INPUT' });
  assert.equal((await h.store.coordinator.run(f.adapter, f.command)).status, 'COMMITTED');
  assert.equal(h.store.outbox.deliverPendingNotifications(NOW).delivered, 1);
  assert.deepEqual(calls, []);
});

test('reusing an operation or cycle for a different durable subject is a conflict', async t => {
  const h = harness(t);
  const f = h.seed();
  await h.store.coordinator.run(f.adapter, f.command);
  const other = durableFixture({ product: 'two', monitor: 'other', run: 'other' });
  h.store.monitors.publishRevision(other.definition, null, NOW);
  assert.deepEqual(await h.store.coordinator.run(other.adapter, other.command), { status: 'FAILED', code: 'CONFLICT', externalEffect: 'NOT_SENT' });
  assert.deepEqual(await h.store.coordinator.run(other.adapter, { ...other.command, operationId: 'different-operation' }), { status: 'FAILED', code: 'CONFLICT', externalEffect: 'NOT_SENT' });
  assert.equal(h.store.outbox.getOutbox().length, 1);
});

test('persisted attempt state rejects stale commands after reopen and retains its audit', async t => {
  const h = harness(t);
  const f = h.seed();
  const r = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(r.status, 'COMMITTED');
  h.store.close();
  const reopened = h.open();
  const history = reopened.execution.getDecisionHistory(r.simulation.scope.intentId);
  assert.throws(() => guardTransition('CheckoutAttempt', { state: history.simulation.attemptState ?? '', version: history.attemptVersion ?? -1 }, { state: 'READY', version: 1 }, 'SIMULATED'), { code: 'STALE_VERSION' });
  assert.deepEqual(reopened.execution.getDecisionHistory(r.simulation.scope.intentId), history);
});

test('UTC rollover resets daily buckets while campaign quantity persists; clock rollback blocks new products', async t => {
  const h = harness(t);
  const f = h.seed(undefined, limits({ productCampaignQuantity: 10, cooldownMs: 1 }));
  await h.store.coordinator.run(f.adapter, f.command);
  const next = durableFixture({ monitor: 'next', cycle: 'next', operation: 'next', run: 'next', now: utcDay(NOW).end });
  h.store.monitors.publishRevision(next.definition, null, next.command.now);
  const r = await h.store.coordinator.run(next.adapter, next.command);
  assert.equal(r.status, 'COMMITTED');
  assert.equal(r.simulation.intentState, 'SIMULATED');
  assert.deepEqual(h.store.execution.getUsage(OWNER, 'campaign-one', 'one', next.command.now), { currency: 'MXN', dailySpent: 210_000n, dailyHeld: 0n, campaignQuantity: 4n, dailyAttempts: 1n });
  const rollback = durableFixture({ product: 'two', monitor: 'rollback', cycle: 'rollback', operation: 'rollback', run: 'rollback' });
  h.store.monitors.publishRevision(rollback.definition, null, NOW);
  const blocked = await h.store.coordinator.run(rollback.adapter, rollback.command);
  assert.equal(blocked.status, 'COMMITTED');
  assert.equal(blocked.simulation.intentState, 'BLOCKED');
  assert.ok(blocked.simulation.checks.some(c => c.code === 'SIMULATED_CLOCK_MONOTONIC' && c.status === 'FAIL'));
});

test('unknown arithmetic ratios and bigint money survive snapshot encoding exactly', async t => {
  const h = harness(t);
  const f = durableFixture();
  const scenario = f.definition.configuration.scenario;
  const zeroResale = { ...scenario.benchmark.grossResale, state: 'KNOWN' as const, value: money(0n, 'MXN') };
  const definition = { ...f.definition, configuration: { ...f.definition.configuration, scenario: { ...scenario, benchmark: { ...scenario.benchmark, grossResale: zeroResale } } } };
  h.seed({ ...f, definition });
  const result = await h.store.coordinator.run(f.adapter, f.command);
  assert.equal(result.status, 'COMMITTED');
  const evidence = h.store.evidence.getEvaluation(result.simulation.scope.evaluationId);
  assert.deepEqual(evidence.evaluation, await evaluateSimulation(f.adapter, evidence.request));
  assert.equal(evidence.evaluation.opportunity.status, 'COMPLETE');
  assert.equal(evidence.evaluation.opportunity.margin, undefined);
});
