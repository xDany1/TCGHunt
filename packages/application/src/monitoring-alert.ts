import { assessEvidence, evaluateOpportunity, freeze, matchProduct, validateSeller } from '@ptcg/core';
import type { CanonicalProduct, CostScenario, Currency, OpportunityEvaluation, ProductMapping, Observed } from '@ptcg/core';
import type { RestockEvent, RestockInput, RestockPolicy, RestockSample } from './restock.js';

/** Explicit reviewed context, never inferred from a product-page title or presentation fields. */
export interface MonitoringOpportunityContext {
  readonly observationId: string; readonly target: CanonicalProduct; readonly mapping: ProductMapping;
  readonly scenario: CostScenario; readonly quantity: number; readonly currency: Currency;
}
export interface MonitoringOpportunityDecision {
  readonly status: 'BLOCKED' | 'EVALUATED'; readonly arithmetic: 'INDETERMINATE' | 'COMPLETE';
  readonly reasons: readonly string[]; readonly evaluation: OpportunityEvaluation | null;
  readonly purchaseReady: false; readonly execution: 'NOT_REQUESTED';
}
export interface MonitoringAlert {
  readonly version: 1; readonly monitorId: string; readonly storeId: string; readonly productId: string; readonly title: string;
  readonly provider: string; readonly provenance: string; readonly previousState: string; readonly currentState: string;
  readonly purchaseMode: string; readonly releaseDate: string | null; readonly expiresAt: number;
  readonly opportunity: MonitoringOpportunityDecision;
}
/** Financial evaluation only. No simulation/admission coordinator or execution repository is called. */
export function monitoringOpportunity(input: RestockInput, policy: RestockPolicy, now: number, evaluationId: string): MonitoringOpportunityDecision {
  const context = input.opportunityContext; const product = input.productObservation;
  const o = context ? input.observations.find(o => o.id === context.observationId) : input.observations.length === 1 ? input.observations[0] : undefined;
  const fresh = (field: Observed<unknown> | undefined) => !!field && field.state === 'KNOWN' && assessEvidence(field, now, policy.maxAgeMs).status === 'PASS';
  const reasons: string[] = [];
  if (!o) reasons.push('OFFER_IDENTITY_MISSING');
  if (!fresh(o?.seller ?? product?.seller)) reasons.push('SELLER_UNKNOWN');
  if (!fresh(o?.unitPrice ?? product?.unitPrice)) reasons.push('PRICE_UNKNOWN');
  if (!fresh(o?.fulfilledBy ?? product?.fulfillment)) reasons.push('FULFILLMENT_UNKNOWN');
  if (!context) reasons.push('PRODUCT_MAPPING_UNREVIEWED', 'ACQUISITION_COST_UNKNOWN', 'RESALE_EVIDENCE_MISSING');
  let evaluation: OpportunityEvaluation | null = null;
  if (context && o) {
    if (matchProduct(context.target, o, context.mapping).status !== 'PASS' || !fresh(o.identity)) reasons.push('PRODUCT_MAPPING_UNREVIEWED');
    if (validateSeller(o, policy.seller, now).result !== 'APPROVED') reasons.push('SELLER_NOT_APPROVED');
    try {
      evaluation = evaluateOpportunity({ id: evaluationId, target: context.target, observation: o, scenario: context.scenario, quantity: context.quantity, currency: context.currency, now });
      if (evaluation.status !== 'COMPLETE') reasons.push('ACQUISITION_COST_UNKNOWN');
      if (!fresh(context.scenario.benchmark.grossResale)) reasons.push('RESALE_EVIDENCE_MISSING');
      reasons.push(...evaluation.checks.filter(c => c.status !== 'PASS').map(c => c.code));
    } catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      reasons.push('INVALID_OPPORTUNITY_CONTEXT');
    }
  }
  return freeze({ status: reasons.length ? 'BLOCKED' : 'EVALUATED', arithmetic: evaluation?.status ?? 'INDETERMINATE', reasons: [...new Set(reasons)], evaluation, purchaseReady: false, execution: 'NOT_REQUESTED' });
}
export function monitoringAlert(event: RestockEvent, previous: RestockSample, current: RestockSample, input: RestockInput, policy: RestockPolicy, now: number): MonitoringAlert {
  const p = current.productObservation; const release = p?.releaseDate;
  return freeze({
    version: 1, monitorId: input.scope.watchId, storeId: input.scope.productRef.storeId, productId: input.scope.productRef.externalId,
    title: p?.title ?? input.observations[0]?.product.title ?? 'Unknown product title', provider: current.provenance.provider, provenance: current.provenance.reference,
    previousState: previous.availability, currentState: current.availability, purchaseMode: current.purchaseMode ?? current.facts[0]?.purchaseMode ?? 'UNKNOWN',
    releaseDate: release?.state === 'KNOWN' && assessEvidence(release, now, policy.maxAgeMs).status === 'PASS' ? release.value : null,
    expiresAt: current.expiresAt, opportunity: monitoringOpportunity(input, policy, now, event.id)
  });
}
