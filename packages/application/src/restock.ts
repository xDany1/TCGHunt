import { assessEvidence, freeze, instant, positiveInteger, refKey, sameRef, validateSeller } from '@ptcg/core';
import type { ListingObservation, Money, SellerPolicy, StoreRef, Observed } from '@ptcg/core';
import { PersistenceFailure } from './durable-contracts.js';
import { stableKey } from './durable-identity.js';
import type { MonitoringAlert, MonitoringOpportunityContext } from './monitoring-alert.js';

export type RestockScope = { readonly watchId: string; readonly productRef: StoreRef<'product'>; readonly deliveryScope: string; } & (
  { readonly kind: 'OFFER'; readonly offerRef: StoreRef<'offer'>; } | { readonly kind: 'SELLER'; readonly sellerRef: StoreRef<'seller'>; } | { readonly kind: 'PRODUCT'; });
export interface RestockPolicy { readonly revision: number; readonly version: string; readonly seller: SellerPolicy; readonly maximumPrice: Money; readonly maxAgeMs: number; }
export type RestockEvidenceStatus = 'OBSERVED' | 'NO_OFFER_OBSERVED' | 'PARTIAL_COVERAGE' | 'OBSERVATION_FAILED' | 'UNKNOWN';
export interface ProductPageObservation {
  readonly unitPrice?: Observed<Money>; readonly seller?: Observed<string>; readonly fulfillment?: Observed<string>;
  readonly productRef: StoreRef<'product'>; readonly title: string;
  readonly availability: Observed<'AVAILABLE' | 'UNAVAILABLE'>;
  readonly purchaseMode: Observed<'IMMEDIATE' | 'PREORDER'>;
  readonly releaseDate: Observed<string>;
}
export interface RestockInput {
  readonly opportunityContext?: MonitoringOpportunityContext;
  readonly productObservation?: ProductPageObservation;
  readonly id: string; readonly mode: 'DRY_RUN'; readonly scope: RestockScope; readonly observedAt: number; readonly receivedAt: number; readonly expiresAt: number;
  readonly status: RestockEvidenceStatus; readonly coverage: 'EXPLICIT_OFFER' | 'COMPLETE_SCOPE' | 'PARTIAL' | 'UNKNOWN' | 'PRODUCT_PAGE';
  readonly observations: readonly ListingObservation[];
  readonly provenance: { readonly provider: string; readonly reference: string; };
}
export interface RestockFact {
  readonly purchaseMode?: 'IMMEDIATE' | 'PREORDER' | 'UNKNOWN';
  readonly observationId: string; readonly offer: string; readonly seller: string; readonly fulfillment: string | null;
  readonly available: boolean | null; readonly approved: boolean; readonly price: 'IN_RANGE' | 'ABOVE' | 'UNKNOWN';
  readonly priceValue: Money | null; readonly priceExpiresAt: number;
  readonly expiresAt: number; readonly evidenceIds: readonly string[];
}
export interface RestockSample {
  readonly productObservation?: ProductPageObservation;
  readonly purchaseMode?: 'IMMEDIATE' | 'PREORDER' | 'UNKNOWN';
  readonly inputId: string; readonly scopeKey: string; readonly policyKey: string; readonly policyRevision: number; readonly policyVersion: string;
  readonly mode: 'DRY_RUN'; readonly observedAt: number; readonly receivedAt: number; readonly expiresAt: number;
  readonly status: RestockEvidenceStatus; readonly coverage: RestockInput['coverage']; readonly provenance: RestockInput['provenance'];
  readonly facts: readonly RestockFact[]; readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly approvedAvailable: boolean | null; readonly price: RestockFact['price']; readonly comparable: boolean;
}
export interface RestockState { readonly latest: RestockSample; readonly baseline: RestockSample | null; readonly interrupted: boolean; }
export type RestockEventType = 'RESTOCK_DETECTED' | 'AVAILABILITY_LOST' | 'APPROVED_OFFER_BECAME_AVAILABLE' | 'APPROVED_OFFER_BECAME_UNAVAILABLE' | 'PRICE_ENTERED_RANGE' | 'PRICE_LEFT_RANGE' | 'PREORDER_OPENED' | 'PREORDER_CLOSED' | 'PURCHASE_MODE_CHANGED';
export interface RestockEvent {
  /** Optional additive projection; historical envelopes remain readable without rewriting evidence. */
  readonly alert?: MonitoringAlert;
  readonly id: string; readonly schemaVersion: 1; readonly mode: 'DRY_RUN'; readonly type: RestockEventType;
  readonly scopeKey: string; readonly previousInputId: string; readonly currentInputId: string;
  readonly policyRevision: number; readonly policyVersion: string; readonly occurredAt: number;
  /** A reevaluation request, never purchase readiness or permission. */
  readonly reevaluateOpportunity: true;
}
export interface RestockDecision {
  readonly outcome: 'INITIALIZED' | 'RECOVERED' | 'UPDATED' | 'UNCHANGED' | 'INCOMPLETE' | 'IGNORED_OLD' | 'DUPLICATE';
  readonly state: RestockState; readonly events: readonly RestockEvent[];
}
export interface RestockRepository {
  listAlerts(): readonly { readonly event: RestockEvent; readonly delivery: 'PENDING' | 'DELIVERED' | 'DEAD_LETTER'; }[];
  record(input: RestockInput, policy: RestockPolicy, now: number): RestockDecision;
  getState(scope: RestockScope): RestockState | null;
  getEvents(scope: RestockScope): readonly RestockEvent[];
  getSamples(scope: RestockScope): readonly RestockSample[];
  deliverPending(now: number): { readonly delivered: number; readonly failed: number; };
  getReceipts(): readonly string[];
}
function text(s: string): void { if (typeof s !== 'string' || !s.trim() || s.length > 2000 || /[\u0000-\u001f]/.test(s)) throw new PersistenceFailure('INVALID_INPUT'); }
export function restockScopeKey(s: RestockScope): string {
  text(s.watchId); text(s.deliveryScope); text(s.productRef.externalId);
  const child = s.kind === 'OFFER' ? s.offerRef : s.kind === 'SELLER' ? s.sellerRef : null;
  if (!['OFFER', 'SELLER', 'PRODUCT'].includes(s.kind) || s.productRef.kind !== 'product' || (child && (child.storeId !== s.productRef.storeId || child.kind !== (s.kind === 'OFFER' ? 'offer' : 'seller')))) throw new PersistenceFailure('INVALID_INPUT');
  return stableKey('restock-v1', s.watchId, refKey(s.productRef), s.deliveryScope, s.kind, child ? refKey(child) : '');
}
function policyKey(p: RestockPolicy): string {
  positiveInteger(p.revision); positiveInteger(p.maxAgeMs); text(p.version); text(p.seller.version);
  if (p.maxAgeMs > 60_000 || typeof p.maximumPrice.minor !== 'bigint' || p.maximumPrice.minor < 0n || !['MXN', 'USD'].includes(p.maximumPrice.currency)) throw new PersistenceFailure('INVALID_INPUT');
  return stableKey(p.revision, p.version, p.seller.version, p.seller.mode, ...[p.seller.allow, p.seller.deny, p.seller.firstParty].map(a => JSON.stringify(a.map(refKey).sort())), String(p.maximumPrice.minor), p.maximumPrice.currency, p.maxAgeMs);
}
/** Project domain evidence into the minimal durable comparison record. No HTML/API/provider conditionals. */
export function restockSample(input: RestockInput, policy: RestockPolicy, now: number): RestockSample {
  instant(now); const key = policyKey(policy); const scopeKey = restockScopeKey(input.scope);
  text(input.id); text(input.provenance.provider); text(input.provenance.reference);
  for (const at of [input.observedAt, input.receivedAt, input.expiresAt]) instant(at);
  if (input.mode !== 'DRY_RUN' || input.observedAt > input.receivedAt || input.receivedAt > now || input.expiresAt < input.observedAt || input.observations.length > 100 ||
    !['OBSERVED', 'NO_OFFER_OBSERVED', 'PARTIAL_COVERAGE', 'OBSERVATION_FAILED', 'UNKNOWN'].includes(input.status) || !['EXPLICIT_OFFER', 'COMPLETE_SCOPE', 'PARTIAL', 'UNKNOWN', 'PRODUCT_PAGE'].includes(input.coverage)) throw new PersistenceFailure('INVALID_INPUT');
  const product = input.productObservation;
  if (product) {
    text(product.title);
    if (input.scope.kind !== 'PRODUCT' || input.coverage !== 'PRODUCT_PAGE' || !sameRef(product.productRef, input.scope.productRef) ||
      [product.availability, product.purchaseMode, product.releaseDate].some(f => f.evidence.sourceObservedAt !== input.observedAt)) throw new PersistenceFailure('INVALID_INPUT');
    if (product.purchaseMode.state === 'KNOWN' && !['IMMEDIATE', 'PREORDER'].includes(product.purchaseMode.value)) throw new PersistenceFailure('INVALID_INPUT');
  } else if (input.coverage === 'PRODUCT_PAGE') throw new PersistenceFailure('INVALID_INPUT');
  const seen = new Set<string>(); const facts: RestockFact[] = [];
  for (const o of input.observations) {
    const s = input.scope; const offer = refKey(o.offer.ref);
    if (!sameRef(o.product.ref, s.productRef) || o.offer.deliveryScope !== s.deliveryScope || !sameRef(o.variant.productRef, o.product.ref) || !sameRef(o.listing.productRef, o.product.ref) || !sameRef(o.offer.variantRef, o.variant.ref) || !sameRef(o.offer.listingRef, o.listing.ref) || !sameRef(o.listing.variantRef, o.variant.ref) ||
      o.stock.evidence.sourceObservedAt !== input.observedAt || [o.variant.ref, o.listing.ref, o.offer.ref, o.offer.sellerRef].some(r => r.storeId !== s.productRef.storeId) ||
      (s.kind === 'OFFER' && !sameRef(o.offer.ref, s.offerRef)) || (s.kind === 'SELLER' && !sameRef(o.offer.sellerRef, s.sellerRef)) || seen.has(offer)) throw new PersistenceFailure('INVALID_INPUT');
    seen.add(offer);
    const fresh = (field: ListingObservation['stock'] | ListingObservation['unitPrice'] | ListingObservation['seller'] | ListingObservation['fulfilledBy']) => assessEvidence<unknown>(field, now, policy.maxAgeMs).status === 'PASS' && field.evidence.sourceObservedAt <= input.observedAt;
    const seller = validateSeller(o, policy.seller, now);
    const available = fresh(o.stock) && o.stock.state === 'KNOWN' && ['IN_STOCK', 'OUT_OF_STOCK'].includes(o.stock.value) ? o.stock.value === 'IN_STOCK' : null;
    const price = fresh(o.unitPrice) && o.unitPrice.state === 'KNOWN' && o.unitPrice.value.currency === policy.maximumPrice.currency && o.unitPrice.value.minor >= 0n ? o.unitPrice.value.minor <= policy.maximumPrice.minor ? 'IN_RANGE' : 'ABOVE' : 'UNKNOWN';
    facts.push({
      ...(o.purchaseMode ? { purchaseMode: assessEvidence(o.purchaseMode, now, policy.maxAgeMs).status === 'PASS' && o.purchaseMode.state === 'KNOWN' ? o.purchaseMode.value : 'UNKNOWN' as const } : {}),
      observationId: o.id, offer, seller: refKey(o.offer.sellerRef), fulfillment: fresh(o.fulfilledBy) && o.fulfilledBy.state === 'KNOWN' ? refKey(o.fulfilledBy.value) : null,
      available, approved: fresh(o.seller) && seller.result === 'APPROVED', price, priceValue: price !== 'UNKNOWN' && o.unitPrice.state === 'KNOWN' ? o.unitPrice.value : null,
      priceExpiresAt: Math.min(o.unitPrice.evidence.expiresAt, o.unitPrice.evidence.sourceObservedAt + policy.maxAgeMs),
      expiresAt: Math.min(o.stock.evidence.expiresAt, o.seller.evidence.expiresAt, o.stock.evidence.sourceObservedAt + policy.maxAgeMs, o.seller.evidence.sourceObservedAt + policy.maxAgeMs, ...(o.purchaseMode ? [o.purchaseMode.evidence.expiresAt] : [])),
      evidenceIds: [o.stock.evidence.id, o.seller.evidence.id, o.unitPrice.evidence.id, o.fulfilledBy.evidence.id]
    });
  }
  facts.sort((a, b) => a.offer < b.offer ? -1 : a.offer > b.offer ? 1 : 0);
  const explicit = input.scope.kind === 'OFFER' && input.coverage === 'EXPLICIT_OFFER' && facts.length === 1;
  const covered = !!product || explicit || input.coverage === 'COMPLETE_SCOPE';
  const validStatus = (input.status === 'OBSERVED' && (facts.length > 0 || !!product)) || (input.status === 'NO_OFFER_OBSERVED' && facts.length === 0 && input.coverage === 'COMPLETE_SCOPE');
  const expiresAt = Math.min(input.expiresAt, input.observedAt + policy.maxAgeMs, ...(product ? [product.availability.evidence.expiresAt, ...(product.purchaseMode.state === 'KNOWN' ? [product.purchaseMode.evidence.expiresAt] : [])] : facts.map(f => f.expiresAt)));
  const productKnown = product && assessEvidence(product.availability, now, policy.maxAgeMs).status === 'PASS' && product.availability.state === 'KNOWN' && ['AVAILABLE', 'UNAVAILABLE'].includes(product.availability.value);
  const comparable = covered && validStatus && (product ? !!productKnown : facts.every(f => f.available !== null)) && now < expiresAt;
  return freeze({
    inputId: input.id, scopeKey, policyKey: key, policyRevision: policy.revision, policyVersion: policy.version, mode: 'DRY_RUN', observedAt: input.observedAt, receivedAt: input.receivedAt, expiresAt,
    status: input.status, coverage: input.coverage, provenance: { provider: input.provenance.provider, reference: input.provenance.reference }, facts,
    ...(product ? { productObservation: product, purchaseMode: assessEvidence(product.purchaseMode, now, policy.maxAgeMs).status === 'PASS' && product.purchaseMode.state === 'KNOWN' ? product.purchaseMode.value : 'UNKNOWN' as const } : {}),
    availability: comparable ? product && product.availability.state === 'KNOWN' ? product.availability.value : facts.some(f => f.available) ? 'AVAILABLE' : 'UNAVAILABLE' : 'UNKNOWN',
    approvedAvailable: comparable ? facts.some(f => f.available && f.approved) : null,
    price: input.scope.kind === 'OFFER' ? facts[0]?.price ?? 'UNKNOWN' : 'UNKNOWN', comparable
  });
}
/** Strong explicit evidence transitions immediately. No hidden timer, provider-specific debounce or purchase authority. */
export function transitionRestock(previous: RestockState | null, current: RestockSample, scope: RestockScope, now: number): RestockDecision {
  instant(now);
  if (current.mode !== 'DRY_RUN' || current.scopeKey !== restockScopeKey(scope) || current.receivedAt > now) throw new PersistenceFailure('INVALID_INPUT');
  if (previous && previous.latest.scopeKey !== current.scopeKey) throw new PersistenceFailure('INVALID_INPUT');
  if (previous && (current.policyRevision < previous.latest.policyRevision || current.observedAt <= previous.latest.observedAt)) return freeze({ outcome: 'IGNORED_OLD', state: previous, events: [] });
  if (previous && current.policyRevision === previous.latest.policyRevision && current.policyKey !== previous.latest.policyKey) throw new PersistenceFailure('CONFLICT');
  const before = previous?.baseline ?? null;
  for (const f of current.facts) {
    const prior = before?.facts.find(p => p.offer === f.offer);
    if (prior && (prior.seller !== f.seller || (prior.fulfillment && f.fulfillment && prior.fulfillment !== f.fulfillment))) throw new PersistenceFailure('CONFLICT');
  }
  if (!current.comparable) return freeze({ outcome: 'INCOMPLETE', state: { latest: current, baseline: before, interrupted: true }, events: [] });
  const canCompare = before && before.policyKey === current.policyKey && now < before.expiresAt;
  if (!canCompare) return freeze({ outcome: before ? 'RECOVERED' : 'INITIALIZED', state: { latest: current, baseline: current, interrupted: false }, events: [] });
  const types: RestockEventType[] = [];
  const oldMode = before.purchaseMode ?? before.facts[0]?.purchaseMode ?? 'IMMEDIATE';
  const newMode = current.purchaseMode ?? current.facts[0]?.purchaseMode ?? 'IMMEDIATE';
  // Product-page signals describe commerce state only; offer signals retain seller-policy gating.
  const productSignal = !!current.productObservation && !!before.productObservation;
  if (productSignal || scope.kind === 'OFFER') {
    if (before.availability === 'UNAVAILABLE' && current.availability === 'AVAILABLE' && (productSignal || current.approvedAvailable) && before.status === 'OBSERVED') {
      if (newMode === 'PREORDER') types.push('PREORDER_OPENED');
      else if (newMode === 'IMMEDIATE') types.push('RESTOCK_DETECTED');
    }
    if (before.availability === 'AVAILABLE' && current.availability === 'UNAVAILABLE' && (productSignal || before.approvedAvailable) && current.status === 'OBSERVED') types.push(oldMode === 'PREORDER' ? 'PREORDER_CLOSED' : 'AVAILABILITY_LOST');
    if (before.availability === 'AVAILABLE' && current.availability === 'AVAILABLE' && oldMode !== 'UNKNOWN' && newMode !== 'UNKNOWN' && oldMode !== newMode && (productSignal || current.approvedAvailable)) types.push('PURCHASE_MODE_CHANGED');
    if (!productSignal && oldMode === newMode && newMode === 'IMMEDIATE' && before.availability === 'AVAILABLE' && current.availability === 'AVAILABLE' && before.approvedAvailable && current.approvedAvailable && now < (before.facts[0]?.priceExpiresAt ?? 0)) {
      if (before.price === 'ABOVE' && current.price === 'IN_RANGE') types.push('PRICE_ENTERED_RANGE');
      if (before.price === 'IN_RANGE' && current.price === 'ABOVE') types.push('PRICE_LEFT_RANGE');
    }
  } else {
    if (before.approvedAvailable === false && current.approvedAvailable) types.push('APPROVED_OFFER_BECAME_AVAILABLE');
    if (before.approvedAvailable && current.approvedAvailable === false) types.push('APPROVED_OFFER_BECAME_UNAVAILABLE');
  }
  const events = types.map(type => ({
    id: stableKey('restock-event-v1', current.scopeKey, current.policyKey, before.inputId, current.inputId, type), schemaVersion: 1 as const, mode: 'DRY_RUN' as const, type, scopeKey: current.scopeKey,
    previousInputId: before.inputId, currentInputId: current.inputId, policyRevision: current.policyRevision, policyVersion: current.policyVersion, occurredAt: current.observedAt, reevaluateOpportunity: true as const
  }));
  return freeze({ outcome: events.length ? 'UPDATED' : previous?.interrupted ? 'RECOVERED' : 'UNCHANGED', state: { latest: current, baseline: current, interrupted: false }, events });
}
