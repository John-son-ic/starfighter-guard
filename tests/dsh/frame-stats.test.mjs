/**
 * D05 behaviour tests — bounded frame-time statistics.
 * Run: node --test tests/dsh/frame-stats.test.mjs
 *
 * Expected values are computed from the documented rules (mean, nearest-rank p95,
 * max, fps = 1000/mean) rather than copied from the implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from '../../src/platform/frame-stats.ts';

/** Independent nearest-rank p95: ceil(n * 0.95) - 1 on the ascending samples. */
function expectedP95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function expectedSummary(values) {
  if (values.length === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 };
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    meanMs,
    p95Ms: expectedP95(values),
    maxMs: Math.max(...values),
    fps: 1000 / meanMs,
  };
}

function filled(samples, capacity) {
  const stats = createFrameStats(capacity);
  for (const sample of samples) stats.push(sample);
  return stats;
}

test('an empty history reports zeros, not NaN', () => {
  const stats = createFrameStats();
  const summary = stats.summary();
  assert.deepEqual(summary, { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 });
  for (const [key, value] of Object.entries(summary)) {
    assert.equal(Number.isFinite(value), true, `${key} must be finite, got ${value}`);
  }
  assert.equal(Object.is(summary.fps, -0), false);
  // Repeated calls on an empty history stay zeroed.
  assert.deepEqual(stats.summary(), summary);
});

test('mean, max and fps match the documented formulas', () => {
  const samples = [10, 20, 30, 40];
  const summary = filled(samples).summary();
  assert.equal(summary.count, 4);
  assert.equal(summary.meanMs, 25);
  assert.equal(summary.maxMs, 40);
  assert.equal(summary.fps, 1000 / 25);
  assert.equal(summary.p95Ms, expectedP95(samples));
});

test('p95 uses nearest-rank and stays inside the sample range', () => {
  // Small histories: the top sample is always p95 because ceil(n*0.95) == n.
  for (const samples of [[5], [1, 9], [3, 1, 2], [4, 4, 4, 4]]) {
    const summary = filled(samples).summary();
    assert.equal(summary.p95Ms, expectedP95(samples), `p95 for ${JSON.stringify(samples)}`);
    assert.ok(summary.p95Ms <= summary.maxMs && summary.p95Ms >= summary.meanMs - 1e-9 || summary.p95Ms === summary.maxMs);
  }

  // 1..100: nearest-rank picks the 95th ascending value, not the maximum.
  const ramp = Array.from({ length: 100 }, (_unused, index) => index + 1);
  const summary = filled(ramp, 100).summary();
  assert.equal(summary.p95Ms, 95);
  assert.notEqual(summary.p95Ms, summary.maxMs, 'p95 must not silently degrade to max');
  assert.equal(summary.meanMs, 50.5);
  assert.equal(summary.maxMs, 100);

  // The rank step is visible across n: p95 of 1..10 is 10, of 1..11 is 11.
  assert.equal(filled(Array.from({ length: 10 }, (_u, i) => i + 1), 10).summary().p95Ms, 10);
  assert.equal(filled(Array.from({ length: 11 }, (_u, i) => i + 1), 11).summary().p95Ms, 11);
  // 1..19 -> ceil(18.05)-1 = 18 -> the 19th value; 1..20 -> ceil(19)-1 = 18 -> the 19th.
  assert.equal(filled(Array.from({ length: 19 }, (_u, i) => i + 1), 19).summary().p95Ms, 19);
  assert.equal(filled(Array.from({ length: 20 }, (_u, i) => i + 1), 20).summary().p95Ms, 19);
});

test('a capacity overflow evicts the oldest samples', () => {
  const stats = createFrameStats(3);
  for (const sample of [10, 20, 30]) stats.push(sample);
  assert.deepEqual(stats.summary(), expectedSummary([10, 20, 30]));

  stats.push(40);
  assert.deepEqual(stats.summary(), expectedSummary([20, 30, 40]), 'the oldest sample leaves the window');
  assert.equal(stats.summary().count, 3, 'count is capped by capacity');

  for (const sample of [50, 60]) stats.push(sample);
  assert.deepEqual(stats.summary(), expectedSummary([40, 50, 60]), 'only the newest capacity samples survive');
  assert.equal(stats.summary().maxMs, 60);

  // One sample is enough to prove the window tracks the newest value on a wrap.
  const single = createFrameStats(1);
  single.push(5);
  single.push(9);
  assert.deepEqual(single.summary(), expectedSummary([9]));
});

test('samples older than the window never leak back in', () => {
  const capacity = 5;
  const stats = createFrameStats(capacity);
  const pushed = [100, 200, 300, 400, 500, 600, 700];
  for (const sample of pushed) stats.push(sample);
  const window = pushed.slice(-capacity);
  assert.deepEqual(stats.summary(), expectedSummary(window));
  assert.equal(stats.summary().count, capacity);
  assert.ok(stats.summary().meanMs !== expectedSummary(pushed).meanMs, 'the window is not the whole history');
});

test('the default capacity is 300', () => {
  const stats = createFrameStats();
  for (let index = 1; index <= 400; index += 1) stats.push(index);
  const summary = stats.summary();
  assert.equal(summary.count, 300);
  assert.equal(summary.maxMs, 400);
  assert.equal(summary.meanMs, (101 + 400) / 2, 'the window holds samples 101..400');
  assert.equal(summary.p95Ms, expectedP95(Array.from({ length: 300 }, (_u, i) => i + 101)));
});

test('invalid samples are ignored without corrupting the window', () => {
  const stats = createFrameStats(4);
  stats.push(16);
  const baseline = stats.summary();

  const rejected = [0, -1, -0.0001, Number.NaN, Infinity, -Infinity, '16', null, undefined, {}, [], true, false];
  for (const value of rejected) {
    stats.push(value);
    assert.deepEqual(stats.summary(), baseline, `push(${String(value)}) must be ignored`);
  }
  assert.equal(stats.summary().count, 1, 'ignored samples are not counted');
  assert.equal(Number.isFinite(stats.summary().fps), true);

  // A valid sample still lands after the rejected ones.
  stats.push(20);
  assert.deepEqual(stats.summary(), expectedSummary([16, 20]));
});

test('capacity must be an integer in 1..10000', () => {
  for (const capacity of [0, -1, 1.5, 2.0001, 10001, 100000, Number.NaN, Infinity, -Infinity, '300', null]) {
    assert.throws(() => createFrameStats(capacity), RangeError, `capacity ${String(capacity)} must be rejected`);
  }
  assert.doesNotThrow(() => createFrameStats(1));
  assert.doesNotThrow(() => createFrameStats(10000));
  assert.doesNotThrow(() => createFrameStats());
  assert.equal(createFrameStats(1).summary().count, 0);
});

test('a capacity of 10000 accepts a full window of samples', () => {
  const stats = createFrameStats(10000);
  for (let index = 1; index <= 10000; index += 1) stats.push(index % 7 === 0 ? 33 : 16);
  const summary = stats.summary();
  assert.equal(summary.count, 10000);
  assert.equal(summary.maxMs, 33);
  assert.equal(summary.p95Ms, expectedP95([...Array(10000)].map((_u, i) => ((i + 1) % 7 === 0 ? 33 : 16))));
  assert.equal(summary.meanMs, (33 * 1428 + 16 * (10000 - 1428)) / 10000);
});

test('reset clears the window and the stats start over', () => {
  const stats = createFrameStats(3);
  for (const sample of [10, 20, 30]) stats.push(sample);
  assert.equal(stats.summary().count, 3);

  stats.reset();
  assert.deepEqual(stats.summary(), { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 });

  stats.push(50);
  assert.deepEqual(stats.summary(), expectedSummary([50]), 'no pre-reset sample survives');
  stats.push(60);
  assert.deepEqual(stats.summary(), expectedSummary([50, 60]));

  // Reset twice in a row is safe.
  stats.reset();
  stats.reset();
  assert.deepEqual(stats.summary(), { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 });
});

test('summary returns a snapshot that cannot pollute internal data', () => {
  const stats = createFrameStats(4);
  for (const sample of [15, 25, 35]) stats.push(sample);
  const before = stats.summary();

  const first = stats.summary();
  first.count = 999;
  first.meanMs = -1;
  first.p95Ms = -1;
  first.maxMs = -1;
  first.fps = -1;

  assert.deepEqual(stats.summary(), before, 'mutating a returned summary must not change the stats');
  assert.notEqual(stats.summary(), stats.summary(), 'each call returns a new object');
  assert.deepEqual(stats.summary(), before);

  // Returning a summary is not a read of history that adds samples.
  stats.summary();
  stats.summary();
  assert.equal(stats.summary().count, 3);
});

test('repeated summary calls do not reorder or lose samples', () => {
  const stats = createFrameStats(10);
  const samples = [9, 1, 8, 2, 7, 3, 6, 4, 5, 10];
  for (const sample of samples) stats.push(sample);
  const first = stats.summary();
  for (let index = 0; index < 5; index += 1) assert.deepEqual(stats.summary(), first);
  assert.deepEqual(stats.summary(), expectedSummary(samples));

  // New pushes after several summaries still follow the documented window.
  stats.push(0.5 + 11);
  assert.deepEqual(stats.summary(), expectedSummary([...samples.slice(1), 11.5]));
});

test('separate instances keep independent histories', () => {
  const a = createFrameStats(3);
  const b = createFrameStats(3);
  a.push(10);
  a.push(20);
  b.push(500);

  assert.deepEqual(a.summary(), expectedSummary([10, 20]));
  assert.deepEqual(b.summary(), expectedSummary([500]));

  a.reset();
  assert.deepEqual(b.summary(), expectedSummary([500]), 'resetting one instance must not touch another');
  assert.deepEqual(a.summary(), { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 });

  const c = createFrameStats(1);
  c.push(1);
  assert.notDeepEqual(c.summary(), b.summary());
});

test('realistic frame times stay finite and self-consistent', () => {
  // 60fps, 30fps and one long hitch; useful as a shape check, not a performance claim.
  const stats = createFrameStats(120);
  for (let index = 0; index < 100; index += 1) stats.push(1000 / 60);
  for (let index = 0; index < 19; index += 1) stats.push(1000 / 30);
  stats.push(250);
  const summary = stats.summary();

  assert.equal(summary.count, 120);
  assert.ok(Number.isFinite(summary.meanMs) && summary.meanMs > 0);
  assert.ok(Number.isFinite(summary.p95Ms) && summary.p95Ms > 0);
  assert.ok(Number.isFinite(summary.fps) && summary.fps > 0);
  assert.equal(summary.maxMs, 250);
  assert.ok(summary.p95Ms >= summary.meanMs, 'p95 cannot sit below the mean');
  assert.ok(
    summary.fps >= 1000 / summary.p95Ms - 1e-9,
    'fps comes from the mean, so it cannot be worse than the rate implied by the slower p95 frame',
  );
  assert.deepEqual(summary, expectedSummary([...Array(100).fill(1000 / 60), ...Array(19).fill(1000 / 30), 250]));
});
