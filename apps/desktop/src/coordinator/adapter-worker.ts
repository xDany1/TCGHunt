import { parentPort, workerData } from 'node:worker_threads';
import { normalizeKantocardsCapture } from '@ptcg/adapters';
import type { AuthorizedEvidence } from '@ptcg/adapters';
import { KantocardsTransport, ValidationClock } from '../../../../scripts/shopify-live-transport.mjs';
import { approvedSource, DELIVERY } from './policy.js';
import { resolveMonitorSource } from './policy.js';
import { createAmazonMonitorReader } from '../../../../scripts/amazon-monitor-transport.mjs';
declare const __M4_TESTING__: boolean;
const fixtureMode = typeof __M4_TESTING__ !== 'undefined' && __M4_TESTING__ && workerData.fixtureMode === true;
const clock = new ValidationClock();
const transport = workerData.networkEnabled === true && !fixtureMode ? new KantocardsTransport({ enabled: true, domain: 'kantocards.com', clock }) : null;
let busy = false;
const amazon = createAmazonMonitorReader({ enabled: workerData.amazonNetworkEnabled === true && !fixtureMode, clock });
parentPort?.on('message', async (message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'CANCEL') { amazon.cancel(); return; }
  if (!message || typeof message !== 'object' || !('id' in message) || !('url' in message) || typeof message.id !== 'string' || typeof message.url !== 'string') return;
  const requestId = message.id;
  if (busy) { parentPort?.postMessage({ id: requestId, ok: false, code: 'QUEUE_FULL' }); return; }
  busy = true;
  try {
    if (resolveMonitorSource(message.url).family === 'Amazon') {
      const evidence = await amazon.read(message.url); parentPort?.postMessage({ id: requestId, ok: true, evidence }); return;
    }
    const source = approvedSource(message.url);
    let evidence: AuthorizedEvidence;
    if (__M4_TESTING__ && fixtureMode) {
      const at = clock.now();
      const body = JSON.stringify({
        data: {
          shop: { name: 'Kantocards', primaryDomain: { host: 'kantocards.com' } }, product: {
            id: `gid://shopify/Product/${source.product}`, handle: source.handle, title: '<img src=x onerror="window.hostileExecuted=true"> AUTHORED FIXTURE', productType: '',
            variants: { nodes: [{ id: `gid://shopify/ProductVariant/${source.variant}`, title: 'Authored fixture', sku: null, selectedOptions: [], price: { amount: '95.00', currencyCode: 'MXN' }, availableForSale: true, currentlyNotInStock: false }], pageInfo: { hasNextPage: false } }
          }
        }
      });
      const normalized = normalizeKantocardsCapture(body, { method: 'POST', host: 'kantocards.com', endpoint: '/api/2026-07/graphql.json', status: 200, apiVersion: '2026-07', contentType: 'application/json', startedAt: at, receivedAt: at, bytes: Buffer.byteLength(body), deprecated: false, handle: source.handle }, source.canonical, DELIVERY);
      const o = normalized.observation;
      const { evidenceBasis: _basis, ...catalog } = normalized.catalog;
      const synthetic = <T extends { readonly evidence: object; }>(field: T) => ({ ...field, evidence: { ...field.evidence, rights: 'SYNTHETIC' as const, sourceVersion: 'm4-authored-desktop-test-only' } });
      evidence = { observation: { ...o, identity: synthetic(o.identity), seller: synthetic(o.seller), fulfilledBy: synthetic(o.fulfilledBy), unitPrice: synthetic(o.unitPrice), stock: synthetic(o.stock), availableQuantity: synthetic(o.availableQuantity), shipping: synthetic(o.shipping), additionalTax: synthetic(o.additionalTax), purchaseLimit: synthetic(o.purchaseLimit) }, catalog };
    } else {
      if (!transport) throw Object.assign(new Error('NETWORK_DISABLED'), { code: 'NETWORK_DISABLED' });
      const capture = await transport.capture(source.handle);
      evidence = normalizeKantocardsCapture(capture.body, capture.metadata, source.canonical, DELIVERY);
    }
    parentPort?.postMessage({ id: requestId, ok: true, evidence });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : 'READ_FAILED';
    parentPort?.postMessage({ id: requestId, ok: false, code });
  } finally { busy = false; }
});
