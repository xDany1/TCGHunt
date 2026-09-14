import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

interface Meta { url: string; method: string; resourceType: string; status: number; contentType: string; declaredBytes: number | null; observedAt: number; }
interface Evidence { availabilityEvidence: string; sanitizedMatchedFields: unknown[]; inspected: boolean; asinRelationship: string; classification: string;[key: string]: unknown; }
const evidence = await import(pathToFileURL(resolve('scripts/amazon-passive-evidence.mjs')).href) as {
  PASSIVE_BODY_CAP: number; passiveMetadata(meta: Meta): object | null; passiveBodyAllowed(meta: Meta): boolean;
  inspectPassiveBody(meta: Meta, body: string, asin: string): Evidence | null;
  reconcilePassive(input: object): { restockCandidate: { id: string; actionable: false; } | null; actionable: false; restockConfirmed: false; mode: string; evidenceConflict: boolean; availability: string; candidateDuplicate: boolean; availabilityBeforeVisibleUi: string; };
};
const host = await import(pathToFileURL(resolve('scripts/amazon-passive-runtime.mjs')).href) as {
  passiveConfig(env: object): { targets: { asin: string; canonical: string; }[]; };
  PassiveRequestBudget: new (target: object) => { allow(url: string, method: string, type: string, main: boolean): boolean; };
  capturePassivePage(browser: object, target: object, clock: object): Promise<{ responses: Evidence[]; topLevelNavigationCount: number; stop: string | null; }>;
};
const asin = 'B0H78BB9TY'; const target = { asin, canonical: `https://www.amazon.com.mx/dp/${asin}` };
const meta: Meta = { url: 'https://www.amazon.com.mx/private/session-secret/offer?token=secret#secret', method: 'GET', resourceType: 'xhr', status: 200, contentType: 'application/json; charset=utf-8', declaredBytes: 200, observedAt: 1000 };
const body = JSON.stringify({ asin, availability: 'AVAILABLE', price: '589.00', currency: 'MXN', seller: 'Amazon México', shipsFrom: 'Amazon México' });
test('recon opt-in disabled before browser or network setup', () => {
  for (const flag of [undefined, '0', 'true']) assert.throws(() => host.passiveConfig({ AMAZON_PASSIVE_RECON_ENABLED: flag }), /PASSIVE_DISABLED/);
  assert.deepEqual(host.passiveConfig({ AMAZON_PASSIVE_RECON_ENABLED: '1' }).targets.map(t => t.asin), ['B0H78BB9TY', 'B0HG3C5JK6', 'B0GYVHLP4L']);
  const r = spawnSync(process.execPath, ['scripts/amazon-passive-recon.mjs'], { env: { ...process.env, AMAZON_PASSIVE_RECON_ENABLED: '' }, encoding: 'utf8' }); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).navigations, 0);
});
for (const type of ['image', 'font', 'script', 'stylesheet', 'websocket']) test(`passive bodies exclude ${type}`, () => assert.equal(evidence.passiveMetadata({ ...meta, resourceType: type }), null));
for (const patch of [{ declaredBytes: null }, { declaredBytes: 262145 }, { contentType: 'application/octet-stream' }, { status: 403 }, { method: 'POST' }, { url: 'https://amazon.com.mx.evil.test/a' }]) test(`passive body gate ${JSON.stringify(patch)}`, () => assert.equal(evidence.passiveBodyAllowed({ ...meta, ...patch }), false));
test('decoded body beyond cap is not inspected even if declared length is small', () => assert.equal(evidence.inspectPassiveBody(meta, ' '.repeat(evidence.PASSIVE_BODY_CAP + 1), asin)?.inspected, false));
test('sanitization is an allowlist projection with no secrets, queries, customer fields or arbitrary seller text', () => {
  const r = evidence.inspectPassiveBody(meta, JSON.stringify({ asin, availability: 'AVAILABLE', customerId: 'secret', address: { asin, price: '999.00' }, csrfToken: 'secret', signedRequest: 'secret', seller: 'Private Personal Name', merchantId: 'opaque-secret', offers: [{ asin, available: true, sessionId: 'secret' }] }), asin);
  const serialized = JSON.stringify(r); for (const secret of ['secret', 'Private Personal Name', 'customerId', 'csrfToken', '?token', '999.00']) assert.equal(serialized.includes(secret), false);
  assert.equal(r?.availabilityEvidence, 'AVAILABLE'); assert.equal(r?.classification, 'PRIVATE_PAGE_LOAD_SIGNAL');
});
test('relevant scoped fields survive without promoting private signal to official contract', () => {
  const r = evidence.inspectPassiveBody(meta, body, asin); assert.ok(r); assert.equal(r.asinRelationship, 'EXPLICIT_SAME_OBJECT'); assert.equal(r.availabilityEvidence, 'AVAILABLE'); assert.deepEqual(r['currencyEvidence'], ['MXN']); assert.deepEqual(r['priceEvidence'], ['589.00']);
});
test('unbound neighboring product or nested offer is not target availability evidence', () => {
  for (const data of [{ asin: 'B0OTHER001', available: true }, { asin, offers: [{ available: true }] }]) assert.equal(evidence.inspectPassiveBody(meta, JSON.stringify(data), asin)?.availabilityEvidence, 'UNKNOWN');
});
test('unknown text bodies are not archived or interpreted as field contracts', () => {
  const r = evidence.inspectPassiveBody({ ...meta, contentType: 'text/html' }, '<p>secret AVAILABLE</p>', asin); assert.equal(r?.inspected, false); assert.equal(JSON.stringify(r).includes('secret'), false);
});
const response = () => evidence.inspectPassiveBody(meta, body, asin);
const ui = { availability: 'UNKNOWN', observedAt: 1100 };
test('available network plus unknown UI and prior unavailable baseline is only an idempotent non-actionable candidate', () => {
  const input = { asin, responses: [response()], ui, prior: { availability: 'UNAVAILABLE', reference: 'durable-sample-1' } };
  const a = evidence.reconcilePassive(input); assert.ok(a.restockCandidate); assert.equal(a.actionable, false); assert.equal(a.restockConfirmed, false); assert.equal(a.mode, 'DRY_RUN'); assert.equal(a.availabilityBeforeVisibleUi, 'NOT_ESTABLISHED');
  const b = evidence.reconcilePassive({ ...input, seen: [a.restockCandidate.id] }); assert.equal(b.restockCandidate, null); assert.equal(b.candidateDuplicate, true);
});
test('first network observation cannot fabricate a restock candidate', () => assert.equal(evidence.reconcilePassive({ asin, responses: [response()], ui }).restockCandidate, null));
test('a later UI snapshot cannot erase earlier sampled UI availability', () => {
  const r = evidence.reconcilePassive({ asin, responses: [response()], ui: { availability: 'AVAILABLE', observedAt: 1200, firstKnownAt: 900 } });
  assert.equal((r as unknown as { earliestAvailabilitySource: string; }).earliestAvailabilitySource, 'RENDERED_UI_FIRST_SAMPLED');
});
test('explicit network/UI conflict is UNKNOWN, never actionable or confirmed', () => {
  const r = evidence.reconcilePassive({ asin, responses: [response()], ui: { ...ui, availability: 'UNAVAILABLE' } }); assert.equal(r.evidenceConflict, true); assert.equal(r.availability, 'UNKNOWN'); assert.equal(r.actionable, false); assert.equal(r.restockConfirmed, false);
});
test('absent network leaves existing UI evidence intact', () => assert.equal(evidence.reconcilePassive({ asin, responses: [], ui: { ...ui, availability: 'UNAVAILABLE' } }).availability, 'UNAVAILABLE'));
test('budget limits natural requests and rejects mutation methods, unrelated hosts/products and assets', () => {
  const b = new host.PassiveRequestBudget(target);
  for (const [url, method, type, main] of [[target.canonical, 'POST', 'document', true], ['https://www.amazon.com.mx/cart', 'GET', 'xhr', true], ['https://www.amazon.com.mx/ap/signin', 'GET', 'document', true], ['https://evil.test/a', 'GET', 'fetch', true], ['https://www.amazon.com.mx/dp/B0OTHER001', 'GET', 'document', true]] as const) assert.equal(b.allow(url, method, type, main), false);
  // Latest diagnostic specification explicitly enables natural main-page XHR.
  assert.equal(b.allow(meta.url, 'GET', 'xhr', true), true); assert.equal(b.allow(target.canonical, 'GET', 'document', true), true);
});
test('response event observer does not replay; one navigation and context cleanup with naturally emitted fake response', async () => {
  let listener: ((value: object) => void) | undefined; let gotos = 0; let closes = 0; let reads = 0; const order: string[] = [];
  const request = { resourceType: () => 'xhr', method: () => 'GET' };
  const response = { request: () => request, url: () => meta.url, status: () => 200, headerValue: async (name: string) => name === 'content-type' ? 'application/json' : '200', body: async () => { reads++; return Buffer.from(body); } };
  const page = { addInitScript: async () => { }, url: () => target.canonical, on: (_name: string, callback: (value: object) => void) => { listener = callback; order.push('listen'); }, goto: async () => { gotos++; order.push('goto'); listener?.(response); return { status: () => 200 }; }, evaluate: async (fn: { name: string; }) => fn.name === 'readPassiveTiming' ? { ui: [], structured: [] } : ({ challenge: false, accessDenied: false }), waitForLoadState: async () => { } };
  const context = { routeWebSocket: async () => { }, newPage: async () => page, route: async () => { }, close: async () => { closes++; } };
  const result = await host.capturePassivePage({ newContext: async () => context }, target, { now: () => 1000, wait: async () => { } }); assert.equal(gotos, 1); assert.equal(closes, 1); assert.equal(reads, 1); assert.deepEqual(order, ['listen', 'goto']); assert.equal(result.responses[0]?.availabilityEvidence, 'AVAILABLE');
});
test('recon has no request replay, direct endpoints, purchase coordinator, new provider or UI mutation calls', () => {
  const sources = ['scripts/amazon-passive-evidence.mjs', 'scripts/amazon-passive-runtime.mjs', 'scripts/amazon-passive-recon.mjs'].map(p => readFileSync(p, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /\.(?:fetch|click|fill|press|submit|addCookies|launchPersistentContext)\s*\(/);
  assert.doesNotMatch(sources, /@ptcg\/infrastructure|openDurableStore|AmazonPrivateApiProvider|chromium\.connect|\.newCDPSession\(/);
});
