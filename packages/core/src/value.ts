export type Status = 'PASS' | 'FAIL' | 'INDETERMINATE';
export interface Check {
  readonly code: string;
  readonly status: Status;
  readonly evidenceIds: readonly string[];
  readonly operands: Readonly<Record<string, string>>;
}

export function check(code: string, status: Status, operands: Readonly<Record<string, string>> = {}, evidenceIds: readonly string[] = []): Check {
  return Object.freeze({ code, status, operands: Object.freeze({ ...operands }), evidenceIds: Object.freeze([...evidenceIds]) });
}

export function combine(checks: readonly Check[]): Status {
  if (checks.some(item => item.status === 'FAIL')) return 'FAIL';
  return checks.some(item => item.status === 'INDETERMINATE') ? 'INDETERMINATE' : 'PASS';
}

export function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Expected a positive safe integer');
  return value;
}

export function instant(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Expected epoch milliseconds');
  return value;
}

export type Id<Kind extends string> = string & { readonly __kind: Kind; };
export function id<Kind extends string>(kind: Kind, value: string): Id<Kind> {
  if (!kind || !value.trim() || value !== value.trim()) throw new RangeError('ID must be nonempty and trimmed');
  return value as Id<Kind>;
}

// All M1 snapshots are plain data. Freeze recursively to protect recorded evidence.
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
