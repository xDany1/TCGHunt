import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DesktopService } from '@ptcg/desktop/service';
import { approvedSource } from '@ptcg/desktop/policy';
import { observationView } from '@ptcg/desktop/queries';
import { normalizeKantocardsCapture } from '@ptcg/adapters';
import type { AuthorizedEvidence } from '@ptcg/adapters';
import { IpcGuard, APP_URL, WEB_PREFERENCES, CSP } from '@ptcg/desktop/security';
import { validateCommand, COMMANDS, decisionLabel } from '@ptcg/contracts';
import type { Command } from '@ptcg/contracts';
import { authoredCapture, primary, secondary, START, DELIVERY } from '../fixtures/kantocards.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Observation, atDisplayTime } from '@ptcg/desktop/presentation';
import { harness as durableHarness } from '../fixtures/durable.js';
import { workspaceView } from '@ptcg/desktop/queries';

function capture(url: string, at: number): AuthorizedEvidence {
  const source = approvedSource(url); const fixture = authoredCapture(source.canonical.includes('astral-radiance'), at);
  const body = JSON.parse(fixture.body) as { data: { product: { id: string; title: string; variants: { nodes: { id: string; }[]; }; }; }; };
  body.data.product.id = `gid://shopify/Product/${source.product}`; body.data.product.title = '<img src=x onerror="alert(1)"> AUTHORED';
  const variant = body.data.product.variants.nodes[0]; assert.ok(variant); variant.id = `gid://shopify/ProductVariant/${source.variant}`;
  const serialized = JSON.stringify(body);
  return normalizeKantocardsCapture(serialized, { ...fixture.metadata, bytes: Buffer.byteLength(serialized) }, source.canonical, DELIVERY);
}
function harness(live = false) {
  mkdirSync('work/m4-tests', { recursive: true }); const databasePath = join(mkdtempSync('work/m4-tests/case-'), 'astra.sqlite');
  let now = START; let sequence = 0; let reads = 0;
  let reader = async (url: string) => { reads++; const result = capture(url, now); now += 222; return result; };
  const options = { databasePath, now: () => now, newId: () => String(++sequence), read: (url: string) => reader(url), networkEnabled: live, fixtureMode: !live };
  const service = new DesktopService(options); service.start();
  return { service, options, databasePath, advance: (ms: number) => { now += ms; }, reads: () => reads, reader: (r: typeof reader) => { reader = r; } };
}
async function create(service: DesktopService, url = primary) {
  const result = await service.dispatch('createMonitor', { name: 'Observation', url, cadenceSeconds: 60 }); assert.ok('id' in result); return result.id;
}
async function enable(service: DesktopService) {
  const s = service.snapshot().settings; await service.dispatch('updateSafeSettings', { expectedVersion: s.version, refreshSeconds: 5, storeEnabled: true });
}
const sender = { trustedContents: true, topFrame: true, frameUrl: APP_URL };

test('M4 bridge has only named query and safe monitor operations', () => {
  assert.equal(COMMANDS.length, 11);
  for (const forbidden of ['execute', 'checkout', 'cart', 'order', 'sql', 'fetch', 'readFile', 'invoke']) assert.throws(() => validateCommand(forbidden, null), { code: 'UNKNOWN_COMMAND' });
  assert.equal(validateCommand('getWorkspace', null), null);
});
test('M4 IPC rejects wrong sender, subframe and external navigation', () => {
  for (const identity of [{ ...sender, trustedContents: false }, { ...sender, topFrame: false }, { ...sender, frameUrl: 'https://kantocards.com' }, { ...sender, frameUrl: null }]) assert.throws(() => new IpcGuard().validate('getWorkspace', null, identity, START), { code: 'UNTRUSTED_SENDER' });
});
test('M4 IPC rejects unknown channels, malformed and oversized DTOs', () => {
  const guard = new IpcGuard(); assert.throws(() => guard.validate('rawSql' as Command, {}, sender, START), { code: 'UNKNOWN_COMMAND' });
  for (const value of [null, {}, [], { name: 'x', url: primary, cadenceSeconds: 1 }, { name: 'x', url: primary, cadenceSeconds: 60, sql: 'drop' }, { name: 'x', url: primary, cadenceSeconds: NaN }]) assert.throws(() => validateCommand('createMonitor', value));
  assert.throws(() => validateCommand('createMonitor', { name: 'x'.repeat(9000) }), { code: 'PAYLOAD_TOO_LARGE' });
  assert.throws(() => validateCommand('getWorkspace', undefined), { code: 'INVALID_PAYLOAD' });
  assert.throws(() => validateCommand('updateSafeSettings', { expectedVersion: 1, refreshSeconds: 10, storeEnabled: true, live: true }));
});
test('M4 IPC copies payloads and bounds command rate', () => {
  const input = { id: 'a', expectedVersion: 1 }; const copy = validateCommand('pauseMonitor', input); input.id = 'b'; assert.equal(copy.id, 'a'); assert.ok(Object.isFrozen(copy));
  const guard = new IpcGuard(); for (let i = 0; i < 120; i++) guard.validate('getWorkspace', null, sender, START);
  assert.throws(() => guard.validate('getWorkspace', null, sender, START), { code: 'RATE_LIMITED' });
  assert.equal(guard.validate('getWorkspace', null, sender, START + 60000), null);
});
test('M4 external policy accepts normalized targets and rejects arbitrary URLs', () => {
  assert.equal(approvedSource(primary + '?_pos=1&_fid=foo&_ss=c').canonical, approvedSource(primary).canonical);
  assert.notEqual(approvedSource(primary).variant, approvedSource(secondary).variant);
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows', 'https://evil.test/products/x', primary + '?variant=1', 'http://kantocards.com/products/x', 'https://kantocards.com/cart', 'https://kantocards.com@evil.test/products/x']) assert.throws(() => approvedSource(url));
});
test('M4 read models preserve unknowns, exact money, stale status and hostile text', () => {
  const evidence = capture(primary, START); const view = observationView(evidence, START + 222);
  assert.equal(view.price.value, '12.34 MXN'); assert.equal(view.shipping.state, 'UNKNOWN'); assert.equal(view.shipping.value, null); assert.equal(view.tax.value, null);
  assert.equal(view.stock.state, 'UNKNOWN'); assert.equal(view.quantity.value, null); assert.equal(view.saleAvailable, true); assert.match(view.title, /<img/); assert.equal(view.stale, false);
  assert.equal(observationView(evidence, START + 60001).stale, true);
  assert.equal(decisionLabel('SIMULATED'), 'Would Have Executed'); assert.equal(decisionLabel('BLOCKED'), 'Simulation Blocked'); assert.equal(decisionLabel('anything'), 'Not Admitted');
});
test('M4 secure Electron configuration and renderer dependency boundaries', () => {
  assert.equal(WEB_PREFERENCES.nodeIntegration, false); assert.equal(WEB_PREFERENCES.contextIsolation, true); assert.equal(WEB_PREFERENCES.sandbox, true); assert.equal(WEB_PREFERENCES.devTools, false); assert.equal(WEB_PREFERENCES.webviewTag, false);
  assert.match(CSP, /connect-src 'none'/); assert.doesNotMatch(CSP, /unsafe-/);
  for (const file of ['app.tsx', 'components.tsx', 'evidence.tsx', 'monitors.tsx', 'index.tsx']) assert.doesNotMatch(readFileSync(`apps/desktop/src/renderer/${file}`, 'utf8'), /dangerouslySetInnerHTML|node:|@ptcg\/(core|application|adapters|infrastructure)|ipcRenderer|eval\(/);
  assert.doesNotMatch(readFileSync('apps/desktop/src/host/preload.ts', 'utf8'), /readFile|execute|shell|webContents/);
});
test('M4 fresh workspace has truthful empty state, disabled reads and schema 4', async () => {
  const h = harness(); try { const s = h.service.snapshot(); assert.equal(s.reason, 'STORE_DISABLED'); assert.equal(s.stores[0]?.observationHealth, 'UNAVAILABLE'); assert.equal(s.dashboard.productsObservedToday, 0); assert.equal(s.diagnostics.schemaVersion, 4); assert.equal(s.monitors.length, 0); await h.service.tick(); assert.equal(h.reads(), 0); } finally { await h.service.stop(); }
});
test('M4 validated IPC monitor commands and read queries survive restart', async () => {
  const h = harness(); const guard = new IpcGuard();
  const input = guard.validate('createMonitor', { name: 'Saved monitor', url: primary + '?_pos=2', cadenceSeconds: 300 }, sender, START);
  const result = await h.service.dispatch('createMonitor', input); assert.ok('id' in result);
  const monitor = h.service.snapshot().monitors[0]; assert.ok(monitor); assert.doesNotMatch(monitor.url, /_pos/);
  await h.service.dispatch('pauseMonitor', { id: result.id, expectedVersion: monitor.version });
  await h.service.stop(); const reopened = new DesktopService(h.options); reopened.start();
  try { assert.equal(reopened.snapshot().monitors[0]?.status, 'PAUSED'); const version = reopened.snapshot().monitors[0]?.version; await reopened.dispatch('resumeMonitor', { id: result.id, expectedVersion: version }); await reopened.dispatch('updateMonitor', { id: result.id, expectedVersion: Number(version) + 1, name: 'Edited', url: secondary, cadenceSeconds: 120 }); assert.equal(reopened.snapshot().monitors[0]?.name, 'Edited'); await assert.rejects(reopened.dispatch('pauseMonitor', { id: result.id, expectedVersion: 1 }), { code: 'STALE_VERSION' }); } finally { await reopened.stop(); }
});
test('M4 observation → seller → opportunity → blocked DRY_RUN → audit/outbox uses existing path', async () => {
  const h = harness(); try {
    const id = await create(h.service); await enable(h.service); await h.service.dispatch('runMonitorNow', { id });
    const s = h.service.snapshot(); assert.equal(s.products.length, 1); assert.equal(s.evaluations.length, 1);
    assert.equal(s.evaluations[0]?.sellerStatus, 'APPROVED'); assert.equal(s.evaluations[0]?.outcome, 'INELIGIBLE'); assert.equal(s.evaluations[0]?.decision, 'BLOCKED'); assert.equal(s.evaluations[0]?.mapping, 'UNREVIEWED'); assert.equal(s.evaluations[0]?.roi, null);
    assert.equal(s.history.length, 4); assert.equal(s.diagnostics.pendingOutbox, 0); assert.equal(s.dashboard.simulationsBlockedToday, 1);
    h.advance(5000); await h.service.run(id, true); const repeat = h.service.snapshot(); assert.equal(repeat.products.length, 1); assert.equal(repeat.evaluations.length, 2); assert.equal(repeat.history.length, 4);
    assert.notEqual(repeat.evaluations[0]?.id, repeat.evaluations[0]?.decisionEvaluationId);
    const offer = s.products[0]?.offerId; assert.ok(offer); const history = await h.service.dispatch('getProductHistory', { offerId: offer }); assert.ok(Array.isArray(history)); assert.equal(history.length, 2);
  } finally { await h.service.stop(); }
});
test('M4 two targets preserve one store/seller and distinct stable identities', async () => {
  const h = harness(); try { const first = await create(h.service); const second = await create(h.service, secondary); await enable(h.service); await h.service.run(first, true); h.advance(5000); await h.service.run(second, true); const products = h.service.snapshot().products; assert.equal(products.length, 2); assert.equal(new Set(products.map(p => p.storeId)).size, 1); assert.equal(new Set(products.map(p => p.sellerId)).size, 1); for (const field of ['productId', 'variantId', 'listingId', 'offerId'] as const) assert.equal(new Set(products.map(p => p[field])).size, 2); } finally { await h.service.stop(); }
});
test('M4 pause/archive and explicit host authorization prevent reads', async () => {
  const h = harness(); try { const id = await create(h.service); await assert.rejects(h.service.run(id, true), { code: 'STORE_DISABLED' }); await enable(h.service); await h.service.dispatch('pauseMonitor', { id, expectedVersion: 1 }); await assert.rejects(h.service.run(id, true), { code: 'CONFLICT' }); await h.service.dispatch('archiveMonitor', { id, expectedVersion: 2 }); h.advance(100000); await h.service.tick(); assert.equal(h.reads(), 0); } finally { await h.service.stop(); }
  const noNetwork = harness(); await noNetwork.service.stop(); const service = new DesktopService({ ...noNetwork.options, fixtureMode: false, networkEnabled: false }); service.start(); try { const id = await create(service); await enable(service); await assert.rejects(service.run(id, true), { code: 'NETWORK_NOT_ENABLED' }); } finally { await service.stop(); }
});
test('M4 bounded request budget and store interval persist across restart', async () => {
  const h = harness(true); const id = await create(h.service); await enable(h.service);
  await h.service.run(id, true); await assert.rejects(h.service.run(id, true), { code: 'STORE_COOLDOWN' });
  for (let i = 1; i < 6; i++) { h.advance(5000); await h.service.run(id, true); }
  await h.service.stop(); const service = new DesktopService(h.options); service.start(); try { h.advance(60000); assert.equal(service.snapshot().settings.liveReadsUsed, 6); await assert.rejects(service.run(id, true), { code: 'READ_BUDGET_EXHAUSTED' }); assert.equal(h.reads(), 6); } finally { await service.stop(); }
});
test('M4 overdue work coalesces after sleep and never causes catch-up burst', async () => {
  const h = harness(); try { await create(h.service); await create(h.service, secondary); await enable(h.service); h.service.suspend(); h.advance(3600000); await h.service.tick(); assert.equal(h.reads(), 0); h.service.resume(); const due = h.service.snapshot().monitors.map(m => m.nextDueAt); assert.equal(Number(due[1]) - Number(due[0]), 5000); await h.service.tick(); assert.equal(h.reads(), 0); h.advance(5000); await h.service.tick(); assert.equal(h.reads(), 1); await h.service.tick(); assert.equal(h.reads(), 1); } finally { await h.service.stop(); }
});
test('M4 suspension drains a bounded read without admitting a simulation', async () => {
  const h = harness(); let release: (() => void) | undefined;
  h.reader(async url => { await new Promise<void>(resolve => { release = resolve; }); return capture(url, START); });
  const id = await create(h.service); await enable(h.service); const running = h.service.run(id, true); h.service.suspend(); assert.ok(release); release(); await running;
  assert.equal(h.service.snapshot().evaluations.length, 0); assert.equal(h.service.snapshot().history.length, 0); await h.service.stop();
});
test('M4 restriction responses disable store without replacing prior evidence', async () => {
  const h = harness(); try { const id = await create(h.service); await enable(h.service); await h.service.run(id, true); h.advance(5000); h.reader(async () => { throw Object.assign(new Error('sanitized'), { code: 'BLOCKED' }); }); await h.service.run(id, true); const s = h.service.snapshot(); assert.equal(s.settings.storeEnabled, false); assert.equal(s.products.length, 1); assert.equal(s.stores[0]?.observationHealth, 'BLOCKED'); await enable(h.service); h.advance(100000); await assert.rejects(h.service.run(id, true), { code: 'STORE_COOLDOWN' }); } finally { await h.service.stop(); }
});
test('M4 shutdown/reopen retains observations, decisions and delivered receipts without replay', async () => {
  const h = harness(); const id = await create(h.service); await enable(h.service); await h.service.run(id, true); await h.service.stop();
  const db = new DatabaseSync(h.databasePath, { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) n FROM checkout_attempts').get()?.['n'], 0); assert.equal(db.prepare('SELECT count(*) n FROM handler_receipts').get()?.['n'], 1); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); }
  const service = new DesktopService(h.options); service.start(); try { assert.equal(service.snapshot().history.length, 4); assert.equal(service.snapshot().diagnostics.pendingOutbox, 0); assert.equal(h.reads(), 1); } finally { await service.stop(); }
});
test('M4 schema 2 migration preserves existing monitor data and creates disabled settings', async () => {
  const h = harness(); await create(h.service); await h.service.stop();
  const db = new DatabaseSync(h.databasePath); db.exec('DROP TABLE restock_receipts; DROP TABLE restock_outbox; DROP TABLE restock_events; DROP TABLE restock_samples; DROP TABLE restock_scopes; DROP TABLE desktop_schedule; DROP TABLE desktop_settings_audit; DROP TABLE desktop_settings; DROP INDEX desktop_evaluations_time; DROP INDEX desktop_observations_time; PRAGMA user_version=2;'); db.close();
  const service = new DesktopService(h.options); service.start(); try { assert.equal(service.snapshot().diagnostics.schemaVersion, 4); assert.equal(service.snapshot().monitors.length, 1); assert.equal(service.snapshot().settings.storeEnabled, false); } finally { await service.stop(); }
});
test('M4 actual React observation component escapes hostile text and retains unknown fields', () => {
  const evidence = capture(primary, START); const view = observationView(evidence, START + 222);
  const markup = renderToStaticMarkup(createElement(Observation, { value: view, open: () => { } }));
  assert.match(markup, /&lt;img/); assert.doesNotMatch(markup, /<img|<script/); assert.match(markup, /UNKNOWN/); assert.doesNotMatch(markup, /0\.00 MXN/);
  assert.equal(atDisplayTime(view, START + 61000).stale, true);
});
test('M4 recovery quarantine retains current read models and rejects writes/resume', async () => {
  const h = harness(); await create(h.service); await h.service.stop(); const db = new DatabaseSync(h.databasePath); db.exec('UPDATE database_metadata SET recovery_required=1'); db.close();
  const service = new DesktopService(h.options); service.start();
  try { assert.equal(service.snapshot().status, 'DATABASE_UNAVAILABLE'); assert.equal(service.snapshot().monitors.length, 1); await assert.rejects(service.dispatch('createMonitor', { name: 'denied', url: primary, cadenceSeconds: 60 }), { code: 'RECOVERY_READ_ONLY' }); service.suspend(); service.resume(); assert.equal(service.snapshot().status, 'DATABASE_UNAVAILABLE'); await service.tick(); assert.equal(h.reads(), 0); } finally { await service.stop(); }
});
test('M4 shutdown stops admission and drains the existing read before closing SQLite', async () => {
  const h = harness(); let release: (() => void) | undefined;
  h.reader(async url => { await new Promise<void>(resolve => { release = resolve; }); return capture(url, START); });
  const id = await create(h.service); await enable(h.service); const running = h.service.run(id, true); const stopped = h.service.stop();
  await assert.rejects(h.service.run(id, true), { code: 'SUSPENDED' }); assert.ok(release); release(); await running; await stopped;
  const reopened = new DesktopService(h.options); reopened.start(); try { assert.equal(reopened.snapshot().evaluations.length, 0); assert.equal(reopened.snapshot().monitors[0]?.lastResult, 'CANCELLED'); } finally { await reopened.stop(); }
});
test('M4 validates the serialized DTO rather than trusting a custom serialization hook', () => {
  const input = { id: 'a', expectedVersion: 1 };
  Object.defineProperty(input, 'toJSON', { value: () => ({ id: 'a', expectedVersion: 1, sql: 'forbidden' }) });
  assert.throws(() => validateCommand('pauseMonitor', input), { code: 'INVALID_PAYLOAD' });
});
test('M4 presents existing complete simulation as Would Have Executed and expires open opportunity counts', async t => {
  const h = durableHarness(t); const f = h.seed(); await h.store.coordinator.run(f.adapter, f.command);
  const context = { state: 'RUNNING' as const, reason: 'FIXTURE', networkEnabled: false, fixtureMode: true, databaseLocation: h.path };
  const view = workspaceView(h.store, f.command.now, context);
  assert.equal(view.evaluations[0]?.decision, 'SIMULATED'); assert.equal(decisionLabel(view.evaluations[0]?.decision ?? ''), 'Would Have Executed');
  assert.equal(view.dashboard.wouldHaveExecutedToday, 1); assert.equal(view.dashboard.opportunitiesOpen, 1); assert.equal(view.monitors[0]?.manageable, false);
  assert.equal(workspaceView(h.store, f.command.now + 61000, context).dashboard.opportunitiesOpen, 0);
});
