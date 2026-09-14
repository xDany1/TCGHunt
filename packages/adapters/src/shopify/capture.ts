import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { ReadFailure } from '@ptcg/application';
import { freeze } from '@ptcg/core';
import type { ReadClock, ReadContext } from '@ptcg/application';
import { SHOPIFY_API_VERSION } from './config.js';
import type { ShopifyFixtureConfig } from './config.js';

export const PRODUCT_QUERY = `query M3Product($handle: String!) {
  product(handle: $handle) { id handle title productType
    variants(first: 50) { nodes { id title sku selectedOptions { name value }
      price { amount currencyCode } availableForSale quantityAvailable currentlyNotInStock
      identity: metafield(namespace: "astra_m3", key: "commercial_identity") { value }
    } pageInfo { hasNextPage } }
  }
}`;
export interface FixtureResponse {
  readonly status: number; readonly body: string; readonly contentType?: string;
  readonly location?: string; readonly retryAfterMs?: number; readonly ageMs?: number; readonly latencyMs?: number;
  readonly failure?: 'TRANSIENT_FAILURE' | 'BLOCKED';
}
export interface ProductReadRequest {
  readonly endpoint: string; readonly method: 'POST'; readonly query: typeof PRODUCT_QUERY;
  readonly handle: string; readonly userAgent: 'AstraAlto-M3-Fixture/1'; readonly context: ReadContext;
}
/** Only an in-memory fixture source is shipped. No HTTP client, sockets, or arbitrary URL transport. */
export class ShopifyFixtureTransport {
  readonly mode = 'FIXTURE_ONLY';
  #cursor = 0;
  private readonly responses: readonly FixtureResponse[];
  constructor(private readonly clock: ReadClock, responses: readonly FixtureResponse[]) { this.responses = freeze(responses.map(r => ({ ...r }))); }
  get attempts(): number { return this.#cursor; }
  async read(request: ProductReadRequest): Promise<FixtureResponse> {
    if (request.method !== 'POST' || request.query !== PRODUCT_QUERY || !/^https:\/\/[a-z0-9.-]+\.invalid\/api\/2026-07\/graphql\.json$/.test(request.endpoint)) throw new ReadFailure('NETWORK_DISABLED');
    if (request.context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
    const response = this.responses[this.#cursor++];
    if (!response) throw new ReadFailure('LISTING_NOT_FOUND');
    const latency = response.latencyMs ?? 0;
    if (!Number.isSafeInteger(latency) || latency < 0) throw new ReadFailure('MALFORMED_RESPONSE');
    await this.clock.waitUntil(Math.min(this.clock.now() + latency, request.context.deadlineAt), request.context.cancellation);
    if (request.context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
    if (this.clock.now() >= request.context.deadlineAt) throw new ReadFailure('DEADLINE_EXCEEDED');
    if (response.failure) throw new ReadFailure(response.failure);
    return response;
  }
}
export interface Capture { readonly id: string; readonly body: string; readonly capturedAt: number; readonly receivedAt: number; readonly sourceObservedAt: number; }
export function statusFailure(status: number, retryAfterMs = 0): ReadFailure | null {
  if (status >= 300 && status < 400) return new ReadFailure('REDIRECT_DENIED');
  if (status === 401) return new ReadFailure('AUTH_REQUIRED');
  if (status === 403 || status === 430) return new ReadFailure('BLOCKED');
  if (status === 429) return new ReadFailure('RATE_LIMITED', Math.max(1_000, retryAfterMs));
  if ([500, 502, 503, 504].includes(status)) return new ReadFailure('TRANSIENT_FAILURE', retryAfterMs);
  if (status === 404) return new ReadFailure('LISTING_NOT_FOUND');
  return status === 200 ? null : new ReadFailure('MALFORMED_RESPONSE');
}
export async function captureProduct(config: ShopifyFixtureConfig, handle: string, context: ReadContext, clock: ReadClock, transport: ShopifyFixtureTransport): Promise<Capture> {
  if (config.mode !== 'FIXTURE_ONLY' || transport.mode !== 'FIXTURE_ONLY') throw new ReadFailure('NETWORK_DISABLED');
  const capturedAt = clock.now();
  const response = await transport.read({ endpoint: `https://${config.canonicalDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`, method: 'POST', query: PRODUCT_QUERY, handle, userAgent: 'AstraAlto-M3-Fixture/1', context });
  if (!Number.isInteger(response.status) || !Number.isSafeInteger(response.retryAfterMs ?? 0) || (response.retryAfterMs ?? 0) < 0 || (response.retryAfterMs ?? 0) > 86_400_000) throw new ReadFailure('MALFORMED_RESPONSE');
  const failure = statusFailure(response.status, response.retryAfterMs);
  if (failure) throw failure;
  if (response.location) throw new ReadFailure('REDIRECT_DENIED');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.contentType ?? '')) throw new ReadFailure('CONTENT_TYPE');
  if (Buffer.byteLength(response.body, 'utf8') > 65_536) throw new ReadFailure('BODY_TOO_LARGE');
  const age = response.ageMs ?? 0;
  if (!Number.isSafeInteger(age) || age < 0 || age > capturedAt) throw new ReadFailure('MALFORMED_RESPONSE');
  const digest = createHash('sha256').update(JSON.stringify([config.storeId, context.operationId, capturedAt, response.body])).digest('hex');
  return { id: `capture:${digest}`, body: response.body, capturedAt, receivedAt: clock.now(), sourceObservedAt: capturedAt - age };
}
