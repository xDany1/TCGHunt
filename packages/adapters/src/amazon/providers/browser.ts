import { freeze } from '@ptcg/core';
import { ReadFailure } from '@ptcg/application';
import type { ReadContext } from '@ptcg/application';
import { amazonAsin } from '../url.js';
import { captureFailure, identifier, label, source } from './contract.js';
import { parseAmazonRendered } from './rendered.js';
import type { AmazonRenderedTransport } from './rendered.js';
import type { AmazonCapture, AmazonMoneyEvidence, AmazonOfferEvidence, AmazonProvider, AmazonProviderResult, AmazonTarget } from './contract.js';

export interface AmazonHtmlCapture extends AmazonCapture { readonly html: string; readonly status: number; }
/** Data-only local page capture. No Page, navigation, selectors with actions, session or browser authority. */
export interface AmazonLocalHtmlTransport { readonly mode: 'FIXTURE_ONLY'; readPage(target: AmazonTarget, context: ReadContext): Promise<AmazonHtmlCapture>; }
interface Element { tag: string; attrs: Record<string, string>; text: string; children: Element[]; }
function decode(s: string): string {
  return s.replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, v => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[v] ?? v).replace(/\s+/g, ' ').trim();
}
/** Bounded authored-HTML grammar, not a general HTML5 parser or a production Amazon layout claim. */
function parse(html: string): Element {
  if (html.length > 100_000) throw new ReadFailure('BODY_TOO_LARGE');
  const root: Element = { tag: 'root', attrs: {}, text: '', children: [] }; const stack = [root];
  const inert = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style|template)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const tokens = inert.match(/<[^>]*>|[^<]+/g) ?? []; if (tokens.length > 5000) throw new ReadFailure('BODY_TOO_LARGE');
  for (const token of tokens) {
    const parent = stack.at(-1); if (!parent) throw new ReadFailure('SCHEMA_MISMATCH');
    if (!token.startsWith('<')) { for (const e of stack) e.text += ` ${token}`; continue; }
    if (/^<!doctype html>$/i.test(token)) continue;
    const end = /^<\/([a-z][a-z0-9-]*)\s*>$/i.exec(token);
    if (end) { if (parent.tag !== end[1]?.toLowerCase() || stack.length === 1) throw new ReadFailure('SCHEMA_MISMATCH'); stack.pop(); continue; }
    const start = /^<([a-z][a-z0-9-]*)([^]*?)\/?\s*>$/i.exec(token); if (!start?.[1]) throw new ReadFailure('SCHEMA_MISMATCH');
    const attrs: Record<string, string> = {}; let rest = start[2] ?? '';
    while (rest.trim()) {
      const a = /^\s+([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/.exec(rest);
      if (!a?.[1]) throw new ReadFailure('SCHEMA_MISMATCH'); const key = a[1].toLowerCase();
      if (Object.hasOwn(attrs, key)) throw new ReadFailure('SCHEMA_MISMATCH'); attrs[key] = decode(a[2] ?? a[3] ?? ''); rest = rest.slice(a[0].length);
    }
    const e: Element = { tag: start[1].toLowerCase(), attrs, text: '', children: [] }; parent.children.push(e);
    if (!['meta', 'link', 'input', 'br', 'hr', 'img'].includes(e.tag) && !token.endsWith('/>')) stack.push(e);
    if (stack.length > 32) throw new ReadFailure('BODY_TOO_LARGE');
  }
  if (stack.length !== 1) throw new ReadFailure('SCHEMA_MISMATCH'); return root;
}
function descendants(e: Element): Element[] { return [e, ...e.children.flatMap(descendants)]; }
function fields(e: Element, key: string): string[] {
  return descendants(e).filter(n => n.attrs['itemprop'] === key || n.attrs['aria-label'] === key).map(n => decode(n.attrs['content'] ?? n.attrs['value'] ?? n.text)).filter(Boolean);
}
function unique(values: readonly string[]): string | null { const set = [...new Set(values)]; return set.length === 1 ? label(set[0]) : null; }
function field(e: Element, key: string): string | null { return unique(fields(e, key)); }
function money(e: Element, key: string): AmazonMoneyEvidence | null {
  const amount = field(e, key); const currency = field(e, 'priceCurrency'); return amount && currency ? { amount, currency } : null;
}
function offer(e: Element): AmazonOfferEvidence {
  const shipper = field(e, 'Ships from'); const seller = field(e, 'Sold by');
  return {
    externalOfferId: identifier(field(e, 'Offer ID')), sellerId: identifier(field(e, 'Seller ID')), sellerDisplayName: seller,
    fulfillment: shipper === 'Amazon' ? 'AMAZON' : shipper && seller && shipper === seller ? 'MERCHANT' : 'UNKNOWN',
    condition: field(e, 'Condition'), subCondition: field(e, 'Subcondition'), price: money(e, 'price'), shipping: money(e, 'Shipping price'),
    availability: field(e, 'availability'), featured: field(e, 'Featured offer') === 'true' ? true : field(e, 'Featured offer') === 'false' ? false : null,
    buttonPresent: descendants(e).some(n => n.tag === 'button' && n.attrs['aria-label'] === 'Purchase option')
  };
}
export class AmazonBrowserProvider implements AmazonProvider {
  readonly kind = 'BROWSER'; readonly mode: 'FIXTURE_ONLY' | 'AUTHORIZED_VALIDATION';
  constructor(private readonly transport: AmazonLocalHtmlTransport | AmazonRenderedTransport) {
    if (!['FIXTURE_ONLY', 'AUTHORIZED_VALIDATION'].includes(transport.mode)) throw new ReadFailure('NETWORK_DISABLED'); this.mode = transport.mode;
  }
  async read(target: AmazonTarget, context: ReadContext): Promise<AmazonProviderResult> {
    if ('readRendered' in this.transport) return parseAmazonRendered(await this.transport.readRendered(target, context), target, context);
    const c = await this.transport.readPage(target, context); const failure = captureFailure(c, target, context); if (failure) return failure;
    // Challenge detection precedes status interpretation and product extraction, and never executes page content.
    if (/captcha|robot check|verify you are human/i.test(c.html)) return { category: 'CHALLENGE_DETECTED' };
    if (c.status === 401 || c.status === 403 || /access denied/i.test(c.html)) return { category: 'ACCESS_DENIED' };
    if (c.status === 404) return { category: 'PAGE_UNAVAILABLE' };
    if (c.status !== 200) return { category: 'NETWORK_ERROR' };
    let page: Element; try { page = parse(c.html); } catch (error) { if (error instanceof ReadFailure && error.code === 'SCHEMA_MISMATCH') return { category: 'PARSER_MISMATCH' }; throw error; }
    const asin = field(page, 'ASIN'); if (!asin) return { category: 'PARSER_MISMATCH' };
    if (amazonAsin(asin) !== target.asin) throw new ReadFailure('CONTEXT_MISMATCH');
    const regions = descendants(page).filter(e => e.attrs['aria-label'] === 'Offer');
    const offers = regions.map(offer); const title = field(page, 'Product title'); const rawType = field(page, 'ASIN type');
    const asinType = rawType === 'STANDARD' || rawType === 'VARIATION_CHILD' || rawType === 'VARIATION_PARENT' ? rawType : 'UNKNOWN';
    const incomplete = !title || offers.some(o => !o.sellerId || !o.price || !o.availability || o.fulfillment === 'UNKNOWN');
    return freeze({
      category: incomplete ? 'CONTENT_INCOMPLETE' : 'OBSERVED', evidence: {
        marketplace: 'MX', asin, productUrl: target.url, title, asinType, childAsins: fields(page, 'Child ASIN').map(amazonAsin), offers,
        coverage: offers.length ? 'OBSERVED_SUBSET' : field(page, 'Offer status') === 'No offers' ? 'NO_OFFERS_IN_RESPONSE' : 'UNKNOWN', source: source(c, this.kind)
      }
    });
  }
}
