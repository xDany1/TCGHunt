import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeKantocardsSummary } from '@ptcg/adapters';
import type { AuthorizedEvidence } from '@ptcg/adapters';
import type { DurableStore } from '@ptcg/infrastructure';
import { harness } from '../fixtures/durable.js';
import { authoredCapture, DELIVERY, liveSummary, START } from '../fixtures/kantocards.js';

// Exercise the exact local developer composition used by both opt-in and offline commands.
const workflow = await import(pathToFileURL(resolve('scripts/shopify-validation-workflow.mjs')).href) as {
  configureValidation(store: DurableStore, now: number): void;
  persistValidation(store: DurableStore, evidence: AuthorizedEvidence, now: number, sequence?: string): Promise<{ summary: { seller: string; opportunity: string; intent: string; }; }>;
  verifyReopened(store: DurableStore, results: readonly unknown[], now: number): Promise<{ outboxCount: number; firstDelivery: number; replayDelivery: number; }>;
};
test('actual reported IDs persist through M2, unknown seller/opportunity block admission, reopen and outbox replay are idempotent', async t => {
  const h = harness(t); const e = normalizeKantocardsSummary(liveSummary, DELIVERY); const now = START + 90000;
  workflow.configureValidation(h.store, now); const result = await workflow.persistValidation(h.store, e, now);
  assert.equal(result.summary.seller, 'REVIEW_REQUIRED'); assert.equal(result.summary.opportunity, 'INDETERMINATE'); assert.equal(result.summary.intent, 'BLOCKED');
  const sql = new DatabaseSync(h.path);
  try {
    for (const table of ['store_instances', 'store_products', 'variants', 'listings', 'offers', 'sellers', 'listing_observations', 'purchase_intents']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1);
    for (const table of ['checkout_attempts', 'simulated_reservations', 'simulated_consumption']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0);
    const price = sql.prepare('SELECT price_state, price_minor, price_currency FROM listing_observations').get();
    assert.equal(price?.['price_state'], 'UNKNOWN'); assert.equal(price?.['price_minor'], null); assert.equal(price?.['price_currency'], null);
  } finally { sql.close(); }
  assert.equal(h.store.evidence.getStoreMetadata(e.catalog.store.id)?.currency, null);
  h.store.close(); const reopened = h.open();
  assert.deepEqual(reopened.evidence.getObservationHistory(e.observation.offer.ref)[0], e);
  const recovery = await workflow.verifyReopened(reopened, [result], now + 100);
  assert.equal(recovery.outboxCount, 1); assert.equal(recovery.firstDelivery, 1); assert.equal(recovery.replayDelivery, 0);
});
test('authored full-capture composition checks two products, repeated observations, seller approval and durable blocked decisions', async t => {
  const h = harness(t); workflow.configureValidation(h.store, START); const results = [];
  for (const second of [false, true]) {
    for (const [i, sequence] of ['first', 'repeat'].entries()) {
      const at = START + (second ? 10000 : 0) + i * 5000;
      const e = authoredCapture(second, at, i ? { price: { amount: '99.99', currencyCode: 'MXN' } } : {}).normalized();
      const r = await workflow.persistValidation(h.store, e, at + 222, sequence);
      assert.equal(r.summary.seller, 'APPROVED'); assert.equal(r.summary.intent, 'BLOCKED'); results.push(r);
    }
  }
  const sql = new DatabaseSync(h.path);
  try {
    for (const table of ['store_instances', 'sellers']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1);
    for (const table of ['store_products', 'variants', 'listings', 'offers', 'purchase_intents']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 2);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM listing_observations').get()?.['n'], 4);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM decision_evaluations').get()?.['n'], 4);
  } finally { sql.close(); }
  h.store.close(); const recovery = await workflow.verifyReopened(h.open(), results, START + 20000);
  assert.equal(recovery.outboxCount, 2); assert.equal(recovery.firstDelivery, 2); assert.equal(recovery.replayDelivery, 0);
});
test('opt-in command skips by default without creating requests or requiring credentials', () => {
  const child = spawnSync(process.execPath, ['scripts/shopify-live-validation.mjs'], { env: { ...process.env, SHOPIFY_LIVE_VALIDATION_ENABLED: '', SHOPIFY_STORE_DOMAIN: '' }, encoding: 'utf8' });
  assert.equal(child.status, 0); assert.match(child.stdout, /^SKIPPED/); assert.equal(child.stderr, '');
});
