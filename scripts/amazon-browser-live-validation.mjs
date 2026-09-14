import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AmazonBrowserProvider, AMAZON_RENDERED_VERSION } from '@ptcg/adapters';
import { openDurableStore } from '@ptcg/infrastructure';
import { amazonBrowserConfig, AmazonNavigationBudget } from './amazon-browser-policy.mjs';
import { captureAmazonPage, withAmazonBrowser } from './amazon-browser-runtime.mjs';
import { AMAZON_VALIDATION_SCOPE, configureAmazonValidation, persistAmazonBrowserResult, recordAmazonFailure, verifyAmazonReopen, amazonValidationStatus } from './amazon-browser-workflow.mjs';

const safeErrors = ['NETWORK_DISABLED', 'APPROVED_URLS_REQUIRED', 'TARGET_INVALID', 'REDIRECT_DENIED', 'REQUEST_BUDGET_EXHAUSTED', 'PAGE_LOAD_FAILED', 'MINIMUM_INTERVAL', 'BROWSER_LAUNCH_TIMEOUT', 'BROWSER_CONTEXT_TIMEOUT', 'BROWSER_PAGE_TIMEOUT', 'BROWSER_ROUTE_TIMEOUT', 'BROWSER_EXTRACTION_TIMEOUT', 'BROWSER_CLEANUP_TIMEOUT'];
let config;
try { config = amazonBrowserConfig(process.env, process.argv.slice(2)); } catch (e) { console.log(JSON.stringify({ status: 'NOT_EXECUTED', reason: safeErrors.includes(e.message) ? e.message : 'CONFIGURATION_INVALID', liveNavigations: 0 })); process.exitCode = 1; }
if (config) {
  const clock = { now: () => Date.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
  const budget = new AmazonNavigationBudget(config); const observations = []; const entries = [];
  mkdirSync('work/m5.4-live', { recursive: true }); mkdirSync('outputs', { recursive: true });
  const directory = mkdtempSync(resolve('work/m5.4-live/run-')); const database = join(directory, 'validation.sqlite'); let store = openDurableStore(database); let runtimeVersion = null; let result;
  try {
    configureAmazonValidation(store, clock.now()); const { chromium } = await import('playwright-core');
    await withAmazonBrowser(chromium, async browser => {
      runtimeVersion = browser.version();
      for (const approved of config.targets) {
        for (let sequence = 0; sequence < config.readsPerProduct; sequence++) {
          if (sequence) await clock.wait(config.minimumIntervalMs);
          const target = { asin: approved.asin, url: approved.canonical, marketplace: 'MX', deliveryScope: AMAZON_VALIDATION_SCOPE }; const start = clock.now();
          let capture;
          const provider = new AmazonBrowserProvider({
            mode: 'AUTHORIZED_VALIDATION', async readRendered() {
              capture = await captureAmazonPage(browser, budget, approved, target, `${approved.asin}-${sequence}`, clock); return capture;
            }
          });
          let read;
          try { read = await provider.read(target, { now: start, deadlineAt: start + 60000, currency: 'MXN', deliveryScope: AMAZON_VALIDATION_SCOPE, operationId: `m5.4-${sequence}`, traceId: 'm5.4' }); }
          catch (e) {
            const reason = safeErrors.includes(e.message) ? e.message : 'OBSERVATION_FAILED';
            recordAmazonFailure(store, target, reason, clock.now(), sequence);
            observations.push({ asin: target.asin, targetHost: 'www.amazon.com.mx', status: reason.startsWith('BROWSER_') ? 'BLOCKED_BY_RUNTIME' : 'NETWORK_ERROR', reason, persisted: false, durationMs: clock.now() - start }); return;
          }
          const diagnostic = {
            targetHost: 'www.amazon.com.mx', parserVersion: AMAZON_RENDERED_VERSION, category: read.category, durationMs: clock.now() - start,
            // Only the bounded public text/attribute projection; never HTML, headers or browser storage.
            extraction: capture
          };
          if (!('evidence' in read)) {
            recordAmazonFailure(store, target, read.category, clock.now(), sequence);
            observations.push({ ...diagnostic, asin: target.asin, status: read.category, challengeDetected: read.category === 'CHALLENGE_DETECTED', persisted: false }); return;
          }
          const entry = await persistAmazonBrowserResult(store, read, clock.now(), sequence); entries.push(entry); observations.push({ ...diagnostic, ...entry.summary, challengeDetected: false });
          if (!entry.summary.persisted) return;
        }
      }
    });
    store.close(); store = openDurableStore(database); const recovery = await verifyAmazonReopen(store, entries, clock.now());
    result = { status: amazonValidationStatus(observations, config.targets.length * config.readsPerProduct), recovery };
  } catch (e) { result = { status: !runtimeVersion || (safeErrors.includes(e.message) && e.message.startsWith('BROWSER_')) ? 'BLOCKED_BY_RUNTIME' : 'PARTIAL', reason: safeErrors.includes(e.message) ? e.message : runtimeVersion ? 'VALIDATION_FAILED' : 'PLAYWRIGHT_LAUNCH_FAILED' }; }
  finally { store.close(); }
  const output = { ...result, provider: 'BROWSER', targets: config.targets, playwrightVersion: '1.62.1', runtimeVersion, database, requestSummary: budget.summary(), observations, mutationCount: 0, mode: 'DRY_RUN' };
  const json = JSON.stringify(output, null, 2); writeFileSync(join(directory, 'result.json'), json); writeFileSync(config.targets.length === 3 ? 'outputs/M5_4_CORRECTION_LIVE_RESULT.json' : 'outputs/M5_4_LIVE_RESULT.json', json); console.log(json); if (output.status !== 'PASS') process.exitCode = 1;
}
