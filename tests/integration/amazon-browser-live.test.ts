import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { AmazonBrowserProvider } from '@ptcg/adapters';
import type { AmazonProviderResult, AmazonRenderedCapture } from '@ptcg/adapters';
import type { DurableStore } from '@ptcg/infrastructure';
import { harness } from '../fixtures/durable.js';
import { rendered } from '../fixtures/amazon-rendered.js';
import { P_NOW, pContext, pTarget } from '../fixtures/amazon-providers.js';

interface Target { asin: string; canonical: string; }
interface Config { targets: readonly Target[]; readsPerProduct: number; minimumIntervalMs: number; }
interface Budget {
  claimRead(target: Target, now: number): void; completed(target: Target, now: number): void;
  allowRequest(url: string, method: string, resourceType: string, main: boolean, target: Target): boolean;
  allowedRedirect(location: string, from: string, target: Target): boolean;
  summary(): { readAttempts: number; navigations: number; blockedRequests: number; documentRequests: Record<string, number>; };
}
const policy = await import(pathToFileURL(resolve('scripts/amazon-browser-policy.mjs')).href) as {
  amazonBrowserConfig(env: Record<string, string>, urls: readonly string[]): Config;
  approvedAmazonUrl(url: string): Target; AmazonNavigationBudget: new (config: Config) => Budget;
  AMAZON_BROWSER_CONTEXT: object; AMAZON_BROWSER_LAUNCH: object;
};
const runtime = await import(pathToFileURL(resolve('scripts/amazon-browser-runtime.mjs')).href) as {
  withAmazonBrowser(launcher: object, work: (browser: object) => Promise<unknown>): Promise<unknown>;
  captureAmazonPage(browser: object, budget: Budget, approved: Target, target: object, sequence: number, clock: object): Promise<AmazonRenderedCapture>;
  boundedBrowserStep(pending: Promise<unknown>, timeoutMs: number, code: string, lateClose?: (value: unknown) => Promise<void>): Promise<unknown>;
};
interface Entry { summary: { persisted: boolean; intent?: string; sellerEvaluation?: string; opportunity: string; restockEvents: readonly string[]; restockOutcome: string; offerIdentity?: string; }; }
const workflow = await import(pathToFileURL(resolve('scripts/amazon-browser-workflow.mjs')).href) as {
  AMAZON_VALIDATION_SCOPE: string; configureAmazonValidation(store: DurableStore, now: number): void;
  persistAmazonBrowserResult(store: DurableStore, result: AmazonProviderResult, now: number, sequence: number): Promise<Entry>;
  recordAmazonFailure(store: DurableStore, target: object, category: string, now: number, sequence: number): void;
  verifyAmazonReopen(store: DurableStore, entries: readonly Entry[], now: number): Promise<{ reopened: boolean; replayIdempotent: boolean; }>;
};
const url = pTarget.url;
const config = () => policy.amazonBrowserConfig({ AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: '1' }, [url]);
const approved = policy.approvedAmazonUrl(url);
test('live CLI is disabled by default with zero navigations', () => {
  const child = spawnSync(process.execPath, ['scripts/amazon-browser-live-validation.mjs'], { env: { ...process.env, AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: '' }, encoding: 'utf8' });
  assert.equal(child.status, 1); assert.deepEqual(JSON.parse(child.stdout), { status: 'NOT_EXECUTED', reason: 'NETWORK_DISABLED', liveNavigations: 0 });
});
test('opt-in requires 1–2 distinct explicitly approved products', () => {
  for (const value of ['', 'true', '0']) assert.throws(() => policy.amazonBrowserConfig({ AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: value }, [url]), /NETWORK_DISABLED/);
  for (const urls of [[], [url, url], [url, url, url]]) assert.throws(() => policy.amazonBrowserConfig({ AMAZON_BROWSER_LIVE_VALIDATION_ENABLED: '1' }, urls));
  assert.equal(config().readsPerProduct, 2); assert.equal(config().minimumIntervalMs, 45000);
});
for (const invalid of ['https://amazon.com/dp/B0M5TEST01', 'https://m.amazon.com.mx/dp/B0M5TEST01', 'https://amazon.com.mx.evil.test/dp/B0M5TEST01', 'http://amazon.com.mx/dp/B0M5TEST01', 'https://amazon.com.mx/cart', 'https://amazon.com.mx/ap/signin', 'https://user:pass@amazon.com.mx/dp/B0M5TEST01', 'https://amazon.com.mx:444/dp/B0M5TEST01']) test(`strict approved host and path reject ${invalid}`, () => {
  assert.throws(() => policy.approvedAmazonUrl(invalid), /TARGET_INVALID/);
});
test('request budget blocks mutation, assets, frames and third read; interval counts from completion', () => {
  const b = new policy.AmazonNavigationBudget(config()); b.claimRead(approved, 0); b.completed(approved, 100);
  assert.throws(() => b.claimRead(approved, 45099), /MINIMUM_INTERVAL/); b.claimRead(approved, 45100);
  assert.throws(() => b.claimRead(approved, 999999), /REQUEST_BUDGET_EXHAUSTED/);
  assert.equal(b.allowRequest(url, 'POST', 'document', true, approved), false);
  assert.equal(b.allowRequest(url, 'GET', 'script', true, approved), false);
  assert.equal(b.allowRequest(url, 'GET', 'document', false, approved), false);
  for (let i = 0; i < 3; i++) assert.equal(b.allowRequest(url, 'GET', 'document', true, approved), true);
  assert.equal(b.allowRequest(url, 'GET', 'document', true, approved), false); assert.equal(b.summary().readAttempts, 2); assert.equal(b.summary().navigations, 0);
});
test('redirects cannot change host, product, seller or reach account/mutation routes', () => {
  const b = new policy.AmazonNavigationBudget(config());
  for (const target of ['https://example.com/', '/cart', '/ap/signin', '/dp/B0M5WRONG1', `${url}?seller=OTHER`]) assert.equal(b.allowedRedirect(target, url, approved), false);
  assert.equal(b.allowedRedirect(`${url}?ref_=tracking`, url, approved), true);
});
test('browser ownership closes launched process even when work throws; launch uses sandbox and no profile', async () => {
  let closed = 0; let opts: unknown;
  const browser = { async close() { closed++; } };
  await assert.rejects(runtime.withAmazonBrowser({ async launch(options: unknown) { opts = options; return browser; } }, async () => { throw new Error('authored failure'); }), /authored failure/);
  assert.equal(closed, 1); assert.deepEqual(opts, { channel: 'msedge', headless: true, chromiumSandbox: true });
  assert.deepEqual(policy.AMAZON_BROWSER_CONTEXT, { javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: false });
});

function fakeBrowser(redirect?: string, failEvaluation = false) {
  let closed = 0; let aborted = 0; let fetches = 0; let fulfillments = 0; let fetchOptions: unknown; let contextOptions: unknown;
  let handler: (route: object) => Promise<void> = async () => { throw new Error('route not installed'); };
  const frame = {};
  const response = { headers: () => redirect ? { location: redirect } : {}, body: async () => Buffer.from('authored'), status: () => 200 };
  const route = {
    request: () => ({ url: () => url, method: () => 'GET', resourceType: () => 'document', isNavigationRequest: () => true, frame: () => frame }),
    async fetch(options: unknown) { fetches++; fetchOptions = options; return response; }, async abort() { aborted++; }, async fulfill() { fulfillments++; }
  };
  const page = { mainFrame: () => frame, url: () => url, async goto() { await handler(route); return response; }, async evaluate() { if (failEvaluation) throw new Error('authored extraction failure'); return rendered(); } };
  const context = { async newPage() { return page; }, async route(_pattern: string, callback: typeof handler) { handler = callback; }, async close() { closed++; } };
  const browser = { async newContext(options: unknown) { contextOptions = options; return context; } };
  return { browser, summary: () => ({ closed, aborted, fetches, fulfillments, fetchOptions, contextOptions }) };
}
test('capture uses ephemeral context, one read and no unchecked redirect follow', async () => {
  const fake = fakeBrowser(); const b = new policy.AmazonNavigationBudget(config());
  await runtime.captureAmazonPage(fake.browser, b, approved, pTarget, 0, { now: () => P_NOW });
  assert.deepEqual(fake.summary(), { closed: 1, aborted: 0, fetches: 1, fulfillments: 1, fetchOptions: { maxRedirects: 0, maxRetries: 0, timeout: 15000 }, contextOptions: policy.AMAZON_BROWSER_CONTEXT });
});
test('cross-host redirect is aborted before browser can follow and context closes', async () => {
  const fake = fakeBrowser('https://example.com/');
  await assert.rejects(runtime.captureAmazonPage(fake.browser, new policy.AmazonNavigationBudget(config()), approved, pTarget, 0, { now: () => P_NOW }), /REDIRECT_DENIED/);
  assert.equal(fake.summary().closed, 1); assert.equal(fake.summary().fetches, 1); assert.equal(fake.summary().fulfillments, 0); assert.equal(fake.summary().aborted, 1);
});
test('context closes on extraction failure', async () => {
  const fake = fakeBrowser(undefined, true);
  await assert.rejects(runtime.captureAmazonPage(fake.browser, new policy.AmazonNavigationBudget(config()), approved, pTarget, 0, { now: () => P_NOW }), /authored extraction failure/);
  assert.equal(fake.summary().closed, 1);
});
test('driver operation deadline returns a typed failure and closes a late resource', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let complete: (value: object) => void = () => { }; let closed = 0;
  const pending = new Promise<object>(resolve => { complete = resolve; });
  const result = runtime.boundedBrowserStep(pending, 15000, 'BROWSER_PAGE_TIMEOUT', async () => { closed++; });
  const rejected = assert.rejects(result, /BROWSER_PAGE_TIMEOUT/); t.mock.timers.tick(15000); await rejected;
  complete({}); await Promise.resolve(); await Promise.resolve(); assert.equal(closed, 1);
});
test('a successful browser operation closes its owner and propagates cleanup failure', async () => {
  let worked = false;
  await assert.rejects(runtime.withAmazonBrowser({ async launch() { return { async close() { throw new Error('authored cleanup failure'); } }; } }, async () => { worked = true; return 'observed'; }), /authored cleanup failure/);
  assert.equal(worked, true);
});
async function resultAt(at: number, patch: Partial<AmazonRenderedCapture> = {}) {
  const target = { ...pTarget, deliveryScope: workflow.AMAZON_VALIDATION_SCOPE };
  const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', async readRendered() { return rendered({ target, captureId: `authored-live-equivalent-${at}`, capturedAt: at, ...patch }); } });
  return provider.read(target, { ...pContext, deliveryScope: target.deliveryScope, now: at - 1, deadlineAt: at + 1000 });
}
test('authored live-equivalent observations persist stable identities, baseline/repeat and blocked DRY_RUN across reopen', async t => {
  const h = harness(t); workflow.configureAmazonValidation(h.store, P_NOW); const entries: Entry[] = [];
  for (const [i, at] of [P_NOW + 1, P_NOW + 45002].entries()) {
    const entry = await workflow.persistAmazonBrowserResult(h.store, await resultAt(at), at + 1, i); entries.push(entry);
    assert.equal(entry.summary.persisted, true); assert.equal(entry.summary.intent, 'BLOCKED'); assert.equal(entry.summary.sellerEvaluation, 'REVIEW_REQUIRED');
    assert.equal(entry.summary.opportunity, 'INDETERMINATE'); assert.deepEqual(entry.summary.restockEvents, []);
    assert.equal(entry.summary.restockOutcome, i === 0 ? 'INITIALIZED' : 'UNCHANGED');
  }
  assert.equal(entries[0]?.summary.offerIdentity, entries[1]?.summary.offerIdentity);
  const sql = new DatabaseSync(h.path);
  try {
    for (const table of ['store_instances', 'store_products', 'variants', 'listings', 'offers']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 1, table);
    // Seller and Amazon fulfiller have distinct references, both stable across captures.
    assert.equal(sql.prepare('SELECT count(*) AS n FROM sellers').get()?.['n'], 2);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM listing_observations').get()?.['n'], 2);
    for (const table of ['checkout_attempts', 'simulated_reservations', 'simulated_consumption']) assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'], 0);
  } finally { sql.close(); }
  h.store.close(); assert.deepEqual(await workflow.verifyAmazonReopen(h.open(), entries, P_NOW + 46000), { reopened: true, replayIdempotent: true });
});
test('missing seller and challenge create no opportunity or false stock event', async t => {
  const h = harness(t); workflow.configureAmazonValidation(h.store, P_NOW);
  const entry = await workflow.persistAmazonBrowserResult(h.store, await resultAt(P_NOW + 1, { sellerIds: [] }), P_NOW + 2, 0);
  assert.equal(entry.summary.persisted, false); assert.equal(entry.summary.opportunity, 'NOT_EVALUATED'); assert.deepEqual(entry.summary.restockEvents, []);
  workflow.recordAmazonFailure(h.store, pTarget, 'CHALLENGE_DETECTED', P_NOW + 10, 1);
  const sql = new DatabaseSync(h.path); try { assert.equal(sql.prepare('SELECT count(*) AS n FROM purchase_intents').get()?.['n'], 0); } finally { sql.close(); }
});
test('live implementation exposes no personal profile, account, mutation or evasion actions', () => {
  const source = ['runtime', 'policy', 'live-validation'].map(name => readFileSync(`scripts/amazon-browser-${name}.mjs`, 'utf8')).join('\n');
  assert.doesNotMatch(source, /launchPersistentContext|connectOverCDP|addCookies|storageState|userDataDir|\.click\(|\.fill\(|\.press\(|\.submit\(|stealth|AutomationControlled|2captcha|anticaptcha|placeOrder|proxy\s*:/i);
  assert.doesNotMatch(source, /add-to-cart|buy-now|checkout|payment/i);
});
