import { assessEvidence } from './evidence.js';
import { sameRef, refKey } from './identity.js';
import type { ListingObservation, StoreRef } from './identity.js';
import { check, combine, freeze } from './value.js';
import type { Check } from './value.js';

export interface SellerPolicy {
  readonly version: string;
  readonly mode: 'ALLOWLIST' | 'DENYLIST' | 'FIRST_PARTY_ONLY' | 'MANUAL_REVIEW';
  readonly allow: readonly StoreRef<'seller'>[];
  readonly deny: readonly StoreRef<'seller'>[];
  readonly firstParty: readonly StoreRef<'seller'>[];
}
export interface SellerEvaluation {
  readonly result: 'APPROVED' | 'REJECTED' | 'REVIEW_REQUIRED';
  readonly policyVersion: string; readonly offerKey: string;
  readonly evaluatedAt: number; readonly expiresAt: number;
  readonly confidence: 'SUFFICIENT_IDENTITY_EVIDENCE' | 'INSUFFICIENT';
  readonly checks: readonly Check[];
}
export function validateSeller(o: ListingObservation, policy: SellerPolicy, now: number): SellerEvaluation {
  if (!policy.version || !['ALLOWLIST', 'DENYLIST', 'FIRST_PARTY_ONLY', 'MANUAL_REVIEW'].includes(policy.mode)) throw new RangeError('Invalid seller policy');
  const evidenceCheck = assessEvidence(o.seller, now);
  const denied = policy.deny.some(r => sameRef(r, o.offer.sellerRef)) || (o.seller.state === 'KNOWN' && policy.deny.some(r => o.seller.state === 'KNOWN' && sameRef(r, o.seller.value.ref)));
  const checks: Check[] = [check('SELLER_DENYLIST', denied ? 'FAIL' : 'PASS'), evidenceCheck];
  if (o.seller.state === 'KNOWN') {
    const sellerRef = o.seller.value.ref;
    checks.push(check('SELLER_IDENTITY', sameRef(sellerRef, o.offer.sellerRef) ? 'PASS' : 'INDETERMINATE', { seller: refKey(sellerRef) }, [o.seller.evidence.id]));
    const approved = policy.mode === 'DENYLIST'
      || (policy.mode === 'ALLOWLIST' && policy.allow.some(r => sameRef(r, sellerRef)))
      || (policy.mode === 'FIRST_PARTY_ONLY' && policy.firstParty.some(r => sameRef(r, sellerRef)));
    checks.push(check('SELLER_POLICY', approved ? 'PASS' : 'INDETERMINATE', { mode: policy.mode }));
  }
  const status = combine(checks);
  return freeze({
    result: status === 'FAIL' ? 'REJECTED' : status === 'PASS' ? 'APPROVED' : 'REVIEW_REQUIRED',
    policyVersion: policy.version, offerKey: refKey(o.offer.ref), evaluatedAt: now,
    expiresAt: Math.min(o.seller.evidence.expiresAt, o.seller.evidence.sourceObservedAt + 60_001),
    confidence: status === 'PASS' ? 'SUFFICIENT_IDENTITY_EVIDENCE' : 'INSUFFICIENT', checks
  });
}
