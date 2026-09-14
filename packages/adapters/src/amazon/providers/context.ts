import { URL } from 'node:url';
import { amazonUrl } from '../url.js';

/** Safe diagnostic projection, never a URL, raw payload or reusable credential. */
export function amazonContextIdentity(input: { asin: string; url: string; marketplace: string; provider: string; storeKey: string; }) {
  let urlProductId: string | null = null;
  try { if (['amazon.com.mx', 'www.amazon.com.mx'].includes(new URL(input.url).hostname)) urlProductId = amazonUrl(input.url).asin; } catch { /* Invalid source remains unmatched. */ }
  return {
    family: urlProductId ? 'Amazon' : 'UNKNOWN',
    provider: ['BROWSER', 'BUSINESS_API'].includes(input.provider) ? input.provider : 'UNKNOWN',
    marketplace: /^[A-Z]{2}$/.test(input.marketplace) ? input.marketplace : 'UNKNOWN',
    storeKey: ['amazon-mx-m5.4-browser-live', 'amazon-mx-m5.2-fixtures'].includes(input.storeKey) ? input.storeKey : 'UNKNOWN',
    canonicalProductId: /^[A-Z0-9]{10}$/i.test(input.asin) ? input.asin.toUpperCase() : null, urlProductId
  };
}
export function compareAmazonContext(expected: ReturnType<typeof amazonContextIdentity>, observed: ReturnType<typeof amazonContextIdentity>) {
  return {
    familyMatch: expected.family === 'Amazon' && observed.family === 'Amazon',
    providerMatch: expected.provider === 'BROWSER' && observed.provider === expected.provider,
    storeMatch: expected.marketplace === 'MX' && observed.marketplace === expected.marketplace && expected.storeKey !== 'UNKNOWN' && observed.storeKey === expected.storeKey,
    productIdMatch: expected.canonicalProductId !== null && expected.canonicalProductId === observed.canonicalProductId,
    urlProductMatch: expected.urlProductId !== null && expected.urlProductId === expected.canonicalProductId && observed.urlProductId === observed.canonicalProductId
  };
}
export interface AmazonContextDiagnostic {
  readonly stage: 'RENDERED_CAPTURE' | 'MONITOR_PRODUCT';
  readonly expected: ReturnType<typeof amazonContextIdentity>; readonly observed: ReturnType<typeof amazonContextIdentity>;
  readonly comparison: ReturnType<typeof compareAmazonContext> & { readonly deliveryScopeMatch?: boolean; readonly captureIdValid?: boolean; readonly chronologyMatch?: boolean; };
}
