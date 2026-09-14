import { check, combine, freeze, instant, money, simulate } from '@ptcg/core';
import type { Currency, SimulationResult } from '@ptcg/core';
import { guardTransition, operationSubject, PersistenceFailure, stableKey, utcDay, validateLimits } from '@ptcg/application';
import type { CommittedDecision, DecisionEvidence, DecisionHistory, ExecutionRepository, LocalOwnerId, MonitorSnapshot, OutboxEvent, RunCommand, SafeAudit, SimulatedLimitPolicy } from '@ptcg/application';
import { encode, decode } from './codec.js';
import { Database, integer, required, string, units } from './database.js';

interface BucketRequest {
  readonly id: string; readonly kind: 'DAILY_SPEND' | 'PRODUCT_QUANTITY' | 'DAILY_ATTEMPTS';
  readonly cap: bigint; readonly proposed: bigint; readonly consumed: bigint;
}

export class SqliteExecution implements ExecutionRepository {
  constructor(private readonly db: Database) { }
  configureLimits(policy: SimulatedLimitPolicy, expectedVersion: number | null, now: number): void {
    freeze(policy);
    validateLimits(policy);
    instant(now);
    this.db.transaction(() => {
      const current = this.db.get('SELECT * FROM simulated_owners WHERE owner_id=?', policy.ownerId);
      if (current) {
        if (integer(current['current_version']) !== expectedVersion || policy.version !== expectedVersion + 1) throw new PersistenceFailure('STALE_VERSION');
        if (current['currency'] !== policy.dailySpend.currency || current['timezone'] !== policy.timezone) throw new PersistenceFailure('CONFLICT');
        this.db.run('UPDATE simulated_owners SET current_version=? WHERE owner_id=? AND current_version=?', policy.version, policy.ownerId, expectedVersion);
      } else {
        if (expectedVersion !== null || policy.version !== 1) throw new PersistenceFailure('STALE_VERSION');
        this.db.run('INSERT INTO simulated_owners(owner_id,current_version,currency,timezone) VALUES(?,?,?,?)', policy.ownerId, policy.version, policy.dailySpend.currency, policy.timezone);
      }
      this.db.run('INSERT INTO simulated_limit_policies VALUES(?,?,?,?)', policy.ownerId, policy.version, encode(policy), now);
      this.db.run("INSERT INTO simulated_policy_audit VALUES(?,?,?,'SIMULATED_LIMIT_POLICY_CHANGED')", policy.ownerId, policy.version, now);
    });
  }
  findOperation(monitor: MonitorSnapshot, command: RunCommand): CommittedDecision | null {
    const row = this.db.get('SELECT * FROM simulated_operations WHERE owner_id=? AND operation_id=?', monitor.definition.ownerId, command.operationId);
    if (!row) return null;
    if (row['subject'] !== operationSubject(monitor, command)) throw new PersistenceFailure('CONFLICT');
    return this.result(string(row['intent_id']), 'OPERATION');
  }
  private result(intentId: string, reason: CommittedDecision['reason']): CommittedDecision {
    const simulation = decode<SimulationResult>(required(this.db.get('SELECT result FROM purchase_intents WHERE id=?', intentId))['result']);
    if (simulation.mode !== 'DRY_RUN' || !['SIMULATED', 'BLOCKED'].includes(simulation.intentState)) throw new PersistenceFailure('STORAGE_FAILURE');
    return freeze({ status: reason === 'NEW_DECISION' ? 'COMMITTED' : 'DUPLICATE', reason, simulation });
  }
  private recordOperation(m: MonitorSnapshot, c: RunCommand, intentId: string): void {
    this.db.run('INSERT INTO simulated_operations VALUES(?,?,?,?)', m.definition.ownerId, c.operationId, operationSubject(m, c), intentId);
  }

  commitSimulatedDecision(e: DecisionEvidence): CommittedDecision {
    freeze(e);
    return this.db.transaction(() => {
      const { monitor: m, command: c, request: r, evaluation: v } = e;
      const d = m.definition;
      const previous = this.findOperation(m, c);
      if (previous) return previous;
      const stored = required(this.db.get('SELECT snapshot FROM decision_evaluations WHERE id=?', v.opportunity.id));
      if (stored['snapshot'] !== encode(e)) throw new PersistenceFailure('CONFLICT');
      const monitor = required(this.db.get('SELECT * FROM monitors WHERE id=?', d.monitorId));
      if (integer(monitor['version']) !== m.version || integer(monitor['current_revision']) !== c.revision || monitor['status'] !== 'ACTIVE') throw new PersistenceFailure('STALE_VERSION');
      const cycle = this.db.get('SELECT id,canonical_id,campaign_id FROM purchase_intents WHERE owner_id=? AND cycle_id=?', d.ownerId, d.cycleId);
      if (cycle) {
        if (cycle['canonical_id'] !== r.target.id || cycle['campaign_id'] !== d.campaignId) throw new PersistenceFailure('CONFLICT');
        const intentId = string(cycle['id']);
        this.recordOperation(m, c, intentId);
        return this.result(intentId, 'CYCLE');
      }
      const guard = this.db.get('SELECT * FROM simulated_product_guards WHERE owner_id=? AND canonical_id=?', d.ownerId, r.target.id);
      if (guard && integer(guard['blocked_until']) > c.now) {
        const intentId = string(guard['intent_id']);
        this.recordOperation(m, c, intentId);
        return this.result(intentId, 'PRODUCT_GUARD');
      }
      const owner = required(this.db.get('SELECT * FROM simulated_owners WHERE owner_id=?', d.ownerId));
      const policy = decode<SimulatedLimitPolicy>(required(this.db.get('SELECT snapshot FROM simulated_limit_policies WHERE owner_id=? AND version=?', d.ownerId, integer(owner['current_version'])))['snapshot']);
      const day = utcDay(c.now);
      const actual = v.opportunity.status === 'COMPLETE' ? v.opportunity.acquisitionCost.minor : 0n;
      const buckets: readonly BucketRequest[] = [
        { id: stableKey('DRY_RUN', d.ownerId, 'DAILY_SPEND', day.start), kind: 'DAILY_SPEND', cap: policy.dailySpend.minor, proposed: r.purchasePolicy.maximumOrderValue.minor, consumed: actual },
        { id: stableKey('DRY_RUN', d.ownerId, 'PRODUCT_QUANTITY', d.campaignId, r.target.id), kind: 'PRODUCT_QUANTITY', cap: BigInt(policy.productCampaignQuantity), proposed: BigInt(r.quantity), consumed: BigInt(r.quantity) },
        { id: stableKey('DRY_RUN', d.ownerId, 'DAILY_ATTEMPTS', day.start), kind: 'DAILY_ATTEMPTS', cap: BigInt(policy.dailyAttempts), proposed: 1n, consumed: 1n }
      ];
      const limitChecks = buckets.map(b => {
        const existing = this.db.get('SELECT held,consumed FROM simulated_limit_buckets WHERE id=?', b.id);
        const used = existing ? units(existing['held']) + units(existing['consumed']) : 0n;
        return check(`SIMULATED_${b.kind}`, b.proposed >= 0n && used + b.proposed <= b.cap ? 'PASS' : 'FAIL', { used: String(used), proposed: String(b.proposed), maximum: String(b.cap) });
      });
      limitChecks.push(check('SIMULATED_LEDGER_CURRENCY', policy.dailySpend.currency === r.currency && r.purchasePolicy.maximumOrderValue.currency === r.currency ? 'PASS' : 'FAIL'));
      limitChecks.push(check('SIMULATED_CLOCK_MONOTONIC', c.now >= integer(owner['last_admitted_at']) ? 'PASS' : 'FAIL'));
      const intentId = stableKey('DRY_RUN', d.ownerId, d.cycleId, 'intent');
      const attemptId = stableKey('DRY_RUN', d.ownerId, d.cycleId, 'attempt', 1);
      // Rebuild the pure trace with durable limits. The M1 candidate is never a committed fact.
      const simulation = simulate({ ...v.simulation.scope, intentId, attemptId }, [...v.simulation.checks, ...limitChecks], c.now);
      const passed = combine(simulation.checks) === 'PASS';
      this.db.run("INSERT INTO purchase_intents(id,owner_id,cycle_id,campaign_id,canonical_id,evaluation_id,mode,state,version,limit_version,scope) VALUES(?,?,?,?,?,?,'DRY_RUN','CREATED',0,?,?)",
        intentId, d.ownerId, d.cycleId, d.campaignId, r.target.id, v.opportunity.id, policy.version, encode(simulation.scope));
      this.db.fault('AFTER_INTENT');
      const auditBase = {
        occurredAt: c.now, traceId: c.traceId, operationId: c.operationId, monitorId: d.monitorId,
        offerId: simulation.scope.offerKey, evaluationId: v.opportunity.id, intentId, checkoutAttemptId: passed ? attemptId : null, mode: 'DRY_RUN' as const
      };
      this.audit({ ...auditBase, action: 'INTENT_CREATED', aggregateId: intentId, aggregateVersion: 0, from: null, to: 'CREATED' });
      if (passed) {
        this.db.run("INSERT INTO simulated_reservations VALUES(?,'DRY_RUN','HELD',?,?,?,?)", intentId, r.purchasePolicy.maximumOrderValue.minor, r.currency, r.quantity, c.now);
        for (const b of buckets) {
          this.db.run('INSERT INTO simulated_limit_buckets(id,owner_id,kind,currency,starts_at,ends_at,campaign_id,canonical_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
            b.id, d.ownerId, b.kind, b.kind === 'DAILY_SPEND' ? r.currency : null, b.kind === 'PRODUCT_QUANTITY' ? null : day.start, b.kind === 'PRODUCT_QUANTITY' ? null : day.end,
            b.kind === 'PRODUCT_QUANTITY' ? d.campaignId : null, b.kind === 'PRODUCT_QUANTITY' ? r.target.id : null);
          if (this.db.run('UPDATE simulated_limit_buckets SET held=held+? WHERE id=? AND held+consumed+?<=?', b.proposed, b.id, b.proposed, b.cap) !== 1) throw new PersistenceFailure('CONFLICT');
          this.db.run('INSERT INTO simulated_reservation_lines VALUES(?,?,?)', intentId, b.id, b.proposed);
        }
        this.db.fault('AFTER_RESERVATION');
        this.db.run('INSERT INTO simulated_product_guards VALUES(?,?,?,?) ON CONFLICT(owner_id,canonical_id) DO UPDATE SET intent_id=excluded.intent_id,blocked_until=excluded.blocked_until',
          d.ownerId, r.target.id, intentId, instant(c.now + policy.cooldownMs));
        this.db.run("INSERT INTO checkout_attempts VALUES(?,?,'DRY_RUN','CREATED',0)", attemptId, intentId);
        this.audit({ ...auditBase, action: 'ATTEMPT_CREATED', aggregateId: attemptId, aggregateVersion: 0, from: null, to: 'CREATED' });
      }
      for (const transition of simulation.transitions) {
        const table = transition.aggregate === 'PurchaseIntent' ? 'purchase_intents' : 'checkout_attempts';
        const aggregateId = transition.aggregate === 'PurchaseIntent' ? intentId : attemptId;
        const current = required(this.db.get(`SELECT state,version FROM ${table} WHERE id=?`, aggregateId));
        const version = guardTransition(transition.aggregate, { state: string(current['state']), version: integer(current['version']) }, { state: transition.from, version: transition.version - 1 }, transition.to);
        if (this.db.run(`UPDATE ${table} SET state=?,version=? WHERE id=? AND state=? AND version=?`, transition.to, version, aggregateId, transition.from, version - 1) !== 1) throw new PersistenceFailure('STALE_VERSION');
        this.audit({ ...auditBase, action: 'STATE_TRANSITION', aggregateId, aggregateVersion: version, from: transition.from, to: transition.to });
      }
      if (passed) {
        for (const b of buckets) {
          this.db.run('INSERT INTO simulated_consumption VALUES(?,?,?,?,?)', intentId, b.id, b.consumed, b.proposed - b.consumed, c.now);
          if (this.db.run('UPDATE simulated_limit_buckets SET held=held-?,consumed=consumed+? WHERE id=? AND held>=?', b.proposed, b.consumed, b.id, b.proposed) !== 1) throw new PersistenceFailure('CONFLICT');
        }
        if (this.db.run("UPDATE simulated_reservations SET state='CONSUMED' WHERE intent_id=? AND state='HELD'", intentId) !== 1) throw new PersistenceFailure('CONFLICT');
        this.db.run('UPDATE simulated_owners SET last_admitted_at=? WHERE owner_id=?', c.now, d.ownerId);
      }
      const intentVersion = simulation.transitions.filter(t => t.aggregate === 'PurchaseIntent').length;
      this.audit({ ...auditBase, action: simulation.audit.action, aggregateId: intentId, aggregateVersion: intentVersion, from: null, to: simulation.intentState });
      const event: OutboxEvent = {
        eventId: stableKey(intentId, intentVersion, 'decision'), eventType: passed ? 'PurchaseWouldHaveExecuted' : 'PurchaseBlocked', schemaVersion: 1,
        aggregateType: 'PurchaseIntent', aggregateId: intentId, aggregateVersion: intentVersion, correlationId: c.operationId,
        causationId: v.opportunity.id, traceId: c.traceId, occurredAt: c.now, recordedAt: c.now, mode: 'DRY_RUN', payload: { evaluationId: v.opportunity.id, intentId }
      };
      this.db.run('INSERT INTO event_outbox(event_id,intent_id,aggregate_version,event_type,schema_version,envelope,next_attempt_at) VALUES(?,?,?,?,?,?,?)', event.eventId, intentId, intentVersion, event.eventType, event.schemaVersion, encode(event), c.now);
      this.db.run('UPDATE purchase_intents SET result=? WHERE id=?', encode(simulation), intentId);
      this.recordOperation(m, c, intentId);
      this.db.fault('BEFORE_COMMIT');
      return this.result(intentId, 'NEW_DECISION');
    });
  }
  private audit(event: SafeAudit): void {
    this.db.fault('BEFORE_AUDIT');
    this.db.run('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)', stableKey(event.aggregateId, event.aggregateVersion, event.action), event.intentId,
      event.aggregateId, event.aggregateVersion, event.action, event.occurredAt, encode(event));
  }
  getDecisionHistory(intentId: string): DecisionHistory {
    const intent = required(this.db.get('SELECT version FROM purchase_intents WHERE id=?', intentId));
    const attempt = this.db.get('SELECT version FROM checkout_attempts WHERE intent_id=?', intentId);
    const reservation = this.db.get("SELECT r.*,c.units FROM simulated_reservations r JOIN simulated_reservation_lines l ON l.intent_id=r.intent_id JOIN simulated_limit_buckets b ON b.id=l.bucket_id AND b.kind='DAILY_SPEND' JOIN simulated_consumption c ON c.intent_id=l.intent_id AND c.bucket_id=l.bucket_id WHERE r.intent_id=?", intentId);
    return freeze({
      simulation: this.result(intentId, 'OPERATION').simulation, intentVersion: integer(intent['version']), attemptVersion: attempt ? integer(attempt['version']) : null,
      reservation: reservation ? { state: 'CONSUMED', upperBound: money(units(reservation['upper_minor']), string(reservation['currency']) as Currency), consumed: money(units(reservation['units']), string(reservation['currency']) as Currency), quantity: integer(reservation['quantity']) } : null,
      audit: this.db.all('SELECT snapshot FROM audit_events WHERE intent_id=? ORDER BY rowid', intentId).map(row => decode<SafeAudit>(row['snapshot']))
    });
  }
  getUsage(ownerId: LocalOwnerId, campaignId: string, canonicalId: string, now: number) {
    const owner = required(this.db.get('SELECT currency FROM simulated_owners WHERE owner_id=?', ownerId));
    const day = utcDay(now);
    const spend = this.db.get('SELECT held,consumed FROM simulated_limit_buckets WHERE id=?', stableKey('DRY_RUN', ownerId, 'DAILY_SPEND', day.start));
    const quantity = this.db.get('SELECT held+consumed AS total FROM simulated_limit_buckets WHERE id=?', stableKey('DRY_RUN', ownerId, 'PRODUCT_QUANTITY', campaignId, canonicalId));
    const attempts = this.db.get('SELECT held+consumed AS total FROM simulated_limit_buckets WHERE id=?', stableKey('DRY_RUN', ownerId, 'DAILY_ATTEMPTS', day.start));
    return freeze({ currency: string(owner['currency']) as Currency, dailySpent: spend ? units(spend['consumed']) : 0n, dailyHeld: spend ? units(spend['held']) : 0n, campaignQuantity: quantity ? units(quantity['total']) : 0n, dailyAttempts: attempts ? units(attempts['total']) : 0n });
  }
}
