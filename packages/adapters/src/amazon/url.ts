import { URL } from 'node:url';
import { ReadFailure } from '@ptcg/application';

export function amazonAsin(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{10}$/i.test(value)) throw new ReadFailure('INVALID_URL');
  return value.toUpperCase();
}
/** Local locator normalization only. Short links require a network redirect and are unsupported. */
export function amazonUrl(input: string): { asin: string; canonical: string; } {
  if (typeof input !== 'string' || input.length > 2048 || /[\\\s]/.test(input)) throw new ReadFailure('INVALID_URL');
  if (/^[a-z0-9]{10}$/i.test(input)) {
    const asin = amazonAsin(input); return { asin, canonical: `https://www.amazon.com.mx/dp/${asin}` };
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new ReadFailure('INVALID_URL'); }
  if (url.protocol !== 'https:' || !['amazon.com.mx', 'www.amazon.com.mx', 'm.amazon.com.mx'].includes(url.hostname) || url.username || url.password || url.port) throw new ReadFailure('INVALID_URL');
  const match = /^\/(?:[^/]+\/)?dp\/([a-z0-9]{10})(?:\/ref=[^/]*)?\/?$/i.exec(url.pathname)
    ?? /^\/gp\/(?:product|aw\/d)\/([a-z0-9]{10})(?:\/ref=[^/]*)?\/?$/i.exec(url.pathname);
  if (!match) throw new ReadFailure('INVALID_URL');
  const asin = amazonAsin(match[1]);
  // Offer/seller query selection is not implemented; never silently select another offer.
  if (['smid', 'm', 'seller', 'offerListingID', 'offerListingId', 'ASIN', 'asin'].some(key => url.searchParams.has(key))) throw new ReadFailure('CONTEXT_MISMATCH');
  return { asin, canonical: `https://www.amazon.com.mx/dp/${asin}` };
}
