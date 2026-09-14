const secret = /cookie|authorization|session|csrf|token|signature|password|customer|email|address|postal|zip|payment|credential|offeringid/i;
const normalize = key => key.toLowerCase().replace(/[^a-z]/g, '');
const semanticNames = new Set(['asin', 'quantity', 'price', 'currency', 'pricecurrency', 'sellerid', 'merchantid', 'offerid', 'offerlistingid', 'listingid', 'cartitemid', 'itemid', 'success', 'status', 'purchasemode']);
export const BODY_CAP = 65536;
export function authorityDiagnostics(input, productUrl) {
  const unknown = { normalizedHostLabel: 'REDACTED', registrableDomain: 'UNKNOWN', withinExpectedDomainBoundary: false, sameSite: false, sameOrigin: false, approvedAuthorityMatch: false };
  try {
    const u = new URL(input); const product = new URL(productUrl);
    const mx = u.hostname === 'amazon.com.mx' || u.hostname.endsWith('.amazon.com.mx');
    const productMx = product.hostname === 'amazon.com.mx' || product.hostname.endsWith('.amazon.com.mx');
    const authorityValid = u.protocol === 'https:' && !u.username && !u.password && !u.port;
    // Retain short ordinary public DNS labels only. Dynamic/credential-like labels remain redacted.
    const prefix = u.hostname === 'amazon.com.mx' ? '' : u.hostname.slice(0, -'.amazon.com.mx'.length);
    const safeLabel = mx && (!prefix || prefix.split('.').length <= 2 && prefix.split('.').every(label => /^[a-z][a-z-]{0,31}$/.test(label) && !/token|session|cookie|secret|credential|auth/.test(label)));
    return { normalizedHostLabel: authorityValid && safeLabel ? u.hostname : 'REDACTED', registrableDomain: mx ? 'amazon.com.mx' : 'UNKNOWN', withinExpectedDomainBoundary: mx, sameSite: mx && productMx && u.protocol === 'https:' && product.protocol === 'https:', sameOrigin: u.origin === product.origin, approvedAuthorityMatch: authorityValid && ['www.amazon.com.mx', 'amazon.com.mx'].includes(u.hostname) };
  } catch { return unknown; }
}
export function pathPattern(url) {
  try {
    const u = new URL(url); if (!['www.amazon.com.mx', 'amazon.com.mx', 'm.media-amazon.com'].includes(u.hostname) && !u.hostname.endsWith('.amazon.com.mx')) return 'OTHER_HOST_REDACTED';
    const known = new Set(['gp', 'dp', 'add-to-cart', 'html', 'aws', 'cart', 'add.html', 'view.html', 'smart-wagon', 'hz', 'aj', 'aod', 'ajax', 'product', 'images', 'I', 'S']);
    return '/' + u.pathname.split('/').filter(Boolean).slice(0, 10).map(s => known.has(s) ? s : ':redacted').join('/');
  } catch { return 'INVALID_URL'; }
}
/** Retains fixed-vocabulary semantic values only; never headers, unknown key names or secret values. */
export function inspectSemantic(body, contentType, asin) {
  const result = { fields: [], sensitiveFields: [], dependencies: { session: false, token: false, opaqueOffer: false, location: false }, inspected: false };
  if (typeof body !== 'string' || Buffer.byteLength(body) > BODY_CAP) return result;
  let parsed;
  try {
    if (contentType.includes('json')) parsed = JSON.parse(body);
    else if (contentType.includes('x-www-form-urlencoded')) parsed = [...new URLSearchParams(body)].map(([k, v]) => ({ [k]: v }));
    else return result;
  } catch { return result; }
  let visits = 0;
  function walk(value, depth) {
    if (!value || typeof value !== 'object' || depth > 8 || ++visits > 400) return;
    for (const [key, v] of Object.entries(value).slice(0, 100)) {
      if (result.fields.length >= 40) break;
      const name = normalize(key);
      if (secret.test(key)) {
        const kind = /offeringid/i.test(key) ? 'OPAQUE_OFFER' : /csrf|token|signature/i.test(key) ? 'TOKEN_OR_SIGNATURE' : /cookie|session|authorization/i.test(key) ? 'SESSION_OR_AUTH' : /address|postal|zip/i.test(key) ? 'LOCATION' : 'PRIVATE';
        if (!result.sensitiveFields.some(f => f.fieldName === kind)) result.sensitiveFields.push({ fieldName: kind, presence: true, shape: typeof v === 'object' ? 'STRUCTURE' : 'SCALAR', value: 'REDACTED' });
        result.dependencies.session ||= kind === 'SESSION_OR_AUTH'; result.dependencies.token ||= kind === 'TOKEN_OR_SIGNATURE'; result.dependencies.opaqueOffer ||= kind === 'OPAQUE_OFFER'; result.dependencies.location ||= kind === 'LOCATION';
        continue;
      }
      if (v && typeof v === 'object') { walk(v, depth + 1); continue; }
      if (!semanticNames.has(name)) continue;
      let safe = null;
      if (name === 'asin') safe = v === asin ? asin : 'OTHER_PRODUCT';
      else if (name === 'quantity' && /^(?:[1-9]|[1-9]\d)$/.test(String(v))) safe = Number(v);
      else if (name === 'price' && /^\d{1,6}\.\d{2}$/.test(String(v))) safe = String(v);
      else if (['currency', 'pricecurrency'].includes(name) && ['MXN', 'USD', 'CAD', 'EUR'].includes(v)) safe = v;
      else if (['sellerid', 'merchantid'].includes(name) && /^[A-Z0-9]{1,30}$/.test(String(v))) safe = String(v);
      else if (['offerid', 'offerlistingid', 'listingid', 'cartitemid', 'itemid'].includes(name)) {
        // Opaque signed offer handles are not stable public IDs. Characterize rather than leak them.
        safe = /^\d{1,20}$/.test(String(v)) ? String(v) : 'OPAQUE_REDACTED';
        if (safe === 'OPAQUE_REDACTED') result.dependencies.opaqueOffer = true;
      } else if (name === 'purchasemode' && ['IMMEDIATE', 'PREORDER'].includes(v)) safe = v;
      else if (['status', 'success'].includes(name) && ['SUCCESS', 'FAILURE', 'OK', true, false].includes(v)) safe = v;
      result.fields.push({ fieldName: name, presence: true, value: safe ?? 'REDACTED_OR_UNSUPPORTED' });
    }
  }
  walk(parsed, 0); result.inspected = true; return result;
}
export function headerPresence(headers) {
  const keys = Object.keys(headers).map(k => k.toLowerCase());
  return { session: keys.some(k => /^(?:cookie|authorization|set-cookie)$/.test(k)), token: keys.some(k => /csrf|token|signature/.test(k)), origin: keys.some(k => /^(?:origin|referer)$/.test(k)) };
}
function signature(row) { return JSON.stringify([row.normalizedHostLabel ?? null, row.hostClass ?? null, row.method, row.pathPattern, row.allowed, row.classification ?? null, row.requestEvidence?.fields ?? []]); }
export function correlateTraffic(rows, cartConfirmed) {
  const baseline = rows.filter(r => r.phase === 'BASELINE'); const action = rows.filter(r => r.phase === 'ACTION');
  const signatures = new Set(baseline.map(signature)); const unique = action.filter(r => !signatures.has(signature(r)));
  const candidates = unique.filter(r => r.allowed && r.classification === 'CART_CANDIDATE');
  // Browser confirmation plus one unambiguous transmitted candidate; never HTTP 200 alone.
  const confirmed = cartConfirmed && candidates.length === 1 && candidates[0].status >= 200 && candidates[0].status < 400 ? { ...candidates[0], classification: 'CART_CONFIRMED' } : null;
  const summary = list => ({ total: list.length, allowed: list.filter(r => r.allowed).length, xhr: list.filter(r => r.resourceType === 'xhr').length, fetch: list.filter(r => r.resourceType === 'fetch').length, post: list.filter(r => r.method === 'POST').length });
  const useful = candidates.flatMap(r => [...r.requestEvidence.fields, ...(r.responseEvidence?.fields ?? [])]);
  const dependencies = key => candidates.some(r => r.requestEvidence.dependencies[key] || r.responseEvidence?.dependencies[key] || r.headerPresence?.[key]);
  return {
    baselineTrafficSummary: summary(baseline), actionTrafficSummary: summary(action), baselineRequests: baseline, actionRequests: action, newActionCorrelatedRequests: unique, cartCandidateRequests: candidates, cartConfirmedRequest: confirmed, semanticIdentifiersFound: useful,
    sessionDependencies: { required: 'UNKNOWN', observed: dependencies('session'), scope: dependencies('session') ? 'SESSION' : 'UNKNOWN' },
    tokenDependencies: { required: 'UNKNOWN', observed: dependencies('token') || dependencies('opaqueOffer'), scope: 'UNKNOWN' },
    originDependencies: { required: 'UNKNOWN', observed: candidates.some(r => r.headerPresence?.origin), scope: 'UNKNOWN' },
    locationDependencies: { required: 'UNKNOWN', observed: dependencies('location'), scope: 'UNKNOWN' },
    backendTransportFeasibility: !cartConfirmed ? 'BLOCKED' : dependencies('token') || dependencies('opaqueOffer') || dependencies('session') ? 'SESSION_BOUND / HIGH_FRAGILITY' : 'INSUFFICIENT_EVIDENCE'
  };
}
