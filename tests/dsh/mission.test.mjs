/**
 * D01 behaviour tests — wave/outcome state machine.
 * Run: node --test tests/dsh/mission.test.mjs
 *
 * These assert observable behaviour from docs/CONTRACTS.md. Enemy IDs only ever
 * enter a test through a returned state/event, so the ID scheme is exercised via
 * the real module rather than partly re-derived here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission, advanceMission } from '../../src/sim/mission.ts';
import { MISSION_CONFIG } from '../../src/shared/config.ts';

const STEP = 0.1;

const BOTH_ALIVE = Object.freeze({ playerAlive: true, carrierAlive: true, destroyedEnemyIds: Object.freeze([]) });

const CONFIG = Object.freeze({
  waves: Object.freeze([3, 4, 4]),
  briefingSeconds: 3,
  intermissionSeconds: 8,
  maxActiveEnemies: 4,
});

/** Small config used to exercise many waves inside a bounded number of steps. */
const FAST_CONFIG = Object.freeze({
  waves: Object.freeze([1, 1, 1]),
  briefingSeconds: 0.5,
  intermissionSeconds: 0.5,
  maxActiveEnemies: 4,
});

function input(alive = {}, destroyed = []) {
  return { playerAlive: true, carrierAlive: true, ...alive, destroyedEnemyIds: destroyed };
}

/** Accumulates mission events so tests can assert "exactly once", not just "at least once". */
function makeRunner(config = CONFIG) {
  let state = createMission(config);
  const log = [];
  const timeline = [];
  const push = (step, dt) => {
    for (const event of step.events) log.push(event);
    timeline.push(step.state);
    state = step.state;
    if (typeof dt === 'number') elapsed += dt;
    return step;
  };
  let elapsed = 0;
  return {
    get state() {
      return state;
    },
    get elapsed() {
      return elapsed;
    },
    events: log,
    timeline,
    step(dt, missionInput = BOTH_ALIVE) {
      return push(advanceMission(state, dt, missionInput, config), dt);
    },
    /** Takes exactly `count` fixed steps. */
    steps(count, missionInput = BOTH_ALIVE) {
      for (let index = 0; index < count; index += 1) this.step(STEP, missionInput);
      return state;
    },
    /** Advances by fixed STEP until `predicate(state)` holds; returns false on timeout. */
    advanceUntil(predicate, steps = 6000, missionInput = BOTH_ALIVE) {
      for (let index = 0; index < steps; index += 1) {
        if (predicate(state)) return true;
        this.step(STEP, missionInput);
      }
      return predicate(state);
    },
  };
}

function spawnedWaves(events) {
  return events.filter((event) => event.type === 'spawn-wave');
}

/** Drives a runner to the start of wave 1 (or wave `n`). */
function runnerInCombat(n = 1, config = CONFIG) {
  const runner = makeRunner(config);
  assert.ok(runner.advanceUntil((state) => state.phase === 'combat' && state.waveIndex === n - 1), `wave ${n} did not start`);
  return runner;
}

test('createMission starts a clean briefing for the frozen MVP config', () => {
  const state = createMission(MISSION_CONFIG);
  assert.equal(state.phase, 'briefing');
  assert.equal(state.waveIndex, -1);
  assert.deepEqual(state.activeEnemyIds, []);
  assert.equal(state.elapsedSeconds, 0);
  assert.equal(state.phaseSeconds, 0);
  assert.equal(state.kills, 0);
  assert.equal(state.lossReason, null);
});

test('briefing spawns the first wave exactly once, at the scheduled time', () => {
  const runner = makeRunner();
  runner.steps(Math.ceil(CONFIG.briefingSeconds / STEP) - 1);
  assert.equal(runner.state.phase, 'briefing', 'the briefing must not spawn early');
  assert.equal(runner.state.phaseSeconds < CONFIG.briefingSeconds, true);
  assert.equal(spawnedWaves(runner.events).length, 0);

  runner.step(STEP);
  assert.equal(runner.state.phase, 'combat');
  assert.equal(runner.state.waveIndex, 0);
  assert.equal(runner.state.activeEnemyIds.length, CONFIG.waves[0]);
  assert.equal(runner.state.phaseSeconds, 0, 'phase timer restarts with the wave');
  assert.ok(runner.state.elapsedSeconds >= CONFIG.briefingSeconds);

  const spawns = spawnedWaves(runner.events);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].waveIndex, 0);
  assert.deepEqual(spawns[0].enemyIds, runner.state.activeEnemyIds);

  // Continuing to fight must not re-spawn wave 1.
  runner.step(STEP);
  runner.step(STEP);
  assert.equal(spawnedWaves(runner.events).length, 1);
});

test('enemy IDs are unique, one-based and stable across the step that reports them', () => {
  const runner = runnerInCombat(1);
  const ids = runner.state.activeEnemyIds;
  assert.equal(new Set(ids).size, ids.length, 'active IDs must be unique');
  assert.deepEqual(
    [...ids].sort(),
    [...ids],
    'IDs must stay in spawn order',
  );
  for (const id of ids) assert.match(id, /^wave-1-enemy-[1-9]\d*$/);
});

test('partial kills keep the wave alive and only count listed, active IDs', () => {
  const runner = runnerInCombat(1);
  const [first, second] = runner.state.activeEnemyIds;

  runner.step(STEP, input({}, [first]));
  assert.equal(runner.state.phase, 'combat');
  assert.equal(runner.state.kills, 1);
  assert.deepEqual(runner.state.activeEnemyIds, [second, ...runner.state.activeEnemyIds.slice(1)]);

  // Duplicate and unknown IDs must not inflate the kill count.
  runner.step(STEP, input({}, [first, first, 'wave-1-enemy-99', 'not-an-enemy', 'wave-9-enemy-1', '']));
  assert.equal(runner.state.kills, 1);
  assert.equal(runner.state.activeEnemyIds.length, 2);

  runner.step(STEP, input({}, [second]));
  assert.equal(runner.state.kills, 2);
  assert.equal(runner.state.activeEnemyIds.length, 1);
  assert.equal(runner.state.phase, 'combat', 'one enemy left is not a cleared wave');
});

test('IDs from an earlier wave cannot kill the current wave', () => {
  const runner = runnerInCombat(1);
  const staleId = runner.state.activeEnemyIds[0];
  runner.step(STEP, input({}, [...runner.state.activeEnemyIds]));
  assert.equal(runner.state.phase, 'intermission');
  assert.ok(runner.advanceUntil((state) => state.phase === 'combat' && state.waveIndex === 1));

  const killsBefore = runner.state.kills;
  runner.step(STEP, input({}, [staleId]));
  assert.equal(runner.state.kills, killsBefore, 'a stale-wave ID must be ignored');
  assert.equal(runner.state.activeEnemyIds.length, CONFIG.waves[1]);

  // A stale ID must not combine with one live ID to fake a cleared wave either.
  runner.step(STEP, input({}, [staleId, runner.state.activeEnemyIds[0]]));
  assert.equal(runner.state.kills, killsBefore + 1);
  assert.equal(runner.state.activeEnemyIds.length, CONFIG.waves[1] - 1);
  assert.equal(runner.state.phase, 'combat');
});

test('the intermission waits the full configured delay and spawns only then', () => {
  const runner = runnerInCombat(1);
  runner.step(STEP, input({}, [...runner.state.activeEnemyIds]));
  assert.equal(runner.state.phase, 'intermission');
  assert.equal(runner.state.phaseSeconds, 0, 'intermission starts its own timer');
  const intermissionStart = runner.state.elapsedSeconds;

  assert.ok(
    runner.advanceUntil((state) => state.phaseSeconds >= CONFIG.intermissionSeconds - 1e-9 && state.phase === 'intermission'),
  );
  assert.equal(spawnedWaves(runner.events).length, 1, 'no early wave');
  assert.ok(runner.state.elapsedSeconds >= intermissionStart + CONFIG.intermissionSeconds - 1e-6);

  runner.step(STEP);
  const spawns = spawnedWaves(runner.events);
  assert.equal(spawns.length, 2);
  assert.equal(spawns[1].waveIndex, 1);
  assert.equal(runner.state.waveIndex, 1);
  assert.equal(runner.state.activeEnemyIds.length, CONFIG.waves[1]);
  assert.equal(runner.state.phaseSeconds, 0);
});

test('clearing the third wave wins exactly once with the final kills recorded', () => {
  const runner = makeRunner(FAST_CONFIG);
  for (let wave = 0; wave < FAST_CONFIG.waves.length; wave += 1) {
    assert.ok(runner.advanceUntil((state) => state.phase === 'combat'), `wave ${wave + 1} never started`);
    runner.step(STEP, input({}, [...runner.state.activeEnemyIds]));
    if (wave < FAST_CONFIG.waves.length - 1) {
      assert.equal(runner.state.phase, 'intermission');
    }
  }

  assert.equal(runner.state.phase, 'won');
  assert.equal(runner.state.waveIndex, FAST_CONFIG.waves.length - 1);
  assert.deepEqual(runner.state.activeEnemyIds, []);
  assert.equal(runner.state.lossReason, null);
  assert.equal(runner.state.kills, FAST_CONFIG.waves.reduce((sum, count) => sum + count, 0));
  assert.equal(runner.events.filter((event) => event.type === 'mission-won').length, 1);
  assert.equal(runner.events.filter((event) => event.type === 'mission-lost').length, 0);

  const wonState = runner.state;
  runner.step(STEP, input({}, ['wave-1-enemy-1']));
  assert.equal(runner.state, wonState, 'won is terminal and returns the same state object');
  assert.equal(spawnedWaves(runner.events).length, FAST_CONFIG.waves.length);
});

test('player death loses the mission immediately, without spawning or counting', () => {
  const runner = makeRunner();
  runner.step(STEP, input({ playerAlive: false }));
  assert.equal(runner.state.phase, 'lost');
  assert.equal(runner.state.lossReason, 'player-destroyed');
  assert.equal(runner.state.kills, 0);
  assert.equal(runner.state.waveIndex, -1, 'a lost briefing must not spawn');
  assert.deepEqual(runner.state.activeEnemyIds, []);
  assert.equal(runner.state.elapsedSeconds, 0, 'a failed step does not accumulate time');

  const losses = runner.events.filter((event) => event.type === 'mission-lost');
  assert.equal(losses.length, 1);
  assert.equal(losses[0].reason, 'player-destroyed');
});

test('carrier death loses the mission even while the player fights on', () => {
  const runner = runnerInCombat(1);
  const killsBefore = runner.state.kills;
  runner.step(STEP, input({ carrierAlive: false }, [runner.state.activeEnemyIds[0]]));
  assert.equal(runner.state.phase, 'lost');
  assert.equal(runner.state.lossReason, 'carrier-destroyed');
  assert.equal(runner.state.kills, killsBefore, 'a losing step counts no kills');
});

test('the same step that clears a wave and kills the carrier is a loss, not a win', () => {
  const runner = makeRunner(FAST_CONFIG);
  assert.ok(runner.advanceUntil((state) => state.phase === 'combat'));
  runner.step(STEP, input({ carrierAlive: false }, [...runner.state.activeEnemyIds]));
  assert.equal(runner.state.phase, 'lost');
  assert.equal(runner.state.lossReason, 'carrier-destroyed');

  const lastWaveIndex = FAST_CONFIG.waves.length - 1;
  const winner = makeRunner(FAST_CONFIG);
  for (let wave = 0; wave < lastWaveIndex; wave += 1) {
    assert.ok(winner.advanceUntil((state) => state.phase === 'combat'));
    winner.step(STEP, input({}, [...winner.state.activeEnemyIds]));
  }
  assert.ok(winner.advanceUntil((state) => state.phase === 'combat'));
  winner.step(STEP, input({ playerAlive: false, carrierAlive: false }, [...winner.state.activeEnemyIds]));
  assert.equal(winner.state.phase, 'lost');
  assert.equal(winner.state.lossReason, 'player-destroyed', 'player destruction wins the same-frame tie');
  assert.equal(winner.events.filter((event) => event.type === 'mission-won').length, 0);
});

test('a lost mission is terminal and idempotent, including dt=0', () => {
  const runner = runnerInCombat(1);
  runner.step(STEP, input({ playerAlive: false }));
  const lostState = runner.state;

  const zero = advanceMission(lostState, 0, input(), CONFIG);
  assert.equal(zero.state, lostState);
  assert.deepEqual(zero.events, []);

  const again = runner.step(STEP, input({ playerAlive: true, carrierAlive: true }, [...lostState.activeEnemyIds]));
  assert.equal(again.state, lostState, 'a dead player cannot be revived by a later input');
  assert.deepEqual(again.events, []);
  assert.equal(runner.events.filter((event) => event.type === 'mission-lost').length, 1);
});

test('dt=0 processes damage without adding time, and zero-second phases start at dt=0', () => {
  const instant = Object.freeze({
    waves: Object.freeze([2]),
    briefingSeconds: 0,
    intermissionSeconds: 0,
    maxActiveEnemies: 2,
  });
  const runner = makeRunner(instant);
  const step = runner.step(0);
  assert.equal(step.state.phase, 'combat', 'a zero-second briefing may start at dt=0');
  assert.equal(step.state.elapsedSeconds, 0);
  assert.equal(step.state.phaseSeconds, 0);
  assert.deepEqual(spawnedWaves(step.events).map((event) => event.waveIndex), [0]);

  const killed = runner.step(0, input({}, [...step.state.activeEnemyIds]));
  assert.equal(killed.state.kills, 2);
  assert.equal(killed.state.phase, 'won', 'the last wave wins at dt=0');
  assert.equal(killed.state.elapsedSeconds, 0);

  const mid = runnerInCombat(1);
  const before = mid.state.elapsedSeconds;
  const sampled = mid.step(0);
  assert.equal(sampled.state.elapsedSeconds, before);
  assert.equal(sampled.state.phaseSeconds, mid.state.phaseSeconds);
  assert.equal(sampled.state.phase, 'combat');
});

test('events are not repeated and are not shared between steps', () => {
  const instant = Object.freeze({
    waves: Object.freeze([1, 1]),
    briefingSeconds: 0,
    intermissionSeconds: 0,
    maxActiveEnemies: 1,
  });
  let state = createMission(instant);
  const first = advanceMission(state, 0, BOTH_ALIVE, instant);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, 'spawn-wave');
  assert.ok(Object.isFrozen(first.events[0]));

  const second = advanceMission(first.state, STEP, BOTH_ALIVE, instant);
  assert.deepEqual(second.events, [], 'an idle step reports no events');

  const third = advanceMission(second.state, STEP, input({}, [...second.state.activeEnemyIds]), instant);
  assert.deepEqual(third.events, [], 'clearing a non-final wave emits nothing');
  assert.equal(third.state.phase, 'intermission');

  const fourth = advanceMission(third.state, STEP, BOTH_ALIVE, instant);
  assert.equal(fourth.state.phase, 'combat');
  assert.deepEqual(
    fourth.events.map((event) => event.type),
    ['spawn-wave'],
  );

  const fifth = advanceMission(fourth.state, STEP, input({}, [...fourth.state.activeEnemyIds]), instant);
  assert.deepEqual(
    fifth.events.map((event) => event.type),
    ['mission-won'],
  );
  state = fifth.state;
  assert.equal(state.phase, 'won');
});

test('briefing and intermission use the same leftover-time policy', () => {
  const single = Object.freeze({
    waves: Object.freeze([1]),
    briefingSeconds: 0.25,
    intermissionSeconds: 0.25,
    maxActiveEnemies: 1,
  });
  const runner = makeRunner(single);
  assert.equal(runner.step(0.1).state.phaseSeconds, 0.1);
  runner.step(0.1);
  assert.equal(runner.state.phase, 'briefing', '0.2s is still short of the 0.25s briefing');
  assert.equal(runner.state.phaseSeconds, 0.2);

  const spawnStep = runner.step(0.1);
  assert.equal(spawnStep.state.phase, 'combat', '0.3 >= 0.25 spawns here');
  assert.equal(spawnStep.state.phaseSeconds, 0, 'the leftover 0.05s is dropped, not carried over');

  // The same policy on an intermission: the excess is dropped, not banked.
  const two = Object.freeze({
    waves: Object.freeze([1, 1]),
    briefingSeconds: 0,
    intermissionSeconds: 0.25,
    maxActiveEnemies: 1,
  });
  const second = makeRunner(two);
  assert.ok(second.advanceUntil((state) => state.phase === 'combat'));
  second.step(0.1, input({}, [...second.state.activeEnemyIds]));
  assert.equal(second.state.phase, 'intermission');

  second.step(0.1);
  assert.equal(second.state.phaseSeconds, 0.1);
  second.step(0.1);
  assert.equal(second.state.phase, 'intermission');
  assert.equal(second.state.phaseSeconds, 0.2);
  const late = second.step(0.1);
  assert.equal(late.state.phase, 'combat');
  assert.equal(late.state.phaseSeconds, 0, 'leftover intermission time is discarded');
  assert.equal(late.state.activeEnemyIds.length, 1);
  assert.equal(spawnedWaves(second.events).length, 2);
});

test('every spawn respects the wave table and the active-enemy cap', () => {
  const runner = makeRunner();
  const counts = [];
  for (let index = 0; index < 4000 && runner.state.phase !== 'won'; index += 1) {
    const before = runner.state;
    runner.step(STEP, before.phase === 'combat' ? input({}, [...before.activeEnemyIds]) : BOTH_ALIVE);
    assert.ok(
      runner.state.activeEnemyIds.length <= CONFIG.maxActiveEnemies,
      `active enemies ${runner.state.activeEnemyIds.length} exceeded the cap`,
    );
    for (const state of runner.timeline) {
      if (state.phase === 'combat') counts.push(state.activeEnemyIds.length);
    }
    runner.timeline.length = 0;
  }
  assert.equal(runner.state.phase, 'won');
  assert.equal(spawnedWaves(runner.events).length, CONFIG.waves.length);
  assert.equal(runner.state.kills, 11);
  for (const [index, spawn] of spawnedWaves(runner.events).entries()) {
    assert.equal(spawn.enemyIds.length, CONFIG.waves[index]);
    assert.ok(spawn.enemyIds.length <= CONFIG.maxActiveEnemies);
  }
  assert.ok(Math.max(...counts) <= CONFIG.maxActiveEnemies);
});

test('createMission rejects illegal configs', () => {
  const base = { waves: [3, 4, 4], briefingSeconds: 3, intermissionSeconds: 8, maxActiveEnemies: 4 };
  const illegal = [
    { ...base, waves: [] },
    { ...base, waves: 'three' },
    { ...base, waves: [0] },
    { ...base, waves: [-1] },
    { ...base, waves: [5] },
    { ...base, waves: [2.5] },
    { ...base, waves: [Number.NaN] },
    { ...base, waves: [Infinity] },
    { ...base, waves: [3, '4'] },
    { ...base, maxActiveEnemies: 0 },
    { ...base, maxActiveEnemies: -3 },
    { ...base, maxActiveEnemies: 2.5 },
    { ...base, maxActiveEnemies: Number.NaN },
    { ...base, briefingSeconds: -1 },
    { ...base, briefingSeconds: Number.NaN },
    { ...base, intermissionSeconds: Infinity },
    { ...base, intermissionSeconds: -0.001 },
  ];
  for (const config of illegal) {
    assert.throws(() => createMission(config), RangeError, `expected a RangeError for ${JSON.stringify(config.waves)}`);
    assert.throws(() => advanceMission(createMission(base), STEP, BOTH_ALIVE, config), RangeError);
  }
  assert.throws(() => createMission(undefined), RangeError);
  assert.throws(() => createMission(null), RangeError);
});

test('advanceMission rejects illegal dt before touching state', () => {
  const state = createMission(CONFIG);
  for (const dt of [-0.001, -1, Number.NaN, Infinity, -Infinity, 0.1000001, 1, 0.5, '0.1', undefined]) {
    assert.throws(() => advanceMission(state, dt, BOTH_ALIVE, CONFIG), RangeError, `dt=${String(dt)} must be rejected`);
  }
  assert.equal(state.elapsedSeconds, 0, 'a rejected step must not mutate state');
  assert.doesNotThrow(() => advanceMission(state, 0, BOTH_ALIVE, CONFIG));
  assert.doesNotThrow(() => advanceMission(state, 0.1, BOTH_ALIVE, CONFIG));
});

test('frozen config and inputs are never modified', () => {
  const config = Object.freeze({
    waves: Object.freeze([3, 4, 4]),
    briefingSeconds: 3,
    intermissionSeconds: 8,
    maxActiveEnemies: 4,
  });
  const destroyed = Object.freeze(['wave-1-enemy-1', 'wave-1-enemy-1']);
  const frozenInput = Object.freeze({
    playerAlive: true,
    carrierAlive: true,
    destroyedEnemyIds: destroyed,
  });

  let state = createMission(config);
  for (let step = 0; step < 60; step += 1) {
    state = advanceMission(state, STEP, frozenInput, config).state;
  }
  assert.equal(state.phase, 'combat');
  assert.deepEqual(config.waves, [3, 4, 4]);
  assert.equal(config.briefingSeconds, 3);
  assert.equal(config.intermissionSeconds, 8);
  assert.equal(config.maxActiveEnemies, 4);
  assert.deepEqual([...destroyed], ['wave-1-enemy-1', 'wave-1-enemy-1']);
  assert.equal(frozenInput.destroyedEnemyIds, destroyed);

  // readonly is a caller-side contract, not a runtime freeze (Codex review decision 1):
  // the returned array is a distinct object and never reuses the caller's array.
  assert.equal(Object.isFrozen(advanceMission(state, 0, BOTH_ALIVE, config).state.activeEnemyIds), false);
  assert.notEqual(state.activeEnemyIds, destroyed);
});

test('wave 1 reports killable IDs even if destruction arrives in the spawn step', () => {
  const instant = Object.freeze({
    waves: Object.freeze([2]),
    briefingSeconds: 0,
    intermissionSeconds: 0,
    maxActiveEnemies: 2,
  });
  const state = createMission(instant);
  const step = advanceMission(state, 0, input({}, ['wave-1-enemy-1']), instant);
  assert.equal(step.state.phase, 'combat');
  assert.equal(step.state.kills, 0, 'IDs destroyed before they exist must not count');
  assert.equal(step.state.activeEnemyIds.length, 2);

  const next = advanceMission(step.state, STEP, input({}, ['wave-1-enemy-1']), instant);
  assert.equal(next.state.kills, 1);
  assert.equal(next.state.activeEnemyIds.length, 1);
});

test('two missions started from the same config never share state', () => {
  const first = runnerInCombat(1);
  const second = createMission(CONFIG);
  assert.notEqual(first.state, second);
  assert.deepEqual(second.activeEnemyIds, []);
  assert.equal(second.waveIndex, -1);

  first.step(STEP, input({}, [...first.state.activeEnemyIds]));
  assert.equal(second.phaseSeconds, 0);
  assert.equal(second.kills, 0);
  assert.deepEqual(second.activeEnemyIds, []);

  // A stale ID from one mission must not resolve inside the other.
  const other = runnerInCombat(1);
  const strayId = first.state.activeEnemyIds[0] ?? 'wave-1-enemy-1';
  other.step(STEP, input({}, [`${strayId}-clone`]));
  assert.equal(other.state.kills, 0);
  assert.equal(other.state.activeEnemyIds.length, CONFIG.waves[0]);
});
