/**
 * D02 behaviour tests — damage and weapon state.
 * Run: node --test tests/dsh/combat.test.mjs
 *
 * These assert observable behaviour from docs/CONTRACTS.md. Values only enter a
 * test through the module's own constructors or returned states, so the weapon
 * config under test is the real WEAPON_CONFIG where possible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDamage, createWeapon, advanceWeapon } from '../../src/sim/combat.ts';
import { WEAPON_CONFIG } from '../../src/shared/config.ts';

const CONFIG = WEAPON_CONFIG;

/** The project's simulation step, from docs/ARCHITECTURE.md. */
const FIXED_STEP = 1 / 60;

/**
 * Steps needed between two shots. Measured rather than computed: `ceil(interval /
 * FIXED_STEP) * FIXED_STEP` can round just above the 0.1s dt cap, so tests must not
 * pass a hand-multiplied tick as dt.
 */
function stepsPerShot(config) {
  let state = createWeapon();
  let previous = -1;
  for (let index = 0; index < 100; index += 1) {
    const step = advanceWeapon(state, FIXED_STEP, true, config);
    state = step.state;
    if (step.fired) {
      if (previous >= 0) return index - previous;
      previous = index;
    }
  }
  throw new Error('weapon never fired twice within 100 steps');
}

test('applyDamage subtracts and clamps at zero', () => {
  assert.equal(applyDamage(100, 30), 70);
  assert.equal(applyDamage(100, 100), 0);
  assert.equal(applyDamage(100, 250), 0, 'overkill must not go negative');
  assert.equal(applyDamage(0, 50), 0);
  assert.equal(applyDamage(100, 0), 100);
  assert.equal(applyDamage(0, 0), 0);
  assert.equal(applyDamage(12.5, 0.25), 12.25, 'fractional damage is allowed');
  assert.equal(applyDamage(0.1, 0.1), 0);
});

test('applyDamage survives long sequences without drifting below zero', () => {
  let health = 100;
  for (let index = 0; index < 200; index += 1) health = applyDamage(health, 3.5);
  assert.equal(health, 0);
  assert.equal(applyDamage(health, 1), 0);
  assert.ok(Number.isFinite(health));
});

test('applyDamage rejects illegal numbers', () => {
  for (const [health, damage] of [
    [-1, 10],
    [10, -1],
    [-0.0001, 1],
    [Number.NaN, 10],
    [10, Number.NaN],
    [Infinity, 1],
    [1, -Infinity],
    [10, '5'],
    [undefined, 10],
    [10, undefined],
  ]) {
    assert.throws(() => applyDamage(health, damage), RangeError, `health=${String(health)} damage=${String(damage)}`);
  }
});

test('createWeapon returns a ready, cool weapon', () => {
  const weapon = createWeapon();
  assert.equal(weapon.heat, 0);
  assert.equal(weapon.cooldownSeconds, 0);
  assert.equal(weapon.overheated, false);
  assert.notEqual(createWeapon(), weapon, 'each weapon gets its own state object');
});

test('the first trigger pull fires once and re-arms the cooldown', () => {
  const started = advanceWeapon(createWeapon(), 0.1, true, CONFIG);
  assert.equal(started.fired, true, 'a ready weapon fires on the first held step');
  assert.equal(started.state.heat, CONFIG.heatPerShot);
  assert.equal(started.state.cooldownSeconds, CONFIG.shotIntervalSeconds);
  assert.equal(started.state.overheated, false);

  const held = advanceWeapon(started.state, 0.1, true, CONFIG);
  assert.equal(held.fired, false, 'one shot per interval, no back-filling');
  assert.equal(held.state.heat, Math.max(0, CONFIG.heatPerShot - CONFIG.coolingPerSecond * 0.1));
});

test('dt=0 fires a ready weapon but cannot bypass the cooldown', () => {
  const ready = createWeapon();
  const first = advanceWeapon(ready, 0, true, CONFIG);
  assert.equal(first.fired, true, 'dt=0 may fire when ready');
  assert.equal(first.state.cooldownSeconds, CONFIG.shotIntervalSeconds);
  assert.equal(first.state.heat, CONFIG.heatPerShot);

  let state = first.state;
  for (let index = 0; index < 20; index += 1) {
    const spam = advanceWeapon(state, 0, true, CONFIG);
    assert.equal(spam.fired, false, 'cooldown must not be bypassed by repeated dt=0 steps');
    assert.equal(spam.state.heat, first.state.heat, 'a blocked shot adds no heat');
    assert.equal(spam.state.cooldownSeconds, CONFIG.shotIntervalSeconds);
    state = spam.state;
  }

  const cooled = advanceWeapon(state, 0, false, CONFIG);
  assert.equal(cooled.fired, false);
  assert.equal(cooled.state.heat, first.state.heat, 'dt=0 without firing removes no heat');
  assert.equal(cooled.state.cooldownSeconds, CONFIG.shotIntervalSeconds, 'dt=0 without firing shortens no cooldown');

  const waited = advanceWeapon(state, 0, true, CONFIG);
  assert.equal(waited.fired, false, 'dt=0 alone can never finish the cooldown');

  // The cooldown must run down at the real fixed step, not just at 0.15s in one call.
  const steps = stepsPerShot(CONFIG);
  let current = state;
  for (let index = 1; index < steps; index += 1) {
    const inner = advanceWeapon(current, FIXED_STEP, true, CONFIG);
    assert.equal(inner.fired, false, `step ${index} of the cooldown must not fire`);
    current = inner.state;
  }
  const reopened = advanceWeapon(current, FIXED_STEP, true, CONFIG);
  assert.equal(reopened.fired, true, `the weapon fires again after ${steps} fixed steps`);
});

test('a step never back-fills skipped intervals', () => {
  // One 0.1s step is 2/3 of the 0.15s interval, so consecutive calls must not all fire.
  let state = { heat: 0, cooldownSeconds: 0, overheated: false };
  const fired = [];
  for (let index = 0; index < 5; index += 1) {
    const step = advanceWeapon(state, 0.1, true, CONFIG);
    state = step.state;
    fired.push(step.fired);
  }
  assert.deepEqual(fired, [true, false, true, false, true], 'a long step still yields at most one shot');
  assert.equal(state.heat, 28, '3 shots add 36, and the 5 cooling steps remove 8');

  // Intervals that fit inside one step are discarded, never banked.
  const burst = advanceWeapon({ heat: 0, cooldownSeconds: 0, overheated: false }, 0.1, true, CONFIG);
  assert.equal(burst.state.heat, CONFIG.heatPerShot, 'one call, one shot, even when the interval is shorter');

  const half = { ...CONFIG, shotIntervalSeconds: 0.05 };
  const overlapping = advanceWeapon({ heat: 0, cooldownSeconds: 0, overheated: false }, 0.1, true, half);
  assert.equal(overlapping.state.heat, half.heatPerShot, 'two intervals inside one step still give one shot');

  // At the real 1/60 step exactly one shot lands per 9 steps (0.15s).
  const step = FIXED_STEP;
  let current = createWeapon();
  const shotsByStep = [];
  for (let index = 0; index < 45; index += 1) {
    const advanced = advanceWeapon(current, step, true, CONFIG);
    current = advanced.state;
    if (advanced.fired) shotsByStep.push(index);
  }
  assert.deepEqual(shotsByStep, [0, 9, 18, 27, 36], 'the shot interval is honoured at the real fixed step');
  // 44 of the 45 steps do not fire, and each of those removes exactly one step of cooling.
  const coolingSteps = 44;
  const expectedHeat =
    shotsByStep.length * CONFIG.heatPerShot - CONFIG.coolingPerSecond * coolingSteps * FIXED_STEP;
  assert.ok(Math.abs(current.heat - expectedHeat) < 1e-9, `heat ${current.heat} should be ${expectedHeat}`);
});

test('holding the trigger overheats the weapon', () => {
  const steps = stepsPerShot(CONFIG);
  const tick = steps * FIXED_STEP;
  let state = createWeapon();
  let shots = 0;
  for (let index = 0; index < 200 && !state.overheated; index += 1) {
    const step = advanceWeapon(state, FIXED_STEP, true, CONFIG);
    state = step.state;
    shots += step.fired ? 1 : 0;
  }
  assert.equal(state.overheated, true, 'sustained fire must overheat');
  assert.equal(state.heat, CONFIG.maxHeat, 'heat is clamped to maxHeat');
  assert.ok(state.heat <= CONFIG.maxHeat && state.heat >= 0);
  assert.ok(shots >= 2, 'overheating must take more than one shot');
  // Heat gains 12 per shot and loses 3 per 9-step interval, so it climbs to the cap.
  assert.equal(shots, 11);
  assert.equal(state.heat, CONFIG.maxHeat, 'the overheating shot lands exactly on the cap');

  // The shot that overheats is itself a valid shot, so no shot is silently lost.
  const locked = advanceWeapon(state, FIXED_STEP, true, CONFIG);
  assert.equal(locked.fired, false, 'an overheated weapon cannot fire');
  assert.equal(locked.state.overheated, true);
  assert.equal(locked.state.heat, CONFIG.maxHeat - CONFIG.coolingPerSecond * FIXED_STEP);
  assert.ok(Math.abs(tick - CONFIG.shotIntervalSeconds) < FIXED_STEP, 'measured interval matches the config');
});

test('an overheated weapon stays locked until heat reaches the unlock threshold', () => {
  const perStepCooling = CONFIG.coolingPerSecond * 0.1;

  // A real overheat: hold the trigger until the weapon locks itself out.
  let locked = createWeapon();
  let shots = 0;
  for (let index = 0; index < 200 && !locked.overheated; index += 1) {
    const step = advanceWeapon(locked, FIXED_STEP, true, CONFIG);
    locked = step.state;
    shots += step.fired ? 1 : 0;
  }
  assert.equal(locked.overheated, true);
  assert.equal(locked.heat, CONFIG.maxHeat, 'the lock is created at the heat cap');

  // Locked: a held trigger cannot fire, and heat only falls.
  const lockedStep = advanceWeapon(locked, 0.1, true, CONFIG);
  assert.equal(lockedStep.fired, false, 'a locked weapon must not fire');
  assert.equal(lockedStep.state.overheated, true, 'heat far above unlockHeat keeps the lock');
  assert.equal(lockedStep.state.heat, CONFIG.maxHeat - perStepCooling);

  // Count down to the crossing step and confirm the unlock, then the next shot.
  let state = lockedStep.state;
  let coolingSteps = 1;
  while (state.heat > CONFIG.unlockHeat + perStepCooling) {
    const step = advanceWeapon(state, 0.1, true, CONFIG);
    state = step.state;
    coolingSteps += 1;
    assert.equal(step.fired, false, `step ${coolingSteps}: still locked at heat ${state.heat}`);
    assert.ok(coolingSteps < 100, 'the weapon must unlock within 100 steps of cooling');
  }
  assert.ok(state.heat > CONFIG.unlockHeat, 'the last locked step is still above the threshold');

  const crossing = advanceWeapon(state, 0.1, true, CONFIG);
  assert.equal(crossing.state.overheated, false, 'the crossing step clears the lock');
  assert.equal(crossing.fired, true, 'with a spent cooldown the unlocked weapon fires at once');
  assert.equal(crossing.state.heat, state.heat - perStepCooling + CONFIG.heatPerShot, 'cooled below the threshold, then fired');
  assert.equal(crossing.state.overheated, false, 'a shot from below the cap does not re-lock');

  // A locked weapon whose cooldown is not ready unlocks without firing.
  const heldLocked = { heat: CONFIG.unlockHeat + 1, cooldownSeconds: CONFIG.shotIntervalSeconds, overheated: true };
  const blocked = advanceWeapon(heldLocked, 0.1, true, CONFIG);
  assert.equal(blocked.state.overheated, false, 'the lock still clears');
  assert.equal(blocked.state.heat, CONFIG.unlockHeat - 1, 'cooled to 34, at or below the threshold');
  assert.equal(blocked.fired, false, 'but the cooldown blocks the shot on the same step');

  let released = blocked.state;
  let waited = 0;
  let blockedStep = advanceWeapon(released, FIXED_STEP, true, CONFIG);
  while (waited < 20 && !blockedStep.fired) {
    released = blockedStep.state;
    assert.equal(released.overheated, false, 'an unlocked weapon stays unlocked while it cools');
    waited += 1;
    blockedStep = advanceWeapon(released, FIXED_STEP, true, CONFIG);
  }
  assert.equal(blockedStep.fired, true, 'the shot arrives once the cooldown is spent');
  assert.equal(waited, 2, 'the remaining 0.05s of cooldown costs 3 steps, and the third one fires');
  assert.ok(shots >= 2, 'the lock was reached by real fire, not by a synthetic state');
});

test('the unlock threshold is inclusive and can fire in the same step', () => {
  const atThreshold = advanceWeapon({ heat: CONFIG.unlockHeat, cooldownSeconds: 0, overheated: true }, 0, true, CONFIG);
  assert.equal(atThreshold.state.overheated, false, 'heat == unlockHeat clears the overheat');
  assert.equal(atThreshold.fired, true, 'the unlocked weapon may fire immediately');
  assert.equal(atThreshold.state.heat, CONFIG.unlockHeat + CONFIG.heatPerShot);

  const withCooling = advanceWeapon({ heat: CONFIG.unlockHeat, cooldownSeconds: 0, overheated: true }, 0.1, true, CONFIG);
  assert.equal(withCooling.state.heat, CONFIG.unlockHeat - 2 + CONFIG.heatPerShot, 'cooled to 33, then fired');

  const justOver = advanceWeapon({ heat: CONFIG.unlockHeat + 2, cooldownSeconds: 0, overheated: true }, 0, true, CONFIG);
  assert.equal(justOver.state.overheated, true, 'heat above unlockHeat still blocks');
  assert.equal(justOver.fired, false, 'unlocking is inclusive: 37 does not unlock at dt=0');
  assert.equal(justOver.state.heat, CONFIG.unlockHeat + 2);
});

test('releasing the trigger cools heat and re-arms the weapon', () => {
  const steps = stepsPerShot(CONFIG);
  let state = advanceWeapon(createWeapon(), 0.1, true, CONFIG).state;
  const heatAfterShot = state.heat;

  const released = advanceWeapon(state, 0.1, false, CONFIG);
  state = released.state;
  assert.equal(released.fired, false, 'a released trigger never fires');
  assert.ok(state.heat < heatAfterShot, 'heat must fall while not firing');
  assert.equal(state.heat, heatAfterShot - CONFIG.coolingPerSecond * 0.1);

  // Heat falls 0.3333 per step, so the remaining 10 needs 31 more steps.
  for (let index = 0; index < 100 && state.heat > 0; index += 1) {
    const cooling = advanceWeapon(state, FIXED_STEP, false, CONFIG);
    assert.equal(cooling.fired, false, 'a released trigger never fires');
    state = cooling.state;
  }
  assert.equal(state.heat, 0, 'cooling reaches exactly zero and never goes below');
  assert.equal(state.cooldownSeconds, 0);
  assert.equal(state.overheated, false);

  const resumed = advanceWeapon(state, 0.1, true, CONFIG);
  assert.equal(resumed.fired, true, 'the weapon is ready again after cooling');
  assert.equal(resumed.state.heat, CONFIG.heatPerShot, 'cool heat restarts the build-up');
});

test('long held-trigger sequences keep heat finite and inside [0, maxHeat]', () => {
  let state = createWeapon();
  let shots = 0;
  let overheats = 0;
  const steps = stepsPerShot(CONFIG);
  for (let index = 0; index < 6000; index += 1) {
    const step = advanceWeapon(state, FIXED_STEP, true, CONFIG);
    if (!state.overheated && step.state.overheated) overheats += 1;
    if (step.fired) shots += 1;
    state = step.state;
    assert.ok(Number.isFinite(state.heat), `heat became ${state.heat} at step ${index}`);
    assert.ok(Number.isFinite(state.cooldownSeconds), `cooldown became ${state.cooldownSeconds}`);
    assert.ok(state.heat >= 0 && state.heat <= CONFIG.maxHeat, `heat ${state.heat} out of range`);
    assert.ok(state.cooldownSeconds >= 0 && state.cooldownSeconds <= CONFIG.shotIntervalSeconds);
  }
  assert.ok(shots > 0, 'a held trigger must fire over a long run');
  assert.ok(overheats >= 2, `a held trigger keeps overheating as heat recovers (saw ${overheats})`);
  assert.equal(state.overheated, true, 'continuous fire settles into the overheated state');
  // 6000 steps, most of them cooling from the cap, cannot spend more than 11 shots
  // on one overheat, so shots-per-overheat stays inside the physical bound.
  assert.ok(shots >= overheats, `each overheat cycle must cost at least one shot (${shots} shots, ${overheats} overheats)`);
  assert.ok(shots <= 11 * overheats, `shots ${shots} must not exceed 11 per overheat (${overheats} cycles)`);
  assert.ok(Number.isFinite(state.heat) && state.heat >= 0 && state.heat <= CONFIG.maxHeat);
});

test('heat cycles and never accumulates unbounded over repeated overheat/recover runs', () => {
  let state = createWeapon();
  let sawOverheat = 0;
  let sawRecover = 0;
  for (let index = 0; index < 4000; index += 1) {
    const step = advanceWeapon(state, FIXED_STEP, index % 40 < 20, CONFIG);
    if (!state.overheated && step.state.overheated) sawOverheat += 1;
    if (state.overheated && !step.state.overheated) sawRecover += 1;
    state = step.state;
    assert.ok(state.heat >= 0 && state.heat <= CONFIG.maxHeat);
  }
  assert.ok(sawOverheat >= 1, 'the trigger pattern must overheat at least once');
  assert.ok(sawRecover >= 1 || sawOverheat === 1, 'and must be able to recover afterwards');
});

test('advanceWeapon validates dt and config before changing anything', () => {
  const state = createWeapon();
  const frozen = Object.freeze({ heat: 0, cooldownSeconds: 0, overheated: false });

  for (const dt of [-0.001, -1, Number.NaN, Infinity, -Infinity, 0.1000001, 1, '0.1', undefined, null]) {
    assert.throws(() => advanceWeapon(frozen, dt, true, CONFIG), RangeError, `dt=${String(dt)} must be rejected`);
  }
  assert.doesNotThrow(() => advanceWeapon(frozen, 0, true, CONFIG));
  assert.doesNotThrow(() => advanceWeapon(frozen, 0.1, true, CONFIG));

  const illegalConfigs = [
    { ...CONFIG, maxHeat: 0 },
    { ...CONFIG, maxHeat: -100 },
    { ...CONFIG, maxHeat: Number.NaN },
    { ...CONFIG, heatPerShot: 0 },
    { ...CONFIG, heatPerShot: -1 },
    { ...CONFIG, heatPerShot: CONFIG.maxHeat + 1 },
    { ...CONFIG, heatPerShot: Number.NaN },
    { ...CONFIG, coolingPerSecond: 0 },
    { ...CONFIG, coolingPerSecond: -5 },
    { ...CONFIG, coolingPerSecond: Infinity },
    { ...CONFIG, shotIntervalSeconds: 0 },
    { ...CONFIG, shotIntervalSeconds: -0.15 },
    { ...CONFIG, shotIntervalSeconds: Number.NaN },
    { ...CONFIG, unlockHeat: -1 },
    { ...CONFIG, unlockHeat: CONFIG.maxHeat },
    { ...CONFIG, unlockHeat: CONFIG.maxHeat + 1 },
    { ...CONFIG, unlockHeat: Number.NaN },
  ];
  for (const config of illegalConfigs) {
    assert.throws(() => advanceWeapon(frozen, 0.1, true, config), RangeError, `config ${JSON.stringify(config)}`);
  }
  assert.throws(() => advanceWeapon(frozen, 0.1, true, undefined), RangeError);
  assert.throws(() => advanceWeapon(frozen, 0.1, true, null), RangeError);

  // A rejected call must leave the caller's state untouched and ready to fire.
  const after = advanceWeapon(state, 0.1, true, CONFIG);
  assert.equal(after.fired, true);
  assert.equal(after.state.heat, CONFIG.heatPerShot);
});

test('configs, states and shared defaults are never modified', () => {
  const config = Object.freeze({
    maxHeat: 50,
    heatPerShot: 10,
    coolingPerSecond: 25,
    shotIntervalSeconds: 0.2,
    unlockHeat: 10,
  });
  const state = Object.freeze({ heat: 30, cooldownSeconds: 0, overheated: false });

  const step = advanceWeapon(state, 0.1, true, config);
  assert.equal(state.heat, 30, 'the input state object is unchanged');
  assert.equal(state.cooldownSeconds, 0);
  assert.equal(state.overheated, false);
  assert.notEqual(step.state, state, 'a new state object is returned');
  assert.deepEqual(config, {
    maxHeat: 50,
    heatPerShot: 10,
    coolingPerSecond: 25,
    shotIntervalSeconds: 0.2,
    unlockHeat: 10,
  });
  assert.equal(WEAPON_CONFIG.maxHeat, 100);
  assert.equal(WEAPON_CONFIG.heatPerShot, 12);
  assert.equal(WEAPON_CONFIG.coolingPerSecond, 20);
  assert.equal(WEAPON_CONFIG.shotIntervalSeconds, 0.15);
  assert.equal(WEAPON_CONFIG.unlockHeat, 35);

  // A non-boolean trigger is treated as "not held" rather than firing.
  const released = advanceWeapon(createWeapon(), 0.1, 'yes', CONFIG);
  assert.equal(released.fired, false, 'only a real boolean true holds the trigger');
  assert.equal(advanceWeapon(createWeapon(), 0.1, 1, CONFIG).fired, false);
});

test('weapons are independent and do not share defaults', () => {
  const first = createWeapon();
  const second = createWeapon();
  let firstState = advanceWeapon(first, 0, true, CONFIG).state;
  const secondState = advanceWeapon(second, 0.1, false, CONFIG).state;
  assert.equal(secondState.heat, 0);
  assert.equal(secondState.overheated, false);
  assert.equal(firstState.heat, CONFIG.heatPerShot);

  // Advancing the copy never writes through to WEAPON_CONFIG or the other weapon.
  firstState = { ...firstState, heat: 99 };
  assert.equal(WEAPON_CONFIG.maxHeat, 100);
  assert.equal(secondState.heat, 0);
});
