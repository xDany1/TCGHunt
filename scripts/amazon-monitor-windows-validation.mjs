import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DesktopService } from '@ptcg/desktop/service';
import { AMAZON_ASINS } from '@ptcg/desktop/policy';
import { createAmazonMonitorReader } from './amazon-monitor-transport.mjs';

// Dedicated, one-shot invocation. Never starts the desktop scheduler timer or a user database.
if (process.env.AMAZON_BROWSER_MONITORING_ENABLED !== '1' || process.platform !== 'win32') {
  console.log(JSON.stringify({ status: 'NOT_EXECUTED', reason: 'WINDOWS_EXPLICIT_OPT_IN_REQUIRED', navigations: 0 })); process.exitCode = 1;
} else {
  mkdirSync('work/m5.5-windows', { recursive: true }); mkdirSync('outputs', { recursive: true });
  const directory = mkdtempSync(resolve('work/m5.5-windows/run-')); const databasePath = join(directory, 'monitoring.sqlite');
  const reader = createAmazonMonitorReader({ enabled: true });
  const contextDiagnostics = [];
  const options = { databasePath, now: () => Date.now(), newId: randomUUID, networkEnabled: false, amazonNetworkEnabled: true, fixtureMode: false, read: async () => { throw new Error('SHOPIFY_NOT_AUTHORIZED'); }, readAmazon: reader.read, cancelRead: reader.cancel, contextDiagnostic: d => { if (contextDiagnostics.length < 3) contextDiagnostics.push(d); } };
  let service = new DesktopService(options); let stopped = false; const observations = []; let result;
  try {
    service.start(); const settings = service.snapshot().settings;
    await service.dispatch('updateSafeSettings', { expectedVersion: settings.version, refreshSeconds: 5, storeEnabled: true });
    for (const [index, asin] of AMAZON_ASINS.entries()) {
      if (index === 2) await new Promise(resolveWait => setTimeout(resolveWait, 60000));
      const created = await service.dispatch('createMonitor', { name: `Bounded M5.5 ${asin}`, url: `https://www.amazon.com.mx/dp/${asin}`, cadenceSeconds: index === 1 ? 60 : 86400 });
      if (index === 1) {
        await new Promise(resolveWait => setTimeout(resolveWait, 60000));
        await service.tick(); // Exactly one due-tick invocation, never an interval.
      } else await service.dispatch('runMonitorNow', { id: created.id });
      const row = service.snapshot().monitors.find(m => m.id === created.id); assert.ok(row);
      observations.push(row);
      await service.dispatch('pauseMonitor', { id: row.id, expectedVersion: row.version });
      await service.tick(); // All created monitors are paused; must make no read.
      await service.dispatch('resumeMonitor', { id: row.id, expectedVersion: row.version + 1 });
      await service.dispatch('pauseMonitor', { id: row.id, expectedVersion: row.version + 2 });
      if (!row.product || row.lastResult !== 'PRODUCT_OBSERVED') break;
      assert.equal(row.product.events.length, 0); assert.equal(row.product.opportunity, 'BLOCKED / INDETERMINATE');
    }
    const before = service.snapshot(); await service.stop(); stopped = true;
    service = new DesktopService(options); stopped = false; service.start();
    const reopened = service.snapshot(); assert.deepEqual(reopened.monitors.map(m => m.product), before.monitors.map(m => m.product));
    assert.ok(reopened.monitors.every(m => m.status === 'PAUSED')); const count = reader.summary().length; await service.tick(); assert.equal(reader.summary().length, count);
    await service.stop(); stopped = true;
    const db = new DatabaseSync(databasePath, { readOnly: true });
    let rows;
    try {
      rows = Object.fromEntries(['store_products', 'offers', 'sellers', 'purchase_intents', 'checkout_attempts', 'restock_samples', 'restock_events', 'restock_outbox', 'monitor_audit'].map(table => [table, Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)]));
      for (const table of ['offers', 'sellers', 'purchase_intents', 'checkout_attempts', 'restock_events']) assert.equal(rows[table], 0);
    } finally { db.close(); }
    assert.ok(reader.summary().length <= 3); assert.ok(reader.summary().every(s => s.navigations <= 1));
    result = { status: observations.length === 3 && observations.every(o => o.product && o.lastResult === 'PRODUCT_OBSERVED') ? 'BOUNDED_WINDOWS_LIFECYCLE_VALIDATED' : 'PARTIAL', reopened: true, pauseResume: true, rows };
  } catch (error) { result = { status: 'PARTIAL', reason: error && typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'WINDOWS_VALIDATION_FAILED' }; process.exitCode = 1; }
  finally { if (!stopped) await service.stop(); }
  const output = { ...result, databasePath, observations, contextDiagnostics, requests: reader.summary(), mode: 'DRY_RUN', directPrivateCalls: 0, replayCount: 0, mutationCount: 0, purchaseIntentsCreated: 0 };
  writeFileSync(join(directory, 'result.json'), JSON.stringify(output, null, 2)); writeFileSync('outputs/M5_5_WINDOWS_RESULT.json', JSON.stringify(output, null, 2)); console.log(JSON.stringify(output, null, 2));
  if (result.status !== 'BOUNDED_WINDOWS_LIFECYCLE_VALIDATED') process.exitCode = 1;
}
