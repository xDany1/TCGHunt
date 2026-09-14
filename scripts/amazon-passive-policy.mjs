import { AMAZON_BROWSER_CONTEXT, approvedAmazonUrl } from './amazon-browser-policy.mjs';

export const RECON_CONTEXT = Object.freeze({ ...AMAZON_BROWSER_CONTEXT, javaScriptEnabled: true });
export const RECON_WINDOW_MS = 8000;
export const RECON_SAMPLE_MS = 500;
const mx = ['amazon.com.mx', 'www.amazon.com.mx'];
const dangerous = /cart|basket|checkout|\/buy(?:\/|$)|handle[\W_]*buy[\W_]*box|buy[\W_]*now|buybox[\W_]*submit|reserve[\W_]*now|place[\W_]*order|submit[\W_]*order|payment|purchase|one[\W_]*click|signin|signout|login|logout|register|account|address[\W_]*(?:update|change|add)|captcha|validatecaptcha|\/ap\//i;
const telemetry = /(?:^|[\/_.-])(?:ads?|advertising|telemetry|analytics|metrics|counters?|beacon|tracking|impression|log|logs)(?:[\/_.-]|$)/i;
function decoded(value) { try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(value); if (next === value) break; value = next; } return value; } catch { return ''; } }
/** Classifies browser-originated requests only. Never constructs a request or alters its parameters. */
export function reconRouteDecision({ url, method, type, main, body = '' }, target) {
  let u; try { u = new URL(url); } catch { return { allowed: false, reason: 'INVALID_URL' }; }
  if (typeof body !== 'string' || body.length > 65536) return { allowed: false, reason: 'URL_OR_BODY_POLICY' };
  let semanticBody = body; try { semanticBody = JSON.stringify(JSON.parse(body)); } catch { /* Non-JSON retains its literal form only for deny classification. */ }
  const path = decoded(u.pathname); const semantics = decoded(`${u.search} ${semanticBody}`);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !path || body.length > 65536) return { allowed: false, reason: 'URL_OR_BODY_POLICY' };
  if (dangerous.test(path) || dangerous.test(semantics) || /(?:^|\/)orders?(?:\/|$)/i.test(path) || /(?:action|operation|command)["'\s:=]+(?:add|set|update|delete|remove|submit|place|create|buy|reserve)/i.test(semantics)) return { allowed: false, reason: 'MUTATION_OR_AUTH_DENIED' };
  if (type === 'document') {
    try { if (method === 'GET' && main && approvedAmazonUrl(url).asin === target.asin) return { allowed: true, classification: 'PRODUCT_DOCUMENT' }; } catch { /* No other navigation. */ }
    return { allowed: false, reason: 'NAVIGATION_DENIED' };
  }
  const asset = ['script', 'stylesheet', 'image', 'font'].includes(type);
  const firstParty = mx.includes(u.hostname);
  const staticAsset = u.hostname === 'm.media-amazon.com' && /^\/images\/(?:I|S)\//.test(path);
  if (asset && method === 'GET' && (firstParty || staticAsset)) return { allowed: true, classification: 'RENDERING_RESOURCE' };
  if (!firstParty || !main || !['xhr', 'fetch'].includes(type) || !['GET', 'POST'].includes(method)) return { allowed: false, reason: 'HOST_TYPE_OR_METHOD_DENIED' };
  // Unknown natural anonymous POSTs may render the page, but never supply trusted evidence.
  // There is no qualified read-POST endpoint contract in this milestone.
  return { allowed: true, classification: telemetry.test(path) ? 'IGNORED_TELEMETRY' : method === 'POST' ? 'UNCLASSIFIED' : 'NATURAL_GET' };
}
/** No URL, query, body, arbitrary subdomain or header reaches this aggregation. */
function auditHost(url) {
  try {
    const host = new URL(url).hostname;
    if ([...mx, 'm.media-amazon.com'].includes(host)) return { host, firstParty: true };
    if (host.endsWith('.amazon.com.mx')) return { host: 'AMAZON_MX_SUBDOMAIN_REDACTED', firstParty: true };
  } catch { /* Bounded unrecognized bucket. */ }
  return { host: 'OTHER_HOST_REDACTED', firstParty: false };
}
/** Counts routing separately from response inspection; caps natural traffic without retries. */
export function createReconRouting(target) {
  const counts = { networkRequestsObserved: 0, allowedRequests: 0, observedXhr: 0, observedFetch: 0, observedPost: 0, document: 0, script: 0, stylesheet: 0, image: 0, font: 0, xhr: 0, fetch: 0, post: 0, unclassifiedPost: 0, blocked: 0 };
  const limits = { document: 2, script: 120, stylesheet: 32, image: 40, font: 8, xhr: 24, fetch: 24 };
  const blockedGroups = new Map();
  function observed(input) { counts.networkRequestsObserved++; if (input.type === 'xhr') counts.observedXhr++; if (input.type === 'fetch') counts.observedFetch++; if (input.method === 'POST') counts.observedPost++; }
  function blocked(input, reason) {
    counts.blocked++;
    const { host, firstParty } = auditHost(input.url);
    const resourceType = ['document', 'script', 'stylesheet', 'image', 'font', 'xhr', 'fetch', 'websocket', 'other', 'ping'].includes(input.type) ? input.type : 'other';
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(input.method) ? input.method : 'OTHER';
    const key = JSON.stringify([host, resourceType, method, reason]);
    const row = blockedGroups.get(key) ?? { host, resourceType, method, reasonBlocked: reason, count: 0, firstParty, potentialDynamicResource: firstParty && ['script', 'xhr', 'fetch', 'document'].includes(resourceType) };
    row.count++; blockedGroups.set(key, row); return { allowed: false, reason };
  }
  let halted = false;
  return {
    counts, halt() { halted = true; },
    denyExtraNavigation(input) { observed(input); return blocked(input, 'EXTRA_NAVIGATION_DENIED'); },
    audit() { return { blocked: [...blockedGroups.values()], limits: { ...limits, post: 8, allowedRequests: 260 }, blockedFirstPartyDynamicCount: [...blockedGroups.values()].filter(r => r.potentialDynamicResource).reduce((sum, r) => sum + r.count, 0), inference: 'Potential dynamic-resource suppression only; required-for-offer status and causality are not established by request type.' }; },
    decide(input) {
      observed(input);
      const d = reconRouteDecision(input, target);
      const reason = !d.allowed ? d.reason : halted ? 'STOPPED' : counts.allowedRequests >= 260 ? 'TOTAL_ALLOWED_BUDGET' : counts[input.type] >= (limits[input.type] ?? 0) ? 'RESOURCE_BUDGET' : input.method === 'POST' && counts.post >= 8 ? 'POST_BUDGET' : null;
      if (reason) return blocked(input, reason);
      counts.allowedRequests++; counts[input.type]++; if (input.method === 'POST') { counts.post++; if (d.classification === 'UNCLASSIFIED') counts.unclassifiedPost++; } return d;
    }
  };
}
