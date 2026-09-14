// Packaged utility-process experiment. This harness is absent from the deliverable app.
const { app, utilityProcess } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const live = process.env.ASTRA_M4_LIVE === '1'; const started = Date.now();
const report = { status: 'PARTIAL', runId: process.env.ASTRA_M4_RUN_ID, rendererTested: false, live, versions: process.versions, steps: [], measurements: [] };
const save = () => writeFileSync(process.env.ASTRA_M4_RESULT, JSON.stringify(report, null, 2));
const profile = process.env.ASTRA_ALTO_DATA_DIR; mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child; let stopResolve; let readyResolve; let readyReject; let count = 0; const pending = new Map();
const timeout = setTimeout(() => { report.reason = 'UTILITY_TIMEOUT'; save(); child?.kill(); app.exit(1); }, 45000);
function request(command, input) {
  return new Promise((resolve, reject) => { const id = String(++count); pending.set(id, { resolve, reject }); child.postMessage({ version: 1, type: 'REQUEST', id, command, input }); });
}
async function start() {
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const startedResolve = readyResolve; const startedReject = readyReject;
  child = utilityProcess.fork(join(__dirname + '.unpacked', 'coordinator.cjs'), [], { serviceName: 'M4 Packaged Coordinator Probe', stdio: 'pipe' });
  child.stdout.on('data', () => { }); child.stderr.on('data', () => { });
  child.on('message', m => {
    if (m.type === 'READY') { report.sqlite = m.sqlite; startedResolve(); }
    if (m.type === 'FAILED') startedReject(new Error(m.code));
    if (m.type === 'STOPPED') stopResolve?.();
    if (m.type === 'REPLY') { const p = pending.get(m.id); pending.delete(m.id); if (m.reply.ok) p?.resolve(m.reply.value); else p?.reject(new Error(m.reply.code)); }
  });
  child.on('exit', () => { stopResolve?.(); startedReject(new Error('COORDINATOR_EXITED')); });
  child.postMessage({ version: 1, type: 'START', databasePath: join(profile, 'astra.sqlite'), networkEnabled: live, fixtureMode: !live }); await ready;
}
async function stop() { const stopped = new Promise(resolve => { stopResolve = resolve; }); child.postMessage({ version: 1, type: 'STOP' }); await stopped; child.kill(); }
async function run() {
  await app.whenReady(); await start(); report.startupMs = Date.now() - started; report.steps.push('packaged utility started', 'SQLite opened'); save();
  let s = await request('getWorkspace', null);
  assert.equal(s.monitors.length, 0, 'Fresh validation database required');
  const monitor = await request('createMonitor', { name: live ? 'Authorized M4 read' : 'Authored packaged test', url: 'https://kantocards.com/products/perfect-order-booster-pack-espanol?_pos=1', cadenceSeconds: 86400 });
  await request('updateSafeSettings', { expectedVersion: s.settings.version, refreshSeconds: 15, storeEnabled: true });
  const sampling = setInterval(() => report.measurements.push({ at: Date.now(), processes: app.getAppMetrics().map(p => ({ type: p.type, workingSetKiB: p.memory.workingSetSize })) }), 50);
  try { await request('runMonitorNow', { id: monitor.id }); } finally { clearInterval(sampling); }
  s = await request('getWorkspace', null); report.safeReadStatus = s.monitors[0].lastResult;
  report.liveReadsUsed = s.settings.liveReadsUsed;
  assert.equal(s.products.length, 1, 'No validated observation'); assert.equal(s.evaluations[0].decision, 'BLOCKED'); assert.equal(s.diagnostics.pendingOutbox, 0);
  report.observation = s.products[0]; report.evaluation = { result: s.evaluations[0].outcome, arithmetic: s.evaluations[0].arithmetic, seller: s.evaluations[0].sellerStatus, decision: s.evaluations[0].decision };
  report.steps.push('validated command/query messages', 'adapter worker observation', 'durable blocked DRY_RUN and outbox drain'); save();
  await request('pauseMonitor', { id: monitor.id, expectedVersion: s.monitors[0].version });
  const shutdownAt = Date.now(); await stop(); report.shutdownMs = Date.now() - shutdownAt; save();
  await start(); const reopened = await request('getWorkspace', null);
  assert.equal(reopened.monitors[0].status, 'PAUSED'); assert.equal(reopened.products.length, 1); assert.equal(reopened.history.length, s.history.length); assert.equal(reopened.diagnostics.pendingOutbox, 0);
  report.steps.push('graceful close', 'reopen retained monitor/observation/audit without replay');
  await wait(100); report.idleCoordinatorMetrics = app.getAppMetrics().map(p => ({ type: p.type, workingSetKiB: p.memory.workingSetSize }));
  await stop(); report.status = 'PASS'; clearTimeout(timeout); save(); app.quit();
}
run().catch(error => { report.reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'COORDINATOR_ASSERTION_FAILED'; save(); clearTimeout(timeout); child?.kill(); app.exit(1); });
