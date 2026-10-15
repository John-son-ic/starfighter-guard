/**
 * D07 — exact constant-velocity intercept solving.
 *
 * The target moves in a straight line at `targetVelocity`; the projectile leaves the
 * shooter at `projectileSpeed` in world space and does not inherit shooter velocity.
 * Solves |target(t) - shooter| = projectileSpeed * t for the earliest t >= 0.
 *
 * Pure arithmetic: no Three.js, no DOM, no clock, no randomness. Inputs are never
 * modified. Behaviour source: docs/tasks/DSH_THIRD.md ("D07").
 */
import type { Vec3 } from '../shared/types.ts';

export interface Intercept {
  point: Vec3;
  time: number;
}

/** Projectile lifetime used by the game; intercepts beyond it are useless. */
const DEFAULT_MAX_TIME = 2;

function describeNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'a non-finite number';
}

function failRange(what: string, value: number, expected: string): never {
  throw new RangeError(`intercept: ${what} must be ${expected}, received ${describeNumber(value)}`);
}

function failType(what: string): never {
  throw new RangeError(`intercept: ${what}`);
}

/** Every component of a vector must be a finite number. */
function requireVec3(vector: Vec3 | undefined, what: string): Vec3 {
  if (!vector || typeof vector !== 'object') failType(`${what} is required`);
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = vector[axis];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      failRange(`${what}.${axis}`, value as number, 'a finite number');
    }
  }
  return vector;
}

/** Speed and the optional maxTime must be finite and strictly positive. */
function requirePositive(value: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) failRange(what, value, 'a finite number');
  if (value <= 0) failRange(what, value, 'a finite number greater than 0');
  return value;
}

/**
 * Tolerances are sized for the game's real magnitudes (meters, 720 m/s, 0..2 s), not
 * for arbitrary astronomical values.
 */
const POSITION_EPSILON = 1e-9;
/** Relative slack when deciding whether a root is already behind us. */
const TIME_EPSILON = 1e-12;

function squaredDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function pointAt(target: Vec3, velocity: Vec3, time: number): Vec3 {
  return {
    x: target.x + velocity.x * time,
    y: target.y + velocity.y * time,
    z: target.z + velocity.z * time,
  };
}

/**
 * Earliest intercept, or null when the projectile can never reach the target inside
 * `maxTime`.
 *
 * Solves the quadratic |r + v t|^2 = s^2 t^2 with r = target - shooter, v = targetVelocity:
 *   a = v.v - s^2, b = 2 r.v, c = r.r
 * When a is ~0 the target moves at exactly projectile speed, so the equation degenerates
 * to the linear 2 r.v t + r.r = 0 and is solved directly instead of by the quadratic
 * formula.
 */
export function solveIntercept(
  shooter: Vec3,
  target: Vec3,
  targetVelocity: Vec3,
  projectileSpeed: number,
  maxTime: number = DEFAULT_MAX_TIME,
): Intercept | null {
  const from = requireVec3(shooter, 'shooter');
  const to = requireVec3(target, 'target');
  const velocity = requireVec3(targetVelocity, 'targetVelocity');
  const speed = requirePositive(projectileSpeed, 'projectileSpeed');
  const limit = requirePositive(maxTime, 'maxTime');

  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const rz = to.z - from.z;
  const distanceSquared = rx * rx + ry * ry + rz * rz;

  // Already co-located: the flight time is zero whatever the velocities are.
  if (distanceSquared <= POSITION_EPSILON * POSITION_EPSILON) {
    return { point: { x: to.x, y: to.y, z: to.z }, time: 0 };
  }

  const speedSquared = speed * speed;
  const a = velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z - speedSquared;
  const b = 2 * (rx * velocity.x + ry * velocity.y + rz * velocity.z);
  const c = distanceSquared;

  let earliest = Number.POSITIVE_INFINITY;
  const scale = Math.max(speedSquared, 1);
  if (Math.abs(a) <= Number.EPSILON * scale) {
    // Degenerate: |targetVelocity| == projectileSpeed, so the equation is linear.
    if (b !== 0) {
      const linear = -c / b;
      if (linear >= -TIME_EPSILON) earliest = Math.max(0, linear);
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      // Stable quadratic roots: q builds one root without subtracting nearly equal
      // numbers, and c/q recovers the other without losing precision.
      const q = -0.5 * (b + Math.sign(b === 0 ? 1 : b) * root);
      const roots = q === 0 ? [0] : [q / a, c / q];
      for (const candidate of roots) {
        if (!Number.isFinite(candidate)) continue;
        if (candidate < -TIME_EPSILON) continue;
        const clamped = Math.max(0, candidate);
        if (clamped < earliest) earliest = clamped;
      }
    }
  }

  if (!Number.isFinite(earliest)) return null;
  if (earliest > limit) return null;

  const point = pointAt(to, velocity, earliest);
  // Guard against acting on a point the projectile cannot actually reach.
  const reach = speed * earliest;
  const missSquared = squaredDistance(point, from) - reach * reach;
  if (Math.abs(missSquared) > 1e-6 * Math.max(1, reach * reach)) return null;

  return { point, time: earliest };
}
