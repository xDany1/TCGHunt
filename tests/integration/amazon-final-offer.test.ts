import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { AmazonBrowserProvider, mapAmazonDomain, normalizeAmazon } from '@ptcg/adapters';
import type { AmazonRenderedCapture, AmazonProviderResult } from '@ptcg/adapters';
import type { DurableStore } from '@ptcg/infrastructure';
import { rendered } from '../fixtures/amazon-rendered.js';
import { pContext, pTarget } from '../fixtures/amazon-providers.js';
import { harness } from '../fixtures/durable.js';

const release = 'Este producto saldrá a la venta el 13 de noviembre de 2026. Cómpralo en preventa ya.';
const retail = (patch: Partial<AmazonRenderedCapture> = {}) => rendered({ actions: ['Comprar ahora'], sellerIds: [], sellers: ['Amazon México'], sellerStatements: ['Vendedor: Amazon México'], shippers: ['Amazon México'], shipperStatements: ['Remitente: Amazon México'], prices: ['$589.00'], currencies: ['MXN'], ...patch });
async function parse(c: AmazonRenderedCapture) {
  const result = await new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return c; } }).read(c.target, { ...pContext, deliveryScope: c.target.deliveryScope, now: c.capturedAt - 1, deadlineAt: c.capturedAt + 1000 });
  assert.ok('evidence' in result); return { result, n: normalizeAmazon(result.evidence) };
}
const runtime = await import(pathToFileURL(resolve('scripts/amazon-browser-runtime.mjs')).href) as { extractAmazonRendered: () => unknown; };
const node = (text: string, attrs: Record<string, string> = {}, label = '', value = '', hidden = false) => ({
  innerText: text, textContent: text, getAttribute: (k: string) => attrs[k] ?? null, getClientRects: () => hidden ? [] : [{}], closest: () => null,
  querySelectorAll: (s: string): unknown[] => s.includes('feature-name') ? label ? [node(label)] : [] : value ? [node(value)] : []
});
function extract(regions: ReturnType<typeof node>[], currency: 'META' | 'MICRODATA' | 'VISIBLE' | 'MISSING' | 'HIDDEN' = 'META') {
  const document = {
    body: { innerText: 'Authored product' }, querySelector: (s: string) => s.includes('#desktop_buybox') ? {} : null, querySelectorAll(s: string) {
      if (s.includes('input#ASIN')) return [node('', { value: pTarget.asin })];
      if (s.includes('#productTitle')) return [node('Authored product')];
      if (s.startsWith('meta[')) return currency === 'META' ? [node('', { content: 'MXN' })] : [];
      if (s.includes('priceCurrency') && s.includes('#corePriceDisplay')) return currency === 'MICRODATA' ? [node('MXN', { content: 'MXN' })] : currency === 'VISIBLE' || currency === 'HIDDEN' ? [node('$589.00 MXN', {}, '', '', currency === 'HIDDEN')] : [];
      if (s.includes('.a-price:not')) return [node('$589.00')];
      if (s.includes('#tabular-buybox')) return regions;
      if (s.includes('#availability')) return [node('Disponible')];
      return [];
    }
  };
  return JSON.parse(JSON.stringify(runInNewContext(`(${runtime.extractAmazonRendered.toString()})()`, { document, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), URL, location: { href: pTarget.url } }))) as Partial<AmazonRenderedCapture>;
}
for (const currency of ['META', 'MICRODATA', 'VISIBLE', 'MISSING', 'HIDDEN'] as const) test(`final currency extraction ${currency} never assumes dollar currency`, async () => {
  const p = extract([], currency); const { n } = await parse(rendered(p)); assert.equal(n.offers[0]?.price?.minor ?? null, currency === 'MISSING' || currency === 'HIDDEN' ? null : 58900n);
});
for (const text of ['$1,099.00', '$589.00', '$58,9.00', '$589.001']) test(`final exact amount ${text}`, async () => {
  const { n } = await parse(retail({ prices: [text] })); assert.equal(n.offers[0]?.price?.minor ?? null, text === '$1,099.00' ? 109900n : text === '$589.00' ? 58900n : null);
});
test('explicit seller role resolves stable Retail ID with raw name and independent shipper', async () => {
  const p = extract([node('Vendedor Amazon México', {}, 'Vendedor', 'Amazon México'), node('Remitente Amazon México', {}, 'Remitente', 'Amazon México')]);
  assert.deepEqual(p.sellerStatements, ['Vendedor: Amazon México']); assert.deepEqual(p.shipperStatements, ['Remitente: Amazon México']);
  const { n } = await parse(retail(p)); assert.equal(n.offers[0]?.sellerId, 'amazon-retail-mx'); assert.equal(n.offers[0]?.sellerDisplayName, 'Amazon México'); assert.equal(n.offers[0]?.sellerKind, 'AMAZON_RETAIL'); assert.equal(n.offers[0]?.fulfillment, 'AMAZON');
});
test('Retail ID is stable if a visible external ID appears on a later read', async () => {
  const a = await parse(retail()); const b = await parse(retail({ sellerIds: ['VISIBLEEXTERNAL'], capturedAt: retail().capturedAt + 1, captureId: 'later-retail' }));
  assert.equal(a.n.offers[0]?.sellerId, b.n.offers[0]?.sellerId); assert.deepEqual(mapAmazonDomain(a.n, pTarget.deliveryScope).observations[0]?.offer.ref, mapAmazonDomain(b.n, pTarget.deliveryScope).observations[0]?.offer.ref);
});
for (const [name, patch] of [
  ['shipper only', { sellers: [], sellerStatements: [] }],
  ['display only', { sellerStatements: [] }],
  ['third-party name', { sellers: ['Comercio'], sellerStatements: ['Vendedor: Comercio'] }],
  ['contradictory seller', { sellers: ['Comercio'] }],
  ['conflicting seller IDs', { sellerIds: ['ONE', 'TWO'] }],
  ['reserved ID without role proof', { sellerIds: ['amazon-retail-mx'], sellerStatements: [] }],
  ['Amazon-like seller name', { sellers: ['Amazon México Outlet'], sellerStatements: ['Vendedor: Amazon México Outlet'] }]
] as const) test(`${name} cannot synthesize Retail identity`, async () => {
  const { n } = await parse(retail(patch)); assert.equal(n.offers[0]?.sellerId, null); assert.equal(mapAmazonDomain(n, pTarget.deliveryScope).observations.length, 0);
});
test('Retail identity cannot cross marketplace host', async () => {
  const c = retail({ target: { ...pTarget, url: 'https://www.amazon.com/dp/' + pTarget.asin } }); const { n } = await parse(c); assert.equal(n.offers[0]?.sellerId, null);
});
test('combined Remitente/Vendedor block cannot be separated by duplicated name position', async () => {
  const p = extract([node('Remitente / Vendedor Amazon México Amazon México Remitente / Vendedor Amazon México', { id: 'merchantInfoFeature_feature_div' }, 'Remitente / Vendedor', 'Amazon México')]);
  assert.deepEqual(p.sellerStatements, []); assert.deepEqual(p.shipperStatements, []); assert.deepEqual(p.shippers, []);
  const { n } = await parse(rendered({ ...p, sellerIds: [] })); assert.equal(n.offers[0]?.sellerId, null); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN');
});
test('seller only never implies fulfillment', async () => {
  const { n } = await parse(retail({ shippers: [], shipperStatements: [] })); assert.equal(n.offers[0]?.sellerId, 'amazon-retail-mx'); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN');
});
test('independent third-party shipper is retained, not Amazon or seller identity', async () => {
  const p = extract([node('Remitente: Distribuidor independiente')]); const { n } = await parse(retail(p)); assert.deepEqual(p.shippers, ['Distribuidor independiente']); assert.equal(n.offers[0]?.fulfillment, 'UNKNOWN'); assert.deepEqual(n.renderedEvidence?.shipperDisplays, ['Distribuidor independiente']);
});
interface Summary { found: { seller: boolean; sellerDisplayFound: boolean; sellerStableIdentityResolved: boolean; priceTextFound: boolean; currencyResolved: boolean; }; offerPersisted: boolean; price: { minor: string; currency: string; } | null; baseline: string; restockEvents: string[]; sellerEvaluation: string; opportunity: string; intent?: string; mode: string; }
const workflow = await import(pathToFileURL(resolve('scripts/amazon-browser-workflow.mjs')).href) as {
  amazonValidationStatus(observations: { status: string; }[], expected: number): string;
  configureAmazonValidation(store: DurableStore, now: number): void;
  persistAmazonBrowserResult(store: DurableStore, result: AmazonProviderResult, now: number, sequence: number): Promise<{ summary: Summary; }>;
  verifyAmazonReopen(store: DurableStore, entries: readonly unknown[], now: number): Promise<{ replayIdempotent: boolean; }>;
};
test('final validation cannot hide an earlier incomplete offer behind a successful last target', () => {
  assert.equal(workflow.amazonValidationStatus([{ status: 'PASS' }, { status: 'PARTIAL' }, { status: 'PASS' }], 3), 'PARTIAL');
  assert.equal(workflow.amazonValidationStatus([{ status: 'PASS' }], 3), 'PARTIAL');
  assert.equal(workflow.amazonValidationStatus([{ status: 'CHALLENGE_DETECTED' }], 3), 'CHALLENGE_DETECTED');
  assert.equal(workflow.amazonValidationStatus([{ status: 'PASS' }, { status: 'PASS' }, { status: 'PASS' }], 3), 'PASS');
});
for (const mode of ['IMMEDIATE', 'PREORDER'] as const) test(`Retail ${mode} persists stable Offer and blocked evaluation across reopen/replay`, async t => {
  const c = retail(mode === 'PREORDER' ? { actions: ['Reserva ahora'], availability: [release], releaseTexts: [release] } : { prices: ['$1,099.00'] });
  const { result, n } = await parse(c); assert.equal(n.productState?.purchaseMode, mode); assert.equal(n.productState?.releaseDate, mode === 'PREORDER' ? '2026-11-13' : null);
  const h = harness(t); workflow.configureAmazonValidation(h.store, c.capturedAt); const e = await workflow.persistAmazonBrowserResult(h.store, result, c.capturedAt + 1, 0);
  assert.equal(e.summary.offerPersisted, true); assert.equal(e.summary.sellerEvaluation, 'REVIEW_REQUIRED'); assert.equal(e.summary.opportunity, 'INDETERMINATE'); assert.equal(e.summary.intent, 'BLOCKED'); assert.equal(e.summary.mode, 'DRY_RUN'); assert.equal(e.summary.baseline, 'AVAILABLE'); assert.deepEqual(e.summary.restockEvents, []);
  assert.equal(e.summary.price?.minor, mode === 'PREORDER' ? '58900' : '109900'); assert.equal(e.summary.found.sellerStableIdentityResolved, true); assert.equal(e.summary.found.currencyResolved, true);
  h.store.close(); assert.equal((await workflow.verifyAmazonReopen(h.open(), [e], c.capturedAt + 1000)).replayIdempotent, true);
  const db = new DatabaseSync(h.path, { readOnly: true }); try { assert.equal(db.prepare('SELECT count(*) AS n FROM offers').get()?.['n'], 1); assert.equal(db.prepare('SELECT count(*) AS n FROM restock_events').get()?.['n'], 0); assert.ok(Number(db.prepare('SELECT count(*) AS n FROM audit_events').get()?.['n']) > 0); } finally { db.close(); }
});
test('Offer can retain UNKNOWN money and fulfillment under unchanged identity invariants; diagnostics show what is missing', async t => {
  const c = retail({ currencies: [], shippers: [], shipperStatements: [] }); const { result } = await parse(c); const h = harness(t); workflow.configureAmazonValidation(h.store, c.capturedAt);
  const e = await workflow.persistAmazonBrowserResult(h.store, result, c.capturedAt + 1, 0); assert.equal(e.summary.offerPersisted, true); assert.equal(e.summary.found.priceTextFound, true); assert.equal(e.summary.found.currencyResolved, false); assert.equal(e.summary.price, null); assert.equal(e.summary.intent, 'BLOCKED');
});
const retained = JSON.parse(readFileSync(resolve('tests/fixtures/amazon-windows-v3.json'), 'utf8')) as { captures: AmazonRenderedCapture[]; };
for (const [i, c] of retained.captures.entries()) test(`real v3 ${c.target.asin} retains baseline and honest unresolved diagnostics`, async t => {
  const { result, n } = await parse(c); const h = harness(t); workflow.configureAmazonValidation(h.store, c.capturedAt); const e = await workflow.persistAmazonBrowserResult(h.store, result, c.capturedAt + 1, 0);
  assert.equal(e.summary.baseline, i === 0 ? 'UNAVAILABLE' : 'AVAILABLE'); assert.equal(e.summary.offerPersisted, false); assert.deepEqual(e.summary.restockEvents, []);
  assert.equal(e.summary.found.sellerDisplayFound, i > 0); assert.equal(e.summary.found.sellerStableIdentityResolved, false); assert.equal(e.summary.found.seller, false); assert.equal(e.summary.found.priceTextFound, i > 0); assert.equal(e.summary.found.currencyResolved, false);
  assert.equal(n.productState?.purchaseMode, i === 0 ? 'UNKNOWN' : i === 1 ? 'PREORDER' : 'IMMEDIATE'); assert.equal(n.productState?.releaseDate, i === 1 ? '2026-11-13' : null);
  h.store.close(); assert.equal((await workflow.verifyAmazonReopen(h.open(), [e], c.capturedAt + 1000)).replayIdempotent, true);
});
