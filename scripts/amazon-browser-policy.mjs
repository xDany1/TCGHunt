import { amazonUrl } from '@ptcg/adapters';

export const AMAZON_BROWSER_HOSTS = Object.freeze(['amazon.com.mx', 'www.amazon.com.mx']);
export const AMAZON_BROWSER_INTERVAL_MS = 45_000;
export const AMAZON_BROWSER_LAUNCH = Object.freeze({ channel: 'msedge', headless: true, chromiumSandbox: true });
export const AMAZON_BROWSER_CONTEXT = Object.freeze({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: false });
export function approvedAmazonUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('TARGET_INVALID'); }
  if (url.protocol !== 'https:' || !AMAZON_BROWSER_HOSTS.includes(url.hostname) || url.username || url.password || url.port) throw new Error('TARGET_INVALID');
  try { return amazonUrl(value); } catch { throw new Error('TARGET_INVALID'); }
}
export function amazonBrowserConfig(env, urls) {
  if (env.AMAZON_BROWSER_LIVE_VALIDATION_ENABLED !== '1') throw new Error('NETWORK_DISABLED');
  if (urls.length < 1 || urls.length > 3) throw new Error('APPROVED_URLS_REQUIRED');
  const targets = urls.map(approvedAmazonUrl);
  if (new Set(targets.map(t => t.asin)).size !== targets.length) throw new Error('TARGET_INVALID');
  return Object.freeze({ targets: Object.freeze(targets.map(Object.freeze)), readsPerProduct: targets.length === 3 ? 1 : 2, minimumIntervalMs: AMAZON_BROWSER_INTERVAL_MS });
}
export class AmazonNavigationBudget {
  constructor(config) { this.config = config; this.requests = new Map(); this.reads = new Map(); this.lastCompleted = new Map(); this.blockedRequests = 0; this.navigations = 0; this.styles = new Set(); this.styleRequests = new Map(); this.blockedTypes = {}; }
  registerStyles(html, from) {
    this.styles.clear();
    for (const link of html.match(/<link\b[^>]*>/gi) ?? []) {
      if (!/rel\s*=\s*["']stylesheet["']/i.test(link)) continue;
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(link)?.[1]; if (!href) continue;
      try {
        const u = new URL(href.replaceAll('&amp;', '&'), from);
        const permitted = AMAZON_BROWSER_HOSTS.includes(u.hostname) || (u.hostname === 'm.media-amazon.com' && /^\/images\/(?:I|S)\//.test(u.pathname));
        if (permitted && u.protocol === 'https:' && !u.username && !u.password && !u.port && /\.css$/i.test(u.pathname) && this.styles.size < 8) this.styles.add(u.href);
      } catch { /* No additional host authority from malformed page links. */ }
    }
  }
  claimRead(target, now) {
    if (!this.config.targets.some(t => t.canonical === target.canonical) || (this.reads.get(target.asin) ?? 0) >= 2) throw new Error('REQUEST_BUDGET_EXHAUSTED');
    if (now - (this.lastCompleted.get(target.asin) ?? -Infinity) < this.config.minimumIntervalMs) throw new Error('MINIMUM_INTERVAL');
    this.reads.set(target.asin, (this.reads.get(target.asin) ?? 0) + 1);
  }
  allowRequest(url, method, resourceType, mainFrame, target) {
    if (method === 'GET' && resourceType === 'stylesheet' && this.styles.has(url) && this.config.targets.some(t => t.asin === target.asin)) {
      const count = this.styleRequests.get(target.asin) ?? 0;
      if (count < 8) { this.styleRequests.set(target.asin, count + 1); return true; }
    }
    this.blockedTypes[resourceType] = (this.blockedTypes[resourceType] ?? 0) + (resourceType === 'document' ? 0 : 1);
    let parsed; try { parsed = approvedAmazonUrl(url); } catch { this.blockedRequests++; return false; }
    if (method !== 'GET' || resourceType !== 'document' || !mainFrame || parsed.asin !== target.asin || !this.config.targets.some(t => t.asin === parsed.asin)) { this.blockedRequests++; return false; }
    const count = this.requests.get(parsed.asin) ?? 0;
    if (count >= (this.config.targets.length === 3 ? 2 : 3)) { this.blockedRequests++; return false; } this.requests.set(parsed.asin, count + 1); return true;
  }
  allowedRedirect(location, from, target) {
    try { return approvedAmazonUrl(new URL(location, from).href).asin === target.asin; } catch { return false; }
  }
  completed(target, now) { this.lastCompleted.set(target.asin, now); }
  navigationStarted() { this.navigations++; }
  summary() { return { readAttempts: [...this.reads.values()].reduce((a, b) => a + b, 0), navigations: this.navigations, documentRequests: Object.fromEntries(this.requests), stylesheetRequests: Object.fromEntries(this.styleRequests), blockedRequests: this.blockedRequests, blockedTypes: this.blockedTypes }; }
}
