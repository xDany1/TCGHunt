import { assessEvidence } from './evidence.js';
import type { Observed } from './evidence.js';
import { add, subtract, multiply, money, ratio, ceilDivide } from './money.js';
import type { Money, Ratio, Currency } from './money.js';
import type { CanonicalProduct, ListingObservation } from './identity.js';
import { check, combine, freeze, positiveInteger } from './value.js';
import type { Check, Id } from './value.js';

export interface CostScenario {
  readonly id: string;
  readonly benchmark: {
    readonly kind: 'MANUAL_ESTIMATE'; readonly canonicalId: Id<'canonical'>;
    readonly quantity: number; readonly grossResale: Observed<Money>;
  };
  readonly otherAcquisition: Observed<Money>;
  readonly verifiedDiscount: Observed<Money>;
  readonly outbound: Observed<Money>;
  readonly lossAllowance: Observed<Money>;
  readonly fixedFee: Observed<Money>;
  readonly feeBasisPoints: number;
}
export interface OpportunityBase {
  readonly id: string; readonly calculationVersion: 'm1-cost-v1';
  readonly observationId: Id<'observation'>; readonly scenarioId: string;
  readonly evaluatedAt: number; readonly checks: readonly Check[];
}
export type OpportunityEvaluation = OpportunityBase & (
  | { readonly status: 'INDETERMINATE'; }
  | {
    readonly status: 'COMPLETE'; readonly acquisitionCost: Money; readonly resale: Money;
    readonly fees: Money; readonly grossProfit: Money; readonly netProfit: Money;
    readonly roi: Ratio | undefined; readonly margin: Ratio | undefined; readonly breakEven: Money;
  }
);

export function evaluateOpportunity(input: {
  readonly id: string; readonly target: CanonicalProduct; readonly observation: ListingObservation;
  readonly scenario: CostScenario; readonly quantity: number; readonly currency: Currency; readonly now: number;
}): OpportunityEvaluation {
  const { observation: o, scenario: s, quantity: q, currency, now } = input;
  positiveInteger(q);
  positiveInteger(s.benchmark.quantity);
  if (!Number.isSafeInteger(s.feeBasisPoints) || s.feeBasisPoints < 0 || s.feeBasisPoints >= 10_000) throw new RangeError('Fee must be between 0 and 9999 basis points');
  const fields = [o.unitPrice, o.shipping, o.additionalTax, s.otherAcquisition, s.verifiedDiscount,
  s.outbound, s.lossAllowance, s.fixedFee, s.benchmark.grossResale];
  const checks = fields.map(field => assessEvidence(field, now));
  checks.push(check('BENCHMARK_COMPARABILITY', s.benchmark.kind === 'MANUAL_ESTIMATE' && s.benchmark.canonicalId === input.target.id && s.benchmark.quantity === q ? 'PASS' : 'INDETERMINATE'));
  checks.push(check('COST_CURRENCY', fields.every(f => f.state !== 'KNOWN' || f.value.currency === currency) ? 'PASS' : 'INDETERMINATE'));
  checks.push(check('NONNEGATIVE_COST_INPUTS', fields.every(f => f.state !== 'KNOWN' || f.value.minor >= 0n) ? 'PASS' : 'INDETERMINATE'));
  const base: OpportunityBase = {
    id: input.id, calculationVersion: 'm1-cost-v1', observationId: o.id,
    scenarioId: s.id, evaluatedAt: now, checks
  };
  if (combine(checks) !== 'PASS' || o.unitPrice.state !== 'KNOWN' || o.shipping.state !== 'KNOWN' || o.additionalTax.state !== 'KNOWN'
    || s.otherAcquisition.state !== 'KNOWN' || s.verifiedDiscount.state !== 'KNOWN' || s.outbound.state !== 'KNOWN'
    || s.lossAllowance.state !== 'KNOWN' || s.fixedFee.state !== 'KNOWN' || s.benchmark.grossResale.state !== 'KNOWN') {
    return freeze({ ...base, status: 'INDETERMINATE' });
  }
  const cost = subtract(add(add(add(multiply(o.unitPrice.value, q), o.shipping.value), o.additionalTax.value), s.otherAcquisition.value), s.verifiedDiscount.value);
  if (cost.minor < 0n) return freeze({ ...base, checks: [...checks, check('NEGATIVE_ACQUISITION_COST', 'INDETERMINATE')], status: 'INDETERMINATE' });
  const resale = s.benchmark.grossResale.value;
  // Conservative fees: round upward once, at the lot level, to whole minor units.
  const fees = add(money(ceilDivide(resale.minor * BigInt(s.feeBasisPoints), 10_000n), currency), s.fixedFee.value);
  const grossProfit = subtract(resale, cost);
  const netProfit = subtract(subtract(subtract(grossProfit, fees), s.outbound.value), s.lossAllowance.value);
  const breakEven = money(ceilDivide((cost.minor + s.outbound.value.minor + s.lossAllowance.value.minor + s.fixedFee.value.minor) * 10_000n,
    10_000n - BigInt(s.feeBasisPoints)), currency);
  return freeze({
    ...base, status: 'COMPLETE', acquisitionCost: cost, resale, fees, grossProfit, netProfit,
    roi: ratio(netProfit.minor, cost.minor), margin: ratio(netProfit.minor, resale.minor), breakEven
  });
}
