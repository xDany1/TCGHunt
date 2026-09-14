import { DurableCoordinator } from '@ptcg/application';
import type { MonitorRepository, EvidenceRepository, ExecutionRepository, OutboxRepository } from '@ptcg/application';
import { Database } from './database.js';
import type { DatabaseOptions } from './database.js';
import { SqliteMonitors } from './monitors.js';
import { SqliteEvidence } from './evidence.js';
import { SqliteExecution } from './execution.js';
import { SqliteOutbox } from './outbox.js';
import { SqliteReadQuotas } from './read-quotas.js';
import type { ReadQuotaRepository } from '@ptcg/application';
import type { DesktopRepository } from '@ptcg/application';
import { SqliteDesktop } from './desktop.js';
import { SqliteRestock } from './restock.js';
import type { RestockRepository } from '@ptcg/application';
import type { ProductMonitoringRepository } from '@ptcg/application';
import { SqliteProductMonitoring } from './product-monitoring.js';

export type { DatabaseOptions, FaultPoint } from './database.js';
export interface DurableStore {
  readonly monitors: MonitorRepository; readonly evidence: EvidenceRepository;
  readonly execution: ExecutionRepository; readonly outbox: OutboxRepository;
  readonly coordinator: DurableCoordinator;
  readonly readQuotas: ReadQuotaRepository;
  readonly desktop: DesktopRepository;
  readonly restock: RestockRepository;
  readonly productMonitoring: ProductMonitoringRepository;
  diagnostics(): { readonly journalMode: string; readonly synchronous: number; readonly foreignKeys: boolean; readonly schemaVersion: number; };
  backupTo(target: string): Promise<void>;
  close(): void;
}

/** The host owns this lifecycle. No global connection, adapter database access, or background timers. */
export function openDurableStore(path: string, options: DatabaseOptions = {}): DurableStore {
  const db = new Database(path, options);
  const monitors = new SqliteMonitors(db);
  const evidence = new SqliteEvidence(db);
  const execution = new SqliteExecution(db);
  const outbox = new SqliteOutbox(db);
  return {
    monitors, evidence, execution, outbox, readQuotas: new SqliteReadQuotas(db), desktop: new SqliteDesktop(db), restock: new SqliteRestock(db), productMonitoring: new SqliteProductMonitoring(db),
    coordinator: new DurableCoordinator(monitors, evidence, execution, outbox),
    diagnostics: () => db.diagnostics(), backupTo: (target: string) => db.backupTo(target), close: () => db.close()
  };
}
