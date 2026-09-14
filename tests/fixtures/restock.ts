import { known, money } from '@ptcg/core';
import type { ListingObservation } from '@ptcg/core';
import { restockSample, transitionRestock } from '@ptcg/application';
import type { RestockInput, RestockPolicy, RestockScope, RestockState } from '@ptcg/application';
import { AmazonObservationService, amazonRestockInput } from '@ptcg/adapters';
import { durableFixture } from './durable.js';
import { apiProvider, browserProvider, businessFixtures, htmlCapture, pContext, pReview, P_ASIN, P_NOW, P_RETAIL, P_SCOPE } from './amazon-providers.js';

export const R_NOW = P_NOW;
export function restockFixture(offset = 0, available: boolean | null = true, price: bigint | null = 9000n) {
  const now = R_NOW + offset; const f = durableFixture({ now }); const original = f.observation;
  const observation: ListingObservation = {
    ...original, stock: available === null ? { state: 'UNKNOWN', reason: 'INCOMPLETE', evidence: original.stock.evidence } : known(available ? 'IN_STOCK' : 'OUT_OF_STOCK', original.stock.evidence),
    unitPrice: price === null ? { state: 'UNKNOWN', reason: 'PRICE_MISSING', evidence: original.unitPrice.evidence } : known(money(price, 'MXN'), original.unitPrice.evidence)
  };
  const scope: RestockScope = { watchId: 'restock-test', productRef: observation.product.ref, deliveryScope: observation.offer.deliveryScope, kind: 'OFFER', offerRef: observation.offer.ref };
  const input: RestockInput = { id: `reading-${offset}`, mode: 'DRY_RUN', scope, observedAt: observation.stock.evidence.sourceObservedAt, receivedAt: now, expiresAt: now + 60_000, status: 'OBSERVED', coverage: 'EXPLICIT_OFFER', observations: [observation], provenance: { provider: 'AUTHORED', reference: `fixture-${offset}` } };
  const policy: RestockPolicy = { revision: 1, version: 'restock-policy-v1', seller: f.definition.configuration.sellerPolicy, maximumPrice: money(10000n, 'MXN'), maxAgeMs: 60_000 };
  return { ...f, observation, input, policy, now, scope };
}
export function step(previous: RestockState | null, f: ReturnType<typeof restockFixture>, input = f.input, policy = f.policy) { return transitionRestock(previous, restockSample(input, policy, f.now), input.scope, f.now); }
export async function amazonReading(kind: 'BUSINESS_API' | 'BROWSER', name: 'retail' | 'unavailable' | 'fba' | 'thirdParty' | 'noOffer' | 'parent' = 'retail', offset = 0, priorScope?: RestockScope) {
  const now = P_NOW + offset;
  const a = { ...businessFixtures[name], sourceObservedAt: now - 1000, capturedAt: now - 1000 };
  const b = htmlCapture(name === 'parent' ? 'noOffer' : name, { sourceObservedAt: now - 1000, capturedAt: now - 1000 });
  const provider = kind === 'BUSINESS_API' ? apiProvider(a) : browserProvider(b);
  const service = new AmazonObservationService({ provider: kind, marketplace: 'MX', deliveryScope: P_SCOPE }, provider, () => now, [P_RETAIL], pReview);
  const q = await service.inspect(P_ASIN, { ...pContext, now, deadlineAt: now + 1000 }); const observation = q.observations[0];
  const scope: RestockScope = priorScope ?? (observation ? { watchId: 'amazon-restock', kind: 'OFFER', productRef: observation.product.ref, offerRef: observation.offer.ref, deliveryScope: P_SCOPE } : { watchId: 'amazon-restock', kind: 'PRODUCT', productRef: q.productRef, deliveryScope: P_SCOPE });
  const input = amazonRestockInput(q.normalized, q.observations, scope, `${kind}-${name}-${offset}`, now);
  const policy: RestockPolicy = { revision: 1, version: 'amazon-restock-v1', seller: { version: 'amazon-sellers', mode: 'ALLOWLIST', allow: observation ? [{ ...observation.offer.sellerRef, externalId: P_RETAIL }] : [], deny: [], firstParty: [] }, maximumPrice: money(10000n, 'MXN'), maxAgeMs: 60_000 };
  return { input, scope, policy, service, q, now };
}
