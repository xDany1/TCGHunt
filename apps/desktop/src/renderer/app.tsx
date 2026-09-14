import { useCallback, useEffect, useState } from 'react';
import type { DesktopBridge, EvaluationView, ObservationView, WorkspaceView } from '@ptcg/contracts';
import { MonitoringAlerts, atDisplayTime, Chip, Empty, Section, time, words } from './components.js';
import { Monitors } from './monitors.js';
import { History, Opportunities, Products } from './evidence.js';
declare global { interface Window { readonly astra: DesktopBridge; } }
const screens = ['Dashboard', 'Monitors', 'Alerts', 'Opportunities', 'Products', 'Stores', 'History', 'Settings'] as const;
type Screen = typeof screens[number];
export function App() {
  const [screen, setScreen] = useState<Screen>('Dashboard'); const [data, setData] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true);
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null); const [history, setHistory] = useState<readonly ObservationView[]>([]);
  const refresh = useCallback(async () => {
    try { const reply = await window.astra.getWorkspace(null); if (!reply.ok) throw new Error(`${words(reply.code)} · Diagnostic ${reply.diagnosticId}`); setData(reply.value); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Desktop connection unavailable'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), (data?.settings.refreshSeconds ?? 15) * 1000); return () => window.clearInterval(timer); }, [refresh, data?.settings.refreshSeconds]);
  const act = async (operation: () => Promise<unknown>) => {
    setError(''); setNotice('');
    try { const result = await operation(); if (result && typeof result === 'object' && 'ok' in result && !result.ok && 'code' in result && 'diagnosticId' in result) { throw new Error(`${words(String(result.code))} · Diagnostic ${String(result.diagnosticId)}`); } setNotice('Request completed. Review the latest status and evidence.'); await refresh(); } catch (e) { await refresh(); setError(e instanceof Error ? e.message : 'Request unavailable'); }
  };
  const selectEvaluation = (id: string) => { void act(async () => { const r = await window.astra.getEvaluation({ id }); if (r.ok) { setEvaluation(r.value); setScreen('Opportunities'); } return r; }); };
  const selectProduct = (offerId: string) => { void act(async () => { const r = await window.astra.getProductHistory({ offerId }); if (r.ok) setHistory(r.value); return r; }); };
  const open = (offerId: string) => { void act(() => window.astra.openProduct({ offerId })); };
  return <div className="shell"><aside><div className="brand"><span className="brand-mark">A</span><div>ASTRA ALTO<small>Desktop observer</small></div></div><nav aria-label="Main navigation">{screens.map((s, i) => <button key={s} className={screen === s ? 'selected' : ''} onClick={() => setScreen(s)}><span className="nav-index">0{i + 1}</span>{s}</button>)}</nav><div className="sidebar-foot">Local data · Phase 1<br /><strong>DRY RUN ONLY</strong></div></aside>
    <main><div className="dry-banner"><strong>DRY RUN</strong><span>No real cart, checkout, or purchase actions are enabled.</span>{data?.fixtureMode && <strong>AUTHORED TEST FIXTURES</strong>}</div><header><div><p className="eyebrow">WORKSPACE / {screen.toUpperCase()}</p><h1>{screen}</h1></div><div className="header-state"><Chip value={data?.status ?? 'CONNECTING'} /><button onClick={() => void refresh()}>Refresh</button></div></header>
      {error && <div role="alert" className="notice error">{error}{!data && <p>The desktop database or coordinator is unavailable. Data has not been reset. Close and retry after checking the data directory.</p>}</div>}{notice && <div role="status" className="notice">{notice}</div>}
      {loading && <Empty>Opening the local workspace…</Empty>}
      {data && <><div className="health-line"><span>Scheduler: {words(data.reason)}</span><span>Last observation: {time(data.dashboard.lastObservationAt)}</span></div>
        {screen === 'Dashboard' && <><div className="metrics">{Object.entries({ 'Active monitors': data.dashboard.activeMonitors, 'Products observed today': data.dashboard.productsObservedToday, 'Open opportunities': data.dashboard.opportunitiesOpen, 'Simulations blocked today': data.dashboard.simulationsBlockedToday, 'Would Have Executed today': data.dashboard.wouldHaveExecutedToday, 'Delayed monitors': data.dashboard.delayedMonitors }).map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><Section title="Observation health">{data.stores.map(s => <div className="product-row" key={s.id}><div><strong>{s.name}</strong><small>{words(s.reason)}</small></div><Chip value={s.observationHealth} /></div>)}<p className="muted">Today uses UTC. Open opportunities count fresh eligible evidence. Seller approval alone does not make an opportunity eligible.</p></Section><Section title="Next steps">{!data.monitors.length ? <p>Create an authorized URL monitor. Live reads require explicit host configuration and enabling the approved store.</p> : <p>Inspect Monitors for schedules and Opportunities for blocking reasons. Missing shipping, tax, stock and reviewed mapping remain explicit.</p>}<button onClick={() => setScreen('Monitors')}>Manage monitors</button></Section></>}
        {screen === 'Alerts' && <MonitoringAlerts alerts={data.alerts} />}
        {screen === 'Monitors' && <Monitors data={data} act={act} />}
        {screen === 'Opportunities' && <Opportunities data={data} select={selectEvaluation} selected={evaluation ? { ...evaluation, observation: atDisplayTime(evaluation.observation, data.now) } : null} open={open} />}
        {screen === 'Products' && <Products data={data} history={history.map(p => atDisplayTime(p, data.now))} select={selectProduct} open={open} />}
        {screen === 'History' && <History data={data} select={selectEvaluation} />}
        {screen === 'Stores' && data.stores.map(s => <Section key={s.id} title={`${s.name} / ${s.family}`}><p>{s.domain}</p><div className="capabilities"><div>Observation <Chip value={s.observationHealth} /></div>{s.unsupported.map(c => <div key={c}>{c}<Chip value="UNSUPPORTED" /></div>)}</div><p>{words(s.reason)}</p><dl className="facts"><dt>Last observation</dt><dd>{time(s.lastSuccessAt)}</dd><dt>Last failure</dt><dd>{time(s.lastFailureAt)}</dd><dt>Access policy</dt><dd>{s.policy}</dd><dt>Adapter / parser</dt><dd>{s.adapterVersion} / {s.parserVersion}</dd></dl></Section>)}
        {screen === 'Settings' && <Settings data={data} act={act} />}
        {data.diagnostics.truncated && <p className="notice">Showing bounded recent records: up to 100 monitors, 50 products/evaluations and 100 audit events.</p>}
        <footer>DRY RUN · Local SQLite schema {data.diagnostics.schemaVersion ?? 'Unknown'} · SQLite {data.diagnostics.sqliteVersion ?? 'Unknown'} · {data.diagnostics.pendingOutbox} pending notifications</footer>
      </>}
    </main></div>;
}
function Settings({ data, act }: { readonly data: WorkspaceView; readonly act: (operation: () => Promise<unknown>) => Promise<void>; }) {
  const [seconds, setSeconds] = useState(data.settings.refreshSeconds);
  return <><Section title="Safe local preferences"><form onSubmit={e => { e.preventDefault(); void act(() => window.astra.updateSafeSettings({ expectedVersion: data.settings.version, refreshSeconds: seconds, storeEnabled: data.settings.storeEnabled })); }}><label>Display refresh (seconds)<input type="number" min={5} max={60} required value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label><button>Save preference</button></form></Section>
    <Section title="Approved store observations"><p>Kantocards is {data.settings.storeEnabled ? 'enabled' : 'disabled'}. Host network authorization is {data.networkEnabled ? 'configured' : 'not configured'}.</p><p>{data.settings.liveReadsUsed} of {data.settings.liveReadLimit} permitted request attempts used in this local validation database. Budget persists across restart and does not refill automatically.</p><button onClick={() => void act(() => window.astra.updateSafeSettings({ expectedVersion: data.settings.version, refreshSeconds: data.settings.refreshSeconds, storeEnabled: !data.settings.storeEnabled }))}>{data.settings.storeEnabled ? 'Disable store observations' : 'Enable approved store observations'}</button></Section>
    <Section title="App status"><Chip value="DRY_RUN" /><p>Observation and simulation only. No execution setting exists.</p><details><summary>Local diagnostics</summary><p className="ids">Database: {data.diagnostics.databaseLocation}</p><p>Scheduler: {words(data.reason)}</p><p>No raw merchant responses or credentials are shown.</p></details></Section></>;
}
