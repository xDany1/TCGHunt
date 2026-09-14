import { approvedAmazonUrl, AmazonNavigationBudget, AMAZON_BROWSER_INTERVAL_MS } from './amazon-browser-policy.mjs';
import { boundedBrowserStep, captureAmazonPage } from './amazon-browser-runtime.mjs';
import { passiveBodyAllowed, passiveBodyReason, inspectPassiveBody, passiveMetadata, PASSIVE_BODY_CAP } from './amazon-passive-evidence.mjs';
import { RECON_CONTEXT, RECON_WINDOW_MS, RECON_SAMPLE_MS, createReconRouting, reconRouteDecision } from './amazon-passive-policy.mjs';
import { installPassiveTiming, readPassiveTiming, sanitizePassiveTiming } from './amazon-passive-timing.mjs';

export const RECON_ASINS = Object.freeze(['B0H78BB9TY', 'B0HG3C5JK6', 'B0GYVHLP4L']);
export function passiveConfig(env) {
  if (env.AMAZON_PASSIVE_RECON_ENABLED !== '1') throw new Error('PASSIVE_DISABLED');
  return { targets: RECON_ASINS.map(asin => approvedAmazonUrl(`https://www.amazon.com.mx/dp/${asin}`)), mode: 'DRY_RUN' };
}
/** Keeps proven navigation accounting; diagnostic resource routing is explicitly separate. */
export class PassiveRequestBudget extends AmazonNavigationBudget {
  constructor(target) {
    super({ targets: passiveConfig({ AMAZON_PASSIVE_RECON_ENABLED: '1' }).targets, readsPerProduct: 1, minimumIntervalMs: AMAZON_BROWSER_INTERVAL_MS });
    this.target = target;
  }
  allow(url, method, type, main) { return reconRouteDecision({ url, method, type, main }, this.target).allowed; }
}
export function safeDiagnosticError(error) {
  const raw = typeof error?.message === 'string' ? error.message : 'Non-error thrown';
  const known = /^[A-Z][A-Z0-9_]{2,80}$/.test(raw) ? raw : null;
  const message = raw.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]').replace(/[A-Z]:[\\/][^\r\n]*/gi, '[PATH]')
    .replace(/(?:authorization|cookie|token|session|password|csrf|secret)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]').replace(/[\r\n]+/g, ' ').slice(0, 240);
  return { name: ['Error', 'TypeError', 'TimeoutError', 'ReadFailure'].includes(error?.name) ? error.name : 'Error', code: known, message };
}
export function createTargetDiagnostics() {
  return { startupStage: 'TARGET_STARTED', browserLaunched: true, contextCreated: false, pageCreated: false, routesRegistered: false, listenersRegistered: false, targetLoopStarted: true, navigationAttempted: false, navigated: false, contextClosed: false, navigationError: null, failureStage: null, error: null, observationErrors: [], stages: [] };
}
export async function capturePassivePage(browser, approved, clock, diagnostics = createTargetDiagnostics()) {
  const budget = new PassiveRequestBudget(approved); const routing = createReconRouting(approved); const decisions = new WeakMap(); const responses = []; const pending = []; let inspected = 0; let stop = null; let capture; let navigationStart = null; let timing = null; let accepting = true;
  const responseCounts = { xhr: 0, fetch: 0, post: 0 };
  const profile = {
    contextOptions: RECON_CONTEXT,
    async routeRequest(route, page) {
      const req = route.request();
      if (req.resourceType() === 'document' && routing.counts.document > 0 && !req.redirectedFrom?.()) { routing.denyExtraNavigation({ url: req.url(), method: req.method(), type: req.resourceType() }); await route.abort(); return; }
      let main = false; try { main = req.frame() === page.mainFrame(); } catch { /* Workers have no page authority. */ }
      const d = routing.decide({ url: req.url(), method: req.method(), type: req.resourceType(), main, body: req.method() === 'POST' ? req.postData() ?? '' : '' });
      decisions.set(req, d);
      if (d.allowed) await route.continue(); else await route.abort();
    },
    async configure(context, page) {
      await context.routeWebSocket('**/*', socket => socket.close());
      await page.addInitScript(installPassiveTiming, { asin: approved.asin, intervalMs: RECON_SAMPLE_MS, windowMs: RECON_WINDOW_MS });
    }
  };
  const fail = error => {
    if (!diagnostics.error) { diagnostics.failureStage = diagnostics.startupStage; diagnostics.error = safeDiagnosticError(error); }
    else if (diagnostics.startupStage === 'CONTEXT_CLOSE') diagnostics.cleanupError = safeDiagnosticError(error);
  };
  const observer = {
    stage(stage) {
      diagnostics.startupStage = stage; if (diagnostics.stages.length < 24) diagnostics.stages.push(stage);
      if (stage === 'NAVIGATION') navigationStart = clock.now();
      const flags = { CONTEXT_CREATED: 'contextCreated', PAGE_CREATED: 'pageCreated', ROUTE_REGISTERED: 'routesRegistered', LISTENERS_REGISTERED: 'listenersRegistered', NAVIGATION: 'navigationAttempted', NAVIGATED: 'navigated', CONTEXT_CLOSED: 'contextClosed' };
      if (flags[stage]) diagnostics[flags[stage]] = true;
    },
    failure: fail,
    navigationError(error) { diagnostics.navigationError = safeDiagnosticError(error); },
    observationError(stage, error) { if (diagnostics.observationErrors.length < 4) diagnostics.observationErrors.push({ stage, ...safeDiagnosticError(error) }); },
    attach(page) {
      page.on('response', response => {
        let req; try { req = response.request(); } catch { return; }
        if (accepting && ['xhr', 'fetch'].includes(req.resourceType())) { responseCounts[req.resourceType()]++; if (req.method() === 'POST') responseCounts.post++; }
        if (!accepting || !['xhr', 'fetch', 'document'].includes(req.resourceType()) || pending.length >= 18) return;
        const classification = decisions.get(req)?.classification ?? reconRouteDecision({ url: response.url(), method: req.method(), type: req.resourceType(), main: true }, approved).classification;
        if (classification === 'IGNORED_TELEMETRY') return;
        const receivedAt = clock.now();
        pending.push((async () => {
          const contentType = await response.headerValue('content-type'); const length = await response.headerValue('content-length');
          const routeDecision = decisions.get(req);
          const meta = { url: response.url(), method: req.method(), resourceType: req.resourceType(), status: response.status(), contentType, declaredBytes: length && /^\d+$/.test(length) ? Number(length) : null, observedAt: receivedAt, inspectionClass: classification, naturalPageRequest: !!routeDecision, routeAllowed: routeDecision?.allowed === true };
          const safe = passiveMetadata(meta); if (!safe) return;
          if ([401, 403, 429].includes(meta.status)) { stop = 'ACCESS_DENIED_OR_THROTTLED'; routing.halt(); }
          if (!passiveBodyAllowed(meta) || inspected >= 8) { responses.push({ ...safe, inspected: false, limitation: passiveBodyReason(meta) ?? 'INSPECTION_TOTAL_CAP', sanitizedMatchedFields: [], availabilityEvidence: 'UNKNOWN' }); return; }
          inspected++;
          const body = await boundedBrowserStep(response.body(), 3000, 'PASSIVE_BODY_TIMEOUT');
          if (body.length > PASSIVE_BODY_CAP) { responses.push({ ...safe, inspected: false, limitation: 'DECODED_BODY_CAP', sanitizedMatchedFields: [], availabilityEvidence: 'UNKNOWN' }); return; }
          const evidence = inspectPassiveBody(meta, body.toString('utf8'), approved.asin);
          if (evidence?.stop) { stop = evidence.stop; routing.halt(); }
          if (evidence) responses.push({ ...evidence, evidenceAt: clock.now() });
        })().catch(error => {
          observer.observationError('RESPONSE_READ', error);
          const safe = passiveMetadata({ url: response.url(), method: req.method(), resourceType: req.resourceType(), status: response.status(), contentType: null, observedAt: receivedAt });
          if (safe) responses.push({ ...safe, inspected: false, limitation: 'BODY_UNAVAILABLE', sanitizedMatchedFields: [], availabilityEvidence: 'UNKNOWN' });
        }));
      });
    },
    async afterNavigation(page) {
      // The init-script sampler ran during navigation; bounded polling retrieves only its safe projection.
      for (let i = 0; i <= RECON_WINDOW_MS / RECON_SAMPLE_MS; i++) {
        const raw = await boundedBrowserStep(page.evaluate(readPassiveTiming), 3000, 'PASSIVE_TIMING_TIMEOUT');
        timing = sanitizePassiveTiming(raw, approved.asin, navigationStart, clock.now());
        if (timing?.stopped) { stop = timing.stopped; routing.halt(); break; }
        if (stop || clock.now() - navigationStart >= RECON_WINDOW_MS || i === RECON_WINDOW_MS / RECON_SAMPLE_MS) break;
        await clock.wait(RECON_SAMPLE_MS);
      }
    },
    async collect() { accepting = false; await boundedBrowserStep(Promise.allSettled(pending), 5000, 'PASSIVE_COLLECTION_TIMEOUT'); }
  };
  const target = { asin: approved.asin, url: approved.canonical, marketplace: 'MX', deliveryScope: 'amazon-mx:anonymous:location-unvalidated' };
  try {
    capture = await captureAmazonPage(browser, budget, approved, target, `m5-4a-${approved.asin}`, clock, observer, profile);
    if (capture.challenge || capture.accessDenied) stop = 'CHALLENGE_OR_ACCESS_DENIED';
  } catch (error) { fail(error); stop = diagnostics.error?.code ?? 'CAPTURE_FAILED'; }
  const summary = budget.summary();
  if (diagnostics.failureStage) diagnostics.startupStage = diagnostics.failureStage;
  return {
    projection: capture, status: capture?.status ?? 0, observedAt: capture?.capturedAt ?? null, uiSnapshots: capture ? [{ projection: capture, observedAt: capture.capturedAt }] : [], responses, stop, diagnostics, navigationStart, timing,
    captureStatus: diagnostics.error ? diagnostics.navigationAttempted && !diagnostics.navigated ? 'NAVIGATION_FAILED' : 'CAPTURE_INCOMPLETE' : stop || diagnostics.observationErrors.length ? 'CAPTURE_INCOMPLETE' : 'NAVIGATED',
    topLevelNavigationCount: summary.navigations, requestCounts: routing.counts, blockedRequests: routing.counts.blocked, routingAudit: routing.audit(), responseCounts
  };
}
