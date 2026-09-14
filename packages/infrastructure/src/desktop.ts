import { id, money, instant } from '@ptcg/core';
import { DesktopFailure, PersistenceFailure, isProductMonitor } from '@ptcg/application';
import type { DesktopRepository, DesktopSettings, DesktopEvaluationRecord, DecisionEvidence, AnyMonitorDefinition as MonitorDefinition, MonitorSnapshot, SafeAudit, ObservationHistoryItem } from '@ptcg/application';
import { Database, integer, required, string } from './database.js';
import type { Row } from './database.js';
import { decode } from './codec.js';
import { SqliteExecution } from './execution.js';

const nullableNumber = (value: unknown): number | null => value === null ? null : integer(value);
function observation(row: Row): ObservationHistoryItem { return { observation: decode(row['snapshot']), catalog: row['metadata'] == null ? null : decode(row['metadata']) }; }
const evaluationQuery = `SELECT e.snapshot,e.outcome,i.id AS intent_id,i.state,i.evaluation_id AS decision_evaluation_id
 FROM decision_evaluations e JOIN monitor_runs r ON r.id=e.run_id JOIN monitors m ON m.id=r.monitor_id
 LEFT JOIN simulated_operations op ON op.owner_id=m.owner_id AND op.operation_id=r.operation_id
 LEFT JOIN purchase_intents i ON i.id=op.intent_id`;
function evaluation(row: Row): DesktopEvaluationRecord {
  return {
    evidence: decode<DecisionEvidence>(row['snapshot']), outcome: string(row['outcome']), intentId: row['intent_id'] == null ? null : string(row['intent_id']),
    decision: row['state'] === 'SIMULATED' ? 'SIMULATED' : row['state'] === 'BLOCKED' ? 'BLOCKED' : 'NOT_ADMITTED', decisionEvaluationId: row['decision_evaluation_id'] == null ? null : string(row['decision_evaluation_id'])
  };
}
export class SqliteDesktop implements DesktopRepository {
  constructor(private readonly db: Database) { }
  settings(): DesktopSettings {
    const r = required(this.db.get('SELECT * FROM desktop_settings WHERE id=1'));
    return {
      version: integer(r['version']), refreshSeconds: integer(r['refresh_seconds']), storeEnabled: integer(r['store_enabled']) === 1,
      liveReadsUsed: integer(r['live_reads_used']), lastFailureAt: nullableNumber(r['last_failure_at']), lastFailure: r['last_failure'] === null ? null : string(r['last_failure'])
    };
  }
  updateSettings(input: { readonly expectedVersion: number; readonly refreshSeconds: number; readonly storeEnabled: boolean; }, now: number): void {
    instant(now);
    if (!Number.isInteger(input.refreshSeconds) || input.refreshSeconds < 5 || input.refreshSeconds > 60 || typeof input.storeEnabled !== 'boolean') throw new PersistenceFailure('INVALID_INPUT');
    this.db.transaction(() => {
      if (this.db.run('UPDATE desktop_settings SET version=version+1,refresh_seconds=?,store_enabled=? WHERE id=1 AND version=?', input.refreshSeconds, Number(input.storeEnabled), input.expectedVersion) !== 1) throw new PersistenceFailure('STALE_VERSION');
      this.db.run('INSERT INTO desktop_settings_audit(version,occurred_at,refresh_seconds,store_enabled) VALUES(?,?,?,?)', input.expectedVersion + 1, now, input.refreshSeconds, Number(input.storeEnabled));
    });
  }
  listMonitors() {
    return this.db.all(`SELECT m.*,r.definition,s.next_due_at FROM monitors m JOIN monitor_revisions r ON r.monitor_id=m.id AND r.revision=m.current_revision
      LEFT JOIN desktop_schedule s ON s.monitor_id=m.id ORDER BY m.id LIMIT 100`).map(row => {
      const definition = decode<MonitorDefinition>(row['definition']);
      const last = this.db.get('SELECT command,status,reason,finished_at FROM monitor_runs WHERE monitor_id=? ORDER BY rowid DESC LIMIT 1', string(row['id']));
      const o = this.db.get(`SELECT o.snapshot,md.snapshot AS metadata FROM listing_observations o JOIN observation_run_links l ON l.observation_id=o.id
        JOIN monitor_runs r ON r.id=l.run_id LEFT JOIN observation_metadata md ON md.observation_id=o.id WHERE r.monitor_id=? ORDER BY o.captured_at DESC,o.id DESC LIMIT 1`, string(row['id']));
      return {
        monitor: { definition, revision: integer(row['current_revision']), version: integer(row['version']), status: string(row['status']) as MonitorSnapshot['status'] },
        nextDueAt: nullableNumber(row['next_due_at']), lastRunAt: last ? decode<{ now: number; }>(last['command']).now : null,
        lastResult: last ? last['reason'] === null ? string(last['status']) : string(last['reason']) : null, lastObservation: o ? observation(o) : null
      };
    });
  }
  latestProducts() {
    return this.db.all(`SELECT o.snapshot,m.snapshot AS metadata FROM listing_observations o LEFT JOIN observation_metadata m ON m.observation_id=o.id
      WHERE o.id=(SELECT x.id FROM listing_observations x WHERE x.offer_id=o.offer_id ORDER BY x.captured_at DESC,x.id DESC LIMIT 1) ORDER BY o.captured_at DESC LIMIT 50`).map(observation);
  }
  productHistory(offerId: string) {
    return this.db.all(`SELECT o.snapshot,m.snapshot AS metadata FROM listing_observations o LEFT JOIN observation_metadata m ON m.observation_id=o.id
      WHERE o.offer_id=? ORDER BY o.captured_at DESC,o.id DESC LIMIT 100`, offerId).map(observation);
  }
  evaluations() { return this.db.all(evaluationQuery + ' ORDER BY e.evaluated_at DESC,e.id DESC LIMIT 50').map(evaluation); }
  evaluation(evaluationId: string) { return evaluation(required(this.db.get(evaluationQuery + ' WHERE e.id=?', evaluationId))); }
  audits() {
    return this.db.all(`SELECT a.snapshot,e.run_id,e.observation_id,o.status AS outbox FROM audit_events a
      JOIN purchase_intents i ON i.id=a.intent_id JOIN decision_evaluations e ON e.id=i.evaluation_id
      LEFT JOIN event_outbox o ON o.intent_id=i.id ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 100`).map(r => ({
      audit: decode<SafeAudit>(r['snapshot']), runId: string(r['run_id']), observationId: string(r['observation_id']), outbox: r['outbox'] == null ? null : string(r['outbox'])
    }));
  }
  claimScheduledRead(monitorId: string, now: number, manual: boolean, live: boolean): void {
    instant(now);
    const definition = decode<MonitorDefinition>(required(this.db.get('SELECT r.definition FROM monitor_revisions r JOIN monitors m ON m.id=r.monitor_id AND m.current_revision=r.revision WHERE m.id=?', monitorId))['definition']);
    const c = definition.configuration;
    const scope = isProductMonitor(c) ? `product:${c.productRef.storeId}:${c.provider}` : 'shopify:shopify-kantocards';
    const rejection = this.db.transaction(() => {
      const settings = this.settings();
      if (!settings.storeEnabled) return 'STORE_DISABLED' as const;
      if (live && settings.liveReadsUsed >= 6) return 'READ_BUDGET_EXHAUSTED' as const;
      const row = required(this.db.get('SELECT s.*,m.status FROM desktop_schedule s JOIN monitors m ON m.id=s.monitor_id WHERE s.monitor_id=?', monitorId));
      if (row['status'] !== 'ACTIVE') throw new PersistenceFailure('CONFLICT');
      if (!manual && integer(row['next_due_at']) > now) return 'NOT_DUE' as const;
      const quota = this.db.get('SELECT * FROM read_quotas WHERE scope=?', scope);
      if (quota && (quota['blocked'] !== null || integer(quota['next_at']) > now)) return 'STORE_COOLDOWN' as const;
      this.db.run('INSERT INTO read_quotas VALUES(?,?,NULL) ON CONFLICT(scope) DO UPDATE SET next_at=excluded.next_at', scope, now + (isProductMonitor(c) ? 60000 : 5000));
      this.db.run('UPDATE desktop_schedule SET next_due_at=?+cadence_seconds*1000 WHERE monitor_id=?', now, monitorId);
      if (live) this.db.run('UPDATE desktop_settings SET live_reads_used=live_reads_used+1 WHERE id=1');
      return null;
    });
    if (rejection) throw new DesktopFailure(rejection);
  }
  coalesceOverdue(now: number): void {
    instant(now);
    this.db.transaction(() => {
      const rows = this.db.all("SELECT s.monitor_id FROM desktop_schedule s JOIN monitors m ON m.id=s.monitor_id WHERE m.status='ACTIVE' AND s.next_due_at<? ORDER BY s.next_due_at,s.monitor_id LIMIT 100", now);
      rows.forEach((r, i) => { this.db.run('UPDATE desktop_schedule SET next_due_at=? WHERE monitor_id=?', now + (i + 1) * 5000, string(r['monitor_id'])); });
    });
  }
  sourceReady(scope: string, now: number): boolean {
    const q = this.db.get('SELECT * FROM read_quotas WHERE scope=?', scope);
    return !q || q['blocked'] === null && integer(q['next_at']) <= now;
  }
  recordFailure(code: string, now: number, scope?: string): void {
    instant(now);
    const safe = /^[A-Z_]{1,60}$/.test(code) ? code : 'READ_FAILED';
    this.db.transaction(() => {
      if (scope) {
        if (['AUTH_REQUIRED', 'BLOCKED', 'CHALLENGE_DETECTED', 'ACCESS_DENIED'].includes(safe)) this.db.run('UPDATE read_quotas SET blocked=? WHERE scope=?', safe === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'BLOCKED', scope);
        else this.db.run('UPDATE read_quotas SET next_at=? WHERE scope=?', now + (safe === 'RATE_LIMITED' ? 3600000 : 60000), scope);
        return;
      }
      this.db.run('UPDATE desktop_settings SET last_failure=?,last_failure_at=? WHERE id=1', safe, now);
      if (['AUTH_REQUIRED', 'BLOCKED', 'RATE_LIMITED'].includes(safe)) {
        this.db.run('UPDATE desktop_settings SET store_enabled=0,version=version+1 WHERE id=1');
        if (safe !== 'RATE_LIMITED') this.db.run('UPDATE read_quotas SET blocked=? WHERE scope=?', safe, 'shopify:shopify-kantocards');
        else this.db.run('UPDATE read_quotas SET next_at=? WHERE scope=?', now + 3600000, 'shopify:shopify-kantocards');
      }
    });
  }
  ensureSimulationOwner(ownerId: string, now: number): void {
    if (!this.db.get('SELECT owner_id FROM simulated_owners WHERE owner_id=?', ownerId)) new SqliteExecution(this.db).configureLimits({ ownerId: id('local-owner', ownerId), version: 1, timezone: 'UTC', dailySpend: money(0n, 'MXN'), productCampaignQuantity: 1, dailyAttempts: 1, cooldownMs: 60000 }, null, now);
  }
  counts(now: number) {
    const start = Math.floor(now / 86400000) * 86400000;
    const n = (sql: string, ...args: (number | string)[]) => integer(required(this.db.get(sql, ...args))['n']);
    const last = this.db.get("SELECT max(at) AS at FROM (SELECT received_at AS at FROM listing_observations UNION ALL SELECT json_extract(sample,'$.receivedAt') AS at FROM restock_samples WHERE json_extract(sample,'$.productObservation') IS NOT NULL)");
    return {
      active: n("SELECT count(*) AS n FROM monitors m JOIN desktop_schedule s ON s.monitor_id=m.id WHERE m.status='ACTIVE'"), delayed: n("SELECT count(*) AS n FROM desktop_schedule s JOIN monitors m ON m.id=s.monitor_id WHERE m.status='ACTIVE' AND s.next_due_at<?", now),
      productsToday: n('SELECT count(DISTINCT v.product_id) AS n FROM listing_observations o JOIN offers f ON f.id=o.offer_id JOIN variants v ON v.id=f.variant_id WHERE o.received_at>=? AND o.received_at<=?', start, now) + n("SELECT count(DISTINCT json_extract(sample,'$.productObservation.productRef')) AS n FROM restock_samples WHERE json_extract(sample,'$.receivedAt')>=? AND json_extract(sample,'$.receivedAt')<=?", start, now),
      opportunities: n(`SELECT count(DISTINCT o.offer_id) AS n FROM decision_evaluations e JOIN listing_observations o ON o.id=e.observation_id
        WHERE e.outcome='ELIGIBLE' AND json_extract(o.snapshot,'$.identity.evidence.sourceObservedAt')>=? AND json_extract(o.snapshot,'$.identity.evidence.sourceObservedAt')<=?
        AND json_extract(o.snapshot,'$.identity.evidence.expiresAt')>? AND e.id=(SELECT x.id FROM decision_evaluations x JOIN listing_observations y ON y.id=x.observation_id WHERE y.offer_id=o.offer_id ORDER BY x.evaluated_at DESC,x.id DESC LIMIT 1)`, now - 60000, now, now),
      blockedToday: n("SELECT count(*) AS n FROM audit_events WHERE action='PURCHASE_BLOCKED' AND occurred_at>=? AND occurred_at<=?", start, now),
      simulatedToday: n("SELECT count(*) AS n FROM audit_events WHERE action='PURCHASE_WOULD_HAVE_EXECUTED' AND occurred_at>=? AND occurred_at<=?", start, now),
      lastObservationAt: last ? nullableNumber(last['at']) : null, pendingOutbox: n("SELECT count(*) AS n FROM event_outbox WHERE status='PENDING'") + n("SELECT count(*) AS n FROM restock_outbox WHERE status='PENDING'")
    };
  }
  runtimeInfo() { return { schemaVersion: this.db.diagnostics().schemaVersion, sqliteVersion: string(required(this.db.get('SELECT sqlite_version() AS version'))['version']) }; }
}
