import { freeze, instant, positiveInteger } from '@ptcg/core';
import type { Id } from '@ptcg/core';
import { PersistenceFailure, isProductMonitor, restockScopeKey } from '@ptcg/application';
import type { AnyMonitorDefinition as MonitorDefinition, MonitorRepository, MonitorRun, MonitorSnapshot, RunCommand } from '@ptcg/application';
import { decode, encode } from './codec.js';
import { Database, integer, required, string } from './database.js';

export class SqliteMonitors implements MonitorRepository {
  constructor(private readonly db: Database) { }
  publishRevision(definition: MonitorDefinition, expectedVersion: number | null, now: number): MonitorSnapshot {
    freeze(definition);
    instant(now);
    const c = definition.configuration;
    if (definition.desktop && (definition.desktop.name.trim().length === 0 || definition.desktop.name.length > 80 || !Number.isInteger(definition.desktop.cadenceSeconds) || definition.desktop.cadenceSeconds < 60 || definition.desktop.cadenceSeconds > 86400)) throw new PersistenceFailure('INVALID_INPUT');
    if (isProductMonitor(c)) {
      restockScopeKey({ kind: 'PRODUCT', watchId: definition.monitorId, productRef: c.productRef, deliveryScope: c.deliveryScope });
      if (c.mode !== 'DRY_RUN' || !c.sourceReference || !c.provider || 'offerRef' in c) throw new PersistenceFailure('INVALID_INPUT');
    } else positiveInteger(c.quantity);
    if (![definition.monitorId, definition.ownerId, definition.campaignId, definition.cycleId].every(s => s.trim().length > 0) ||
      (c.mode !== undefined && c.mode !== 'DRY_RUN')) throw new PersistenceFailure('INVALID_INPUT');
    const snapshot = encode(definition);
    return this.db.transaction(() => {
      const previous = this.db.get('SELECT * FROM monitors WHERE id=?', definition.monitorId);
      let revision = 1;
      let version = 1;
      if (previous) {
        if (integer(previous['version']) !== expectedVersion) throw new PersistenceFailure('STALE_VERSION');
        if (previous['status'] === 'ARCHIVED' || previous['owner_id'] !== definition.ownerId) throw new PersistenceFailure('CONFLICT');
        revision = integer(previous['current_revision']) + 1;
        version = integer(previous['version']) + 1;
        if (this.db.run('UPDATE monitors SET current_revision=?,version=? WHERE id=? AND version=?', revision, version, definition.monitorId, expectedVersion) !== 1) throw new PersistenceFailure('STALE_VERSION');
      } else {
        if (expectedVersion !== null) throw new PersistenceFailure('STALE_VERSION');
        this.db.run('INSERT INTO monitors VALUES(?,?,?,?,?)', definition.monitorId, definition.ownerId, revision, version, 'ACTIVE');
      }
      this.db.run('INSERT INTO monitor_revisions VALUES(?,?,?,?)', definition.monitorId, revision, snapshot, now);
      if (definition.desktop) this.db.run('INSERT INTO desktop_schedule VALUES(?,?,?) ON CONFLICT(monitor_id) DO UPDATE SET cadence_seconds=excluded.cadence_seconds,next_due_at=excluded.next_due_at', definition.monitorId, definition.desktop.cadenceSeconds, now + definition.desktop.cadenceSeconds * 1000);
      this.db.run('INSERT INTO monitor_audit(monitor_id,action,version,occurred_at) VALUES(?,?,?,?)', definition.monitorId, 'REVISION_PUBLISHED', version, now);
      return this.getMonitor(definition.monitorId);
    });
  }
  getMonitor(monitorId: Id<'monitor'>): MonitorSnapshot {
    const row = required(this.db.get('SELECT m.*,r.definition FROM monitors m JOIN monitor_revisions r ON m.id=r.monitor_id AND m.current_revision=r.revision WHERE m.id=?', monitorId));
    return freeze({ definition: decode<MonitorDefinition>(row['definition']), revision: integer(row['current_revision']), status: string(row['status']) as MonitorSnapshot['status'], version: integer(row['version']) });
  }
  changeStatus(monitorId: Id<'monitor'>, status: MonitorSnapshot['status'], expectedVersion: number, now: number): MonitorSnapshot {
    instant(now);
    return this.db.transaction(() => {
      const current = this.getMonitor(monitorId);
      if (current.version !== expectedVersion) throw new PersistenceFailure('STALE_VERSION');
      if (!['ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status) || current.status === 'ARCHIVED' || current.status === status) throw new PersistenceFailure('INVALID_TRANSITION');
      if (this.db.run('UPDATE monitors SET status=?,version=version+1 WHERE id=? AND version=?', status, monitorId, expectedVersion) !== 1) throw new PersistenceFailure('STALE_VERSION');
      this.db.run('INSERT INTO monitor_audit(monitor_id,action,version,occurred_at) VALUES(?,?,?,?)', monitorId, `MONITOR_${status}`, expectedVersion + 1, now);
      if (status === 'ACTIVE') this.db.run('UPDATE desktop_schedule SET next_due_at=?+cadence_seconds*1000 WHERE monitor_id=?', now, monitorId);
      return this.getMonitor(monitorId);
    });
  }
  startRun(command: RunCommand): MonitorRun {
    instant(command.now);
    positiveInteger(command.revision);
    if (![command.runId, command.operationId, command.traceId].every(s => s.trim().length > 0)) throw new PersistenceFailure('INVALID_INPUT');
    return this.db.transaction(() => {
      const current = this.getMonitor(command.monitorId);
      if (current.revision !== command.revision) throw new PersistenceFailure('STALE_VERSION');
      if (current.status !== 'ACTIVE') throw new PersistenceFailure('CONFLICT');
      const existing = this.db.get('SELECT id FROM monitor_runs WHERE id=?', command.runId);
      if (existing) {
        const run = this.getRun(command.runId);
        if (run.command.monitorId !== command.monitorId || run.command.revision !== command.revision || run.command.operationId !== command.operationId) throw new PersistenceFailure('CONFLICT');
        if (run.status !== 'FAILED') return run;
        this.db.run("UPDATE monitor_runs SET status='RUNNING',version=version+1,reason=NULL,finished_at=NULL,command=? WHERE id=? AND version=?", encode(command), command.runId, run.version);
      } else {
        if (this.db.get("SELECT id FROM monitor_runs WHERE monitor_id=? AND revision=? AND status='RUNNING'", command.monitorId, command.revision)) throw new PersistenceFailure('CONFLICT');
        this.db.run("INSERT INTO monitor_runs(id,monitor_id,revision,operation_id,status,version,command) VALUES(?,?,?,?,'RUNNING',1,?)", command.runId, command.monitorId, command.revision, command.operationId, encode(command));
      }
      return this.getRun(command.runId);
    });
  }
  getRun(runId: string): MonitorRun {
    const row = required(this.db.get('SELECT * FROM monitor_runs WHERE id=?', runId));
    return freeze({ command: decode<RunCommand>(row['command']), status: string(row['status']) as MonitorRun['status'], version: integer(row['version']), reason: row['reason'] === null ? null : string(row['reason']) });
  }
  failRun(command: RunCommand, reason: 'READ_FAILED' | 'INVALID_INPUT' | import('@ptcg/application').AdapterError['code']): void {
    this.db.transaction(() => {
      const run = this.getRun(command.runId);
      if (run.status !== 'RUNNING' || run.command.operationId !== command.operationId) throw new PersistenceFailure('STALE_VERSION');
      this.db.run("UPDATE monitor_runs SET status='FAILED',reason=?,version=version+1,finished_at=? WHERE id=? AND version=?", reason, command.now, command.runId, run.version);
    });
  }
  /** Call only during coordinator startup, before accepting any new run. No automatic adapter replay. */
  recoverInterruptedRuns(now: number): number {
    instant(now);
    return this.db.transaction(() => {
      const runs = this.db.all("SELECT * FROM monitor_runs WHERE status='RUNNING'");
      for (const run of runs) {
        this.db.run("UPDATE monitor_runs SET status='FAILED',version=version+1,reason='RESTART_INTERRUPTED',finished_at=? WHERE id=? AND version=?", now, string(run['id']), integer(run['version']));
        this.db.run('INSERT INTO monitor_audit(monitor_id,action,version,occurred_at,run_id) VALUES(?,?,?,?,?)', string(run['monitor_id']), 'RUN_INTERRUPTED_BY_RESTART', integer(run['version']) + 1, now, string(run['id']));
      }
      return runs.length;
    });
  }
}
