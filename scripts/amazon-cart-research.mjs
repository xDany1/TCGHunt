import { mkdirSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { cartResearchConfig } from './amazon-cart-research-policy.mjs';
import { emptyCartResult, runCartResearch } from './amazon-cart-research-runtime.mjs';

/** Exclusive durable local fence, not a claim of retailer-side idempotency. Never automatically reset. */
export function claimResearchOperation(operationId, directory = 'work/m5.7-operations') {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(operationId)) throw new Error('OPERATION_ID_REQUIRED');
  mkdirSync(directory, { recursive: true }); const file = resolve(directory, createHash('sha256').update(operationId).digest('hex') + '.json');
  let fd;
  try { fd = openSync(file, 'wx'); }
  catch (error) { if (error?.code === 'EEXIST') throw new Error('OPERATION_ALREADY_CONSUMED'); throw new Error('OPERATION_FENCE_FAILED'); }
  try { writeFileSync(fd, JSON.stringify({ operationId, mode: 'CART_RESEARCH', status: 'CONSUMED_BEFORE_BROWSER', automaticRetry: false }) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let config;
  try { config = cartResearchConfig(process.env, process.argv.slice(2)); }
  catch (error) { console.log(JSON.stringify({ ...emptyCartResult(), reason: error.message })); process.exitCode = 1; }
  if (config) {
    const clock = { now: () => Date.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
    const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    let result;
    try { const { chromium } = await import('playwright-core'); result = await runCartResearch(config, chromium, clock, claimResearchOperation, controller.signal); }
    catch { result = { ...emptyCartResult(config), status: 'BLOCKED', reason: 'RUNTIME_IMPORT_OR_STARTUP_FAILED' }; }
    finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    mkdirSync('outputs', { recursive: true });
    // Preserve the first result for each operation as well as the requested latest summary.
    const perOperation = `outputs/M5_7_CART_${config.operationId}.json`;
    try { writeFileSync(perOperation, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); } catch { /* Never overwrite an earlier operation record. */ }
    const resultPath = 'outputs/M5_7N_CART_CORRELATION_RESULT.json'; // All thirteen prior runs remain immutable.
    writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, reason: result.reason, cartConfirmed: result.cartConfirmed, cartMutationCount: result.cartMutationCount, backendTransportFeasibility: result.backendTransportFeasibility, result: resultPath }));
    if (!result.cartConfirmed) process.exitCode = 1;
  }
}
