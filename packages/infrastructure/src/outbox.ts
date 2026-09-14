import { freeze, instant, positiveInteger } from '@ptcg/core';
import { PersistenceFailure } from '@ptcg/application';
import type { OutboxEvent, OutboxRepository, OutboxStatus } from '@ptcg/application';
import { decode } from './codec.js';
import { Database, integer, required, string } from './database.js';

const HANDLER = 'simulated-decision-notification-v1';
/** One concrete local consumer. It cannot call the coordinator or a retailer. */
export class SqliteOutbox implements OutboxRepository {
  constructor(private readonly db: Database) { }
  deliverPendingNotifications(now: number, limit = 100): { readonly delivered: number; readonly failed: number; } {
    instant(now);
    positiveInteger(limit);
    if (limit > 100) throw new PersistenceFailure('INVALID_INPUT');
    const pending = this.db.all("SELECT event_id FROM event_outbox WHERE status='PENDING' AND next_attempt_at<=? ORDER BY rowid LIMIT ?", now, limit);
    let delivered = 0;
    let failed = 0;
    for (const item of pending) {
      const eventId = string(item['event_id']);
      let incompatible = false;
      try {
        const handled = this.db.transaction(() => {
          const row = required(this.db.get('SELECT * FROM event_outbox WHERE event_id=?', eventId));
          if (row['status'] !== 'PENDING') return false;
          if (this.db.get('SELECT event_id FROM handler_receipts WHERE handler_id=? AND event_id=?', HANDLER, eventId)) return true;
          const event = decode<OutboxEvent>(row['envelope']);
          const intent = required(this.db.get('SELECT state,version,evaluation_id,mode FROM purchase_intents WHERE id=?', string(row['intent_id'])));
          incompatible = integer(row['schema_version']) !== 1 || event.schemaVersion !== 1 || event.mode !== 'DRY_RUN' || intent['mode'] !== 'DRY_RUN' ||
            !['PurchaseWouldHaveExecuted', 'PurchaseBlocked'].includes(event.eventType) || event.eventId !== eventId || event.eventType !== row['event_type'] ||
            event.aggregateType !== 'PurchaseIntent' || event.aggregateId !== row['intent_id'] || event.payload.intentId !== row['intent_id'] || event.payload.evaluationId !== intent['evaluation_id'] ||
            event.aggregateVersion !== integer(intent['version']) || event.aggregateVersion !== integer(row['aggregate_version']) ||
            (event.eventType === 'PurchaseWouldHaveExecuted' ? intent['state'] !== 'SIMULATED' : intent['state'] !== 'BLOCKED');
          if (incompatible) throw new PersistenceFailure('INVALID_INPUT');
          this.db.run('INSERT INTO simulated_notifications VALUES(?,?,?)', event.eventId, event.aggregateId, event.eventType);
          this.db.fault('AFTER_HANDLER_EFFECT');
          this.db.run('INSERT INTO handler_receipts VALUES(?,?,?)', HANDLER, eventId, now);
          return true;
        });
        if (!handled) continue;
        // Separate acknowledgement intentionally allows duplicate delivery after a crash.
        this.db.fault('AFTER_HANDLER_RECEIPT');
        this.db.transaction(() => {
          this.db.run("UPDATE event_outbox SET status='DELIVERED',last_error=NULL WHERE event_id=? AND status='PENDING'", eventId);
        });
        delivered++;
      } catch (error) {
        if (error instanceof PersistenceFailure && error.code === 'RECOVERY_READ_ONLY') throw error;
        failed++;
        this.db.transaction(() => {
          const row = required(this.db.get('SELECT attempts,status FROM event_outbox WHERE event_id=?', eventId));
          if (row['status'] !== 'PENDING') return;
          const attempts = integer(row['attempts']) + 1;
          this.db.run('UPDATE event_outbox SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE event_id=?', incompatible || attempts >= 3 ? 'DEAD_LETTER' : 'PENDING', attempts,
            instant(now + attempts * 1_000), incompatible ? 'INCOMPATIBLE_EVENT' : 'HANDLER_FAILED', eventId);
        });
      }
    }
    return { delivered, failed };
  }
  getOutbox(): readonly OutboxStatus[] {
    return freeze(this.db.all('SELECT event_id,status,attempts,last_error FROM event_outbox ORDER BY rowid').map(row => ({
      eventId: string(row['event_id']), status: string(row['status']) as OutboxStatus['status'], attempts: integer(row['attempts']),
      lastError: row['last_error'] === null ? null : string(row['last_error']) as OutboxStatus['lastError']
    })));
  }
  getNotifications() {
    return freeze(this.db.all('SELECT * FROM simulated_notifications ORDER BY rowid').map(row => ({ eventId: string(row['event_id']), intentId: string(row['intent_id']), action: string(row['action']) as OutboxEvent['eventType'] })));
  }
}
