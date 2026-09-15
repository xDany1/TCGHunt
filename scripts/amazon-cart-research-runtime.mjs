import { AmazonBrowserProvider, normalizeAmazon } from '@ptcg/adapters';
import { extractAmazonRendered, boundedBrowserStep, withAmazonBrowser } from './amazon-browser-runtime.mjs';
import { AMAZON_BROWSER_CONTEXT } from './amazon-browser-policy.mjs';
import { CART_HOSTS, CART_TARGETS, qualifyCartPage, confirmCart, createCartRouting, researchHostClass, strictNativeCartPath } from './amazon-cart-research-policy.mjs';
import { BODY_CAP, inspectSemantic, headerPresence, pathPattern, correlateTraffic, authorityDiagnostics } from './amazon-cart-research-evidence.mjs';
import { inspectCartControls, installCartEventObservers, sanitizedDomEvent, installInitiatorDiagnostics, publicLocation } from './amazon-cart-causality.mjs';
import { prepareViewportControl } from './amazon-cart-viewport.mjs';
import { installPinnedCartObservers, immutableNativeEvent, nativeCartCausality } from './amazon-cart-native-form.mjs';
import { candidateKeys, installBuyNowDomDiagnostics, sanitizeDomCandidates, sanitizedSubmitter, correlateBuyNowFields } from './amazon-buy-now-diagnostics.mjs';
import { sanitizedRouteFailure } from './amazon-cart-route-diagnostics.mjs';

/** DOM-only projection. Tokens, HTML, form contents, storage and credentials never leave this function. */
export function cartUiSnapshot(action) {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const button = document.querySelector('#add-to-cart-button');
  const label = button?.getAttribute('aria-label') || button?.value || button?.textContent || '';
  const normal = label.trim().replace(/\s+/g, ' ');
  const actionType = /^(?:agregar al carrito|añadir a la cesta|add to cart)$/i.test(normal) ? 'ADD_TO_CART' : /^(?:reserva ahora|reservar ahora|pre-?order now)$/i.test(normal) ? 'RESERVE_PREORDER' : null;
  const count = document.querySelector('#nav-cart-count')?.textContent?.trim();
  const quantity = document.querySelector('#quantity, select[name="quantity"], input[name="quantity"]')?.value;
  const regions = [...document.querySelectorAll('#sw-atc-confirmation, #huc-v2-order-row-container, #sc-active-cart, .sc-list-item')].filter(visible).slice(0, 20);
  const asins = [];
  for (const region of regions) {
    for (const node of [region, ...region.querySelectorAll('[data-asin], a[href]')].slice(0, 50)) {
      const own = node.getAttribute('data-asin'); if (/^[A-Z0-9]{10}$/.test(own ?? '')) asins.push(own);
      try { const u = new URL(node.getAttribute('href'), location.href); if (['www.amazon.com.mx', 'amazon.com.mx'].includes(u.hostname)) { const match = /\/dp\/([A-Z0-9]{10})(?:\/|$)/.exec(u.pathname); if (match) asins.push(match[1]); } } catch { /* No link identity. */ }
    }
  }
  const text = (document.body?.innerText ?? '').slice(0, 30000);
  return {
    actionType, actionVisible: actionType === action && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true', quantity: /^[1-9]\d?$/.test(quantity ?? '') ? Number(quantity) : null,
    cartCount: /^\d{1,2}$/.test(count ?? '') ? Number(count) : null, itemAsins: [...new Set(asins)].slice(0, 20), itemPresent: asins.length > 0,
    challenge: /captcha|robot check|verify you are human|verifica que eres humano|introduce los caracteres/i.test(text) || !!document.querySelector('#captchacharacters'), accessDenied: /access denied|acceso denegado|request blocked/i.test(text)
  };
}
export async function researchPageEvidence(page, config, clock, status) {
  const rendered = await boundedBrowserStep(page.evaluate(extractAmazonRendered), 5000, 'DOM_EXTRACTION_TIMEOUT');
  const ui = await boundedBrowserStep(page.evaluate(cartUiSnapshot, config.action), 5000, 'CART_STATE_TIMEOUT');
  const url = new URL(page.url()); const at = clock.now();
  const target = { asin: config.asin, marketplace: 'MX', url: config.url, deliveryScope: 'amazon-mx:anonymous:location-unvalidated' };
  const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return { ...rendered, target, captureId: `cart-research-${at}`, capturedAt: at, status }; } });
  const parsed = await provider.read(target, { now: at, deadlineAt: at + 1000, operationId: config.operationId, traceId: config.operationId, currency: 'MXN', deliveryScope: target.deliveryScope });
  const n = 'evidence' in parsed ? normalizeAmazon(parsed.evidence) : null; const offer = n?.offers.length === 1 ? n.offers[0] : null;
  return {
    ...ui, marketplace: url.protocol === 'https:' && CART_HOSTS.includes(url.hostname) && !url.port && !url.username && !url.password ? 'MX' : 'UNKNOWN',
    asin: n?.asin ?? null, identityMatched: !!n && n.asin === config.asin && rendered.asins.length > 0 && rendered.asins.every(a => a === config.asin) && /\/dp\//.test(url.pathname) && url.pathname.split('/').includes(config.asin),
    availability: n?.productState?.availability ?? 'UNKNOWN', purchaseMode: n?.productState?.purchaseMode ?? 'UNKNOWN', price: offer?.price ? { minor: String(offer.price.minor), currency: offer.price.currency } : null,
    sellerId: offer?.sellerId && /^(?:amazon-retail-mx|[A-Z0-9]{1,30})$/.test(offer.sellerId) ? offer.sellerId : null, parserResult: parsed.category,
    challenge: ui.challenge || rendered.challenge, accessDenied: ui.accessDenied || rendered.accessDenied || status === 401 || status === 403
  };
}
export function emptyCartResult(config = null) {
  return {
    milestone: 'M5.7', status: 'NOT_EXECUTED', mode: config ? 'CART_RESEARCH' : 'NON_MUTATING', researchOnly: true, target: config ? { marketplace: 'MX', asin: config.asin, quantity: 1 } : null, cartResearchOperationId: config?.operationId ?? null,
    actionType: config?.action ?? null, preActionQualification: null, cartCountBefore: null, cartCountAfter: null, actionExecuted: false, clickAttemptCount: 0, cartConfirmed: false,
    ...correlateTraffic([], false), priceEvidence: null, sellerEvidence: null, offerIdentityEvidence: [], mutationCount: 0, cartMutationCount: 0, cartRequestDispatchCount: 0, mutationOutcome: 'NOT_ATTEMPTED', checkoutAttempts: 0, ordersCreated: 0, paymentAttempts: 0, directPrivateCalls: 0, replayCount: 0,
    startupStage: 'NOT_STARTED', failureStage: null, reason: null, browserClosed: false, limitations: []
  };
}
/** Diagnostic browser action only. Separate from monitoring and every production application/IPC port. */
export async function runCartResearch(config, chromium, clock, claimOperation, signal) {
  const result = emptyCartResult(config); const rows = []; const byRequest = new WeakMap(); const pending = new Set(); const routing = createCartRouting(config);
  result.actionTimeline = []; result.baselineCompletedAt = null; result.actionArmedAt = null; result.actionActiveAt = null; result.clickStartedAt = null; result.clickCompletedAt = null; result.postActionConfirmationAt = null;
  const mark = (field, state) => { const at = clock.now(); result[field] = at; result.actionTimeline.push({ sequence: result.actionTimeline.length + 1, state, at }); };
  let stop = false; let page; let context; let requestSequence = 0; let bodyBytes = 0; let accepting = true; let httpStatus = 0;
  let initiators; const domEvents = []; const requestEvents = [];
  const nativeCausality = nativeCartCausality();
  result.nativeFormEventTimeline = [];
  const stage = s => { result.startupStage = s; };
  const cancel = () => { stop = true; routing.halt(); void context?.close().catch(() => { }); };
  const deadline = setTimeout(cancel, 90000); signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (config.mode !== 'CART_RESEARCH' || !config.researchOnly || CART_TARGETS[config.action] !== config.asin || config.quantity !== 1) throw new Error('RESEARCH_CONFIG_INVALID');
    if (signal?.aborted) throw new Error('CANCELLED');
    stage('OPERATION_FENCE'); claimOperation(config.operationId); // Durable exclusive claim even if startup subsequently fails.
    stage('BROWSER_LAUNCH');
    await withAmazonBrowser(chromium, async browser => {
      if (stop) throw new Error('CANCELLED');
      stage('CONTEXT_CREATE'); context = await boundedBrowserStep(browser.newContext({ ...AMAZON_BROWSER_CONTEXT, javaScriptEnabled: true }), 15000, 'CONTEXT_TIMEOUT', c => c.close());
      try {
        stage('PAGE_CREATE'); page = await boundedBrowserStep(context.newPage(), 15000, 'PAGE_TIMEOUT', p => p.close());
        stage('CAUSALITY_OBSERVERS');
        await boundedBrowserStep(page.exposeBinding('__astraCartDiagnostic', (source, value) => {
          if (!accepting || source.frame !== page.mainFrame() || domEvents.length >= 40) return;
          const event = sanitizedDomEvent(value); if (event) domEvents.push({ ...event, observedAt: clock.now(), actionState: routing.captureObservation().actionState });
        }), 5000, 'DOM_OBSERVER_TIMEOUT');
        await boundedBrowserStep(page.addInitScript(installCartEventObservers), 5000, 'DOM_OBSERVER_TIMEOUT');
        initiators = await installInitiatorDiagnostics(context, page, config.url, clock); result.initiatorDiagnosticsStatus = initiators.status;
        page.setDefaultTimeout(5000); context.on('page', other => { if (other !== page) void other.close().catch(() => { }); });
        await context.routeWebSocket('**/*', socket => socket.close());
        page.on('dialog', dialog => { result.browserDialogObserved = true; stop = true; routing.halt(); void dialog.dismiss().catch(() => { }); });
        page.on('download', download => { stop = true; routing.halt(); void download.cancel().catch(() => { }); });
        stage('ROUTING');
        await context.route('**/*', async route => {
          const trace = { stage: 'REQUEST_OBJECT', requestSequence: ++requestSequence, actionState: routing.captureObservation().actionState }; let recordedRow;
          try {
            const request = route.request(); trace.stage = 'REQUEST_METADATA';
            trace.method = request.method(); trace.resourceType = request.resourceType();
            trace.stage = 'URL_PARSE'; const url = new URL(request.url()); trace.hostClass = researchHostClass(url.hostname);
            let canonicalPath = url.pathname; try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(canonicalPath); if (next === canonicalPath) break; canonicalPath = next; } } catch { canonicalPath = ''; }
            trace.pathClass = strictNativeCartPath(canonicalPath) ? 'STRICT_CART_ADD' : 'OTHER_PATH';
            trace.nativeCartEligibilityStage = trace.pathClass === 'STRICT_CART_ADD' && trace.method === 'POST' && trace.resourceType === 'document' ? 'PENDING' : 'NOT_APPLICABLE';
            let main = false; let frameUrl; try { main = request.frame() === page.mainFrame(); frameUrl = request.frame().url?.(); } catch { /* Workers denied. */ }
            // Capture causal phase at route entry, before asynchronous header inspection can cross a boundary.
            const observation = routing.captureObservation(); const requestObservedAt = clock.now(); const sequence = trace.requestSequence;
            if (requestEvents.length < 400 && observation.phase === 'ACTION') requestEvents.push({ kind: request.isNavigationRequest() ? 'NAVIGATION_REQUEST_OBSERVED' : ['xhr', 'fetch'].includes(request.resourceType()) ? 'XHR_FETCH_REQUEST_OBSERVED' : 'OTHER_REQUEST_OBSERVED', sequence, observedAt: requestObservedAt, actionState: observation.actionState });
            trace.stage = 'BODY_READ'; const body = request.method() === 'POST' ? request.postData() ?? '' : '';
            if (rows.length >= 400) { stop = true; routing.halt(); await route.abort(); return; }
            trace.stage = 'HEADERS'; const headers = await boundedBrowserStep(request.allHeaders(), 2000, 'HEADER_TIMEOUT');
            const requestContentType = headers['content-type'] ?? (request.method() === 'GET' ? 'application/x-www-form-urlencoded' : '');
            // Allow delivery of already-projected immutable event values. No browser
            // handle/DOM dereference occurs here; baseline time is never promoted.
            if (observation.phase === 'ACTION' && main && request.method() === 'POST' && request.resourceType() === 'document') {
              trace.stage = 'NATIVE_EVENT_WAIT';
              await clock.wait(150);
            }
            trace.stage = 'ELIGIBILITY';
            const nativeEvidence = nativeCausality.evidence(requestObservedAt, clock.now());
            const decision = routing.decide({ url: request.url(), method: request.method(), type: request.resourceType(), main, body, contentType: requestContentType, redirect: !!request.redirectedFrom(), observation, nativeEvidence });
            if (trace.nativeCartEligibilityStage === 'PENDING') trace.nativeCartEligibilityStage = decision.allowed ? 'QUALIFIED' : 'REJECTED';
            trace.stage = 'EVIDENCE_PROJECTION';
            const requestEvidence = inspectSemantic(requestContentType.includes('x-www-form-urlencoded') ? url.search.slice(1) + (url.search && body ? '&' : '') + body : body, requestContentType, config.asin);
            const row = {
              ...authorityDiagnostics(request.url(), config.url), qualifiedCartPathMatch: decision.qualifiedCartPathMatch, forbiddenLocations: decision.forbiddenLocations,
              publicPathDiagnostics: publicLocation(request.url(), config.url), frameLocation: publicLocation(frameUrl, config.url),
              phaseAtObservation: observation.phase, actionState: observation.actionState, requestObservedAt, qualifiedAuthority: authorityDiagnostics(request.url(), config.url).approvedAuthorityMatch, qualifiedCartPath: decision.qualifiedCartPathMatch,
              firstParty: CART_HOSTS.includes(url.hostname), hostClass: researchHostClass(url.hostname), routingDecision: decision.routingDecision, inspectionDecision: requestEvidence.inspected ? 'SANITIZED' : 'METADATA_ONLY',
              sequence, phase: decision.phase, observedAt: requestObservedAt, method: ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ? request.method() : 'OTHER',
              pathPattern: pathPattern(request.url()), resourceType: ['document', 'script', 'stylesheet', 'image', 'font', 'xhr', 'fetch'].includes(request.resourceType()) ? request.resourceType() : 'OTHER', allowed: decision.allowed, classification: decision.classification ?? (/signin|login|\/ap\//i.test(url.pathname) ? 'AUTH_SESSION_AUXILIARY' : /telemetry|analytics|metrics|beacon/i.test(url.pathname) ? 'TELEMETRY' : 'UNKNOWN'), blockedReason: decision.reason ?? null,
              requestEvidence, headerPresence: headerPresence(headers), status: null, contentType: null, responseEvidence: null
            };
            if (request.method() === 'POST' && request.resourceType() === 'document') row.nativeFormDiagnostics = { ...nativeEvidence, ...(decision.nativeForm ?? {}) };
            // Diagnostic projection cannot alter the previously computed decision.
            if (main && url.hostname === 'www.amazon.com.mx' && observation.phase === 'ACTION' && request.method() === 'POST' && request.resourceType() === 'document' && decision.qualifiedCartPathMatch) {
              try {
                row.buyNowFieldCorrelation = correlateBuyNowFields(result.buyNowDomBeforeClick, body, requestContentType, decision.nativeForm?.forbiddenFieldStates);
                result.buyNowFieldCorrelation = row.buyNowFieldCorrelation;
              } catch { row.buyNowFieldCorrelation = { correlation: 'UNKNOWN' }; }
            }
            trace.stage = 'RECORD'; recordedRow = row; rows.push(row); byRequest.set(request, row);
            initiators.bind(request.url(), request.method(), row);
            if (!decision.allowed) { if (decision.reason === 'FORBIDDEN_PATH' && request.isNavigationRequest()) { stop = true; routing.halt(); } trace.stage = 'ABORT'; await route.abort(); return; }
            if (stop) { trace.stage = 'ABORT'; await route.abort(); return; }
            trace.stage = 'CONTINUE'; row.passThroughSucceeded = false;
            await route.continue(); row.passThroughSucceeded = true;
            if (decision.classification === 'CART_CANDIDATE') result.cartRequestDispatchCount = 1; // Count acknowledged continuation only; reservation still forbids retry on failure.
          } catch (error) {
            stop = true; routing.halt(); result.reason = 'ROUTE_PROCESSING_FAILED';
            result.routeProcessingFailure ??= sanitizedRouteFailure(error, trace);
            if (recordedRow) recordedRow.routeProcessingFailed = true;
            try { await route.abort(); } catch { /* Already closed/handled; never retry or release the reservation. */ }
          }
        });
        page.on('response', response => {
          const row = byRequest.get(response.request()); if (!row || !accepting) return;
          const work = (async () => {
            const headers = await boundedBrowserStep(response.allHeaders(), 2000, 'HEADER_TIMEOUT'); if (!accepting) return; row.responseObservedAt = clock.now(); row.status = response.status(); const content = (headers['content-type'] ?? '').split(';')[0].toLowerCase();
            row.contentType = ['application/json', 'text/json', 'text/html', 'text/javascript', 'application/javascript', 'text/css'].includes(content) ? content : 'OTHER';
            const presence = headerPresence(headers); row.headerPresence.session ||= presence.session; row.headerPresence.token ||= presence.token;
            if ([401, 403, 429].includes(row.status)) { stop = true; routing.halt(); }
            const size = Number(headers['content-length']);
            if (!['application/json', 'text/json'].includes(content) || !Number.isInteger(size) || size <= 0 || size > BODY_CAP || bodyBytes + size > BODY_CAP * 4 || !CART_HOSTS.includes(new URL(response.url()).hostname)) return;
            bodyBytes += size; const body = await boundedBrowserStep(response.body(), 2000, 'BODY_TIMEOUT');
            if (!accepting || body.length > BODY_CAP) return;
            row.responseEvidence = inspectSemantic(body.toString('utf8'), content, config.asin);
          })().catch(() => { /* Missing body is UNKNOWN, never dump exception data. */ });
          pending.add(work); void work.finally(() => pending.delete(work));
        });
        if (stop) throw new Error('CANCELLED');
        stage('BASELINE_NAVIGATION'); const response = await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); httpStatus = response?.status() ?? 0;
        stage('BASELINE_WINDOW'); await clock.wait(4000);
        routing.completeBaseline(); mark('baselineCompletedAt', 'BASELINE_COMPLETE');
        stage('PRE_ACTION_QUALIFICATION'); let before = await researchPageEvidence(page, config, clock, httpStatus);
        stage('CONTROL_DIAGNOSTICS'); const controls = await boundedBrowserStep(page.evaluate(inspectCartControls, { asin: config.asin, action: config.action }), 5000, 'CONTROL_DIAGNOSTIC_TIMEOUT');
        result.clickTargetDiagnostics = controls;
        stage('VIEWPORT_QUALIFICATION'); result.viewportQualification = {};
        const selectedControl = await prepareViewportControl(page, config, clock, controls, result.viewportQualification);
        const receiveNativeEvidence = value => {
          if (!accepting || result.nativeFormEventTimeline.length >= 4) { nativeCausality.observe(null); return; }
          const event = immutableNativeEvent(value);
          nativeCausality.observe(event); result.nativeFormEventTimeline.push(Object.freeze({ ...event, observedAt: clock.now() }));
        };
        // Playwright 1.62 callback argument is closure-scoped (noGlobal), not a
        // public page binding accepting claims of trust from arbitrary page code.
        if (await boundedBrowserStep(selectedControl.evaluate(installPinnedCartObservers, { asin: config.asin, report: receiveNativeEvidence }, { exposeFunctions: true }), 3000, 'PINNED_OBSERVER_TIMEOUT') !== true) throw new Error('PINNED_OBSERVER_NOT_BOUND');
        result.pinnedClickTargetDiagnostics = result.viewportQualification.after;
        before = await researchPageEvidence(page, config, clock, httpStatus);
        result.cartCountBefore = before.cartCount; result.preActionQualification = { ...qualifyCartPage(config, before), evidence: before };
        result.priceEvidence = before.price; result.sellerEvidence = before.sellerId;
        if (stop || !result.preActionQualification.qualified) throw new Error('PRE_ACTION_NOT_QUALIFIED');
        // Independent diagnostic listener/snapshot; never input to the native gate.
        result.clickedSubmitter = sanitizedSubmitter(null);
        try {
          result.buyNowDomBeforeClick = sanitizeDomCandidates(await boundedBrowserStep(selectedControl.evaluate(installBuyNowDomDiagnostics, { keys: candidateKeys, report: value => { if (accepting) result.clickedSubmitter = sanitizedSubmitter(value); } }, { exposeFunctions: true }), 1500, 'BUY_NOW_DIAGNOSTIC_TIMEOUT'));
        } catch { result.buyNowDomBeforeClick = { complete: false, domCandidates: [] }; }
        stage('ACTION'); routing.arm(before, config.operationId); mark('actionArmedAt', 'ACTION_ARMED');
        nativeCausality.arm(clock.now());
        // Exact selected submit control; no force click, fallback selector, retry, Buy Now or cleanup click.
        routing.beginBrowserClick(); mark('actionActiveAt', 'ACTION_ACTIVE'); result.clickAttemptCount = 1; mark('clickStartedAt', 'CLICK_STARTED');
        await selectedControl.click({ timeout: 5000, noWaitAfter: true }); result.actionExecuted = true; mark('clickCompletedAt', 'CLICK_COMPLETED');
        if (stop) throw new Error('STOPPED_AFTER_CLICK');
        routing.beginConfirmation(); mark('postActionConfirmationAt', 'POST_ACTION_CONFIRMATION');
        stage('ACTION_WINDOW');
        for (let i = 0; i < 12 && !stop; i++) {
          await clock.wait(500);
          let after; try { after = await boundedBrowserStep(page.evaluate(cartUiSnapshot, config.action), 2000, 'POST_ACTION_STATE_TIMEOUT'); } catch { continue; }
          result.cartCountAfter = after.cartCount; result.cartStateAfter = after;
          result.postActionConfirmation = { phase: 'POST_ACTION_CONFIRMATION', observedAt: clock.now(), cartCount: after.cartCount, itemAsins: after.itemAsins, productBound: after.itemAsins?.includes(config.asin) ?? false };
          if (after.challenge || after.accessDenied) { stop = true; routing.halt(); break; }
          if (result.cartRequestDispatchCount === 1 && confirmCart(config, before, after)) { result.cartConfirmed = true; break; }
        }
        result.postClickDomDiagnostics = await boundedBrowserStep(page.evaluate(inspectCartControls, { asin: config.asin, action: config.action }), 5000, 'POST_CLICK_DIAGNOSTIC_TIMEOUT').catch(() => ({ status: 'UNAVAILABLE' }));
        result.postClickDomDiagnostics.cartCount = result.cartCountAfter; result.postClickDomDiagnostics.targetAsinInCart = result.cartStateAfter?.itemAsins?.includes(config.asin) ?? null;
        stage('COLLECT'); await boundedBrowserStep(Promise.allSettled([...pending]), 3000, 'COLLECTION_TIMEOUT').catch(() => { });
        result.status = stop ? 'STOPPED_SAFELY' : result.cartConfirmed ? 'BROWSER_CART_CONFIRMED' : 'CART_OUTCOME_UNCONFIRMED';
      } catch (error) { result.failureStage = result.startupStage; throw error; } finally {
        routing.halt(); accepting = false; result.passiveInitiatorRequests = initiators?.finish(result.clickStartedAt) ?? []; await boundedBrowserStep(initiators?.close() ?? Promise.resolve(), 2000, 'CDP_CLOSE_TIMEOUT').catch(() => { }); stage('CONTEXT_CLOSE'); await boundedBrowserStep(context.close(), 5000, 'CONTEXT_CLOSE_TIMEOUT');
      }
    });
    result.browserClosed = true;
  } catch (error) {
    result.failureStage ??= result.startupStage; result.reason ??= /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.message ?? '') ? error.message : 'RESEARCH_STEP_FAILED';
    result.status = result.clickAttemptCount ? 'CART_OUTCOME_UNCONFIRMED' : 'BLOCKED';
  }
  clearTimeout(deadline); signal?.removeEventListener('abort', cancel);
  accepting = false; rows.sort((a, b) => a.sequence - b.sequence); Object.assign(result, correlateTraffic(rows, result.cartConfirmed));
  result.domEventTimeline = domEvents; result.requestEventTimeline = requestEvents;
  result.causalityTimeline = [...result.actionTimeline.map(e => ({ kind: e.state, observedAt: e.at })), ...domEvents, ...requestEvents].sort((a, b) => a.observedAt - b.observedAt);
  result.cartMutationCount = result.cartConfirmed ? 1 : 0; result.mutationCount = result.cartMutationCount;
  result.mutationOutcome = result.cartConfirmed ? 'CONFIRMED' : result.clickAttemptCount ? 'UNKNOWN' : 'NOT_ATTEMPTED';
  result.routingCounts = { ...routing.counts }; result.offerIdentityEvidence = result.semanticIdentifiersFound.filter(f => ['offerid', 'offerlistingid', 'listingid'].includes(f.fieldName));
  result.limitations = ['CART_RESEARCH is a real cart mutation experiment, never DRY_RUN or purchase readiness.', 'One click and at most one cart dispatch. Unsupported bodies on qualified cart destinations may pass as metadata-only after rendered target/quantity qualification. Unknown destinations remain blocked.', 'cartMutationCount counts confirmed cart state only; cartRequestDispatchCount is acknowledged browser continuation, clickAttemptCount is interaction. UNKNOWN outcome never permits retry.', 'Clean anonymous ephemeral profile only. Browser closure does not prove server-side cart removal.', 'Session/token presence does not establish necessity. No secret values retained; unsupported evidence remains UNKNOWN.', 'Temporal correlation and HTTP 200 alone do not confirm a cart. Confirmation requires intended product and cart-count evidence. One run cannot establish backend stability.', 'BrowserCartTransport is research-only; no production execution port or BackendCartTransport implemented.'];
  return result;
}
