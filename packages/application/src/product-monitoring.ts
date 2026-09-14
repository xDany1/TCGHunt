import { money } from '@ptcg/core';
import type { ProductMonitorConfiguration, RunCommand } from './durable-contracts.js';
import type { RestockInput, RestockPolicy, RestockDecision, RestockScope } from './restock.js';

/** Product monitoring has no acquisition authority and requires no seller-specific Offer. */
export function productMonitorScope(monitorId: string, c: ProductMonitorConfiguration): RestockScope {
  return { kind: 'PRODUCT', watchId: monitorId, productRef: c.productRef, deliveryScope: c.deliveryScope };
}
export const PRODUCT_MONITOR_POLICY: RestockPolicy = {
  revision: 1, version: 'product-monitor-v1', maxAgeMs: 60000, maximumPrice: money(0n, 'MXN'),
  seller: { version: 'monitoring-no-approved-sellers', mode: 'MANUAL_REVIEW', allow: [], deny: [], firstParty: [] }
};
export interface ProductMonitoringRepository {
  /** Sample, baseline, transitions/outbox and run completion commit together. */
  complete(command: RunCommand, input: RestockInput, now: number): RestockDecision;
}
