import { freeze } from '@ptcg/core';
import type { Id } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';

export const SHOPIFY_VERSION = 'm3-shopify-1';
export const SHOPIFY_API_VERSION = '2026-07';
export interface ShopifyFixtureConfig {
  readonly storeId: Id<'store'>; readonly canonicalDomain: string; readonly region: string | null;
  readonly accessPolicyRef: string; readonly mode: 'FIXTURE_ONLY'; readonly minimumIntervalMs: number;
  readonly maxAttempts: number; readonly merchant: { readonly id: string; readonly name: string; } | null;
}
export function validateConfig(config: ShopifyFixtureConfig): ShopifyFixtureConfig {
  if (config.mode !== 'FIXTURE_ONLY') throw new ReadFailure('NETWORK_DISABLED');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.invalid$/.test(config.canonicalDomain)
    || !/^[a-zA-Z0-9:_-]{1,100}$/.test(config.storeId) || !/^[a-zA-Z0-9:_-]{1,100}$/.test(config.accessPolicyRef)
    || (config.merchant !== null && (!/^[a-zA-Z0-9_-]{1,100}$/.test(config.merchant.id) || config.merchant.name.length > 200))
    || !Number.isSafeInteger(config.minimumIntervalMs) || config.minimumIntervalMs < 100 || config.minimumIntervalMs > 86_400_000
    || !Number.isSafeInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 3) throw new ReadFailure('POLICY_DENIED');
  return freeze(config);
}
