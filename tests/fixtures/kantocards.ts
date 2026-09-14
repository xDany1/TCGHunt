import { readFileSync } from 'node:fs';
import { KANTOCARDS_HANDLES, normalizeKantocardsCapture } from '@ptcg/adapters';
// Exact sanitized user attestation; never a reconstruction of the absent response body.
export const liveSummary = JSON.parse(readFileSync('tests/fixtures/kantocards-live-summary.json', 'utf8')) as {
  status: string; reason: string; productId: string; variantIds: string[];
  requests: { sequence: number; method: string; host: string; endpoint: string; handle: string; startedAt: number; status: number; contentType: string; apiVersion: string; retryAfter: null; age: null; deprecated: boolean; rateMetadataPresent: boolean; bytes: number; receivedAt: number; }[];
};
export const START = 1788935699868;
export const DELIVERY = 'validation-destination-unknown';
export const primary = `https://kantocards.com/products/${KANTOCARDS_HANDLES[0]}`;
export const secondary = `https://kantocards.com/products/${KANTOCARDS_HANDLES[1]}`;

// Authored interface scaffolding ONLY. These prices, SKUs, titles and IDs are NOT Kantocards facts.
// The real summary proves parse success for the tokenless query, but does not disclose these values.
export function authoredCapture(second = false, at = START, variantPatch: Record<string, unknown> = {}, shopPatch: Record<string, unknown> = {}) {
  const handle = KANTOCARDS_HANDLES[second ? 1 : 0];
  const body = JSON.stringify({
    data: {
      shop: { name: 'Kantocards', primaryDomain: { host: 'kantocards.com' }, ...shopPatch },
      product: {
        id: `gid://shopify/Product/${second ? 102 : 101}`, handle, title: 'AUTHORED VALIDATION ONLY', productType: '',
        variants: {
          nodes: [{
            id: `gid://shopify/ProductVariant/${second ? 202 : 201}`, title: 'AUTHORED ONLY', sku: 'AUTHORED-ONLY', selectedOptions: [],
            price: { amount: '12.34', currencyCode: 'MXN' }, availableForSale: true, currentlyNotInStock: false, ...variantPatch
          }], pageInfo: { hasNextPage: false }
        }
      }
    }
  });
  const metadata = { ...liveSummary.requests[0], handle, startedAt: at, receivedAt: at + 222, bytes: Buffer.byteLength(body) };
  const source = second ? secondary : primary;
  return { body, metadata, source, normalized: () => normalizeKantocardsCapture(body, metadata, source, DELIVERY) };
}
