import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { DesktopService } from '@ptcg/desktop/service';
import { resolveMonitorSource, AMAZON_ASINS, AMAZON_DELIVERY, monitorDefinition } from '@ptcg/desktop/policy';
import { AmazonBrowserProvider, normalizeAmazon, mapAmazonDomain, amazonRestockInput } from '@ptcg/adapters';
import type { AmazonProviderResult, AmazonRenderedCapture } from '@ptcg/adapters';
import { id } from '@ptcg/core';
import { isProductMonitor, productMonitorScope, PRODUCT_MONITOR_POLICY } from '@ptcg/application';
import { openDurableStore } from '@ptcg/infrastructure';
import { rendered } from '../fixtures/amazon-rendered.js';
import { P_NOW } from '../fixtures/amazon-providers.js';
import type { createAmazonMonitorReader as ReaderFactory } from '../../scripts/amazon-monitor-transport.mjs';
import type { AmazonProviderEvidence, AmazonContextDiagnostic, AmazonTarget } from '@ptcg/adapters';
const { createAmazonMonitorReader } = await import(pathToFileURL(resolve('scripts/amazon-monitor-transport.mjs')).href) as { createAmazonMonitorReader: typeof ReaderFactory; };

const urls = AMAZON_ASINS.map(a => `https://www.amazon.com.mx/dp/${a}`);
async function capture(url: string, at: number, patch: Partial<AmazonRenderedCapture> = {}): Promise<AmazonProviderResult> {
  const source = resolveMonitorSource(url); assert.equal(source.family, 'Amazon'); if (source.family !== 'Amazon') throw new Error('Wrong fixture');
  const target = { asin: source.asin, url: source.canonical, marketplace: 'MX' as const, deliveryScope: AMAZON_DELIVERY };
  return new AmazonBrowserProvider({
    mode: 'AUTHORIZED_VALIDATION', async readRendered() {
      return rendered({ target, capturedAt: at, captureId: `authored-monitor-${at}`, asins: [source.asin], titles: ['Authored monitor <script>unsafe</script>'], prices: ['$589.00'], currencies: [], sellers: [], sellerIds: [], shippers: [], availability: ['No disponible'], actions: [], ...patch });
    }
  }).read(target, { now: at, deadlineAt: at + 60000, currency: 'MXN', deliveryScope: AMAZON_DELIVERY, operationId: 'authored', traceId: 'authored' });
}
function harness() {
  mkdirSync('work/m5.5-tests', { recursive: true }); const databasePath = join(mkdtempSync('work/m5.5-tests/case-'), 'astra.sqlite');
  let now = P_NOW; let seq = 0; let reads = 0; let fallback = 0; let cancelled = 0;
  let reader = (url: string) => capture(url, now);
  const options = {
    databasePath, now: () => now, newId: () => String(++seq), networkEnabled: false, amazonNetworkEnabled: true, fixtureMode: false,
    read: async () => { fallback++; throw new Error('NO_FALLBACK'); }, readAmazon: async (url: string) => { reads++; return reader(url); }, cancelRead: () => { cancelled++; }
  };
  const service = new DesktopService(options); service.start();
  return { service, options, databasePath, advance: (ms = 60001) => { now += ms; }, now: () => now, reads: () => reads, fallback: () => fallback, cancelled: () => cancelled, reader: (r: typeof reader) => { reader = r; } };
}
async function create(h: ReturnType<typeof harness>, index = 0) {
  const settings = h.service.snapshot().settings;
  if (!settings.storeEnabled) await h.service.dispatch('updateSafeSettings', { expectedVersion: settings.version, refreshSeconds: 5, storeEnabled: true });
  const result = await h.service.dispatch('createMonitor', { name: 'Authored monitor', url: urls[index], cadenceSeconds: 60 }); assert.ok('id' in result); return result.id;
}
function count(path: string, table: string) { const db = new DatabaseSync(path, { readOnly: true }); try { return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n']); } finally { db.close(); } }

test('M5.5 explicit bounded source routing canonicalizes ASIN and keeps Shopify', () => {
  const a = resolveMonitorSource('https://amazon.com.mx/Title/dp/b0h78bb9ty?ref_=tracking');
  assert.equal(a.canonical, urls[0]); assert.equal(a.provider, 'BROWSER'); assert.equal(a.family, 'Amazon');
  assert.equal(resolveMonitorSource('https://kantocards.com/products/perfect-order-booster-pack-espanol').provider, 'SHOPIFY');
  const m = monitorDefinition('p', { name: 'Product', url: urls[0] ?? '', cadenceSeconds: 60 }, P_NOW);
  assert.ok(isProductMonitor(m.configuration)); assert.ok(!('offerRef' in m.configuration));
});
for (const url of ['https://amazon.com/dp/B0H78BB9TY', 'https://m.amazon.com.mx/dp/B0H78BB9TY', 'https://www.amazon.com.mx/cart', 'https://www.amazon.com.mx/dp/short', 'https://www.amazon.com.mx/dp/B0UNKNOWN1', 'https://www.amazon.com.mx/dp/B0H78BB9TY?seller=x', 'https://www.amazon.com.mx/ap/signin', 'https://evil.test/dp/B0H78BB9TY', 'B0H78BB9TY']) test(`M5.5 rejects unsupported source ${url}`, () => assert.throws(() => resolveMonitorSource(url)));

for (const [name, patch, available, mode, release] of [
  ['unavailable', {}, 'UNAVAILABLE', null, null],
  ['preorder', { availability: ['Este producto saldrá a la venta el 13 de noviembre de 2026.'], actions: ['Reserva ahora'], releaseTexts: ['Este producto saldrá a la venta el 13 de noviembre de 2026.'] }, 'AVAILABLE', 'PREORDER', '2026-11-13'],
  ['immediate', { availability: ['Disponible'], actions: ['Agregar al carrito'] }, 'AVAILABLE', 'IMMEDIATE', null]
] as const) test(`M5.5 ${name} persists product baseline with no fabricated Offer, seller or money`, async () => {
  const h = harness(); const key = await create(h); h.reader(url => capture(url, h.now(), patch));
  try {
    await h.service.dispatch('runMonitorNow', { id: key }); const p = h.service.snapshot().monitors[0]?.product; assert.ok(p);
    assert.equal(p.availability.value, available); assert.equal(p.purchaseMode.value, mode); assert.equal(p.releaseDate.value, release);
    assert.equal(p.baseline, available); assert.equal(p.events.length, 0); assert.equal(p.price.state, 'UNKNOWN'); assert.equal(p.seller.state, 'UNKNOWN'); assert.equal(p.fulfillment.state, 'UNKNOWN'); assert.equal(p.opportunity, 'BLOCKED / INDETERMINATE');
    for (const table of ['offers', 'sellers', 'purchase_intents', 'checkout_attempts']) assert.equal(count(h.databasePath, table), 0);
    assert.equal(count(h.databasePath, 'store_products'), 1); assert.equal(count(h.databasePath, 'restock_samples'), 1);
    assert.equal(h.service.snapshot().stores[0]?.observationHealth, 'UNAVAILABLE'); assert.equal(h.fallback(), 0);
  } finally { await h.service.stop(); }
  const reopened = new DesktopService(h.options); reopened.start(); try { assert.equal(reopened.snapshot().monitors[0]?.product?.availability.value, available); assert.equal(reopened.store.diagnostics().schemaVersion, 4); } finally { await reopened.stop(); }
});

test('M5.5 due tick, pause/resume, archive and restart coalesce without catch-up burst', async () => {
  const h = harness(); const key = await create(h);
  await h.service.tick(); assert.equal(h.reads(), 0); h.advance(); await h.service.tick(); await h.service.tick(); assert.equal(h.reads(), 1);
  await h.service.dispatch('pauseMonitor', { id: key, expectedVersion: 1 }); h.advance(3600000); await h.service.tick(); assert.equal(h.reads(), 1);
  await h.service.dispatch('resumeMonitor', { id: key, expectedVersion: 2 }); await h.service.tick(); assert.equal(h.reads(), 1);
  await h.service.stop(); h.advance(3600000); const r = new DesktopService(h.options); r.start();
  try {
    await r.tick(); assert.equal(h.reads(), 1); h.advance(5000); await r.tick(); assert.equal(h.reads(), 2);
    assert.equal(r.snapshot().monitors[0]?.product?.events.length, 0);
    await r.dispatch('archiveMonitor', { id: key, expectedVersion: 3 }); h.advance(); await r.tick(); assert.equal(h.reads(), 2);
  } finally { await r.stop(); }
});

for (const category of ['NETWORK_ERROR', 'CHALLENGE_DETECTED', 'ACCESS_DENIED', 'PARSER_MISMATCH', 'TIMEOUT'] as const) test(`M5.5 ${category} preserves older baseline with scoped failure and no OOS/restock`, async () => {
  const h = harness(); const key = await create(h); h.reader(url => capture(url, h.now(), { availability: ['Disponible'], actions: ['Agregar al carrito'] }));
  try {
    await h.service.run(key, true); h.advance(); h.reader(async () => ({ category, provider: 'BROWSER', retryable: false } as AmazonProviderResult)); await h.service.run(key, true);
    const row = h.service.snapshot().monitors[0]; assert.ok(row?.product); assert.equal(row.product.availability.value, 'AVAILABLE'); assert.equal(row.product.baseline, 'AVAILABLE'); assert.equal(row.product.stale, true); assert.equal(row.product.events.length, 0);
    assert.equal(h.service.snapshot().settings.storeEnabled, true); assert.equal(h.service.snapshot().stores[0]?.observationHealth, 'UNAVAILABLE'); assert.notEqual(row.lastResult, 'PRODUCT_OBSERVED'); assert.equal(h.fallback(), 0);
    if (category === 'CHALLENGE_DETECTED' || category === 'ACCESS_DENIED') { h.advance(); await assert.rejects(h.service.run(key, true), { code: 'STORE_COOLDOWN' }); }
  } finally { await h.service.stop(); }
});

test('M5.5 incomplete successful page leaves absence UNKNOWN and preserves comparable baseline', async () => {
  const h = harness(); const key = await create(h);
  try {
    await h.service.run(key, true); h.advance(); h.reader(url => capture(url, h.now(), { availability: [], actions: [] })); await h.service.run(key, true);
    const row = h.service.snapshot().monitors[0]; assert.equal(row?.product?.availability.state, 'UNKNOWN'); assert.equal(row?.product?.baseline, 'UNAVAILABLE'); assert.equal(row?.lastResult, 'CONTENT_INCOMPLETE'); assert.equal(row?.product?.events.length, 0);
  } finally { await h.service.stop(); }
});

for (const cancel of ['pause', 'disable', 'suspend', 'stop'] as const) test(`M5.5 in-flight exclusion and ${cancel} cancellation prevent late evidence commit`, async () => {
  const h = harness(); const key = await create(h); let release: ((r: AmazonProviderResult) => void) | undefined;
  const result = await capture(urls[0] ?? '', h.now()); h.reader(() => new Promise(resolve => { release = resolve; }));
  const pending = h.service.run(key, true); await assert.rejects(h.service.run(key, true), { code: 'BUSY' });
  let stop: Promise<void> | undefined;
  if (cancel === 'pause') await h.service.dispatch('pauseMonitor', { id: key, expectedVersion: 1 });
  if (cancel === 'disable') { const s = h.service.snapshot().settings; await h.service.dispatch('updateSafeSettings', { expectedVersion: s.version, refreshSeconds: 5, storeEnabled: false }); }
  if (cancel === 'suspend') h.service.suspend();
  if (cancel === 'stop') stop = h.service.stop();
  assert.equal(h.cancelled(), 1); assert.ok(release); release(result); await pending;
  assert.equal(count(h.databasePath, 'restock_samples'), 0); if (stop) await stop; else await h.service.stop();
});

test('M5.5 source opt-in is independent; no Amazon read or Shopify fallback without permission', async () => {
  const h = harness(); const key = await create(h); await h.service.stop();
  const r = new DesktopService({ ...h.options, networkEnabled: true, amazonNetworkEnabled: false }); r.start();
  try { h.advance(); await r.tick(); await assert.rejects(r.run(key, true), { code: 'NETWORK_NOT_ENABLED' }); assert.equal(h.reads(), 0); assert.equal(h.fallback(), 0); assert.equal(r.snapshot().monitors[0]?.networkAllowed, false); } finally { await r.stop(); }
});

test('M5.5 update changes source identity without leaking the previous product baseline', async () => {
  const h = harness(); const key = await create(h);
  try {
    await h.service.run(key, true);
    await h.service.dispatch('updateMonitor', { id: key, expectedVersion: 1, name: 'New target', url: urls[1], cadenceSeconds: 120 });
    assert.equal(h.service.snapshot().monitors[0]?.product, null);
    h.advance(); await h.service.run(key, true); assert.equal(h.service.snapshot().monitors[0]?.product?.asin, AMAZON_ASINS[1]);
    assert.equal(count(h.databasePath, 'store_products'), 2); assert.equal(count(h.databasePath, 'restock_events'), 0);
  } finally { await h.service.stop(); }
});

test('M5.5 failed observation then stale recovery never invents a restock', async () => {
  const h = harness(); const key = await create(h);
  try {
    await h.service.run(key, true); h.advance(); h.reader(async () => { throw new Error('authored timeout'); }); await h.service.run(key, true);
    h.advance(); h.reader(url => capture(url, h.now(), { availability: ['Disponible'], actions: ['Agregar al carrito'] })); await h.service.run(key, true);
    const row = h.service.snapshot().monitors[0]; assert.equal(row?.product?.baseline, 'AVAILABLE'); assert.equal(row?.product?.events.length, 0);
    assert.equal(h.service.snapshot().history.filter(h => h.monitorId === key).length, 3);
  } finally { await h.service.stop(); }
});

test('M5.5 interrupted product run is recovered without rereading; budgets survive reopen', async () => {
  const h = harness(); const key = await create(h); await h.service.run(key, true);
  h.service.store.monitors.startRun({ monitorId: id('monitor', key), revision: 1, runId: 'interrupted', operationId: 'interrupted', traceId: 'test', now: h.now() });
  await h.service.stop(); const r = new DesktopService(h.options); r.start();
  try {
    assert.equal(r.store.monitors.getRun('interrupted').reason, 'RESTART_INTERRUPTED'); assert.equal(r.snapshot().settings.liveReadsUsed, 1); assert.equal(h.reads(), 1);
    assert.equal(r.snapshot().monitors[0]?.product?.baseline, 'UNAVAILABLE'); await r.tick(); assert.equal(h.reads(), 1);
  } finally { await r.stop(); }
});

test('M5.5 known money and independent fulfillment do not fabricate seller approval', async () => {
  const h = harness(); const key = await create(h);
  h.reader(url => capture(url, h.now(), { prices: ['MXN 589.00'], currencies: ['MXN'], shipperStatements: ['Enviado por: Amazon México'], shippers: ['Amazon México'], availability: ['Disponible'], actions: ['Agregar al carrito'] }));
  try {
    await h.service.run(key, true); const p = h.service.snapshot().monitors[0]?.product; assert.ok(p); assert.equal(p.price.value, '589.00 MXN'); assert.equal(p.seller.state, 'UNKNOWN'); assert.equal(p.fulfillment.value, 'AMAZON'); assert.equal(count(h.databasePath, 'offers'), 0); assert.equal(count(h.databasePath, 'purchase_intents'), 0);
  } finally { await h.service.stop(); }
});

test('M5.5 real fresh transition, repeated state, replay and atomic run/audit/outbox ownership', async () => {
  const h = harness(); const key = await create(h); const m = h.service.store.monitors.getMonitor(id('monitor', key)); const c = m.definition.configuration; assert.ok(isProductMonitor(c));
  const scope = productMonitorScope(key, c); const inputs = [];
  try {
    for (let sequence = 0; sequence < 3; sequence++) {
      const now = P_NOW + sequence * 1000; const result = await capture(urls[0] ?? '', now, sequence ? { availability: ['Disponible'], actions: ['Agregar al carrito'] } : {}); assert.ok('evidence' in result);
      const n = normalizeAmazon(result.evidence); const command = { monitorId: id('monitor', key), revision: 1, runId: `fresh-${sequence}`, operationId: `fresh-${sequence}`, traceId: 'test', now };
      h.service.store.monitors.startRun(command); const input = amazonRestockInput(n, mapAmazonDomain(n, c.deliveryScope).observations, scope, command.runId, now);
      const decision = h.service.store.productMonitoring.complete(command, input, now); inputs.push(input);
      assert.deepEqual(decision.events.map(e => e.type), sequence === 1 ? ['RESTOCK_DETECTED'] : []);
      assert.equal(h.service.store.productMonitoring.complete(command, input, now).outcome, 'DUPLICATE');
    }
    assert.equal(count(h.databasePath, 'restock_samples'), 3); assert.equal(count(h.databasePath, 'restock_events'), 1); assert.equal(count(h.databasePath, 'restock_outbox'), 1);
    assert.equal(h.service.store.restock.deliverPending(P_NOW + 3000).delivered, 1); assert.equal(h.service.store.restock.deliverPending(P_NOW + 3000).delivered, 0);
    assert.equal(count(h.databasePath, 'purchase_intents'), 0);
  } finally { await h.service.stop(); }
  const r = openDurableStore(h.databasePath); try { for (const input of inputs) assert.equal(r.restock.record(input, PRODUCT_MONITOR_POLICY, P_NOW + 5000).outcome, 'DUPLICATE'); assert.equal(r.restock.getEvents(scope).length, 1); assert.equal(r.restock.deliverPending(P_NOW + 5000).delivered, 0); } finally { r.close(); }
});

test('M5.5 product completion rollback leaves run pending and no partial baseline or audit', async () => {
  const h = harness(); const key = await create(h); await h.service.stop(); let inject = false;
  const store = openDurableStore(h.databasePath, { fault(point) { if (inject && point === 'BEFORE_COMMIT') throw new Error('AUTHORED_DISK_FAILURE'); } });
  try {
    const c = store.monitors.getMonitor(id('monitor', key)).definition.configuration; assert.ok(isProductMonitor(c)); const result = await capture(urls[0] ?? '', P_NOW); assert.ok('evidence' in result);
    const n = normalizeAmazon(result.evidence); const command = { monitorId: id('monitor', key), revision: 1, runId: 'rollback', operationId: 'rollback', traceId: 'test', now: P_NOW };
    store.monitors.startRun(command); const input = amazonRestockInput(n, [], productMonitorScope(key, c), command.runId, P_NOW); inject = true;
    assert.throws(() => store.productMonitoring.complete(command, input, P_NOW)); assert.equal(store.monitors.getRun(command.runId).status, 'RUNNING'); assert.equal(store.restock.getState(input.scope), null); assert.equal(count(h.databasePath, 'monitor_audit'), 1);
    inject = false; store.productMonitoring.complete(command, input, P_NOW); assert.equal(store.monitors.getRun(command.runId).status, 'SUCCEEDED');
  } finally { store.close(); }
});

test('M5.5 Windows harness remains opt-in and monitoring has no passive/execution path', () => {
  const r = spawnSync(process.execPath, ['scripts/amazon-monitor-windows-validation.mjs'], { env: { ...process.env, AMAZON_BROWSER_MONITORING_ENABLED: '' }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stdout, /NOT_EXECUTED/); assert.match(r.stdout, /"navigations":0/);
  const transport = readFileSync('scripts/amazon-monitor-transport.mjs', 'utf8'); assert.match(transport, /new AmazonBrowserProvider/); assert.match(transport, /captureAmazonPage/);
  assert.doesNotMatch(transport, /amazon-passive|AmazonBusinessApiProvider|AmazonPrivateApiProvider|\.click\(|\.request\(|storageState|addCookies|proxy:|userAgent:/i);
  const ui = readFileSync('apps/desktop/src/renderer/monitors.tsx', 'utf8'); assert.match(ui, /purchaseMode/); assert.match(ui, /STALE/); assert.match(ui, /fulfillment/); assert.doesNotMatch(ui, /dangerouslySetInnerHTML/);
});

test('M5.5 correction reproduces invalid capture ID while all product identity fields match', async () => {
  const target = { asin: AMAZON_ASINS[0], url: urls[0] ?? '', marketplace: 'MX' as const, deliveryScope: AMAZON_DELIVERY };
  const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return rendered({ target, capturedAt: P_NOW, captureId: `amazon-browser-m5.5-1-${P_NOW}`, asins: [target.asin], offerRegion: false, selectedAsin: false, actions: [], availability: ['No disponible'], prices: [], currencies: [], sellerIds: [], sellers: [], shippers: [] }); } });
  await assert.rejects(provider.read(target, { now: P_NOW, deadlineAt: P_NOW + 90000, currency: 'MXN', deliveryScope: AMAZON_DELIVERY, operationId: 'test', traceId: 'test' }), error => {
    const e = error as Error & { contextDiagnostic: AmazonContextDiagnostic; }; const d = e.contextDiagnostic;
    assert.equal(e.message, 'CONTEXT_MISMATCH'); assert.equal(d.comparison.captureIdValid, false);
    assert.equal(d.comparison.productIdMatch, true); assert.equal(d.comparison.storeMatch, true); assert.equal(d.comparison.chronologyMatch, true); return true;
  });
});

for (const [name, patch, availability, mode] of [
  ['UNAVAILABLE', { availability: ['No disponible'], actions: [] }, 'UNAVAILABLE', null],
  ['PREORDER', { availability: ['Este producto saldrá a la venta el 13 de noviembre de 2026.'], actions: ['Reserva ahora'] }, 'AVAILABLE', 'PREORDER'],
  ['IMMEDIATE', { availability: ['Disponible'], actions: ['Agregar al carrito'] }, 'AVAILABLE', 'IMMEDIATE']
] as const) test(`M5.5 correction actual monitor transport capture ID persists ${name} with no Offer`, async () => {
  const h = harness(); const key = await create(h); let navigations = 0; let closes = 0;
  const page = { mainFrame: () => ({}), url: () => urls[0], async goto() { navigations++; return { status: () => 200 }; }, async evaluate() { return rendered({ offerRegion: false, selectedAsin: false, asins: [AMAZON_ASINS[0]], prices: [], currencies: [], sellerIds: [], sellers: [], shippers: [], ...patch }); } };
  const reader = createAmazonMonitorReader({ enabled: true, clock: { now: h.now }, launcher: { async launch() { return { async newContext() { return { async newPage() { return page; }, async route() { }, async close() { closes++; } }; }, async close() { closes++; } }; } } });
  h.reader(reader.read);
  try {
    await h.service.run(key, true); const row = h.service.snapshot().monitors[0]; assert.equal(row?.lastResult, 'PRODUCT_OBSERVED'); assert.equal(row.product?.availability.value, availability); assert.equal(row.product?.purchaseMode.value, mode); assert.equal(row.product?.events.length, 0);
    assert.equal(row.product?.seller.state, 'UNKNOWN'); assert.equal(row.product?.price.state, 'UNKNOWN'); assert.equal(row.product?.fulfillment.state, 'UNKNOWN'); if (name === 'PREORDER') assert.equal(row.product?.releaseDate.value, '2026-11-13');
    assert.equal(count(h.databasePath, 'store_products'), 1); for (const table of ['offers', 'sellers', 'purchase_intents', 'restock_events']) assert.equal(count(h.databasePath, table), 0);
    assert.equal(navigations, 1); assert.equal(closes, 2);
  } finally { await h.service.stop(); }
  const r = new DesktopService(h.options); r.start(); try { assert.equal(r.snapshot().monitors[0]?.product?.availability.value, availability); assert.equal(r.snapshot().monitors[0]?.product?.events.length, 0); assert.equal(navigations, 1); } finally { await r.stop(); }
});

for (const [name, transform, field] of [
  ['wrong ASIN', (e: AmazonProviderEvidence) => ({ ...e, asin: AMAZON_ASINS[1] }), 'productIdMatch'],
  ['wrong marketplace', (e: AmazonProviderEvidence) => ({ ...e, marketplace: 'US' } as unknown as AmazonProviderEvidence), 'storeMatch'],
  ['wrong provider', (e: AmazonProviderEvidence) => ({ ...e, source: { ...e.source, provider: 'BUSINESS_API' as const } }), 'providerMatch'],
  ['wrong store provenance', (e: AmazonProviderEvidence) => ({ ...e, source: { ...e.source, confidence: 'AUTHORED_FIXTURE' as const } }), 'storeMatch'],
  ['wrong URL product', (e: AmazonProviderEvidence) => ({ ...e, productUrl: urls[1] ?? '' }), 'urlProductMatch'],
  ['wrong family URL', (e: AmazonProviderEvidence) => ({ ...e, productUrl: 'https://kantocards.com/products/example' }), 'familyMatch']
] as const) test(`M5.5 correction rejects ${name} with sanitized comparison`, async () => {
  const h = harness(); const key = await create(h); const base = await capture(urls[0] ?? '', P_NOW, { offerRegion: false }); assert.ok('evidence' in base);
  await h.service.stop(); const diagnostics: AmazonContextDiagnostic[] = [];
  const r = new DesktopService({ ...h.options, readAmazon: async () => ({ ...base, evidence: transform(base.evidence) }), contextDiagnostic: d => diagnostics.push(d) }); r.start();
  try {
    await r.run(key, true); assert.equal(r.snapshot().monitors[0]?.lastResult, 'CONTEXT_MISMATCH'); assert.equal(r.snapshot().monitors[0]?.product, null); assert.equal(diagnostics[0]?.comparison[field], false);
    assert.equal(count(h.databasePath, 'store_products'), 0); assert.equal(count(h.databasePath, 'offers'), 0); assert.equal(count(h.databasePath, 'restock_events'), 0);
  } finally { await r.stop(); }
});

test('M5.5 correction accepts canonical URL differences and lowercase ASIN at monitor boundary', async () => {
  const h = harness(); const key = await create(h); const result = await capture(urls[0] ?? '', P_NOW, { offerRegion: false }); assert.ok('evidence' in result);
  h.reader(async () => ({ ...result, evidence: { ...result.evidence, asin: AMAZON_ASINS[0].toLowerCase(), productUrl: `https://amazon.com.mx/Other-Title/dp/${AMAZON_ASINS[0].toLowerCase()}?ref_=tracking` } }));
  try { await h.service.run(key, true); assert.equal(h.service.snapshot().monitors[0]?.lastResult, 'PRODUCT_OBSERVED'); assert.equal(h.service.snapshot().monitors[0]?.product?.asin, AMAZON_ASINS[0]); } finally { await h.service.stop(); }
});

test('M5.5 correction rendered context binds marketplace, ASIN and delivery rather than exact URL bytes', async () => {
  const target = { asin: AMAZON_ASINS[0], url: urls[0] ?? '', marketplace: 'MX' as const, deliveryScope: AMAZON_DELIVERY }; const context = { now: P_NOW, deadlineAt: P_NOW + 60000, currency: 'MXN' as const, deliveryScope: AMAZON_DELIVERY, operationId: 'test', traceId: 'test' };
  const variant = { ...target, asin: target.asin.toLowerCase(), url: `https://amazon.com.mx/title/dp/${target.asin}?ref_=tracking` };
  const read = (changed: AmazonTarget) => new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', readRendered: async () => rendered({ target: changed, capturedAt: P_NOW, asins: [target.asin], offerRegion: false, actions: [], availability: ['No disponible'] }) }).read(target, context);
  assert.ok('evidence' in await read(variant));
  for (const changed of [{ ...variant, asin: AMAZON_ASINS[1] }, { ...variant, marketplace: 'US' as 'MX' }, { ...variant, deliveryScope: 'different' }]) await assert.rejects(read(changed), /CONTEXT_MISMATCH/);
});
