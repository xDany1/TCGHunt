import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { AmazonBrowserProvider, amazonCommerce, mapAmazonDomain, normalizeAmazon } from '@ptcg/adapters';
import type { AmazonRenderedCapture, AmazonProviderResult } from '@ptcg/adapters';
import type { DurableStore } from '@ptcg/infrastructure';
import { DatabaseSync } from 'node:sqlite';
import { rendered } from '../fixtures/amazon-rendered.js';
import { pTarget, pContext } from '../fixtures/amazon-providers.js';
import { harness } from '../fixtures/durable.js';

const retained = JSON.parse(readFileSync(resolve('tests/fixtures/amazon-windows-three-state.json'), 'utf8')) as { captures: AmazonRenderedCapture[]; };
const release = 'Este producto saldrá a la venta el 13 de noviembre de 2026.';
async function parse(c: AmazonRenderedCapture) {
  const r = await new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return c; } }).read(c.target, { ...pContext, deliveryScope: c.target.deliveryScope, now: c.capturedAt - 1, deadlineAt: c.capturedAt + 1000 });
  assert.ok('evidence' in r); return { result: r, normalized: normalizeAmazon(r.evidence) };
}
for (const c of retained.captures) test(`real Windows projection ${c.target.asin} reparse preserves unknown currency and seller`, async () => {
  const { normalized: n } = await parse(c); const preorder = c.target.asin === 'B0HG3C5JK6'; const unavailable = c.target.asin === 'B0H78BB9TY';
  assert.equal(n.productState?.availability, unavailable ? 'UNAVAILABLE' : 'AVAILABLE');
  assert.equal(n.productState?.purchaseMode, unavailable ? 'UNKNOWN' : preorder ? 'PREORDER' : 'IMMEDIATE');
  assert.equal(n.productState?.releaseDate, preorder ? '2026-11-13' : null);
  assert.equal(n.title, c.titles[0]); assert.equal(n.offers[0]?.price, null); assert.equal(n.offers[0]?.sellerId, null); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN');
  assert.equal(mapAmazonDomain(n, c.target.deliveryScope).observations.length, 0);
});
for (const [price, minor] of [['$589.00', 58900n], ['$1,099.00', 109900n]] as const) {
  test(`integer money ${price} with explicit MXN`, async () => {
    const { normalized: n } = await parse(rendered({ prices: [price], currencies: ['MXN'] })); assert.equal(n.offers[0]?.price?.minor, minor); assert.equal(n.offers[0]?.price?.currency, 'MXN');
  });
  for (const currencies of [[], ['USD'], ['MXN', 'USD']]) test(`money ${price} remains unknown with currency ${currencies}`, async () => {
    const { normalized: n } = await parse(rendered({ prices: [price], currencies })); assert.equal(n.offers[0]?.price, null);
  });
}
for (const text of [release + ' Cómpralo en preventa ya.', (release + ' Cómpralo en preventa ya.').normalize('NFD'), release.replaceAll(' ', '\u00a0') + ' Cómpralo en preventa ya.']) test(`release clause tolerates trailing sentence and canonical Unicode ${JSON.stringify(text)}`, () => {
  const s = amazonCommerce([text], ['Reserva ahora'], [text]); assert.equal(s.releaseDate, '2026-11-13'); assert.equal(s.availability, 'AVAILABLE'); assert.equal(s.purchaseMode, 'PREORDER'); assert.deepEqual(s.rawRelease, [text]);
});
for (const text of [release.replace('13 de noviembre', '31 de febrero') + ' Cómpralo ya.', release.replace('saldrá', 'saldrÃ¡'), release + ' ' + release.replace('13', '14')]) test(`invalid or contradictory release is not guessed ${text}`, () => {
  const s = amazonCommerce([text], ['Reserva ahora'], [text]); assert.equal(s.releaseDate, null); assert.equal(s.availability, 'UNKNOWN');
});
test('explicit unavailable evidence overrides a valid open preorder clause', () => {
  const s = amazonCommerce(['No disponible por el momento.', release], ['Reserva ahora'], [release + ' Cómpralo ya.']); assert.equal(s.availability, 'UNAVAILABLE'); assert.equal(s.releaseDate, '2026-11-13');
});

const runtime = await import(pathToFileURL(resolve('scripts/amazon-browser-runtime.mjs')).href) as { extractAmazonRendered: () => unknown; };
// Authored semantic DOM doubles; retained live captures do not contain full DOM or these fields.
const node = (text: string, attributes: Record<string, string> = {}, children: unknown[] = [], hidden = false) => ({
  textContent: text, innerText: text, disabled: false, getAttribute: (k: string) => attributes[k] ?? null,
  querySelectorAll: () => children, getClientRects: () => hidden ? [] : [{}], closest: () => null
});
function extract(options: { regions?: ReturnType<typeof node>[]; links?: ReturnType<typeof node>[]; meta?: string[]; structured?: string; } = {}) {
  const document = {
    body: { innerText: 'Authored page, no challenge' }, querySelector: (s: string) => s.includes('#desktop_buybox') ? {} : null,
    querySelectorAll(s: string) {
      if (s.includes('input#ASIN')) return [node('', { value: pTarget.asin })];
      if (s.includes('#productTitle')) return [node('Authored product')];
      if (s.includes('.a-price:not(.a-text-price)')) return [node('$589.00')];
      if (s.startsWith('meta[')) return (options.meta ?? []).map(m => node('', { content: m }));
      if (s.includes('application/ld+json')) return options.structured ? [node(options.structured)] : [];
      if (s.includes('sellerProfileTriggerId[href]')) return options.links ?? [];
      if (s.includes('#tabular-buybox')) return options.regions ?? [];
      if (s.includes('#availability')) return [node('Disponible')];
      return [];
    }
  };
  return JSON.parse(JSON.stringify(runInNewContext(`(${runtime.extractAmazonRendered.toString()})()`, { document, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), URL, location: { href: pTarget.url } }))) as Partial<AmazonRenderedCapture>;
}
test('semantic feature values and visible merchant link distinguish third-party seller from Amazon fulfillment', async () => {
  const projection = extract({
    meta: ['MXN'], links: [node('Comercio fixture', { href: '/sp?seller=AUTHOREDSELLER' })], regions: [
      node('Vendido por Comercio fixture', { id: 'merchantInfoFeature_feature_div' }, [node('Comercio fixture')]),
      node('Amazon', { id: 'fulfillerInfoFeature_feature_div', 'aria-label': 'Enviado desde' }, [node('Amazon')])
    ]
  });
  const { normalized: n } = await parse(rendered(projection)); assert.equal(n.offers[0]?.sellerId, 'AUTHOREDSELLER'); assert.equal(n.offers[0]?.sellerDisplayName, 'Comercio fixture'); assert.equal(n.offers[0]?.fulfillment, 'AMAZON'); assert.equal(n.offers[0]?.price?.minor, 58900n); assert.equal(mapAmazonDomain(n, pTarget.deliveryScope).observations.length, 1);
});
test('Amazon name and fulfillment with no stable seller ID never manufacture an Offer', async () => {
  const p = extract({ regions: [node('Amazon', { id: 'merchantInfoFeature_feature_div' }), node('Amazon', { id: 'fulfillerInfoFeature_feature_div' })] });
  const { normalized: n } = await parse(rendered(p)); assert.deepEqual(p.sellers, ['Amazon']); assert.equal(n.offers[0]?.sellerId, null); assert.equal(n.offers[0]?.fulfillment, 'AMAZON'); assert.equal(mapAmazonDomain(n, pTarget.deliveryScope).observations.length, 0);
});
test('mixed rows and hidden values/links are not seller or fulfillment proof', () => {
  const p = extract({ links: [node('Hidden', { href: '/sp?seller=HIDDEN' }, [], true)], regions: [node('Enviado por Amazon Vendido por Otro'), node('Hidden', { id: 'merchantInfoFeature_feature_div' }, [], true)] });
  assert.deepEqual(p.sellers, []); assert.deepEqual(p.shippers, []); assert.deepEqual(p.sellerIds, []); assert.deepEqual(p.offerTexts, ['Enviado por Amazon Vendido por Otro']);
});
test('contradictory semantic roles never infer seller from shipment or shipment from seller', () => {
  const p = extract({ regions: [node('Enviado por Amazon', { id: 'merchantInfoFeature_feature_div' }), node('Vendido por Comercio', { id: 'fulfillerInfoFeature_feature_div' })] });
  assert.deepEqual(p.sellers, []); assert.deepEqual(p.shippers, []);
});
const metadata = (asin: string, price: string | number, currency: string, type = 'Offer') => JSON.stringify({ '@type': 'Product', sku: asin, offers: { '@type': type, price, priceCurrency: currency } });
test('ASIN- and displayed-price-bound standard metadata supplies currency only', async () => {
  const p = extract({ structured: metadata(pTarget.asin, '589.00', 'MXN') }); const { normalized: n } = await parse(rendered(p)); assert.deepEqual(p.currencies, ['MXN']); assert.equal(n.offers[0]?.price?.minor, 58900n); assert.deepEqual(p.sellerIds, []);
});
for (const structured of [metadata('B0OTHER001', '589.00', 'MXN'), metadata(pTarget.asin, '590.00', 'MXN'), metadata(pTarget.asin, 589, 'MXN'), metadata(pTarget.asin, '589.00', 'MXN', 'AggregateOffer'), '{invalid']) test(`unbound or invalid metadata does not prove currency ${structured}`, () => {
  assert.deepEqual(extract({ structured }).currencies, []);
});
test('conflicting legitimate currency sources remain unknown', async () => {
  const { normalized: n } = await parse(rendered(extract({ meta: ['USD'], structured: metadata(pTarget.asin, '589.00', 'MXN') }))); assert.equal(n.offers[0]?.price, null);
});

const workflow = await import(pathToFileURL(resolve('scripts/amazon-browser-workflow.mjs')).href) as {
  configureAmazonValidation(store: DurableStore, now: number): void;
  persistAmazonBrowserResult(store: DurableStore, result: AmazonProviderResult, now: number, sequence: number): Promise<{ summary: { baseline: string; restockEvents: unknown[]; offerPersisted: boolean; opportunity: string; }; }>;
  verifyAmazonReopen(store: DurableStore, entries: readonly unknown[], now: number): Promise<{ replayIdempotent: boolean; }>;
};
test('all three retained captures create durable baselines without Offers, evaluations or events and replay after reopen', async t => {
  const h = harness(t); const at = retained.captures[0]?.capturedAt; assert.ok(at); workflow.configureAmazonValidation(h.store, at); const entries = [];
  for (const [i, c] of retained.captures.entries()) {
    const { result } = await parse(c); const e = await workflow.persistAmazonBrowserResult(h.store, result, c.capturedAt + 1, i); entries.push(e);
    assert.equal(e.summary.baseline, i === 0 ? 'UNAVAILABLE' : 'AVAILABLE'); assert.equal(e.summary.offerPersisted, false); assert.deepEqual(e.summary.restockEvents, []); assert.equal(e.summary.opportunity, 'NOT_EVALUATED');
  }
  h.store.close(); const reopened = h.open(); assert.equal((await workflow.verifyAmazonReopen(reopened, entries, at + 10000)).replayIdempotent, true);
  const db = new DatabaseSync(h.path, { readOnly: true }); try {
    for (const table of ['restock_samples', 'restock_scopes']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 3);
    for (const table of ['offers', 'sellers', 'listing_observations', 'purchase_intents', 'decision_evaluations', 'restock_events', 'restock_outbox']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0);
  } finally { db.close(); }
});
