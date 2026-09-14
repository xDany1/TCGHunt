import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const evidence = await import(pathToFileURL(resolve('scripts/amazon-passive-evidence.mjs')).href) as {
  passiveBodyAllowed(meta: object): boolean; passiveBodyReason(meta: object): string | null;
  inspectPassiveBody(meta: object, body: string, asin: string): { inspected: boolean; classification: string; availabilityEvidence: string; priceEvidence: string[]; sellerEvidence: string[]; fulfillmentEvidence: string[]; sanitizedMatchedFields: unknown[]; limitation?: string; };
  finalPassiveDiagnostics(input: object): { naturalPostResponses: object[]; restockCandidate: { id: string; actionable: boolean; priorUnavailableEstablished: boolean; } | null; candidateSuppressedReason: string | null; candidateDuplicate: boolean; privateUiAgreement: boolean; restockConfirmed: boolean; actionable: boolean; };
};
interface AuditRow { host: string; resourceType: string; method: string; reasonBlocked: string; count: number; potentialDynamicResource: boolean; }
const policy = await import(pathToFileURL(resolve('scripts/amazon-passive-policy.mjs')).href) as {
  createReconRouting(target: object): { decide(input: object): { allowed: boolean; classification?: string; }; audit(): { blocked: AuditRow[]; blockedFirstPartyDynamicCount: number; }; counts: { allowedRequests: number; blocked: number; }; denyExtraNavigation(input: object): void; };
};
const runtime = await import(pathToFileURL(resolve('scripts/amazon-passive-runtime.mjs')).href) as { capturePassivePage(browser: object, target: object, clock: object): Promise<{ responses: { inspected: boolean; classification: string; }[]; routingAudit: object; responseCounts: object; }>; };
const asin = 'B0H78BB9TY'; const target = { asin, canonical: `https://www.amazon.com.mx/dp/${asin}` };
const input = { url: 'https://www.amazon.com.mx/fixture/fragment', method: 'POST', type: 'xhr', main: true };
const meta = { ...input, resourceType: 'xhr', contentType: 'application/json', status: 200, declaredBytes: 200, observedAt: 100, naturalPageRequest: true, routeAllowed: true };
const body = JSON.stringify({ asin, availability: 'AVAILABLE', buyability: true, price: '589.00', priceCurrency: 'MXN', shipsFrom: 'Amazon México' });
test('proven natural allowed POST JSON is bounded private evidence, never an official interface', () => {
  const r = evidence.inspectPassiveBody(meta, body, asin); assert.equal(r.inspected, true); assert.equal(r.classification, 'PRIVATE_PAGE_LOAD_SIGNAL'); assert.equal(r.availabilityEvidence, 'AVAILABLE'); assert.deepEqual(r.priceEvidence, ['589.00']); assert.deepEqual(r.sellerEvidence, []); assert.deepEqual(r.fulfillmentEvidence, ['Amazon México']);
});
test('POST inspection requires both routing proof and page origin', () => {
  for (const patch of [{ naturalPageRequest: false }, { routeAllowed: false }]) assert.equal(evidence.passiveBodyAllowed({ ...meta, ...patch }), false);
});
for (const path of ['/cart/add', '/checkout', '/payment', '/orders', '/account/change', '/ap/signin']) test(`mutation POST response cannot be inspected even with claimed route proof: ${path}`, () => {
  const m = { ...meta, url: `https://www.amazon.com.mx${path}` }; assert.equal(evidence.passiveBodyAllowed(m), false); assert.equal(evidence.inspectPassiveBody(m, body, asin).availabilityEvidence, 'UNKNOWN');
});
test('unknown, oversized and decoded-oversized POST bodies have explicit exclusion reasons', () => {
  assert.equal(evidence.passiveBodyReason({ ...meta, declaredBytes: null }), 'DECLARED_LENGTH_UNKNOWN_OR_EMPTY');
  assert.equal(evidence.passiveBodyReason({ ...meta, declaredBytes: 262145 }), 'DECLARED_BODY_CAP');
  assert.equal(evidence.inspectPassiveBody(meta, ' '.repeat(262145), asin).inspected, false);
});
test('account-bearing POST JSON is omitted as a whole without leaking nearby product fields', () => {
  const r = evidence.inspectPassiveBody(meta, JSON.stringify({ asin, availability: 'AVAILABLE', offers: [{ sessionToken: 'secret' }] }), asin);
  assert.equal(r.inspected, false); assert.equal(r.availabilityEvidence, 'UNKNOWN'); assert.deepEqual(r.sanitizedMatchedFields, []); assert.equal(JSON.stringify(r).includes('secret'), false);
});
test('POST output contains only sanitized response fields, never request bodies or headers', () => {
  const parsed = { ...evidence.inspectPassiveBody({ ...meta, url: `${input.url}?csrf=secret`, requestBody: 'secret', headers: { Authorization: 'secret' } }, body, asin), method: 'POST', requestBody: 'secret', headers: { cookie: 'secret' }, evidenceAt: 200 };
  const r = evidence.finalPassiveDiagnostics({ asin, responses: [parsed], uiSamples: [], uiAvailability: 'UNKNOWN', conflict: false });
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.deepEqual(Object.keys(r.naturalPostResponses[0] ?? {}).sort(), ['pathPattern', 'status', 'contentType', 'inspected', 'classification', 'sanitizedMatchedFields', 'availabilityEvidence', 'priceEvidence', 'currencyEvidence', 'sellerEvidence', 'fulfillmentEvidence', 'observedAt'].sort());
});
test('blocked first-party traffic is aggregated by safe host/type/method/reason without URLs', () => {
  const b = policy.createReconRouting(target);
  for (let i = 0; i < 3; i++) b.decide({ ...input, url: 'https://www.amazon.com.mx/cart?token=secret' });
  const rows = b.audit().blocked; assert.equal(rows.length, 1); assert.equal(rows[0]?.count, 3); assert.equal(rows[0]?.host, 'www.amazon.com.mx'); assert.equal(rows[0]?.reasonBlocked, 'MUTATION_OR_AUTH_DENIED'); assert.equal(rows[0]?.potentialDynamicResource, true); assert.equal(JSON.stringify(rows).includes('secret'), false);
});
test('blocked request volume cannot starve later legitimate dynamic requests', () => {
  const b = policy.createReconRouting(target);
  for (let i = 0; i < 300; i++) b.decide({ ...input, url: 'https://unrelated.test/path' });
  assert.equal(b.decide(input).allowed, true); assert.equal(b.counts.allowedRequests, 1); assert.equal(b.counts.blocked, 300);
});
test('saturated script budget identifies potential first-party dynamic suppression', () => {
  const b = policy.createReconRouting(target); const script = { ...input, method: 'GET', type: 'script', url: 'https://m.media-amazon.com/images/I/fixture.js' };
  for (let i = 0; i < 120; i++) assert.equal(b.decide(script).allowed, true);
  assert.equal(b.decide(script).allowed, false); assert.equal(b.audit().blockedFirstPartyDynamicCount, 1); assert.equal(b.audit().blocked[0]?.reasonBlocked, 'RESOURCE_BUDGET');
  assert.equal(b.decide(input).allowed, true);
});
test('extra navigation blocks and unknown hosts are audited without opaque host identities', () => {
  const b = policy.createReconRouting(target); b.denyExtraNavigation({ url: target.canonical, method: 'GET', type: 'document' }); b.decide({ ...input, url: 'https://secret.unrelated.test/a' });
  assert.equal(b.audit().blocked[0]?.reasonBlocked, 'EXTRA_NAVIGATION_DENIED'); assert.equal(JSON.stringify(b.audit()).includes('secret'), false);
});
const signal = { ...meta, ...evidence.inspectPassiveBody(meta, body, asin), evidenceAt: 200, asinRelationship: 'EXPLICIT_SAME_OBJECT' };
const unknown = [{ observedAt: 300, availability: 'UNKNOWN', actionVisible: false, boundToAsin: true }];
test('private AVAILABLE while UI still unknown yields only a diagnostic candidate with deduplication', () => {
  const args = { asin, responses: [signal], uiSamples: unknown, uiAvailability: 'UNKNOWN', conflict: false };
  const r = evidence.finalPassiveDiagnostics(args); assert.ok(r.restockCandidate); assert.equal(r.restockCandidate.priorUnavailableEstablished, false); assert.equal(r.restockCandidate.actionable, false); assert.equal(r.restockConfirmed, false); assert.equal(r.actionable, false);
  assert.equal(r.candidateSuppressedReason, null);
  assert.equal(evidence.finalPassiveDiagnostics({ ...args, seen: [r.restockCandidate.id] }).candidateDuplicate, true);
});
test('later UI confirmation records agreement only; conflicts never emit a candidate', () => {
  const r = evidence.finalPassiveDiagnostics({ asin, responses: [signal], uiSamples: unknown, uiAvailability: 'AVAILABLE', conflict: false }); assert.equal(r.privateUiAgreement, true); assert.equal(r.restockCandidate, null);
  assert.equal(evidence.finalPassiveDiagnostics({ asin, responses: [signal], uiSamples: unknown, uiAvailability: 'UNKNOWN', conflict: true }).restockCandidate, null);
});
test('headers/request start or unbound fields cannot fabricate a candidate or early availability', () => {
  for (const patch of [{ inspected: false }, { asinRelationship: 'UNBOUND' }, { evidenceAt: null }, { availabilityEvidence: 'UNKNOWN' }]) assert.equal(evidence.finalPassiveDiagnostics({ asin, responses: [{ ...signal, ...patch }], uiSamples: unknown, uiAvailability: 'UNKNOWN', conflict: false }).restockCandidate, null);
});
test('actual response listener inspects one naturally routed POST without replay or privacy leakage', async () => {
  let routeHandler: ((r: object) => Promise<void>) | undefined; let listener: ((r: object) => void) | undefined; let bodyReads = 0; let continuations = 0;
  const frame = {}; const request = { url: () => input.url, method: () => 'POST', resourceType: () => 'xhr', frame: () => frame, postData: () => '{"asin":"B0H78BB9TY","csrfToken":"secret"}' };
  const page = {
    mainFrame: () => frame, url: () => target.canonical, addInitScript: async () => { }, on: (_: string, cb: (r: object) => void) => { listener = cb; },
    goto: async () => { await routeHandler?.({ request: () => request, continue: async () => { continuations++; }, abort: async () => { assert.fail('allowed natural read'); } }); listener?.({ request: () => request, url: () => input.url, status: () => 200, headerValue: async (name: string) => name === 'content-type' ? 'application/json' : String(Buffer.byteLength(body)), body: async () => { bodyReads++; return Buffer.from(body); } }); return { status: () => 200 }; },
    evaluate: async (fn: { name: string; }) => fn.name === 'readPassiveTiming' ? { ui: [], structured: [] } : { challenge: false, accessDenied: false }, waitForLoadState: async () => { }
  };
  const context = { newPage: async () => page, routeWebSocket: async () => { }, route: async (_: string, cb: (r: object) => Promise<void>) => { routeHandler = cb; }, close: async () => { } };
  const r = await runtime.capturePassivePage({ newContext: async () => context }, target, { now: () => 1000, wait: async () => { } });
  assert.equal(continuations, 1); assert.equal(bodyReads, 1); assert.equal(r.responses[0]?.inspected, true); assert.equal(r.responses[0]?.classification, 'PRIVATE_PAGE_LOAD_SIGNAL'); assert.equal(JSON.stringify(r).includes('secret'), false);
});
test('final pass retains no endpoint invocation, mutation, personal profile or durable coordinator', () => {
  const source = ['runtime', 'evidence', 'recon', 'policy'].map(name => readFileSync(`scripts/amazon-passive-${name}.mjs`, 'utf8')).join('\n');
  assert.doesNotMatch(source, /\.(?:fetch|click|fill|press|submit|addCookies|launchPersistentContext)\s*\(|@ptcg\/infrastructure|openDurableStore|AmazonPrivateApiProvider/); assert.match(source, /purchaseIntentsCreated: 0/); assert.match(source, /mode: 'DRY_RUN'/); assert.match(source, /furtherDiagnosticIterationsPlanned: false/);
});
