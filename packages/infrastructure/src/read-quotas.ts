import { instant, positiveInteger } from '@ptcg/core';
import type { AdapterError, ReadQuotaRepository } from '@ptcg/application';
import { Database, integer, required } from './database.js';

export class SqliteReadQuotas implements ReadQuotaRepository {
  constructor(private readonly db: Database) { }
  claimReadSlot(scope: string, now: number, intervalMs: number) {
    instant(now); positiveInteger(intervalMs);
    return this.db.transaction(() => {
      this.db.run('INSERT INTO read_quotas VALUES(?,?,NULL) ON CONFLICT DO NOTHING', scope, now);
      const row = required(this.db.get('SELECT * FROM read_quotas WHERE scope=?', scope));
      const nextAt = integer(row['next_at']);
      const blocked = row['blocked'] as AdapterError['code'] | null;
      if (blocked || nextAt > now) return { granted: false, nextAt, blocked };
      const next = instant(now + intervalMs);
      this.db.run('UPDATE read_quotas SET next_at=? WHERE scope=?', next, scope);
      return { granted: true, nextAt: next, blocked: null };
    });
  }
  deferReads(scope: string, nextAt: number, blocked?: AdapterError['code']): void {
    instant(nextAt);
    this.db.transaction(() => {
      this.db.run('INSERT INTO read_quotas VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET next_at=MAX(next_at,excluded.next_at),blocked=COALESCE(excluded.blocked,blocked)', scope, nextAt, blocked ?? null);
    });
  }
}
