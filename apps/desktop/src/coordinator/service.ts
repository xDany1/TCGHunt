import { id, refKey } from '@ptcg/core';
import { DesktopFailure, PersistenceFailure, isProductMonitor, productMonitorScope } from '@ptcg/application';
import type { OfferObservationCapability, AdapterError, RunCommand, ProductMonitorConfiguration } from '@ptcg/application';
import { normalizeAmazon, mapAmazonDomain, amazonRestockInput, amazonContextIdentity, compareAmazonContext } from '@ptcg/adapters';
import type { AuthorizedEvidence, AmazonProviderResult, AmazonContextDiagnostic } from '@ptcg/adapters';
import { openDurableStore } from '@ptcg/infrastructure';
import type { DurableStore } from '@ptcg/infrastructure';
import { validateCommand } from '@ptcg/contracts';
import type { Command, Inputs, Outputs, WorkspaceView } from '@ptcg/contracts';
import { resolveMonitorSource, monitorDefinition, OWNER } from './policy.js';
import { evaluationView, observationView, workspaceView } from './queries.js';

export interface DesktopHostOptions {
  readonly databasePath: string; readonly now: () => number; readonly newId: () => string;
  readonly read: (url: string) => Promise<AuthorizedEvidence>;
  readonly networkEnabled: boolean; readonly fixtureMode: boolean;
  readonly amazonNetworkEnabled?: boolean;
  readonly readAmazon?: (url: string) => Promise<AmazonProviderResult>;
  readonly cancelRead?: () => void;
  readonly contextDiagnostic?: (diagnostic: AmazonContextDiagnostic) => void;
}
/** Single coordinator owner. Renderer commands contain no policy, adapter or database authority. */
export class DesktopService {
  readonly store: DurableStore;
  private state: WorkspaceView['status'] = 'STOPPED';
  private reason = 'STARTING';
  private inFlight: { readonly monitorId: string; cancelled: boolean; } | null = null;
  private running: Promise<void> | null = null;
  private recoveryReadOnly = false;
  constructor(private readonly host: DesktopHostOptions) { this.store = openDurableStore(host.databasePath); }
  start(): void {
    const now = this.host.now();
    try { this.store.coordinator.recover(now); this.store.restock.deliverPending(now); } catch (error) {
      if (!(error instanceof PersistenceFailure) || error.code !== 'RECOVERY_READ_ONLY') throw error;
      this.recoveryReadOnly = true; this.state = 'DATABASE_UNAVAILABLE'; this.reason = 'RECOVERY_READ_ONLY'; return;
    }
    this.store.desktop.ensureSimulationOwner(OWNER, now);
    this.store.desktop.coalesceOverdue(now);
    this.state = 'RUNNING'; this.reason = 'READY';
  }
  snapshot(): WorkspaceView {
    const settings = this.store.desktop.settings();
    const reason = this.state !== 'RUNNING' ? this.reason : !settings.storeEnabled ? 'STORE_DISABLED'
      : !this.host.networkEnabled && !this.host.amazonNetworkEnabled && !this.host.fixtureMode ? 'NETWORK_NOT_ENABLED' : settings.liveReadsUsed >= 6 && !this.host.fixtureMode ? 'READ_BUDGET_EXHAUSTED' : this.inFlight ? 'OBSERVING' : 'WAITING_FOR_DUE_MONITOR';
    return workspaceView(this.store, this.host.now(), { state: this.state, reason, networkEnabled: this.host.networkEnabled, amazonNetworkEnabled: this.host.amazonNetworkEnabled === true, fixtureMode: this.host.fixtureMode, databaseLocation: this.host.databasePath });
  }
  async dispatch(command: Command, payload: unknown): Promise<Outputs[Command]> {
    const input = validateCommand(command, payload);
    if (this.state === 'DATABASE_UNAVAILABLE' && !['getWorkspace', 'getProductHistory', 'getEvaluation'].includes(command)) throw new PersistenceFailure('RECOVERY_READ_ONLY');
    const now = this.host.now();
    switch (command) {
      case 'getWorkspace': return this.snapshot();
      case 'getProductHistory': return this.store.desktop.productHistory((input as Inputs['getProductHistory']).offerId).map(o => observationView(o, now));
      case 'getEvaluation': return evaluationView(this.store.desktop.evaluation((input as Inputs['getEvaluation']).id), now);
      case 'openProduct': throw new PersistenceFailure('INVALID_INPUT'); // Host resolves persisted product history, validates, then opens externally.
      case 'createMonitor': {
        if (this.state !== 'RUNNING' || this.store.desktop.listMonitors().length >= 100) throw new DesktopFailure('BUSY');
        const monitorId = `desktop:${this.host.newId()}`;
        this.store.monitors.publishRevision(monitorDefinition(monitorId, input as Inputs['createMonitor'], now), null, now);
        return { id: monitorId };
      }
      case 'updateMonitor': {
        const p = input as Inputs['updateMonitor']; this.editable(p.id);
        if (this.inFlight?.monitorId === p.id) throw new DesktopFailure('BUSY');
        this.store.monitors.publishRevision(monitorDefinition(p.id, p, now), p.expectedVersion, now); return { id: p.id };
      }
      case 'pauseMonitor': case 'resumeMonitor': case 'archiveMonitor': {
        const p = input as Inputs['pauseMonitor']; this.editable(p.id);
        if (command !== 'resumeMonitor' && this.inFlight?.monitorId === p.id) this.cancel();
        this.store.monitors.changeStatus(id('monitor', p.id), command === 'pauseMonitor' ? 'PAUSED' : command === 'resumeMonitor' ? 'ACTIVE' : 'ARCHIVED', p.expectedVersion, now);
        return { id: p.id };
      }
      case 'runMonitorNow': {
        const p = input as Inputs['runMonitorNow']; await this.run(p.id, true); return { id: p.id };
      }
      case 'updateSafeSettings': {
        const p = input as Inputs['updateSafeSettings'];
        if (!p.storeEnabled && this.inFlight) this.cancel();
        this.store.desktop.updateSettings(p, now); return { id: 'safe-settings' };
      }
    }
  }
  private editable(monitorId: string): void {
    const m = this.store.monitors.getMonitor(id('monitor', monitorId));
    if (m.definition.ownerId !== OWNER || !m.definition.desktop) throw new DesktopFailure('READ_ONLY_MONITOR');
  }
  async tick(): Promise<void> {
    if (this.state !== 'RUNNING' || this.inFlight || !this.store.desktop.settings().storeEnabled) return;
    if (!this.host.fixtureMode && this.store.desktop.settings().liveReadsUsed >= 6) return;
    const now = this.host.now();
    const due = this.store.desktop.listMonitors().filter(m => {
      const c = m.monitor.definition.configuration; const product = isProductMonitor(c);
      return m.monitor.status === 'ACTIVE' && m.monitor.definition.ownerId === OWNER && m.nextDueAt !== null && m.nextDueAt <= now &&
        (this.host.fixtureMode || (product ? this.host.amazonNetworkEnabled : this.host.networkEnabled)) &&
        this.store.desktop.sourceReady(product ? `product:${c.productRef.storeId}:${c.provider}` : 'shopify:shopify-kantocards', now);
    }).sort((a, b) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0))[0];
    if (due) {
      try { await this.run(due.monitor.definition.monitorId, false); }
      catch (e) { if (!(e instanceof DesktopFailure)) { const c = due.monitor.definition.configuration; this.store.desktop.recordFailure('SCHEDULER_FAILED', now, isProductMonitor(c) ? `product:${c.productRef.storeId}:${c.provider}` : undefined); } }
    }
    this.store.outbox.deliverPendingNotifications(this.host.now());
    this.store.restock.deliverPending(this.host.now());
  }
  async run(monitorId: string, manual: boolean): Promise<void> {
    this.editable(monitorId);
    if (this.state !== 'RUNNING') throw new DesktopFailure('SUSPENDED');
    if (this.inFlight) throw new DesktopFailure('BUSY');
    const now = this.host.now(); const monitor = this.store.monitors.getMonitor(id('monitor', monitorId));
    const source = resolveMonitorSource(monitor.definition.configuration.sourceReference ?? '');
    if (!this.host.fixtureMode && !(source.family === 'Amazon' ? this.host.amazonNetworkEnabled : this.host.networkEnabled)) throw new DesktopFailure('NETWORK_NOT_ENABLED');
    this.store.desktop.claimScheduledRead(monitorId, now, manual, !this.host.fixtureMode);
    const pending = { monitorId, cancelled: false }; this.inFlight = pending;
    const operation = this.host.newId();
    const adapter: OfferObservationCapability = {
      descriptor: { id: 'desktop-observation', version: 'm4-1', contractVersion: 1, automationLevel: 'OBSERVE_ONLY', capabilities: ['OBSERVATION'] },
      observe: async (offer, context) => {
        try {
          const e = await this.host.read(source.canonical); const completedAt = this.host.now();
          if (pending.cancelled) return { ok: false, error: { code: 'CANCELLED', category: 'NON_RETRYABLE', operationId: context.operationId, externalEffect: 'NOT_SENT' } };
          if (refKey(e.observation.offer.ref) !== refKey(offer)) throw new PersistenceFailure('CONFLICT');
          return { ok: true, ...e, completedAt };
        } catch (error) {
          const provided = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'TRANSIENT_FAILURE';
          const codes: readonly AdapterError['code'][] = ['CANCELLED', 'DEADLINE_EXCEEDED', 'BLOCKED', 'AUTH_REQUIRED', 'RATE_LIMITED', 'SCHEMA_MISMATCH', 'MALFORMED_RESPONSE', 'CONTEXT_MISMATCH', 'POLICY_DENIED'];
          const code = codes.find(c => c === provided) ?? 'TRANSIENT_FAILURE';
          return { ok: false, error: { code, category: 'NON_RETRYABLE', operationId: context.operationId, externalEffect: 'NOT_SENT' } };
        }
      }
    };
    this.running = (async () => {
      try {
        const command = { monitorId: monitor.definition.monitorId, revision: monitor.revision, runId: `desktop-run:${operation}`, operationId: `desktop-operation:${operation}`, traceId: `desktop-trace:${operation}`, now };
        if (isProductMonitor(monitor.definition.configuration)) {
          await this.runProduct(command, monitor.definition.configuration, pending);
          this.store.restock.deliverPending(this.host.now()); return;
        }
        const result = await this.store.coordinator.run(adapter, { monitorId: monitor.definition.monitorId, revision: monitor.revision, runId: `desktop-run:${operation}`, operationId: `desktop-operation:${operation}`, traceId: `desktop-trace:${operation}`, now });
        if (result.status === 'FAILED') this.store.desktop.recordFailure(result.adapterError?.code ?? result.code, this.host.now());
        this.store.outbox.deliverPendingNotifications(this.host.now());
      } finally { this.inFlight = null; this.running = null; }
    })();
    await this.running;
  }
  private async runProduct(command: RunCommand, c: ProductMonitorConfiguration, pending: { cancelled: boolean; }): Promise<void> {
    const scope = productMonitorScope(command.monitorId, c);
    this.store.monitors.startRun(command);
    try {
      if (c.provider !== 'BROWSER' || !this.host.readAmazon) throw Object.assign(new Error('PROVIDER_UNAVAILABLE'), { code: 'POLICY_DENIED' });
      const result = await this.host.readAmazon(c.sourceReference);
      if (pending.cancelled) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
      if (!('evidence' in result)) throw Object.assign(new Error('READ_FAILED'), { code: result.category });
      const e = result.evidence;
      const expected = amazonContextIdentity({ asin: c.productRef.externalId, url: c.sourceReference, marketplace: 'MX', provider: c.provider, storeKey: c.productRef.storeId });
      const observed = amazonContextIdentity({ asin: e.asin, url: e.productUrl, marketplace: e.marketplace, provider: e.source.provider, storeKey: e.source.confidence === 'LIVE_CAPTURE' ? 'amazon-mx-m5.4-browser-live' : 'amazon-mx-m5.2-fixtures' });
      const diagnostic: AmazonContextDiagnostic = { stage: 'MONITOR_PRODUCT', expected, observed, comparison: compareAmazonContext(expected, observed) };
      this.host.contextDiagnostic?.(diagnostic);
      if (!Object.values(diagnostic.comparison).every(Boolean)) throw Object.assign(new Error('MISMATCH'), { code: 'CONTEXT_MISMATCH' });
      const n = normalizeAmazon({ ...e, asin: observed.canonicalProductId ?? e.asin, productUrl: c.sourceReference }); const mapped = mapAmazonDomain(n, c.deliveryScope); const now = this.host.now();
      if (refKey(mapped.productRef) !== refKey(c.productRef)) throw Object.assign(new Error('MISMATCH'), { code: 'CONTEXT_MISMATCH' });
      this.store.productMonitoring.complete(command, amazonRestockInput(n, mapped.observations, scope, command.runId, now, true), now);
    } catch (error) {
      const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const code = ['CANCELLED', 'CHALLENGE_DETECTED', 'ACCESS_DENIED', 'PARSER_MISMATCH', 'TIMEOUT', 'PAGE_UNAVAILABLE', 'AUTH_REQUIRED', 'THROTTLED', 'CONTEXT_MISMATCH', 'DEADLINE_EXCEEDED', 'POLICY_DENIED'].includes(raw) ? raw : 'TRANSIENT_FAILURE';
      if (pending.cancelled) { this.store.monitors.failRun(command, 'CANCELLED'); return; }
      const now = this.host.now();
      this.store.productMonitoring.complete(command, { id: command.runId, mode: 'DRY_RUN', scope, observedAt: now, receivedAt: now, expiresAt: now + 60000, status: 'OBSERVATION_FAILED', coverage: 'UNKNOWN', observations: [], provenance: { provider: c.provider, reference: code } }, now);
    }
  }
  private cancel(): void { if (this.inFlight) { this.inFlight.cancelled = true; this.host.cancelRead?.(); } }
  suspend(): void { if (this.state === 'STOPPED' || this.recoveryReadOnly) return; this.state = 'SUSPENDED'; this.reason = 'SYSTEM_SUSPENDED'; this.cancel(); }
  resume(): void { if (this.state === 'STOPPED' || this.recoveryReadOnly) return; this.store.desktop.coalesceOverdue(this.host.now()); this.state = 'RUNNING'; this.reason = 'RESUME_COALESCED'; }
  async stop(): Promise<void> {
    this.state = 'STOPPED'; this.reason = 'SHUTTING_DOWN'; this.cancel();
    await this.running; if (!this.recoveryReadOnly) { this.store.outbox.deliverPendingNotifications(this.host.now()); this.store.restock.deliverPending(this.host.now()); } this.store.close();
  }
}
