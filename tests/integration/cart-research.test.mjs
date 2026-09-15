import { installBuyNowDomDiagnostics } from '../../scripts/amazon-buy-now-diagnostics.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartResearchConfig, qualifyCartPage, confirmCart, createCartRouting } from '../../scripts/amazon-cart-research-policy.mjs';
import { inspectSemantic, headerPresence, pathPattern, correlateTraffic, authorityDiagnostics } from '../../scripts/amazon-cart-research-evidence.mjs';
import { runCartResearch, cartUiSnapshot } from '../../scripts/amazon-cart-research-runtime.mjs';
import { claimResearchOperation } from '../../scripts/amazon-cart-research.mjs';
import { inspectCartControls } from '../../scripts/amazon-cart-causality.mjs';
import { evaluateForbiddenOperationField, forbiddenValueSemantic, classifyFieldName, installPinnedCartObservers, nativeCartCausality, nativeFormBodyPolicy } from '../../scripts/amazon-cart-native-form.mjs';
const args = ['--asin', 'B0GYVHLP4L', '--action', 'ADD_TO_CART', '--operation-id', 'authored-operation-1', '--max-price-mxn', '2000.00', '--expected-seller', 'amazon-retail-mx', '--ack-unknown-evidence', 'YES_RESEARCH_ONLY'];
const config = cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, args);
const before = { marketplace: 'MX', asin: config.asin, identityMatched: true, availability: 'AVAILABLE', purchaseMode: 'IMMEDIATE', actionType: 'ADD_TO_CART', actionVisible: true, quantity: 1, cartCount: 0, itemPresent: false, challenge: false, accessDenied: false, price: null, sellerId: null };
const cartUrl = 'https://www.amazon.com.mx/gp/add-to-cart/html';
const request = { url: cartUrl, method: 'POST', type: 'document', main: true, body: `ASIN=${config.asin}&quantity=1` };

test('M5.7 default CLI exits without opt-in, browser creation or result mutation', () => {
  assert.throws(() => cartResearchConfig({}, args), /DISABLED/);
  const result = spawnSync(process.execPath, ['scripts/amazon-cart-research.mjs'], { env: { ...process.env, AMAZON_CART_RESEARCH_ENABLED: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1); const row = JSON.parse(result.stdout); assert.equal(row.mode, 'NON_MUTATING'); assert.equal(row.cartMutationCount, 0); assert.equal(row.actionExecuted, false);
});
test('M5.7 explicit DRY_RUN wins over cart opt-in', () => assert.throws(() => cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1', DRY_RUN: 'true' }, args), /DRY_RUN_FORBIDS/));
for (const [key, value] of [['--asin', 'B0H78BB9TY'], ['--action', 'BUY_NOW'], ['--operation-id', '../../secret'], ['--max-price-mxn', '0.00'], ['--expected-seller', 'anyone'], ['--ack-unknown-evidence', 'true']]) test(`M5.7 rejects invalid ${key}`, () => {
  const changed = [...args]; changed[changed.indexOf(key) + 1] = value; assert.throws(() => cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, changed));
});
test('M5.7 reject unknown or duplicate flags', () => {
  for (const extra of [['--quantity', '2'], ['--asin', config.asin]]) assert.throws(() => cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, [...args, ...extra]));
});
for (const patch of [{ asin: 'B0H78BB9TY' }, { marketplace: 'US' }, { identityMatched: false }, { availability: 'UNAVAILABLE' }, { challenge: true }, { accessDenied: true }, { actionVisible: false }, { purchaseMode: 'PREORDER' }, { quantity: 2 }, { quantity: null }, { cartCount: 1 }, { cartCount: null }, { itemPresent: true }]) test(`M5.7 qualification fails closed ${JSON.stringify(patch)}`, () => assert.equal(qualifyCartPage(config, { ...before, ...patch }).qualified, false));
test('M5.7 UNKNOWN requires acknowledgement, while known price/seller mismatches cannot be waived', () => {
  assert.equal(qualifyCartPage({ ...config, acknowledgeUnknown: false }, before).qualified, false);
  assert.equal(qualifyCartPage(config, before).qualified, true);
  for (const patch of [{ sellerId: 'THIRDPARTY' }, { price: { minor: '200001', currency: 'MXN' } }, { price: { minor: '1000', currency: 'USD' } }]) assert.equal(qualifyCartPage(config, { ...before, ...patch }).qualified, false);
  assert.equal(qualifyCartPage(config, { ...before, sellerId: config.expectedSeller, price: { minor: '1000', currency: 'MXN' } }).qualified, true);
});
test('M5.7 preorder is separate and never automatically follows the immediate test', () => {
  const changed = [...args]; changed[1] = 'B0HG3C5JK6'; changed[3] = 'RESERVE_PREORDER'; const c = cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, changed);
  assert.equal(c.purchaseMode, 'PREORDER'); assert.equal(qualifyCartPage(c, { ...before, asin: c.asin, purchaseMode: 'PREORDER', actionType: 'RESERVE_PREORDER' }).qualified, true);
  assert.equal(qualifyCartPage(c, { ...before, asin: c.asin }).qualified, false);
});
test('M5.7 route gate permits one naturally generated target-bound cart request only after arming', () => {
  const r = createCartRouting(config); assert.equal(r.decide(request).allowed, false); r.arm();
  assert.equal(r.decide(request).allowed, true); assert.equal(r.decide(request).allowed, false); assert.equal(r.counts.cartRequests, 1); assert.throws(() => r.arm());
});
for (const patch of [{ body: 'ASIN=B0H78BB9TY&quantity=1' }, { body: `ASIN=${config.asin}&quantity=2` }, { body: 'quantity=1' }, { body: `ASIN=${config.asin}` }, { body: `ASIN=${config.asin}&quantity=1&ASIN.2=B0HG3C5JK6` }, { redirect: true }, { main: false }, { method: 'DELETE' }]) test(`M5.7 request fence rejects ${JSON.stringify(patch)}`, () => {
  const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, ...patch }).allowed, false); assert.equal(r.counts.cartRequests, 0);
});
for (const path of ['/gp/buy/spc', '/checkout', '/orders', '/payment', '/ap/signin', '/cart/remove', '/cart/update', '/gp/product/handle-buy-box', '/%2563heckout']) test(`M5.7 denies ${path} before and after action`, () => {
  const r = createCartRouting(config); const input = { ...request, url: `https://www.amazon.com.mx${path}` };
  assert.equal(r.decide(input).allowed, false); r.arm(); assert.equal(r.decide(input).allowed, false);
});
test('M5.7 host, background write, budgets and halt guards', () => {
  for (const url of ['https://evil.test/gp/add-to-cart/html', 'http://www.amazon.com.mx/gp/add-to-cart/html', 'https://www.amazon.com.mx:9443/gp/add-to-cart/html', 'https://www.amazon.com.mx/hz/aj/unknown']) {
    const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, url }).allowed, false);
  }
  const r = createCartRouting(config); r.halt(); assert.throws(() => r.arm()); assert.equal(r.decide({ ...request, url: config.url, method: 'GET' }).allowed, false);
});
test('M5.7 only fixed vocabulary survives secret redaction in headers/query/body', () => {
  const canary = 'DO_NOT_PERSIST_SECRET_CANARY';
  const raw = JSON.stringify({ asin: config.asin, quantity: 1, sellerId: 'MERCHANT123', price: '99.00', currency: 'MXN', cartItemId: '12345', offerListingId: canary, offeringID: canary, csrfToken: canary, sessionId: canary, email: canary, address: { asin: canary }, unknownField: canary });
  const safe = inspectSemantic(raw, 'application/json', config.asin); assert.equal(safe.inspected, true); assert.doesNotMatch(JSON.stringify(safe), new RegExp(canary));
  assert.ok(safe.fields.some(f => f.fieldName === 'sellerid' && f.value === 'MERCHANT123')); assert.ok(safe.dependencies.token); assert.ok(safe.dependencies.session);
  assert.deepEqual(headerPresence({ Cookie: canary, Authorization: canary, 'x-csrf-token': canary, Origin: canary }), { session: true, token: true, origin: true });
  assert.equal(pathPattern(`https://www.amazon.com.mx/gp/add-to-cart/html/${canary}?token=${canary}`), '/gp/add-to-cart/html/:redacted');
  const form = inspectSemantic(`ASIN=${config.asin}&quantity=1&csrfToken=${canary}&offeringID.1=${canary}`, 'application/x-www-form-urlencoded', config.asin); assert.doesNotMatch(JSON.stringify(form), new RegExp(canary));
});
test('M5.7 body limits and unsupported formats remain unknown', () => {
  for (const [body, content] of [['x'.repeat(70000), 'application/json'], ['{invalid', 'application/json'], ['<html>secret</html>', 'text/html']]) assert.equal(inspectSemantic(body, content, config.asin).inspected, false);
});
test('M5.7 generic success and HTTP 200 cannot confirm expected cart item', () => {
  assert.equal(confirmCart(config, before, { cartCount: 1, itemAsins: ['B0HG3C5JK6'], success: true }), false);
  assert.equal(confirmCart(config, before, { cartCount: 1, itemAsins: [] }), false);
  assert.equal(confirmCart(config, before, { cartCount: 1, itemAsins: [config.asin] }), true);
  const row = { phase: 'ACTION', method: 'POST', pathPattern: '/gp/add-to-cart/html', allowed: true, classification: 'CART_CANDIDATE', status: 200, resourceType: 'document', requestEvidence: inspectSemantic(`ASIN=${config.asin}&quantity=1`, 'application/x-www-form-urlencoded', config.asin) };
  assert.equal(correlateTraffic([row], false).cartConfirmedRequest, null); assert.equal(correlateTraffic([row], true).cartConfirmedRequest?.classification, 'CART_CONFIRMED');
  assert.equal(correlateTraffic([{ ...row, phase: 'BASELINE' }, row], true).newActionCorrelatedRequests.length, 0);
});
test('M5.7 durable operation fence survives restart and denies duplicate', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  claimResearchOperation(config.operationId, dir); assert.throws(() => claimResearchOperation(config.operationId, dir), /OPERATION_ALREADY_CONSUMED/);
});

function fakeRuntime(options = {}) {
  let routes; const handlers = {}; let clicks = 0; let launches = 0; let closed = 0; let mutated = false; let sequenceTime = 1800000000000;
  let releaseBaseline; let delayedBaseline; let pendingAction;
  const frame = {}; let nativeBinding;
  async function emit(url, method, body = '', delayHeaders = false) {
    let allowed = false; const req = { url: () => url, method: () => method, postData: () => { if (options.bodyThrows) throw new Error('SECRET_CANARY body failure'); return body; }, frame: () => frame, resourceType: () => options.resourceType ?? 'document', isNavigationRequest: () => true, redirectedFrom: () => null, allHeaders: async () => { if (delayHeaders) await new Promise(resolve => { releaseBaseline = resolve; }); if (options.headerFails || options.actionHeaderFails && method === 'POST') throw new Error(options.staleFailure ? 'Execution context was destroyed SECRET_CANARY' : 'SECRET_HEADER_FAILURE'); return { 'content-type': options.contentType ?? 'application/x-www-form-urlencoded', cookie: 'SECRET_CANARY', 'x-csrf-token': 'SECRET_CANARY' }; } };
    await routes({ request: () => req, abort: async () => { }, continue: async (...overrides) => { assert.equal(overrides.length, 0); if (options.continueThrows && method === 'POST') throw new Error('Route already handled SECRET_CANARY'); allowed = true; } });
    if (allowed && handlers.response) {
      const text = JSON.stringify({ asin: config.asin, quantity: 1, cartItemId: '123', sessionId: 'SECRET_CANARY', offeringID: 'SECRET_CANARY', success: true });
      handlers.response({ request: () => req, url: () => url, status: () => 200, allHeaders: async () => ({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) }), body: async () => Buffer.from(text) });
    }
    return allowed;
  }
  const page = {
    exposeBinding: async name => { assert.notEqual(name, '__astraPinnedCartEvent'); }, addInitScript: async () => { },
    setDefaultTimeout() { }, on(name, handler) { handlers[name] = handler; }, mainFrame: () => frame, url: () => options.url ?? config.url,
    goto: async () => { await emit(config.url, 'GET'); if (options.delayedBaseline) delayedBaseline = emit(options.actionUrl, 'GET', '', true); return { status: () => 200 }; },
    evaluate: async (fn, args, evalOptions) => {
      if (fn === installBuyNowDomDiagnostics) { if (options.diagnosticThrows) throw new Error('SECRET_DIAGNOSTIC_ERROR'); return options.diagnosticDom ?? { complete: true, domCandidates: [] }; }
      if (fn === installPinnedCartObservers) { assert.equal(evalOptions.exposeFunctions, true); nativeBinding = args.report; return true; }
      if (fn === inspectCartControls) {
        const candidate = { semanticQualified: true, boundingBoxPresent: true, id: 'add-to-cart-button', name: 'submit.add-to-cart', tagName: 'INPUT', inputType: 'submit', visible: true, enabled: true, connected: true, productBound: true, recommendation: false, formActionQualified: true, actionLabel: config.action, unobscured: true, obstruction: 'UNOBSCURED', geometry: { intersectionRatio: 1, elementBoundingBox: { x: 0, y: 0, width: 50, height: 30 } }, form: { method: 'POST', enctype: 'application/x-www-form-urlencoded', expectedAsinMatched: true, quantityMatched: true } };
        return { candidateCount: 1, preselectedPrimaryIndex: 0, preselected: candidate, selectedPrimaryIndex: 0, pinnablePrimaryIndex: 0, pinnableCandidate: candidate, pinnedConnected: true, pinnedMatchesCandidate: true, pinnedMatchesSelection: true, candidateScanCapped: false, selected: candidate, ...options.controls };
      }
      if (fn === cartUiSnapshot) return { ...before, itemAsins: mutated ? [options.confirmAsin ?? config.asin] : [], cartCount: mutated ? 1 : 0, ...options.ui };
      return { status: 200, challenge: false, accessDenied: false, missingProduct: false, asins: [config.asin], titles: ['AUTHORED'], prices: [], currencies: [], availability: ['Disponible'], sellerIds: [], sellers: [], shippers: [], selectedAsin: true, offerRegion: true, actions: ['Agregar al carrito'], ...options.rendered };
    },
    locator: selector => {
      assert.equal(selector, '#add-to-cart-button'); return {
        nth: () => ({ elementHandle: async () => ({ evaluateHandle: async () => assert.fail('No retained form JSHandle'), evaluate: (fn, args, opts) => page.evaluate(fn, args, opts), click: () => page.locator(selector).click() }) }),
        click: async () => {
          clicks++; if (releaseBaseline) { releaseBaseline(); await delayedBaseline; }
          if (options.nativeEvents) for (const kind of ['CLICK', 'SUBMIT']) {
            const event = { kind, browserAt: sequenceTime++, trusted: true, defaultPrevented: false, productBound: true, ...(options.nativeEventPatch ?? {}) };
            await nativeBinding(options.serializedNativeEvents ? {} : JSON.parse(JSON.stringify(event)));
          }
          const action = async () => { mutated = await emit(options.actionUrl ?? cartUrl, options.actionMethod ?? 'POST', options.actionBody ?? `ASIN=${config.asin}&quantity=1`); if (options.repeatRequest) await emit(options.actionUrl ?? cartUrl, options.actionMethod ?? 'POST', options.actionBody ?? `ASIN=${config.asin}&quantity=1`); };
          if (options.afterClickRequest) pendingAction = action; else await action();
          if (options.clickThrows) throw new Error('CLICK_UNCERTAIN');
        }
      };
    }
  };
  const context = { newPage: async () => page, on() { }, route: async (_pattern, handler) => { routes = handler; }, routeWebSocket: async () => { }, close: async () => { closed++; } };
  const chromium = { launch: async () => { launches++; return { newContext: async options => { assert.equal(options.javaScriptEnabled, true); assert.equal(options.serviceWorkers, 'block'); return context; }, close: async () => { closed++; } }; } };
  return { chromium, clock: { now: () => sequenceTime++, wait: async () => { sequenceTime += 500; if (pendingAction) { const action = pendingAction; pendingAction = null; await action(); } } }, clicks: () => clicks, launches: () => launches, closed: () => closed };
}
test('M5.7 injected browser executes exactly one legitimate click, splits windows, confirms bound cart and closes', async () => {
  const f = fakeRuntime(); let claims = 0; const r = await runCartResearch(config, f.chromium, f.clock, () => { claims++; });
  assert.equal(r.status, 'BROWSER_CART_CONFIRMED'); assert.equal(r.actionExecuted, true); assert.equal(r.cartMutationCount, 1); assert.equal(f.clicks(), 1); assert.equal(claims, 1); assert.equal(f.closed(), 2);
  assert.equal(r.baselineRequests.length, 1); assert.equal(r.actionRequests.length, 1); assert.equal(r.baselineRequests[0].phase, 'BASELINE'); assert.equal(r.actionRequests[0].phase, 'ACTION'); assert.equal(r.baselineTrafficSummary.total, 1); assert.equal(r.actionTrafficSummary.total, 1); assert.equal(r.cartConfirmedRequest.classification, 'CART_CONFIRMED'); assert.equal(r.backendTransportFeasibility, 'SESSION_BOUND / HIGH_FRAGILITY');
  assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY/); for (const key of ['checkoutAttempts', 'ordersCreated', 'paymentAttempts', 'directPrivateCalls', 'replayCount']) assert.equal(r[key], 0);
});
for (const options of [{ rendered: { asins: ['B0H78BB9TY'] } }, { url: 'https://www.amazon.com/dp/B0GYVHLP4L' }, { rendered: { availability: ['No disponible'] } }, { rendered: { challenge: true } }, { rendered: { accessDenied: true } }, { ui: { actionVisible: false } }]) test(`M5.7 browser pre-action rejection ${JSON.stringify(options)}`, async () => {
  const f = fakeRuntime(options); const r = await runCartResearch(config, f.chromium, f.clock, () => { }); assert.equal(f.clicks(), 0); assert.equal(r.cartMutationCount, 0); assert.equal(r.status, 'BLOCKED');
});
test('M5.7 consumed operation blocks before browser creation', async () => {
  const f = fakeRuntime(); const r = await runCartResearch(config, f.chromium, f.clock, () => { throw new Error('OPERATION_ALREADY_CONSUMED'); }); assert.equal(f.launches(), 0); assert.equal(r.reason, 'OPERATION_ALREADY_CONSUMED');
});
test('M5.7 routing/header failure aborts without exposing errors or allowing an action', async () => {
  const f = fakeRuntime({ headerFails: true }); const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(f.clicks(), 0); assert.equal(r.cartMutationCount, 0); assert.doesNotMatch(JSON.stringify(r), /SECRET_HEADER_FAILURE/);
});
test('M5.7 encoded cart read mutations cannot bypass query guards', () => {
  const r = createCartRouting(config); r.arm();
  assert.equal(r.decide({ ...request, url: 'https://www.amazon.com.mx/cart?act%69on=ad%64', method: 'GET', body: '' }).allowed, false);
});
test('M5.7 duplicate/indexed form fields cannot create a multi-item or ambiguous cart request', () => {
  for (const suffix of [`&ASIN=${config.asin}`, '&quantity=1', '&ASIN.0=B0HG3C5JK6', '&quantity[2]=1', '&offeringID.2=OPAQUE']) {
    const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, body: request.body + suffix }).allowed, false); assert.equal(r.counts.cartRequests, 0);
  }
});
test('M5.7 uncertain click never retries', async () => {
  const f = fakeRuntime({ clickThrows: true }); const r = await runCartResearch(config, f.chromium, f.clock, () => { }); assert.equal(f.clicks(), 1); assert.equal(r.cartMutationCount, 0); assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.mutationOutcome, 'UNKNOWN'); assert.equal(r.status, 'CART_OUTCOME_UNCONFIRMED'); assert.equal(r.failureStage, 'ACTION');
});
test('M5.7 browser request attempting checkout is blocked before dispatch', async () => {
  const f = fakeRuntime({ actionUrl: 'https://www.amazon.com.mx/checkout' }); const r = await runCartResearch(config, f.chromium, f.clock, () => { }); assert.equal(r.cartMutationCount, 0); assert.equal(r.checkoutAttempts, 0); assert.equal(r.cartConfirmed, false); assert.equal(r.routingCounts.forbiddenRequestsBlocked, 1);
});
test('M5.7 pre-cancelled operation does not launch or click', async () => {
  const f = fakeRuntime(); const controller = new AbortController(); controller.abort(); const r = await runCartResearch(config, f.chromium, f.clock, () => assert.fail('No claim'), controller.signal); assert.equal(r.reason, 'CANCELLED'); assert.equal(f.launches(), 0);
});
test('M5.7 research remains isolated from production monitoring, IPC and backend replay', () => {
  const runtime = readFileSync('scripts/amazon-cart-research-runtime.mjs', 'utf8'); assert.doesNotMatch(runtime, /route\.fetch|\.request\.(?:get|post)|storageState|addCookies|launchPersistentContext|stealth|proxy:|userAgent:|ignoreHTTPSErrors: true/);
  for (const path of ['scripts/amazon-monitor-transport.mjs', 'apps/desktop/src/coordinator/adapter-worker.ts', 'packages/contracts/src/index.ts']) assert.doesNotMatch(readFileSync(path, 'utf8'), /cart-research|CART_RESEARCH|BrowserCartTransport|BackendCartTransport/);
});

test('M5.7A consumed first ID is retained and second ID is accepted once', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-correction-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = 'm5-7-b0gyvhlp4l-first'; const second = 'm5-7-b0gyvhlp4l-second';
  claimResearchOperation(first, dir); claimResearchOperation(second, dir);
  assert.throws(() => claimResearchOperation(first, dir), /OPERATION_ALREADY_CONSUMED/);
  assert.throws(() => claimResearchOperation(second, dir), /OPERATION_ALREADY_CONSUMED/);
});
for (const [body, contentType] of [['SECRET_CANARY%opaque', 'application/octet-stream'], ['x'.repeat(70000), 'application/json'], ['{invalid', 'application/json']]) test(`M5.7A qualified action passes unsupported ${contentType} without requiring inspection`, () => {
  const r = createCartRouting(config); const input = { ...request, type: 'xhr', contentType, body };
  assert.equal(r.decide(input).allowed, false); r.arm(); const decision = r.decide(input);
  assert.equal(decision.allowed, true); assert.equal(decision.routingDecision, 'ALLOW_NATURAL_ACTION');
  assert.equal(inspectSemantic(body, contentType, config.asin).inspected, false);
  assert.equal(r.decide(input).allowed, false);
});
test('M5.7A inspection uncertainty cannot grant arbitrary Amazon or other-host POST authority', () => {
  for (const url of ['https://www.amazon.com.mx/hz/aj/unknown', 'https://www.amazon.com.mx/unknown', 'https://telemetry.amazon.com.mx/gp/add-to-cart/html', 'https://amazon.com.mx.evil.test/gp/add-to-cart/html', 'https://evil.test/gp/add-to-cart/html']) {
    const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, url, type: 'xhr', body: 'opaque', contentType: 'application/octet-stream' }).allowed, false);
  }
  const r = createCartRouting({ ...config, mode: 'DRY_RUN' }); r.arm(); assert.equal(r.decide(request).allowed, false);
});
for (const path of ['/checkout', '/orders', '/payment', '/address', '/gift-card', '/submit-order', '/gp/buy/spc']) test(`M5.7A opaque bodies never exempt forbidden destination ${path}`, () => {
  const r = createCartRouting(config); r.arm(); const d = r.decide({ ...request, url: `https://www.amazon.com.mx${path}`, body: 'opaque', contentType: 'application/octet-stream', type: 'xhr' });
  assert.equal(d.allowed, false); assert.equal(d.reason, 'FORBIDDEN_PATH');
});
test('M5.7A known JSON context mismatches remain rejected', () => {
  for (const data of [{ asin: 'B0H78BB9TY', quantity: 1 }, { asin: config.asin, quantity: 2 }]) {
    const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, body: JSON.stringify(data), contentType: 'application/json', type: 'xhr' }).allowed, false);
  }
});
test('M5.7A opaque token encoding does not become URL authority failure', () => {
  const r = createCartRouting(config); r.arm(); assert.equal(r.decide({ ...request, body: request.body + '&csrfToken=opaque%value' }).allowed, true);
  const denied = createCartRouting(config); denied.arm(); assert.equal(denied.decide({ ...request, body: request.body + '&csrfToken=opaque%value&action=%2563heckout' }).reason, 'FORBIDDEN_PATH');
});
test('M5.7A browser metadata-only cart dispatch separates routing from evidence and confirms only observable state', async () => {
  const f = fakeRuntime({ contentType: 'application/octet-stream', actionBody: 'SECRET_CANARY%opaque', resourceType: 'xhr' });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { }); const row = r.actionRequests[0];
  assert.equal(f.clicks(), 1); assert.equal(row.routingDecision, 'ALLOW_NATURAL_ACTION'); assert.equal(row.inspectionDecision, 'METADATA_ONLY');
  assert.equal(row.firstParty, true); assert.equal(row.hostClass, 'APPROVED_AMAZON_MX'); assert.equal(row.requestEvidence.inspected, false);
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartMutationCount, 1); assert.equal(r.mutationOutcome, 'CONFIRMED');
  assert.equal(r.postActionConfirmation.productBound, true); assert.equal(r.cartConfirmedRequest.classification, 'CART_CONFIRMED');
  assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY/);
});
test('M5.7A allowed HTTP 200 with ambiguous UI is not a confirmed mutation', async () => {
  const f = fakeRuntime({ contentType: 'application/octet-stream', actionBody: 'SECRET_CANARY', ui: { cartCount: 0, itemAsins: [] } });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.clickAttemptCount, 1); assert.equal(r.cartMutationCount, 0);
  assert.equal(r.mutationOutcome, 'UNKNOWN'); assert.equal(r.status, 'CART_OUTCOME_UNCONFIRMED'); assert.equal(r.cartConfirmedRequest, null);
});

const qualifiedRequest = { ...request, url: 'https://www.amazon.com.mx/cart/add-to-cart/opaque-fixture', type: 'xhr', contentType: 'application/octet-stream', body: 'SECRET_CANARY' };
function armQualified(c = config, evidence = before, claimed = c.operationId, click = true) {
  const r = createCartRouting(c); r.arm(evidence, claimed); if (click) r.beginBrowserClick(); return r;
}
test('M5.7B qualified path is blocked in BASELINE and without browser click initiation', () => {
  assert.equal(createCartRouting(config).decide(qualifiedRequest).allowed, false);
  assert.equal(armQualified(config, before, config.operationId, false).decide(qualifiedRequest).allowed, false);
});
for (const patch of [{ mode: 'DRY_RUN' }, { researchOnly: false }, { researchOptIn: false }, { marketplace: 'US' }, { asin: 'B0H78BB9TY' }, { purchaseMode: 'PREORDER' }, { action: 'RESERVE_PREORDER' }, { quantity: 2 }]) test(`M5.7B qualified path rejects config ${JSON.stringify(patch)}`, () => {
  assert.equal(armQualified({ ...config, ...patch }).decide(qualifiedRequest).allowed, false);
});
for (const patch of [{ asin: 'B0H78BB9TY' }, { marketplace: 'US' }, { identityMatched: false }, { availability: 'UNAVAILABLE' }, { purchaseMode: 'PREORDER' }, { actionVisible: false }, { challenge: true }]) test(`M5.7B qualified path rejects page ${JSON.stringify(patch)}`, () => {
  assert.equal(armQualified(config, { ...before, ...patch }).decide(qualifiedRequest).allowed, false);
});
test('M5.7B no claimed operation or mismatched claim cannot qualify the new path', () => {
  for (const claimed of [null, 'different-operation']) assert.equal(armQualified(config, before, claimed).decide(qualifiedRequest).allowed, false);
});
test('M5.7B qualified natural cart suffix passes once and cannot arm or dispatch twice', () => {
  const r = armQualified(); const d = r.decide(qualifiedRequest);
  assert.equal(d.routingDecision, 'ALLOW_NATURAL_CART_ACTION'); assert.equal(d.classification, 'CART_CANDIDATE'); assert.equal(d.allowed, true);
  assert.equal(r.decide(qualifiedRequest).allowed, false); assert.equal(r.decide(request).allowed, false); assert.equal(r.counts.cartRequests, 1);
  assert.throws(() => r.beginBrowserClick(), /CLICK_ALREADY_CONSUMED/); assert.throws(() => r.arm(before, config.operationId));
  const legacyFirst = armQualified(); assert.equal(legacyFirst.decide(request).allowed, true); assert.equal(legacyFirst.decide(qualifiedRequest).allowed, false);
});
test('M5.7B request shape, host, and unknown mutation boundaries remain closed', () => {
  for (const patch of [{ method: 'GET', type: 'document' }, { type: 'fetch' }, { main: false }, { redirect: true }, { url: 'https://evil.test/cart/add-to-cart/opaque-fixture' }, { url: 'https://cart.amazon.com.mx/cart/add-to-cart/opaque-fixture' }, { url: 'https://www.amazon.com.mx/cart/remove/opaque-fixture' }, { url: 'https://www.amazon.com.mx/cart/unknown/opaque-fixture' }, { url: 'https://www.amazon.com.mx/cart/add-to-cart/a/b' }]) {
    assert.equal(armQualified().decide({ ...qualifiedRequest, ...patch }).allowed, false);
  }
});
test('M5.7B forbidden destinations and encoded forbidden body remain absolute for suffix path', () => {
  for (const suffix of ['checkout', 'place-order', 'submit-order', 'payment', 'address', 'gift-card', 'buy-now']) {
    const d = armQualified().decide({ ...qualifiedRequest, url: `https://www.amazon.com.mx/cart/add-to-cart/${suffix}` }); assert.equal(d.allowed, false); assert.equal(d.reason, 'FORBIDDEN_PATH');
  }
  assert.equal(armQualified().decide({ ...qualifiedRequest, body: 'action=%2563heckout' }).reason, 'FORBIDDEN_PATH');
});
test('M5.7B readable context mismatches still block while opaque form fields stay unknown', () => {
  for (const body of ['ASIN=B0H78BB9TY&quantity=1', `ASIN=${config.asin}&quantity=2`, `ASIN=${config.asin}&ASIN.2=B0H78BB9TY&quantity=1`]) assert.equal(armQualified().decide({ ...qualifiedRequest, contentType: 'application/x-www-form-urlencoded', body }).allowed, false);
  assert.equal(armQualified().decide({ ...qualifiedRequest, contentType: 'application/x-www-form-urlencoded', body: 'csrfToken=SECRET_CANARY' }).allowed, true);
});
test('M5.7B fresh third ID accepted once, first and second remain consumed across reloaded fence', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-third-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third']) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of ['first', 'second', 'third']) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});
for (const resourceType of ['xhr', 'document']) test(`M5.7B browser-only ${resourceType} suffix dispatch correlates with product-bound confirmation`, async () => {
  const f = fakeRuntime({ actionUrl: qualifiedRequest.url, resourceType, nativeEvents: resourceType === 'document', contentType: resourceType === 'document' ? 'application/x-www-form-urlencoded' : 'application/octet-stream', actionBody: resourceType === 'document' ? `ASIN=${config.asin}&quantity=1&offerListingID=SECRET_CANARY&merchantID=ABC` : 'SECRET_CANARY' });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(f.clicks(), 1); assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartMutationCount, 1);
  assert.equal(r.cartCandidateRequests.length, 1); assert.equal(r.newActionCorrelatedRequests.length, 1);
  assert.equal(r.cartConfirmedRequest.routingDecision, 'ALLOW_NATURAL_CART_ACTION'); assert.equal(r.cartConfirmedRequest.inspectionDecision, resourceType === 'document' ? 'SANITIZED' : 'METADATA_ONLY');
  assert.equal(r.cartConfirmedRequest.pathPattern, '/cart/add-to-cart/:redacted'); assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY|opaque-fixture/);
  assert.notEqual(r.backendTransportFeasibility, 'FEASIBLE_CANDIDATE');
});
test('M5.7B suffix HTTP success without product-bound confirmation remains unconfirmed', async () => {
  const f = fakeRuntime({ actionUrl: qualifiedRequest.url, resourceType: 'xhr', contentType: 'application/octet-stream', actionBody: 'SECRET_CANARY', ui: { itemAsins: ['B0H78BB9TY'] } });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartMutationCount, 0); assert.equal(r.cartConfirmedRequest, null); assert.equal(r.status, 'CART_OUTCOME_UNCONFIRMED');
});

test('M5.7C bounded authority diagnostics distinguish same-site from approved authority', () => {
  // Synthetic hostname, not live evidence and never added to an allowlist.
  const d = authorityDiagnostics('https://cart-fixture.amazon.com.mx/cart/add-to-cart/opaque?token=SECRET_CANARY', config.url);
  assert.equal(d.normalizedHostLabel, 'cart-fixture.amazon.com.mx'); assert.equal(d.registrableDomain, 'amazon.com.mx');
  assert.equal(d.withinExpectedDomainBoundary, true); assert.equal(d.sameSite, true); assert.equal(d.sameOrigin, false); assert.equal(d.approvedAuthorityMatch, false);
  const approved = authorityDiagnostics(config.url, config.url); assert.equal(approved.approvedAuthorityMatch, true); assert.equal(approved.sameOrigin, true);
  assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY|opaque|token=/);
});
for (const host of ['cart-fixture.amazon.com.mx', 'telemetry-fixture.amazon.com.mx', 'arbitrary.amazon.com.mx', 'nested.arbitrary.amazon.com.mx']) test(`M5.7C diagnostic MX boundary does not approve mutation on ${host}`, () => {
  const input = { ...qualifiedRequest, url: `https://${host}/cart/add-to-cart/opaque-fixture` };
  assert.equal(createCartRouting(config).decide(input).allowed, false);
  for (const patch of [{}, { mode: 'DRY_RUN' }, { researchOptIn: false }, { asin: 'B0H78BB9TY' }, { marketplace: 'US' }, { purchaseMode: 'PREORDER' }]) assert.equal(armQualified({ ...config, ...patch }).decide(input).allowed, false);
  assert.equal(authorityDiagnostics(input.url, config.url).approvedAuthorityMatch, false);
});
test('M5.7C hostname spoofing and malformed authority cannot appear approved', () => {
  for (const url of ['https://amazon.com.mx.evil.test/cart', 'https://evilamazon.com.mx/cart', 'https://amazon.com.mx@evil.test/cart', 'https://evil.test/?host=amazon.com.mx', 'not a url']) {
    const d = authorityDiagnostics(url, config.url); assert.equal(d.withinExpectedDomainBoundary, false); assert.equal(d.approvedAuthorityMatch, false); assert.equal(d.normalizedHostLabel, 'REDACTED');
  }
  for (const url of ['http://www.amazon.com.mx/cart', 'https://user:SECRET_CANARY@www.amazon.com.mx/cart', 'https://www.amazon.com.mx:8443/cart']) {
    const d = authorityDiagnostics(url, config.url); assert.equal(d.approvedAuthorityMatch, false); assert.equal(d.normalizedHostLabel, 'REDACTED'); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
  }
});
test('M5.7C sensitive or opaque host labels are redacted independently of boundary classification', () => {
  for (const label of ['session-secret', 'token', 'auth-secret', 'a1234567890', 'a'.repeat(40)]) {
    const d = authorityDiagnostics(`https://${label}.amazon.com.mx/cart?token=SECRET_CANARY`, config.url);
    assert.equal(d.normalizedHostLabel, 'REDACTED'); assert.equal(d.registrableDomain, 'amazon.com.mx'); assert.equal(d.approvedAuthorityMatch, false);
  }
});
test('M5.7C subdomain path projection exposes cart vocabulary without opaque suffix/query', () => {
  assert.equal(pathPattern('https://cart-fixture.amazon.com.mx/cart/add-to-cart/SECRET_CANARY?token=SECRET_CANARY'), '/cart/add-to-cart/:redacted');
  assert.equal(pathPattern('https://cart-fixture.amazon.com.mx/SECRET_CANARY/other?token=SECRET_CANARY'), '/:redacted/:redacted');
  assert.equal(pathPattern('https://amazon.com.mx.evil.test/cart/add-to-cart/SECRET_CANARY'), 'OTHER_HOST_REDACTED');
});
test('M5.7C forbidden source diagnostics prove check precedes authority qualification', () => {
  for (const [patch, location] of [[{ url: 'https://cart-fixture.amazon.com.mx/checkout' }, 'PATH'], [{ url: 'https://cart-fixture.amazon.com.mx/cart/add-to-cart/opaque?act=%2563heckout' }, 'QUERY'], [{ url: 'https://cart-fixture.amazon.com.mx/cart/add-to-cart/opaque', body: 'SECRET_CANARY&action=payment' }, 'BODY']]) {
    const d = armQualified().decide({ ...qualifiedRequest, ...patch }); assert.equal(d.allowed, false); assert.equal(d.reason, 'FORBIDDEN_PATH'); assert.deepEqual(d.forbiddenLocations, [location]); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
  }
});
test('M5.7C telemetry/OTHER POST remains blocked beside cart-shaped XHR', () => {
  const r = armQualified(); const d = r.decide({ ...qualifiedRequest, url: 'https://telemetry-fixture.amazon.com.mx/metrics', type: 'OTHER' });
  assert.equal(d.allowed, false); assert.equal(d.reason, 'UNQUALIFIED_BACKGROUND_REQUEST'); assert.equal(r.counts.cartRequests, 0);
});
test('M5.7C browser rows retain safe diagnostics for denied subdomain requests without changing routing', async () => {
  const f = fakeRuntime({ actionUrl: 'https://cart-fixture.amazon.com.mx/cart/add-to-cart/opaque-fixture', resourceType: 'xhr', contentType: 'application/octet-stream', actionBody: 'SECRET_CANARY' });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { }); const row = r.actionRequests[0];
  assert.equal(row.normalizedHostLabel, 'cart-fixture.amazon.com.mx'); assert.equal(row.sameSite, true); assert.equal(row.approvedAuthorityMatch, false); assert.equal(row.qualifiedCartPathMatch, true);
  assert.equal(row.hostClass, 'AMAZON_MX_SUBDOMAIN_UNAPPROVED'); assert.equal(row.allowed, false); assert.equal(row.inspectionDecision, 'METADATA_ONLY');
  assert.equal(r.cartRequestDispatchCount, 0); assert.equal(r.cartMutationCount, 0); assert.equal(r.cartCandidateRequests.length, 0); assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY|opaque-fixture/);
});
test('M5.7C correlation distinguishes safe public host labels rather than merging different authorities', () => {
  const base = { phase: 'BASELINE', method: 'POST', pathPattern: '/:redacted', normalizedHostLabel: 'first-fixture.amazon.com.mx', hostClass: 'AMAZON_MX_SUBDOMAIN_UNAPPROVED', allowed: false, requestEvidence: inspectSemantic('', 'text/plain', config.asin) };
  assert.equal(correlateTraffic([base, { ...base, phase: 'ACTION', normalizedHostLabel: 'second-fixture.amazon.com.mx' }], false).newActionCorrelatedRequests.length, 1);
});
test('M5.7C fourth ID is accepted once and all three earlier IDs remain consumed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-fourth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third', 'fourth']) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of ['first', 'second', 'third', 'fourth']) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});

const observedCartGet = { ...qualifiedRequest, method: 'GET', body: '' };
test('M5.7D state transition activates before synchronous click-emitted GET/XHR', async () => {
  const f = fakeRuntime({ actionUrl: qualifiedRequest.url, actionMethod: 'GET', resourceType: 'xhr' });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { }); const row = r.cartCandidateRequests[0];
  assert.equal(f.clicks(), 1); assert.equal(row.method, 'GET'); assert.equal(row.phaseAtObservation, 'ACTION'); assert.equal(row.phase, 'ACTION'); assert.equal(row.actionState, 'ACTION_ACTIVE');
  assert.equal(row.qualifiedAuthority, true); assert.equal(row.qualifiedCartPath, true); assert.equal(row.routingDecision, 'ALLOW_NATURAL_CART_ACTION');
  const times = [r.baselineCompletedAt, r.actionArmedAt, r.actionActiveAt, r.clickStartedAt, row.requestObservedAt, r.clickCompletedAt, r.postActionConfirmationAt];
  assert.ok(times.every(Number.isFinite)); for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1]);
  assert.deepEqual(r.actionTimeline.map(e => e.state), ['BASELINE_COMPLETE', 'ACTION_ARMED', 'ACTION_ACTIVE', 'CLICK_STARTED', 'CLICK_COMPLETED', 'POST_ACTION_CONFIRMATION']);
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartMutationCount, 1); assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY|opaque-fixture/);
});
test('M5.7D asynchronous headers cannot promote a BASELINE cart request into ACTION', async () => {
  const f = fakeRuntime({ actionUrl: qualifiedRequest.url, actionMethod: 'GET', resourceType: 'xhr', delayedBaseline: true });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  const baseline = r.baselineRequests.find(row => row.qualifiedCartPathMatch); const action = r.cartCandidateRequests[0];
  assert.equal(baseline.phaseAtObservation, 'BASELINE'); assert.equal(baseline.actionState, 'BASELINE'); assert.equal(baseline.allowed, false); assert.equal(baseline.blockedReason, 'CART_ACTION_FENCE');
  assert.ok(baseline.requestObservedAt < r.actionActiveAt); assert.equal(action.phaseAtObservation, 'ACTION'); assert.ok(baseline.sequence < action.sequence);
  assert.equal(r.cartCandidateRequests.length, 1); assert.equal(r.newActionCorrelatedRequests.length, 1); assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartConfirmedRequest.method, 'GET');
});
test('M5.7D GET/XHR requires active click state and stays blocked during baseline or arming', () => {
  const r = createCartRouting(config); const baseline = r.captureObservation(); assert.equal(r.decide(observedCartGet).allowed, false);
  r.completeBaseline(); assert.equal(r.captureObservation().actionState, 'BASELINE_COMPLETE'); r.arm(before, config.operationId);
  const armed = r.captureObservation(); assert.equal(armed.actionState, 'ACTION_ARMED'); assert.equal(r.decide(observedCartGet).allowed, false);
  r.beginBrowserClick(); assert.equal(r.captureObservation().actionState, 'ACTION_ACTIVE');
  assert.equal(r.decide({ ...observedCartGet, observation: baseline }).allowed, false); assert.equal(r.decide({ ...observedCartGet, observation: armed }).allowed, false);
  assert.equal(r.decide(observedCartGet).allowed, true); assert.equal(r.decide(observedCartGet).allowed, false);
});
test('M5.7D observed GET exemption does not expand authority or request type', () => {
  for (const patch of [{ url: 'https://amazon.com.mx/cart/add-to-cart/opaque-fixture' }, { type: 'document' }, { type: 'fetch' }, { method: 'HEAD' }]) assert.equal(armQualified().decide({ ...observedCartGet, ...patch }).allowed, false);
  assert.equal(armQualified({ ...config, researchOptIn: false }).decide(observedCartGet).allowed, false);
  assert.equal(armQualified({ ...config, marketplace: 'US' }).decide(observedCartGet).allowed, false);
});
for (const host of ['unagi.amazon.com.mx', 'fls-na.amazon.com.mx']) test(`M5.7D ${host} stays mutation-blocked for GET and POST even after click`, () => {
  for (const method of ['GET', 'POST']) assert.equal(armQualified().decide({ ...qualifiedRequest, method, url: `https://${host}/cart/add-to-cart/opaque-fixture` }).allowed, false);
});
test('M5.7D forbidden operations and late background remain blocked during active action', () => {
  for (const suffix of ['checkout', 'place-order', 'submit-order', 'payment']) assert.equal(armQualified().decide({ ...observedCartGet, url: `https://www.amazon.com.mx/cart/add-to-cart/${suffix}` }).reason, 'FORBIDDEN_PATH');
  assert.equal(armQualified().decide({ ...qualifiedRequest, url: 'https://www.amazon.com.mx/metrics', type: 'OTHER' }).allowed, false);
});
test('M5.7D failed click has no completion/confirmation timestamp and never retries', async () => {
  const f = fakeRuntime({ actionUrl: qualifiedRequest.url, actionMethod: 'GET', resourceType: 'xhr', clickThrows: true });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(f.clicks(), 1); assert.equal(r.clickCompletedAt, null); assert.equal(r.postActionConfirmationAt, null);
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.cartMutationCount, 0); assert.equal(r.status, 'CART_OUTCOME_UNCONFIRMED'); assert.equal(f.closed(), 2);
});
test('M5.7D halted action cannot dispatch a previously observed request', () => {
  const r = armQualified(); const observation = r.captureObservation(); r.halt(); assert.equal(r.decide({ ...observedCartGet, observation }).reason, 'HALTED');
});
test('M5.7D five operation IDs are independently consumed without resetting previous guards', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-fifth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth']) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth']) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});
for (const controls of [{ selectedPrimaryIndex: null }, { pinnedMatchesSelection: false }, { candidateScanCapped: true }]) test(`M5.7E no click without unambiguous pinned diagnostic target ${JSON.stringify(controls)}`, async () => {
  const f = fakeRuntime({ controls }); const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(f.clicks(), 0); assert.equal(r.cartRequestDispatchCount, 0); assert.equal(r.cartMutationCount, 0); assert.equal(r.status, 'BLOCKED'); assert.ok(r.clickTargetDiagnostics);
});
test('M5.7E sixth ID is accepted once while all five prior IDs remain consumed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-sixth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});

test('M5.7G eighth ID is usable once in an isolated fence; all seven prior IDs stay consumed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-eighth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prior = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  for (const suffix of prior) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  claimResearchOperation('m5-7-b0gyvhlp4l-eighth', dir);
  for (const suffix of [...prior, 'eighth']) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});

test('M5.7H ninth operation is single-use without resetting any prior operation', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-ninth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const suffixes = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
  for (const suffix of suffixes) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of suffixes) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});

const nativeUrl = 'https://www.amazon.com.mx/cart/add-to-cart/ref=AUTHORED';
const nativeBody = `ASIN=${config.asin}&quantity=1&offerListingID=SECRET_CANARY&merchantID=AVDBXBAVVSXLQ&session-id=SECRET_CANARY_checkout&anti-csrftoken-a2z=SECRET_CANARY_payment&signature=SECRET_CANARY_address`;
function nativeFixture({ eventPatch = {}, noSubmit = false, requestAt = 130, now = 140, pageEvidence = before, afterClick = false, requestPatch = {} } = {}) {
  const r = createCartRouting(config); r.arm(pageEvidence, config.operationId); r.beginBrowserClick();
  const c = nativeCartCausality(); c.arm(100);
  c.observe({ kind: 'CLICK', browserAt: 110, trusted: true, defaultPrevented: false, productBound: true, ...eventPatch });
  if (!noSubmit) c.observe({ kind: 'SUBMIT', browserAt: 120, trusted: true, defaultPrevented: false, productBound: true, ...eventPatch });
  if (afterClick) r.beginConfirmation();
  const req = { url: nativeUrl, method: 'POST', type: 'document', main: true, body: nativeBody, contentType: 'application/x-www-form-urlencoded', nativeEvidence: c.evidence(requestAt, now), ...requestPatch };
  return { r, c, req, decide: () => r.decide(req) };
}

test('M5.7I pinned trusted native form can dispatch once after click completion; secrets remain opaque', () => {
  const f = nativeFixture({ afterClick: true }); assert.equal(f.r.captureObservation().actionState, 'POST_ACTION_CONFIRMATION');
  const d = f.decide(); assert.equal(d.allowed, true); assert.equal(d.routingDecision, 'ALLOW_NATURAL_CART_ACTION'); assert.equal(d.qualifiedCartPathMatch, true); assert.equal(d.nativeForm.sensitiveMaterialPresent, true); assert.equal(d.nativeForm.forbiddenOperation, false);
  assert.equal(f.r.counts.cartRequests, 1); assert.equal(f.decide().allowed, false); assert.equal(f.r.counts.cartRequests, 1); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
});

for (const field of ['session-id', 'sessionId', 'token', 'csrfToken', 'anti-csrftoken-a2z', 'signature', 'authorization', 'offerListingID']) test(`M5.7I recognized ${field} values are not operation semantics or retained`, () => {
  const body = nativeBody.replace(/&offerListingID=[^&]+/, '') + (field === 'offerListingID' ? '' : '&offerListingID=OPAQUE') + `&${field}=SECRET_CANARY_checkout_payment_address`;
  const d = nativeFixture({ requestPatch: { body } }).decide(); assert.equal(d.allowed, true);
  const evidence = inspectSemantic(body, 'application/x-www-form-urlencoded', config.asin);
  assert.doesNotMatch(JSON.stringify({ d, evidence, policy: nativeFormBodyPolicy(body, 'application/x-www-form-urlencoded', config.asin) }), /SECRET_CANARY/);
});

for (const extra of ['action=checkout', 'checkoutToken=OPAQUE', 'action=place-order', 'action=submit_order', 'payment=0', 'addressId=OPAQUE', 'giftCard=false', 'action=buy-now', 'action=order', 'action=signin', 'account=OPAQUE', 'action=%2563heckout', 'unknown=SECRET_checkout', 'redirect=%2Fap%2Fsignin']) test(`M5.7I hard-deny native operation ${extra}`, () => {
  const d = nativeFixture({ requestPatch: { body: nativeBody + '&' + extra } }).decide(); assert.equal(d.allowed, false); assert.equal(d.reason, 'FORBIDDEN_PATH'); assert.deepEqual(d.forbiddenLocations, ['BODY']);
});

for (const patch of [
  { url: 'https://unagi.amazon.com.mx/cart/add-to-cart/ref=A' }, { url: 'https://fls-na.amazon.com.mx/cart/add-to-cart/ref=A' },
  { url: 'https://amazon.com.mx/cart/add-to-cart/ref=A' }, { url: 'https://www.amazon.com.mx/cart/other/A' },
  { url: 'https://www.amazon.com.mx/checkout' }, { url: 'https://www.amazon.com.mx/cart/add-to-cart/a/b' },
  { url: nativeUrl + '?ASIN=B0H78BB9TY' }, { url: nativeUrl + '?next=checkout' }, { main: false }, { redirect: true }
]) test(`M5.7I native authority/path/frame/query fence ${JSON.stringify(patch)}`, () => assert.equal(nativeFixture({ requestPatch: patch }).decide().allowed, false));

for (const change of ['asin', 'quantity', 'missingOffer', 'missingMerchant', 'duplicateAsin', 'indexedQuantity', 'oversized', 'unknownContentType']) test(`M5.7I native form ${change} fails without dispatch`, () => {
  let body = nativeBody; let contentType = 'application/x-www-form-urlencoded';
  if (change === 'asin') body = body.replace(config.asin, 'B0H78BB9TY');
  if (change === 'quantity') body = body.replace('quantity=1', 'quantity=2');
  if (change === 'missingOffer') body = body.replace(/&offerListingID=[^&]+/, '');
  if (change === 'missingMerchant') body = body.replace(/&merchantID=[^&]+/, '');
  if (change === 'duplicateAsin') body += `&ASIN=${config.asin}`;
  if (change === 'indexedQuantity') body += '&quantity.1=1';
  if (change === 'oversized') body += '&token=' + 'x'.repeat(66000);
  if (change === 'unknownContentType') contentType = 'application/octet-stream';
  const f = nativeFixture({ requestPatch: { body, contentType } }); assert.equal(f.decide().allowed, false); assert.equal(f.r.counts.cartRequests, 0);
});

for (const options of [{ noSubmit: true }, { eventPatch: { trusted: false } }, { eventPatch: { defaultPrevented: true } }, { eventPatch: { productBound: false } }, { requestAt: 115 }, { requestAt: 2200, now: 2300 }, { now: 2200 }, { pageEvidence: { ...before, asin: 'B0H78BB9TY' } }]) test(`M5.7I causal/context fence ${JSON.stringify(options)}`, () => assert.equal(nativeFixture(options).decide().allowed, false));

test('M5.7I unrelated interaction or repeated native event invalidates the envelope', () => {
  for (const kind of ['CLICK', 'SUBMIT', 'OTHER_INTERACTION']) {
    const f = nativeFixture(); f.c.observe({ kind, browserAt: 125, trusted: true, defaultPrevented: false, productBound: true });
    assert.equal(f.r.decide({ ...f.req, nativeEvidence: f.c.evidence(130, 140) }).allowed, false);
  }
});

test('M5.7I baseline observation cannot be promoted by later trusted events and headers', () => {
  const r = createCartRouting(config); const observation = r.captureObservation(); const f = nativeFixture();
  assert.equal(f.r.decide({ ...f.req, observation }).allowed, false);
});

test('M5.7I eligibility preserved with M5.7J immutable event evidence, unmodified continue and sanitized result', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, actionBody: nativeBody });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 1); assert.equal(result.cartConfirmed, true); assert.equal(result.cartMutationCount, 1); assert.equal(f.clicks(), 1);
  assert.equal(result.nativeFormEventTimeline.length, 2); assert.equal(result.cartCandidateRequests[0].nativeFormDiagnostics.causalEnvelopeQualified, true);
  assert.equal(result.backendTransportFeasibility, 'SESSION_BOUND / HIGH_FRAGILITY'); assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY/);
  for (const name of ['checkoutAttempts', 'ordersCreated', 'paymentAttempts', 'directPrivateCalls', 'replayCount']) assert.equal(result[name], 0);
});

test('M5.7I full runtime without trusted submit cannot use the native body exception', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: false, actionBody: nativeBody });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 0); assert.equal(result.cartConfirmed, false); assert.equal(result.cartMutationCount, 0); assert.equal(f.clicks(), 1);
});

test('M5.7I dispatched HTTP success without correct cart state stays UNKNOWN and never retries', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, actionBody: nativeBody, ui: { cartCount: 0, itemAsins: [] } });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 1); assert.equal(result.cartConfirmed, false); assert.equal(result.cartMutationCount, 0); assert.equal(result.mutationOutcome, 'UNKNOWN'); assert.equal(f.clicks(), 1);
});

test('M5.7I tenth operation is single-use and all nine prior operation IDs stay consumed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-tenth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const suffixes = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  for (const suffix of suffixes) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of suffixes) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});

test('M5.7J malformed value-serialized evidence now blocks eligibility without poisoning route processing', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, serializedNativeEvents: true, afterClickRequest: true, actionBody: nativeBody });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.notEqual(result.reason, 'ROUTE_PROCESSING_FAILED'); assert.equal(result.cartRequestDispatchCount, 0); assert.equal(result.nativeFormEventTimeline[0].kind, 'INVALID_EVENT');
});

test('M5.7J post-click native continuation succeeds with serialized immutable events and no live handles', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 1); assert.equal(result.cartMutationCount, 1); assert.equal(result.routeProcessingFailure, undefined);
  assert.equal(result.nativeFormEventTimeline.length, 2); assert.equal(Object.isFrozen(result.nativeFormEventTimeline[0]), true);
  const row = result.cartCandidateRequests[0]; assert.equal(row.actionState, 'POST_ACTION_CONFIRMATION'); assert.equal(row.passThroughSucceeded, true);
});

for (const [options, stage, category] of [
  [{ continueThrows: true }, 'CONTINUE', 'ROUTE_LIFECYCLE_ERROR'],
  [{ bodyThrows: true }, 'BODY_READ', 'BODY_PARSE_FAILURE'],
  [{ actionHeaderFails: true }, 'HEADERS', 'UNKNOWN_INTERNAL'],
  [{ actionHeaderFails: true, staleFailure: true }, 'HEADERS', 'STALE_BROWSER_HANDLE']
]) test(`M5.7J injected ${category}/${stage} stays fail-closed with sanitized exact request diagnostics`, async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody, ...options });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.reason, 'ROUTE_PROCESSING_FAILED'); assert.equal(result.cartRequestDispatchCount, 0); assert.equal(result.cartMutationCount, 0); assert.equal(result.cartConfirmed, false);
  assert.equal(result.routeProcessingFailure.stage, stage); assert.equal(result.routeProcessingFailure.errorCategory, category); assert.equal(result.routeProcessingFailure.requestSequence, 2);
  assert.equal(result.routeProcessingFailure.pathClass, 'STRICT_CART_ADD'); assert.equal(result.routeProcessingFailure.method, 'POST'); assert.equal(result.routeProcessingFailure.actionState, 'POST_ACTION_CONFIRMATION');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|SECRET_HEADER_FAILURE/); assert.equal(f.clicks(), 1);
  if (stage === 'CONTINUE') { assert.equal(result.routingCounts.cartRequests, 1); assert.equal(result.cartCandidateRequests[0].passThroughSucceeded, false); }
});

test('M5.7J single-use dispatch reservation stays consumed on continuation failure', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody, continueThrows: true, repeatRequest: true });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 0); assert.equal(result.routingCounts.cartRequests, 1); assert.equal(result.routeProcessingFailure.stage, 'CONTINUE');
  assert.equal(result.actionRequests.at(-1).blockedReason, 'HALTED'); assert.equal(result.mutationOutcome, 'UNKNOWN');
});

test('M5.7J successful continuation still permits only one native request', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody, repeatRequest: true });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.cartRequestDispatchCount, 1); assert.equal(result.routingCounts.cartRequests, 1); assert.equal(result.actionRequests.filter(row => row.passThroughSucceeded).length, 1);
});

test('M5.7J route failure reason survives an exception before click promise completion', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, actionBody: nativeBody, continueThrows: true });
  const result = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(result.reason, 'ROUTE_PROCESSING_FAILED'); assert.equal(result.cartRequestDispatchCount, 0); assert.equal(result.routeProcessingFailure.stage, 'CONTINUE');
});

test('M5.7J eleventh ID is single-use; all ten prior IDs remain consumed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-eleventh-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const suffixes = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh'];
  for (const suffix of suffixes) claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir);
  for (const suffix of suffixes) assert.throws(() => claimResearchOperation(`m5-7-b0gyvhlp4l-${suffix}`, dir), /OPERATION_ALREADY_CONSUMED/);
});


test('M5.7K Run 11 records FIELD_NAME but cannot identify the redacted matching key', { skip: !existsSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-eleventh.json') || !existsSync('outputs/M5_7K_SOURCE_BASELINE.json') }, () => {
  const r = JSON.parse(readFileSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-eleventh.json', 'utf8'));
  const row = r.actionRequests.find(x => x.sequence === 290);
  assert.equal(row.nativeFormDiagnostics.qualified, true);
  assert.deepEqual(row.nativeFormDiagnostics.forbiddenOperationSources, ['FIELD_NAME']);
  assert.equal(r.cartRequestDispatchCount, 0);
  const prior = JSON.parse(readFileSync('outputs/M5_7K_SOURCE_BASELINE.json', 'utf8'));
  const source = prior['scripts/amazon-cart-native-form.mjs'].source;
  assert.match(source, /if \(operation\(name\) &&/);
  const legacy = /purchase/i;
  assert.equal(legacy.test('repurchaseToken'), true);
  assert.equal(classifyFieldName('repurchaseToken').classification, 'SENSITIVE_TOKEN_FIELD');
});

for (const [name, expected] of [
  ['ASIN', 'PUBLIC_CART_FIELD'], ['quantity', 'PUBLIC_CART_FIELD'], ['merchantID', 'PUBLIC_CART_FIELD'], ['offerListingID', 'PUBLIC_CART_FIELD'], ['submit.add-to-cart', 'PUBLIC_CART_FIELD'],
  ['session-id', 'SENSITIVE_SESSION_FIELD'], ['authorization', 'SENSITIVE_SESSION_FIELD'], ['auth', 'SENSITIVE_SESSION_FIELD'], ['anti-csrftoken-a2z', 'SENSITIVE_TOKEN_FIELD'], ['signature', 'SENSITIVE_TOKEN_FIELD'], ['repurchaseToken', 'SENSITIVE_TOKEN_FIELD'], ['privatePayload', 'SENSITIVE_PRIVATE_FIELD'], ['submit', 'UNKNOWN_FIELD'], ['opaqueUnknown', 'UNKNOWN_FIELD']
]) test('M5.7K semantic class ' + name, () => {
  assert.equal(classifyFieldName(name).classification, expected);
  const body = nativeBody + '&' + encodeURIComponent(name) + '=REDACTED_FIXTURE';
  const result = nativeFormBodyPolicy(body, 'application/x-www-form-urlencoded', config.asin);
  assert.equal(result.forbiddenOperation, false);
  assert.doesNotMatch(JSON.stringify({ result, evidence: inspectSemantic(body, 'application/x-www-form-urlencoded', config.asin) }), /REDACTED_FIXTURE|repurchaseToken|privatePayload|opaqueUnknown/);
});

for (const name of ['checkout', 'checkoutToken', 'checkouttoken', 'place-order', 'submit-order', 'submitOrder', 'payment', 'paymentInstrument', 'addressId', 'updateAddress', 'gift-card', 'giftCard', 'buy-now-completion', 'buyNow', 'account', 'accountSecurity', 'securityMutation', 'signin', '/ap/', 'checkout%2554oken']) test('M5.7K explicit forbidden field ' + name, () => {
  const d = nativeFixture({ requestPatch: { body: nativeBody + '&' + name + (name === 'buyNow' ? '=true' : '=false') } }).decide();
  assert.equal(d.allowed, false); assert.equal(d.reason, 'FORBIDDEN_PATH'); assert.deepEqual(d.forbiddenLocations, ['BODY']);
  assert.ok(d.nativeForm.forbiddenFieldCategories.length > 0);
});

for (const path of ['/checkout', '/place-order', '/submit-order', '/payment', '/address', '/gift-card', '/buy-now', '/account/security', '/ap/signin']) test('M5.7K forbidden path still blocked ' + path, () => {
  assert.equal(nativeFixture({ requestPatch: { url: 'https://www.amazon.com.mx' + path } }).decide().allowed, false);
});

test('M5.7K unknown and sensitive classes never confer authority or waive arbitrary values', () => {
  for (const body of ['unknown=1', nativeBody.replace('quantity=1', 'quantity=2') + '&token=OPAQUE', nativeBody + '&privatePayload=checkout', nativeBody + '&repurchaseToken=payment']) {
    assert.equal(nativeFixture({ requestPatch: { body } }).decide().allowed, false);
  }
  assert.equal(nativeFixture({ noSubmit: true, requestPatch: { body: nativeBody + '&repurchaseToken=OPAQUE' } }).decide().allowed, false);
});

test('M5.7K corrected semantic field traverses unchanged native runtime once with redacted diagnostics', async () => {
  const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody + '&repurchaseToken=REDACTED_FIXTURE&submit.add-to-cart=Add', repeatRequest: true });
  const r = await runCartResearch(config, f.chromium, f.clock, () => { });
  assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.routingCounts.cartRequests, 1);
  const row = r.actionRequests.find(x => x.passThroughSucceeded);
  assert.ok(row.nativeFormDiagnostics.fieldClassifications.SENSITIVE_TOKEN_FIELD);
  assert.deepEqual(row.nativeFormDiagnostics.legacyNameMatchClasses, ['SENSITIVE_TOKEN_FIELD']);
  assert.doesNotMatch(JSON.stringify(r), /REDACTED_FIXTURE|repurchaseToken/);
});

test('M5.7K twelfth isolated operation remains single-use after all eleven consumed IDs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-twelfth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']) {
    const id = 'm5-7-b0gyvhlp4l-' + suffix; claimResearchOperation(id, dir); assert.throws(() => claimResearchOperation(id, dir), /OPERATION_ALREADY_CONSUMED/);
  }
});


test('M5.7L Run 12 proves presence-only BUY_NOW rejection, not live activation', { skip: !existsSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-twelfth.json') || !existsSync('outputs/M5_7L_SOURCE_BASELINE.json') }, () => {
  const r = JSON.parse(readFileSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-twelfth.json', 'utf8'));
  const d = r.actionRequests.find(x => x.sequence === 305).nativeFormDiagnostics;
  assert.equal(d.qualified, true); assert.equal(d.fieldClassifications.FORBIDDEN_OPERATION_FIELD, 1); assert.deepEqual(d.forbiddenFieldCategories, ['BUY_NOW']);
  assert.equal(d.forbiddenFieldStates, undefined); assert.equal(r.cartRequestDispatchCount, 0);
  const old = JSON.parse(readFileSync('outputs/M5_7L_SOURCE_BASELINE.json', 'utf8'))['scripts/amazon-cart-native-form.mjs'].source;
  assert.match(old, /field.classification === 'FORBIDDEN_OPERATION_FIELD'/); assert.doesNotMatch(old, /evaluateForbiddenOperationField/);
  const body = nativeBody + '&isBuyNow=false';
  assert.equal(nativeFormBodyPolicy(body, 'application/x-www-form-urlencoded', config.asin).forbiddenOperation, true);
  const d2 = nativeFixture({ requestPatch: { body } }).decide(); assert.equal(d2.allowed, true); assert.equal(d2.nativeForm.forbiddenFieldPresent, true); assert.equal(d2.nativeForm.forbiddenFieldActivated, false);
});

for (const [value, semantic, state] of [
  ['', 'EMPTY', 'INACTIVE'], ['false', 'FALSEY_BOOLEAN', 'INACTIVE'], ['0', 'ZERO', 'INACTIVE'], ['add-to-cart', 'ADD_TO_CART_ENUM', 'INACTIVE'],
  ['true', 'TRUTHY_BOOLEAN', 'ACTIVE'], ['1', 'NONZERO', 'INACTIVE'], ['2', 'NONZERO', 'INACTIVE'], ['buy-now', 'BUY_NOW_ENUM', 'ACTIVE'], ['SECRET_CANARY', 'UNKNOWN', 'UNKNOWN']
]) test('M5.7L BUY_NOW request value class ' + semantic, () => {
  assert.equal(forbiddenValueSemantic(value, true), semantic);
  const d = nativeFixture({ requestPatch: { body: nativeBody + '&isBuyNow=' + encodeURIComponent(value) } }).decide();
  assert.equal(d.allowed, state === 'INACTIVE'); assert.equal(d.nativeForm.forbiddenFieldStates[0].activation, state);
  assert.equal(d.nativeForm.forbiddenFieldStates[0].origin, 'FORM_FIELD');
  assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY|isBuyNow/);
  if (state === 'UNKNOWN') assert.equal(d.nativeForm.bodyQualificationReason, 'UNKNOWN_FORBIDDEN_FIELD_STATE');
});

for (const name of ['buyNowToken', 'buy-now-completion', 'submit.buy-now', 'buyNow99']) test('M5.7L no blanket BUY_NOW exception for ' + name, () => {
  assert.equal(nativeFixture({ requestPatch: { body: nativeBody + '&' + name + '=false' } }).decide().allowed, false);
});

test('M5.7L selected Buy Now wins, only known nonselected DOM submit siblings are inactive', () => {
  const field = { category: 'BUY_NOW', origin: 'SUBMIT_CONTROL', valueSemantic: 'BUY_NOW_ENUM', clickedSubmitAction: 'ADD_TO_CART' };
  assert.equal(evaluateForbiddenOperationField({ ...field, selectedSubmit: false }), 'INACTIVE');
  assert.equal(evaluateForbiddenOperationField({ ...field, selectedSubmit: true }), 'ACTIVE');
  assert.equal(evaluateForbiddenOperationField(field), 'UNKNOWN');
  assert.equal(evaluateForbiddenOperationField({ ...field, selectedSubmit: false, clickedSubmitAction: 'BUY_NOW' }), 'ACTIVE');
  assert.equal(evaluateForbiddenOperationField({ ...field, selectedSubmit: false, clickedSubmitAction: 'UNKNOWN' }), 'UNKNOWN');
  assert.equal(nativeFixture({ requestPatch: { body: nativeBody + '&submit.buy-now=' } }).decide().allowed, false);
});

for (const options of [{ noSubmit: true }, { eventPatch: { trusted: false } }, { eventPatch: { productBound: false } }, { eventPatch: { defaultPrevented: true } }, { requestAt: 2200, now: 2300 }]) test('M5.7L inactive flag never bypasses native evidence ' + JSON.stringify(options), () => {
  assert.equal(nativeFixture({ ...options, requestPatch: { body: nativeBody + '&isBuyNow=0' } }).decide().allowed, false);
});

for (const patch of [{ url: 'https://unagi.amazon.com.mx/cart/add-to-cart/A' }, { url: 'https://amazon.com.mx/cart/add-to-cart/A' }, { url: 'https://www.amazon.com.mx/buy-now' }, { url: nativeUrl + '?next=checkout' }, { main: false }, { redirect: true }, { body: nativeBody.replace('quantity=1', 'quantity=2') }, { body: nativeBody.replace(config.asin, 'B0H78BB9TY') }, { body: nativeBody.replace(/&merchantID=[^&]+/, '') }]) test('M5.7L inactive flag keeps independent request/context guard ' + JSON.stringify(patch), () => {
  assert.equal(nativeFixture({ requestPatch: { ...patch, body: (patch.body ?? nativeBody) + '&isBuyNow=false' } }).decide().allowed, false);
});

test('M5.7L other operations remain blocked even with false flags and Add-to-Cart evidence', () => {
  for (const name of ['checkout', 'payment', 'place-order', 'submit-order', 'address', 'gift-card', 'account', 'security']) assert.equal(nativeFixture({ requestPatch: { body: nativeBody + '&isBuyNow=false&' + name + '=false' } }).decide().allowed, false);
  assert.equal(nativeFixture({ requestPatch: { body: nativeBody + '&isBuyNow=false&isBuyNow=true' } }).decide().allowed, false);
  assert.equal(nativeFixture({ requestPatch: { body: nativeBody + '&isBuyNow=false&action=buy-now' } }).decide().allowed, false);
});

test('M5.7L inactive flag passes unchanged browser runtime once; failed continuation cannot count', async () => {
  for (const fails of [false, true]) {
    const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody + '&isBuyNow=0', repeatRequest: true, continueThrows: fails });
    const r = await runCartResearch(config, f.chromium, f.clock, () => { });
    assert.equal(r.cartRequestDispatchCount, fails ? 0 : 1); assert.equal(r.routingCounts.cartRequests, 1); assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY|isBuyNow/);
  }
});

test('M5.7L thirteenth isolated operation is single-use after all twelve prior IDs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'astra-cart-thirteenth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const suffix of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth']) { const id = 'm5-7-b0gyvhlp4l-' + suffix; claimResearchOperation(id, dir); assert.throws(() => claimResearchOperation(id, dir), /OPERATION_ALREADY_CONSUMED/); }
});


test('M5.7N runtime persists candidate correlation without permitting ACTIVE or UNKNOWN', async () => {
  for (const value of ['2', 'SECRET_CANARY']) {
    const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: nativeBody + '&isBuyNow=' + value });
    const r = await runCartResearch(config, f.chromium, f.clock, () => { });
    assert.equal(r.cartRequestDispatchCount, value === '2' ? 1 : 0);
    assert.equal(r.cartMutationCount, value === '2' ? 1 : 0);
    assert.equal(r.buyNowFieldCorrelation.serializedBuyNowCandidateKey, 'IS_BUY_NOW');
    assert.equal(r.buyNowFieldCorrelation.correlation, 'BODY_ONLY_NOT_IN_DOM');
    assert.equal(r.buyNowFieldCorrelation.currentActivationState, value === '2' ? 'INACTIVE' : 'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY/);
  }
});

test('M5.7N unavailable diagnostics do not change the existing routing decision', async () => {
  for (const body of [nativeBody, nativeBody + '&isBuyNow=2']) {
    const f = fakeRuntime({ actionUrl: nativeUrl, nativeEvents: true, afterClickRequest: true, actionBody: body, diagnosticThrows: true });
    const r = await runCartResearch(config, f.chromium, f.clock, () => { });
    assert.equal(r.cartRequestDispatchCount, 1); assert.equal(r.buyNowFieldCorrelation.correlation, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(r), /SECRET_DIAGNOSTIC_ERROR/);
  }
});
