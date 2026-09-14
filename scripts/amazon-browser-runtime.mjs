import { AMAZON_BROWSER_CONTEXT, AMAZON_BROWSER_LAUNCH } from './amazon-browser-policy.mjs';

/** Executed in a page only to read selected DOM text/attributes. No HTML, script, storage or cookies returned. */
export function extractAmazonRendered() {
  const nodes = selector => [...document.querySelectorAll(selector)].slice(0, 20);
  const visible = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const clean = s => s.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 500);
  const renderedText = e => clean(e.innerText ?? e.textContent ?? '');
  const texts = selector => nodes(selector).filter(visible).map(renderedText).filter(Boolean);
  const attrs = (selector, key) => nodes(selector).map(e => e.getAttribute(key)?.trim()).filter(Boolean).map(s => s.slice(0, 500));
  const content = (document.body?.innerText ?? '').slice(0, 30000);
  const challenge = /captcha|robot check|verify you are human|introduce los caracteres|escribe los caracteres|verifica que eres humano/i.test(content) || !!document.querySelector('input[name="field-keywords"][placeholder*="characters"], input#captchacharacters');
  const accessDenied = /access denied|acceso denegado|request blocked/i.test(content);
  if (challenge || accessDenied) return { challenge, accessDenied, missingProduct: false, asins: [], titles: [], prices: [], currencies: [], availability: [], sellerIds: [], sellers: [], shippers: [], selectedAsin: false, offerRegion: false };
  const asins = attrs('input#ASIN, input[name="ASIN"]', 'value');
  const titles = texts('#productTitle, h1[itemprop="name"]');
  const offerRegion = !!document.querySelector('#desktop_buybox, #buybox, #corePriceDisplay_desktop_feature_div');
  const prices = texts('#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen, #corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen, #apex_desktop .priceToPay .a-offscreen, #priceblock_ourprice, #priceblock_dealprice');
  const currencies = attrs('meta[itemprop="priceCurrency"], meta[property="product:price:currency"], meta[property="og:price:currency"]', 'content');
  currencies.push(...attrs('#corePriceDisplay_desktop_feature_div [itemprop="priceCurrency"], #corePrice_feature_div [itemprop="priceCurrency"], #buybox [itemprop="priceCurrency"]', 'content'));
  // Visible currency must belong to the selected current-price region, not navigation or recommendations.
  const currencyTexts = texts('#corePriceDisplay_desktop_feature_div [itemprop="priceCurrency"], #corePrice_feature_div [itemprop="priceCurrency"], #buybox [itemprop="priceCurrency"], #corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price), #corePrice_feature_div .a-price:not(.a-text-price), #apex_desktop .priceToPay');
  for (const text of currencyTexts) currencies.push(...(text.match(/\b(?:MXN|USD|CAD|EUR)\b/g) ?? []));
  // Standard, page-supplied Product/Offer metadata only. Bind both ASIN and displayed price;
  // unrelated recommendations, aggregate offers and numeric JSON prices are not currency proof.
  const decimal = s => typeof s === 'string' && /^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(s) ? s.replaceAll(',', '') : null;
  const displayed = prices.map(s => decimal(s.replace(/^(?:MX\$|MXN|\$)\s*/, '').replace(/\s*MXN$/, '')));
  for (const script of nodes('script[type="application/ld+json"]')) {
    const raw = script.textContent ?? ''; if (raw.length > 100000) continue;
    try {
      const data = JSON.parse(raw); const roots = Array.isArray(data) ? data : [data];
      const products = roots.flatMap(x => x && typeof x === 'object' && Array.isArray(x['@graph']) ? x['@graph'] : [x]).slice(0, 20);
      for (const product of products) {
        if (!product || product['@type'] !== 'Product') continue;
        let urlAsin = null;
        try { const url = new URL(product.url); if (['amazon.com.mx', 'www.amazon.com.mx'].includes(url.hostname) && url.protocol === 'https:') urlAsin = /^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i.exec(url.pathname)?.[1]; } catch { /* No URL identity. */ }
        const ids = [product.sku, product.asin, urlAsin].filter(x => typeof x === 'string');
        if (!ids.length || !ids.every(id => asins.includes(id))) continue;
        const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
        for (const offer of offers.slice(0, 20)) {
          if (!offer || offer['@type'] !== 'Offer' || typeof offer.priceCurrency !== 'string') continue;
          const amount = decimal(offer.price);
          if (amount && displayed.length && displayed.every(v => v === amount)) currencies.push(offer.priceCurrency.slice(0, 500));
        }
      }
    } catch { /* Invalid metadata is not evidence. Never execute page scripts. */ }
  }
  const sellers = texts('#sellerProfileTriggerId'); const shippers = []; const sellerIds = [];
  for (const link of nodes('#sellerProfileTriggerId[href], #merchant-info a[href], #merchantInfoFeature_feature_div a[href], [data-feature-name="desktop-merchant-info"] a[href]')) {
    if (!visible(link)) continue;
    try { const url = new URL(link.getAttribute('href'), location.href); if (['amazon.com.mx', 'www.amazon.com.mx'].includes(url.hostname)) { const seller = url.searchParams.get('seller'); if (seller && /^[A-Z0-9]{1,30}$/.test(seller)) sellerIds.push(seller); } } catch { /* Ambiguous links are not seller identity. */ }
  }
  const offerTexts = []; const sellerStatements = []; const shipperStatements = [];
  for (const region of nodes('#tabular-buybox .tabular-buybox-container, #tabular-buybox .a-row, #tabular-buybox [tabular-attribute-name], #merchant-info, #merchantInfoFeature_feature_div, #fulfillerInfoFeature_feature_div, #merchantInfoFeature_feature_div .a-row, #fulfillerInfoFeature_feature_div .a-row, [data-feature-name="desktop-fulfiller-info"], [data-feature-name="desktop-merchant-info"]')) {
    if (!visible(region)) continue;
    const text = renderedText(region); if (text) offerTexts.push(text);
    const merchant = region.getAttribute('id') === 'merchantInfoFeature_feature_div' || region.getAttribute('data-feature-name') === 'desktop-merchant-info';
    const fulfiller = region.getAttribute('id') === 'fulfillerInfoFeature_feature_div' || region.getAttribute('data-feature-name') === 'desktop-fulfiller-info';
    // Current feature regions often separate the label from the value (including via aria-label).
    const values = [...(region.querySelectorAll?.('.offer-display-feature-text-message, .tabular-buybox-text') ?? [])].slice(0, 20).filter(visible).map(renderedText).filter(Boolean);
    const labels = [...(region.querySelectorAll?.('.tabular-buybox-label, .offer-display-feature-name, .offer-display-feature-label') ?? [])].slice(0, 20).filter(visible).map(renderedText);
    const attributeLabel = clean(region.getAttribute('tabular-attribute-name') || region.getAttribute('aria-label') || '');
    const roleLabels = [...new Set([attributeLabel, ...labels].filter(s => /^(?:Vendedor|Vendido por|Sold by|Remitente|Enviado por|Enviado desde|Se envía desde|Ships from|Dispatches from)\s*:?$/i.test(s)))];
    const label = roleLabels.length === 1 ? roleLabels[0] : attributeLabel;
    const soldLabel = /^(?:Vendedor|Vendido por|Sold by)(?=\s|:|$)\s*:?\s*/i;
    const shippedLabel = /^(?:Remitente|Enviado por|Enviado desde|Se envía desde|Ships from|Dispatches from)(?=\s|:|$)\s*:?\s*/i;
    const sold = soldLabel.exec(text); const shipped = shippedLabel.exec(text);
    const combined = `${text} ${attributeLabel} ${roleLabels.join(' ')}`;
    const both = /(?:Vendedor|Vendido por|Sold by)/i.test(combined) && /(?:Remitente|Enviado por|Enviado desde|Se envía desde|Ships from|Dispatches from)/i.test(combined);
    if (both || (merchant && (fulfiller || shipped || shippedLabel.test(label))) || (fulfiller && (sold || soldLabel.test(label)))) continue; // Mixed roles cannot identify a seller/shipper.
    if (merchant || sold || soldLabel.test(label)) sellers.push(...(values.length ? values : [text.replace(soldLabel, '')]).filter(Boolean));
    if (fulfiller || shipped || shippedLabel.test(label)) shippers.push(...(values.length ? values : [text.replace(shippedLabel, '')]).filter(Boolean));
    // A feature ID alone is display evidence, not an explicit seller-role assertion.
    if (sold || soldLabel.test(label)) for (const name of values.length ? values : [text.replace(soldLabel, '')]) if (name) sellerStatements.push(`${(sold?.[0] || label).trim().replace(/:$/, '')}: ${name}`.slice(0, 500));
    if (shipped || shippedLabel.test(label)) for (const name of values.length ? values : [text.replace(shippedLabel, '')]) if (name) shipperStatements.push(`${(shipped?.[0] || label).trim().replace(/:$/, '')}: ${name}`.slice(0, 500));
  }
  const actions = nodes('#desktop_buybox input[type="submit"], #desktop_buybox button, #desktop_buybox .a-button-text, #buybox input[type="submit"], #buybox .a-button-text').filter(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('.a-button-disabled, [aria-disabled="true"]')).map(e => (e.getAttribute('aria-label') || e.value || e.textContent || '').trim().replace(/\s+/g, ' ')).filter(s => /^(?:reserva ahora|reservar ahora|pre-?order now|agregar al carrito|añadir a la cesta|comprar ahora|add to cart|buy now)$/i.test(s));
  return {
    sellerStatements: [...new Set(sellerStatements)].slice(0, 20), shipperStatements: [...new Set(shipperStatements)].slice(0, 20),
    actions: [...new Set(actions)], releaseTexts: texts('#availability').filter(s => /saldrá a la venta/i.test(s)),
    challenge, accessDenied, missingProduct: /(?:no pudimos encontrar esa página|page not found|looking for something)/i.test(content) && !titles.length,
    asins, titles, prices, currencies: [...new Set(currencies)].slice(0, 20), availability: texts('#availability span, #outOfStock .a-color-price'), sellerIds: [...new Set(sellerIds)].slice(0, 20), sellers: [...new Set(sellers)].slice(0, 20), shippers: [...new Set(shippers)].slice(0, 20), offerTexts: [...new Set(offerTexts)].slice(0, 20), selectedAsin: asins.length > 0 && offerRegion, offerRegion
  };
}

/** The injected launcher is Playwright chromium in the CLI; tests supply a deterministic fake. */
export async function boundedBrowserStep(pending, timeoutMs, code, lateClose = async () => { }) {
  let timer; let expired = false;
  // Keep a diagnostic deadline even if the driver loses all event-loop handles.
  void pending.then(value => { if (expired) return lateClose(value); }).catch(() => { });
  try {
    return await Promise.race([pending, new Promise((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error(code)); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
const closeBrowserObject = value => boundedBrowserStep(value.close(), 5000, 'BROWSER_CLEANUP_TIMEOUT');
export async function withAmazonBrowser(chromium, work) {
  const browser = await boundedBrowserStep(chromium.launch(AMAZON_BROWSER_LAUNCH), 35000, 'BROWSER_LAUNCH_TIMEOUT', closeBrowserObject);
  try { return await work(browser); } finally { await closeBrowserObject(browser); }
}
export async function captureAmazonPage(browser, budget, approved, target, sequence, clock, observer = {}, profile = {}) {
  observer.stage?.('CONTEXT_CREATE');
  budget.claimRead(approved, clock.now()); const context = await boundedBrowserStep(browser.newContext(profile.contextOptions ?? AMAZON_BROWSER_CONTEXT), 15000, 'BROWSER_CONTEXT_TIMEOUT', closeBrowserObject); let redirectDenied = false; let requestDenied = false;
  observer.stage?.('CONTEXT_CREATED');
  try {
    observer.stage?.('PAGE_CREATE');
    const page = await boundedBrowserStep(context.newPage(), 15000, 'BROWSER_PAGE_TIMEOUT', closeBrowserObject);
    observer.stage?.('PAGE_CREATED'); observer.stage?.('ROUTE_REGISTER');
    await boundedBrowserStep(context.route('**/*', async route => {
      if (profile.routeRequest) { await profile.routeRequest(route, page); return; }
      const request = route.request(); const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (!budget.allowRequest(request.url(), request.method(), request.resourceType(), main, approved)) { if (main) requestDenied = true; await route.abort(); return; }
      // Never let an HTTP client automatically follow an unchecked redirect.
      try {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
        const location = response.headers()['location'];
        if (!main && location) { await route.abort(); return; }
        if (location && !budget.allowedRedirect(location, request.url(), approved)) { redirectDenied = true; await route.abort(); return; }
        const body = await response.body(); if (body.length > 5 * 1024 * 1024) { await route.abort(); return; }
        if (main) budget.registerStyles(body.toString('utf8'), request.url());
        await route.fulfill({ response, body });
      } catch { await route.abort().catch(() => { }); }
    }), 5000, 'BROWSER_ROUTE_TIMEOUT');
    observer.stage?.('ROUTE_REGISTERED');
    if (profile.configure) { observer.stage?.('RECON_CONFIGURE'); await boundedBrowserStep(profile.configure(context, page), 5000, 'RECON_CONFIGURE_TIMEOUT'); }
    if (observer.attach) {
      observer.stage?.('LISTENER_REGISTER');
      try { await observer.attach(page); observer.stage?.('LISTENERS_REGISTERED'); } catch (error) { observer.observationError?.('LISTENER_REGISTER', error); }
    }
    observer.stage?.('NAVIGATION');
    budget.navigationStarted();
    const response = await boundedBrowserStep(page.goto(approved.canonical, { waitUntil: 'domcontentloaded', timeout: 20000 }), 21000, 'PAGE_LOAD_FAILED').catch(error => { observer.navigationError?.(error); return null; });
    if (redirectDenied) throw new Error('REDIRECT_DENIED'); if (requestDenied) throw new Error('REQUEST_BUDGET_EXHAUSTED');
    if (!response) throw new Error('PAGE_LOAD_FAILED');
    // Validate final location as well as every permitted document request.
    if (!budget.allowedRedirect(page.url(), approved.canonical, approved)) throw new Error('REDIRECT_DENIED');
    observer.stage?.('NAVIGATED');
    if (observer.afterNavigation) { observer.stage?.('TIMING_OBSERVATION'); await observer.afterNavigation(page); }
    observer.stage?.('UI_CAPTURE');
    // Styles affect visibility and layout. Scripts and their XHR remain disabled/blocked.
    if (page.waitForLoadState) await page.waitForLoadState('load', { timeout: 5000 }).catch(() => { });
    const fields = await boundedBrowserStep(page.evaluate(extractAmazonRendered), 5000, 'BROWSER_EXTRACTION_TIMEOUT');
    observer.stage?.('UI_CAPTURED');
    if (observer.collect) {
      observer.stage?.('RESPONSE_COLLECTION');
      try { await observer.collect(); } catch (error) { observer.observationError?.('RESPONSE_COLLECTION', error); }
    }
    return { ...fields, target, captureId: `amazon-browser-${sequence}-${clock.now()}`, capturedAt: clock.now(), status: response.status() };
  } catch (error) { observer.failure?.(error); throw error; }
  finally { observer.stage?.('CONTEXT_CLOSE'); try { await closeBrowserObject(context); observer.stage?.('CONTEXT_CLOSED'); } finally { budget.completed(approved, clock.now()); } }
}
