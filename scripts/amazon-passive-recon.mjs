import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AmazonBrowserProvider, normalizeAmazon, amazonCommerce } from '@ptcg/adapters';
import { withAmazonBrowser } from './amazon-browser-runtime.mjs';
import { passiveConfig, capturePassivePage, RECON_ASINS, createTargetDiagnostics, safeDiagnosticError } from './amazon-passive-runtime.mjs';
import { reconcilePassive, finalPassiveDiagnostics } from './amazon-passive-evidence.mjs';
import { comparePassiveTiming } from './amazon-passive-timing.mjs';

const emptyTarget = asin => ({ asin, status: 'NOT_ATTEMPTED', topLevelNavigationCount: 0, navigationStart: null, networkRequestsObserved: 0, jsCount: 0, xhrCount: 0, fetchCount: 0, candidateResponses: [], privateAvailabilityEvidence: [], privatePriceEvidence: [], privateCurrencyEvidence: [], privateSellerEvidence: [], privateFulfillmentEvidence: [], structuredAvailabilityEvidence: [], uiAvailabilitySamples: [], firstPrivateAvailabilityAt: null, firstStructuredAvailabilityAt: null, firstUiAvailabilityAt: null, observedLeadMs: null, uiEvidence: null, structuredPageEvidence: null, passiveNetworkEvidence: null, earliestAvailabilitySource: 'UNKNOWN', evidenceConflict: false, restockCandidate: null, restockConfirmed: false, actionable: false });
/** Testable orchestration: allocate target diagnostics before any fallible capture or parsing. */
export async function runPassiveRecon(config, chromium, clock) {
  const observations = config.targets.map(t => emptyTarget(t.asin)); let runtimeVersion = null;
  const diagnostics = { startupStage: 'BROWSER_LAUNCH', browserLaunched: false, targetLoopStarted: false, browserClosed: false, error: null };
  try {
    await withAmazonBrowser(chromium, async browser => {
      diagnostics.browserLaunched = true; diagnostics.startupStage = 'BROWSER_VERSION'; runtimeVersion = browser.version();
      diagnostics.startupStage = 'TARGET_LOOP'; diagnostics.targetLoopStarted = true;
      for (const [index, approved] of config.targets.entries()) {
        const row = observations[index]; row.status = 'CAPTURE_INCOMPLETE'; row.diagnostics = createTargetDiagnostics();
        try {
          const capture = await capturePassivePage(browser, approved, clock, row.diagnostics);
          Object.assign(row, { status: capture.captureStatus, reason: capture.stop, topLevelNavigationCount: capture.topLevelNavigationCount, requestCounts: capture.requestCounts, blockedRequests: capture.blockedRequests, routingAudit: capture.routingAudit, xhrFetchSummary: { observedRequests: { xhr: capture.requestCounts.observedXhr, fetch: capture.requestCounts.observedFetch, post: capture.requestCounts.observedPost }, allowedRequests: { xhr: capture.requestCounts.xhr, fetch: capture.requestCounts.fetch, post: capture.requestCounts.post }, observedResponses: capture.responseCounts }, navigationStart: capture.navigationStart, networkRequestsObserved: capture.requestCounts.networkRequestsObserved, jsCount: capture.requestCounts.script, xhrCount: capture.requestCounts.xhr, fetchCount: capture.requestCounts.fetch });
          const target = { asin: approved.asin, url: approved.canonical, marketplace: 'MX', deliveryScope: 'amazon-mx:anonymous:location-unvalidated' };
          let ui = { availability: 'UNKNOWN', observedAt: capture.observedAt ?? null, confidence: 'LOW', purchaseMode: 'UNKNOWN', price: null, seller: 'UNKNOWN', fulfillment: 'UNKNOWN' };
          if (capture.projection && !capture.stop) {
            row.diagnostics.startupStage = 'PROVIDER_PARSE'; const at = capture.observedAt;
            const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return capture.projection; } });
            const parsed = await provider.read(target, { now: at - 1, deadlineAt: at + 1000, currency: 'MXN', deliveryScope: target.deliveryScope, operationId: 'm5.4a', traceId: 'm5.4a' });
            if ('evidence' in parsed) {
              const n = normalizeAmazon(parsed.evidence); const offer = n.offers[0];
              ui = { availability: n.productState?.availability ?? 'UNKNOWN', observedAt: at, confidence: 'RENDERED_SNAPSHOT', purchaseMode: n.productState?.purchaseMode ?? 'UNKNOWN', price: offer?.price ? { minor: String(offer.price.minor), currency: offer.price.currency } : null, seller: ['Amazon', 'Amazon México'].includes(offer?.sellerDisplayName) ? offer.sellerDisplayName : 'UNKNOWN_OR_REDACTED', fulfillment: offer?.fulfillment ?? 'UNKNOWN' };
              if (row.status === 'NAVIGATED') row.status = 'PASS';
            } else { row.status = 'CAPTURE_INCOMPLETE'; row.reason = parsed.category; }
          }
          const snapshots = capture.stop ? [] : (capture.timing?.ui ?? []).map(s => ({ observedAt: s.observedAt, availability: amazonCommerce(s.availability ?? [], [], []).availability, visibleActions: s.actions ?? [], actionVisible: (s.actions ?? []).length > 0, boundToAsin: s.boundToAsin }));
          // Retain the final parsed observation separately; it cannot replace earlier samples.
          ui = { ...ui, samples: snapshots, firstKnownAt: snapshots.find(s => s.availability !== 'UNKNOWN')?.observedAt ?? null };
          const safeResponses = capture.responses; const privateResponses = capture.stop ? [] : safeResponses.filter(r => ['xhr', 'fetch'].includes(r.resourceType));
          const structured = capture.stop ? [] : capture.timing?.structured ?? [];
          const reconciliation = reconcilePassive({ asin: approved.asin, responses: privateResponses, ui });
          const states = [ui.availability, reconciliation.passiveNetworkEvidence.availability, ...structured.map(s => s.availabilityEvidence)].filter(s => s !== 'UNKNOWN');
          const conflict = reconciliation.evidenceConflict || new Set(states).size > 1;
          const fields = key => privateResponses.filter(r => r.inspected && r.asinRelationship === 'EXPLICIT_SAME_OBJECT' && (r[key]?.length ?? 0) > 0).map(r => ({ classification: r.classification, evidenceAt: r.evidenceAt, values: r[key], actionable: false }));
          Object.assign(row, { candidateResponses: safeResponses, ...reconciliation, structuredPageEvidence: { source: 'STRUCTURED_PAGE', samples: structured }, privateAvailabilityEvidence: privateResponses.filter(r => r.inspected && r.asinRelationship === 'EXPLICIT_SAME_OBJECT' && r.availabilityEvidence !== 'UNKNOWN'), privatePriceEvidence: fields('priceEvidence'), privateCurrencyEvidence: fields('currencyEvidence'), privateSellerEvidence: fields('sellerEvidence'), privateFulfillmentEvidence: fields('fulfillmentEvidence'), structuredAvailabilityEvidence: structured, uiAvailabilitySamples: snapshots, ...comparePassiveTiming({ responses: privateResponses, structured, uiSamples: snapshots, conflict }), evidenceConflict: conflict, availability: conflict ? 'UNKNOWN' : reconciliation.availability, restockCandidate: conflict ? null : reconciliation.restockCandidate });
          Object.assign(row, finalPassiveDiagnostics({ asin: approved.asin, responses: privateResponses, uiSamples: snapshots, uiAvailability: ui.availability, conflict }));
          row.naturalPostResponses = finalPassiveDiagnostics({ asin: approved.asin, responses: safeResponses, uiSamples: [], uiAvailability: 'UNKNOWN', conflict: true }).naturalPostResponses;
          row.limitation = 'Final passive diagnostic only. Natural allowed POST responses may be inspected under caps/privacy gates; no endpoint contract or production authority. A diagnostic candidate proves no prior unavailability, restock, purchase intent or durable effect.';
          if (row.status === 'PASS') row.diagnostics.startupStage = 'COMPLETE';
          if (capture.stop || row.status !== 'PASS') break;
        } catch (error) {
          row.status = row.diagnostics.navigationAttempted && !row.diagnostics.navigated ? 'NAVIGATION_FAILED' : 'CAPTURE_INCOMPLETE';
          row.topLevelNavigationCount = row.diagnostics.navigationAttempted ? 1 : 0;
          row.diagnostics.failureStage ??= row.diagnostics.startupStage; row.diagnostics.error ??= safeDiagnosticError(error); row.reason = 'TARGET_FAILED'; break;
        }
      }
      diagnostics.startupStage = 'BROWSER_CLOSE';
    });
    diagnostics.browserClosed = true; diagnostics.startupStage = 'COMPLETE';
  } catch (error) { diagnostics.error = safeDiagnosticError(error); }
  const status = diagnostics.error ? diagnostics.browserLaunched ? 'CAPTURE_INCOMPLETE' : 'STARTUP_FAILED' : observations.every(o => o.status === 'PASS') ? 'RECON_CAPTURE_COMPLETE' : 'PARTIAL';
  return {
    subtask: 'M5.4A', harnessVersion: 'm5.4a-final-deep-v1', finalPassivePass: true, furtherDiagnosticIterationsPlanned: false, closureReviewRequired: true, status, runtimeVersion, diagnostics, observations, mode: 'DRY_RUN', mutationCount: 0, directPrivateCalls: 0, replayCount: 0, purchaseIntentsCreated: 0, m54aCanClose: false, m54CanClose: false, m55MayProceed: false,
    limitations: ['Final Windows evidence must close the diagnostic as PASS useful early signal, PARTIAL private signal not productionized, or PARTIAL accepted browser limitation; no further iterative recon planned.', 'Capture completeness is not provider/milestone acceptance.', 'Known forbidden paths/semantics blocked; natural POST responses inspected only with proven routing, size/content/privacy gates. No replay/manual endpoint invocation or request changes.', '8 second window with 500 ms UI/structured sampling; body evidence timing, not request starts. Chunked/large/non-JSON/sensitive bodies remain unqualified.', 'Routing audit identifies potentially suppressed dynamic resources, not their necessity for offer generation or causality.', 'No production stability or session-independence qualification.']
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let config;
  try { config = passiveConfig(process.env); } catch { console.log(JSON.stringify({ status: 'NOT_EXECUTED', reason: 'PASSIVE_DISABLED', navigations: 0, mode: 'DRY_RUN' })); process.exitCode = 1; }
  if (config) {
    const outputPath = 'outputs/M5_4A_PASSIVE_NETWORK_EVIDENCE_RESULT.json'; const clock = { now: () => Date.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)) }; let result;
    try { const { chromium } = await import('playwright-core'); result = await runPassiveRecon(config, chromium, clock); }
    catch (error) { result = { status: 'STARTUP_FAILED', diagnostics: { startupStage: 'PLAYWRIGHT_IMPORT', browserLaunched: false, targetLoopStarted: false, error: safeDiagnosticError(error) }, observations: RECON_ASINS.map(emptyTarget), mode: 'DRY_RUN', actionable: false }; }
    mkdirSync('outputs', { recursive: true }); if (existsSync(outputPath)) copyFileSync(outputPath, outputPath.replace('.json', `.previous-${clock.now()}.json`));
    writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, outputPath, runtimeVersion: result.runtimeVersion ?? null, startupStage: result.diagnostics.startupStage, error: result.diagnostics.error, navigations: result.observations.reduce((sum, o) => sum + o.topLevelNavigationCount, 0) })); if (result.status !== 'RECON_CAPTURE_COMPLETE') process.exitCode = 1;
  }
}
