import { instant, positiveInteger } from '@ptcg/core';
import { ReadFailure } from './source-contracts.js';
import type { ReadClock, ReadJob, ReadQuotaRepository, ReadScheduler, ScheduledValue } from './source-contracts.js';

/** One FIFO per configured store quota; resolution and observation share it. Retries rejoin the tail. */
export class LocalReadScheduler implements ReadScheduler {
  readonly #tails = new Map<string, Promise<void>>();
  #pending = 0;
  constructor(private readonly quotas: ReadQuotaRepository, private readonly clock: ReadClock, private readonly jitter: () => number = () => 0) { }
  async perform<T>(job: ReadJob, read: (attempt: number) => Promise<T>): Promise<ScheduledValue<T>> {
    positiveInteger(job.minimumIntervalMs);
    if (!Number.isSafeInteger(job.maxAttempts) || job.maxAttempts < 1 || job.maxAttempts > 3) throw new ReadFailure('POLICY_DENIED');
    if (this.#pending >= 64) throw new ReadFailure('QUEUE_FULL');
    this.#pending++;
    let queueDelayMs = 0;
    try {
      for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
        try {
          const queuedAt = this.clock.now();
          const value = await this.slot(job.scope, async () => {
            for (; ;) {
              this.check(job);
              const slot = this.quotas.claimReadSlot(job.scope, this.clock.now(), job.minimumIntervalMs);
              if (slot.blocked) throw new ReadFailure(slot.blocked);
              if (slot.granted) break;
              if (slot.nextAt >= job.context.deadlineAt) throw new ReadFailure('DEADLINE_EXCEEDED');
              await this.clock.waitUntil(slot.nextAt, job.context.cancellation);
            }
            queueDelayMs += this.clock.now() - queuedAt;
            try {
              const result = await read(attempt);
              this.check(job);
              return result;
            } catch (error) {
              if (!(error instanceof ReadFailure)) throw error;
              if (['BLOCKED', 'AUTH_REQUIRED'].includes(error.code)) this.quotas.deferReads(job.scope, this.clock.now(), error.code);
              if (['RATE_LIMITED', 'TRANSIENT_FAILURE'].includes(error.code)) {
                const jitter = this.jitter();
                if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new ReadFailure('POLICY_DENIED');
                const delay = Math.max(error.retryAfterMs, job.minimumIntervalMs, 1_000 * 2 ** (attempt - 1) + Math.floor(jitter * 250));
                this.quotas.deferReads(job.scope, instant(this.clock.now() + delay));
              }
              throw error;
            }
          });
          return { value, queueDelayMs, attempts: attempt };
        } catch (error) {
          if (!(error instanceof ReadFailure) || !['RATE_LIMITED', 'TRANSIENT_FAILURE'].includes(error.code) || attempt === job.maxAttempts) throw error;
        }
      }
      throw new ReadFailure('TRANSIENT_FAILURE');
    } finally { this.#pending--; }
  }
  private check(job: ReadJob): void {
    if (job.context.cancellation?.aborted) throw new ReadFailure('CANCELLED');
    if (instant(this.clock.now()) < job.context.now || this.clock.now() >= job.context.deadlineAt) throw new ReadFailure('DEADLINE_EXCEEDED');
  }
  private async slot<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(scope) ?? Promise.resolve();
    let release: () => void = () => { };
    const current = new Promise<void>(resolve => { release = resolve; });
    this.#tails.set(scope, current);
    await previous;
    try { return await work(); }
    finally { release(); if (this.#tails.get(scope) === current) this.#tails.delete(scope); }
  }
}
