import { check, combine, freeze, instant, positiveInteger } from './value.js';
import type { Check, Id } from './value.js';
import type { Currency, Money } from './money.js';

export type IntentState = 'CREATED' | 'VALIDATING' | 'READY' | 'IN_PROGRESS' | 'SIMULATED' | 'BLOCKED';
export type AttemptState = 'CREATED' | 'READY' | 'SIMULATED';
export interface Transition {
  readonly aggregate: 'PurchaseIntent' | 'CheckoutAttempt';
  readonly from: string; readonly to: string; readonly at: number; readonly version: number;
}
export interface SimulationScope {
  readonly intentId: string; readonly attemptId: string; readonly operationId: string; readonly traceId: string;
  readonly cycleId: string; readonly canonicalId: Id<'canonical'>; readonly offerKey: string;
  readonly variantKey: string; readonly sellerKey: string; readonly deliveryScope: string;
  readonly currency: Currency; readonly maximumOrderValue: Money; readonly scenarioId: string;
  readonly observationId: Id<'observation'>; readonly evaluationId: string;
  readonly mappingVersion: string; readonly sellerPolicyVersion: string; readonly purchasePolicyVersion: string;
  readonly quantity: number;
}
export interface SimulationResult {
  readonly mode: 'DRY_RUN'; readonly scope: SimulationScope;
  readonly intentState: IntentState; readonly attemptState: AttemptState | null;
  readonly checks: readonly Check[]; readonly transitions: readonly Transition[];
  readonly audit: {
    readonly action: 'PURCHASE_WOULD_HAVE_EXECUTED' | 'PURCHASE_BLOCKED';
    readonly mode: 'DRY_RUN'; readonly occurredAt: number; readonly evidenceIds: readonly string[];
  };
}

export function nextIntentState(current: IntentState, next: IntentState): IntentState {
  const allowed: Readonly<Record<IntentState, readonly IntentState[]>> = {
    CREATED: ['VALIDATING'], VALIDATING: ['READY', 'BLOCKED'], READY: ['IN_PROGRESS'],
    IN_PROGRESS: ['SIMULATED'], SIMULATED: [], BLOCKED: ['VALIDATING']
  };
  if (!allowed[current]?.includes(next)) throw new RangeError(`Invalid intent transition ${current} -> ${next}`);
  return next;
}
export function nextAttemptState(current: AttemptState, next: AttemptState): AttemptState {
  const allowed: Readonly<Record<AttemptState, readonly AttemptState[]>> = { CREATED: ['READY'], READY: ['SIMULATED'], SIMULATED: [] };
  if (!allowed[current]?.includes(next)) throw new RangeError(`Invalid attempt transition ${current} -> ${next}`);
  return next;
}

// This function has no adapter/transport/executor dependency and cannot submit anything.
// Admission checks are assembled by the application use case. M2 will persist its result.
export function simulate(scope: SimulationScope, admission: readonly Check[], now: number, mode: 'DRY_RUN' = 'DRY_RUN'): SimulationResult {
  instant(now);
  positiveInteger(scope.quantity);
  if (![scope.intentId, scope.attemptId, scope.operationId, scope.traceId, scope.cycleId, scope.canonicalId,
  scope.offerKey, scope.variantKey, scope.sellerKey, scope.deliveryScope, scope.observationId, scope.evaluationId,
  scope.mappingVersion, scope.sellerPolicyVersion, scope.purchasePolicyVersion, scope.scenarioId].every(value => value.trim().length > 0)) throw new RangeError('Incomplete simulation scope');
  if (mode !== 'DRY_RUN') throw new RangeError('M1 only supports DRY_RUN');
  const checks = [...admission];
  if (!admission.length) checks.push(check('MISSING_ADMISSION', 'INDETERMINATE'));
  let intentState: IntentState = 'CREATED';
  let attemptState: AttemptState | null = null;
  const transitions: Transition[] = [];
  let intentVersion = 0;
  let attemptVersion = 0;
  const moveIntent = (next: IntentState) => {
    const previous = intentState;
    intentState = nextIntentState(previous, next);
    transitions.push({ aggregate: 'PurchaseIntent', from: previous, to: next, at: now, version: ++intentVersion });
  };
  const moveAttempt = (current: AttemptState, next: AttemptState) => {
    attemptState = nextAttemptState(current, next);
    transitions.push({ aggregate: 'CheckoutAttempt', from: current, to: next, at: now, version: ++attemptVersion });
  };
  moveIntent('VALIDATING');
  const passed = combine(checks) === 'PASS';
  if (passed) {
    moveIntent('READY');
    attemptState = 'CREATED';
    moveIntent('IN_PROGRESS');
    moveAttempt('CREATED', 'READY');
    moveAttempt('READY', 'SIMULATED');
    moveIntent('SIMULATED');
  } else moveIntent('BLOCKED');
  return freeze({
    mode, scope: { ...scope }, intentState, attemptState, checks, transitions,
    audit: {
      action: passed ? 'PURCHASE_WOULD_HAVE_EXECUTED' : 'PURCHASE_BLOCKED', mode, occurredAt: now,
      evidenceIds: [...new Set(checks.flatMap(item => item.evidenceIds))]
    }
  });
}
