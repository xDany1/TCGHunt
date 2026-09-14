import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { id, known, ref, unknown } from '@ptcg/core';
import { PRODUCT_MONITOR_POLICY, isProductMonitor, productMonitorScope } from '@ptcg/application';
import type { RestockInput, MonitoringOpportunityContext } from '@ptcg/application';
import { workspaceView } from '@ptcg/desktop/queries';
import { MonitoringAlerts } from '@ptcg/desktop/presentation';
import { monitorDefinition, AMAZON_DELIVERY } from '@ptcg/desktop/policy';
import { DesktopService } from '@ptcg/desktop/service';
import { AmazonBrowserProvider, amazonRestockInput, normalizeAmazon, mapAmazonDomain } from '@ptcg/adapters';
import { harness } from '../fixtures/durable.js';
import { restockFixture, R_NOW } from '../fixtures/restock.js';
import { rendered } from '../fixtures/amazon-rendered.js';
import { authoredCapture } from '../fixtures/kantocards.js';

const productRef = ref(id('store', 'amazon-mx-m5.4-browser-live'), 'product', 'B0H78BB9TY');
function productReading(offset: number, state: 'UNAVAILABLE' | 'IMMEDIATE' | 'PREORDER'): RestockInput {
  const f = restockFixture(offset); const e = f.observation.stock.evidence;
  return {
    ...f.input, scope: { kind: 'PRODUCT', watchId: 'amazon-alert-monitor', productRef, deliveryScope: AMAZON_DELIVERY }, coverage: 'PRODUCT_PAGE', observations: [], provenance: { provider: 'BROWSER', reference: 'AUTHORED-M5.6' },
    productObservation: { productRef, title: 'AUTHORED <script>unsafe</script>', availability: known(state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE', e), purchaseMode: state === 'UNAVAILABLE' ? unknown('NOT_OBSERVED', e) : known(state, e), releaseDate: state === 'PREORDER' ? known('2026-11-13', e) : unknown('NOT_OBSERVED', e) }
  };
}
function context(f: ReturnType<typeof restockFixture>): MonitoringOpportunityContext {
  const c = f.definition.configuration;
  return { observationId: f.observation.id, target: c.target, mapping: c.mapping, scenario: c.scenario, quantity: c.quantity, currency: c.currency };
}
function view(store: ReturnType<typeof harness>['store'], now = R_NOW + 2000) {
  return workspaceView(store, now, { state: 'RUNNING', reason: 'AUTHORED', networkEnabled: false, fixtureMode: true, databaseLocation: 'authored' });
}
function zeroEffects(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { for (const table of ['offers', 'sellers', 'purchase_intents', 'checkout_attempts']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0); }
  finally { db.close(); }
}

for (const state of ['UNAVAILABLE', 'IMMEDIATE', 'PREORDER'] as const) test(`M5.6 first ${state} is baseline, no alert`, t => {
  const h = harness(t); const input = productReading(0, state);
  assert.equal(h.store.restock.record(input, PRODUCT_MONITOR_POLICY, R_NOW).outcome, 'INITIALIZED');
  assert.equal(h.store.restock.listAlerts().length, 0); assert.equal(view(h.store).alerts.length, 0); zeroEffects(h.path);
});

for (const mode of ['IMMEDIATE', 'PREORDER'] as const) test(`M5.6 fresh ${mode} transition persists one alert despite blocked opportunity`, t => {
  const h = harness(t); const a = productReading(0, 'UNAVAILABLE'); const b = productReading(1000, mode);
  h.store.restock.record(a, PRODUCT_MONITOR_POLICY, R_NOW);
  const r = h.store.restock.record(b, PRODUCT_MONITOR_POLICY, R_NOW + 1000);
  assert.deepEqual(r.events.map(e => e.type), [mode === 'PREORDER' ? 'PREORDER_OPENED' : 'RESTOCK_DETECTED']);
  const alert = view(h.store).alerts[0]; assert.ok(alert);
  assert.equal(alert.previousState, 'UNAVAILABLE'); assert.equal(alert.currentState, 'AVAILABLE'); assert.equal(alert.purchaseMode, mode);
  assert.equal(alert.releaseDate, mode === 'PREORDER' ? '2026-11-13' : null);
  assert.equal(alert.opportunityStatus, 'BLOCKED'); assert.equal(alert.arithmetic, 'INDETERMINATE'); assert.equal(alert.purchaseReady, false); assert.equal(alert.execution, 'NOT_REQUESTED');
  for (const reason of ['OFFER_IDENTITY_MISSING', 'SELLER_UNKNOWN', 'PRICE_UNKNOWN', 'FULFILLMENT_UNKNOWN', 'PRODUCT_MAPPING_UNREVIEWED', 'ACQUISITION_COST_UNKNOWN', 'RESALE_EVIDENCE_MISSING']) assert.ok(alert.reasons.includes(reason));
  h.store.restock.record(productReading(2000, mode), PRODUCT_MONITOR_POLICY, R_NOW + 2000);
  assert.equal(h.store.restock.record(b, PRODUCT_MONITOR_POLICY, R_NOW + 2000).outcome, 'DUPLICATE');
  assert.equal(view(h.store).alerts.length, 1); zeroEffects(h.path);
});

for (const failure of ['TRANSIENT_FAILURE', 'PARSER_MISMATCH', 'CHALLENGE_DETECTED', 'ACCESS_DENIED', 'TIMEOUT', 'CONTENT_INCOMPLETE'] as const) test(`M5.6 ${failure} emits no stock alert and does not manufacture absence`, t => {
  const h = harness(t); const a = productReading(0, 'UNAVAILABLE');
  h.store.restock.record(a, PRODUCT_MONITOR_POLICY, R_NOW);
  const bad: RestockInput = { ...productReading(1000, 'IMMEDIATE'), status: failure === 'CONTENT_INCOMPLETE' ? 'PARTIAL_COVERAGE' : 'OBSERVATION_FAILED', provenance: { provider: 'BROWSER', reference: failure } };
  h.store.restock.record(bad, PRODUCT_MONITOR_POLICY, R_NOW + 1000);
  assert.equal(view(h.store).alerts.length, 0); assert.equal(h.store.restock.getState(a.scope)?.baseline?.availability, 'UNAVAILABLE');
  h.store.restock.record(productReading(2000, 'IMMEDIATE'), PRODUCT_MONITOR_POLICY, R_NOW + 2000);
  assert.equal(view(h.store).alerts.length, 1); // Genuine fresh explicit edge, not the failure itself.
  zeroEffects(h.path);
});

test('M5.6 stale read and expired baseline recovery never alert', t => {
  const h = harness(t); h.store.restock.record(productReading(0, 'UNAVAILABLE'), PRODUCT_MONITOR_POLICY, R_NOW);
  h.store.restock.record(productReading(1000, 'IMMEDIATE'), PRODUCT_MONITOR_POLICY, R_NOW + 70000);
  h.store.restock.record(productReading(80000, 'IMMEDIATE'), PRODUCT_MONITOR_POLICY, R_NOW + 80000);
  assert.equal(view(h.store).alerts.length, 0);
});

test('M5.6 preorder close and switch to immediate retain distinct event types', t => {
  const h = harness(t);
  for (const [i, mode] of ['PREORDER', 'IMMEDIATE', 'PREORDER', 'UNAVAILABLE'].entries()) h.store.restock.record(productReading(i * 1000, mode as 'PREORDER' | 'IMMEDIATE' | 'UNAVAILABLE'), PRODUCT_MONITOR_POLICY, R_NOW + i * 1000);
  assert.deepEqual(h.store.restock.getEvents(productReading(0, 'PREORDER').scope).map(e => e.type), ['PURCHASE_MODE_CHANGED', 'PURCHASE_MODE_CHANGED', 'PREORDER_CLOSED']);
});

for (const point of ['BEFORE_COMMIT', 'AFTER_HANDLER_EFFECT', 'AFTER_HANDLER_RECEIPT'] as const) test(`M5.6 ${point}: atomic alert/outbox and restart replay`, t => {
  let armed = false; const h = harness(t, { fault(p) { if (armed && p === point) { armed = false; throw new Error('AUTHORED_FAULT'); } } });
  const a = productReading(0, 'UNAVAILABLE'); const b = productReading(1000, 'IMMEDIATE');
  h.store.restock.record(a, PRODUCT_MONITOR_POLICY, R_NOW);
  if (point === 'BEFORE_COMMIT') {
    armed = true; assert.throws(() => h.store.restock.record(b, PRODUCT_MONITOR_POLICY, R_NOW + 1000));
    assert.equal(view(h.store).alerts.length, 0); assert.equal(h.store.restock.getSamples(a.scope).length, 1);
  }
  h.store.restock.record(b, PRODUCT_MONITOR_POLICY, R_NOW + 1000);
  if (point !== 'BEFORE_COMMIT') { armed = true; assert.equal(h.store.restock.deliverPending(R_NOW + 1000).failed, 1); }
  h.store.close(); const s = h.open(); assert.equal(view(s).alerts.length, 1);
  assert.equal(s.restock.deliverPending(R_NOW + 2000).delivered, 1);
  assert.equal(s.restock.deliverPending(R_NOW + 2000).delivered, 0);
  assert.equal(s.restock.record(b, PRODUCT_MONITOR_POLICY, R_NOW + 200000).outcome, 'DUPLICATE');
  assert.equal(s.restock.getReceipts().length, 1); assert.equal(view(s).alerts[0]?.delivery, 'DELIVERED');
  assert.equal(view(s, R_NOW + 200000).alerts[0]?.stale, true); zeroEffects(h.path);
});

test('M5.6 complete reviewed cost evidence invokes existing Opportunity Engine without admission', t => {
  const h = harness(t); const a = restockFixture(0, false); const b = restockFixture(1000);
  h.store.restock.record(a.input, a.policy, a.now);
  const input = { ...b.input, opportunityContext: context(b) };
  h.store.restock.record(input, b.policy, b.now);
  const alert = h.store.restock.listAlerts()[0]?.event.alert; assert.ok(alert);
  assert.equal(alert.opportunity.status, 'EVALUATED'); assert.equal(alert.opportunity.arithmetic, 'COMPLETE');
  assert.ok(alert.opportunity.evaluation?.status === 'COMPLETE'); assert.ok(alert.opportunity.evaluation.roi);
  assert.equal(alert.opportunity.purchaseReady, false); assert.equal(alert.opportunity.execution, 'NOT_REQUESTED'); zeroEffects(h.path);
  h.store.close(); const s = h.open(); assert.equal(s.restock.record(input, b.policy, R_NOW + 90000).outcome, 'DUPLICATE');
  assert.deepEqual(s.restock.listAlerts()[0]?.event.alert, alert);
  const changed = { ...input, opportunityContext: { ...context(b), mapping: { ...context(b).mapping, state: 'UNREVIEWED' as const } } };
  assert.throws(() => s.restock.record(changed, b.policy, R_NOW + 90000), { code: 'CONFLICT' });
});

for (const missing of ['seller', 'price', 'fulfillment', 'mapping', 'resale', 'shipping'] as const) test(`M5.6 ${missing} missing keeps a product alert blocked`, t => {
  const h = harness(t); const a = productReading(0, 'UNAVAILABLE'); h.store.restock.record(a, PRODUCT_MONITOR_POLICY, R_NOW);
  const f = restockFixture(1000); const o = f.observation; const c = context(f);
  // Authored coherent offer scope; a product signal must survive even if the seller policy rejects it.
  const input: RestockInput = {
    ...f.input, scope: { ...f.scope, kind: 'PRODUCT' }, coverage: 'PRODUCT_PAGE', productObservation: { ...productReading(1000, 'IMMEDIATE').productObservation, productRef: o.product.ref } as NonNullable<RestockInput['productObservation']>, observations: [{
      ...o,
      ...(missing === 'seller' ? { seller: unknown('MISSING', o.seller.evidence) } : {}), ...(missing === 'price' ? { unitPrice: unknown('MISSING', o.unitPrice.evidence) } : {}),
      ...(missing === 'fulfillment' ? { fulfilledBy: unknown('MISSING', o.fulfilledBy.evidence) } : {}), ...(missing === 'shipping' ? { shipping: unknown('MISSING', o.shipping.evidence) } : {})
    }],
    opportunityContext: { ...c, ...(missing === 'mapping' ? { mapping: { ...c.mapping, state: 'UNREVIEWED' } } : {}), ...(missing === 'resale' ? { scenario: { ...c.scenario, benchmark: { ...c.scenario.benchmark, grossResale: unknown('MISSING', c.scenario.benchmark.grossResale.evidence) } } } : {}) }
  };
  const before = { ...input, id: 'authored-before', observedAt: input.observedAt - 1000, receivedAt: input.receivedAt - 1000, observations: [], productObservation: { ...productReading(0, 'UNAVAILABLE').productObservation, productRef: o.product.ref } as NonNullable<RestockInput['productObservation']> };
  h.store.restock.record(before, f.policy, f.now - 1000); h.store.restock.record(input, f.policy, f.now);
  assert.equal(h.store.restock.listAlerts().length, 1); assert.equal(h.store.restock.listAlerts()[0]?.event.alert?.opportunity.status, 'BLOCKED'); zeroEffects(h.path);
});

test('M5.6 Alerts rendering escapes evidence and separates blocked opportunity from stock event', t => {
  const h = harness(t); h.store.restock.record(productReading(0, 'UNAVAILABLE'), PRODUCT_MONITOR_POLICY, R_NOW); h.store.restock.record(productReading(1000, 'PREORDER'), PRODUCT_MONITOR_POLICY, R_NOW + 1000);
  const html = renderToStaticMarkup(createElement(MonitoringAlerts, { alerts: view(h.store).alerts }));
  assert.match(html, /PREORDER OPENED/); assert.match(html, /2026-11-13/); assert.match(html, /BLOCKED.*INDETERMINATE/); assert.match(html, /SELLER UNKNOWN/); assert.match(html, /Not requested/);
  assert.doesNotMatch(html, /<script>|<button|<input/); assert.match(html, /&lt;script&gt;/);
});

test('M5.6 existing schema-v4 data and legacy events stay immutable without invented old evaluations', t => {
  const h = harness(t); const a = productReading(0, 'UNAVAILABLE'); h.store.restock.record(a, PRODUCT_MONITOR_POLICY, R_NOW); h.store.restock.record(productReading(1000, 'IMMEDIATE'), PRODUCT_MONITOR_POLICY, R_NOW + 1000);
  const db = new DatabaseSync(h.path); try { db.exec("UPDATE restock_events SET envelope=json_remove(envelope,'$.alert')"); } finally { db.close(); }
  h.store.close(); const s = h.open(); assert.equal(s.diagnostics().schemaVersion, 4); assert.equal(s.restock.getEvents(a.scope).length, 1);
  assert.equal(view(s).alerts.length, 0); assert.equal(s.restock.deliverPending(R_NOW + 2000).delivered, 1);
});

test('M5.6 alert/handoff source has no network, intent, cart or simulation dispatch authority', () => {
  for (const path of ['packages/application/src/monitoring-alert.ts', 'apps/desktop/src/renderer/components.tsx']) assert.doesNotMatch(readFileSync(path, 'utf8'), /\b(?:fetch|simulate|commitSimulatedDecision|addToCart|checkout|placeOrder|login)\s*\(/);
});

test('M5.6 authored BrowserProvider normalization enters monitor transaction and restart delivers alert', async t => {
  const h = harness(t); const url = 'https://www.amazon.com.mx/dp/B0H78BB9TY';
  const definition = monitorDefinition('amazon-alert-monitor', { name: 'AUTHORED', url, cadenceSeconds: 60 }, R_NOW);
  h.store.monitors.publishRevision(definition, null, R_NOW); const c = definition.configuration; assert.ok(isProductMonitor(c));
  for (let i = 0; i < 2; i++) {
    const at = R_NOW + i * 1000; const target = { asin: productRef.externalId, url, marketplace: 'MX' as const, deliveryScope: AMAZON_DELIVERY };
    const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return rendered({ target, capturedAt: at, captureId: `authored-alert-${i}`, asins: [target.asin], titles: ['AUTHORED'], sellers: [], sellerIds: [], prices: [], currencies: [], shippers: [], availability: [i ? 'Disponible' : 'No disponible'], actions: i ? ['Agregar al carrito'] : [] }); } });
    const result = await provider.read(target, { now: at, deadlineAt: at + 60000, currency: 'MXN', deliveryScope: AMAZON_DELIVERY, operationId: `authored-${i}`, traceId: 'authored' }); assert.ok('evidence' in result);
    const n = normalizeAmazon(result.evidence); const command = { monitorId: definition.monitorId, revision: 1, runId: `authored-${i}`, operationId: `authored-${i}`, traceId: 'authored', now: at };
    h.store.monitors.startRun(command);
    const input = amazonRestockInput(n, mapAmazonDomain(n, AMAZON_DELIVERY).observations, productMonitorScope(definition.monitorId, c), command.runId, at, true);
    h.store.productMonitoring.complete(command, input, at);
  }
  assert.equal(view(h.store).alerts[0]?.delivery, 'PENDING'); assert.equal(view(h.store).monitors[0]?.product?.baseline, 'AVAILABLE');
  h.store.close(); let calls = 0; const service = new DesktopService({ databasePath: h.path, now: () => R_NOW + 2000, newId: () => 'unused', networkEnabled: false, fixtureMode: false, read: async () => { calls++; throw new Error('NO_NETWORK'); } });
  service.start(); try { assert.equal(service.snapshot().alerts[0]?.delivery, 'DELIVERED'); assert.equal(service.snapshot().alerts.length, 1); assert.equal(calls, 0); zeroEffects(h.path); } finally { await service.stop(); }
});

test('M5.6 Shopify restock alert and Amazon alert remain independently scoped in one workspace', t => {
  const h = harness(t);
  for (let i = 0; i < 2; i++) {
    const capture = authoredCapture(false, R_NOW + i * 1000, { availableForSale: i === 1 }); const e = capture.normalized();
    // Explicit authored stock proof for this deterministic regression, not a claim about live Shopify quantity.
    const o = { ...e.observation, stock: known(i ? 'IN_STOCK' as const : 'OUT_OF_STOCK' as const, e.observation.stock.evidence) };
    const scope = { kind: 'OFFER' as const, watchId: 'shopify-alert-monitor', productRef: o.product.ref, offerRef: o.offer.ref, deliveryScope: o.offer.deliveryScope };
    const input: RestockInput = { id: `shopify-${i}`, mode: 'DRY_RUN', scope, observedAt: o.stock.evidence.sourceObservedAt, receivedAt: R_NOW + i * 1000 + 222, expiresAt: o.stock.evidence.expiresAt, status: 'OBSERVED', coverage: 'EXPLICIT_OFFER', observations: [o], provenance: { provider: 'SHOPIFY', reference: 'AUTHORED' } };
    const policy = { ...PRODUCT_MONITOR_POLICY, seller: { version: 'authored-shopify', mode: 'ALLOWLIST' as const, allow: [o.offer.sellerRef], deny: [], firstParty: [] } };
    h.store.restock.record(input, policy, input.receivedAt);
    h.store.restock.record(productReading(i * 1000, i ? 'IMMEDIATE' : 'UNAVAILABLE'), PRODUCT_MONITOR_POLICY, R_NOW + i * 1000);
  }
  const alerts = view(h.store).alerts; assert.equal(alerts.length, 2); assert.deepEqual(new Set(alerts.map(a => a.provider)), new Set(['SHOPIFY', 'BROWSER']));
  assert.equal(new Set(alerts.map(a => a.monitorId)).size, 2); assert.equal(new Set(alerts.map(a => a.eventId)).size, 2);
  assert.ok(alerts.every(a => a.eventType === 'RESTOCK_DETECTED' && a.opportunityStatus === 'BLOCKED'));
  zeroEffects(h.path);
});
