import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AuthorizedEvidence, AmazonProviderResult } from '@ptcg/adapters';
import { COMMANDS, validateCommand } from '@ptcg/contracts';
import type { Command } from '@ptcg/contracts';
import { DesktopService } from './service.js';

const parent = (process as unknown as { parentPort: { on(name: 'message', listener: (event: { data: unknown; }) => void): void; postMessage(message: unknown): void; }; }).parentPort;
let service: DesktopService | null = null; let worker: Worker | null = null; let timer: ReturnType<typeof setInterval> | null = null;
const reads = new Map<string, { resolve(value: AuthorizedEvidence | AmazonProviderResult): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout>; }>();
const base = Date.now(); const elapsed = performance.now(); const now = () => base + Math.floor(performance.now() - elapsed);
function failure(error: unknown): string { return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : 'LOCAL_FAILURE'; }
parent.on('message', ({ data }) => { void handle(data); });
async function handle(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const message = data as Record<string, unknown>;
  if (message['version'] !== 1) return;
  if (message['type'] === 'START' && !service && typeof message['databasePath'] === 'string') {
    try {
      worker = new Worker(join(__dirname, 'adapter-worker.cjs'), { workerData: { networkEnabled: message['networkEnabled'] === true, amazonNetworkEnabled: message['amazonNetworkEnabled'] === true, fixtureMode: message['fixtureMode'] === true } });
      worker.on('message', (response: { id: string; ok: boolean; evidence: AuthorizedEvidence | AmazonProviderResult; code: string; }) => {
        const job = reads.get(response.id); if (!job) return; clearTimeout(job.timeout); reads.delete(response.id);
        if (response.ok) job.resolve(response.evidence); else job.reject(Object.assign(new Error('READ_FAILED'), { code: response.code }));
      });
      worker.on('error', () => { for (const job of reads.values()) { clearTimeout(job.timeout); job.reject(Object.assign(new Error('WORKER_FAILED'), { code: 'TRANSIENT_FAILURE' })); } reads.clear(); });
      const read = (url: string): Promise<AuthorizedEvidence | AmazonProviderResult> => new Promise((resolve, reject) => {
        if (reads.size) { reject(Object.assign(new Error('BUSY'), { code: 'QUEUE_FULL' })); return; }
        const id = randomUUID(); const timeout = setTimeout(() => { service?.suspend(); worker?.postMessage({ type: 'CANCEL' }); reject(Object.assign(new Error('DEADLINE'), { code: 'DEADLINE_EXCEEDED' })); }, 120000);
        reads.set(id, { resolve, reject, timeout }); worker?.postMessage({ id, url });
      });
      service = new DesktopService({
        databasePath: message['databasePath'], now, newId: randomUUID, networkEnabled: message['networkEnabled'] === true, amazonNetworkEnabled: message['amazonNetworkEnabled'] === true, fixtureMode: message['fixtureMode'] === true,
        cancelRead: () => worker?.postMessage({ type: 'CANCEL' }),
        read: async url => { const e = await read(url); if (!('observation' in e)) throw new Error('WRONG_PROVIDER'); return e; },
        readAmazon: async url => { const e = await read(url); if (!('category' in e)) throw new Error('WRONG_PROVIDER'); return e; }
      });
      service.start();
      timer = setInterval(() => { void service?.tick().catch(() => parent.postMessage({ version: 1, type: 'DIAGNOSTIC', code: 'SCHEDULER_FAILED' })); }, 1000);
      parent.postMessage({ version: 1, type: 'READY', versions: process.versions, sqlite: service.store.desktop.runtimeInfo() });
    } catch (error) { parent.postMessage({ version: 1, type: 'FAILED', code: failure(error) }); }
    return;
  }
  if (message['type'] === 'STOP') {
    if (timer) clearInterval(timer);
    try { await service?.stop(); } catch { /* Report failure without exposing driver detail. */ parent.postMessage({ version: 1, type: 'DIAGNOSTIC', code: 'SHUTDOWN_STORAGE_FAILURE' }); }
    await worker?.terminate(); parent.postMessage({ version: 1, type: 'STOPPED' }); return;
  }
  if (message['type'] === 'SUSPEND') { service?.suspend(); return; }
  if (message['type'] === 'RESUME') { service?.resume(); return; }
  if (message['type'] !== 'REQUEST' || typeof message['id'] !== 'string' || typeof message['command'] !== 'string') return;
  try {
    if (!service) throw Object.assign(new Error('DATABASE_UNAVAILABLE'), { code: 'DATABASE_UNAVAILABLE' });
    const name = message['command']; if (!COMMANDS.some(c => c === name)) throw Object.assign(new Error('UNKNOWN_COMMAND'), { code: 'UNKNOWN_COMMAND' });
    const input = validateCommand(name, message['input']);
    const value = await service.dispatch(name as Command, input);
    parent.postMessage({ version: 1, type: 'REPLY', id: message['id'], reply: { ok: true, value } });
  } catch (error) { parent.postMessage({ version: 1, type: 'REPLY', id: message['id'], reply: { ok: false, code: failure(error), diagnosticId: randomUUID() } }); }
}
