/** IPC v1: plain, bounded presentation values. No aggregates, bigint, SQL or executable methods. */
export const IPC_VERSION = 1;
export interface FieldView { readonly state: 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE'; readonly value: string | null; readonly reason: string | null; }
export interface ObservationView {
  readonly id: string; readonly offerId: string; readonly productId: string; readonly variantId: string; readonly listingId: string;
  readonly sellerId: string; readonly storeId: string; readonly title: string; readonly variant: string; readonly sku: string | null;
  readonly source: string | null; readonly price: FieldView; readonly stock: FieldView; readonly saleAvailable: boolean | null;
  readonly quantity: FieldView; readonly shipping: FieldView; readonly tax: FieldView; readonly seller: FieldView;
  readonly capturedAt: number; readonly receivedAt: number; readonly sourceObservedAt: number; readonly expiresAt: number;
  readonly stale: boolean; readonly adapterVersion: string; readonly parserVersion: string; readonly basis: string;
}
export interface EvaluationView {
  readonly id: string; readonly monitorId: string; readonly runId: string; readonly observation: ObservationView;
  readonly evaluatedAt: number; readonly outcome: string; readonly arithmetic: string; readonly sellerStatus: string;
  readonly mapping: string; readonly benchmark: FieldView; readonly landedCost: FieldView; readonly roi: string | null; readonly margin: string | null;
  readonly checks: readonly { readonly code: string; readonly result: string; readonly field: string | null; readonly reason: string | null; }[];
  readonly decision: 'BLOCKED' | 'SIMULATED' | 'NOT_ADMITTED'; readonly intentId: string | null; readonly decisionEvaluationId: string | null;
}
export interface MonitorView {
  readonly family?: 'Shopify' | 'Amazon'; readonly provider?: 'SHOPIFY' | 'BROWSER'; readonly networkAllowed?: boolean;
  readonly product?: ProductMonitorView | null;
  readonly manageable: boolean;
  readonly id: string; readonly version: number; readonly revision: number; readonly name: string; readonly url: string;
  readonly status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; readonly cadenceSeconds: number; readonly nextDueAt: number | null;
  readonly lastRunAt: number | null; readonly lastResult: string; readonly latest: ObservationView | null;
}
export interface ProductMonitorView {
  readonly asin: string; readonly title: string; readonly availability: FieldView; readonly purchaseMode: FieldView; readonly releaseDate: FieldView;
  readonly price: FieldView; readonly seller: FieldView; readonly fulfillment: FieldView;
  readonly observedAt: number; readonly expiresAt: number; readonly stale: boolean; readonly parserVersion: string; readonly provider: string;
  readonly baseline: string; readonly outcome: string; readonly events: readonly string[];
  readonly opportunity: 'BLOCKED / INDETERMINATE'; readonly opportunityReason: string;
}
export interface HistoryView {
  readonly at: number; readonly action: string; readonly monitorId: string; readonly runId: string | null;
  readonly observationId: string | null; readonly evaluationId: string | null; readonly intentId: string | null;
  readonly outboxStatus: string | null; readonly mode: 'DRY_RUN';
}
export interface SafeSettings { readonly version: number; readonly refreshSeconds: number; readonly storeEnabled: boolean; readonly liveReadsUsed: number; readonly liveReadLimit: 6; }
export interface StoreView {
  readonly id: string; readonly name: string; readonly family: 'Shopify' | 'Amazon'; readonly domain: string;
  readonly observationHealth: string; readonly reason: string; readonly lastSuccessAt: number | null; readonly lastFailureAt: number | null;
  readonly adapterVersion: string; readonly parserVersion: string; readonly policy: string;
  readonly unsupported: readonly ['Search', 'Cart', 'Checkout', 'Order Submission'];
}
export interface MonitoringAlertView {
  readonly eventId: string; readonly monitorId: string; readonly storeId: string; readonly provider: string; readonly productId: string; readonly title: string;
  readonly eventType: string; readonly previousState: string; readonly currentState: string; readonly purchaseMode: string; readonly releaseDate: string | null;
  readonly observedAt: number; readonly provenance: string; readonly stale: boolean; readonly delivery: 'PENDING' | 'DELIVERED' | 'DEAD_LETTER';
  readonly opportunityStatus: 'BLOCKED' | 'EVALUATED'; readonly arithmetic: 'COMPLETE' | 'INDETERMINATE'; readonly reasons: readonly string[];
  readonly purchaseReady: false; readonly execution: 'NOT_REQUESTED';
}
export interface WorkspaceView {
  readonly alerts: readonly MonitoringAlertView[];
  readonly version: 1; readonly now: number; readonly dryRun: true; readonly status: 'RUNNING' | 'SUSPENDED' | 'STOPPED' | 'DATABASE_UNAVAILABLE';
  readonly reason: string; readonly networkEnabled: boolean; readonly fixtureMode: boolean;
  readonly dashboard: {
    readonly activeMonitors: number; readonly delayedMonitors: number; readonly productsObservedToday: number; readonly opportunitiesOpen: number;
    readonly simulationsBlockedToday: number; readonly wouldHaveExecutedToday: number; readonly lastObservationAt: number | null;
  };
  readonly monitors: readonly MonitorView[]; readonly products: readonly ObservationView[]; readonly evaluations: readonly EvaluationView[];
  readonly history: readonly HistoryView[]; readonly stores: readonly StoreView[]; readonly settings: SafeSettings;
  readonly diagnostics: { readonly schemaVersion: number | null; readonly sqliteVersion: string | null; readonly databaseLocation: string; readonly pendingOutbox: number; readonly truncated: boolean; };
}
export interface MonitorInput { readonly name: string; readonly url: string; readonly cadenceSeconds: number; }
export interface VersionedId { readonly id: string; readonly expectedVersion: number; }
export interface Inputs {
  readonly getWorkspace: null;
  readonly getProductHistory: { readonly offerId: string; };
  readonly getEvaluation: { readonly id: string; };
  readonly createMonitor: MonitorInput;
  readonly updateMonitor: MonitorInput & VersionedId;
  readonly pauseMonitor: VersionedId; readonly resumeMonitor: VersionedId; readonly archiveMonitor: VersionedId;
  readonly runMonitorNow: { readonly id: string; };
  readonly updateSafeSettings: { readonly expectedVersion: number; readonly refreshSeconds: number; readonly storeEnabled: boolean; };
  readonly openProduct: { readonly offerId: string; };
}
export interface Outputs {
  readonly getWorkspace: WorkspaceView; readonly getProductHistory: readonly ObservationView[]; readonly getEvaluation: EvaluationView;
  readonly createMonitor: { readonly id: string; }; readonly updateMonitor: { readonly id: string; };
  readonly pauseMonitor: { readonly id: string; }; readonly resumeMonitor: { readonly id: string; }; readonly archiveMonitor: { readonly id: string; };
  readonly runMonitorNow: { readonly id: string; }; readonly updateSafeSettings: { readonly id: string; }; readonly openProduct: { readonly id: string; };
}
export type Command = keyof Inputs;
export type Reply<T> = { readonly ok: true; readonly value: T; } | { readonly ok: false; readonly code: string; readonly diagnosticId: string; };
export type DesktopBridge = { readonly [K in Command]: (input: Inputs[K]) => Promise<Reply<Outputs[K]>>; };
export const COMMANDS: readonly Command[] = ['getWorkspace', 'getProductHistory', 'getEvaluation', 'createMonitor', 'updateMonitor', 'pauseMonitor', 'resumeMonitor', 'archiveMonitor', 'runMonitorNow', 'updateSafeSettings', 'openProduct'];
export class ContractFailure extends Error {
  constructor(readonly code: 'UNKNOWN_COMMAND' | 'INVALID_PAYLOAD' | 'PAYLOAD_TOO_LARGE' | 'UNTRUSTED_SENDER' | 'RATE_LIMITED') { super(code); }
}
const id = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
const positive = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
export function validateCommand<K extends Command>(command: K, input: unknown): Inputs[K];
export function validateCommand(command: string, input: unknown): Inputs[Command];
export function validateCommand(command: string, input: unknown): Inputs[Command] {
  if (!COMMANDS.some(c => c === command)) throw new ContractFailure('UNKNOWN_COMMAND');
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { throw new ContractFailure('INVALID_PAYLOAD'); }
  if (typeof serialized !== 'string') throw new ContractFailure('INVALID_PAYLOAD');
  if (serialized.length > 4096 || new TextEncoder().encode(serialized).length > 8192) throw new ContractFailure('PAYLOAD_TOO_LARGE');
  if (command === 'getWorkspace') { if (input !== null) throw new ContractFailure('INVALID_PAYLOAD'); return null; }
  const decoded: unknown = JSON.parse(serialized);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new ContractFailure('INVALID_PAYLOAD');
  const p = decoded as Record<string, unknown>;
  const fields: Record<string, (value: unknown) => boolean> = {};
  if (['getProductHistory', 'openProduct'].includes(command)) fields['offerId'] = id;
  else if (['getEvaluation', 'runMonitorNow'].includes(command)) fields['id'] = id;
  else if (command === 'updateSafeSettings') {
    fields['expectedVersion'] = positive;
    fields['refreshSeconds'] = v => typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 60;
    fields['storeEnabled'] = v => typeof v === 'boolean';
  } else {
    if (command !== 'createMonitor') { fields['id'] = id; fields['expectedVersion'] = positive; }
    if (command === 'createMonitor' || command === 'updateMonitor') {
      fields['name'] = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 80 && !/[\u0000-\u001f]/.test(v);
      fields['url'] = v => typeof v === 'string' && v.length <= 2048 && v.length > 0;
      fields['cadenceSeconds'] = v => typeof v === 'number' && Number.isInteger(v) && v >= 60 && v <= 86400;
    }
  }
  if (Object.keys(p).length !== Object.keys(fields).length || Object.keys(p).some(k => !Object.hasOwn(fields, k)) || Object.entries(fields).some(([key, valid]) => !valid(p[key]))) throw new ContractFailure('INVALID_PAYLOAD');
  // Copy only validated data so callers cannot change an in-flight request after validation.
  return Object.freeze(p) as unknown as Inputs[Command];
}
export function decisionLabel(state: string): string { return state === 'SIMULATED' ? 'Would Have Executed' : state === 'BLOCKED' ? 'Simulation Blocked' : 'Not Admitted'; }
