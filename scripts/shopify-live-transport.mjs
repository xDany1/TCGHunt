import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { KANTOCARDS_HANDLES, kantocardsUrl } from '@ptcg/adapters';

export const LIVE_QUERY = `query M35Product($handle: String!) {
  shop { name primaryDomain { host } }
  product(handle: $handle) { id handle title productType
    variants(first: 50) { nodes { id title sku selectedOptions { name value }
      price { amount currencyCode } availableForSale currentlyNotInStock
    } pageInfo { hasNextPage } }
  }
}`;
export const APPROVED_HANDLES = KANTOCARDS_HANDLES;
export function approvedProductUrl(input) {
  try { return kantocardsUrl(input); } catch { throw new LiveReadError('POLICY_DENIED'); }
}
export class LiveReadError extends Error {
  constructor(code, causeCode = null) { super(code); this.code = code; this.causeCode = causeCode; }
}
export function publicAddress(address) {
  // Resolve IPv4 only; fail closed for all special/private/non-unicast IPv4 space.
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127
    || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
export class ValidationClock {
  #epoch = Date.now();
  #start = performance.now();
  now() { return this.#epoch + Math.floor(performance.now() - this.#start); }
  async waitUntil(at, cancellation) {
    while (this.now() < at) {
      if (cancellation?.aborted) throw new LiveReadError('CANCELLED');
      await delay(Math.min(100, at - this.now()));
    }
  }
}
/** Local opt-in tool, not a generic HTTP client. One host, endpoint, fixed query and two handles. */
export class KantocardsTransport {
  #count = 0;
  #lastStart = -Infinity;
  #stopped = false;
  #enabled;
  #clock;
  #summaries = [];
  constructor({ enabled, domain, clock }) {
    if (enabled !== true || domain !== 'kantocards.com') throw new LiveReadError('NETWORK_DISABLED');
    this.#enabled = enabled; this.#clock = clock;
  }
  get attempts() { return this.#count; }
  summaries() { return this.#summaries.map(s => ({ ...s })); }
  async capture(handle) {
    if (!this.#enabled || this.#stopped || this.#count >= 6 || !APPROVED_HANDLES.includes(handle)) throw new LiveReadError('POLICY_DENIED');
    await this.#clock.waitUntil(this.#lastStart + 5000);
    const startedAt = this.#clock.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const addresses = await Promise.race([
        lookup('kantocards.com', { all: true, family: 4 }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new LiveReadError('DEADLINE_EXCEEDED')), { once: true }))
      ]);
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new LiveReadError('POLICY_DENIED');
      const pinned = addresses[0].address;
      if (controller.signal.aborted) throw new LiveReadError('DEADLINE_EXCEEDED');
      this.#count++; this.#lastStart = this.#clock.now();
      const payload = JSON.stringify({ query: LIVE_QUERY, variables: { handle } });
      const response = await new Promise((resolve, reject) => {
        const req = request({
          protocol: 'https:', hostname: 'kantocards.com', port: 443, path: '/api/2026-07/graphql.json', method: 'POST',
          servername: 'kantocards.com', rejectUnauthorized: true, agent: false, family: 4, signal: controller.signal,
          lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address: pinned, family: 4 }]) : callback(null, pinned, 4),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'AstraAlto-M3.5-ReadOnlyValidation/1', 'Content-Length': Buffer.byteLength(payload) }
        }, res => {
          const status = res.statusCode ?? 0;
          const safeHeader = (name, pattern) => typeof res.headers[name] === 'string' && pattern.test(res.headers[name]) ? res.headers[name] : null;
          const metadata = {
            sequence: this.#count, method: 'POST', host: 'kantocards.com', endpoint: '/api/2026-07/graphql.json', handle, startedAt, status,
            contentType: safeHeader('content-type', /^application\/json(?:\s*;\s*charset=utf-8)?$/i), apiVersion: safeHeader('x-shopify-api-version', /^\d{4}-\d{2}$/), retryAfter: safeHeader('retry-after', /^\d{1,8}$/), age: safeHeader('age', /^\d{1,8}$/),
            deprecated: res.headers['x-shopify-api-deprecated-reason'] !== undefined, rateMetadataPresent: res.headers['x-shopify-shop-api-call-limit'] !== undefined
          };
          this.#summaries.push(metadata);
          if (status !== 200) { res.destroy(); reject(new LiveReadError(status === 401 ? 'AUTH_REQUIRED' : status === 403 || status === 430 ? 'BLOCKED' : status === 429 ? 'RATE_LIMITED' : status >= 300 && status < 400 ? 'REDIRECT_DENIED' : 'HTTP_FAILURE')); return; }
          if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(metadata.contentType ?? '') || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); reject(new LiveReadError('CONTENT_TYPE')); return; }
          const chunks = []; let bytes = 0;
          res.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) res.destroy(new LiveReadError('BODY_TOO_LARGE')); else chunks.push(chunk); });
          res.on('error', reject);
          res.on('end', () => { metadata.bytes = bytes; metadata.receivedAt = this.#clock.now(); resolve({ body: Buffer.concat(chunks).toString('utf8'), metadata }); });
        });
        req.on('error', reject); req.end(payload);
      });
      const parsed = JSON.parse(response.body);
      const sensitive = value => {
        if (typeof value === 'string') return /\bBearer\s+\S+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(value);
        if (value === null || typeof value !== 'object') return false;
        return Object.entries(value).some(([key, item]) => /^(customers?|email|phone|addresses?|access_token|authorization|cookies?)$/i.test(key) || sensitive(item));
      };
      if (sensitive(parsed)) throw new LiveReadError('SENSITIVE_RESPONSE');
      if (parsed.errors?.length) {
        this.#stopped = true;
        const codes = parsed.errors.map(e => e.extensions?.code).filter(c => typeof c === 'string' && /^[A-Z_]{1,80}$/.test(c));
        response.metadata.graphqlErrorCodes = codes;
        throw new LiveReadError(codes.includes('ACCESS_DENIED') ? 'AUTH_REQUIRED' : codes.includes('THROTTLED') ? 'RATE_LIMITED' : 'SCHEMA_MISMATCH');
      }
      return response;
    } catch (error) {
      this.#stopped = true;
      if (error instanceof LiveReadError) throw error;
      const causeCode = typeof error.code === 'string' && /^[A-Z_]{2,60}$/.test(error.code) ? error.code : null;
      throw new LiveReadError(controller.signal.aborted ? 'DEADLINE_EXCEEDED' : error instanceof SyntaxError ? 'MALFORMED_RESPONSE' : 'NETWORK_UNAVAILABLE', causeCode);
    } finally { clearTimeout(timer); }
  }
}
