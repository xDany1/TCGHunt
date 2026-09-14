import { createHash } from 'node:crypto';
import { reconRouteDecision } from './amazon-passive-policy.mjs';

export const PASSIVE_BODY_CAP = 256 * 1024;
const hosts = ['amazon.com.mx', 'www.amazon.com.mx'];
const unique = values => { const v = [...new Set(values)]; return v.length === 1 ? v[0] : null; };
const normalizedKey = key => key.toLowerCase().replace(/[^a-z]/g, '');
const vocabulary = new Set(['availability', 'available', 'buyable', 'buyability', 'instock', 'outofstock', 'offer', 'offers', 'price', 'pricecurrency', 'currency', 'seller', 'merchant', 'merchantid', 'fulfillment', 'shipsfrom', 'shipping', 'asin', 'productid', 'preorder', 'releasedate']);
const sensitive = /cookie|auth|session|customer|user|account|address|location|csrf|signed|signature|token|credential|secret/i;
function naturalPostEligible(meta) {
  const decision = reconRouteDecision({ url: meta.url, method: meta.method, type: meta.resourceType, main: true }, {});
  return meta.method === 'POST' && meta.naturalPageRequest === true && meta.routeAllowed === true && decision.allowed && decision.classification === 'UNCLASSIFIED';
}
function availability(key, value) {
  if (['available', 'instock'].includes(key) && typeof value === 'boolean') return value ? 'AVAILABLE' : 'UNAVAILABLE';
  if (key === 'outofstock' && typeof value === 'boolean') return value ? 'UNAVAILABLE' : 'AVAILABLE';
  if (key === 'availability' && typeof value === 'string') {
    if (/^(?:AVAILABLE|IN_STOCK|InStock|In stock|Disponible|https:\/\/schema.org\/InStock)$/.test(value)) return 'AVAILABLE';
    if (/^(?:UNAVAILABLE|OUT_OF_STOCK|OutOfStock|Currently unavailable|https:\/\/schema.org\/OutOfStock)$/.test(value)) return 'UNAVAILABLE';
  }
  return null;
}
export function passiveMetadata(meta) {
  let url; try { url = new URL(meta.url); } catch { return null; }
  if (!hosts.includes(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password || !['GET', 'POST'].includes(meta.method) || !['xhr', 'fetch', 'document'].includes(meta.resourceType) || meta.inspectionClass === 'IGNORED_TELEMETRY') return null;
  const type = (meta.contentType ?? '').split(';')[0].trim().toLowerCase();
  // Never retain unknown path segments, queries, fragment, request headers or request bodies.
  const pathWords = new Set(['api', 'gp', 'dp', 'product', 'products', 'offer', 'offers', 'availability', 'ajax']);
  const pathPattern = '/' + url.pathname.split('/').filter(Boolean).slice(0, 12).map(s => pathWords.has(s) ? s : ':segment').join('/');
  return { host: url.hostname, pathPattern, method: meta.method, status: Number.isInteger(meta.status) ? meta.status : 0, resourceType: meta.resourceType, contentType: ['application/json', 'text/json', 'text/plain', 'text/html'].includes(type) ? type : 'OTHER', observedAt: meta.observedAt, classification: meta.method === 'POST' && !naturalPostEligible(meta) ? 'UNCLASSIFIED' : meta.resourceType === 'document' ? 'PAGE_EMBEDDED' : 'PRIVATE_PAGE_LOAD_SIGNAL' };
}
export function passiveBodyAllowed(meta) {
  return passiveBodyReason(meta) === null;
}
export function passiveBodyReason(meta) {
  const safe = passiveMetadata(meta);
  const d = reconRouteDecision({ url: meta.url, method: meta.method, type: meta.resourceType, main: true }, {});
  if (!safe) return 'METADATA_OUT_OF_SCOPE';
  if (d.reason === 'MUTATION_OR_AUTH_DENIED') return 'MUTATION_OR_AUTH_DENIED';
  if (meta.method === 'POST' && !naturalPostEligible(meta)) return 'POST_NOT_PROVEN_NATURAL_ALLOWED';
  if (safe.status !== 200) return 'STATUS_NOT_ELIGIBLE';
  if (safe.contentType === 'OTHER') return 'CONTENT_TYPE_NOT_ELIGIBLE';
  if (!Number.isSafeInteger(meta.declaredBytes) || meta.declaredBytes <= 0) return 'DECLARED_LENGTH_UNKNOWN_OR_EMPTY';
  if (meta.declaredBytes > PASSIVE_BODY_CAP) return 'DECLARED_BODY_CAP';
  return null;
}
export function inspectPassiveBody(meta, body, asin) {
  const safe = passiveMetadata(meta); if (!safe) return null;
  const empty = { ...safe, sanitizedMatchedFields: [], availabilityEvidence: 'UNKNOWN', priceEvidence: [], currencyEvidence: [], sellerEvidence: [], fulfillmentEvidence: [], asinRelationship: 'UNBOUND', confidence: 'LOW', inspected: false };
  if (!passiveBodyAllowed(meta) || typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > PASSIVE_BODY_CAP) return { ...empty, limitation: 'BODY_NOT_ELIGIBLE' };
  if (/captcha|robot check|access denied|acceso denegado|verify you are human/i.test(body)) return { ...empty, stop: 'CHALLENGE_OR_ACCESS_DENIED' };
  let parsed; try { parsed = JSON.parse(body); } catch { return { ...empty, limitation: 'NON_JSON_TEXT_NOT_PARSED' }; }
  // Unknown POST contracts never disclose account-bearing payloads, even beside product fields.
  if (meta.method === 'POST') {
    let checked = 0; let unsafe = false;
    function privacy(value, depth) {
      if (!value || typeof value !== 'object' || unsafe) return;
      if (++checked > 2000 || depth > 10) { unsafe = true; return; }
      for (const [key, child] of Object.entries(value)) { if (sensitive.test(key)) { unsafe = true; return; } privacy(child, depth + 1); }
    }
    privacy(parsed, 0); if (unsafe) return { ...empty, limitation: 'SENSITIVE_OR_UNQUALIFIABLE_POST_OMITTED' };
  }
  const fields = []; const states = []; let visits = 0; let scoped = false;
  function walk(value, depth) {
    if (depth > 10 || ++visits > 2000 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 50)) walk(child, depth + 1); return; }
    const entries = Object.entries(value).slice(0, 100);
    // Diagnostic heuristics never associate unrelated nested offers with a product by position.
    const ids = entries.filter(([key]) => ['asin', 'productid'].includes(normalizedKey(key))).map(([, v]) => v);
    const bound = ids.length > 0 && ids.every(id => id === asin);
    if (bound) scoped = true;
    for (const [key, v] of entries) {
      if (sensitive.test(key)) continue;
      const k = normalizedKey(key);
      if (v && typeof v === 'object') { walk(v, depth + 1); if (vocabulary.has(k) && fields.length < 80) fields.push({ field: k, value: 'STRUCTURE_PRESENT', boundToAsin: bound }); continue; }
      if (!vocabulary.has(k) || fields.length >= 80) continue;
      let sanitized = 'REDACTED_OR_UNSUPPORTED';
      const state = availability(k, v);
      if (state) { sanitized = state; if (bound) states.push(state); }
      else if (['asin', 'productid'].includes(k)) sanitized = v === asin ? asin : 'OTHER_PRODUCT';
      else if (['currency', 'pricecurrency'].includes(k) && ['MXN', 'USD', 'CAD', 'EUR'].includes(v)) sanitized = v;
      else if (k === 'price' && typeof v === 'string' && /^\d{1,9}\.\d{2}$/.test(v)) sanitized = v;
      else if (['seller', 'merchant', 'fulfillment', 'shipsfrom'].includes(k) && ['Amazon', 'Amazon México', 'AMAZON', 'MERCHANT'].includes(v)) sanitized = v;
      else if (['buyable', 'buyability', 'preorder'].includes(k) && typeof v === 'boolean') sanitized = v;
      fields.push({ field: k, value: sanitized, boundToAsin: bound });
    }
  }
  walk(parsed, 0);
  const values = keys => fields.filter(f => f.boundToAsin && keys.includes(f.field) && f.value !== 'REDACTED_OR_UNSUPPORTED' && f.value !== 'STRUCTURE_PRESENT').map(f => f.value);
  return { ...empty, inspected: true, sanitizedMatchedFields: fields, availabilityEvidence: unique(states) ?? 'UNKNOWN', evidenceConflict: new Set(states).size > 1, priceEvidence: values(['price']), currencyEvidence: values(['currency', 'pricecurrency']), sellerEvidence: values(['seller', 'merchant']), fulfillmentEvidence: values(['fulfillment', 'shipsfrom']), asinRelationship: scoped ? 'EXPLICIT_SAME_OBJECT' : 'UNBOUND', confidence: scoped ? 'MEDIUM_DIAGNOSTIC_ONLY' : 'LOW', limitation: visits > 2000 ? 'NODE_LIMIT' : null };
}
/** No durable engine/coordinator dependency. Candidates are diagnostic records, never business events. */
export function reconcilePassive({ asin, responses, ui, prior = null, seen = [] }) {
  const useful = responses.filter(r => r.inspected && r.asinRelationship === 'EXPLICIT_SAME_OBJECT');
  const states = useful.map(r => r.availabilityEvidence).filter(s => s !== 'UNKNOWN'); const network = unique(states) ?? 'UNKNOWN';
  const conflict = useful.some(r => r.evidenceConflict) || new Set(states).size > 1 || (network !== 'UNKNOWN' && ui.availability !== 'UNKNOWN' && network !== ui.availability);
  const eligible = !conflict && network === 'AVAILABLE' && ui.availability === 'UNKNOWN' && prior?.availability === 'UNAVAILABLE' && !!prior.reference;
  const key = eligible ? createHash('sha256').update(JSON.stringify(['M5.4A', asin, prior.reference, 'AVAILABLE'])).digest('hex') : null;
  const restockCandidate = key && !seen.includes(key) ? { type: 'RESTOCK_CANDIDATE', id: key, actionable: false, mode: 'DRY_RUN' } : null;
  const earliest = useful.filter(r => r.availabilityEvidence !== 'UNKNOWN').sort((a, b) => a.observedAt - b.observedAt)[0];
  const uiFirst = ui.firstKnownAt ?? (ui.availability !== 'UNKNOWN' ? ui.observedAt : null);
  return { passiveNetworkEvidence: { source: 'PASSIVE_NETWORK', availability: network, observedAt: earliest?.observedAt ?? null, confidence: network === 'UNKNOWN' ? 'LOW' : 'MEDIUM_DIAGNOSTIC_ONLY' }, uiEvidence: { source: 'RENDERED_UI', ...ui }, availability: conflict ? 'UNKNOWN' : network === 'UNKNOWN' ? ui.availability : network, evidenceConflict: conflict, restockCandidate, candidateDuplicate: !!key && seen.includes(key), candidateSuppressedReason: network === 'AVAILABLE' && !prior ? 'NO_PRIOR_DURABLE_BASELINE' : null, restockConfirmed: false, actionable: false, mode: 'DRY_RUN', earliestAvailabilitySource: earliest && (uiFirst === null || earliest.observedAt < uiFirst) ? 'PASSIVE_NETWORK_FIRST_SAMPLED' : uiFirst !== null ? 'RENDERED_UI_FIRST_SAMPLED' : 'UNKNOWN', availabilityBeforeVisibleUi: 'NOT_ESTABLISHED', timingLimitation: 'Response receipt and UI snapshot times are sampling times, not UI first-appearance measurements.' };
}

/** Final-pass diagnostic only. An early availability hint is not a literal restock or durable event. */
export function finalPassiveDiagnostics({ asin, responses, uiSamples, uiAvailability, conflict, seen = [] }) {
  const naturalPostResponses = responses.filter(r => r.method === 'POST').map(r => ({
    pathPattern: r.pathPattern, status: r.status, contentType: r.contentType, inspected: r.inspected === true, classification: r.classification,
    sanitizedMatchedFields: r.sanitizedMatchedFields ?? [], availabilityEvidence: r.availabilityEvidence ?? 'UNKNOWN', priceEvidence: r.priceEvidence ?? [], currencyEvidence: r.currencyEvidence ?? [], sellerEvidence: r.sellerEvidence ?? [], fulfillmentEvidence: r.fulfillmentEvidence ?? [], observedAt: r.observedAt
  }));
  const available = responses.filter(r => r.inspected && r.asinRelationship === 'EXPLICIT_SAME_OBJECT' && r.availabilityEvidence === 'AVAILABLE' && !r.evidenceConflict && Number.isFinite(r.evidenceAt)).sort((a, b) => a.evidenceAt - b.evidenceAt)[0];
  const unknownAfter = available && uiSamples.some(s => s.boundToAsin === true && s.observedAt >= available.evidenceAt && s.availability === 'UNKNOWN' && !s.actionVisible);
  const noKnownUi = !uiSamples.some(s => s.availability !== 'UNKNOWN' || s.actionVisible);
  const eligible = !conflict && uiAvailability === 'UNKNOWN' && unknownAfter && noKnownUi;
  const key = eligible ? createHash('sha256').update(JSON.stringify(['M5.4A_FINAL_DIAGNOSTIC', asin, available.evidenceAt])).digest('hex') : null;
  return { naturalPostResponses, restockCandidate: key && !seen.includes(key) ? { type: 'RESTOCK_CANDIDATE', id: key, basis: 'PRIVATE_AVAILABLE_WHILE_UI_UNKNOWN', priorUnavailableEstablished: false, actionable: false, mode: 'DRY_RUN' } : null, candidateDuplicate: !!key && seen.includes(key), candidateSuppressedReason: key ? seen.includes(key) ? 'DUPLICATE' : null : conflict ? 'EVIDENCE_CONFLICT' : !available ? 'NO_QUALIFIED_PRIVATE_SIGNAL' : uiAvailability === 'AVAILABLE' ? 'UI_AGREEMENT_ONLY' : 'NO_UNKNOWN_UI_AFTER_SIGNAL', privateUiAgreement: !conflict && !!available && uiAvailability === 'AVAILABLE', restockConfirmed: false, actionable: false };
}
