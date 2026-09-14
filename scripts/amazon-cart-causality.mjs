import { createHash } from 'node:crypto';
import { authorityDiagnostics } from './amazon-cart-research-evidence.mjs';
import { boundedBrowserStep } from './amazon-browser-runtime.mjs';

/** Diagnostic vocabulary only; never used by routing. */
export function publicLocation(raw, productUrl) {
  const authority = authorityDiagnostics(raw, productUrl);
  let pathPattern = 'REDACTED';
  try {
    const u = new URL(raw);
    const words = new Set(['cart', 'add-to-cart', 'gp', 'dp', 'html', 'api', '1', '2', 'events', 'event', 'metrics', 'beacon', 'csm', 'csa', 'batch', 'collect', 'log', 'telemetry', 'uedata', 'uedata.json', 'com.amazon.csm.csa.prod']);
    if (authority.withinExpectedDomainBoundary) pathPattern = '/' + u.pathname.split('/').filter(Boolean).slice(0, 10).map(s => words.has(s) ? s : ':redacted').join('/');
  } catch { /* Unknown location. */ }
  return { ...authority, pathPattern };
}

/** Runs in the page or on a retained ElementHandle. Returns only fixed-vocabulary projections. */
export function inspectCartControls(input, handleConfig) {
  const pinned = handleConfig ? input : null; const config = handleConfig ?? input;
  const primary = [...document.querySelectorAll('[id="add-to-cart-button"]')];
  const label = raw => /^(?:agregar al carrito|añadir a la cesta|add to cart)$/i.test((raw ?? '').trim()) ? 'ADD_TO_CART' : /^(?:reserva ahora|reservar ahora|pre-?order now)$/i.test((raw ?? '').trim()) ? 'RESERVE_PREORDER' : 'REDACTED_OR_OTHER';
  const names = new Set(['ASIN', 'asin', 'ASIN.1', 'quantity', 'quantity.1', 'offerListingID', 'offeringID.1', 'merchantID', 'submit.add-to-cart', 'csrfToken', 'session-id']);
  const safeName = n => names.has(n) ? n : 'REDACTED_NAME';
  // Serialized page inspector cannot import the router. Differential tests bind these
  // pure canonical semantics to its unchanged opaque and legacy ref predicates.
  const canonicalCartPath = pathname => {
    const pattern = path => '/' + path.split('/').slice(1, 8).map(s => ['cart', 'add-to-cart'].includes(s.toLowerCase()) ? s.toLowerCase() : s.startsWith('ref=') ? 'ref=:redacted' : s ? ':redacted' : '').join('/');
    let path = pathname; let decodePasses = 0;
    const rawPathPattern = pattern(pathname);
    try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(path); if (next === path) break; path = next; decodePasses++; } }
    catch { return { rawPathPattern, canonicalPathPattern: 'INVALID_ENCODING', qualified: false, reason: 'INVALID_PATH_ENCODING', matcher: 'NONE', decodePasses }; }
    const opaque = /^\/cart\/add-to-cart\/[A-Za-z0-9._~-]{1,200}\/?$/.test(path);
    // Only this single-segment subset of the existing cartAction legacy family.
    const legacyRef = /^\/cart\/add-to-cart\/ref=[^/]+\/?$/i.test(path);
    const forbidden = /checkout|\/buy(?:\/|$)|buy[\W_]*now|one[\W_]*click|place[\W_]*order|submit[\W_]*order|payment|purchase|gift[\W_]*card|\/orders?(?:\/|$)|signin|signout|login|logout|account|address|captcha|\/ap\//i.test(path);
    const suffix = path.replace(/^\/cart\/add-to-cart\//i, '').replace(/\/$/, '');
    const reason = opaque || legacyRef ? forbidden ? 'FORBIDDEN_PATH_SEMANTICS' : 'QUALIFIED' : !/^\/cart\/add-to-cart\//i.test(path) ? 'WRONG_PATH_FAMILY' : !suffix ? 'EMPTY_SUFFIX' : suffix.includes('/') ? 'MULTI_SEGMENT_SUFFIX' : suffix.length > 200 ? 'OPAQUE_SUFFIX_TOO_LONG' : /[^A-Za-z0-9._~-]/.test(suffix) ? 'UNSUPPORTED_SUFFIX_CHARACTERS' : 'PATH_CASE_MISMATCH';
    return { rawPathPattern, canonicalPathPattern: pattern(path), qualified: (opaque || legacyRef) && !forbidden, reason, matcher: opaque ? 'qualifiedCartAction' : legacyRef ? 'cartAction_REF_SINGLE_SEGMENT_SUBSET' : 'NONE', decodePasses, opaqueMatch: opaque, legacyRefMatch: legacyRef, forbiddenPath: forbidden };
  };
  const viewport = { viewportWidth: globalThis.visualViewport?.width ?? globalThis.innerWidth ?? 0, viewportHeight: globalThis.visualViewport?.height ?? globalThis.innerHeight ?? 0, offsetX: globalThis.visualViewport?.offsetLeft ?? 0, offsetY: globalThis.visualViewport?.offsetTop ?? 0, scrollX: globalThis.scrollX ?? 0, scrollY: globalThis.scrollY ?? 0 };
  const panelCategory = node => {
    if (!node?.closest) return 'UNKNOWN';
    if (node.closest('#sp-cc,#sp-cc-dialog,[id="cookie-consent"]')) return 'COOKIE_OR_CONSENT';
    if (node.closest('[id^="GLUX"],#glow-ingress-block,#nav-global-location-popover-link')) return 'LOCATION_OR_DELIVERY';
    if (node.closest('#authportal-main-section,#nav-flyout-ya-signin')) return 'LOGIN_OR_ACCOUNT';
    if (node.closest('#sw-atc-confirmation,#huc-v2-order-row-container')) return 'CART_PANEL';
    if (node.closest('[data-component-type="promotion"]')) return 'PROMOTIONAL';
    if (node.closest('[role="dialog"],[aria-modal="true"],dialog[open]')) return 'GENERIC_DIALOG';
    return 'UNKNOWN';
  };
  const obstructionMetadata = (top, node) => {
    const style = top ? getComputedStyle(top) : {}; const category = panelCategory(top);
    const safeIds = ['add-to-cart-button', 'nav-main', 'nav-belt', 'navbar', 'sp-cc', 'sp-cc-dialog', 'sw-atc-confirmation', 'authportal-main-section'];
    const safeClasses = ['a-popover', 'a-modal', 'a-popover-modal', 'a-offscreen', 'a-button', 'a-button-input', 'nav-fixed', 'nav-sticky'];
    return { topElementTag: ['INPUT', 'BUTTON', 'SPAN', 'DIV', 'HEADER', 'NAV', 'DIALOG', 'BODY', 'HTML', 'A'].includes(top?.tagName) ? top.tagName : top ? 'OTHER' : 'NONE', topElementId: safeIds.includes(top?.id) ? top.id : 'REDACTED_OR_NONE', topElementRole: ['dialog', 'button', 'navigation', 'banner', 'alertdialog'].includes(top?.getAttribute?.('role')) ? top.getAttribute('role') : 'UNSPECIFIED_OR_OTHER', topElementClassNamesSanitized: [...(top?.classList ?? [])].slice(0, 20).map(c => safeClasses.includes(c) ? c : 'REDACTED_CLASS'), sameAsTarget: !!top && top === node, targetContainsTopElement: !!top && !!node?.contains?.(top), topElementContainsTarget: !!top?.contains?.(node), positionStyle: ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(style.position) ? style.position : 'UNKNOWN', zIndexCategory: style.zIndex === 'auto' ? 'AUTO' : Number.isFinite(Number(style.zIndex)) ? Number(style.zIndex) < 0 ? 'NEGATIVE' : Number(style.zIndex) === 0 ? 'ZERO' : 'POSITIVE' : 'UNKNOWN', fixedOrSticky: ['fixed', 'sticky'].includes(style.position), panelCategory: category };
  };
  const panelNodes = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open],#sw-atc-confirmation,#sp-cc,[id="GLUXZipUpdate"],#authportal-main-section')].slice(0, 20);
  const locationProjection = raw => {
    try {
      const u = new URL(raw, location.href); const mx = u.hostname === 'amazon.com.mx' || u.hostname.endsWith('.amazon.com.mx');
      const words = new Set(['cart', 'add-to-cart', 'gp', 'dp', 'html', 'api', '1', 'events', 'collect']);
      return { hostname: ['www.amazon.com.mx', 'amazon.com.mx', 'unagi.amazon.com.mx', 'fls-na.amazon.com.mx'].includes(u.hostname) && !u.username && !u.password ? u.hostname : 'REDACTED', pathPattern: mx ? '/' + u.pathname.split('/').filter(Boolean).slice(0, 10).map(s => words.has(s) ? s : ':redacted').join('/') : 'REDACTED' };
    } catch { return { hostname: 'REDACTED', pathPattern: 'REDACTED' }; }
  };
  const nodes = [...new Set([...primary, ...[...document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]')].slice(0, 2000).filter(n => label(n.getAttribute('aria-label') || n.value || n.textContent) === config.action)])].slice(0, 40);
  const candidates = nodes.map((node, index) => {
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    const visible = node.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    const enabled = !node.disabled && node.getAttribute('aria-disabled') !== 'true';
    const inside = (x, y) => x >= viewport.offsetX && y >= viewport.offsetY && x < viewport.offsetX + viewport.viewportWidth && y < viewport.offsetY + viewport.viewportHeight;
    const intersectionWidth = Math.max(0, Math.min(rect.x + rect.width, viewport.offsetX + viewport.viewportWidth) - Math.max(rect.x, viewport.offsetX));
    const intersectionHeight = Math.max(0, Math.min(rect.y + rect.height, viewport.offsetY + viewport.viewportHeight) - Math.max(rect.y, viewport.offsetY));
    const intersectionRatio = rect.width > 0 && rect.height > 0 ? Math.min(1, intersectionWidth * intersectionHeight / (rect.width * rect.height)) : 0;
    const hitTests = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([dx, dy]) => {
      const x = rect.x + rect.width * dx; const y = rect.y + rect.height * dy; const inViewport = inside(x, y);
      return { x, y, insideViewport: inViewport, ...obstructionMetadata(inViewport ? document.elementFromPoint(x, y) : null, node) };
    });
    const unobscured = intersectionRatio >= 0.999 && hitTests.every(h => h.insideViewport && (h.sameAsTarget || h.targetContainsTopElement));
    const blockers = hitTests.filter(h => h.insideViewport && !h.sameAsTarget && !h.targetContainsTopElement);
    const obstruction = intersectionRatio < 0.999 ? 'OUTSIDE_VIEWPORT' : unobscured ? 'UNOBSCURED' : blockers.some(h => h.panelCategory !== 'UNKNOWN') ? 'OBSCURED_BY_MODAL_OR_PANEL' : blockers.some(h => h.fixedOrSticky || ['HEADER', 'NAV'].includes(h.topElementTag)) ? 'OBSCURED_BY_PAGE_CHROME' : 'OBSCURED_BY_UNKNOWN';
    const form = node.form ?? node.closest('form'); const fields = form ? [...form.querySelectorAll('input,select,textarea')].slice(0, 200) : [];
    const asins = fields.filter(n => /^(?:ASIN|asin)(?:\.1)?$/.test(n.name)); const quantities = fields.filter(n => /^quantity(?:\.1)?$/.test(n.name));
    const asinMatched = asins.length > 0 && asins.every(n => n.value === config.asin);
    const region = node.closest('#buybox,#buybox_feature_div,#desktop_buybox,#addToCart');
    const recommendation = !!node.closest('[id^="sims-"],[id^="similarities"],[data-component-type="s-search-result"]');
    const regionAsin = region?.getAttribute('data-asin');
    const productBound = !recommendation && (asins.length ? asinMatched : !!region && regionAsin === config.asin);
    const action = label(node.getAttribute('aria-label') || node.value || node.textContent);
    const reasons = []; if (node.id !== 'add-to-cart-button') reasons.push('NON_PRIMARY'); if (!node.isConnected) reasons.push('DETACHED'); if (!visible) reasons.push('HIDDEN'); if (!enabled) reasons.push('DISABLED'); if (!unobscured) reasons.push(obstruction); if (!productBound) reasons.push('NOT_PRODUCT_BOUND'); if (recommendation) reasons.push('RECOMMENDATION'); if (action !== config.action) reasons.push('ACTION_LABEL_MISMATCH');
    if (!['BUTTON', 'INPUT', 'A'].includes(node.tagName)) reasons.push('NOT_ACTION_CONTROL');
    let formActionQualified = false; let formActionQualificationReason = 'INVALID_FORM_ACTION';
    let formActionDiagnostics = { formActionHostname: 'REDACTED', formActionRegistrableDomain: 'UNKNOWN', formActionAuthorityQualified: false, formActionPathPattern: 'INVALID_URL', formActionCanonicalPathPattern: 'INVALID_URL', formActionPathQualified: false, formActionPathReason: 'INVALID_URL', formActionMatcherVersion: 'MX_CART_PATH_V1', formActionMatcher: 'NONE' };
    const rawFormAction = node.getAttribute('formaction') || form?.getAttribute?.('action') || form?.action;
    try {
      const actionUrl = new URL(rawFormAction, location.href); const path = canonicalCartPath(actionUrl.pathname);
      const authority = actionUrl.protocol === 'https:' && actionUrl.hostname === 'www.amazon.com.mx' && !actionUrl.username && !actionUrl.password && !actionUrl.port;
      formActionQualified = authority && path.qualified;
      formActionQualificationReason = !authority ? 'FORM_AUTHORITY_UNQUALIFIED' : !path.qualified ? 'FORM_PATH_UNQUALIFIED' : 'QUALIFIED';
      formActionDiagnostics = { ...formActionDiagnostics, formActionHostname: authority ? 'www.amazon.com.mx' : 'REDACTED', formActionRegistrableDomain: actionUrl.hostname === 'amazon.com.mx' || actionUrl.hostname.endsWith('.amazon.com.mx') ? 'amazon.com.mx' : 'UNKNOWN', formActionAuthorityQualified: authority, formActionPathPattern: path.rawPathPattern, formActionCanonicalPathPattern: path.canonicalPathPattern, formActionPathQualified: path.qualified, formActionPathReason: path.reason, formActionMatcher: path.matcher, formActionDecodePasses: path.decodePasses, formActionOpaquePathMatch: path.opaqueMatch ?? false, formActionLegacyRefPathMatch: path.legacyRefMatch ?? false, formActionForbiddenPath: path.forbiddenPath ?? false };
    } catch { /* No raw action, suffix, query or exception is persisted. */ }
    return {
      geometry: { ...viewport, elementBoundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, elementCenterInsideViewport: hitTests[0].insideViewport, intersectionRatio, intersectionSource: 'VIEWPORT_RECTANGLE', hitTests }, obstruction, formActionQualified, formActionQualificationReason, ...formActionDiagnostics,
      candidateIndex: index, primaryIndex: primary.indexOf(node), tagName: ['BUTTON', 'INPUT', 'A'].includes(node.tagName) ? node.tagName : 'OTHER', inputType: ['submit', 'button', 'image'].includes(node.type) ? node.type : 'OTHER', id: node.id === 'add-to-cart-button' ? node.id : 'REDACTED_OR_OTHER', name: safeName(node.name), role: ['button', 'link'].includes(node.getAttribute('role')) ? node.getAttribute('role') : 'UNSPECIFIED_OR_OTHER', ariaLabel: label(node.getAttribute('aria-label')), actionLabel: action, visible, enabled, connected: !!node.isConnected, boundingBoxPresent: rect.width > 0 && rect.height > 0, unobscured, productBound, recommendation, hrefHostAndPathPattern: node.hasAttribute('href') ? locationProjection(node.getAttribute('href')) : null, formPresent: !!form,
      form: form ? { action: locationProjection(rawFormAction), method: ['get', 'post'].includes((node.getAttribute('formmethod') || form.method).toLowerCase()) ? (node.getAttribute('formmethod') || form.method).toUpperCase() : 'OTHER', target: ['', '_self', '_blank', '_top', '_parent'].includes(form.target) ? form.target || '_self' : 'REDACTED', enctype: ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(form.enctype) ? form.enctype : 'OTHER', fieldNames: [...new Set(fields.map(n => safeName(n.name)))], expectedAsinPresent: asins.length > 0, expectedAsinMatched: asinMatched, quantityPresent: quantities.length > 0, quantityMatched: quantities.length > 0 && quantities.every(n => n.value === '1') } : null,
      onclickPresent: node.hasAttribute('onclick') || typeof node.onclick === 'function', jsListenerBinding: 'UNKNOWN', dataAttributeNames: node.getAttributeNames().filter(n => n.startsWith('data-')).slice(0, 30).map(n => ['data-action', 'data-asin', 'data-a-button-type', 'data-csa-c-type', 'data-csa-c-slot-id', 'data-csa-c-content-id'].includes(n) ? n : 'data-REDACTED'), rejectionReasons: reasons
    };
  });
  for (const candidate of candidates) {
    const failures = candidate.rejectionReasons.filter(reason => !['OUTSIDE_VIEWPORT', 'OBSCURED_BY_PAGE_CHROME', 'OBSCURED_BY_MODAL_OR_PANEL', 'OBSCURED_BY_UNKNOWN'].includes(reason));
    if (candidate.tagName !== 'INPUT' || candidate.inputType !== 'submit' || candidate.name !== 'submit.add-to-cart') failures.push('CONTROL_SEMANTICS');
    if (!candidate.boundingBoxPresent) failures.push('EMPTY_GEOMETRY');
    if (!candidate.formPresent) failures.push('FORM_MISSING');
    if (!candidate.formActionQualified) failures.push(candidate.formActionQualificationReason);
    if (candidate.form?.method !== 'POST') failures.push('FORM_METHOD');
    if (candidate.form?.enctype !== 'application/x-www-form-urlencoded') failures.push('FORM_ENCODING');
    if (!candidate.form?.expectedAsinMatched) failures.push('FORM_ASIN');
    if (!candidate.form?.quantityMatched) failures.push('FORM_QUANTITY');
    candidate.semanticRejectionReasons = [...new Set(failures)]; candidate.semanticQualified = failures.length === 0;
    candidate.rejectionReasons = [...new Set([...candidate.rejectionReasons, ...failures])];
    candidate.qualificationStage = candidate.semanticQualified ? 'VIEWPORT_NORMALIZATION_CANDIDATE' : 'SEMANTIC_REJECTED';
  }
  const pinnable = candidates.filter(n => n.semanticQualified);
  const pin = pinnable.length === 1 ? pinnable[0] : null;
  const selected = config.finalClickQualification === true && pin?.unobscured && (!pinned || primary[pin.primaryIndex] === pinned) ? pin : null;
  if (selected) selected.qualificationStage = 'CLICK_QUALIFIED';
  const target = pinned ?? (pin ? primary[pin.primaryIndex] : null);
  const panels = panelNodes.map(node => {
    const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
    const visible = node.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    const left = Math.max(rect.x, viewport.offsetX); const right = Math.min(rect.x + rect.width, viewport.offsetX + viewport.viewportWidth);
    const top = Math.max(rect.y, viewport.offsetY); const bottom = Math.min(rect.y + rect.height, viewport.offsetY + viewport.viewportHeight);
    const intersectsViewport = right > left && bottom > top;
    const safeTargetHit = hit => !!target && (hit === target || target.contains(hit));
    const panelHit = hit => !!hit && !safeTargetHit(hit) && (hit === node || node.contains(hit));
    const targetRect = target?.getBoundingClientRect();
    const coversTarget = visible && intersectsViewport && targetRect && [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].some(([dx, dy]) => {
      const x = targetRect.x + targetRect.width * dx; const y = targetRect.y + targetRect.height * dy;
      return x >= viewport.offsetX && y >= viewport.offsetY && x < viewport.offsetX + viewport.viewportWidth && y < viewport.offsetY + viewport.viewportHeight && panelHit(document.elementFromPoint(x, y));
    });
    const meaningfulArea = (right - left) * (bottom - top) >= viewport.viewportWidth * viewport.viewportHeight * 0.05;
    const overlaysViewport = visible && intersectsViewport && meaningfulArea && ['fixed', 'absolute', 'sticky'].includes(style.position) && panelHit(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
    const activeBlocking = visible && intersectsViewport && node !== target && !target?.contains(node) && !!(coversTarget || overlaysViewport);
    return { category: panelCategory(node), visible, intersectsViewport, coversTarget: !!coversTarget, overlaysViewport: !!overlaysViewport, activeBlocking, ...obstructionMetadata(node, target) };
  });
  const activeBlockingPanelPresent = panels.some(panel => panel.activeBlocking);
  const text = (document.body?.innerText ?? '').slice(0, 30000);
  return {
    panels, panelDetectedInDom: panels.length > 0, activeBlockingPanelPresent, visiblePanelCount: panels.filter(p => p.visible).length,
    preselected: pin, preselectedPrimaryIndex: pin?.primaryIndex ?? null, preselectionReason: pin ? 'UNIQUE_PRODUCT_BOUND_VIEWPORT_CANDIDATE' : pinnable.length ? 'AMBIGUOUS_PRIMARY_CONTROLS' : 'NO_SEMANTICALLY_QUALIFIED_CONTROL',
    pinnablePrimaryIndex: pin?.primaryIndex ?? null, pinnableCandidate: pin, pinnedConnected: pinned ? pinned.isConnected === true : null, pinnedMatchesCandidate: pinned ? !!pin && primary[pin.primaryIndex] === pinned && pinned.isConnected : null,
    candidateCount: candidates.length, candidateScanCapped: nodes.length === 40, primaryCount: primary.length, candidates, selectedPrimaryIndex: selected?.primaryIndex ?? null, selected, pinnedMatchesSelection: pinned ? !!selected && primary[selected.primaryIndex] === pinned && pinned.isConnected : null, selectionReason: selected ? 'CLICK_QUALIFIED' : pinnable.length > 1 ? 'AMBIGUOUS_PRIMARY_CONTROLS' : 'NO_QUALIFIED_PRIMARY_CONTROL',
    currentLocation: locationProjection(location.href), successMessagePresent: /agregado al carrito|añadido a la cesta|added to cart/i.test(text), errorMessageCategory: /captcha|robot check/i.test(text) ? 'CHALLENGE' : /no se pudo|ha ocurrido un error|something went wrong/i.test(text) ? 'GENERIC_ERROR' : 'NONE_OBSERVED', modalOrPanelPresent: activeBlockingPanelPresent
  };
}

/** Passive capture listeners: no cancellation, dispatch, form submission or application handler replacement. */
export function installCartEventObservers() {
  const emit = (kind, event, primary) => {
    const at = Date.now();
    queueMicrotask(() => { void window.__astraCartDiagnostic({ kind, at, primary, trusted: event.isTrusted === true, defaultPrevented: event.defaultPrevented === true }).catch(() => { }); });
  };
  document.addEventListener('click', event => { const node = event.target?.closest?.('#add-to-cart-button'); if (node) emit('DOM_CLICK_EVENT_OBSERVED', event, true); }, { capture: true, passive: true });
  document.addEventListener('submit', event => { const form = event.target; const primary = event.submitter?.id === 'add-to-cart-button' || !!form?.querySelector?.('#add-to-cart-button'); if (primary) emit('FORM_SUBMIT_EVENT_OBSERVED', event, true); }, { capture: true, passive: true });
}

export function sanitizedDomEvent(value) {
  if (!['DOM_CLICK_EVENT_OBSERVED', 'FORM_SUBMIT_EVENT_OBSERVED'].includes(value?.kind) || !Number.isFinite(value.at)) return null;
  return { kind: value.kind, browserAt: value.at, primary: value.primary === true, trusted: value.trusted === true, defaultPrevented: value.defaultPrevented === true };
}

const key = (url, method) => createHash('sha256').update(method + '\n' + url).digest('hex');
/** Passive Network domain only. Request IDs, raw URLs, headers, bodies and stack function names never leave transient event handling. */
export async function installInitiatorDiagnostics(context, page, productUrl, clock) {
  const records = []; const links = []; let session; let accepting = true; let status = 'UNAVAILABLE';
  try {
    session = await boundedBrowserStep(context.newCDPSession(page), 3000, 'CDP_DIAGNOSTIC_TIMEOUT', s => s.detach());
    session.on('Network.requestWillBeSent', event => {
      if (!accepting || records.length >= 400) return;
      const method = ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(event.request?.method) ? event.request.method : 'OTHER';
      const frames = event.initiator?.stack?.callFrames?.slice(0, 4) ?? [];
      records.push({ key: key(event.request?.url ?? '', method), data: { cdpSequence: records.length + 1, observedAt: clock.now(), browserWallAt: Number.isFinite(event.wallTime) ? event.wallTime * 1000 : null, location: publicLocation(event.request?.url, productUrl), method, resourceType: ['Document', 'XHR', 'Fetch', 'Script', 'Image', 'Other'].includes(event.type) ? event.type : 'OTHER', initiatorType: ['parser', 'script', 'preload', 'preflight', 'other'].includes(event.initiator?.type) ? event.initiator.type : 'UNKNOWN', initiatorLocation: publicLocation(event.initiator?.url ?? frames[0]?.url, productUrl), stackLocations: frames.map(f => publicLocation(f.url, productUrl)), documentLocation: publicLocation(event.documentURL, productUrl) } });
    });
    await boundedBrowserStep(session.send('Network.enable'), 3000, 'CDP_DIAGNOSTIC_TIMEOUT'); status = 'PASSIVE_ENABLED';
  } catch { status = 'UNAVAILABLE'; }
  return {
    status, bind(url, method, row) { if (links.length < 400) links.push({ key: key(url, method), row }); }, finish(clickStartedAt) {
      for (const link of links) {
        const matches = records.filter(r => r.key === link.key); const peers = links.filter(l => l.key === link.key);
        link.row.initiatorEvidence = matches.length === 1 && peers.length === 1 ? { match: 'UNIQUE_URL_METHOD', ...matches[0].data } : { match: matches.length ? 'AMBIGUOUS' : 'UNAVAILABLE' };
        link.row.relativeToClickMs = clickStartedAt === null ? null : link.row.requestObservedAt - clickStartedAt;
        link.row.clickCausality = link.row.phaseAtObservation === 'BASELINE' ? link.row.qualifiedCartPathMatch ? 'PRECLICK_CART_PATH_OBSERVATION' : 'PRECLICK' : 'POST_CLICK_TEMPORAL_ONLY_INITIATOR_NOT_PROOF_OF_CONTROL_CAUSALITY';
      }
      return records.map(r => ({ ...r.data, relativeToClickMs: clickStartedAt === null ? null : r.data.observedAt - clickStartedAt }));
    }, async close() { accepting = false; await session?.detach().catch(() => { }); }
  };
}
