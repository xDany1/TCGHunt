import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { known, unknown } from '@ptcg/core';
import { AmazonBrowserProvider, amazonCommerce, normalizeAmazon, mapAmazonDomain, amazonRestockInput, FakeStoreAdapter } from '@ptcg/adapters';
import type { AmazonProviderResult, AmazonRenderedCapture } from '@ptcg/adapters';
import { evaluateSimulation, restockSample, transitionRestock } from '@ptcg/application';
import type { RestockPolicy, RestockScope } from '@ptcg/application';
import type { DurableStore } from '@ptcg/infrastructure';
import { rendered } from '../fixtures/amazon-rendered.js';
import { P_NOW, pTarget, pContext } from '../fixtures/amazon-providers.js';
import { harness } from '../fixtures/durable.js';
import { restockFixture } from '../fixtures/restock.js';
import { fixture } from '../fixtures/scenarios.js';

const release = 'Este producto saldrá a la venta el 13 de noviembre de 2026.';
for (const [availability, actions, expected, mode] of [
  [[release], ['Reserva ahora'], 'AVAILABLE', 'PREORDER'], [['Disponible'], ['Comprar ahora'], 'AVAILABLE', 'IMMEDIATE'],
  [['No disponible por el momento.', release], ['Reserva ahora'], 'UNAVAILABLE', 'PREORDER'], [['No disponible por el momento.'], [], 'UNAVAILABLE', 'UNKNOWN'],
  [[], ['Reserva ahora'], 'UNKNOWN', 'PREORDER'], [[release], [], 'UNKNOWN', 'PREORDER'], [[], [], 'UNKNOWN', 'UNKNOWN'],
  [['Disponible'], ['Reserva ahora', 'Comprar ahora'], 'AVAILABLE', 'UNKNOWN'], [['Disponible', 'No disponible por el momento.'], [], 'UNKNOWN', 'UNKNOWN']
] as const) test(`commerce ${JSON.stringify(availability)} / ${JSON.stringify(actions)}`, () => {
  const state = amazonCommerce(availability, actions, []); assert.equal(state.availability, expected); assert.equal(state.purchaseMode, mode);
});
test('Spanish release date is exact and retains raw evidence', () => {
  const r = amazonCommerce([release], ['Reserva ahora'], [release]); assert.equal(r.releaseDate, '2026-11-13'); assert.deepEqual(r.rawRelease, [release]);
});
for (const date of ['31 de febrero de 2026', '29 de febrero de 2027', '0 de enero de 2026', '13 de desconocido de 2026', '13/11/2026']) test(`malformed release date ${date} stays UNKNOWN`, () => {
  assert.equal(amazonCommerce([`Este producto saldrá a la venta el ${date}.`], ['Reserva ahora'], []).releaseDate, null);
});
test('conflicting release dates do not select one', () => {
  assert.equal(amazonCommerce([release, release.replace('13', '14')], [], []).releaseDate, null);
});
async function sample(at: number, availability: readonly string[], actions: readonly string[], sellers: readonly string[] = []) {
  const capture = rendered({ capturedAt: at, captureId: `three-state-${at}`, actions, releaseTexts: [], availability, sellerIds: sellers });
  const result = await new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return capture; } }).read(pTarget, { ...pContext, now: at - 1, deadlineAt: at + 1000 });
  assert.ok('evidence' in result); const n = normalizeAmazon(result.evidence); const mapped = mapAmazonDomain(n, pTarget.deliveryScope);
  const scope: RestockScope = { watchId: 'three-state', kind: 'PRODUCT', productRef: mapped.productRef, deliveryScope: pTarget.deliveryScope };
  const input = amazonRestockInput(n, mapped.observations, scope, `three-${at}`, at + 1);
  return { input, scope, mapped, result };
}
const policy: RestockPolicy = restockFixture().policy;
for (const [firstAvailability, firstActions, nextAvailability, nextActions, event] of [
  [['No disponible por el momento.'], [], [release], ['Reserva ahora'], 'PREORDER_OPENED'],
  [['No disponible por el momento.'], [], ['Disponible'], ['Comprar ahora'], 'RESTOCK_DETECTED'],
  [[release], ['Reserva ahora'], ['Disponible'], ['Comprar ahora'], 'PURCHASE_MODE_CHANGED'],
  [[release], ['Reserva ahora'], ['No disponible por el momento.', release], [], 'PREORDER_CLOSED'],
  [[release], ['Reserva ahora'], [release], ['Reserva ahora'], null]
] as const) test(`product state transition ${event ?? 'unchanged'} persists without offers and replays`, async t => {
  const h = harness(t); const a = await sample(P_NOW, firstAvailability, firstActions); const b = await sample(P_NOW + 1000, nextAvailability, nextActions);
  const initial = h.store.restock.record(a.input, policy, P_NOW + 1); assert.equal(initial.outcome, 'INITIALIZED'); assert.deepEqual(initial.events, []);
  assert.equal(a.mapped.observations.length, 0); const next = h.store.restock.record(b.input, policy, P_NOW + 1001);
  assert.deepEqual(next.events.map(e => e.type), event ? [event] : []);
  h.store.close(); const reopened = h.open(); assert.equal(reopened.restock.getState(a.scope)?.baseline?.productObservation?.title, 'Authored product');
  assert.equal(reopened.restock.record(b.input, policy, P_NOW + 2000).outcome, 'DUPLICATE');
  assert.equal(reopened.restock.deliverPending(P_NOW + 2000).delivered, event ? 1 : 0); assert.equal(reopened.restock.deliverPending(P_NOW + 2001).delivered, 0);
  const db = new DatabaseSync(h.path); try { for (const table of ['offers', 'sellers', 'listing_observations', 'purchase_intents']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0); } finally { db.close(); }
});
test('unknown, failure and stale product observations never create false absence or events', async () => {
  const a = await sample(P_NOW, ['Disponible'], ['Comprar ahora']); const base = transitionRestock(null, restockSample(a.input, policy, P_NOW + 1), a.scope, P_NOW + 1);
  const b = await sample(P_NOW + 1000, [], ['Reserva ahora']);
  for (const input of [b.input, { ...b.input, status: 'OBSERVATION_FAILED' as const }]) {
    const r = transitionRestock(base.state, restockSample(input, policy, P_NOW + 1001), b.scope, P_NOW + 1001); assert.equal(r.outcome, 'INCOMPLETE'); assert.deepEqual(r.events, []); assert.equal(r.state.baseline?.availability, 'AVAILABLE');
  }
  const stale = restockSample(a.input, policy, P_NOW + 70000); assert.equal(stale.comparable, false);
});
test('product evidence cannot cross scope or manufacture complete inventory coverage', async () => {
  const a = await sample(P_NOW, ['No disponible por el momento.'], []); assert.equal(a.input.coverage, 'PRODUCT_PAGE');
  assert.throws(() => restockSample({ ...a.input, coverage: 'COMPLETE_SCOPE' }, policy, P_NOW + 1));
  const product = a.input.productObservation; assert.ok(product);
  assert.throws(() => restockSample({ ...a.input, productObservation: { ...product, productRef: { ...a.scope.productRef, externalId: 'other' } } }, policy, P_NOW + 1));
});
test('seller-specific offer remains conditional on stable seller ID with independent mode evidence', async () => {
  const a = await sample(P_NOW, [release], ['Reserva ahora'], ['AUTHOREDSELLER']); assert.equal(a.mapped.observations.length, 1);
  assert.deepEqual(a.mapped.observations[0]?.purchaseMode?.state, 'KNOWN'); assert.equal(a.input.productObservation?.purchaseMode.state, 'KNOWN');
  assert.equal(a.mapped.observations[0]?.stock.state, 'KNOWN');
});
test('preorder and unknown purchase mode cannot pass the existing immediate DRY_RUN admission', async () => {
  const f = fixture();
  for (const mode of [known('PREORDER' as const, f.observation.stock.evidence), unknown<'IMMEDIATE' | 'PREORDER'>('NOT_OBSERVED', f.observation.stock.evidence)]) {
    const r = await evaluateSimulation(new FakeStoreAdapter([{ ...f.observation, purchaseMode: mode }]), f.request);
    assert.equal(r.status, 'EVALUATED'); if (r.status === 'EVALUATED') assert.equal(r.simulation.intentState, 'BLOCKED');
  }
});

const workflow = await import(pathToFileURL(resolve('scripts/amazon-browser-workflow.mjs')).href) as {
  configureAmazonValidation(store: DurableStore, now: number): void;
  persistAmazonBrowserResult(store: DurableStore, result: AmazonProviderResult, now: number, sequence: number): Promise<{ summary: { persisted: boolean; productPersisted: boolean; offerPersisted: boolean; baseline: string | null; purchaseMode: string; opportunity: string; }; }>;
  verifyAmazonReopen(store: DurableStore, entries: readonly unknown[], now: number): Promise<unknown>;
};
for (const [availability, actions, sellers] of [
  [['No disponible por el momento.'], [], []], [[release], ['Reserva ahora'], []], [['Disponible'], ['Comprar ahora'], ['AUTHOREDSELLER']]
] as const) test(`three-state host persistence ${availability[0]}`, async t => {
  const h = harness(t); workflow.configureAmazonValidation(h.store, P_NOW);
  const r = await sample(P_NOW, availability, actions, sellers); const entry = await workflow.persistAmazonBrowserResult(h.store, r.result, P_NOW + 1, 0);
  assert.equal(entry.summary.productPersisted, true); assert.equal(entry.summary.persisted, true); assert.equal(entry.summary.offerPersisted, sellers.length > 0);
  assert.equal(entry.summary.baseline, availability[0] === 'No disponible por el momento.' ? 'UNAVAILABLE' : 'AVAILABLE');
  h.store.close(); await workflow.verifyAmazonReopen(h.open(), [entry], P_NOW + 100);
});

const hostPolicy = await import(pathToFileURL(resolve('scripts/amazon-browser-policy.mjs')).href) as {
  amazonBrowserConfig(env: object, urls: string[]): { readsPerProduct: number; targets: { asin: string; canonical: string; }[]; };
  AmazonNavigationBudget: new (config: object) => { registerStyles(html: string, from: string): void; allowRequest(url: string, method: string, type: string, main: boolean, target: object): boolean; };
};
test('correction permits exactly three supplied targets with one initial read each', () => {
  const c = hostPolicy.amazonBrowserConfig({ AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: '1' }, ['B0H78BB9TY', 'B0HG3C5JK6', 'B0GYVHLP4L'].map(a => `https://www.amazon.com.mx/dp/${a}`)); assert.equal(c.readsPerProduct, 1);
});
test('only document-linked CSS is allowed; scripts, XHR, tracking and unrelated hosts stay blocked', () => {
  const c = hostPolicy.amazonBrowserConfig({ AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: '1' }, [pTarget.url]); const b = new hostPolicy.AmazonNavigationBudget(c); const target = c.targets[0]; assert.ok(target);
  const css = 'https://m.media-amazon.com/images/I/authored.css';
  assert.equal(b.allowRequest(css, 'GET', 'stylesheet', false, target), false);
  b.registerStyles(`<link rel="stylesheet" href="${css}"><link rel="stylesheet" href="https://evil.test/a.css">`, pTarget.url);
  assert.equal(b.allowRequest(css, 'GET', 'stylesheet', false, target), true);
  for (const type of ['script', 'xhr', 'fetch', 'image']) assert.equal(b.allowRequest(css, 'GET', type, false, target), false);
  assert.equal(b.allowRequest(css, 'POST', 'stylesheet', false, target), false);
  assert.equal(b.allowRequest('https://evil.test/a.css', 'GET', 'stylesheet', false, target), false);
  assert.equal(b.allowRequest('https://m.media-amazon.com/images/I/unlinked.css', 'GET', 'stylesheet', false, target), false);
});

const runtime = await import(pathToFileURL(resolve('scripts/amazon-browser-runtime.mjs')).href) as { extractAmazonRendered: () => unknown; };
for (const disabled of [false, true]) test(`read-only DOM boundary extracts preorder controls, disabled=${disabled}`, async () => {
  // Authored DOM boundary double, not a claim of full browser layout compatibility.
  const node = (textContent: string, attrs: Record<string, string> = {}, inactive = false) => ({ textContent, value: attrs['value'], disabled: inactive, getAttribute: (k: string) => attrs[k] ?? null, getClientRects: () => [{}], closest: () => inactive ? {} : null });
  const queries: string[] = [];
  const document = {
    body: { innerText: `Authored product ${release}` },
    querySelector: (s: string) => s.includes('#desktop_buybox') ? {} : null,
    querySelectorAll(s: string) {
      queries.push(s);
      if (s.includes('input#ASIN')) return [node('', { value: pTarget.asin })];
      if (s.includes('#productTitle')) return [node('Authored product')];
      if (s.includes('.a-price:not(.a-text-price)')) return [node('MX$95.00')];
      if (s.includes('priceCurrency')) return [node('', { content: 'MXN' })];
      if (s.includes('input[type="submit"]')) return [node('Reserva ahora', {}, disabled)];
      if (s.includes('sellerProfileTriggerId[href]')) return [node('Comercio fixture', { href: '/sp?seller=AUTHOREDSELLER' })];
      if (s === '#sellerProfileTriggerId') return [node('Comercio fixture')];
      if (s.includes('#tabular-buybox')) return [node('Vendido por Comercio fixture'), node('Enviado por Amazon')];
      if (s.includes('#availability')) return [node(release)];
      return [];
    }
  };
  const projection = JSON.parse(JSON.stringify(runInNewContext(`(${runtime.extractAmazonRendered.toString()})()`, { document, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), URL, location: { href: pTarget.url } }))) as Partial<AmazonRenderedCapture>;
  assert.deepEqual(projection.actions, disabled ? [] : ['Reserva ahora']); assert.ok(queries.some(s => s.includes(':not(.a-text-price)')));
  const capture = rendered({ ...projection, actions: projection.actions ?? [] });
  const r = await new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return capture; } }).read(pTarget, pContext);
  assert.ok('evidence' in r); const n = normalizeAmazon(r.evidence);
  assert.equal(n.productState?.purchaseMode, 'PREORDER'); assert.equal(n.productState?.availability, disabled ? 'UNKNOWN' : 'AVAILABLE');
  assert.equal(n.productState?.releaseDate, '2026-11-13'); assert.equal(n.offers[0]?.sellerId, 'AUTHOREDSELLER'); assert.equal(n.offers[0]?.fulfillment, 'AMAZON'); assert.equal(n.offers[0]?.price?.minor, 9500n);
});
