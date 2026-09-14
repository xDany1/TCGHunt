import type { AmazonRenderedCapture } from '@ptcg/adapters';
import { pTarget, P_NOW } from './amazon-providers.js';

// Authored projections exercise the live transport contract; these are not real Amazon captures.
export function rendered(patch: Partial<AmazonRenderedCapture> = {}): AmazonRenderedCapture {
  return {
    target: pTarget, captureId: 'authored-rendered-contract', capturedAt: P_NOW + 1, status: 200,
    challenge: false, accessDenied: false, missingProduct: false, asins: [pTarget.asin], titles: ['Authored product'],
    prices: ['MX$ 1,295.01'], currencies: ['MXN'], availability: ['Disponible'], sellerIds: ['AUTHOREDSELLER'], sellers: ['Authored third party'], shippers: ['Amazon'], selectedAsin: true, offerRegion: true, ...patch
  };
}
