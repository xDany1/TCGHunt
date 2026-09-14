import { freeze, instant, positiveInteger } from '@ptcg/core';
import { PersistenceFailure, restockSample, restockScopeKey, stableKey, transitionRestock, monitoringAlert, monitoringOpportunity } from '@ptcg/application';
import type { RestockDecision, RestockEvent, RestockInput, RestockPolicy, RestockRepository, RestockSample, RestockScope, RestockState } from '@ptcg/application';
import { Database, integer, required, string } from './database.js';
import { decode, encode } from './codec.js';

export class SqliteRestock implements RestockRepository {
  constructor(private readonly db: Database) { }
  record(input: RestockInput, policy: RestockPolicy, now: number, committed?: (decision: RestockDecision) => void): RestockDecision {
    const sample = restockSample(input, policy, now); const key = sample.scopeKey; const receipt = stableKey(key, policy.revision, input.id);
    // Receipt fingerprint is independent of processing time; delayed replay must not refresh/overwrite evidence.
    const projected = restockSample(input, policy, input.receivedAt);
    const fingerprint = encode(input.opportunityContext ? { sample: projected, opportunity: monitoringOpportunity(input, policy, input.receivedAt, input.id) } : projected);
    return this.db.transaction(() => {
      const duplicate = this.db.get('SELECT fingerprint,decision FROM restock_samples WHERE id=?', receipt);
      if (duplicate) {
        if (duplicate['fingerprint'] !== fingerprint) throw new PersistenceFailure('CONFLICT');
        const old = decode<RestockDecision>(duplicate['decision']); return freeze({ ...old, outcome: 'DUPLICATE', events: [] });
      }
      const previous = this.getState(input.scope); const transition = transitionRestock(previous, sample, input.scope, now);
      const decision: RestockDecision = freeze({
        ...transition, events: transition.events.map(event => {
          if (!previous?.baseline) throw new PersistenceFailure('CONFLICT');
          return { ...event, alert: monitoringAlert(event, previous.baseline, sample, input, policy, now) };
        })
      });
      if (!previous) this.db.run('INSERT INTO restock_scopes VALUES(?,?,?)', key, encode(input.scope), encode(decision.state));
      else if (decision.outcome !== 'IGNORED_OLD') this.db.run('UPDATE restock_scopes SET state=? WHERE scope_key=?', encode(decision.state), key);
      this.db.run('INSERT INTO restock_samples VALUES(?,?,?,?,?,?)', receipt, key, input.id, fingerprint, encode(sample), encode(decision));
      for (const event of decision.events) {
        this.db.run('INSERT INTO restock_events VALUES(?,?,?,?)', event.id, key, receipt, encode(event));
        this.db.run("INSERT INTO restock_outbox(event_id,status,attempts,next_at) VALUES(?,'PENDING',0,?)", event.id, now);
      }
      committed?.(decision);
      this.db.fault('BEFORE_COMMIT'); return decision;
    });
  }
  getState(scope: RestockScope): RestockState | null { const r = this.db.get('SELECT state FROM restock_scopes WHERE scope_key=?', restockScopeKey(scope)); return r ? decode<RestockState>(r['state']) : null; }
  getSamples(scope: RestockScope): readonly RestockSample[] { return freeze(this.db.all('SELECT sample FROM restock_samples WHERE scope_key=? ORDER BY rowid', restockScopeKey(scope)).map(r => decode<RestockSample>(r['sample']))); }
  getEvents(scope: RestockScope): readonly RestockEvent[] { return freeze(this.db.all('SELECT envelope FROM restock_events WHERE scope_key=? ORDER BY rowid', restockScopeKey(scope)).map(r => decode<RestockEvent>(r['envelope']))); }
  /** Local durable inbox only. Receipt and local effect are the same row; no external notification or execution callback. */
  deliverPending(now: number): { readonly delivered: number; readonly failed: number; } {
    instant(now); let delivered = 0; let failed = 0;
    for (const row of this.db.all("SELECT event_id FROM restock_outbox WHERE status='PENDING' AND next_at<=? ORDER BY rowid LIMIT 100", now)) {
      const id = string(row['event_id']);
      try {
        this.db.transaction(() => {
          const event = decode<RestockEvent>(required(this.db.get('SELECT envelope FROM restock_events WHERE event_id=?', id))['envelope']);
          if (event.schemaVersion !== 1 || event.mode !== 'DRY_RUN' || event.id !== id || !['RESTOCK_DETECTED', 'AVAILABILITY_LOST', 'APPROVED_OFFER_BECAME_AVAILABLE', 'APPROVED_OFFER_BECAME_UNAVAILABLE', 'PRICE_ENTERED_RANGE', 'PRICE_LEFT_RANGE', 'PREORDER_OPENED', 'PREORDER_CLOSED', 'PURCHASE_MODE_CHANGED'].includes(event.type)) throw new PersistenceFailure('INVALID_INPUT');
          this.db.run('INSERT OR IGNORE INTO restock_receipts VALUES(?,?,?)', 'restock-local-inbox-v1', id, now);
          this.db.fault('AFTER_HANDLER_EFFECT');
        });
        this.db.fault('AFTER_HANDLER_RECEIPT');
        this.db.transaction(() => { this.db.run("UPDATE restock_outbox SET status='DELIVERED' WHERE event_id=?", id); }); delivered++;
      } catch (error) {
        if (error instanceof PersistenceFailure && error.code === 'RECOVERY_READ_ONLY') throw error;
        failed++; this.db.transaction(() => {
          const attempts = positiveInteger(integer(required(this.db.get('SELECT attempts FROM restock_outbox WHERE event_id=?', id))['attempts']) + 1);
          this.db.run("UPDATE restock_outbox SET status=?,attempts=?,next_at=? WHERE event_id=?", attempts >= 3 ? 'DEAD_LETTER' : 'PENDING', attempts, now + attempts * 1000, id);
        });
      }
    }
    return { delivered, failed };
  }
  listAlerts() {
    return freeze(this.db.all("SELECT e.envelope,o.status FROM restock_events e JOIN restock_outbox o ON o.event_id=e.event_id ORDER BY e.rowid DESC LIMIT 100").map(row => ({ event: decode<RestockEvent>(row['envelope']), delivery: string(row['status']) as 'PENDING' | 'DELIVERED' | 'DEAD_LETTER' })));
  }
  getReceipts(): readonly string[] { return freeze(this.db.all('SELECT event_id FROM restock_receipts ORDER BY rowid').map(r => string(r['event_id']))); }
}
