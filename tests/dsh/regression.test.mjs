/**
 * D04 — bounded deterministic regression over mission + weapon + casualties + restart.
 * Run: node --test tests/dsh/regression.test.mjs
 *
 * No graphics, no real timers, no network: a seeded PRNG drives a simple bot that
 * plays whole missions at the fixed 1/60 step. The same seed must always produce
 * the same digest, and every invariant must hold on every step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission, advanceMission } from '../../src/sim/mission.ts';
import { applyDamage, createWeapon, advanceWeapon } from '../../src/sim/combat.ts';
import { MISSION_CONFIG, WEAPON_CONFIG } from '../../src/shared/config.ts';

const FIXED_STEP = 1 / 60;
/** Hard bound on total simulated steps, per the D04 brief (<= 100000). */
const MAX_STEPS = 6000;
const DIGEST_STRIDE = 17;
const MAX_ACTIVE_ENEMIES = MISSION_CONFIG.maxActiveEnemies;
const TOTAL_WAVES = MISSION_CONFIG.waves.length;
const TOTAL_ENEMIES = MISSION_CONFIG.waves.reduce((sum, count) => sum + count, 0);

/** Deterministic 32-bit PRNG (mulberry32). The only source of variation in this file. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap stable string hash, used for the run digest. */
function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function freezeInput(playerAlive, carrierAlive, destroyedEnemyIds) {
  return Object.freeze({
    playerAlive,
    carrierAlive,
    destroyedEnemyIds: Object.freeze([...destroyedEnemyIds]),
  });
}

const FROZEN_MISSION_CONFIG = Object.freeze({
  waves: Object.freeze([...MISSION_CONFIG.waves]),
  briefingSeconds: MISSION_CONFIG.briefingSeconds,
  intermissionSeconds: MISSION_CONFIG.intermissionSeconds,
  maxActiveEnemies: MAX_ACTIVE_ENEMIES,
});

const FROZEN_WEAPON_CONFIG = Object.freeze({ ...WEAPON_CONFIG });

/**
 * Plays one bounded mission.
 * `killChance` is the per-step probability of shooting at an active enemy, so the
 * bot sometimes stalls and sometimes clears waves fast. `fate` optionally kills the
 * player or carrier at a fixed step, which is how losses are reached deterministically.
 */
function runMission({ seed, killChance = 0.9, fate = null, maxSteps = MAX_STEPS }) {
  const random = makeRandom(seed);
  let mission = createMission(FROZEN_MISSION_CONFIG);
  let weapon = createWeapon();
  let playerHealth = 100;
  let carrierHealth = 1000;
  let playerAlive = true;
  let carrierAlive = true;
  let shots = 0;
  let damageDealt = 0;
  const spawnCounts = [];
  const digests = [];
  const eventsSeen = [];
  let steps = 0;
  let previousWaveIndex = mission.waveIndex;

  while (steps < maxSteps && mission.phase !== 'won' && mission.phase !== 'lost') {
    if (fate && steps === fate.step) {
      if (fate.target === 'player') {
        playerHealth = applyDamage(playerHealth, fate.damage);
        playerAlive = playerHealth > 0;
      } else {
        carrierHealth = applyDamage(carrierHealth, fate.damage);
        carrierAlive = carrierHealth > 0;
      }
    }

    const triggerHeld = random() < killChance;
    const weaponStep = advanceWeapon(weapon, FIXED_STEP, triggerHeld, FROZEN_WEAPON_CONFIG);
    weapon = weaponStep.state;
    if (weaponStep.fired) {
      shots += 1;
      damageDealt += 10;
      if (random() < 0.25) {
        playerHealth = applyDamage(playerHealth, 5);
        playerAlive = playerHealth > 0;
      }
    }

    // One confirmed kill per step at most: the wave IDs only ever come from state.
    const destroyed = [];
    if (mission.phase === 'combat' && mission.activeEnemyIds.length > 0 && random() < 0.6) {
      destroyed.push(mission.activeEnemyIds[0]);
    }

    const input = freezeInput(playerAlive, carrierAlive, destroyed);
    const step = advanceMission(mission, FIXED_STEP, input, FROZEN_MISSION_CONFIG);
    mission = step.state;

    for (const event of step.events) {
      eventsSeen.push(event.type);
      if (event.type === 'spawn-wave') {
        spawnCounts.push(event.enemyIds.length);
        assert.deepEqual(
          [...event.enemyIds],
          [...mission.activeEnemyIds],
          'spawn-wave enemyIds must match the returned active list',
        );
        assert.equal(event.waveIndex, mission.waveIndex);
        assert.ok(event.enemyIds.length >= 1 && event.enemyIds.length <= MAX_ACTIVE_ENEMIES);
      }
    }

    if (mission.waveIndex !== previousWaveIndex) {
      assert.equal(mission.waveIndex, previousWaveIndex + 1, 'waves only ever advance by one');
      previousWaveIndex = mission.waveIndex;
    }

    // Invariants that must hold on every single step.
    assert.ok(
      mission.activeEnemyIds.length <= MAX_ACTIVE_ENEMIES,
      `step ${steps}: ${mission.activeEnemyIds.length} active enemies exceeds the cap`,
    );
    assert.equal(new Set(mission.activeEnemyIds).size, mission.activeEnemyIds.length, `step ${steps}: duplicate ID`);
    assert.ok(Number.isFinite(weapon.heat) && weapon.heat >= 0 && weapon.heat <= FROZEN_WEAPON_CONFIG.maxHeat);
    assert.ok(Number.isFinite(weapon.cooldownSeconds) && weapon.cooldownSeconds >= 0);
    assert.ok(Number.isFinite(mission.elapsedSeconds) && mission.elapsedSeconds >= 0);
    assert.ok(Number.isFinite(mission.phaseSeconds) && mission.phaseSeconds >= 0);
    assert.ok(Number.isInteger(mission.kills) && mission.kills >= 0 && mission.kills <= TOTAL_ENEMIES);
    assert.ok(playerHealth >= 0 && playerHealth <= 100);
    assert.ok(carrierHealth >= 0 && carrierHealth <= 1000);

    if (steps % DIGEST_STRIDE === 0) {
      digests.push(
        [
          steps,
          mission.phase,
          mission.waveIndex,
          mission.activeEnemyIds.join('|'),
          mission.kills,
          mission.elapsedSeconds.toFixed(6),
          mission.phaseSeconds.toFixed(6),
          weapon.heat.toFixed(6),
          weapon.cooldownSeconds.toFixed(6),
          weapon.overheated ? 1 : 0,
          playerHealth,
          carrierHealth,
          shots,
        ].join(','),
      );
    }
    steps += 1;
  }

  return {
    seed,
    steps,
    mission,
    weapon,
    playerHealth,
    carrierHealth,
    shots,
    damageDealt,
    spawnCounts,
    eventsSeen,
    digest: hashString(digests.join('\n')),
    digestLines: digests.length,
  };
}

/** Drives a run that has already ended, to prove terminal states stay frozen. */
function continueAfterEnd(run, extraSteps = 200) {
  let mission = run.mission;
  let weapon = run.weapon;
  const random = makeRandom(run.seed ^ 0x9e3779b9);
  let extraShots = 0;
  const events = [];
  for (let index = 0; index < extraSteps; index += 1) {
    const weaponStep = advanceWeapon(weapon, FIXED_STEP, random() < 0.9, FROZEN_WEAPON_CONFIG);
    weapon = weaponStep.state;
    if (weaponStep.fired) extraShots += 1;
    const destroyed = mission.activeEnemyIds.length > 0 ? [mission.activeEnemyIds[0]] : [];
    const step = advanceMission(mission, FIXED_STEP, freezeInput(true, true, destroyed), FROZEN_MISSION_CONFIG);
    mission = step.state;
    for (const event of step.events) events.push(event.type);
  }
  return { mission, weapon, events, extraShots };
}

test('D04 harness metadata: bounded steps, no timers, deterministic PRNG', () => {
  const started = Date.now();
  const first = runMission({ seed: 1 });
  const elapsedMs = Date.now() - started;
  assert.ok(first.steps <= MAX_STEPS, `${first.steps} steps must stay inside the ${MAX_STEPS} bound`);
  assert.ok(elapsedMs < 30000, `a bounded run must stay fast, took ${elapsedMs}ms`);
  // Recorded for the report; never used to infer GPU frame rate.
  console.log(
    `[D04] node ${process.version}, seed 1: ${first.steps} steps, digest ${first.digest}, ${elapsedMs}ms`,
  );
});

test('the same seed and inputs always produce the same result', () => {
  const a = runMission({ seed: 20261015 });
  const b = runMission({ seed: 20261015 });
  assert.equal(a.digest, b.digest, 'identical seeds must produce identical digests');
  assert.equal(a.steps, b.steps);
  assert.deepEqual(a.spawnCounts, b.spawnCounts);
  assert.deepEqual(a.eventsSeen, b.eventsSeen);
  assert.deepEqual({ ...a.mission }, { ...b.mission });
  assert.deepEqual(a.weapon, b.weapon);
  assert.equal(a.shots, b.shots);
  assert.equal(a.playerHealth, b.playerHealth);
  assert.equal(a.carrierHealth, b.carrierHealth);
  assert.ok(a.digestLines > 10, 'the digest must cover many sampled steps');
});

test('different seeds genuinely diverge, so the digest is meaningful', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const runs = seeds.map((seed) => runMission({ seed }));
  const outcomes = new Set(runs.map((run) => `${run.mission.phase}:${run.steps}:${run.digest}`));
  assert.ok(outcomes.size > 1, 'the harness must not collapse every seed onto one result');
  // And each seed still repeats exactly.
  for (const run of runs) {
    const again = runMission({ seed: run.seed });
    assert.equal(again.digest, run.digest, `seed ${run.seed} must be reproducible`);
  }
});

test('a full campaign never exceeds the active-enemy cap or the wave table', () => {
  for (const seed of [11, 22, 33, 44]) {
    const run = runMission({ seed, killChance: 0.85 });
    assert.ok(run.steps <= MAX_STEPS);
    assert.equal(run.spawnCounts.length, run.mission.waveIndex + 1, 'exactly one spawn per entered wave');
    assert.deepEqual(
      run.spawnCounts,
      MISSION_CONFIG.waves.slice(0, run.spawnCounts.length),
      'each spawn matches the configured wave size',
    );
    assert.ok(run.spawnCounts.every((count) => count <= MAX_ACTIVE_ENEMIES));
    assert.ok(run.mission.kills <= TOTAL_ENEMIES);
    assert.ok(
      run.eventsSeen.filter((type) => type === 'spawn-wave').length === run.spawnCounts.length,
      'no duplicate spawn events',
    );
    assert.equal(run.mission.phase, 'won');
    assert.equal(run.mission.kills, TOTAL_ENEMIES, 'a won campaign kills every enemy');
  }
});

test('a wave is spawned exactly once, even when the run continues afterwards', () => {
  const run = runMission({ seed: 77 });
  const spawnEvents = run.eventsSeen.filter((type) => type === 'spawn-wave').length;
  assert.equal(spawnEvents, run.mission.waveIndex + 1);
  const after = continueAfterEnd(run, 400);
  assert.deepEqual(after.events, [], 'a finished mission emits no further events');
  assert.equal(after.mission, run.mission, 'a terminal state is returned unchanged');
  assert.equal(after.mission.waveIndex, run.mission.waveIndex, 'no further waves');
  assert.deepEqual(after.mission.activeEnemyIds, run.mission.activeEnemyIds);
  assert.equal(after.mission.kills, run.mission.kills, 'no post-game kills are counted');
});

test('health never goes negative and heat stays finite inside its range', () => {
  const runs = [
    runMission({ seed: 101, killChance: 1 }),
    runMission({ seed: 202, killChance: 0.5 }),
    runMission({ seed: 303, killChance: 0, fate: { step: 200, target: 'player', damage: 100 } }),
    runMission({ seed: 404, killChance: 0.7, fate: { step: 90, target: 'carrier', damage: 1000 } }),
  ];
  for (const run of runs) {
    assert.ok(Number.isFinite(run.playerHealth) && run.playerHealth >= 0);
    assert.ok(Number.isFinite(run.carrierHealth) && run.carrierHealth >= 0);
    assert.ok(Number.isFinite(run.weapon.heat) && run.weapon.heat >= 0 && run.weapon.heat <= WEAPON_CONFIG.maxHeat);
    assert.ok(Number.isFinite(run.weapon.cooldownSeconds) && run.weapon.cooldownSeconds >= 0);
    assert.ok(run.weapon.cooldownSeconds <= WEAPON_CONFIG.shotIntervalSeconds);
    assert.ok(applyDamage(run.playerHealth, 999) === 0, 'damage past zero clamps at zero');
  }
  const playerLoss = runs[2];
  assert.equal(playerLoss.mission.phase, 'lost');
  assert.equal(playerLoss.mission.lossReason, 'player-destroyed');
  const carrierLoss = runs[3];
  assert.equal(carrierLoss.mission.phase, 'lost');
  assert.equal(carrierLoss.mission.lossReason, 'carrier-destroyed');
});

test('a loss ends the mission for good: no new waves, kills or time', () => {
  const lost = runMission({ seed: 55, fate: { step: 120, target: 'player', damage: 500 } });
  assert.equal(lost.mission.phase, 'lost');
  assert.equal(lost.mission.lossReason, 'player-destroyed');
  const frozen = lost.mission;
  const after = continueAfterEnd(lost, 600);
  assert.equal(after.mission, frozen);
  assert.equal(after.mission.waveIndex, frozen.waveIndex);
  assert.equal(after.mission.kills, frozen.kills);
  assert.equal(after.mission.elapsedSeconds, frozen.elapsedSeconds);
  assert.deepEqual(after.events, []);
});

test('100 restarts leave no enemy IDs, kills or timers behind', () => {
  const digests = new Set();
  let wins = 0;
  let losses = 0;
  for (let index = 0; index < 100; index += 1) {
    const run = runMission({ seed: 9000 + index, killChance: 0.92, maxSteps: 3000 });
    assert.equal(run.mission.phase === 'won' || run.mission.phase === 'lost', true, `run ${index} did not finish`);
    if (run.mission.phase === 'won') {
      wins += 1;
      assert.deepEqual(run.mission.activeEnemyIds, [], `run ${index} left enemies behind`);
      assert.equal(run.mission.kills, TOTAL_ENEMIES, `run ${index} lost kills`);
    } else {
      losses += 1;
      assert.equal(run.mission.lossReason !== null, true, `run ${index} lost without a reason`);
    }
    assert.equal(run.mission.lossReason === null, run.mission.phase === 'won');
    digests.add(run.digest);
  }
  assert.equal(wins + losses, 100);
  assert.ok(wins > 0, 'the harness must be able to win sometimes');
  assert.ok(digests.size > 1, 'restarts must not all replay the same game');
});

test('a fresh restart starts from a clean briefing, not from the previous result', () => {
  const finished = runMission({ seed: 4242, killChance: 0.95, maxSteps: 3000 });
  assert.ok(finished.mission.phase === 'won' || finished.mission.phase === 'lost');

  const restarted = createMission(FROZEN_MISSION_CONFIG);
  assert.equal(restarted.phase, 'briefing');
  assert.equal(restarted.waveIndex, -1);
  assert.deepEqual(restarted.activeEnemyIds, []);
  assert.equal(restarted.kills, 0);
  assert.equal(restarted.elapsedSeconds, 0);
  assert.equal(restarted.phaseSeconds, 0);
  assert.equal(restarted.lossReason, null);
  assert.notEqual(finished.mission.phase, restarted.phase);
  // A second identical run reaches exactly the same end state as the first.
  const again = runMission({ seed: 4242, killChance: 0.95, maxSteps: 3000 });
  assert.equal(again.digest, finished.digest);
  assert.deepEqual({ ...again.mission }, { ...finished.mission });
});

test('long sequences never modify inputs or the shared default config', () => {
  const missionBefore = JSON.stringify(FROZEN_MISSION_CONFIG);
  const weaponBefore = JSON.stringify(FROZEN_WEAPON_CONFIG);
  const wavesBefore = [...MISSION_CONFIG.waves];
  const sharedBefore = JSON.stringify(WEAPON_CONFIG);

  let mission = createMission(FROZEN_MISSION_CONFIG);
  let weapon = createWeapon();
  const random = makeRandom(31337);
  let observedSpawns = 0;

  for (let index = 0; index < MAX_STEPS && mission.phase !== 'won' && mission.phase !== 'lost'; index += 1) {
    const weaponStep = advanceWeapon(weapon, FIXED_STEP, random() < 0.9, FROZEN_WEAPON_CONFIG);
    weapon = weaponStep.state;
    const destroyed =
      mission.phase === 'combat' && mission.activeEnemyIds.length > 0 && random() < 0.7
        ? [mission.activeEnemyIds[0]]
        : [];
    const input = freezeInput(true, true, destroyed);
    const step = advanceMission(mission, FIXED_STEP, input, FROZEN_MISSION_CONFIG);
    mission = step.state;
    for (const event of step.events) {
      if (event.type === 'spawn-wave') {
        observedSpawns += 1;
        assert.ok(Object.isFrozen(event.enemyIds), 'spawn event arrays are frozen against callers');
      }
    }
    assert.deepEqual(input.destroyedEnemyIds, destroyed, 'the input array is unchanged after the call');
    assert.equal(input.playerAlive, true);
  }

  assert.equal(JSON.stringify(FROZEN_MISSION_CONFIG), missionBefore, 'mission config was rewritten');
  assert.equal(JSON.stringify(FROZEN_WEAPON_CONFIG), weaponBefore, 'weapon config was rewritten');
  assert.deepEqual([...MISSION_CONFIG.waves], wavesBefore);
  assert.equal(JSON.stringify(WEAPON_CONFIG), sharedBefore, 'shared WEAPON_CONFIG was rewritten');
  assert.equal(MISSION_CONFIG.maxActiveEnemies, MAX_ACTIVE_ENEMIES);
  assert.ok(observedSpawns <= TOTAL_WAVES);
});

test('the recorded seed-1 digest matches the current implementation', () => {
  // Recorded from the implementation reviewed in docs/reports/dsh-20261015-D04.md.
  // If a DSH module changes how a seeded run plays out, this must fail and the new
  // digest has to be justified in the report instead of silently re-recorded.
  const RECORDED_SEED_1 = 'e67c7fa0';
  const run = runMission({ seed: 1 });
  const digest = run.digest;
  assert.match(digest, /^[0-9a-f]{8}$/, 'the digest must be an 8-hex-digit string');
  assert.equal(digest, RECORDED_SEED_1, `seed 1 digest is ${digest}; update the report if this change is intended`);
  assert.equal(runMission({ seed: 1 }).digest, digest, 'the digest must repeat within the same process');
});
