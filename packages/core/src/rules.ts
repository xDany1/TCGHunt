import { check, combine, freeze, positiveInteger } from './value.js';
import type { Check, Status } from './value.js';
import type { Money, Ratio } from './money.js';
import { formatMoney, ratioAtLeast } from './money.js';
import type { ListingObservation } from './identity.js';
import type { OpportunityEvaluation } from './opportunity.js';

export type PurchaseRule =
  | { readonly id: string; readonly kind: 'PRICE_AT_MOST' | 'SHIPPING_AT_MOST'; readonly maximum: Money; }
  | { readonly id: string; readonly kind: 'QUANTITY_AT_MOST'; readonly maximum: number; }
  | { readonly id: string; readonly kind: 'ROI_AT_LEAST'; readonly minimum: Ratio; };
export interface PurchasePolicy {
  readonly version: string;
  readonly expression: { readonly op: 'ALL'; readonly rules: readonly PurchaseRule[]; };
  readonly maximumOrderValue: Money;
}
export interface RuleEvaluation { readonly policyVersion: string; readonly status: Status; readonly checks: readonly Check[]; }

export function evaluateRules(policy: PurchasePolicy, o: ListingObservation, opportunity: OpportunityEvaluation, quantity: number): RuleEvaluation {
  positiveInteger(quantity);
  if (!policy.version || policy.expression.op !== 'ALL' || policy.expression.rules.length > 32) throw new RangeError('Unsupported or oversized rule expression');
  const ids = policy.expression.rules.map(rule => rule.id);
  if (ids.some(value => !value.trim()) || new Set(ids).size !== ids.length) throw new RangeError('Rule IDs must be nonempty and unique');
  if (policy.maximumOrderValue.minor < 0n) throw new RangeError('Negative order cap');
  const checks: Check[] = policy.expression.rules.map(rule => {
    switch (rule.kind) {
      case 'PRICE_AT_MOST':
      case 'SHIPPING_AT_MOST': {
        if (rule.maximum.minor < 0n) throw new RangeError('Negative price threshold');
        const field = rule.kind === 'PRICE_AT_MOST' ? o.unitPrice : o.shipping;
        const comparable = field.state === 'KNOWN' && field.value.currency === rule.maximum.currency;
        return check(rule.id, !comparable ? 'INDETERMINATE' : field.value.minor <= rule.maximum.minor ? 'PASS' : 'FAIL',
          { operator: rule.kind, actual: field.state === 'KNOWN' ? formatMoney(field.value) : field.state, maximum: formatMoney(rule.maximum) }, [field.evidence.id]);
      }
      case 'QUANTITY_AT_MOST':
        positiveInteger(rule.maximum);
        return check(rule.id, quantity <= rule.maximum ? 'PASS' : 'FAIL', { quantity: String(quantity), maximum: String(rule.maximum) });
      case 'ROI_AT_LEAST': {
        if (rule.minimum.denominator <= 0n) throw new RangeError('Invalid ROI threshold');
        const roi = opportunity.status === 'COMPLETE' ? opportunity.roi : undefined;
        return check(rule.id, !roi ? 'INDETERMINATE' : ratioAtLeast(roi, rule.minimum) ? 'PASS' : 'FAIL', {
          actual: roi ? `${roi.numerator}/${roi.denominator}` : 'UNAVAILABLE', minimum: `${rule.minimum.numerator}/${rule.minimum.denominator}`
        });
      }
      default: throw new RangeError('Unsupported purchase rule');
    }
  });
  // Always conjunctive and outside the user expression, including an empty ALL.
  checks.push(check('MAXIMUM_ORDER_VALUE', opportunity.status !== 'COMPLETE' || opportunity.acquisitionCost.currency !== policy.maximumOrderValue.currency ? 'INDETERMINATE'
    : opportunity.acquisitionCost.minor <= policy.maximumOrderValue.minor ? 'PASS' : 'FAIL',
    { maximum: formatMoney(policy.maximumOrderValue), actual: opportunity.status === 'COMPLETE' ? formatMoney(opportunity.acquisitionCost) : 'UNAVAILABLE' }));
  return freeze({ policyVersion: policy.version, status: combine(checks), checks });
}
