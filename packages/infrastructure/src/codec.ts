import { freeze } from '@ptcg/core';
import { PersistenceFailure } from '@ptcg/application';

function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return { $m2bigint: String(value) };
  if (value === undefined) return { $m2undefined: true };
  if (typeof value === 'number' && !Number.isFinite(value)) throw new PersistenceFailure('INVALID_INPUT');
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    if ('$m2bigint' in value || '$m2undefined' in value) throw new PersistenceFailure('INVALID_INPUT');
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  }
  if (typeof value === 'function' || typeof value === 'symbol') throw new PersistenceFailure('INVALID_INPUT');
  return value;
}
export function encode(value: unknown): string {
  const result = JSON.stringify(canonical(value));
  if (result.length > 262_144) throw new PersistenceFailure('INVALID_INPUT');
  return result;
}
function restore(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restore);
  if (value !== null && typeof value === 'object') {
    if ('$m2bigint' in value && Object.keys(value).length === 1 && typeof value.$m2bigint === 'string' && /^-?\d{1,30}$/.test(value.$m2bigint)) return BigInt(value.$m2bigint);
    if ('$m2undefined' in value && Object.keys(value).length === 1 && value.$m2undefined === true) return undefined;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)]));
  }
  return value;
}
/** Only reads this schema's own versioned snapshots, never arbitrary external DTOs. */
export function decode<T>(value: unknown): T {
  if (typeof value !== 'string' || value.length > 262_144) throw new PersistenceFailure('STORAGE_FAILURE');
  try { return freeze(restore(JSON.parse(value)) as T); }
  catch { throw new PersistenceFailure('STORAGE_FAILURE'); }
}
