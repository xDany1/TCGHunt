import { freeze } from '@ptcg/core';
import type { ReadContext } from '@ptcg/application';
import { ReadFailure } from '@ptcg/application';
import { amazonAsin } from '../url.js';
import { identifier, label, AMAZON_RETAIL_MX_SELLER } from './contract.js';
import { amazonContextIdentity, compareAmazonContext } from './context.js';
import type { AmazonContextDiagnostic } from './context.js';
import type { AmazonMoneyEvidence, AmazonProviderResult, AmazonTarget, AmazonProviderEvidence } from './contract.js';

export const AMAZON_RENDERED_VERSION = 'amazon-rendered-m5.4-v4';
/** Bounded text/attribute projection from an ephemeral page, never raw HTML or browser state. */
export interface AmazonRenderedCapture {
  /** v1 captures omit these fields; absence is not action evidence. */
  readonly actions?: readonly string[]; readonly releaseTexts?: readonly string[];
  /** Bounded visible offer-region diagnostics; never promoted to seller identity. */
  readonly offerTexts?: readonly string[];
  /** Label/value statements from independently labeled visible DOM rows, never combined-row positions. */
  readonly sellerStatements?: readonly string[]; readonly shipperStatements?: readonly string[];
  readonly target: AmazonTarget; readonly captureId: string; readonly capturedAt: number; readonly status: number;
  readonly challenge: boolean; readonly accessDenied: boolean; readonly missingProduct: boolean;
  readonly asins: readonly string[]; readonly titles: readonly string[]; readonly prices: readonly string[]; readonly currencies: readonly string[];
  readonly availability: readonly string[]; readonly sellerIds: readonly string[]; readonly sellers: readonly string[]; readonly shippers: readonly string[];
  readonly selectedAsin: boolean; readonly offerRegion: boolean;
}
export interface AmazonRenderedTransport {
  readonly mode: 'AUTHORIZED_VALIDATION'; readRendered(target: AmazonTarget, context: ReadContext): Promise<AmazonRenderedCapture>;
}
function unique(a: readonly string[]): string | null { const values = [...new Set(a.map(label).filter((x): x is string => x !== null))]; return values.length === 1 ? values[0] ?? null : null; }
export function amazonDisplayMoney(values: readonly string[], currencies: readonly string[]): AmazonMoneyEvidence | null {
  const parsed = values.map(s => {
    // es-MX/en-MX decimal dot and explicit grouped thousands only. No list-price selection here.
    const value = s.trim().replace(/^(?:MX\$|MXN|\$)\s*/, '').replace(/\s*MXN$/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(value)) return null;
    return value.replaceAll(',', '');
  });
  const amount = parsed.every(v => v !== null) ? unique(parsed.filter((v): v is string => v !== null)) : null;
  const currency = amazonRenderedCurrency(values, currencies);
  return amount && currency === 'MXN' ? { amount, currency } : null;
}
/** Currency resolution is distinct from successful amount parsing. No host/$ default. */
export function amazonRenderedCurrency(values: readonly string[], currencies: readonly string[]): 'MXN' | null {
  const explicitMxn = values.some(s => /MXN|MX\$/.test(s));
  return unique([...currencies, ...(explicitMxn ? ['MXN'] : [])]) === 'MXN' ? 'MXN' : null;
}
function stock(values: readonly string[]): string | null {
  const states = values.map(v => {
    const text = v.trim().toLocaleLowerCase('es-MX').replace(/\.$/, '');
    if (/^(?:disponible|disponible para envío inmediato|en stock|in stock)$/.test(text)) return 'In stock';
    if (/^(?:no disponible|no disponible por el momento|actualmente no disponible|currently unavailable|temporalmente agotado)$/.test(text)) return 'Currently unavailable';
    return null;
  });
  return states.length && states.every(s => s !== null) ? unique(states.filter(s => s !== null)) : null;
}
const commerceText = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ');
export function amazonCommerce(availability: readonly string[], actions: readonly string[], releaseTexts: readonly string[]): NonNullable<AmazonProviderEvidence['productState']> {
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const releases = [...availability, ...releaseTexts].map(commerceText).filter(s => /saldrá a la venta/i.test(s));
  // Parse complete date clauses, not the trailing marketing sentence. Every clause must agree.
  const clauses = releases.flatMap(s => s.split(/(?=Este producto saldrá a la venta)/i).filter(Boolean));
  const dates = clauses.map(s => {
    const match = /^Este producto saldrá a la venta el (\d{1,2}) de ([a-z]+) de (\d{4})\.(?:\s|$)/i.exec(s.trim());
    if (!match) return null;
    const day = Number(match[1]); const month = months.indexOf((match[2] ?? '').toLowerCase()) + 1; const year = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
    return year >= 2000 && year <= 2100 && day >= 1 && day <= days ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
  });
  const releaseDate = dates.length && dates.every(d => d !== null) ? unique(dates.filter(d => d !== null)) : null;
  const preorder = actions.some(s => /^(?:reserva ahora|reservar ahora|pre-?order now)$/i.test(commerceText(s)));
  const immediate = actions.some(s => /^(?:agregar al carrito|añadir a la cesta|comprar ahora|add to cart|buy now)$/i.test(commerceText(s)));
  const purchaseMode = (preorder || releases.length > 0) && immediate ? 'UNKNOWN' : preorder || releases.length > 0 ? 'PREORDER' : immediate ? 'IMMEDIATE' : 'UNKNOWN';
  const ordinary = availability.map(commerceText).filter(s => !releases.includes(s)); const explicit = stock(ordinary);
  // Enabled preorder action and a valid release statement together establish an open preorder.
  const state = explicit === 'Currently unavailable' ? 'UNAVAILABLE' : explicit === 'In stock' ? 'AVAILABLE' : ordinary.length === 0 && preorder && releaseDate && !immediate ? 'AVAILABLE' : 'UNKNOWN';
  return freeze({ availability: state, purchaseMode, releaseDate, rawAvailability: availability, rawActions: actions, rawRelease: releaseTexts });
}
export function parseAmazonRendered(c: AmazonRenderedCapture, target: AmazonTarget, context: ReadContext): AmazonProviderResult {
  if (context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
  const expected = amazonContextIdentity({ ...target, provider: 'BROWSER', storeKey: 'amazon-mx-m5.4-browser-live' });
  const observed = amazonContextIdentity({ ...c.target, provider: 'BROWSER', storeKey: 'amazon-mx-m5.4-browser-live' });
  const diagnostic: AmazonContextDiagnostic = {
    stage: 'RENDERED_CAPTURE', expected, observed, comparison: {
      ...compareAmazonContext(expected, observed), deliveryScopeMatch: c.target.deliveryScope === target.deliveryScope && target.deliveryScope === context.deliveryScope && context.currency === 'MXN',
      chronologyMatch: [context.now, context.deadlineAt, c.capturedAt].every(t => Number.isSafeInteger(t) && t >= 0) && c.capturedAt >= context.now && c.capturedAt < context.deadlineAt,
      captureIdValid: identifier(c.captureId) !== null
    }
  };
  // Preserve legacy parser-only fixtures (including unsupported-host identity negatives).
  // URL aliases are accepted only for a fully matching Amazon MX product context;
  // actual navigation and desktop admission retain their separate strict host/store guards.
  const stableMatch = Object.values(compareAmazonContext(expected, observed)).every(Boolean);
  if (!diagnostic.comparison.captureIdValid || !diagnostic.comparison.chronologyMatch || !diagnostic.comparison.deliveryScopeMatch ||
    !diagnostic.comparison.productIdMatch || c.target.marketplace !== target.marketplace || (c.target.url !== target.url && !stableMatch)) throw Object.assign(new ReadFailure('CONTEXT_MISMATCH'), { contextDiagnostic: diagnostic });
  if (c.challenge) return { category: 'CHALLENGE_DETECTED' };
  if (c.accessDenied || c.status === 401 || c.status === 403) return { category: 'ACCESS_DENIED' };
  if (c.missingProduct || c.status === 404) return { category: 'PAGE_UNAVAILABLE' };
  if (c.status !== 200) return { category: 'NETWORK_ERROR' };
  const lists = [c.asins, c.titles, c.prices, c.currencies, c.availability, c.sellerIds, c.sellers, c.shippers, c.actions ?? [], c.releaseTexts ?? [], c.offerTexts ?? [], c.sellerStatements ?? [], c.shipperStatements ?? []];
  if (lists.some(a => a.length > 20 || a.some(s => typeof s !== 'string' || s.length > 500))) throw new ReadFailure('BODY_TOO_LARGE');
  const rawAsin = unique(c.asins); const title = unique(c.titles);
  if (!rawAsin || !/^[A-Z0-9]{10}$/i.test(rawAsin) || amazonAsin(rawAsin) !== expected.canonicalProductId || !title) return { category: 'PARSER_MISMATCH' };
  const asin = amazonAsin(rawAsin);
  const statedSellers = (c.sellerStatements ?? []).map(s => /^(?:Vendedor|Vendido por|Sold by):\s+([^:/]+)$/i.exec(commerceText(s))?.[1] ?? null);
  const statedShippers = (c.shipperStatements ?? []).map(s => /^(?:Remitente|Enviado por|Enviado desde|Se envía desde|Ships from|Dispatches from):\s+([^:/]+)$/i.exec(commerceText(s))?.[1] ?? null);
  const seller = unique([...c.sellers, ...statedSellers.filter((s): s is string => s !== null)]);
  const shipper = unique([...c.shippers, ...statedShippers.filter((s): s is string => s !== null)]);
  const externalSellerId = identifier(unique(c.sellerIds));
  const explicitRetail = c.offerRegion && c.selectedAsin && target.marketplace === 'MX' && c.target.marketplace === 'MX' && /^https:\/\/(?:www\.)?amazon\.com\.mx\//.test(target.url) &&
    statedSellers.length > 0 && statedSellers.every(s => s !== null && commerceText(s) === 'Amazon México') && seller !== null && commerceText(seller) === 'Amazon México' && (!c.sellerIds.length || externalSellerId !== null);
  const sellerId = explicitRetail ? AMAZON_RETAIL_MX_SELLER : externalSellerId === AMAZON_RETAIL_MX_SELLER ? null : externalSellerId;
  const sellerIdentityBasis = explicitRetail ? 'EXPLICIT_AMAZON_RETAIL_MX_SELLER' : sellerId ? 'EXTERNAL_SELLER_ID' : 'UNKNOWN';
  const fulfillment = shipper && /^(?:Amazon|Amazon México|Amazon.com.mx)$/i.test(shipper) ? 'AMAZON' : shipper && seller && shipper === seller ? 'MERCHANT' : 'UNKNOWN';
  const price = amazonDisplayMoney(c.prices, c.currencies);
  const commerce = c.actions !== undefined ? amazonCommerce(c.availability, c.actions, c.releaseTexts ?? []) : undefined;
  const availability = commerce ? commerce.availability === 'AVAILABLE' ? 'In stock' : commerce.availability === 'UNAVAILABLE' ? 'Currently unavailable' : null : stock(c.availability);
  return freeze({
    category: sellerId && price && availability && fulfillment !== 'UNKNOWN' ? 'OBSERVED' : 'CONTENT_INCOMPLETE', evidence: {
      marketplace: 'MX', asin, title, productUrl: target.url, asinType: 'UNKNOWN', childAsins: [], selectedAsin: c.selectedAsin,
      renderedEvidence: { priceTexts: c.prices, currencyCodes: c.currencies, sellerDisplays: c.sellers, shipperDisplays: c.shippers, sellerStatements: c.sellerStatements ?? [], shipperStatements: c.shipperStatements ?? [], externalSellerIds: c.sellerIds, sellerIdentityBasis },
      ...(commerce ? { productState: commerce } : {}),
      offers: c.offerRegion ? [{ externalOfferId: null, sellerId, sellerDisplayName: seller, fulfillment, condition: null, subCondition: null, price, shipping: null, availability, featured: null, buttonPresent: null }] : [],
      coverage: c.offerRegion ? 'OBSERVED_SUBSET' : 'UNKNOWN', source: { provider: 'BROWSER', fixtureId: c.captureId, sourceObservedAt: c.capturedAt, capturedAt: c.capturedAt, parserVersion: AMAZON_RENDERED_VERSION, confidence: 'LIVE_CAPTURE' }
    }
  });
}
