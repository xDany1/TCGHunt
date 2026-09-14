import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { PersistenceFailure } from '@ptcg/application';
import type { RestockInput } from '@ptcg/application';
import { harness, limits } from '../fixtures/durable.js';
import { amazonReading, restockFixture, R_NOW } from '../fixtures/restock.js';
import { providerMonitor } from '../fixtures/amazon-providers.js';

test('state, history, provenance and stable scope survive SQLite reopen', t => {
  const h = harness(t); const a = restockFixture(0, false); const b = restockFixture(1000);
  assert.equal(h.store.restock.record(a.input, a.policy, a.now).outcome, 'INITIALIZED'); h.store.close(); const s = h.open();
  assert.equal(s.restock.getState(a.scope)?.baseline?.availability, 'UNAVAILABLE'); const r = s.restock.record(b.input, b.policy, b.now); assert.equal(r.events[0]?.type, 'RESTOCK_DETECTED');
  s.close(); const reopened = h.open(); assert.deepEqual(reopened.restock.getEvents(a.scope), r.events); assert.equal(reopened.restock.getSamples(a.scope).length, 2);
  assert.equal(reopened.restock.getState(a.scope)?.baseline?.provenance.provider, 'AUTHORED');
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    assert.equal(db.prepare('PRAGMA quick_check').get()?.['quick_check'], 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('SELECT count(*) AS n FROM restock_scopes').get()?.['n'], 1);
    for (const table of ['purchase_intents', 'checkout_attempts', 'simulated_reservations', 'simulated_consumption']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0);
  } finally { db.close(); }
});
test('same observation replay after restart and expiry never duplicates transitions or refreshes state', t => {
  const h = harness(t); const a = restockFixture(0, false); const b = restockFixture(1000);
  h.store.restock.record(a.input, a.policy, a.now); const r = h.store.restock.record(b.input, b.policy, b.now);
  assert.equal(h.store.restock.record(b.input, b.policy, b.now).outcome, 'DUPLICATE'); h.store.close(); const s = h.open();
  assert.equal(s.restock.record(b.input, b.policy, R_NOW + 120000).outcome, 'DUPLICATE'); assert.equal(s.restock.getEvents(a.scope).length, 1); assert.deepEqual(s.restock.getState(a.scope), r.state);
  assert.equal(s.restock.record(a.input, a.policy, R_NOW + 120000).outcome, 'DUPLICATE'); assert.deepEqual(s.restock.getState(a.scope), r.state);
});
test('outbox replay after restart produces one local receipt', t => {
  const h = harness(t); const a = restockFixture(0, false); const b = restockFixture(1000);
  h.store.restock.record(a.input, a.policy, a.now); h.store.restock.record(b.input, b.policy, b.now);
  assert.deepEqual(h.store.restock.deliverPending(b.now), { delivered: 1, failed: 0 }); h.store.close(); const s = h.open();
  assert.deepEqual(s.restock.deliverPending(b.now), { delivered: 0, failed: 0 }); assert.equal(s.restock.getReceipts().length, 1);
});
for (const point of ['AFTER_HANDLER_EFFECT', 'AFTER_HANDLER_RECEIPT'] as const) test(`outbox fault ${point} safely retries once`, t => {
  let armed = false; const h = harness(t, { fault(p) { if (armed && p === point) { armed = false; throw new Error('synthetic failure'); } } });
  const a = restockFixture(0, false); const b = restockFixture(1000); h.store.restock.record(a.input, a.policy, a.now); h.store.restock.record(b.input, b.policy, b.now); armed = true;
  assert.equal(h.store.restock.deliverPending(b.now).failed, 1); assert.equal(h.store.restock.getReceipts().length, point === 'AFTER_HANDLER_EFFECT' ? 0 : 1);
  h.store.close(); const s = h.open(); assert.equal(s.restock.deliverPending(b.now + 1000).delivered, 1); assert.equal(s.restock.getReceipts().length, 1); assert.equal(s.restock.deliverPending(b.now + 1000).delivered, 0);
});
test('atomic state/event/outbox rollback and safe retry', t => {
  let armed = false; const h = harness(t, { fault(p) { if (armed && p === 'BEFORE_COMMIT') throw new Error('synthetic disk fault'); } });
  const a = restockFixture(0, false); const b = restockFixture(1000); h.store.restock.record(a.input, a.policy, a.now); armed = true;
  assert.throws(() => h.store.restock.record(b.input, b.policy, b.now), PersistenceFailure); assert.equal(h.store.restock.getEvents(a.scope).length, 0); assert.equal(h.store.restock.getSamples(a.scope).length, 1); assert.equal(h.store.restock.getState(a.scope)?.baseline?.availability, 'UNAVAILABLE');
  armed = false; assert.equal(h.store.restock.record(b.input, b.policy, b.now).events.length, 1);
});
test('conflicting replay ID cannot overwrite immutable event evidence', t => {
  const h = harness(t); const a = restockFixture(); h.store.restock.record(a.input, a.policy, a.now); const changed = restockFixture(0, false);
  assert.throws(() => h.store.restock.record(changed.input, changed.policy, changed.now), (e: unknown) => e instanceof PersistenceFailure && e.code === 'CONFLICT');
});
test('two connections serialize identical observation/event admission', t => {
  const h = harness(t); const second = h.open(); const a = restockFixture(0, false); const b = restockFixture(1000);
  h.store.restock.record(a.input, a.policy, a.now); assert.equal(second.restock.record(a.input, a.policy, a.now).outcome, 'DUPLICATE');
  h.store.restock.record(b.input, b.policy, b.now); assert.equal(second.restock.record(b.input, b.policy, b.now).outcome, 'DUPLICATE'); assert.equal(second.restock.getEvents(a.scope).length, 1);
});
test('repeated available/unavailable samples produce only real edges', t => {
  const h = harness(t);
  for (const [i, stock] of [false, false, true, true, true, false, false].entries()) { const f = restockFixture(i * 1000, stock); h.store.restock.record(f.input, f.policy, f.now); }
  assert.deepEqual(h.store.restock.getEvents(restockFixture().scope).map(e => e.type), ['RESTOCK_DETECTED', 'AVAILABILITY_LOST']);
});
test('provider switch preserves scope and business event meaning through restart', async t => {
  const h = harness(t); const a = await amazonReading('BUSINESS_API', 'unavailable'); h.store.restock.record(a.input, a.policy, a.now); h.store.close(); const s = h.open();
  const b = await amazonReading('BROWSER', 'unavailable', 1000); assert.equal(s.restock.record(b.input, b.policy, b.now).events.length, 0);
  const c = await amazonReading('BROWSER', 'retail', 2000); assert.equal(s.restock.record(c.input, c.policy, c.now).events[0]?.type, 'RESTOCK_DETECTED');
  assert.deepEqual(s.restock.getSamples(a.scope).map(x => x.provenance.provider), ['BUSINESS_API', 'BROWSER', 'BROWSER']);
});
test('full Business and Browser sequences have equivalent durable business transitions', async t => {
  const h = harness(t); const other = h.open(`${h.directory}/other.sqlite`); const histories = [];
  for (const [kind, store] of [['BUSINESS_API', h.store], ['BROWSER', other]] as const) {
    let scope;
    for (const [i, name] of ['unavailable', 'retail', 'retail', 'unavailable'].entries()) {
      const f = await amazonReading(kind, name as 'retail' | 'unavailable', i * 1000); scope = f.scope; store.restock.record(f.input, f.policy, f.now);
    }
    assert.ok(scope); histories.push(store.restock.getEvents(scope).map(e => ({ type: e.type, occurredAt: e.occurredAt, scope: e.scopeKey, mode: e.mode, revision: e.policyRevision })));
  }
  assert.deepEqual(histories[0], histories[1]);
});
test('restock remains distinct from existing durable opportunity BLOCKED decision', async t => {
  const h = harness(t); const before = await amazonReading('BROWSER', 'unavailable'); const after = await amazonReading('BROWSER', 'retail', 1000);
  h.store.restock.record(before.input, before.policy, before.now); assert.equal(h.store.restock.record(after.input, after.policy, after.now).events[0]?.type, 'RESTOCK_DETECTED');
  const f = await providerMonitor('BROWSER'); h.store.execution.configureLimits(limits(), null, after.now); h.store.monitors.publishRevision(f.definition, null, after.now);
  const result = await h.store.coordinator.run(after.service, { ...f.command, now: after.now }); assert.ok(result.status === 'COMMITTED');
  assert.equal(result.simulation.mode, 'DRY_RUN'); assert.equal(result.simulation.intentState, 'BLOCKED');
  const e = h.store.evidence.getEvaluation(result.simulation.scope.evaluationId); assert.equal(e.evaluation.seller.result, 'APPROVED'); assert.equal(e.evaluation.opportunity.status, 'INDETERMINATE'); assert.equal(e.evaluation.observation.shipping.state, 'UNKNOWN');
  assert.equal(h.store.restock.getEvents(after.scope).length, 1);
});
test('failures and malformed mode cannot synthesize executable intents', t => {
  const h = harness(t); const f = restockFixture();
  for (const status of ['OBSERVATION_FAILED', 'PARTIAL_COVERAGE', 'NO_OFFER_OBSERVED', 'UNKNOWN'] as const) h.store.restock.record({ ...f.input, id: status, status, coverage: 'UNKNOWN', observations: [] }, f.policy, f.now);
  assert.throws(() => h.store.restock.record({ ...f.input, mode: 'LIVE' } as unknown as RestockInput, f.policy, f.now), PersistenceFailure);
  const db = new DatabaseSync(h.path, { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) AS n FROM purchase_intents').get()?.['n'], 0); assert.equal(db.prepare('SELECT count(*) AS n FROM restock_events').get()?.['n'], 0); } finally { db.close(); }
});
test('unknown raw HTML/secrets fields never enter persisted projection or replay fingerprint', t => {
  const h = harness(t); const f = restockFixture(); const marker = 'RAW_HTML_COOKIE_CANARY';
  h.store.restock.record({ ...f.input, rawHtml: marker, cookies: marker } as RestockInput, f.policy, f.now);
  const db = new DatabaseSync(h.path, { readOnly: true }); try { assert.equal(JSON.stringify(db.prepare('SELECT * FROM restock_samples').all()).includes(marker), false); } finally { db.close(); }
});
test('recovery read-only database cannot record or deliver restock work', t => {
  const h = harness(t); const f = restockFixture(); h.store.restock.record(f.input, f.policy, f.now); const ro = h.open(h.path, { recoveryReadOnly: true });
  assert.throws(() => ro.restock.record(restockFixture(1000).input, f.policy, f.now + 1000), (e: unknown) => e instanceof PersistenceFailure && e.code === 'RECOVERY_READ_ONLY');
});
test('populated schema 3 migrates to 4 without modifying prior identities/ledger/evidence', async t => {
  const h = harness(t); const f = h.seed(); const r = await h.store.coordinator.run(f.adapter, f.command); assert.ok(r.status === 'COMMITTED'); const history = h.store.execution.getDecisionHistory(r.simulation.scope.intentId); h.store.close();
  const db = new DatabaseSync(h.path); let snapshots: Record<string, unknown[]>;
  try {
    db.exec('DROP TABLE restock_receipts; DROP TABLE restock_outbox; DROP TABLE restock_events; DROP TABLE restock_samples; DROP TABLE restock_scopes; PRAGMA user_version=3;');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r['name'])); snapshots = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { db.close(); }
  const migrated = h.open(); assert.equal(migrated.diagnostics().schemaVersion, 4); assert.deepEqual(migrated.execution.getDecisionHistory(r.simulation.scope.intentId), history);
  const check = new DatabaseSync(h.path, { readOnly: true }); try { for (const [table, rows] of Object.entries(snapshots)) assert.deepEqual(check.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), rows, table); } finally { check.close(); }
});
test('restock engine has no retailer actions, provider imports or network authority', () => {
  for (const file of ['packages/application/src/restock.ts', 'packages/infrastructure/src/restock.ts']) {
    const source = readFileSync(file, 'utf8'); assert.doesNotMatch(source, /\b(?:fetch|checkout|payment|placeOrder|addToCart|login)\s*\(|from ['"](?:.*amazon|.*browser|playwright|puppeteer|node:https|node:child_process)/i);
  }
});
test('incompatible outbox events are bounded and dead-lettered without a receipt', t => {
  const h = harness(t); const a = restockFixture(0, false); const b = restockFixture(1000); h.store.restock.record(a.input, a.policy, a.now); h.store.restock.record(b.input, b.policy, b.now);
  const db = new DatabaseSync(h.path); try { db.exec("UPDATE restock_events SET envelope=json_set(envelope,'$.schemaVersion',99)"); } finally { db.close(); }
  for (const offset of [0, 1000, 3000]) assert.equal(h.store.restock.deliverPending(b.now + offset).failed, 1);
  assert.equal(h.store.restock.deliverPending(b.now + 6000).failed, 0); assert.equal(h.store.restock.getReceipts().length, 0);
  const inspect = new DatabaseSync(h.path, { readOnly: true }); try { assert.equal(inspect.prepare('SELECT status FROM restock_outbox').get()?.['status'], 'DEAD_LETTER'); } finally { inspect.close(); }
});
