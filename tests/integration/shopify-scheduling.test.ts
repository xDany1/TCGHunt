import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalReadScheduler, ReadFailure } from '@ptcg/application';
import { harness } from '../fixtures/durable.js';
import { NOW } from '../fixtures/scenarios.js';
import { adapterFixture, FixtureClock, product, readContext, response, shopConfig, shopifyFixtures, SOURCE } from '../fixtures/shopify.js';

test('FIFO reads share one store quota and a retry rejoins behind other monitors', async t => {
  const h = harness(t); const clock = new FixtureClock(); const scheduler = new LocalReadScheduler(h.store.readQuotas, clock, () => 0.5);
  const order: string[] = []; const starts: number[] = []; let active = 0; let maximumActive = 0;
  const job = (name: string) => scheduler.perform({ scope: 'shopify:one', context: readContext(clock), minimumIntervalMs: 1000, maxAttempts: 2 }, async attempt => {
    order.push(`${name}:${attempt}`); starts.push(clock.now()); active++; maximumActive = Math.max(active, maximumActive); await Promise.resolve(); active--;
    if (name === 'a' && attempt === 1) throw new ReadFailure('TRANSIENT_FAILURE');
    return name;
  });
  await Promise.all([job('a'), job('b'), job('c')]);
  assert.deepEqual(order, ['a:1', 'b:1', 'c:1', 'a:2']); assert.equal(maximumActive, 1);
  assert.deepEqual(starts.map(at => at - NOW), [0, 1125, 2125, 3125]);
});
test('durable rate-limit backoff survives restart and suppresses an early retry storm', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [response(product(), { status: 429, retryAfterMs: 30_000 })]);
  const limited = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!limited.ok); assert.equal(limited.error.code, 'DEADLINE_EXCEEDED'); assert.equal(a.transport.attempts, 1);
  assert.equal(a.adapter.metrics().rateLimitedReads, 1); h.store.close();
  const reopened = h.open(); const b = adapterFixture(reopened.readQuotas, [shopifyFixtures.normal], shopConfig, new FixtureClock(NOW + 20_000));
  const result = await b.adapter.resolve(SOURCE, readContext(b.clock)); assert.ok(result.ok); assert.equal(b.clock.now(), NOW + 30_000); assert.equal(b.transport.attempts, 1);
});
for (const [name, code] of [['blocked', 'BLOCKED'], ['unauthorized', 'AUTH_REQUIRED']] as const) test(`persistent ${code} circuit prevents reads across capabilities and restart`, async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures[name]]);
  const blocked = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!blocked.ok); assert.equal(blocked.error.code, code);
  h.store.close(); const reopened = h.open(); const b = adapterFixture(reopened.readQuotas, [shopifyFixtures.normal], shopConfig, new FixtureClock(NOW + 100000));
  const retry = await b.adapter.resolve(SOURCE, readContext(b.clock)); assert.ok(!retry.ok); assert.equal(retry.error.code, code); assert.equal(b.transport.attempts, 0); assert.equal(b.adapter.health('RESOLUTION').state, code);
});
test('long sleep does not bank read credits or emit a catch-up burst', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, Array.from({ length: 4 }, () => shopifyFixtures.normal));
  assert.ok((await a.adapter.resolve(SOURCE, readContext(a.clock))).ok); a.clock.at += 86_400_000;
  const start = a.clock.now();
  await Promise.all([0, 1, 2].map(i => a.adapter.resolve(SOURCE, readContext(a.clock, { monitorId: `monitor-${i}` }))));
  assert.equal(a.clock.now(), start + 2000); assert.equal(a.transport.attempts, 4);
});
test('queued state is visible and cancelled queued work never reaches transport', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal]); const cancellation = { aborted: false };
  const pending = a.adapter.resolve(SOURCE, readContext(a.clock, { cancellation }));
  assert.equal(a.adapter.health('RESOLUTION').reason, 'QUEUED'); cancellation.aborted = true;
  const r = await pending; assert.ok(!r.ok); assert.equal(r.error.code, 'CANCELLED'); assert.equal(a.transport.attempts, 0);
});
test('deadline includes queue time and read latency; neither retries malformed context', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [response(product(), { latencyMs: 20000 })]);
  const r = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!r.ok); assert.equal(r.error.code, 'DEADLINE_EXCEEDED'); assert.equal(a.transport.attempts, 1);
  const malformed = await a.adapter.resolve(SOURCE, readContext(a.clock, { now: Number.NaN })); assert.ok(!malformed.ok); assert.equal(malformed.error.code, 'CONTEXT_MISMATCH');
});
test('cancellation during capture prevents publication of a successful observation', async t => {
  const h = harness(t); const cancellation = { aborted: false }; const clock = new FixtureClock();
  const wait = clock.waitUntil.bind(clock); clock.waitUntil = async at => { cancellation.aborted = true; await wait(at); };
  const a = adapterFixture(h.store.readQuotas, [shopifyFixtures.normal], shopConfig, clock);
  const r = await a.adapter.resolve(SOURCE, readContext(clock, { cancellation })); assert.ok(!r.ok); assert.equal(r.error.code, 'CANCELLED'); assert.equal(a.adapter.metrics().successfulReads, 0);
});
test('body byte limit, content type and every redirect are checked before parsing', async t => {
  const cases = [response(product(), { body: 'é'.repeat(32769) }), response(product(), { contentType: 'text/html', body: '<script>PRIVATE-CANARY</script>' }), response(product(), { status: 200, location: 'https://merchant.invalid/products/fixture-etb' })];
  for (const [i, data] of cases.entries()) {
    const a = adapterFixture(harness(t).store.readQuotas, [data]); const r = await a.adapter.resolve(SOURCE, readContext(a.clock)); assert.ok(!r.ok);
    assert.equal(r.error.code, ['BODY_TOO_LARGE', 'CONTENT_TYPE', 'REDIRECT_DENIED'][i]); assert.equal(a.transport.attempts, 1);
    assert.equal(a.adapter.metrics().parserFailures, 0); assert.equal(JSON.stringify(a.adapter.diagnostics()).includes('PRIVATE-CANARY'), false);
  }
});
test('health retains last success/failure context; raw payloads and secret-bearing context are excluded', async t => {
  const h = harness(t); const a = adapterFixture(h.store.readQuotas, [response(product({ secret: 'PRIVATE-CANARY', title: '<script>PRIVATE-CANARY</script>' })), shopifyFixtures.schemaDrift, shopifyFixtures.normal]);
  const ctx = () => readContext(a.clock, { traceId: 'token=PRIVATE-CANARY', operationId: 'https://secret.invalid?token=PRIVATE-CANARY' });
  assert.ok((await a.adapter.resolve(SOURCE, ctx())).ok); const first = a.adapter.health('RESOLUTION');
  assert.ok(!(await a.adapter.resolve(SOURCE, ctx())).ok); const failed = a.adapter.health('RESOLUTION'); assert.equal(failed.state, 'UNAVAILABLE'); assert.equal(failed.lastSuccessAt, first.lastSuccessAt); assert.ok(failed.lastFailureAt);
  assert.ok((await a.adapter.resolve(SOURCE, ctx())).ok); assert.equal(a.adapter.health('RESOLUTION').lastFailureAt, failed.lastFailureAt);
  assert.equal(a.adapter.metrics().parserFailures, 1); assert.equal(a.adapter.metrics().lastSuccessAgeMs, 0);
  assert.equal(JSON.stringify(a.adapter.diagnostics()).includes('PRIVATE-CANARY'), false);
});
test('bounded queue rejects overload while preserving accepted FIFO work', async t => {
  const h = harness(t); const clock = new FixtureClock(); const scheduler = new LocalReadScheduler(h.store.readQuotas, clock);
  const job = { scope: 'bounded', context: readContext(clock, { deadlineAt: NOW + 60000 }), minimumIntervalMs: 100, maxAttempts: 1 };
  const accepted = Array.from({ length: 64 }, () => scheduler.perform(job, async () => true));
  await assert.rejects(scheduler.perform(job, async () => true), (e: unknown) => e instanceof ReadFailure && e.code === 'QUEUE_FULL');
  assert.equal((await Promise.all(accepted)).length, 64);
});
