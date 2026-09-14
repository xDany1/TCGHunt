import { assessEvidence, check, evaluateOpportunity, evaluateRules, freeze, instant, matchProduct, positiveInteger, refKey, simulate, validateSeller } from '@ptcg/core';
import type { CanonicalProduct, CostScenario, Currency, ListingObservation, OpportunityEvaluation, ProductMapping, PurchasePolicy, RuleEvaluation, SellerEvaluation, SellerPolicy, SimulationResult, StoreRef } from '@ptcg/core';
import type { AdapterError, OfferObservationCapability } from './ports.js';
import type { CatalogMetadata } from './source-contracts.js';

export interface SimulationRequest {
  readonly target: CanonicalProduct; readonly mapping: ProductMapping; readonly offerRef: StoreRef<'offer'>;
  readonly scenario: CostScenario; readonly quantity: number; readonly currency: Currency;
  readonly sellerPolicy: SellerPolicy; readonly purchasePolicy: PurchasePolicy;
  readonly now: number; readonly operationId: string; readonly traceId: string; readonly cycleId: string;
  readonly deliveryScope: string; readonly mode?: 'DRY_RUN';
  readonly sourceReference?: string; readonly monitorId?: string; readonly runId?: string;
}
export type EvaluationResult =
  | { readonly status: 'READ_FAILED'; readonly error: AdapterError; }
  | {
    readonly status: 'EVALUATED'; readonly observation: ListingObservation; readonly seller: SellerEvaluation; readonly opportunity: OpportunityEvaluation;
    readonly rules: RuleEvaluation; readonly simulation: SimulationResult;
    readonly catalog?: CatalogMetadata;
  };

export async function evaluateSimulation(adapter: OfferObservationCapability, request: SimulationRequest): Promise<EvaluationResult> {
  // Freeze before the async read so edits cannot change policy mid-evaluation.
  let r = freeze(request);
  instant(r.now);
  positiveInteger(r.quantity);
  if (r.mode !== undefined && r.mode !== 'DRY_RUN') throw new RangeError('No non-DRY_RUN mode exists in M1');
  if (![r.operationId, r.traceId, r.cycleId, r.deliveryScope].every(value => value.trim().length > 0)) throw new RangeError('Missing evaluation context');
  const read = await adapter.observe(r.offerRef, {
    now: r.now, deadlineAt: r.now + 15_000,
    operationId: r.operationId, traceId: r.traceId, currency: r.currency, deliveryScope: r.deliveryScope,
    ...(r.sourceReference ? { sourceReference: r.sourceReference } : {}),
    ...(r.monitorId ? { monitorId: r.monitorId } : {}), ...(r.runId ? { runId: r.runId } : {})
  });
  if (!read.ok) return freeze({ status: 'READ_FAILED', error: read.error });
  if (read.completedAt !== undefined) {
    instant(read.completedAt);
    if (read.completedAt < r.now || read.completedAt >= r.now + 15_000) return freeze({ status: 'READ_FAILED', error: { code: 'DEADLINE_EXCEEDED', category: 'NON_RETRYABLE', externalEffect: 'NOT_SENT', operationId: r.operationId } });
    r = freeze({ ...r, now: read.completedAt });
  }
  const o = freeze(read.observation);
  const match = matchProduct(r.target, o, r.mapping);
  const seller = validateSeller(o, r.sellerPolicy, r.now);
  const opportunity = evaluateOpportunity({
    id: `${r.operationId}:evaluation`, target: r.target, observation: o,
    scenario: r.scenario, quantity: r.quantity, currency: r.currency, now: r.now
  });
  const rules = evaluateRules(r.purchasePolicy, o, opportunity, r.quantity);
  const checks = [
    ...(o.purchaseMode ? [assessEvidence(o.purchaseMode, r.now), check('IMMEDIATE_PURCHASE_MODE', o.purchaseMode.state === 'KNOWN' ? o.purchaseMode.value === 'IMMEDIATE' ? 'PASS' : 'FAIL' : 'INDETERMINATE', {}, [o.purchaseMode.evidence.id])] : []),
    ...match.checks, ...seller.checks, ...opportunity.checks, ...rules.checks,
    check('OBSERVE_ONLY_CAPABILITY', adapter.descriptor.automationLevel === 'OBSERVE_ONLY' && adapter.descriptor.contractVersion === 1 && adapter.descriptor.capabilities.includes('OBSERVATION') && adapter.descriptor.capabilities.every(c => c === 'OBSERVATION' || c === 'RESOLUTION') ? 'PASS' : 'FAIL'),
    check('REQUESTED_OFFER', refKey(o.offer.ref) === refKey(r.offerRef) && o.offer.deliveryScope === r.deliveryScope && o.offer.condition === 'NEW_SEALED' ? 'PASS' : 'FAIL'),
    assessEvidence(o.identity, r.now), assessEvidence(o.stock, r.now),
    assessEvidence(o.availableQuantity, r.now), assessEvidence(o.purchaseLimit, r.now),
    check('SELLER_APPROVED', seller.result === 'APPROVED' ? 'PASS' : seller.result === 'REJECTED' ? 'FAIL' : 'INDETERMINATE'),
    check('COMPLETE_COSTS', opportunity.status === 'COMPLETE' ? 'PASS' : 'INDETERMINATE'),
    check('IN_STOCK', o.stock.state !== 'KNOWN' || o.stock.value === 'UNKNOWN' ? 'INDETERMINATE' : o.stock.value === 'IN_STOCK' ? 'PASS' : 'FAIL', {}, [o.stock.evidence.id])
  ];
  for (const field of [o.availableQuantity, o.purchaseLimit]) {
    const valid = field.state === 'KNOWN' && Number.isSafeInteger(field.value) && field.value >= 0;
    checks.push(check('QUANTITY_AVAILABLE_AND_ALLOWED', !valid ? 'INDETERMINATE' : r.quantity <= field.value ? 'PASS' : 'FAIL',
      { requested: String(r.quantity), actual: field.state === 'KNOWN' ? String(field.value) : 'UNKNOWN' }, [field.evidence.id]));
  }
  const simulation = simulate({
    intentId: `${r.cycleId}:intent`, attemptId: `${r.operationId}:attempt`,
    operationId: r.operationId, traceId: r.traceId, cycleId: r.cycleId, canonicalId: r.target.id,
    offerKey: refKey(o.offer.ref), observationId: o.id, evaluationId: opportunity.id,
    variantKey: refKey(o.variant.ref), sellerKey: refKey(o.offer.sellerRef), deliveryScope: r.deliveryScope,
    currency: r.currency, maximumOrderValue: r.purchasePolicy.maximumOrderValue, scenarioId: r.scenario.id,
    mappingVersion: r.mapping.version, sellerPolicyVersion: seller.policyVersion, purchasePolicyVersion: rules.policyVersion,
    quantity: r.quantity
  }, checks, r.now);
  return freeze({ status: 'EVALUATED', observation: o, seller, opportunity, rules, simulation, ...(read.catalog ? { catalog: read.catalog } : {}) });
}
