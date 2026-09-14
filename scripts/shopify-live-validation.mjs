import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeKantocardsCapture, AuthorizedEvidenceAdapter } from '@ptcg/adapters';
import { openDurableStore } from '@ptcg/infrastructure';
import { APPROVED_HANDLES, approvedProductUrl, KantocardsTransport, ValidationClock } from './shopify-live-transport.mjs';
import { configureValidation, persistValidation, verifyReopened } from './shopify-validation-workflow.mjs';

// Four sequential product-only reads at most. No work without both exact opt-in values.
if (process.env.SHOPIFY_LIVE_VALIDATION_ENABLED !== '1' || process.env.SHOPIFY_STORE_DOMAIN !== 'kantocards.com') {
  console.log('SKIPPED — authorized Shopify live validation not configured');
} else {
  const clock = new ValidationClock();
  const transport = new KantocardsTransport({ enabled: true, domain: 'kantocards.com', clock });
  mkdirSync('work/m3.5-live-validation', { recursive: true });
  mkdirSync('outputs', { recursive: true });
  const databasePath = join(mkdtempSync(resolve('work/m3.5-live-validation/run-')), 'validation.sqlite');
  let store = openDurableStore(databasePath);
  const results = [];
  try {
    configureValidation(store, clock.now());
    for (const handle of APPROVED_HANDLES) {
      const source = approvedProductUrl(`https://kantocards.com/collections/booster-sueltos/products/${handle}?_pos=1&_fid=validation&_ss=c`);
      let previous;
      for (const sequence of ['first', 'repeat']) {
        const capture = await transport.capture(handle);
        const evidence = normalizeKantocardsCapture(capture.body, capture.metadata, source.canonical, 'validation-destination-unknown');
        assert.equal(evidence.observation.seller.state, 'KNOWN');
        assert.equal(evidence.observation.unitPrice.state, 'KNOWN');
        assert.equal(typeof evidence.catalog.saleAvailable, 'boolean');
        if (previous) {
          for (const entity of ['product', 'variant', 'listing', 'offer']) assert.deepEqual(evidence.observation[entity].ref, previous.observation[entity].ref);
          assert.notEqual(evidence.observation.id, previous.observation.id);
        }
        const result = await persistValidation(store, evidence, clock.now(), sequence);
        assert.equal(result.summary.seller, 'APPROVED');
        result.summary.health = new AuthorizedEvidenceAdapter(evidence).health(clock.now());
        assert.equal(result.summary.health.state, 'HEALTHY');
        results.push(result); previous = evidence;
      }
    }
    assert.equal(new Set(results.map(r => r.summary.storeId)).size, 1);
    for (const key of ['productId', 'variantId', 'listingIdentity', 'offerIdentity']) assert.equal(new Set(results.map(r => r.summary[key])).size, 2);
    store.close(); store = openDurableStore(databasePath);
    const recovery = await verifyReopened(store, results, clock.now());
    const output = {
      status: 'PASS', reason: 'AUTHORIZED_LIVE_DURABLE_VALIDATION_PASSED', databasePath, products: results.map(r => r.summary), recovery,
      requests: transport.summaries(), mutationCapabilities: [], mutationEndpointsInvoked: 0
    };
    writeFileSync('outputs/M3_5_LIVE_RESULT.json', JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output));
  } catch (error) {
    const code = /^[A-Z_]{1,60}$/.test(error.code ?? '') ? error.code : 'SCHEMA_MISMATCH';
    const status = ['NETWORK_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'AUTH_REQUIRED', 'BLOCKED', 'RATE_LIMITED', 'REDIRECT_DENIED'].includes(code) ? 'BLOCKED_BY_ACCESS' : 'FAIL';
    const health = {
      capability: 'OBSERVATION', state: code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : ['BLOCKED', 'POLICY_DENIED'].includes(code) ? 'BLOCKED' : 'DEGRADED',
      reason: code, observedAt: clock.now(), lastFailureAt: clock.now(), lastSuccessAt: results.at(-1)?.summary.receivedAt ?? null
    };
    const output = { status, code, causeCode: error.causeCode ?? null, health, databasePath, products: results.map(r => r.summary), attempts: transport.attempts, requests: transport.summaries() };
    writeFileSync('outputs/M3_5_LIVE_FAILURE.json', JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output));
    process.exitCode = 1;
  } finally { store.close(); }
}
