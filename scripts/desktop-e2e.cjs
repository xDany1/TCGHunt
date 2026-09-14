// Trusted test main only. Never included in the production package.
const { app } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { boot } = require('./main.cjs');
const report = { status: 'PARTIAL', versions: process.versions, steps: [], rendererLoaded: false, fixtureMode: true, externalRequests: 0 };
const started = Date.now(); let instance;
const save = () => writeFileSync(process.env.ASTRA_M4_RESULT, JSON.stringify(report, null, 2));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { report.reason = 'DESKTOP_TEST_TIMEOUT'; save(); app.exit(1); }, 45000);
async function js(code) { return instance.win.webContents.executeJavaScript(code, true); }
async function call(name, input) { const r = await js(`window.astra[${JSON.stringify(name)}](${JSON.stringify(input)})`); assert.equal(r.ok, true, r.code); return r.value; }
async function click(text) { await js(`(() => { const b = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b) throw Error('Button missing'); b.click(); })()`); await wait(150); }
async function run() {
  let opened = null;
  instance = await boot({ fixtureMode: true, show: false, testExternalOpen: url => { opened = url; } }); report.rendererLoaded = true;
  let data;
  for (let i = 0; i < 40; i++) { const r = await js('window.astra.getWorkspace(null)'); if (r.ok) { data = r.value; break; } await wait(100); }
  assert.ok(data); await click('Refresh');
  assert.match(await js('document.body.innerText'), /Dashboard/); assert.match(await js('document.body.innerText'), /DRY RUN/);
  assert.deepEqual(await js('[typeof require,typeof process,typeof Buffer]'), ['undefined', 'undefined', 'undefined']);
  const preferences = instance.win.webContents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.devTools, false);
  assert.equal(await js('Object.keys(window.astra).length'), 11); report.steps.push('dashboard', 'DRY_RUN', 'sandbox/preload boundaries');
  // Exercise the response CSP in Chromium without any external request or debug port.
  const csp = await js(`new Promise(resolve => {
    const handler = event => { if (event.violatedDirective.startsWith('script-src')) { document.removeEventListener('securitypolicyviolation', handler); resolve({ blocked: window.m45InlineExecuted !== true, directive: event.violatedDirective }); } };
    document.addEventListener('securitypolicyviolation', handler);
    const script = document.createElement('script'); script.textContent = 'window.m45InlineExecuted = true'; document.body.appendChild(script); script.remove();
    setTimeout(() => { document.removeEventListener('securitypolicyviolation', handler); resolve({ blocked: false, directive: 'NO_CSP_EVENT' }); }, 1000);
  })`);
  assert.equal(csp.blocked, true); assert.equal(instance.win.webContents.isDevToolsOpened(), false);
  report.security = { preferences: { nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, devTools: preferences.devTools }, rendererNodeGlobals: 'UNDEFINED', bridge: await js('Object.keys(window.astra).sort()'), csp };
  report.steps.push('runtime CSP blocks inline script', 'DevTools closed');
  const existing = data.monitors.find(m => m.name === 'E2E saved monitor');
  if (!existing) {
    await click('Monitors');
    await js(`(() => { const set=(name,value)=>{const e=document.querySelector('[name="'+name+'"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};set('monitor-name','E2E saved monitor');set('monitor-url','https://kantocards.com/products/perfect-order-booster-pack-espanol?_pos=1'); })()`);
    await click('Create monitor'); await wait(200); data = await call('getWorkspace', null);
    assert.equal(data.monitors.length, 1); report.steps.push('create monitor through React/IPC');
  } else report.steps.push('monitor persisted across packaged restart');
  data = await call('getWorkspace', null); const monitor = data.monitors[0];
  await call('pauseMonitor', { id: monitor.id, expectedVersion: monitor.version });
  await call('resumeMonitor', { id: monitor.id, expectedVersion: monitor.version + 1 }); report.steps.push('pause/resume');
  await call('updateSafeSettings', { expectedVersion: data.settings.version, refreshSeconds: 5, storeEnabled: true });
  if (!existing) await call('runMonitorNow', { id: monitor.id });
  data = await call('getWorkspace', null); assert.ok(data.evaluations.length); assert.equal(data.evaluations[0].decision, 'BLOCKED'); assert.equal(data.diagnostics.pendingOutbox, 0);
  await click('Opportunities'); await click('Refresh'); await wait(150);
  assert.match(await js('document.body.innerText'), /Simulation Blocked/); assert.equal(await js('document.querySelectorAll("img").length'), 0); assert.equal(await js('window.hostileExecuted === true'), false);
  await call('openProduct', { offerId: data.products[0].offerId }); assert.match(opened, /^https:\/\/kantocards\.com\/products\/perfect-order-booster-pack-espanol\?variant=49183411208435$/);
  report.steps.push('blocked opportunity', 'hostile strings escaped', 'constrained external link');
  await click('History'); assert.match(await js('document.body.innerText'), /DRY RUN/); await click('Stores'); assert.match(await js('document.body.innerText'), /UNSUPPORTED/);
  await click('Dashboard'); writeFileSync(join(process.env.ASTRA_M4_OUTPUT, 'M4_DESKTOP.png'), (await instance.win.webContents.capturePage()).toPNG());
  report.steps.push('audit history', 'unsupported capabilities'); report.sqlite = data.diagnostics; report.startupAndWorkflowMs = Date.now() - started;
  report.metrics = app.getAppMetrics().map(p => ({ type: p.type, workingSetKiB: p.memory.workingSetSize, privateKiB: p.memory.privateBytes }));
  report.status = 'PASS'; clearTimeout(timeout); save(); await instance.shutdown();
}
run().catch(async error => { report.reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'DESKTOP_ASSERTION_FAILED'; report.stepsCompleted = report.steps.length; save(); clearTimeout(timeout); if (instance) await instance.shutdown(); app.exit(1); });
