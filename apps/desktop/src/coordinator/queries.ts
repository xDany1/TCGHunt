import { refKey, formatMoney } from '@ptcg/core';
import type { Observed, Money, Ratio } from '@ptcg/core';
import { isProductMonitor, productMonitorScope } from '@ptcg/application';
import type { ObservationHistoryItem, DesktopEvaluationRecord, RestockSample } from '@ptcg/application';
import type { DurableStore } from '@ptcg/infrastructure';
import type { FieldView, ObservationView, EvaluationView, WorkspaceView, ProductMonitorView } from '@ptcg/contracts';

export const moneyText = (value: Money): string => formatMoney(value);
export function field<T>(value: Observed<T>, display: (v: T) => string): FieldView {
  return value.state === 'KNOWN' ? { state: 'KNOWN', value: display(value.value), reason: null } : { state: value.state, value: null, reason: value.reason };
}
export function observationView(item: ObservationHistoryItem, now: number): ObservationView {
  const o = item.observation; const meta = item.catalog; const e = o.identity.evidence;
  return {
    id: o.id, offerId: refKey(o.offer.ref), productId: o.product.ref.externalId, variantId: o.variant.ref.externalId, listingId: refKey(o.listing.ref), sellerId: refKey(o.offer.sellerRef), storeId: o.offer.ref.storeId,
    title: o.product.title || 'Unknown product title', variant: meta?.variantTitle || 'Unknown variant title', sku: meta?.sku ?? null, source: meta?.sourceReference ?? null,
    price: field(o.unitPrice, moneyText), stock: field(o.stock, String), saleAvailable: meta?.saleAvailable ?? null, quantity: field(o.availableQuantity, String),
    shipping: field(o.shipping, moneyText), tax: field(o.additionalTax, moneyText), seller: field(o.seller, v => v.displayName),
    capturedAt: e.capturedAt, receivedAt: e.receivedAt, sourceObservedAt: e.sourceObservedAt, expiresAt: e.expiresAt,
    stale: now < e.sourceObservedAt || now >= e.expiresAt || now - e.sourceObservedAt > 60000, adapterVersion: e.adapterVersion, parserVersion: e.parserVersion,
    basis: meta?.evidenceBasis ?? e.rights
  };
}
function percent(ratio: Ratio | undefined): string | null {
  if (!ratio) return null;
  const hundredths = ratio.numerator * 10000n / ratio.denominator;
  const sign = hundredths < 0n ? '-' : ''; const absolute = hundredths < 0n ? -hundredths : hundredths;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}%`;
}
export function evaluationView(record: DesktopEvaluationRecord, now: number): EvaluationView {
  const e = record.evidence; const opportunity = e.evaluation.opportunity;
  return {
    id: opportunity.id, monitorId: e.command.monitorId, runId: e.command.runId,
    observation: observationView({ observation: e.evaluation.observation, catalog: e.evaluation.catalog ?? null }, now),
    evaluatedAt: e.command.now, outcome: record.outcome, arithmetic: opportunity.status, sellerStatus: e.evaluation.seller.result,
    mapping: e.request.mapping.state, benchmark: field(e.request.scenario.benchmark.grossResale, moneyText),
    landedCost: opportunity.status === 'COMPLETE' ? { state: 'KNOWN', value: moneyText(opportunity.acquisitionCost), reason: null } : { state: 'UNKNOWN', value: null, reason: 'INCOMPLETE_COST_EVIDENCE' },
    roi: opportunity.status === 'COMPLETE' ? percent(opportunity.roi) : null, margin: opportunity.status === 'COMPLETE' ? percent(opportunity.margin) : null,
    checks: e.evaluation.simulation.checks.map(c => ({ code: c.code, result: c.status, field: c.operands['field'] ?? null, reason: c.operands['reason'] ?? null })), decision: record.decision, intentId: record.intentId, decisionEvaluationId: record.decisionEvaluationId
  };
}
export function productView(sample: RestockSample, baseline: string, events: readonly string[], now: number): ProductMonitorView | null {
  const p = sample.productObservation; if (!p) return null;
  const absent: FieldView = { state: 'UNKNOWN', value: null, reason: 'EVIDENCE_NOT_OBSERVED' };
  return {
    asin: p.productRef.externalId, title: p.title, availability: field(p.availability, String), purchaseMode: field(p.purchaseMode, String), releaseDate: field(p.releaseDate, String),
    price: p.unitPrice ? field(p.unitPrice, moneyText) : absent, seller: p.seller ? field(p.seller, String) : absent, fulfillment: p.fulfillment ? field(p.fulfillment, String) : absent,
    observedAt: sample.observedAt, expiresAt: sample.expiresAt, stale: now < sample.observedAt || now >= sample.expiresAt, parserVersion: p.availability.evidence.parserVersion, provider: sample.provenance.provider,
    baseline, outcome: sample.status, events, opportunity: 'BLOCKED / INDETERMINATE', opportunityReason: 'Monitoring only; seller approval, reviewed product mapping and acquisition/resale cost evidence are required. No purchase intent.'
  };
}
export function workspaceView(store: DurableStore, now: number, context: { readonly state: WorkspaceView['status']; readonly reason: string; readonly networkEnabled: boolean; readonly amazonNetworkEnabled?: boolean; readonly fixtureMode: boolean; readonly databaseLocation: string; }): WorkspaceView {
  const r = store.desktop; const settings = r.settings(); const count = r.counts(now); const rows = r.listMonitors(); const products = r.latestProducts().map(o => observationView(o, now));
  const evaluations = r.evaluations().map(e => evaluationView(e, now)); const latest = products.find(p => p.storeId === 'shopify-kantocards');
  const failureIsLatest = settings.lastFailureAt !== null && settings.lastFailureAt >= (latest?.receivedAt ?? 0);
  const health = failureIsLatest ? ['AUTH_REQUIRED', 'BLOCKED'].includes(settings.lastFailure ?? '') ? settings.lastFailure ?? 'DEGRADED' : 'DEGRADED' : !latest ? 'UNAVAILABLE' : latest.stale ? 'DEGRADED' : 'HEALTHY';
  const productRows = rows.flatMap(row => {
    const c = row.monitor.definition.configuration; if (!isProductMonitor(c)) return [];
    const scope = productMonitorScope(row.monitor.definition.monitorId, c); const state = store.restock.getState(scope); const samples = store.restock.getSamples(scope);
    const sample = [...samples].reverse().find(s => s.productObservation);
    const events = store.restock.getEvents(scope);
    return [{ row, state, sample, samples, events, view: sample ? productView(sample, state?.baseline?.availability ?? 'UNKNOWN', events.map(e => e.type), now) : null }];
  });
  const amazonLast = [...productRows].sort((a, b) => (b.row.lastRunAt ?? 0) - (a.row.lastRunAt ?? 0))[0];
  const amazonProduct = [...productRows].sort((a, b) => (b.sample?.receivedAt ?? 0) - (a.sample?.receivedAt ?? 0))[0];
  return {
    version: 1, now, dryRun: true, status: context.state, reason: context.reason, networkEnabled: context.networkEnabled || context.amazonNetworkEnabled === true, fixtureMode: context.fixtureMode,
    dashboard: {
      activeMonitors: count.active, delayedMonitors: count.delayed, productsObservedToday: count.productsToday, opportunitiesOpen: count.opportunities,
      simulationsBlockedToday: count.blockedToday, wouldHaveExecutedToday: count.simulatedToday, lastObservationAt: count.lastObservationAt
    },
    monitors: rows.map(r => ({
      family: isProductMonitor(r.monitor.definition.configuration) ? 'Amazon' : 'Shopify', provider: isProductMonitor(r.monitor.definition.configuration) ? 'BROWSER' : 'SHOPIFY',
      networkAllowed: context.fixtureMode || (isProductMonitor(r.monitor.definition.configuration) ? context.amazonNetworkEnabled === true : context.networkEnabled),
      product: productRows.find(p => p.row.monitor.definition.monitorId === r.monitor.definition.monitorId)?.view ?? null,
      manageable: r.monitor.definition.ownerId === 'astra-desktop' && r.monitor.definition.desktop !== undefined,
      id: r.monitor.definition.monitorId, version: r.monitor.version, revision: r.monitor.revision, name: r.monitor.definition.desktop?.name ?? 'Prior validation monitor (read-only)',
      url: r.monitor.definition.configuration.sourceReference ?? '', status: r.monitor.status, cadenceSeconds: r.monitor.definition.desktop?.cadenceSeconds ?? 0,
      nextDueAt: r.monitor.status === 'ACTIVE' ? r.nextDueAt : null, lastRunAt: r.lastRunAt, lastResult: r.lastResult ?? 'NOT_CHECKED', latest: r.lastObservation ? observationView(r.lastObservation, now) : null
    })),
    products, evaluations,
    alerts: store.restock.listAlerts().flatMap(({ event, delivery }) => {
      const a = event.alert; if (!a) return []; // Legacy events remain in their existing history; do not invent historical evaluations.
      return [{
        eventId: event.id, monitorId: a.monitorId, storeId: a.storeId, provider: a.provider, productId: a.productId, title: a.title, eventType: event.type,
        previousState: a.previousState, currentState: a.currentState, purchaseMode: a.purchaseMode, releaseDate: a.releaseDate, observedAt: event.occurredAt, provenance: a.provenance,
        stale: now < event.occurredAt || now >= a.expiresAt, delivery, opportunityStatus: a.opportunity.status, arithmetic: a.opportunity.arithmetic, reasons: a.opportunity.reasons, purchaseReady: false as const, execution: 'NOT_REQUESTED' as const
      }];
    }),
    history: [...r.audits().map(a => ({
      at: a.audit.occurredAt, action: a.audit.action, monitorId: a.audit.monitorId, runId: a.runId, observationId: a.observationId,
      evaluationId: a.audit.evaluationId, intentId: a.audit.intentId, outboxStatus: a.outbox, mode: 'DRY_RUN' as const
    })), ...productRows.flatMap(p => [...p.samples.map(s => ({ at: s.receivedAt, action: s.status === 'OBSERVATION_FAILED' ? s.provenance.reference : s.status, monitorId: p.row.monitor.definition.monitorId, runId: s.inputId, observationId: s.productObservation ? s.inputId : null, evaluationId: null, intentId: null, outboxStatus: null, mode: 'DRY_RUN' as const })), ...p.events.map(e => ({ at: e.occurredAt, action: e.type, monitorId: p.row.monitor.definition.monitorId, runId: e.currentInputId, observationId: e.currentInputId, evaluationId: null, intentId: null, outboxStatus: store.restock.getReceipts().includes(e.id) ? 'DELIVERED' : 'PENDING', mode: 'DRY_RUN' as const }))])].sort((a, b) => b.at - a.at).slice(0, 100),
    stores: [{
      id: 'shopify-kantocards', name: 'Kantocards', family: 'Shopify', domain: 'kantocards.com', observationHealth: health,
      reason: failureIsLatest ? settings.lastFailure ?? 'READ_FAILED' : latest ? latest.stale ? 'STALE_EVIDENCE' : context.fixtureMode ? 'FIXTURE_READ_OK' : 'LAST_CAPTURE_VALIDATED' : 'NOT_PROBED',
      lastSuccessAt: latest?.receivedAt ?? null, lastFailureAt: settings.lastFailureAt, adapterVersion: latest?.adapterVersion ?? 'm3.5-authorized-evidence-1', parserVersion: latest?.parserVersion ?? 'm3-shopify-1',
      policy: 'Authorized read-only validation · two approved products · six-read local budget · no automatic refill', unsupported: ['Search', 'Cart', 'Checkout', 'Order Submission']
    }, {
      id: 'amazon-mx-m5.4-browser-live', name: 'Amazon Mexico', family: 'Amazon', domain: 'www.amazon.com.mx',
      observationHealth: !amazonLast?.state ? 'UNAVAILABLE' : amazonLast.state.latest.status === 'OBSERVATION_FAILED' ? amazonLast.state.latest.provenance.reference : amazonLast.view?.stale ? 'STALE' : 'CONTENT_INCOMPLETE',
      reason: !context.amazonNetworkEnabled && !context.fixtureMode ? 'NETWORK_NOT_ENABLED' : amazonLast?.row.lastResult ?? 'NOT_PROBED',
      lastSuccessAt: amazonProduct?.sample?.receivedAt ?? null, lastFailureAt: amazonLast?.state?.latest.status === 'OBSERVATION_FAILED' ? amazonLast.state.latest.receivedAt : null,
      adapterVersion: 'AmazonBrowserProvider', parserVersion: amazonProduct?.view?.parserVersion ?? 'NOT_CHECKED',
      policy: 'Read-only · three approved ASINs · 60s minimum source interval · shared six-read durable budget · no refill', unsupported: ['Search', 'Cart', 'Checkout', 'Order Submission']
    }],
    settings: { version: settings.version, refreshSeconds: settings.refreshSeconds, storeEnabled: settings.storeEnabled, liveReadsUsed: settings.liveReadsUsed, liveReadLimit: 6 }, diagnostics: { ...r.runtimeInfo(), databaseLocation: context.databaseLocation, pendingOutbox: count.pendingOutbox, truncated: products.length >= 50 || evaluations.length >= 50 || rows.length >= 100 || store.restock.listAlerts().length >= 100 }
  };
}
