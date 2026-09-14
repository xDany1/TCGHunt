import { URL } from 'node:url';
import { ReadFailure } from '@ptcg/application';
import type { ShopifyFixtureConfig } from './config.js';

export function productUrl(input: string, config: ShopifyFixtureConfig): { readonly canonical: string; readonly handle: string; readonly variantId: string | null; } {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\\]/.test(input) || /%(?:2e|2f|5c)/i.test(input) || /\/\.\.?\//.test(input)) throw new ReadFailure('INVALID_URL');
  const authority = /^https:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (!authority || authority.toLowerCase() !== config.canonicalDomain) throw new ReadFailure('POLICY_DENIED');
  let url: URL;
  try { url = new URL(input); } catch { throw new ReadFailure('INVALID_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== config.canonicalDomain) throw new ReadFailure('POLICY_DENIED');
  const path = /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(url.pathname);
  if (!path?.[1] || path[1].length > 128) throw new ReadFailure('INVALID_URL');
  for (const key of url.searchParams.keys()) if (key !== 'variant' && !['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].includes(key)) throw new ReadFailure('INVALID_URL');
  const variants = url.searchParams.getAll('variant');
  if (variants.length > 1 || (variants.length === 1 && !/^[1-9][0-9]{0,19}$/.test(variants[0] ?? ''))) throw new ReadFailure('INVALID_URL');
  const variantId = variants[0] ?? null;
  return { canonical: `https://${config.canonicalDomain}/products/${path[1]}${variantId ? `?variant=${variantId}` : ''}`, handle: path[1], variantId };
}
