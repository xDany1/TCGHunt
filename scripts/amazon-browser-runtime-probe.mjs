import { chromium } from 'playwright-core';
import { extractAmazonRendered, withAmazonBrowser, boundedBrowserStep } from './amazon-browser-runtime.mjs';
import { AMAZON_BROWSER_CONTEXT } from './amazon-browser-policy.mjs';

// No approved target needed: offline context, inline authored HTML, zero URL navigations.
let stage = 'LAUNCH'; let runtimeVersion = null;
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ status: 'BLOCKED_BY_RUNTIME', reason: 'OFFLINE_BROWSER_PROBE_TIMEOUT', stage, runtimeVersion, liveNavigations: 0 }));
  process.exit(1);
}, 40000);
try {
  const output = await withAmazonBrowser(chromium, async browser => {
    runtimeVersion = browser.version(); stage = 'NEW_CONTEXT';
    const context = await browser.newContext({ ...AMAZON_BROWSER_CONTEXT, offline: true });
    try {
      stage = 'ROUTE'; await context.route('**/*', route => route.abort()); stage = 'NEW_PAGE'; const page = await boundedBrowserStep(context.newPage(), 15000, 'BROWSER_PAGE_TIMEOUT');
      stage = 'SET_CONTENT';
      await page.setContent('<html><body><h1 id="productTitle">Authored offline runtime probe</h1><input id="ASIN" value="B0M5TEST01"><div id="desktop_buybox"><div id="availability"><span>Disponible</span></div></div></body></html>');
      stage = 'EXTRACT'; const result = await page.evaluate(extractAmazonRendered);
      if (result.titles[0] !== 'Authored offline runtime probe' || result.asins[0] !== 'B0M5TEST01') throw new Error('PROBE_EXTRACTION_FAILED');
      return { status: 'PASS', runtimeVersion: browser.version(), playwrightVersion: '1.62.1', liveNavigations: 0, offline: true, extracted: result.titles[0] };
    } finally { stage = 'CLOSE_CONTEXT'; await boundedBrowserStep(context.close(), 5000, 'BROWSER_CLEANUP_TIMEOUT'); stage = 'CLOSE_BROWSER'; }
  }); console.log(JSON.stringify(output));
} catch (e) { console.log(JSON.stringify({ status: 'BLOCKED_BY_RUNTIME', reason: String(e.message).split('\n')[0].slice(0, 200), stage, runtimeVersion, liveNavigations: 0 })); process.exitCode = 1; }
finally { clearTimeout(watchdog); }
