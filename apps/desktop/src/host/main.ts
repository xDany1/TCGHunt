import { app, BrowserWindow, ipcMain, protocol, session, shell, utilityProcess, powerMonitor } from 'electron';
import type { UtilityProcess } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { COMMANDS } from '@ptcg/contracts';
import type { Command, Inputs, Reply, ObservationView } from '@ptcg/contracts';
import { approvedSource } from '../coordinator/policy.js';
import { APP_URL, CSP, WEB_PREFERENCES, IpcGuard } from './security.js';

declare const __M4_TESTING__: boolean;
protocol.registerSchemesAsPrivileged([{ scheme: 'astra', privileges: { standard: true, secure: true } }]);
export async function boot(options: { readonly fixtureMode?: boolean; readonly show?: boolean; readonly testExternalOpen?: (url: string) => void; } = {}) {
  const fixtureMode = typeof __M4_TESTING__ !== 'undefined' && __M4_TESTING__ && options.fixtureMode === true;
  app.setName('Astra Alto');
  // Host-only validation override; there is no path/config import command in the renderer bridge.
  const override = process.env['ASTRA_ALTO_DATA_DIR'];
  if (override && !isAbsolute(override)) throw new Error('INVALID_DATA_DIRECTORY');
  const userData = override ? resolve(override) : join(app.getPath('appData'), 'Astra Alto');
  mkdirSync(userData, { recursive: true }); app.setPath('userData', userData);
  if (process.env['ASTRA_SOFTWARE_RENDERING'] === '1') app.disableHardwareAcceleration();
  if (['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some(flag => app.commandLine.hasSwitch(flag))) throw new Error('DEBUG_INTERFACE_DENIED');
  if (!app.requestSingleInstanceLock()) { app.quit(); throw new Error('ANOTHER_INSTANCE'); }
  await app.whenReady();
  const partition = session.fromPartition('astra-ui');
  const assets: Record<string, { file: string; type: string; }> = {
    '/index.html': { file: 'index.html', type: 'text/html' }, '/renderer.js': { file: 'renderer.js', type: 'text/javascript' }, '/renderer.css': { file: 'renderer.css', type: 'text/css' }
  };
  partition.protocol.handle('astra', request => {
    const url = new URL(request.url); const asset = assets[url.pathname];
    if (url.host !== 'app' || url.search || !asset || request.method !== 'GET') return new Response('', { status: 403 });
    return new Response(readFileSync(join(__dirname, asset.file)), { headers: { 'content-type': asset.type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
  });
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest((details, callback) => { callback({ cancel: !['astra://app/index.html', 'astra://app/renderer.js', 'astra://app/renderer.css'].includes(details.url) }); });
  const win = new BrowserWindow({
    title: 'Astra Alto — DRY RUN', width: 1320, height: 900, minWidth: 980, minHeight: 680, backgroundColor: '#f3f5f7', show: false,
    autoHideMenuBar: true, webPreferences: { ...WEB_PREFERENCES, session: partition, preload: join(__dirname, 'preload.cjs') }
  });
  win.removeMenu(); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  const workerRoot = __dirname.endsWith('.asar') ? __dirname + '.unpacked' : __dirname;
  const child: UtilityProcess = utilityProcess.fork(join(workerRoot, 'coordinator.cjs'), [], { serviceName: 'Astra Alto Coordinator', stdio: 'pipe' });
  const pending = new Map<string, { resolve(reply: Reply<unknown>): void; timer: ReturnType<typeof setTimeout>; }>();
  let ready = false; let coordinatorFailure = 'STARTING'; let quitting = false;
  let stoppedResolve: (() => void) | null = null;
  const diagnostics: { code: string; at: number; }[] = [];
  const record = (code: string) => { diagnostics.push({ code: /^[A-Z_]{1,60}$/.test(code) ? code : 'LOCAL_FAILURE', at: Date.now() }); if (diagnostics.length > 100) diagnostics.shift(); try { writeFileSync(join(userData, 'diagnostics.json'), JSON.stringify(diagnostics)); } catch { /* Diagnostics cannot grant write access or interrupt safe shutdown. */ } };
  child.stdout?.on('data', () => { /* Raw child output never crosses into renderer diagnostics. */ });
  child.stderr?.on('data', () => record('COORDINATOR_STDERR'));
  child.on('message', (message: { version: number; type: string; id?: string; reply?: Reply<unknown>; code?: string; }) => {
    if (message.version !== 1) return;
    if (message.type === 'READY') { ready = true; coordinatorFailure = ''; }
    if (message.type === 'FAILED') { coordinatorFailure = message.code ?? 'DATABASE_UNAVAILABLE'; record(coordinatorFailure); }
    if (message.type === 'DIAGNOSTIC') record(message.code ?? 'LOCAL_FAILURE');
    if (message.type === 'STOPPED') stoppedResolve?.();
    if (message.type === 'REPLY' && message.id && message.reply) { const job = pending.get(message.id); if (job) { clearTimeout(job.timer); pending.delete(message.id); job.resolve(message.reply); } }
  });
  child.on('exit', () => {
    ready = false; coordinatorFailure = 'COORDINATOR_STOPPED'; stoppedResolve?.();
    for (const job of pending.values()) { clearTimeout(job.timer); job.resolve({ ok: false, code: coordinatorFailure, diagnosticId: randomUUID() }); } pending.clear();
  });
  child.postMessage({ version: 1, type: 'START', databasePath: join(userData, 'astra.sqlite'), networkEnabled: !fixtureMode && process.env['SHOPIFY_LIVE_VALIDATION_ENABLED'] === '1' && process.env['SHOPIFY_STORE_DOMAIN'] === 'kantocards.com', amazonNetworkEnabled: !fixtureMode && process.env['AMAZON_BROWSER_MONITORING_ENABLED'] === '1', fixtureMode });
  const request = (command: Command, input: unknown): Promise<Reply<unknown>> => new Promise(resolveReply => {
    if (!ready || quitting || pending.size >= 16) { resolveReply({ ok: false, code: quitting ? 'SHUTTING_DOWN' : coordinatorFailure || 'BUSY', diagnosticId: randomUUID() }); return; }
    const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); resolveReply({ ok: false, code: 'COORDINATOR_TIMEOUT', diagnosticId: id }); }, command === 'runMonitorNow' ? 125000 : 18000);
    pending.set(id, { resolve: resolveReply, timer }); child.postMessage({ version: 1, type: 'REQUEST', id, command, input });
  });
  const guard = new IpcGuard();
  for (const name of COMMANDS) ipcMain.handle(`astra:v1:${name}`, async (event, payload: unknown): Promise<Reply<unknown>> => {
    try {
      const input = guard.validate(name, payload, { trustedContents: event.sender === win.webContents, topFrame: event.senderFrame === win.webContents.mainFrame, frameUrl: event.senderFrame?.url ?? null }, Date.now());
      if (name === 'openProduct') {
        const reply = await request('getProductHistory', input);
        if (!reply.ok) return reply;
        const product = (reply.value as readonly ObservationView[])[0];
        if (!product?.source) return { ok: false, code: 'PRODUCT_NOT_FOUND', diagnosticId: randomUUID() };
        const source = approvedSource(product.source);
        if (__M4_TESTING__ && options.testExternalOpen) options.testExternalOpen(source.canonical);
        else await shell.openExternal(source.canonical, { activate: true });
        return { ok: true, value: { id: (input as Inputs['openProduct']).offerId } };
      }
      return await request(name, input);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : 'COMMAND_REJECTED';
      record(code); return { ok: false, code, diagnosticId: randomUUID() };
    }
  });
  async function shutdown() {
    if (quitting) return; quitting = true;
    child.postMessage({ version: 1, type: 'STOP' });
    await new Promise<void>(resolveStop => { const timer = setTimeout(() => { record('FORCED_COORDINATOR_STOP'); child.kill(); resolveStop(); }, 20000); stoppedResolve = () => { clearTimeout(timer); resolveStop(); }; });
    for (const name of COMMANDS) ipcMain.removeHandler(`astra:v1:${name}`);
    child.kill(); if (!win.isDestroyed()) win.destroy(); app.quit();
  }
  win.on('close', event => { if (!quitting) { event.preventDefault(); void shutdown(); } });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void shutdown(); } });
  app.on('second-instance', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
  powerMonitor.on('suspend', () => child.postMessage({ version: 1, type: 'SUSPEND' }));
  powerMonitor.on('resume', () => child.postMessage({ version: 1, type: 'RESUME' }));
  win.webContents.on('render-process-gone', () => { record('RENDERER_STOPPED'); child.postMessage({ version: 1, type: 'SUSPEND' }); });
  try { await win.loadURL(APP_URL); } catch { record('RENDERER_LOAD_FAILED'); await shutdown(); throw new Error('RENDERER_LOAD_FAILED'); }
  if (options.show !== false) win.show();
  return { win, child, shutdown, diagnostics, databasePath: join(userData, 'astra.sqlite') };
}
if (require.main === module) void boot().catch(() => { console.error('ASTRA_STARTUP_FAILED'); app.exit(1); });
