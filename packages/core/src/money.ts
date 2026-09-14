import { positiveInteger } from './value.js';

// M1 supports two explicit currencies to exercise rejection, not conversion.
export type Currency = 'MXN' | 'USD';
export const MAX_MINOR = 9_000_000_000_000_000n;
export interface Money { readonly minor: bigint; readonly currency: Currency; }
export interface Ratio { readonly numerator: bigint; readonly denominator: bigint; }

export function money(minor: bigint, currency: Currency): Money {
  if (typeof minor !== 'bigint' || minor < -MAX_MINOR || minor > MAX_MINOR) throw new RangeError('Money outside supported minor-unit range');
  if (currency !== 'MXN' && currency !== 'USD') throw new RangeError('Unsupported currency');
  return Object.freeze({ minor, currency });
}

export function parseMoney(amount: string, currency: Currency): Money {
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new RangeError('Expected decimal amount with at most two places');
  const negative = amount.startsWith('-');
  const [whole = '', fraction = ''] = amount.replace(/^-/, '').split('.');
  return money((BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n), currency);
}

export function formatMoney(value: Money): string {
  const abs = value.minor < 0n ? -value.minor : value.minor;
  return `${value.minor < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')} ${value.currency}`;
}

export function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new RangeError('Currency mismatch; no implicit FX conversion');
}
export function add(a: Money, b: Money): Money { sameCurrency(a, b); return money(a.minor + b.minor, a.currency); }
export function subtract(a: Money, b: Money): Money { sameCurrency(a, b); return money(a.minor - b.minor, a.currency); }
export function multiply(a: Money, quantity: number): Money { return money(a.minor * BigInt(positiveInteger(quantity)), a.currency); }
export function ratio(numerator: bigint, denominator: bigint): Ratio | undefined {
  if (denominator < 0n) throw new RangeError('Negative denominator');
  return denominator === 0n ? undefined : Object.freeze({ numerator, denominator });
}
export function ratioAtLeast(value: Ratio, minimum: Ratio): boolean {
  if (minimum.denominator <= 0n || value.denominator <= 0n) throw new RangeError('Invalid ratio');
  return value.numerator * minimum.denominator >= minimum.numerator * value.denominator;
}

export function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Expected nonnegative numerator and positive denominator');
  return (numerator + denominator - 1n) / denominator;
}
