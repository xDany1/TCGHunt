import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import type { TestContext } from 'node:test';
import { id, money, ref } from '@ptcg/core';
import type { Evidence, Observed, ListingObservation } from '@ptcg/core';
import type { MonitorDefinition, RunCommand, SimulatedLimitPolicy } from '@ptcg/application';
import { openDurableStore } from '@ptcg/infrastructure';
import type { DatabaseOptions } from '@ptcg/infrastructure';
import { FakeStoreAdapter } from '@ptcg/adapters';
import { fixture, NOW } from './scenarios.js';
import type { ScenarioName } from './scenarios.js';

export const OWNER = id('local-owner', 'local-test-owner');
export function limits(patch: Partial<SimulatedLimitPolicy> = {}): SimulatedLimitPolicy {
  return { ownerId: OWNER, version: 1, timezone: 'UTC', dailySpend: money(250_000n, 'MXN'), productCampaignQuantity: 2, dailyAttempts: 1, cooldownMs: 60_000, ...patch };
}
export function durableFixture(options: { name?: ScenarioName; product?: string; monitor?: string; cycle?: string; campaign?: string; operation?: string; run?: string; now?: number; } = {}) {
  const name = options.name ?? 'valid-simulated-opportunity';
  const f = fixture(name);
  const product = options.product ?? 'one';
  const now = options.now ?? NOW;
  const delta = now - NOW;
  const shift = (e: Evidence): Evidence => ({ ...e, id: `${e.id}:${product}:${now}`, captureId: `${e.captureId}:${product}:${now}`, sourceObservedAt: e.sourceObservedAt + delta, capturedAt: e.capturedAt + delta, receivedAt: e.receivedAt + delta, expiresAt: e.expiresAt + delta });
  const field = <T>(o: Observed<T>): Observed<T> => ({ ...o, evidence: shift(o.evidence) });
  const store = f.observation.offer.ref.storeId;
  const productRef = ref(store, 'product', product);
  const variantRef = ref(store, 'variant', product);
  const listingRef = ref(store, 'listing', product);
  const target = { ...f.request.target, id: id('canonical', product), identity: { ...f.request.target.identity, set: `set:${product}` } };
  const identity = { ...f.observation.variant.identity, set: target.identity.set };
  const observation: ListingObservation = {
    ...f.observation, id: id('observation', `${name}:${product}:${now}`), product: { ...f.observation.product, ref: productRef },
    variant: { ref: variantRef, productRef, identity }, listing: { ref: listingRef, productRef, variantRef },
    offer: { ...f.observation.offer, ref: ref(store, 'offer', `${name}:${product}`), listingRef, variantRef },
    identity: { state: 'KNOWN', value: identity, evidence: shift(f.observation.identity.evidence) },
    seller: field(f.observation.seller), fulfilledBy: field(f.observation.fulfilledBy), unitPrice: field(f.observation.unitPrice),
    shipping: field(f.observation.shipping), additionalTax: field(f.observation.additionalTax), stock: field(f.observation.stock),
    availableQuantity: field(f.observation.availableQuantity), purchaseLimit: field(f.observation.purchaseLimit)
  };
  const s = f.request.scenario;
  const definition: MonitorDefinition = {
    monitorId: id('monitor', options.monitor ?? 'monitor-one'), ownerId: OWNER, campaignId: options.campaign ?? 'campaign-one', cycleId: options.cycle ?? 'cycle-one',
    configuration: {
      target, mapping: { ...f.request.mapping, canonicalId: target.id, variantRef }, offerRef: observation.offer.ref,
      scenario: {
        ...s, benchmark: { ...s.benchmark, canonicalId: target.id, grossResale: field(s.benchmark.grossResale) },
        otherAcquisition: field(s.otherAcquisition), verifiedDiscount: field(s.verifiedDiscount), outbound: field(s.outbound), lossAllowance: field(s.lossAllowance), fixedFee: field(s.fixedFee)
      },
      quantity: f.request.quantity, currency: f.request.currency, sellerPolicy: f.request.sellerPolicy,
      purchasePolicy: f.request.purchasePolicy, deliveryScope: f.request.deliveryScope, mode: 'DRY_RUN'
    }
  };
  const command: RunCommand = { monitorId: definition.monitorId, revision: 1, runId: options.run ?? 'run-one', operationId: options.operation ?? 'operation-one', traceId: 'trace-one', now };
  return { definition, command, observation, adapter: new FakeStoreAdapter([observation]) };
}
export type DurableStore = ReturnType<typeof openDurableStore>;
export function harness(t: TestContext, options: DatabaseOptions = {}) {
  const base = resolve('work/m2-tests');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'case-'));
  const path = join(directory, 'local.sqlite');
  const stores: DurableStore[] = [];
  const open = (target = path, config: DatabaseOptions = {}) => { const s = openDurableStore(target, config); stores.push(s); return s; };
  const store = open(path, options);
  t.after(() => {
    for (const s of stores) s.close();
    if (!resolve(directory).startsWith(base + sep)) throw new Error('Test cleanup outside generated directory');
    rmSync(directory, { recursive: true, force: true });
  });
  const seed = (f = durableFixture(), policy = limits()) => {
    store.execution.configureLimits(policy, null, f.command.now);
    store.monitors.publishRevision(f.definition, null, f.command.now);
    return f;
  };
  return { store, path, directory, open, seed };
}
