import assert from 'node:assert/strict';
import { id, ref, refKey, money, unknown } from '@ptcg/core';
import { amazonDigest, amazonRestockInput, mapAmazonDomain, normalizeAmazon, amazonRenderedCurrency } from '@ptcg/adapters';

export const AMAZON_VALIDATION_SCOPE = 'amazon-mx:anonymous:location-unvalidated';
const OWNER = id('local-owner', 'amazon-browser-m5.4-validation');
const sellerPolicy = Object.freeze({ version: 'm5.4-no-approved-sellers', mode: 'MANUAL_REVIEW', allow: [], deny: [], firstParty: [] });
/** A later successful target must not hide an earlier incomplete offer. */
export function amazonValidationStatus(observations, expected) {
  if (observations.length === expected && observations.every(o => o.status === 'PASS')) return 'PASS';
  return observations.find(o => !['PASS', 'PARTIAL'].includes(o.status))?.status ?? 'PARTIAL';
}
export function configureAmazonValidation(store, now) {
  store.execution.configureLimits({ ownerId: OWNER, version: 1, timezone: 'UTC', dailySpend: money(0n, 'MXN'), productCampaignQuantity: 1, dailyAttempts: 1, cooldownMs: 60000 }, null, now);
}
export function recordAmazonFailure(store, target, category, now, sequence) {
  const scope = { watchId: 'm5.4-live', productRef: ref(id('store', 'amazon-mx-m5.4-browser-live'), 'product', target.asin), deliveryScope: AMAZON_VALIDATION_SCOPE, kind: 'PRODUCT' };
  store.restock.record({ id: `failed-${sequence}-${now}`, mode: 'DRY_RUN', scope, observedAt: now, receivedAt: now, expiresAt: now + 60000, status: 'OBSERVATION_FAILED', coverage: 'UNKNOWN', observations: [], provenance: { provider: 'BROWSER', reference: category } }, { revision: 1, version: 'm5.4-baseline-only', seller: sellerPolicy, maximumPrice: money(0n, 'MXN'), maxAgeMs: 60000 }, now);
}
export async function persistAmazonBrowserResult(store, result, now, sequence) {
  const n = normalizeAmazon(result.evidence); const mapped = mapAmazonDomain(n, AMAZON_VALIDATION_SCOPE); const o = mapped.observations[0];
  const scope = { watchId: 'm5.4-live', productRef: mapped.productRef, deliveryScope: AMAZON_VALIDATION_SCOPE, ...(o && !mapped.productObservation ? { kind: 'OFFER', offerRef: o.offer.ref } : { kind: 'PRODUCT' }) };
  const input = amazonRestockInput(n, mapped.observations, scope, `m5.4-${n.source.fixtureId}`, now);
  const policy = { revision: 1, version: 'm5.4-baseline-only', seller: sellerPolicy, maximumPrice: money(0n, 'MXN'), maxAgeMs: 60000 };
  const restock = store.restock.record(input, policy, now);
  const rendered = n.renderedEvidence;
  const resolvedCurrency = rendered ? amazonRenderedCurrency(rendered.priceTexts, rendered.currencyCodes) : n.offers[0]?.price?.currency ?? null;
  const base = {
    rawPriceTexts: rendered?.priceTexts ?? [], resolvedCurrency,
    sellerIdentityBasis: rendered?.sellerIdentityBasis ?? (n.offers[0]?.sellerId ? 'EXTERNAL_SELLER_ID' : 'UNKNOWN'),
    sellerStatements: rendered?.sellerStatements ?? [], shipperStatements: rendered?.shipperStatements ?? [],
    shipperDisplayEvidence: rendered?.shipperDisplays ?? [],
    purchaseMode: n.productState?.purchaseMode ?? 'UNKNOWN', releaseDate: n.productState?.releaseDate ?? null,
    productPersisted: !!mapped.productObservation, offerPersisted: !!o, baseline: restock.state.baseline?.availability ?? null,
    asin: n.asin, title: n.title, price: n.offers[0]?.price ? { minor: String(n.offers[0].price.minor), currency: n.offers[0].price.currency } : null,
    availability: n.productState?.availability ?? n.offers[0]?.availability ?? 'UNKNOWN', sellerId: n.offers[0]?.sellerId ?? null, sellerDisplayName: n.offers[0]?.sellerDisplayName ?? null, fulfillment: n.offers[0]?.fulfillment ?? 'UNKNOWN',
    provider: 'BROWSER', parserVersion: n.source.parserVersion, capturedAt: n.observedAt, completeness: n.completeness,
    sellerKind: n.offers[0]?.sellerKind ?? 'UNKNOWN', condition: 'UNKNOWN', featuredOffer: 'UNKNOWN',
    found: {
      // Keep legacy keys while distinguishing text discovery, identity and normalization.
      seller: !!n.offers[0]?.sellerId, fulfillment: n.offers[0]?.fulfillment !== 'UNKNOWN' && !!n.offers[0], price: !!n.offers[0]?.price, explicitAvailability: !!n.offers[0] && n.offers[0].availability !== 'UNKNOWN',
      sellerDisplayFound: !!rendered?.sellerDisplays.length || !!rendered?.sellerStatements.length || !!n.offers[0]?.sellerDisplayName, sellerStableIdentityResolved: !!n.offers[0]?.sellerId,
      fulfillmentTextFound: !!rendered?.shipperDisplays.length || !!rendered?.shipperStatements.length,
      fulfillmentFound: n.offers[0]?.fulfillment !== 'UNKNOWN' && !!n.offers[0], priceTextFound: !!rendered?.priceTexts.length, currencyResolved: resolvedCurrency !== null
    },
    offerPersistenceReason: !o ? 'STABLE_SELLER_OR_PRODUCT_IDENTITY_INCOMPLETE' : 'STABLE_IDENTITY_RESOLVED_UNKNOWN_OPTIONAL_FACTS_RETAINED',
    shipping: 'UNKNOWN', exactQuantity: 'UNKNOWN', restockOutcome: restock.outcome, restockEvents: restock.events.map(e => e.type)
  };
  if (!o) return { input, policy, summary: { ...base, status: mapped.productObservation && base.availability === 'UNAVAILABLE' ? 'PASS' : 'PARTIAL', persisted: !!mapped.productObservation, opportunity: 'NOT_EVALUATED', reason: 'OFFER_IDENTITY_INCOMPLETE', sellerEvaluation: 'UNKNOWN_NO_OFFER', mode: 'DRY_RUN' } };
  const key = amazonDigest(refKey(o.offer.ref)).slice(0, 24); const canonicalId = id('canonical', `unreviewed-amazon:${n.asin}`);
  const missing = field => unknown('NO_VALIDATED_ESTIMATE', { ...o.identity.evidence, field, id: `${o.id}:${field}` });
  const definition = {
    monitorId: id('monitor', `m5.4:${key}`), ownerId: OWNER, campaignId: 'm5.4-validation', cycleId: `m5.4:${key}`,
    configuration: {
      target: { id: canonicalId, identity: o.variant.identity }, mapping: { version: 'm5.4-unreviewed', state: 'UNREVIEWED', canonicalId, variantRef: o.variant.ref },
      offerRef: o.offer.ref, sourceReference: n.productUrl, deliveryScope: AMAZON_VALIDATION_SCOPE, quantity: 1, currency: 'MXN', mode: 'DRY_RUN', sellerPolicy,
      purchasePolicy: { version: 'm5.4-zero-spend', maximumOrderValue: money(0n, 'MXN'), expression: { op: 'ALL', rules: [] } },
      scenario: { id: 'm5.4-no-estimates', benchmark: { kind: 'MANUAL_ESTIMATE', canonicalId, quantity: 1, grossResale: missing('benchmark') }, otherAcquisition: missing('other'), verifiedDiscount: missing('discount'), outbound: missing('outbound'), lossAllowance: missing('loss'), fixedFee: missing('fee'), feeBasisPoints: 0 }
    }
  };
  try { store.monitors.getMonitor(definition.monitorId); } catch (e) { if (e.code !== 'NOT_FOUND') throw e; store.monitors.publishRevision(definition, null, now); }
  const adapter = {
    descriptor: { id: 'amazon-browser-captured', version: n.source.parserVersion, contractVersion: 1, automationLevel: 'OBSERVE_ONLY', capabilities: ['OBSERVATION'] },
    async observe(requested) { assert.equal(refKey(requested), refKey(o.offer.ref)); return { ok: true, observation: o, catalog: mapped.catalog }; }
  };
  const command = { monitorId: definition.monitorId, revision: 1, runId: `m5.4-${o.id}-${sequence}`, operationId: `m5.4-${o.id}-${sequence}`, traceId: 'm5.4', now };
  const decision = await store.coordinator.run(adapter, command); assert.notEqual(decision.status, 'FAILED'); assert.equal(decision.simulation.mode, 'DRY_RUN'); assert.equal(decision.simulation.intentState, 'BLOCKED');
  const evaluation = store.evidence.getEvaluation(JSON.stringify(['DRY_RUN', OWNER, command.operationId]) + ':evaluation');
  assert.equal(evaluation.evaluation.seller.result, 'REVIEW_REQUIRED'); assert.equal(evaluation.evaluation.opportunity.status, 'INDETERMINATE');
  return { input, policy, observation: o, command, adapter, summary: { ...base, status: base.availability === 'UNKNOWN' || !base.price ? 'PARTIAL' : 'PASS', persisted: true, sellerEvaluation: 'REVIEW_REQUIRED', opportunity: 'INDETERMINATE', intent: 'BLOCKED', mode: 'DRY_RUN', observationId: o.id, offerIdentity: refKey(o.offer.ref), productIdentity: refKey(o.product.ref) } };
}
export async function verifyAmazonReopen(store, entries, now) {
  for (const e of entries) {
    assert.equal(store.restock.record(e.input, e.policy, now).outcome, 'DUPLICATE');
    if (e.observation) {
      assert.ok(store.evidence.getObservationHistory(e.observation.offer.ref).some(row => row.observation.id === e.observation.id && row.observation.seller.evidence.sourceId.includes(':BROWSER:live:')));
      assert.equal((await store.coordinator.run(e.adapter, { ...e.command, now })).status, 'DUPLICATE');
    }
  }
  store.coordinator.recover(now); assert.equal(store.coordinator.recover(now).delivered, 0); store.restock.deliverPending(now); assert.equal(store.restock.deliverPending(now).delivered, 0);
  return { reopened: true, replayIdempotent: true };
}
