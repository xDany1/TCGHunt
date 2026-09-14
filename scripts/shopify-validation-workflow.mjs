import assert from 'node:assert/strict';
import { id, ref, refKey, money, unknown } from '@ptcg/core';
import { AuthorizedEvidenceAdapter } from '@ptcg/adapters';

export const VALIDATION_OWNER = id('local-owner', 'kantocards-m3.5-validation');
export function validationMonitor(evidence, now) {
  const o = evidence.observation;
  const canonicalId = id('canonical', `unreviewed-kantocards:${o.variant.ref.externalId}`);
  const missing = field => unknown('NO_MANUAL_VALIDATION_ASSUMPTION_PROVIDED', {
    ...o.identity.evidence, id: `${o.id}:manual:${field}`, field,
    sourceId: 'local-validation-context', sourceVersion: 'm3.5-no-manual-estimates-1', sourceObservedAt: now, capturedAt: now, receivedAt: now, expiresAt: now + 60001
  });
  return {
    monitorId: id('monitor', `kantocards:${o.variant.ref.externalId}`), ownerId: VALIDATION_OWNER, campaignId: 'm3.5-validation', cycleId: `validation:${o.variant.ref.externalId}`,
    configuration: {
      target: { id: canonicalId, identity: { kind: 'UNKNOWN', set: '', edition: '', language: null, packUnits: null } },
      mapping: { version: 'unreviewed-m3.5-1', state: 'UNREVIEWED', canonicalId, variantRef: o.variant.ref },
      offerRef: o.offer.ref, sourceReference: evidence.catalog.sourceReference, deliveryScope: o.offer.deliveryScope, quantity: 1,
      // Explicit zero-spend simulation policy denomination, never a substitute for missing observed currency.
      currency: 'MXN', mode: 'DRY_RUN',
      sellerPolicy: { version: 'kantocards-authorized-domain-1', mode: 'ALLOWLIST', allow: [ref(o.offer.ref.storeId, 'seller', 'kantocards')], deny: [], firstParty: [] },
      purchasePolicy: { version: 'm3.5-zero-spend-1', maximumOrderValue: money(0n, 'MXN'), expression: { op: 'ALL', rules: [] } },
      scenario: {
        id: 'm3.5-unsupplied-manual-benchmark', benchmark: { kind: 'MANUAL_ESTIMATE', canonicalId, quantity: 1, grossResale: missing('benchmark') },
        otherAcquisition: missing('other-acquisition'), verifiedDiscount: missing('discount'), outbound: missing('outbound'), lossAllowance: missing('loss'), fixedFee: missing('fixed-fee'), feeBasisPoints: 0
      }
    }
  };
}
export function configureValidation(store, now) {
  store.execution.configureLimits({ ownerId: VALIDATION_OWNER, version: 1, timezone: 'UTC', dailySpend: money(0n, 'MXN'), productCampaignQuantity: 1, dailyAttempts: 1, cooldownMs: 60000 }, null, now);
}
export async function persistValidation(store, evidence, now, sequence = 'first') {
  const monitor = validationMonitor(evidence, now);
  if (sequence === 'first') store.monitors.publishRevision(monitor, null, now);
  const command = { monitorId: monitor.monitorId, revision: 1, runId: `run:${evidence.observation.id}:${sequence}`, operationId: `operation:${evidence.observation.id}:${sequence}`, traceId: 'm3.5-validation', now };
  const adapter = new AuthorizedEvidenceAdapter(evidence);
  assert.deepEqual(adapter.descriptor.capabilities, ['OBSERVATION']);
  const result = await store.coordinator.run(adapter, command);
  assert.notEqual(result.status, 'FAILED');
  assert.equal(result.simulation.intentState, 'BLOCKED');
  const history = store.execution.getDecisionHistory(result.simulation.scope.intentId);
  assert.equal(history.reservation, null);
  assert.equal(history.audit.at(-1)?.action, 'PURCHASE_BLOCKED');
  const rows = store.evidence.getObservationHistory(evidence.observation.offer.ref);
  assert.ok(rows.some(row => row.observation.id === evidence.observation.id));
  const evaluationId = JSON.stringify(['DRY_RUN', monitor.ownerId, command.operationId]) + ':evaluation';
  const evaluation = store.evidence.getEvaluation(evaluationId);
  assert.equal(evaluation.evaluation.observation.id, evidence.observation.id);
  assert.equal(evaluation.evaluation.opportunity.status, 'INDETERMINATE');
  const usage = store.execution.getUsage(VALIDATION_OWNER, monitor.campaignId, monitor.configuration.target.id, now);
  assert.equal(usage.dailySpent, 0n); assert.equal(usage.dailyHeld, 0n); assert.equal(usage.dailyAttempts, 0n);
  return {
    command, evidence, result, evaluation, summary: {
      basis: evidence.catalog.evidenceBasis, sourceReference: evidence.catalog.sourceReference,
      productId: evidence.observation.product.ref.externalId, variantId: evidence.observation.variant.ref.externalId,
      storeId: evidence.observation.product.ref.storeId, listingIdentity: refKey(evidence.observation.listing.ref), offerIdentity: refKey(evidence.observation.offer.ref), sellerIdentity: refKey(evidence.observation.offer.sellerRef),
      seller: evaluation.evaluation.seller.result, opportunity: evaluation.evaluation.opportunity.status, intent: result.simulation.intentState,
      price: evidence.observation.unitPrice.state === 'KNOWN' ? { minor: String(evidence.observation.unitPrice.value.minor), currency: evidence.observation.unitPrice.value.currency } : null,
      sku: evidence.catalog.sku, saleAvailable: evidence.catalog.saleAvailable, stock: evidence.observation.stock,
      title: evidence.observation.product.title, variantTitle: evidence.catalog.variantTitle, options: evidence.catalog.options,
      merchantEvidence: evidence.observation.seller,
      capturedAt: evidence.observation.identity.evidence.capturedAt, receivedAt: evidence.observation.identity.evidence.receivedAt,
      evaluatedAt: now, observationId: evidence.observation.id, evaluationId, historyLength: rows.length,
      shipping: evidence.observation.shipping.state, additionalTax: evidence.observation.additionalTax.state, availableQuantity: evidence.observation.availableQuantity.state,
      mapping: 'UNREVIEWED', benchmark: 'UNKNOWN', auditAction: history.audit.at(-1)?.action, zeroSimulatedSpend: true
    }
  };
}
export async function verifyReopened(store, results, now) {
  const before = store.outbox.getOutbox().length;
  for (const entry of results) {
    const duplicate = await store.coordinator.run(new AuthorizedEvidenceAdapter(entry.evidence), { ...entry.command, now });
    assert.equal(duplicate.status, 'DUPLICATE'); assert.deepEqual(duplicate.simulation, entry.result.simulation);
    assert.ok(store.evidence.getObservationHistory(entry.evidence.observation.offer.ref).some(row => row.observation.id === entry.evidence.observation.id));
  }
  assert.equal(store.outbox.getOutbox().length, before);
  const first = store.coordinator.recover(now); const second = store.coordinator.recover(now);
  assert.equal(first.failed, 0); assert.equal(second.delivered, 0);
  return { reopenPreserved: true, duplicateOperationsPreserved: true, outboxCount: before, firstDelivery: first.delivered, replayDelivery: second.delivered };
}
