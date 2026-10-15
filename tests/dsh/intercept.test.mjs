/**
 * D07 behaviour tests — exact constant-velocity intercept solving.
 * Run: node --test tests/dsh/intercept.test.mjs
 *
 * Expected values come from closed-form arithmetic and are re-verified by
 * substitution at runtime: for every accepted solution,
 *   point == target + targetVelocity * time      (the target really is there)
 *   |point - shooter| == projectileSpeed * time  (the projectile really reaches it)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveIntercept } from '../../src/sim/intercept.ts';

const SPEED = 720;
const DEFAULT_MAX_TIME = 2;

function v(x, y, z) {
  return { x, y, z };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function movedTo(target, velocity, time) {
  return v(target.x + velocity.x * time, target.y + velocity.y * time, target.z + velocity.z * time);
}

/** Asserts the two defining equations of an intercept solution. */
function assertSubstitutionHolds(shooter, target, velocity, speed, solution, label = '') {
  assert.ok(solution, `${label}: expected a solution`);
  assert.ok(Number.isFinite(solution.time) && solution.time >= 0, `${label}: time must be finite and >= 0`);
  const expectedPoint = movedTo(target, velocity, solution.time);
  const reached = distance(solution.point, shooter);
  const wanted = speed * solution.time;

  assert.ok(
    distance(solution.point, expectedPoint) <= 1e-6,
    `${label}: point ${JSON.stringify(solution.point)} is not the target position at t=${solution.time} (${JSON.stringify(expectedPoint)})`,
  );
  assert.ok(
    Math.abs(reached - wanted) <= 1e-5,
    `${label}: |point - shooter| = ${reached} but speed * time = ${wanted}`,
  );
}

test('a static target is hit at the direct flight time', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -500);
  const still = v(0, 0, 0);
  const solution = solveIntercept(shooter, target, still, SPEED);

  assertSubstitutionHolds(shooter, target, still, SPEED, solution, 'static');
  assert.equal(solution.time, 500 / SPEED);
  assert.deepEqual(solution.point, { x: 0, y: 0, z: -500 });
  // A static target needs no lead: the impact point is the target itself.
  assert.deepEqual(solution.point, target);
});

test('a perpendicular target is led by the exact closed-form amount', () => {
  // target (0,120,-360) moving +x at 200 m/s, projectile 720 m/s.
  // |r + v t|^2 = s^2 t^2 -> (200^2 - 720^2) t^2 + 144000 = 0
  const shooter = v(0, 0, 0);
  const target = v(0, 120, -360);
  const velocity = v(200, 0, 0);
  const solution = solveIntercept(shooter, target, velocity, SPEED);

  const a = 200 * 200 - SPEED * SPEED;
  const expectedTime = Math.sqrt(-144000 / a);
  assertSubstitutionHolds(shooter, target, velocity, SPEED, solution, 'perpendicular');
  assert.ok(Math.abs(solution.time - expectedTime) <= 1e-12, `time ${solution.time} vs ${expectedTime}`);
  assert.ok(Math.abs(solution.time - 0.5486377169695913) <= 1e-12, 'matches the exact rational root');
  assert.ok(solution.point.x > target.x, 'the aim point must lead ahead of the target');
  assert.equal(solution.point.y, 120, 'the lateral offset is unchanged');
  assert.equal(solution.point.z, -360);
});

test('a head-on target is intercepted before the mid-point', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -300);
  const velocity = v(0, 0, 100); // closing on the shooter
  const solution = solveIntercept(shooter, target, velocity, SPEED);

  assertSubstitutionHolds(shooter, target, velocity, SPEED, solution, 'head-on');
  assert.equal(solution.time, 300 / (SPEED + 100));
  assert.ok(solution.point.z > -300 && solution.point.z < 0, 'impact happens inside the starting gap');
  assert.ok(solution.time < 300 / SPEED, 'closing speed makes the hit sooner than a static target');
});

/**
 * Solves the intercept quadratic independently, so null results can be justified.
 * Only valid when |targetVelocity| != speed; the a ~ 0 degenerate case is linear and
 * is checked separately where it matters.
 */
function analyticRoots(shooter, target, velocity, speed) {
  const r = { x: target.x - shooter.x, y: target.y - shooter.y, z: target.z - shooter.z };
  const a = velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z - speed * speed;
  const b = 2 * (r.x * velocity.x + r.y * velocity.y + r.z * velocity.z);
  const c = r.x * r.x + r.y * r.y + r.z * r.z;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return { roots: [], a, b, c, discriminant };
  const root = Math.sqrt(discriminant);
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].sort((x, y) => x - y);
  return { roots, a, b, c, discriminant };
}

test('a target fleeing faster than the projectile has no solution', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -100);
  const still = v(0, 0, 0);

  assertSubstitutionHolds(shooter, target, still, SPEED, solveIntercept(shooter, target, still, SPEED), 'control');
  assert.equal(solveIntercept(shooter, target, v(0, 0, -800), SPEED), null, 'directly faster than the shot');
  assert.equal(solveIntercept(shooter, target, v(300, 0, -900), SPEED), null, 'faster and veering away');
  assert.equal(solveIntercept(shooter, target, v(2000, 0, 0), SPEED), null, 'crossing far too fast to reach');

  // Justified by the quadratic: no real root, or no non-negative root at all.
  for (const velocity of [v(0, 0, -800), v(300, 0, -900), v(2000, 0, 0)]) {
    const { roots } = analyticRoots(shooter, target, velocity, SPEED);
    const usable = roots.filter((time) => time >= 0);
    assert.equal(usable.length, 0, `${JSON.stringify(velocity)} must have no non-negative root, got ${JSON.stringify(roots)}`);
  }
});

test('a real root that arrives too late is still reported as no solution', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -100);
  const velocity = v(500, 0, -500); // 707 m/s: slower than the shot, so a long chase

  // The geometry does intersect on paper, far beyond the 2s budget.
  const { roots, discriminant, a } = analyticRoots(shooter, target, velocity, SPEED);
  assert.ok(discriminant > 0, 'the fixture must produce a real root');
  assert.ok(a < 0, 'a slower target puts the usable root in the positive branch');
  const positive = roots.filter((time) => time > 0);
  assert.equal(positive.length, 1);
  assert.ok(positive[0] > DEFAULT_MAX_TIME, `root ${positive[0]} should be beyond maxTime`);

  assert.equal(solveIntercept(shooter, target, velocity, SPEED), null, 'the default budget rejects it');
  const allowed = solveIntercept(shooter, target, velocity, SPEED, 10);
  assertSubstitutionHolds(shooter, target, velocity, SPEED, allowed, 'raised maxTime');
  assert.ok(Math.abs(allowed.time - positive[0]) <= 1e-9, 'the accepted time is that same root');

  // A degenerate fixture where the quadratic collapses entirely: the target crosses
  // perpendicular to the line of sight at exactly projectile speed, so a = 0 and
  // b = 2 r.v = 0 while c > 0. The 100m gap never changes and there is no intercept.
  const crossing = analyticRoots(shooter, v(0, 0, -100), v(50, 0, 0), 50);
  assert.equal(crossing.a, 0, 'a = 0: target speed equals projectile speed');
  assert.equal(crossing.b, 0, 'b = 0: the motion is perpendicular to the line of sight');
  assert.ok(crossing.c > 0, 'c > 0: the gap is real');
  assert.equal(solveIntercept(shooter, v(0, 0, -100), v(50, 0, 0), 50), null);
});

test('equal speeds degenerate to the linear case', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -100);

  // Approaching at exactly projectile speed: closed form t = 100 / (50 + 50).
  const approaching = solveIntercept(shooter, target, v(0, 0, 50), 50);
  assertSubstitutionHolds(shooter, target, v(0, 0, 50), 50, approaching, 'equal speed closing');
  assert.equal(approaching.time, 1);
  assert.deepEqual(approaching.point, { x: 0, y: 0, z: -50 });

  // Receding at exactly projectile speed: the gap never closes.
  assert.equal(solveIntercept(shooter, target, v(0, 0, -50), 50), null);
  // Crossing sideways at exactly projectile speed: the linear root is negative.
  assert.equal(solveIntercept(shooter, target, v(50, 0, 0), 50), null);
});

test('the earlier of the two roots is the one returned', () => {
  // A target faster than the projectile approaches at 1080 m/s, producing two positive roots;
  // the projectile must hit on the way out, not after flying past and coming back.
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -1000);
  const velocity = v(0, 0, 1080);
  const solution = solveIntercept(shooter, target, velocity, SPEED, 10);

  assertSubstitutionHolds(shooter, target, velocity, SPEED, solution, 'two roots');
  // Solve exactly: (1080^2 - 720^2) t^2 + 2*(-1000)(1080) t + 1000^2 = 0
  const a = 1080 * 1080 - SPEED * SPEED;
  const b = 2 * (-1000) * 1080;
  const c = 1000 * 1000;
  const disc = b * b - 4 * a * c;
  const root = Math.sqrt(disc);
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((value) => value >= 0).sort((x, y) => x - y);
  assert.equal(roots.length, 2, 'the fixture must have two positive roots');
  assert.ok(Math.abs(solution.time - roots[0]) <= 1e-9, `returned ${solution.time}, earliest root is ${roots[0]}`);
  assert.ok(solution.time < roots[1], 'must not return the later root');
});

test('the returned time is the earliest intercept, not merely a valid one', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 120, -360);
  const velocity = v(200, 0, 0);
  const solution = solveIntercept(shooter, target, velocity, SPEED);

  // No earlier time in the window may put the target within projectile reach.
  for (const earlier of [0, solution.time / 4, solution.time / 2, solution.time - 1e-3, solution.time * 0.999]) {
    const point = movedTo(target, velocity, earlier);
    assert.ok(
      distance(point, shooter) > SPEED * earlier + 1e-6,
      `t=${earlier} should be out of reach but was ${distance(point, shooter)} vs ${SPEED * earlier}`,
    );
  }
});

test('a solution past maxTime is rejected', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -5000);
  const still = v(0, 0, 0);

  assert.equal(solveIntercept(shooter, target, still, SPEED), null, 'default maxTime is 2s');
  assert.equal(solveIntercept(shooter, target, still, SPEED, 2), null);
  assert.equal(solveIntercept(shooter, target, still, SPEED, 6), null, '5000m / 720 = 6.94s');

  const reachable = solveIntercept(shooter, target, still, SPEED, 7);
  assertSubstitutionHolds(shooter, target, still, SPEED, reachable, 'inside a raised maxTime');
  assert.equal(reachable.time, 5000 / SPEED);
});

test('the maxTime boundary is inclusive', () => {
  const shooter = v(0, 0, 0);
  const target = v(0, 0, -1440); // exactly 2s at 720 m/s
  const still = v(0, 0, 0);

  const exact = solveIntercept(shooter, target, still, SPEED, 2);
  assert.ok(exact, 'a hit exactly at maxTime must be accepted');
  assert.equal(exact.time, 2);

  assert.equal(solveIntercept(shooter, v(0, 0, -1440.001), still, SPEED, 2), null, 'a hair beyond is rejected');
});

test('the default maxTime is 2 seconds', () => {
  const shooter = v(0, 0, 0);
  const still = v(0, 0, 0);
  const inside = solveIntercept(shooter, v(0, 0, -1400), still, SPEED);
  const outside = solveIntercept(shooter, v(0, 0, -1500), still, SPEED);

  assert.ok(inside && inside.time <= DEFAULT_MAX_TIME, '1400m is reachable in 1.944s');
  assert.equal(outside, null, '1500m needs 2.083s and must be rejected by the default');
  assert.ok(solveIntercept(shooter, v(0, 0, -1500), still, SPEED, 2.1), 'and accepted when maxTime is raised');
});

test('a coincident shooter and target yield time 0', () => {
  const point = v(6, 6, 6);
  for (const velocity of [v(0, 0, 0), v(0, 0, -800), v(-300, 50, 20)]) {
    const solution = solveIntercept(point, point, velocity, SPEED);
    assert.ok(solution, `coincident with velocity ${JSON.stringify(velocity)}`);
    assert.equal(solution.time, 0);
    assert.deepEqual(solution.point, { x: 6, y: 6, z: 6 });
  }
  // Coincident but with a zero speed is still invalid input, not a free hit.
  assert.throws(() => solveIntercept(point, point, v(0, 0, 0), 0), RangeError);
});

test('illegal inputs raise RangeError before any solving', () => {
  const ok = v(1, 2, 3);
  const badVectors = [
    [undefined, ok, ok],
    [ok, undefined, ok],
    [ok, ok, undefined],
    [null, ok, ok],
    [ok, null, ok],
    [ok, ok, null],
    [v(Number.NaN, 0, 0), ok, ok],
    [v(0, Infinity, 0), ok, ok],
    [ok, v(0, 0, -Infinity), ok],
    [ok, ok, v(Number.NaN, 1, 1)],
    [v('1', 0, 0), ok, ok],
    [ok, v(0, null, 0), ok],
    [ok, ok, v(0, 0, undefined)],
  ];
  for (const [shooter, target, velocity] of badVectors) {
    assert.throws(() => solveIntercept(shooter, target, velocity, SPEED), RangeError);
  }

  for (const speed of [0, -1, -SPEED, Number.NaN, Infinity, -Infinity, '720', null, undefined]) {
    assert.throws(() => solveIntercept(ok, ok, ok, speed), RangeError, `speed ${String(speed)}`);
  }
  for (const limit of [0, -1, Number.NaN, Infinity, -Infinity, '2', null]) {
    assert.throws(() => solveIntercept(ok, v(0, 0, -100), ok, SPEED, limit), RangeError, `maxTime ${String(limit)}`);
  }
  // maxTime is optional; omitting it must not throw.
  assert.doesNotThrow(() => solveIntercept(ok, v(0, 0, -100), ok, SPEED));
});

test('inputs are never modified', () => {
  const shooter = Object.freeze(v(0, 0, 0));
  const target = Object.freeze(v(0, 120, -360));
  const velocity = Object.freeze(v(200, 0, 0));
  const before = [JSON.stringify(shooter), JSON.stringify(target), JSON.stringify(velocity)];

  const solution = solveIntercept(shooter, target, velocity, SPEED, 2);
  assertSubstitutionHolds(shooter, target, velocity, SPEED, solution, 'frozen inputs');

  assert.deepEqual([JSON.stringify(shooter), JSON.stringify(target), JSON.stringify(velocity)], before);
  assert.notEqual(solution.point, target, 'the result is a new object, not the caller vector');
  assert.notEqual(solution.point, shooter);
  assert.notEqual(solution.point, velocity);
});

test('results stay accurate at the real game magnitudes', () => {
  // Meter-scale fixtures at 720 m/s inside the 0..2s budget. Every fixture below was
  // confirmed to have an in-budget intercept; each solution is checked by substitution.
  const shooter = v(0, 0, 0);
  const fixtures = [
    [v(0, 0, -100), v(0, 0, 0)],
    [v(0, 0, -1440), v(0, 0, 0)],
    [v(300, -50, -900), v(-120, 20, 200)],
    [v(0, 500, 0), v(0, -300, 0)],
    [v(0, 120, -360), v(200, 0, 0)],
    [v(0, 80, -300), v(250, 0, -50)],
    [v(0, 0, -200), v(0, 0, -300)],
    [v(60, 0, -250), v(300, 0, 0)],
    [v(0, 0, -400), v(0, 0, 120)],
    [v(5.47, 1.2, -3.3), v(180, 0, -90)],
  ];
  const frameDistance = SPEED / 60;
  for (const [target, velocity] of fixtures) {
    const solution = solveIntercept(shooter, target, velocity, SPEED);
    assertSubstitutionHolds(shooter, target, velocity, SPEED, solution, JSON.stringify(target));
    assert.ok(solution.time > 0 && solution.time <= DEFAULT_MAX_TIME + 1e-12);
    // Substitution error stays far below the ~12m a single 1/60 frame covers at 720 m/s.
    const reachError = Math.abs(distance(solution.point, shooter) - SPEED * solution.time);
    assert.ok(reachError < frameDistance * 1e-3, `reach error ${reachError} for ${JSON.stringify(target)}`);
    assert.ok(distance(solution.point, movedTo(target, velocity, solution.time)) < frameDistance * 1e-3);
  }

  // A fixture whose only root lands beyond the budget must be refused, and the
  // analytic roots must confirm nothing earlier was missed.
  const slowTarget = v(-800, 100, -1200);
  const slowVelocity = v(400, -40, -400);
  assert.equal(solveIntercept(shooter, slowTarget, slowVelocity, SPEED), null);
  const { roots } = analyticRoots(shooter, slowTarget, slowVelocity, SPEED);
  assert.equal(roots.filter((time) => time >= 0 && time <= DEFAULT_MAX_TIME).length, 0);
});

test('a concrete firing solution, with its error, for integration review', () => {
  // Fixture used in the D07 report: player at the origin, target 120m above and 360m
  // ahead, crossing at 200 m/s; projectile 720 m/s.
  const shooter = v(0, 0, 0);
  const target = v(0, 120, -360);
  const velocity = v(200, 0, 0);
  const solution = solveIntercept(shooter, target, velocity, SPEED);

  assert.ok(solution);
  assert.ok(Math.abs(solution.time - 0.548638) < 1e-6, `time ${solution.time}`);
  assert.ok(Math.abs(solution.point.x - 109.7275) < 1e-3, `lead x ${solution.point.x}`);
  assert.equal(solution.point.y, 120);
  assert.equal(solution.point.z, -360);

  // The naive "aim straight at the target" answer is measurably wrong, so the solver
  // is doing real work: aiming at the current position misses by ~110m.
  const naiveMiss = distance(target, solution.point);
  assert.ok(naiveMiss > 100, `naive aim should be far off, got ${naiveMiss}`);
});
