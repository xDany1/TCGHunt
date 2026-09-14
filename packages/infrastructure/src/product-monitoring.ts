import { sameRef, refKey } from '@ptcg/core';
import { isProductMonitor, PersistenceFailure, productMonitorScope, restockScopeKey, PRODUCT_MONITOR_POLICY } from '@ptcg/application';
import type { ProductMonitoringRepository, RunCommand, RestockInput } from '@ptcg/application';
import { Database } from './database.js';
import { SqliteMonitors } from './monitors.js';
import { SqliteRestock } from './restock.js';

export class SqliteProductMonitoring implements ProductMonitoringRepository {
  constructor(private readonly db: Database) { }
  complete(command: RunCommand, input: RestockInput, now: number) {
    const monitors = new SqliteMonitors(this.db); const monitor = monitors.getMonitor(command.monitorId); const c = monitor.definition.configuration;
    const run = monitors.getRun(command.runId);
    if (!isProductMonitor(c) || monitor.revision !== command.revision || run.command.monitorId !== command.monitorId || run.command.operationId !== command.operationId || run.command.revision !== command.revision || input.id !== command.runId ||
      restockScopeKey(input.scope) !== restockScopeKey(productMonitorScope(command.monitorId, c)) || input.provenance.provider !== c.provider ||
      (input.productObservation && !sameRef(input.productObservation.productRef, c.productRef))) throw new PersistenceFailure('CONFLICT');
    if (run.status !== 'SUCCEEDED' && (run.status !== 'RUNNING' || monitor.status !== 'ACTIVE')) throw new PersistenceFailure('CONFLICT');
    return new SqliteRestock(this.db).record(input, PRODUCT_MONITOR_POLICY, now, decision => {
      if (run.status !== 'RUNNING') throw new PersistenceFailure('CONFLICT');
      if (input.productObservation) {
        this.db.run('INSERT INTO store_instances VALUES(?) ON CONFLICT DO NOTHING', c.productRef.storeId);
        this.db.run('INSERT INTO store_products VALUES(?,?,?) ON CONFLICT DO NOTHING', refKey(c.productRef), c.productRef.storeId, c.productRef.externalId);
      }
      const failed = input.status === 'OBSERVATION_FAILED';
      if (failed && !/^[A-Z_]{1,60}$/.test(input.provenance.reference)) throw new PersistenceFailure('INVALID_INPUT');
      if (failed) {
        const reason = input.provenance.reference; const scope = `product:${c.productRef.storeId}:${c.provider}`;
        const blocked = ['AUTH_REQUIRED', 'BLOCKED', 'CHALLENGE_DETECTED', 'ACCESS_DENIED'].includes(reason) ? reason === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'BLOCKED' : null;
        this.db.run('INSERT INTO read_quotas VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET next_at=excluded.next_at,blocked=COALESCE(excluded.blocked,read_quotas.blocked)', scope, now + (['RATE_LIMITED', 'THROTTLED'].includes(reason) ? 3600000 : 60000), blocked);
      }
      if (this.db.run('UPDATE monitor_runs SET status=?,version=version+1,reason=?,finished_at=? WHERE id=? AND status=\'RUNNING\' AND version=?', failed ? 'FAILED' : 'SUCCEEDED', failed ? input.provenance.reference : input.status === 'OBSERVED' && decision.state.latest.comparable ? 'PRODUCT_OBSERVED' : 'CONTENT_INCOMPLETE', now, command.runId, run.version) !== 1) throw new PersistenceFailure('STALE_VERSION');
      this.db.run('INSERT INTO monitor_audit(monitor_id,action,version,occurred_at,run_id) VALUES(?,?,?,?,?)', command.monitorId, `PRODUCT_${decision.outcome}`, monitor.version, now, command.runId);
    });
  }
}
