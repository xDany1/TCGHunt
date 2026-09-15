import { inspectSemantic } from './amazon-cart-research-evidence.mjs';
import { nativeFormBodyPolicy } from './amazon-cart-native-form.mjs';
export const CART_TARGETS = Object.freeze({ ADD_TO_CART: 'B0GYVHLP4L', RESERVE_PREORDER: 'B0HG3C5JK6' });
export const CART_HOSTS = Object.freeze(['www.amazon.com.mx', 'amazon.com.mx']);
export function cartResearchConfig(env, args) {
  if (env.AMAZON_CART_RESEARCH_ENABLED !== '1') throw new Error('CART_RESEARCH_DISABLED');
  if (['1', 'true'].includes(env.DRY_RUN?.toLowerCase())) throw new Error('DRY_RUN_FORBIDS_RESEARCH');
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--asin', '--action', '--operation-id', '--max-price-mxn', '--expected-seller', '--ack-unknown-evidence'].includes(args[i]) || flags.has(args[i]) || !args[i + 1]) throw new Error('INVALID_RESEARCH_ARGUMENTS');
    flags.set(args[i], args[i + 1]);
  }
  const action = flags.get('--action'); const asin = flags.get('--asin'); const operationId = flags.get('--operation-id');
  if (!Object.hasOwn(CART_TARGETS, action) || CART_TARGETS[action] !== asin) throw new Error('TARGET_ACTION_MISMATCH');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(operationId ?? '')) throw new Error('OPERATION_ID_REQUIRED');
  const amount = flags.get('--max-price-mxn'); const seller = flags.get('--expected-seller');
  if (!/^\d{1,6}\.\d{2}$/.test(amount ?? '') || Number(amount) <= 0 || !/^(?:amazon-retail-mx|[A-Z0-9]{1,30})$/.test(seller ?? '')) throw new Error('RESEARCH_EXPECTATIONS_REQUIRED');
  if (flags.has('--ack-unknown-evidence') && flags.get('--ack-unknown-evidence') !== 'YES_RESEARCH_ONLY') throw new Error('INVALID_UNKNOWN_ACK');
  return Object.freeze({ mode: 'CART_RESEARCH', researchOnly: true, researchOptIn: true, asin, action, operationId, quantity: 1, marketplace: 'MX', purchaseMode: action === 'ADD_TO_CART' ? 'IMMEDIATE' : 'PREORDER', maxPriceMinor: String(BigInt(amount.replace('.', ''))), expectedSeller: seller, acknowledgeUnknown: flags.get('--ack-unknown-evidence') === 'YES_RESEARCH_ONLY', url: `https://www.amazon.com.mx/dp/${asin}` });
}
export function qualifyCartPage(config, page) {
  const reasons = [];
  if (page.marketplace !== 'MX' || page.asin !== config.asin || !page.identityMatched) reasons.push('PRODUCT_CONTEXT_MISMATCH');
  if (page.challenge || page.accessDenied) reasons.push('CHALLENGE_OR_ACCESS_DENIED');
  if (page.availability !== 'AVAILABLE') reasons.push('NOT_AVAILABLE');
  if (page.purchaseMode !== config.purchaseMode) reasons.push('PURCHASE_MODE_MISMATCH');
  if (!page.actionVisible || page.actionType !== config.action) reasons.push('ACTION_NOT_QUALIFIED');
  if (page.quantity !== 1) reasons.push('QUANTITY_NOT_ONE');
  if (page.cartCount !== 0 || page.itemPresent) reasons.push('EMPTY_CART_NOT_ESTABLISHED');
  if (page.price) {
    if (page.price.currency !== 'MXN' || !/^\d+$/.test(page.price.minor) || BigInt(page.price.minor) > BigInt(config.maxPriceMinor)) reasons.push('PRICE_GUARD_FAILED');
  } else if (!config.acknowledgeUnknown) reasons.push('PRICE_UNKNOWN_ACK_REQUIRED');
  if (page.sellerId) { if (page.sellerId !== config.expectedSeller) reasons.push('SELLER_GUARD_FAILED'); }
  else if (!config.acknowledgeUnknown) reasons.push('SELLER_UNKNOWN_ACK_REQUIRED');
  return { qualified: reasons.length === 0, reasons, researchOnly: true, purchaseReady: false, unknownEvidenceAcknowledged: config.acknowledgeUnknown && (!page.price || !page.sellerId) };
}
export function confirmCart(config, before, after) {
  return !after.challenge && !after.accessDenied && before.cartCount === 0 && after.cartCount === 1 && after.itemAsins?.length === 1 && after.itemAsins[0] === config.asin;
}
const forbidden = /checkout|\/buy(?:\/|$)|buy[\W_]*now|one[\W_]*click|place[\W_]*order|submit[\W_]*order|payment|purchase|gift[\W_]*card|\/orders?(?:\/|$)|signin|signout|login|logout|account|address|captcha|\/ap\//i;
const mutate = /(?:add|set|update|delete|remove|submit|create|reserve|quantity)/i;
const cartAction = /^\/(?:gp\/add-to-cart\/html|gp\/aws\/cart\/add\.html|cart\/add-to-cart)(?:\/ref=[^/]+)?\/?$/i;
// One observed opaque suffix; never persist or reconstruct it. No arbitrary /cart/* authority.
const qualifiedCartAction = /^\/cart\/add-to-cart\/[A-Za-z0-9._~-]{1,200}\/?$/;
export const strictNativeCartPath = path => qualifiedCartAction.test(path) || /^\/cart\/add-to-cart\/ref=[^/]+\/?$/i.test(path);
const cartRead = /^\/(?:cart(?:\/smart-wagon)?|gp\/cart\/view\.html)(?:\/ref=[^/]+)?\/?$/i;
const safeAux = /^\/(?:hz\/aj\/|gp\/aod\/ajax\/|gp\/product\/ajax\/)/i;
function decode(value) { try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(value); if (next === value) break; value = next; } return value; } catch { return ''; } }
function semanticText(value) {
  // Decode valid escape runs even when an unrelated opaque token contains a bare percent.
  for (let i = 0; i < 3; i++) value = value.replace(/(?:%[a-f0-9]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } });
  return value;
}
export function researchHostClass(host) {
  return CART_HOSTS.includes(host) ? 'APPROVED_AMAZON_MX' : host.endsWith('.amazon.com.mx') ? 'AMAZON_MX_SUBDOMAIN_UNAPPROVED' : host === 'm.media-amazon.com' ? 'AMAZON_STATIC' : 'OTHER_HOST';
}
/** Routing only. No fetch/replay, parameter changes or token construction. */
export function createCartRouting(config) {
  let phase = 'BASELINE'; let stopped = false; let cartRequests = 0; let documents = 0; let allowed = 0; let qualifiedImmediate = false; let clickInitiated = false;
  let actionState = 'BASELINE';
  const captureObservation = () => Object.freeze({ phase, actionState, clickInitiated });
  const counts = { blocked: 0, allowed: 0, cartRequests: 0, forbiddenRequestsBlocked: 0 };
  return {
    counts, phase: () => phase, captureObservation, halt() { stopped = true; actionState = 'TERMINATED'; },
    completeBaseline() { if (actionState !== 'BASELINE' || stopped) throw new Error('BASELINE_ALREADY_COMPLETED'); actionState = 'BASELINE_COMPLETE'; },
    arm(evidence, claimedOperationId) {
      if (phase !== 'BASELINE' || stopped) throw new Error('ACTION_ALREADY_CONSUMED');
      qualifiedImmediate = config.researchOptIn === true && config.marketplace === 'MX' && config.asin === CART_TARGETS.ADD_TO_CART && config.action === 'ADD_TO_CART' && config.purchaseMode === 'IMMEDIATE' && config.quantity === 1 && /^[a-zA-Z0-9_-]{8,80}$/.test(config.operationId ?? '') && claimedOperationId === config.operationId && !!evidence && qualifyCartPage(config, evidence).qualified;
      phase = 'ACTION'; actionState = 'ACTION_ARMED';
    },
    beginBrowserClick() { if (phase !== 'ACTION' || stopped || clickInitiated) throw new Error('CLICK_ALREADY_CONSUMED'); clickInitiated = true; actionState = 'ACTION_ACTIVE'; },
    beginConfirmation() { if (actionState !== 'ACTION_ACTIVE' || stopped) throw new Error('CONFIRMATION_NOT_ACTIVE'); actionState = 'POST_ACTION_CONFIRMATION'; },
    decide({ url, method, type, main, body = '', contentType = 'application/x-www-form-urlencoded', redirect = false, observation = captureObservation(), nativeEvidence = null }) {
      const phase = observation.phase;
      let qualifiedCartPathMatch = false; const forbiddenLocations = []; let nativeFormDiagnostics;
      const deny = reason => { counts.blocked++; if (reason === 'FORBIDDEN_PATH') counts.forbiddenRequestsBlocked++; return { allowed: false, routingDecision: 'BLOCK', reason, phase, qualifiedCartPathMatch, forbiddenLocations, ...(nativeFormDiagnostics ? { nativeForm: nativeFormDiagnostics } : {}) }; };
      if (stopped) return deny('HALTED');
      let u; try { u = new URL(url); } catch { return deny('INVALID_URL'); }
      const path = decode(u.pathname); const semantics = semanticText(`${u.search} ${body}`);
      qualifiedCartPathMatch = qualifiedCartAction.test(path);
      const nativePath = strictNativeCartPath(path); const nativePost = nativePath && method === 'POST' && type === 'document';
      if (nativePost) qualifiedCartPathMatch = true;
      let nativeBody = nativePost ? nativeFormBodyPolicy(body, contentType, config.asin) : null;
      // Presence-only relaxation is evaluated only after every independent native
      // eligibility check, including the unchanged request-body identity invariant.
      const qualifiedInteraction = nativePost && nativeBody.bodyContextMatched && !!path && u.protocol === 'https:' && !u.username && !u.password && !u.port && !forbidden.test(path) && !forbidden.test(semanticText(u.search)) && main && allowed < 240 && u.hostname === 'www.amazon.com.mx' && config.mode === 'CART_RESEARCH' && config.researchOnly && qualifiedImmediate && phase === 'ACTION' && observation.clickInitiated && !redirect && !cartRequests && nativeEvidence?.qualified && nativeEvidence.trustedClick && nativeEvidence.trustedSubmit && nativeEvidence.productBound && ![...new URLSearchParams(u.search).keys()].some(key => /^(?:asin|quantity|offerlistingid|merchantid)/i.test(key));
      if (qualifiedInteraction) nativeBody = nativeFormBodyPolicy(body, contentType, config.asin, true);
      if (nativeBody) nativeFormDiagnostics = { sensitiveMaterialPresent: nativeBody.sensitiveMaterialPresent, forbiddenOperation: nativeBody.forbiddenOperation, forbiddenOperationSources: nativeBody.forbiddenOperationSources, bodyQualificationReason: nativeBody.reason, fieldClassifications: nativeBody.fieldClassifications, forbiddenFieldCategories: nativeBody.forbiddenFieldCategories, legacyNameMatchClasses: nativeBody.legacyNameMatchClasses, forbiddenFieldPresent: nativeBody.forbiddenFieldPresent, forbiddenFieldActivated: nativeBody.forbiddenFieldActivated, forbiddenFieldStates: nativeBody.forbiddenFieldStates };
      if (!path) return deny('INVALID_PATH_ENCODING');
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return deny('URL_AUTHORITY_POLICY');
      if (forbidden.test(path)) forbiddenLocations.push('PATH');
      if (forbidden.test(semanticText(u.search))) forbiddenLocations.push('QUERY');
      if (nativePost ? nativeBody.forbiddenOperation : forbidden.test(semanticText(body))) forbiddenLocations.push('BODY');
      if (!nativePost && !forbiddenLocations.length && forbidden.test(semantics)) forbiddenLocations.push('COMBINED_QUERY_BODY');
      if (forbiddenLocations.length) return deny('FORBIDDEN_PATH');
      if (!main) return deny('SUBFRAME_OR_WORKER');
      if (allowed >= 240) return deny('REQUEST_BUDGET');
      if (nativePost) {
        qualifiedCartPathMatch = true;
        if (u.hostname !== 'www.amazon.com.mx' || config.mode !== 'CART_RESEARCH' || !config.researchOnly || !qualifiedImmediate || phase !== 'ACTION' || !observation.clickInitiated || redirect || cartRequests) return deny('NATIVE_CART_ACTION_FENCE');
        if (!nativeEvidence?.qualified || !nativeEvidence.trustedClick || !nativeEvidence.trustedSubmit || !nativeEvidence.productBound) return deny('NATIVE_SUBMIT_CAUSALITY_REQUIRED');
        if ([...new URLSearchParams(u.search).keys()].some(key => /^(?:asin|quantity|offerlistingid|merchantid)/i.test(key))) return deny('NATIVE_FORM_QUERY_CONTEXT');
        if (!nativeBody.valid) return deny(nativeBody.reason);
        cartRequests++; counts.cartRequests = cartRequests; allowed++; counts.allowed = allowed;
        return { allowed: true, routingDecision: 'ALLOW_NATURAL_CART_ACTION', phase, classification: 'CART_CANDIDATE', qualifiedCartPathMatch, forbiddenLocations, nativeForm: { sensitiveMaterialPresent: nativeBody.sensitiveMaterialPresent, forbiddenOperation: false, causalEnvelopeQualified: true, fieldClassifications: nativeBody.fieldClassifications, forbiddenFieldCategories: nativeBody.forbiddenFieldCategories, legacyNameMatchClasses: nativeBody.legacyNameMatchClasses, forbiddenFieldPresent: nativeBody.forbiddenFieldPresent, forbiddenFieldActivated: nativeBody.forbiddenFieldActivated, forbiddenFieldStates: nativeBody.forbiddenFieldStates } };
      }
      const firstParty = CART_HOSTS.includes(u.hostname); let classification = 'UI_AUXILIARY'; const qualifiedPath = qualifiedCartAction.test(path);
      if (firstParty && (cartAction.test(path) || qualifiedPath)) {
        if (config.mode !== 'CART_RESEARCH' || !config.researchOnly || phase !== 'ACTION' || cartRequests || redirect || !['GET', 'POST'].includes(method) || !['document', 'xhr', 'fetch'].includes(type)) return deny('CART_ACTION_FENCE');
        const observedGet = method === 'GET' && type === 'xhr' && u.hostname === 'www.amazon.com.mx';
        if (qualifiedPath && (!qualifiedImmediate || !observation.clickInitiated || !(observedGet || method === 'POST' && ['xhr', 'document'].includes(type)))) return deny('QUALIFIED_CART_CONTEXT_REQUIRED');
        // Only one unambiguous selected product/quantity. Tokens are left untouched in the real browser request.
        const inspectableForm = Buffer.byteLength(body) <= 65536 && contentType.includes('application/x-www-form-urlencoded');
        const projected = inspectSemantic(body, contentType, config.asin);
        if (projected.fields.some(f => f.fieldName === 'asin' && f.value !== config.asin || f.fieldName === 'quantity' && f.value !== 1)) return deny('CART_REQUEST_CONTEXT_MISMATCH');
        const params = new URLSearchParams(u.search); if (inspectableForm) for (const [k, v] of new URLSearchParams(body)) params.append(k, v);
        const asins = [...params].filter(([k]) => /^asin(?:\.1)?$/i.test(k)).map(([, v]) => v);
        const quantities = [...params].filter(([k]) => /^quantity(?:\.1)?$/i.test(k)).map(([, v]) => v);
        if (asins.length > 1 || asins.some(v => v !== config.asin) || quantities.length > 1 || quantities.some(v => v !== '1') || !qualifiedPath && inspectableForm && (asins.length !== 1 || quantities.length !== 1) || [...params.keys()].some(k => /^(?:asin|quantity)/i.test(k) && !/^(?:asin|quantity)(?:\.1)?$/i.test(k) || /^(?:offeringid|offerlistingid)\.(?!1$)/i.test(k))) return deny('CART_REQUEST_CONTEXT_UNKNOWN');
        cartRequests++; counts.cartRequests = cartRequests; classification = 'CART_CANDIDATE';
      } else if (firstParty && cartRead.test(path)) {
        if (phase !== 'ACTION' || method !== 'GET' || mutate.test(semantics)) return deny('CART_READ_POLICY');
      } else if (/(?:cart|basket|handle[\W_]*buy[\W_]*box)/i.test(path + ' ' + semantics) || mutate.test(path)) return deny('UNKNOWN_MUTATION_PATH');
      else if (type === 'document') {
        const match = /^\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})(?:\/|$)/i.exec(path);
        if (!firstParty || method !== 'GET' || match?.[1] !== config.asin || documents >= 2 || documents && !redirect || phase !== 'BASELINE') return deny('DOCUMENT_POLICY');
        documents++;
      } else if (['script', 'stylesheet', 'image', 'font'].includes(type)) {
        if (method !== 'GET' || !(firstParty || u.hostname === 'm.media-amazon.com' && /^\/images\/(?:I|S)\//.test(path))) return deny('ASSET_POLICY');
      } else if (firstParty && ['xhr', 'fetch'].includes(type) && method === 'GET' && safeAux.test(path) && !mutate.test(semantics)) { /* Narrow naturally generated read traffic. */ }
      else return deny('UNQUALIFIED_BACKGROUND_REQUEST');
      allowed++; counts.allowed = allowed; return { allowed: true, routingDecision: classification === 'CART_CANDIDATE' ? qualifiedPath ? 'ALLOW_NATURAL_CART_ACTION' : 'ALLOW_NATURAL_ACTION' : 'ALLOW_RESOURCE', phase, classification, qualifiedCartPathMatch, forbiddenLocations };
    }
  };
}
