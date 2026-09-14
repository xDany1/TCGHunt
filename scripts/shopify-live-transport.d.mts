import type { ReadClock } from '@ptcg/application';
export const LIVE_QUERY: string;
export const APPROVED_HANDLES: readonly string[];
export class LiveReadError extends Error { readonly code: string; readonly causeCode: string | null; constructor(code: string, causeCode?: string | null); }
export function approvedProductUrl(input: string): { storeId: string; handle: string; canonical: string; variantId: string | null; };
export function publicAddress(address: string): boolean;
export class ValidationClock implements ReadClock { now(): number; waitUntil(at: number, cancellation?: { readonly aborted: boolean; }): Promise<void>; }
export class KantocardsTransport {
  constructor(config: { enabled: true; domain: 'kantocards.com'; clock: ReadClock; });
  readonly attempts: number; summaries(): readonly unknown[];
  capture(handle: string): Promise<{ body: string; metadata: unknown; }>;
}
