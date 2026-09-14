import { createHash } from 'node:crypto';
import { freeze } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import type { ReadContext } from '@ptcg/application';

export type AmazonProviderKind = 'BUSINESS_API' | 'BROWSER';
export interface AmazonProviderConfig {
  readonly provider: AmazonProviderKind; readonly marketplace: 'MX'; readonly networkEnabled?: false;
  /** An explicitly shared quote context; provider choice alone never establishes equivalence. */
  readonly deliveryScope: string;
}
export interface AmazonTarget { readonly asin: string; readonly url: string; readonly marketplace: 'MX'; readonly deliveryScope: string; }
export type AmazonResultCategory = 'OBSERVED' | 'CONTENT_INCOMPLETE' | 'PAGE_UNAVAILABLE' | 'CHALLENGE_DETECTED' | 'ACCESS_DENIED' | 'PARSER_MISMATCH' | 'NETWORK_ERROR' | 'AUTH_REQUIRED' | 'THROTTLED' | 'TIMEOUT';
export interface AmazonSource {
  readonly provider: AmazonProviderKind; readonly fixtureId: string; readonly capturedAt: number;
  readonly sourceObservedAt: number; readonly parserVersion: string; readonly confidence: 'AUTHORED_FIXTURE' | 'LIVE_CAPTURE';
}
export interface AmazonMoneyEvidence { readonly amount: string; readonly currency: string; }
export interface AmazonOfferEvidence {
  readonly externalOfferId: string | null; readonly sellerId: string | null; readonly sellerDisplayName: string | null;
  readonly fulfillment: 'AMAZON' | 'MERCHANT' | 'UNKNOWN'; readonly condition: string | null; readonly subCondition: string | null;
  readonly price: AmazonMoneyEvidence | null; readonly shipping: AmazonMoneyEvidence | null;
  readonly availability: string | null; readonly featured: boolean | null; readonly buttonPresent: boolean | null;
}
export interface AmazonProviderEvidence {
  /** Rendered facts retained for diagnostics and an auditable, narrow Retail identity rule. */
  readonly renderedEvidence?: {
    readonly priceTexts: readonly string[]; readonly currencyCodes: readonly string[];
    readonly sellerDisplays: readonly string[]; readonly shipperDisplays: readonly string[];
    readonly sellerStatements: readonly string[]; readonly shipperStatements: readonly string[];
    readonly externalSellerIds: readonly string[];
    readonly sellerIdentityBasis: 'EXTERNAL_SELLER_ID' | 'EXPLICIT_AMAZON_RETAIL_MX_SELLER' | 'UNKNOWN';
  };
  readonly productState?: {
    readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
    readonly purchaseMode: 'IMMEDIATE' | 'PREORDER' | 'UNKNOWN';
    readonly releaseDate: string | null;
    readonly rawAvailability: readonly string[]; readonly rawActions: readonly string[]; readonly rawRelease: readonly string[];
  };
  readonly marketplace: 'MX'; readonly asin: string; readonly title: string | null; readonly productUrl: string;
  readonly asinType: 'STANDARD' | 'VARIATION_PARENT' | 'VARIATION_CHILD' | 'UNKNOWN'; readonly childAsins: readonly string[];
  readonly selectedAsin?: boolean;
  readonly offers: readonly AmazonOfferEvidence[]; readonly coverage: 'OBSERVED_SUBSET' | 'NO_OFFERS_IN_RESPONSE' | 'UNKNOWN';
  readonly source: AmazonSource;
}
export type AmazonProviderResult = { readonly category: 'OBSERVED' | 'CONTENT_INCOMPLETE'; readonly evidence: AmazonProviderEvidence; }
  | { readonly category: Exclude<AmazonResultCategory, 'OBSERVED' | 'CONTENT_INCOMPLETE'>; };
export interface AmazonProvider {
  readonly kind: AmazonProviderKind; readonly mode: 'FIXTURE_ONLY' | 'AUTHORIZED_VALIDATION';
  read(target: AmazonTarget, context: ReadContext): Promise<AmazonProviderResult>;
}
export interface AmazonCapture {
  readonly fixtureId: string; readonly target: AmazonTarget; readonly capturedAt: number; readonly sourceObservedAt: number;
  readonly failure?: 'TIMEOUT' | 'NETWORK';
}
export interface AmazonProviderDiagnostic {
  readonly provider: AmazonProviderKind; readonly asin: string; readonly startedAt: number; readonly endedAt: number;
  readonly result: AmazonResultCategory; readonly offerCount: number; readonly completeness: 'COMPLETE_FIELDS' | 'INCOMPLETE';
  readonly challengeDetected: boolean; readonly parseFailure: boolean; readonly authRequired: boolean; readonly timeout: boolean;
  readonly errorClass: string | null;
}
export const AMAZON_PROVIDER_VERSION = 'amazon-providers-m5.2-v1';
/** Local marketplace-scoped identity, not a claimed Amazon merchant/API identifier. */
export const AMAZON_RETAIL_MX_SELLER = 'amazon-retail-mx';
export function amazonDigest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadFailure('SCHEMA_MISMATCH');
  return value as Record<string, unknown>;
}
export function optionalRecord(value: unknown): Record<string, unknown> { return value == null ? {} : record(value); }
export function label(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
}
export function identifier(value: unknown): string | null { const s = label(value); return s && /^[a-zA-Z0-9:_-]{1,100}$/.test(s) ? s : null; }
export function captureFailure(c: AmazonCapture, target: AmazonTarget, context: ReadContext): AmazonProviderResult | null {
  if (context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
  if (context.deadlineAt <= context.now || c.failure === 'TIMEOUT') return { category: 'TIMEOUT' };
  if (c.failure === 'NETWORK') return { category: 'NETWORK_ERROR' };
  if (c.target.asin !== target.asin || c.target.url !== target.url || c.target.marketplace !== target.marketplace || c.target.deliveryScope !== target.deliveryScope || context.currency !== 'MXN' || context.deliveryScope !== target.deliveryScope ||
    ![c.sourceObservedAt, c.capturedAt, context.now, context.deadlineAt].every(t => Number.isSafeInteger(t) && t >= 0) || c.sourceObservedAt > c.capturedAt || c.capturedAt > context.now || !identifier(c.fixtureId)) throw new ReadFailure('CONTEXT_MISMATCH');
  return null;
}
export function source(c: AmazonCapture, provider: AmazonProviderKind): AmazonSource {
  return freeze({ provider, fixtureId: c.fixtureId, capturedAt: c.capturedAt, sourceObservedAt: c.sourceObservedAt, parserVersion: `${AMAZON_PROVIDER_VERSION}:${provider}`, confidence: 'AUTHORED_FIXTURE' });
}
export function fulfillment(value: unknown): AmazonOfferEvidence['fulfillment'] {
  return value === 'AMAZON_FULFILLMENT' ? 'AMAZON' : value === 'MERCHANT_FULFILLMENT' ? 'MERCHANT' : 'UNKNOWN';
}
