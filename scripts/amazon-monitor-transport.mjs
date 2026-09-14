import { AmazonBrowserProvider } from '@ptcg/adapters';
import { ReadFailure } from '@ptcg/application';
import { resolveMonitorSource, AMAZON_ASINS, AMAZON_DELIVERY } from '@ptcg/desktop/policy';
import { AmazonNavigationBudget, approvedAmazonUrl } from './amazon-browser-policy.mjs';
import { withAmazonBrowser, captureAmazonPage, boundedBrowserStep } from './amazon-browser-runtime.mjs';

/** Ordinary M5.4 page path only. No passive listener/profile or private evidence. */
export function createAmazonMonitorReader({ enabled, clock = { now: () => Date.now() }, launcher }) {
  let active = null; let busy = false; let cancelled = false; let sequence = 0; const summaries = [];
  return {
    cancel() { cancelled = true; if (active) void boundedBrowserStep(active.close(), 5000, 'CANCELLED').catch(() => { }); },
    summary() { return summaries.slice(); },
    async read(url) {
      if (!enabled) throw Object.assign(new Error('NETWORK_DISABLED'), { code: 'POLICY_DENIED' });
      const source = resolveMonitorSource(url); if (source.family !== 'Amazon') throw Object.assign(new Error('TARGET_INVALID'), { code: 'CONTEXT_MISMATCH' });
      if (busy || sequence >= 6) throw Object.assign(new Error('BOUNDED_READ_LIMIT'), { code: 'POLICY_DENIED' });
      busy = true; cancelled = false; sequence++;
      const approved = approvedAmazonUrl(source.canonical);
      const config = { targets: AMAZON_ASINS.map(a => approvedAmazonUrl(`https://www.amazon.com.mx/dp/${a}`)), readsPerProduct: 1, minimumIntervalMs: 60000 };
      const budget = new AmazonNavigationBudget(config); const startedAt = clock.now();
      const target = { asin: source.asin, url: source.canonical, marketplace: 'MX', deliveryScope: AMAZON_DELIVERY };
      let contextDiagnostic = null;
      try {
        const chromium = launcher ?? (await import('playwright-core')).chromium;
        return await withAmazonBrowser(chromium, async browser => {
          active = browser;
          if (cancelled) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
          const provider = new AmazonBrowserProvider({ mode: 'AUTHORIZED_VALIDATION', readRendered: () => captureAmazonPage(browser, budget, approved, target, `m5-5-${sequence}`, clock) });
          const result = await provider.read(target, { now: clock.now(), deadlineAt: clock.now() + 90000, currency: 'MXN', deliveryScope: AMAZON_DELIVERY, operationId: `monitor-${sequence}`, traceId: 'desktop-monitor' });
          if (cancelled) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
          return result;
        });
      } catch (error) {
        // This projection is constructed by the provider's context validator, never from page payloads.
        contextDiagnostic = error instanceof ReadFailure ? error.contextDiagnostic ?? null : null; throw error;
      } finally { summaries.push({ asin: target.asin, startedAt, completedAt: clock.now(), contextDiagnostic, ...budget.summary() }); active = null; busy = false; }
    }
  };
}
