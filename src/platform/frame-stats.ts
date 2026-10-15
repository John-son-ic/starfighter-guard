/**
 * D05 — bounded frame-time statistics. Pure arithmetic over caller-supplied
 * millisecond samples: no DOM, no real clock, no timers, no network.
 * Spec source: docs/tasks/DSH_NEXT.md ("D05 — 有界帧时间统计").
 */

export interface FrameSummary {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  fps: number;
}

export interface FrameStats {
  push(milliseconds: number): void;
  summary(): FrameSummary;
  reset(): void;
}

const DEFAULT_CAPACITY = 300;
const MAX_CAPACITY = 10000;
const MIN_CAPACITY = 1;
/** Nearest-rank percentile used for p95. */
const P95_RANK = 0.95;

function requireCapacity(capacity: number | undefined): number {
  if (capacity === undefined) return DEFAULT_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    throw new RangeError(
      `frame-stats: capacity must be an integer between ${MIN_CAPACITY} and ${MAX_CAPACITY}, received ${String(capacity)}`,
    );
  }
  return capacity;
}

/**
 * Ring buffer of the newest `capacity` samples. `nextIndex` is where the next push
 * lands and `filled` counts how many slots hold live samples, so the oldest value is
 * overwritten once the buffer is full.
 */
export function createFrameStats(capacity: number = DEFAULT_CAPACITY): FrameStats {
  const limit = requireCapacity(capacity);
  const samples = new Float64Array(limit);
  let nextIndex = 0;
  let filled = 0;

  function raw(i: number): number {
    return samples[i] as number;
  }

  function liveSamples(): number[] {
    const values: number[] = [];
    for (let index = 0; index < filled; index += 1) values.push(raw(index));
    return values;
  }

  return {
    push(milliseconds: number): void {
      // Only finite positive samples count; anything else is silently dropped.
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
      samples[nextIndex] = milliseconds;
      nextIndex = (nextIndex + 1) % limit;
      if (filled < limit) filled += 1;
    },

    summary(): FrameSummary {
      if (filled === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0 };

      const values = liveSamples().sort((a, b) => a - b);
      let total = 0;
      for (const value of values) total += value;
      const meanMs = total / values.length;
      const rank = Math.ceil(values.length * P95_RANK) - 1;
      const p95Ms = values[Math.min(values.length - 1, Math.max(0, rank))] as number;

      return {
        count: values.length,
        meanMs,
        p95Ms,
        maxMs: values[values.length - 1] as number,
        fps: 1000 / meanMs,
      };
    },

    reset(): void {
      // Clearing the bookkeeping is enough: stale slots are never read past `filled`.
      nextIndex = 0;
      filled = 0;
    },
  };
}
