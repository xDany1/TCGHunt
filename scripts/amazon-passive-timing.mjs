/** Installed before navigation. Reads DOM/data only; bounded polling, no page interactions. */
export function installPassiveTiming({ asin, intervalMs, windowMs }) {
  const output = { ui: [], structured: [], stopped: null, intervalMs, windowMs };
  Object.defineProperty(globalThis, '__astraPassiveTiming', { value: output, configurable: true });
  const at = () => Math.round(performance.timeOrigin + performance.now());
  const visible = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const values = selector => [...document.querySelectorAll(selector)].slice(0, 20).filter(visible).map(e => (e.innerText ?? e.textContent ?? e.value ?? '').trim().replace(/\s+/g, ' ').slice(0, 500));
  const state = value => /^(?:AVAILABLE|IN_STOCK|InStock|https?:\/\/schema.org\/InStock)$/.test(value) ? 'AVAILABLE' : /^(?:UNAVAILABLE|OUT_OF_STOCK|OutOfStock|https?:\/\/schema.org\/OutOfStock)$/.test(value) ? 'UNAVAILABLE' : null;
  let ticks = 0; let timer;
  function sample() {
    if (++ticks > Math.ceil(windowMs / intervalMs) + 1) { clearInterval(timer); return; }
    const body = (document.body?.innerText ?? '').slice(0, 30000);
    if (/captcha|robot check|access denied|acceso denegado|verify you are human|verifica que eres humano/i.test(body)) { output.stopped = 'CHALLENGE_OR_ACCESS_DENIED'; clearInterval(timer); return; }
    const ids = [...document.querySelectorAll('input#ASIN, input[name="ASIN"]')].slice(0, 20).map(e => e.value);
    const bound = ids.length > 0 && ids.every(id => id === asin);
    const availability = values('#availability span, #outOfStock .a-color-price').filter(s => /^(?:Disponible|Disponible para envío inmediato|En stock|In stock|No disponible|No disponible por el momento|Actualmente no disponible|Currently unavailable|Temporalmente agotado)\.?$/i.test(s));
    const actions = [...document.querySelectorAll('#desktop_buybox input[type="submit"], #desktop_buybox button, #desktop_buybox .a-button-text, #buybox input[type="submit"], #buybox .a-button-text')].slice(0, 20).filter(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('.a-button-disabled, [aria-disabled="true"]')).map(e => (e.getAttribute('aria-label') || e.value || e.textContent || '').trim().replace(/\s+/g, ' ')).filter(s => /^(?:Reserva ahora|Reservar ahora|Pre-?order now|Agregar al carrito|Añadir a la cesta|Comprar ahora|Add to cart|Buy now)$/i.test(s));
    if (output.ui.length < 18) output.ui.push({ observedAt: at(), boundToAsin: bound, availability: bound ? availability : [], actions: bound ? actions : [] });
    // Only inert JSON data and standard microdata. Never evaluate executable script text.
    let visits = 0; let bytes = 0;
    function walk(v, source, inherited = false, depth = 0) {
      if (++visits > 1000 || depth > 8 || !v || typeof v !== 'object' || output.structured.length >= 40) return;
      if (Array.isArray(v)) { for (const item of v.slice(0, 30)) walk(item, source, false, depth + 1); return; }
      const explicitIds = [v.asin, v.productId, v.sku].filter(x => typeof x === 'string');
      const own = explicitIds.length > 0 && explicitIds.every(x => x === asin);
      const scoped = own || inherited && explicitIds.length === 0;
      const s = state(v.availability) ?? (typeof v.inStock === 'boolean' ? v.inStock ? 'AVAILABLE' : 'UNAVAILABLE' : null);
      if (scoped && s && !output.structured.some(x => x.source === source && x.availabilityEvidence === s)) output.structured.push({ source, asin, availabilityEvidence: s, observedAt: at(), confidence: 'MEDIUM_DIAGNOSTIC_ONLY' });
      for (const [k, child] of Object.entries(v).slice(0, 60)) {
        if (/cookie|auth|session|customer|user|account|address|token|signature|secret/i.test(k)) continue;
        if (k === 'offers' && own && v['@type'] === 'Product') {
          for (const offer of (Array.isArray(child) ? child : [child]).slice(0, 20)) if (offer?.['@type'] === 'Offer') walk(offer, source, true, depth + 1);
        } else walk(child, source, false, depth + 1);
      }
    }
    for (const e of [...document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]')].slice(0, 20)) {
      const raw = e.textContent ?? ''; bytes += raw.length; if (raw.length > 65536 || bytes > 131072) continue;
      try { walk(JSON.parse(raw), e.getAttribute('type') === 'application/ld+json' ? 'JSON_LD' : 'INERT_EMBEDDED_JSON'); } catch { /* Unsupported data remains unknown. */ }
    }
    for (const product of [...document.querySelectorAll('[itemscope][itemtype$="/Product"]')].slice(0, 10)) {
      const id = product.querySelector('[itemprop="sku"], [itemprop="productID"]');
      if ((id?.getAttribute('content') || id?.textContent || '').trim() !== asin) continue;
      for (const e of [...product.querySelectorAll('[itemprop="availability"]')].slice(0, 20)) {
        const s = state(e.getAttribute('href') || e.getAttribute('content') || e.textContent || '');
        if (s && !output.structured.some(x => x.source === 'MICRODATA' && x.availabilityEvidence === s)) output.structured.push({ source: 'MICRODATA', asin, availabilityEvidence: s, observedAt: at(), confidence: 'MEDIUM_DIAGNOSTIC_ONLY' });
      }
    }
  }
  timer = setInterval(sample, intervalMs); sample(); setTimeout(() => clearInterval(timer), windowMs);
}
export function readPassiveTiming() { return globalThis.__astraPassiveTiming ?? null; }

/** Page JavaScript is untrusted: retain only the bounded diagnostic vocabulary and current-run times. */
export function sanitizePassiveTiming(raw, asin, from, to) {
  if (!raw || !Array.isArray(raw.ui) || !Array.isArray(raw.structured)) throw new Error('TIMING_INSTRUMENTATION_MISSING');
  const validTime = n => Number.isSafeInteger(n) && n >= from - 1000 && n <= to + 1000;
  const safeStock = s => typeof s === 'string' && /^(?:Disponible|Disponible para envío inmediato|En stock|In stock|No disponible|No disponible por el momento|Actualmente no disponible|Currently unavailable|Temporalmente agotado)\.?$/i.test(s);
  const safeAction = s => typeof s === 'string' && /^(?:Reserva ahora|Reservar ahora|Pre-?order now|Agregar al carrito|Añadir a la cesta|Comprar ahora|Add to cart|Buy now)$/i.test(s);
  return {
    stopped: raw.stopped === 'CHALLENGE_OR_ACCESS_DENIED' ? raw.stopped : null,
    ui: raw.ui.slice(0, 18).filter(s => s && validTime(s.observedAt)).map(s => ({ observedAt: s.observedAt, boundToAsin: s.boundToAsin === true, availability: s.boundToAsin === true && Array.isArray(s.availability) ? s.availability.filter(safeStock).slice(0, 20) : [], actions: s.boundToAsin === true && Array.isArray(s.actions) ? s.actions.filter(safeAction).slice(0, 20) : [] })),
    structured: raw.structured.slice(0, 40).filter(s => s && s.asin === asin && validTime(s.observedAt) && ['JSON_LD', 'INERT_EMBEDDED_JSON', 'MICRODATA'].includes(s.source) && ['AVAILABLE', 'UNAVAILABLE'].includes(s.availabilityEvidence)).map(s => ({ source: s.source, asin, observedAt: s.observedAt, availabilityEvidence: s.availabilityEvidence, confidence: 'MEDIUM_DIAGNOSTIC_ONLY' }))
  };
}

/** Ordering is sampled evidence availability, not causality or a production freshness rule. */
export function comparePassiveTiming({ responses, structured, uiSamples, conflict = false }) {
  const known = x => ['AVAILABLE', 'UNAVAILABLE'].includes(x.availabilityEvidence ?? x.availability) || x.actionVisible === true && x.boundToAsin === true;
  const first = list => list.filter(known).map(x => x.evidenceAt ?? x.observedAt).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const network = responses.filter(r => ['xhr', 'fetch'].includes(r.resourceType) && r.inspected && r.asinRelationship === 'EXPLICIT_SAME_OBJECT');
  const n = first(network); const s = first(structured); const u = first(uiSamples);
  const times = [['PASSIVE_NETWORK', n], ['STRUCTURED_PAGE', s], ['RENDERED_UI', u]].filter(([, t]) => t !== null).sort((a, b) => a[1] - b[1]);
  const tied = times.length > 1 && times[0][1] === times[1][1];
  return { firstPrivateAvailabilityAt: n, firstStructuredAvailabilityAt: s, firstUiAvailabilityAt: u, networkAvailabilityEvidenceAt: n, structuredAvailabilityEvidenceAt: s, uiAvailabilityFirstObservedAt: u, earliestAvailabilitySource: conflict ? 'CONFLICT' : tied ? 'TIED_SAMPLES' : times[0]?.[0] ?? 'UNKNOWN', observedLeadMs: !conflict && n !== null && u !== null ? u - n : null, availabilityBeforeVisibleUi: conflict ? 'CONFLICT' : n !== null && u !== null ? n < u ? 'OBSERVED_BEFORE_UI_SAMPLE' : 'NOT_BEFORE_UI_SAMPLE' : 'NOT_ESTABLISHED', timingLimitation: '500 ms bounded UI/structured sampling; network time is body availability after read. Observed ordering only, not causality or exact first paint. Missing samples/clock skew may limit comparison.' };
}
