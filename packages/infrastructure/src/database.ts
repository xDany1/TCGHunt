import { DatabaseSync, backup } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { PersistenceFailure } from '@ptcg/application';
import { schema, SCHEMA_VERSION, migrateToM3, migrateToM4, migrateToM5_3 } from './schema.js';

export type FaultPoint = 'AFTER_INTENT' | 'AFTER_RESERVATION' | 'BEFORE_AUDIT' | 'BEFORE_COMMIT' | 'AFTER_HANDLER_EFFECT' | 'AFTER_HANDLER_RECEIPT';
export interface DatabaseOptions {
  readonly recoveryReadOnly?: boolean;
  /** Optional synchronous fault observer; no domain behavior or network is injected. */
  readonly fault?: (point: FaultPoint) => void;
}
export type Row = Record<string, SQLOutputValue>;
export function integer(value: unknown): number {
  if (typeof value !== 'bigint' && typeof value !== 'number') throw new PersistenceFailure('STORAGE_FAILURE');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new PersistenceFailure('STORAGE_FAILURE');
  return number;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new PersistenceFailure('STORAGE_FAILURE');
  return value;
}
export function units(value: unknown): bigint {
  if (typeof value !== 'bigint') throw new PersistenceFailure('STORAGE_FAILURE');
  return value;
}
export function required(row: Row | undefined): Row {
  if (!row) throw new PersistenceFailure('NOT_FOUND');
  return row;
}
function storageFailure(error: unknown): PersistenceFailure {
  if (error instanceof PersistenceFailure) return error;
  if (error !== null && typeof error === 'object' && 'errcode' in error && typeof error.errcode === 'number' && [5, 6].includes(error.errcode & 255)) return new PersistenceFailure('STORAGE_BUSY');
  return new PersistenceFailure('STORAGE_FAILURE');
}

/** Infrastructure-private connection; instantiated once by the coordinator composition root. */
export class Database {
  readonly #connection: DatabaseSync;
  #closed = false;
  #recoveryReadOnly: boolean;
  constructor(readonly path: string, private readonly options: DatabaseOptions = {}) {
    this.#recoveryReadOnly = options.recoveryReadOnly ?? false;
    let connection: DatabaseSync | undefined;
    try {
      connection = new DatabaseSync(path, { readOnly: options.recoveryReadOnly ?? false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
      this.#connection = connection;
      connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;');
      const version = integer(this.get('PRAGMA user_version')?.['user_version']);
      if (![0, 1, 2, 3, SCHEMA_VERSION].includes(version)) throw new PersistenceFailure('SCHEMA_UNSUPPORTED');
      if (options.recoveryReadOnly && version === 0) throw new PersistenceFailure('SCHEMA_UNSUPPORTED');
      if (version >= 1) this.#recoveryReadOnly ||= integer(required(this.get('SELECT recovery_required FROM database_metadata WHERE id=1'))['recovery_required']) === 1;
      if (!this.#recoveryReadOnly) {
        if (string(this.get('PRAGMA journal_mode=WAL')?.['journal_mode']) !== 'wal') throw new PersistenceFailure('STORAGE_FAILURE');
        connection.exec('PRAGMA synchronous=FULL;');
        if (version === 0) this.transaction(() => {
          if (integer(this.get('PRAGMA user_version')?.['user_version']) === 0) connection?.exec(schema);
        });
        if (integer(this.get('PRAGMA user_version')?.['user_version']) === 1) {
          // SQLite table-rebuild procedure: disable FK enforcement outside the transaction,
          // validate every FK before committing, then restore enforcement even on failure.
          connection.exec('PRAGMA foreign_keys=OFF');
          try {
            this.transaction(() => {
              if (integer(this.get('PRAGMA user_version')?.['user_version']) === 1) connection?.exec(migrateToM3);
              if (this.all('PRAGMA foreign_key_check').length) throw new PersistenceFailure('STORAGE_FAILURE');
            });
          } finally { connection.exec('PRAGMA foreign_keys=ON'); }
        }
      }
      if (!this.#recoveryReadOnly && integer(this.get('PRAGMA user_version')?.['user_version']) === 2) this.transaction(() => { connection?.exec(migrateToM4); });
      if (!this.#recoveryReadOnly && integer(this.get('PRAGMA user_version')?.['user_version']) === 3) this.transaction(() => { connection?.exec(migrateToM5_3); });
      if (this.#recoveryReadOnly) connection.exec('PRAGMA query_only=ON');
      if (integer(this.get('PRAGMA foreign_keys')?.['foreign_keys']) !== 1 ||
        string(this.get('PRAGMA quick_check')?.['quick_check']) !== 'ok' || this.all('PRAGMA foreign_key_check').length) throw new PersistenceFailure('STORAGE_FAILURE');
      // M2 has no committed in-flight simulation: all its local transitions commit together.
      // An unexplained partial ledger is recovery work, never permission to recreate an intent.
      if (this.get(`SELECT i.id FROM purchase_intents i WHERE i.result IS NULL OR i.state NOT IN ('SIMULATED','BLOCKED')
        OR NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.intent_id=i.id AND a.action=CASE i.state WHEN 'SIMULATED' THEN 'PURCHASE_WOULD_HAVE_EXECUTED' ELSE 'PURCHASE_BLOCKED' END)
        OR NOT EXISTS(SELECT 1 FROM event_outbox o WHERE o.intent_id=i.id)
        OR (i.state='SIMULATED' AND (NOT EXISTS(SELECT 1 FROM checkout_attempts a WHERE a.intent_id=i.id AND a.state='SIMULATED')
          OR NOT EXISTS(SELECT 1 FROM simulated_reservations r WHERE r.intent_id=i.id AND r.state='CONSUMED'))) LIMIT 1`)
        || this.get("SELECT intent_id FROM simulated_reservations WHERE state!='CONSUMED' LIMIT 1")
        || this.get('SELECT b.id FROM simulated_limit_buckets b WHERE b.held!=0 OR b.consumed!=COALESCE((SELECT sum(c.units) FROM simulated_consumption c WHERE c.bucket_id=b.id),0) LIMIT 1')) throw new PersistenceFailure('STORAGE_FAILURE');
    } catch (error) {
      connection?.close();
      throw storageFailure(error);
    }
  }
  get(sql: string, ...parameters: SQLInputValue[]): Row | undefined {
    try { const statement = this.#connection.prepare(sql); statement.setReadBigInts(true); return statement.get(...parameters); }
    catch (error) { throw storageFailure(error); }
  }
  all(sql: string, ...parameters: SQLInputValue[]): Row[] {
    try { const statement = this.#connection.prepare(sql); statement.setReadBigInts(true); return statement.all(...parameters); }
    catch (error) { throw storageFailure(error); }
  }
  run(sql: string, ...parameters: SQLInputValue[]): number {
    if (this.#recoveryReadOnly) throw new PersistenceFailure('RECOVERY_READ_ONLY');
    try { return Number(this.#connection.prepare(sql).run(...parameters).changes); }
    catch (error) { throw storageFailure(error); }
  }
  transaction<T>(work: () => T): T {
    if (this.#recoveryReadOnly) throw new PersistenceFailure('RECOVERY_READ_ONLY');
    try {
      this.#connection.exec('BEGIN IMMEDIATE');
      const result = work();
      if (result instanceof Promise) throw new PersistenceFailure('INVALID_INPUT');
      this.#connection.exec('COMMIT');
      return result;
    } catch (error) {
      try { if (this.#connection.isTransaction) this.#connection.exec('ROLLBACK'); } catch { /* Preserve the typed original failure; never report a commit. */ }
      throw storageFailure(error);
    }
  }
  fault(point: FaultPoint): void { this.options.fault?.(point); }
  async backupTo(path: string): Promise<void> {
    if (path === this.path) throw new PersistenceFailure('INVALID_INPUT');
    // Mark the source while taking the snapshot so even a crash between backup and return
    // cannot leave an unmarked runnable backup. The source's marker clears only on success.
    this.transaction(() => { this.run('UPDATE database_metadata SET recovery_required=1 WHERE id=1'); });
    this.#recoveryReadOnly = true;
    try {
      await backup(this.#connection, path);
      this.#connection.exec('BEGIN IMMEDIATE; UPDATE database_metadata SET recovery_required=0 WHERE id=1; COMMIT;');
      this.#recoveryReadOnly = false;
    } catch {
      // Fail closed, including for the source. Recovery requires inspection; no automatic reset.
      try { if (this.#connection.isTransaction) this.#connection.exec('ROLLBACK'); } catch { /* Remain in recovery mode. */ }
      throw new PersistenceFailure('STORAGE_FAILURE');
    }
  }
  diagnostics(): { readonly journalMode: string; readonly synchronous: number; readonly foreignKeys: boolean; readonly schemaVersion: number; } {
    return {
      journalMode: string(this.get('PRAGMA journal_mode')?.['journal_mode']), synchronous: integer(this.get('PRAGMA synchronous')?.['synchronous']),
      foreignKeys: integer(this.get('PRAGMA foreign_keys')?.['foreign_keys']) === 1, schemaVersion: integer(this.get('PRAGMA user_version')?.['user_version'])
    };
  }
  close(): void { if (!this.#closed) { this.#connection.close(); this.#closed = true; } }
}
