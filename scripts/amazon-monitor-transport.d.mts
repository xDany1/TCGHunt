import type { AmazonProviderResult } from '@ptcg/adapters';
export function createAmazonMonitorReader(options: { enabled: boolean; clock?: { now(): number; }; launcher?: unknown; }): {
  read(url: string): Promise<AmazonProviderResult>; cancel(): void; summary(): readonly unknown[];
};
