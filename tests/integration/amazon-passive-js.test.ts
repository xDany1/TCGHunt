import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

const policy = await import(pathToFileURL(resolve('scripts/amazon-passive-policy.mjs')).href) as {
  RECON_CONTEXT: { javaScriptEnabled: boolean; serviceWorkers: string; };
  reconRouteDecision(input: object, target: object): { allowed: boolean; classification?: string; };
  createReconRouting(target: object): { decide(input: object): { allowed: boolean; }; counts: { blocked: number; networkRequestsObserved: number; }; halt(): void; };
};
const evidence = await import(pathToFileURL(resolve('scripts/amazon-passive-evidence.mjs')).href) as {
  passiveBodyAllowed(meta: object): boolean; passiveMetadata(meta: object): { classification: string; } | null;
  inspectPassiveBody(meta: object, body: string, asin: string): { inspected: boolean; availabilityEvidence: string; };
  reconcilePassive(input: object): { actionable: boolean; restockCandidate: { id: string; } | null; restockConfirmed: boolean; candidateDuplicate: boolean; evidenceConflict: boolean; };
};
const timing = await import(pathToFileURL(resolve('scripts/amazon-passive-timing.mjs')).href) as {
  installPassiveTiming: Function;
  sanitizePassiveTiming(raw: object, asin: string, from: number, to: number): { ui: unknown[]; structured: unknown[]; };
  comparePassiveTiming(input: object): { earliestAvailabilitySource: string; observedLeadMs: number | null; firstPrivateAvailabilityAt: number | null; firstUiAvailabilityAt: number | null; };
};
const asin = 'B0H78BB9TY'; const target = { asin, canonical: `https://www.amazon.com.mx/dp/${asin}` };
const input = { url: 'https://www.amazon.com.mx/fixture/data', method: 'GET', type: 'xhr', main: true };
const meta = { ...input, resourceType: 'xhr', status: 200, contentType: 'application/json', declaredBytes: 90, observedAt: 100 };
test('JS is enabled only in the explicit diagnostic profile', () => {
  assert.equal(policy.RECON_CONTEXT.javaScriptEnabled, true); assert.equal(policy.RECON_CONTEXT.serviceWorkers, 'block');
  assert.match(readFileSync('scripts/amazon-browser-policy.mjs', 'utf8'), /javaScriptEnabled: false/);
});
for (const type of ['xhr', 'fetch']) test(`natural ${type} is routed independently of unknown length or non-JSON inspection`, () => {
  assert.equal(policy.reconRouteDecision({ ...input, type }, target).allowed, true);
  assert.equal(evidence.passiveBodyAllowed({ ...meta, resourceType: type, declaredBytes: null }), false);
  assert.equal(evidence.passiveBodyAllowed({ ...meta, resourceType: type, contentType: 'image/png' }), false);
});
test('required Amazon static scripts/styles/images are allowed but never body-inspected', () => {
  for (const type of ['script', 'stylesheet', 'image', 'font']) {
    assert.equal(policy.reconRouteDecision({ ...input, type, url: 'https://m.media-amazon.com/images/I/fixture.js' }, target).allowed, true);
    assert.equal(evidence.passiveMetadata({ ...meta, resourceType: type }), null);
  }
});
test('unrelated hosts and subframes/workers do not gain read authority', () => {
  for (const url of ['https://amazon.com.mx.evil.test/a', 'https://ads.example.test/a', 'http://www.amazon.com.mx/a', 'https://www.amazon.com.mx:9443/a']) assert.equal(policy.reconRouteDecision({ ...input, url }, target).allowed, false);
  assert.equal(policy.reconRouteDecision({ ...input, main: false }, target).allowed, false);
});
for (const path of ['/cart/add', '/gp/buy/spc', '/checkout', '/orders', '/payment', '/ap/signin', '/account/change', '/gp/product/handle-buy-box', '/%2563art']) test(`mutation/auth path denied: ${path}`, () => {
  for (const method of ['GET', 'POST']) assert.equal(policy.reconRouteDecision({ ...input, method, url: `https://www.amazon.com.mx${path}` }, target).allowed, false);
});
test('mutation semantics in query or body are denied without persisting parameters', () => {
  for (const body of ['action=addToCart', '{"operation":"placeOrder"}', '{"operation":"submitPayment"}', '{"action":"buy"}', '{"action":"addTo\\u0043art"}']) assert.equal(policy.reconRouteDecision({ ...input, method: 'POST', body }, target).allowed, false);
  assert.equal(policy.reconRouteDecision({ ...input, url: `${input.url}?action=reserve` }, target).allowed, false);
});
test('uncertain natural POST is UNCLASSIFIED and never inspected as trusted data', () => {
  const d = policy.reconRouteDecision({ ...input, method: 'POST', body: '{"asin":"B0H78BB9TY"}' }, target);
  assert.equal(d.allowed, true); assert.equal(d.classification, 'UNCLASSIFIED');
  assert.equal(evidence.passiveMetadata({ ...meta, method: 'POST' })?.classification, 'UNCLASSIFIED');
  assert.equal(evidence.passiveBodyAllowed({ ...meta, method: 'POST' }), false);
});
test('first-party telemetry can proceed but is ignored for evidence', () => {
  const d = policy.reconRouteDecision({ ...input, url: 'https://www.amazon.com.mx/metrics/fixture' }, target);
  assert.equal(d.allowed, true); assert.equal(d.classification, 'IGNORED_TELEMETRY');
  assert.equal(evidence.passiveMetadata({ ...meta, inspectionClass: d.classification }), null);
});
test('caps and stop halt natural requests without extra requests or retry', () => {
  const b = policy.createReconRouting(target);
  for (let i = 0; i < 24; i++) assert.equal(b.decide(input).allowed, true);
  assert.equal(b.decide(input).allowed, false); assert.equal(b.counts.networkRequestsObserved, 25);
  b.halt(); assert.equal(b.decide({ ...input, type: 'fetch' }).allowed, false);
});
const signal = { resourceType: 'xhr', inspected: true, asinRelationship: 'EXPLICIT_SAME_OBJECT', availabilityEvidence: 'AVAILABLE', observedAt: 100, evidenceAt: 500 };
test('network timing uses completed body evidence rather than early response headers', () => {
  const r = timing.comparePassiveTiming({ responses: [signal], structured: [], uiSamples: [{ availability: 'AVAILABLE', observedAt: 300 }] });
  assert.equal(r.earliestAvailabilitySource, 'RENDERED_UI'); assert.equal(r.observedLeadMs, -200); assert.equal(r.firstPrivateAvailabilityAt, 500);
});
test('same-run structured evidence, ties, missing UI and observed ordering remain explicit', () => {
  const common = { responses: [signal], uiSamples: [{ availability: 'AVAILABLE', observedAt: 900 }] };
  assert.equal(timing.comparePassiveTiming({ ...common, structured: [{ availabilityEvidence: 'AVAILABLE', observedAt: 200 }] }).earliestAvailabilitySource, 'STRUCTURED_PAGE');
  assert.equal(timing.comparePassiveTiming({ ...common, structured: [] }).observedLeadMs, 400);
  assert.equal(timing.comparePassiveTiming({ ...common, structured: [{ availabilityEvidence: 'AVAILABLE', observedAt: 500 }] }).earliestAvailabilitySource, 'TIED_SAMPLES');
  assert.equal(timing.comparePassiveTiming({ responses: [signal], structured: [], uiSamples: [] }).observedLeadMs, null);
  assert.equal(timing.comparePassiveTiming({ ...common, structured: [], conflict: true }).observedLeadMs, null);
});
test('an enabled ASIN-bound action supplies visible cue timing without inventing stock', () => {
  const r = timing.comparePassiveTiming({ responses: [], structured: [], uiSamples: [{ availability: 'UNKNOWN', actionVisible: true, boundToAsin: true, observedAt: 300 }] });
  assert.equal(r.firstUiAvailabilityAt, 300);
});
test('network available before UI remains only a deduplicated candidate with a prior baseline', () => {
  const common = { asin, responses: [signal], ui: { availability: 'UNKNOWN' }, prior: { availability: 'UNAVAILABLE', reference: 'fixture-baseline' } };
  const r = evidence.reconcilePassive(common); assert.ok(r.restockCandidate); assert.equal(r.actionable, false); assert.equal(r.restockConfirmed, false);
  assert.equal(evidence.reconcilePassive({ ...common, seen: [r.restockCandidate.id] }).candidateDuplicate, true);
  const conflict = evidence.reconcilePassive({ ...common, ui: { availability: 'UNAVAILABLE' } }); assert.equal(conflict.evidenceConflict, true); assert.equal(conflict.restockCandidate, null);
});

// Exercise the actual init-script code in a deterministic DOM/runtime without a live browser.
function sampler(availability: string, data: object, challenge = false) {
  let now = 0; let sample: (() => void) | undefined; let cleared = 0;
  const element = (text: string) => ({ innerText: text, textContent: text, value: text, getClientRects: () => [1], getAttribute: () => null });
  const script = { textContent: JSON.stringify(data), getAttribute: () => 'application/ld+json' };
  const context = {
    document: {
      body: { innerText: challenge ? 'robot check' : '' }, querySelectorAll(selector: string) {
        if (selector.startsWith('input#ASIN')) return [{ value: asin }];
        if (selector.startsWith('#availability span')) return now >= 1000 ? [element(availability)] : [];
        if (selector.startsWith('script[type=')) return now >= 500 ? [script] : [];
        return [];
      }
    }, performance: { timeOrigin: 100000, now: () => now },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setInterval(fn: () => void) { sample = fn; return 1; }, clearInterval() { cleared++; }, setTimeout: () => 2
  };
  const sandbox = context as typeof context & { __astraPassiveTiming?: { ui: { observedAt: number; availability: string[]; }[]; structured: { observedAt: number; availabilityEvidence: string; }[]; stopped: string | null; }; };
  runInNewContext(`(${timing.installPassiveTiming.toString()})(${JSON.stringify({ asin, intervalMs: 500, windowMs: 8000 })})`, sandbox);
  for (let i = 1; i <= 20; i++) { now = i * 500; sample?.(); }
  return { result: sandbox.__astraPassiveTiming, cleared };
}
test('init sampler captures structured evidence before visible availability and bounds its work', () => {
  const { result, cleared } = sampler('Disponible', { '@type': 'Product', sku: asin, offers: { '@type': 'Offer', availability: 'https://schema.org/InStock' } });
  assert.ok(result); assert.equal(result.structured[0]?.observedAt, 100500); assert.equal(result.ui.find(s => s.availability.length)?.observedAt, 101000); assert.ok(result.ui.length <= 18); assert.ok(cleared > 0);
});
test('structured samples never bind a neighboring product or retain customer data', () => {
  const { result } = sampler('No disponible', { asin: 'B0OTHER001', availability: 'AVAILABLE', customer: { asin, availability: 'AVAILABLE', token: 'secret' } });
  assert.equal(result?.structured.length, 0); assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('init sampler detects challenge without clicking or emitting availability evidence', () => {
  const { result } = sampler('Disponible', { asin, availability: 'AVAILABLE' }, true);
  assert.equal(result?.stopped, 'CHALLENGE_OR_ACCESS_DENIED'); assert.equal(result?.ui.length, 0);
});
test('bounded sanitized GET inspection retains separate price/currency and seller/fulfillment', () => {
  const r = evidence.inspectPassiveBody(meta, JSON.stringify({ asin, availability: 'AVAILABLE', price: '589.00', currency: 'MXN', shipsFrom: 'Amazon', customerToken: 'secret' }), asin);
  assert.equal(r.inspected, true); assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.equal(evidence.inspectPassiveBody({ ...meta, declaredBytes: 262145 }, '{}', asin).inspected, false);
});
test('timing readback rejects page-added secrets, wrong ASIN, arbitrary labels and out-of-run timestamps', () => {
  const r = timing.sanitizePassiveTiming({ ui: [{ observedAt: 1000, boundToAsin: true, availability: ['Disponible', 'secret'], actions: ['Comprar ahora', 'secret'], cookie: 'secret' }, { observedAt: -10000 }], structured: [{ asin: 'B0OTHER001', source: 'JSON_LD', observedAt: 1000, availabilityEvidence: 'AVAILABLE', token: 'secret' }] }, asin, 900, 1500);
  assert.equal(r.ui.length, 1); assert.equal(r.structured.length, 0); assert.equal(JSON.stringify(r).includes('secret'), false);
});
test('diagnostic code has no private request creation, durable intent, profile import or evasion', () => {
  const source = ['runtime', 'recon', 'policy', 'timing', 'evidence'].map(name => readFileSync(`scripts/amazon-passive-${name}.mjs`, 'utf8')).join('\n');
  assert.doesNotMatch(source, /\.(?:fetch|click|fill|press|submit|addCookies|launchPersistentContext|newCDPSession)\s*\(|@ptcg\/infrastructure|openDurableStore|AmazonPrivateApiProvider/);
  assert.match(source, /route\.continue\(\)/); assert.match(source, /purchaseIntentsCreated: 0/); assert.match(source, /mode: 'DRY_RUN'/);
});
