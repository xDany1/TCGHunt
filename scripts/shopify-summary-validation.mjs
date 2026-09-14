import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { normalizeKantocardsSummary } from '@ptcg/adapters';
import { openDurableStore } from '@ptcg/infrastructure';
import { configureValidation, persistValidation, verifyReopened } from './shopify-validation-workflow.mjs';

// Offline ingestion of the user's attested live summary. It contains no product response body.
const supplied = JSON.parse(readFileSync('outputs/M3_5_USER_LIVE_EVIDENCE.json', 'utf8'));
const evidence = normalizeKantocardsSummary(supplied, 'validation-destination-unknown');
mkdirSync('work/m3.5-summary-validation', { recursive: true });
const databasePath = join(mkdtempSync(resolve('work/m3.5-summary-validation/run-')), 'validation.sqlite');
let store = openDurableStore(databasePath);
try {
  const now = Date.now();
  configureValidation(store, now);
  const result = await persistValidation(store, evidence, now);
  store.close(); store = openDurableStore(databasePath);
  const recovery = await verifyReopened(store, [result], Date.now());
  const output = {
    status: 'PARTIAL', reason: 'REPORTED_LIVE_IDS_DURABLE_WITH_OMITTED_FACTS_UNKNOWN', source: 'USER_SUPPLIED_LIVE_SMOKE_SUMMARY',
    databasePath, observation: result.summary, recovery, newNetworkRequests: 0, mutationEndpointsInvoked: 0, readyForM4: false
  };
  writeFileSync('outputs/M3_5_SUMMARY_RESULT.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
} finally { store.close(); }
