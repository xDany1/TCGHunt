import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { rendered } from '../fixtures/amazon-rendered.js';
import { P_NOW } from '../fixtures/amazon-providers.js';

interface Diag { startupStage: string; failureStage: string | null; browserLaunched: boolean; contextCreated: boolean; pageCreated: boolean; listenersRegistered: boolean; targetLoopStarted: boolean; navigationAttempted: boolean; navigated: boolean; contextClosed: boolean; error: { message: string; code: string | null; } | null; navigationError: { message: string; } | null; observationErrors: unknown[]; }
interface Result { status: string; diagnostics: Diag; observations: { asin: string; status: string; topLevelNavigationCount: number; reason?: string; diagnostics?: Diag; }[]; mode: string; purchaseIntentsCreated: number; directPrivateCalls: number; replayCount: number; }
const runtime = await import(pathToFileURL(resolve('scripts/amazon-passive-runtime.mjs')).href) as {
  passiveConfig(env: object): { targets: { asin: string; canonical: string; }[]; };
  capturePassivePage(browser: object, target: object, clock: object): Promise<{ stop: string | null; topLevelNavigationCount: number; diagnostics: Diag; captureStatus: string; responses: unknown[]; }>;
  safeDiagnosticError(error: Error): { message: string; };
};
const runner = await import(pathToFileURL(resolve('scripts/amazon-passive-recon.mjs')).href) as { runPassiveRecon(config: object, chromium: object, clock: object): Promise<Result>; };
const config = runtime.passiveConfig({ AMAZON_PASSIVE_RECON_ENABLED: '1' }); const target = config.targets[0]; assert.ok(target);
const clock = { now: () => P_NOW + 1, wait: async () => { } };
interface RequestRoute { request(): object; abort(): Promise<void>; continue(): Promise<void>; fetch(options: object): Promise<object>; fulfill(options: object): Promise<void>; }
function mock(stage = '') {
  let handler: ((route: RequestRoute) => Promise<void>) | undefined; let listener: ((response: object) => void) | undefined;
  let currentUrl = target?.canonical ?? ''; let navigations = 0; let bodyReads = 0; let browserCloses = 0; let contextCloses = 0; const contexts: object[] = []; const order: string[] = []; let routed = 0;
  const fail = (where: string) => { if (where === stage) throw new Error(`${where}_FAILED`); };
  const frame = {};
  const page = {
    addInitScript: async () => { },
    mainFrame: () => frame, url: () => currentUrl,
    on: (_event: string, callback: (response: object) => void) => { order.push('listener'); fail('LISTENER'); listener = callback; },
    async goto(url: string) {
      order.push('goto'); navigations++; currentUrl = url; fail('NAVIGATION');
      let aborted = false;
      await handler?.({
        request: () => ({ url: () => url, method: () => 'GET', resourceType: () => 'document', isNavigationRequest: () => true, frame: () => frame }), abort: async () => { aborted = true; },
        continue: async () => { routed++; }, fetch: async () => { throw new Error('Recon must continue the browser request, never fetch it'); }, fulfill: async () => { }
      });
      assert.equal(aborted, false, 'passive filtering must not abort the approved document');
      // Observed stylesheet/unknown response has no candidate body API; listener must ignore it.
      listener?.({ request: () => ({ resourceType: () => 'stylesheet' }), body: async () => { bodyReads++; throw new Error('must not inspect'); } });
      return { status: () => 200 };
    },
    async evaluate(fn: { name: string; }) { if (fn.name === 'readPassiveTiming') return { ui: [], structured: [] }; fail('EXTRACTION'); return rendered({ asins: [currentUrl.split('/').at(-1) ?? ''], actions: [], titles: stage === 'PARSE' ? ['x'.repeat(501)] : ['Authored product'] }); },
    waitForLoadState: async () => { }, close: async () => { }
  };
  const browser = {
    version: () => 'mock-runtime', async newContext(options: object) {
      order.push('context'); contexts.push(options); fail('CONTEXT'); return {
        routeWebSocket: async () => { },
        async newPage() { order.push('page'); fail('PAGE'); return page; },
        async route(_pattern: string, callback: (route: RequestRoute) => Promise<void>) { order.push('route'); fail('ROUTE'); handler = callback; },
        async close() { contextCloses++; fail('CONTEXT_CLOSE'); }
      };
    }, async close() { browserCloses++; fail('BROWSER_CLOSE'); }
  };
  return { browser, chromium: { async launch() { fail('LAUNCH'); return browser; } }, contexts, order, counts: () => ({ navigations, bodyReads, browserCloses, contextCloses, routed }) };
}
test('repaired recon uses proven context, creates page before listeners and does not filter the top-level document', async () => {
  const h = mock(); const r = await runtime.capturePassivePage(h.browser, target, clock);
  assert.equal(r.topLevelNavigationCount, 1); assert.equal(r.captureStatus, 'NAVIGATED'); assert.equal(h.counts().routed, 1); assert.equal(h.counts().bodyReads, 0);
  assert.deepEqual(h.order, ['context', 'page', 'route', 'listener', 'goto']); assert.deepEqual(h.contexts[0], { javaScriptEnabled: true, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: false });
  assert.equal(r.diagnostics.contextClosed, true); assert.equal(r.diagnostics.listenersRegistered, true);
});
test('listener registration failure does not prevent page creation or navigation', async () => {
  const h = mock('LISTENER'); const r = await runtime.capturePassivePage(h.browser, target, clock);
  assert.equal(h.counts().navigations, 1); assert.equal(r.diagnostics.pageCreated, true); assert.equal(r.diagnostics.navigationAttempted, true); assert.equal(r.diagnostics.observationErrors.length, 1); assert.equal(r.captureStatus, 'CAPTURE_INCOMPLETE');
});
for (const [stage, expected, nav] of [['CONTEXT', 'CONTEXT_CREATE', 0], ['PAGE', 'PAGE_CREATE', 0], ['ROUTE', 'ROUTE_REGISTER', 0], ['NAVIGATION', 'NAVIGATION', 1], ['EXTRACTION', 'UI_CAPTURE', 1], ['CONTEXT_CLOSE', 'CONTEXT_CLOSE', 1], ['PARSE', 'PROVIDER_PARSE', 1]] as const) test(`failure ${stage} preserves active target, stage and navigation count`, async () => {
  const h = mock(stage); const r = await runner.runPassiveRecon(config, h.chromium, clock); const first = r.observations[0]; assert.ok(first?.diagnostics);
  assert.equal(first.status, stage === 'NAVIGATION' ? 'NAVIGATION_FAILED' : 'CAPTURE_INCOMPLETE'); assert.equal(first.diagnostics.failureStage, expected); assert.equal(first.topLevelNavigationCount, nav);
  assert.equal(first.diagnostics.targetLoopStarted, true); assert.ok(first.diagnostics.error); assert.equal(r.observations[1]?.status, 'NOT_ATTEMPTED'); assert.equal(h.counts().browserCloses, 1);
  if (stage === 'NAVIGATION') assert.equal(first.diagnostics.navigationError?.message, 'NAVIGATION_FAILED');
  if (stage === 'PARSE') assert.equal(first.diagnostics.error?.code, 'BODY_TOO_LARGE');
});
test('healthy mocked recon attempts exactly one navigation for all three approved targets', async () => {
  const h = mock(); const r = await runner.runPassiveRecon(config, h.chromium, clock);
  assert.equal(r.status, 'RECON_CAPTURE_COMPLETE', JSON.stringify(r)); assert.deepEqual(r.observations.map(o => o.asin), config.targets.map(t => t.asin)); assert.deepEqual(r.observations.map(o => o.status), ['PASS', 'PASS', 'PASS']);
  assert.equal(h.counts().navigations, 3); assert.equal(h.counts().contextCloses, 3); assert.equal(r.mode, 'DRY_RUN'); for (const count of [r.purchaseIntentsCreated, r.directPrivateCalls, r.replayCount]) assert.equal(count, 0);
});
test('browser launch failure is distinguished from target failures', async () => {
  const h = mock('LAUNCH'); const r = await runner.runPassiveRecon(config, h.chromium, clock); assert.equal(r.status, 'STARTUP_FAILED'); assert.equal(r.diagnostics.startupStage, 'BROWSER_LAUNCH'); assert.equal(r.diagnostics.browserLaunched, false); assert.ok(r.observations.every(o => o.status === 'NOT_ATTEMPTED'));
});
test('browser cleanup exception cannot erase completed captures and navigation counts', async () => {
  const h = mock('BROWSER_CLOSE'); const r = await runner.runPassiveRecon(config, h.chromium, clock); assert.equal(r.status, 'CAPTURE_INCOMPLETE'); assert.equal(r.diagnostics.startupStage, 'BROWSER_CLOSE'); assert.equal(r.observations.reduce((sum, o) => sum + o.topLevelNavigationCount, 0), 3); assert.ok(r.observations.every(o => o.status === 'PASS'));
});
test('bounded error diagnostics redact URLs, paths, credential material and stack traces', () => {
  const r = runtime.safeDiagnosticError(new Error('page.goto https://example.test/path?token=secret token=abc user@example.test C:\\Users\\Personal\\file\nstack'));
  for (const secret of ['secret', 'abc', 'user@example.test', 'Personal', '\n']) assert.equal(r.message.includes(secret), false); assert.ok(r.message.length <= 240);
});
test('JS recon preserves shared capture path and has no direct navigation or request fetch', () => {
  const source = readFileSync('scripts/amazon-passive-runtime.mjs', 'utf8');
  assert.match(source, /captureAmazonPage\(/); assert.doesNotMatch(source, /\.goto\(|\.route\(|\.fetch\(/); assert.match(source, /route\.continue\(\)/);
});
