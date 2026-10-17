/**
 * D12 behaviour tests — relay mission ("断链行动") pure state machine.
 * Run: node --test tests/dsh/relay-mission.test.mjs
 *
 * Contract sources, in priority order:
 *   1. docs/tasks/DSH_RELAY.md (frozen D12 rules)
 *   2. src/shared/relay-contract.ts (types + RELAY_CONFIG)
 * The implementation (src/sim/relay-mission.ts) is owned by Codex and is not
 * modified here: these tests only observe it.
 *
 * No geometry, flight, UI, audio or GPU behaviour is covered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayMission, advanceRelayMission } from '../../src/sim/relay-mission.ts';
import { RELAY_CONFIG } from '../../src/shared/relay-contract.ts';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 100000;
const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = resolve(HERE, '..', '..', 'src', 'sim', 'relay-mission.ts');

/** Complete input; every field explicit so a dropped field fails loudly. */
function input(overrides = {}) {
  return {
    playerAlive: true,
    patrolCleared: false,
    inStationRange: false,
    commsDestroyed: false,
    fireControlDestroyed: false,
    reactorDestroyed: false,
    atExtraction: false,
    activeEnemies: 0,
    ...overrides,
  };
}

const FACILITIES_OPEN = { patrolCleared: true, inStationRange: true };
const BOTH_FACILITIES = { commsDestroyed: true, fireControlDestroyed: true };

function step(state, dt, overrides) {
  return advanceRelayMission(state, dt, input(overrides));
}

/** Drives a fresh mission into facilities. */
function inFacilities() {
  const entered = advanceRelayMission(createRelayMission(), 0, input(FACILITIES_OPEN));
  assert.equal(entered.state.phase, 'facilities', 'helper precondition');
  return entered.state;
}

/** Drives a fresh mission into reactor. */
function inReactor() {
  const facilities = inFacilities();
  const entered = step(facilities, FIXED_STEP, BOTH_FACILITIES);
  assert.equal(entered.state.phase, 'reactor', 'helper precondition');
  return entered.state;
}

/** Drives a fresh mission into escape with the given surviving enemy count. */
function inEscape(activeEnemies = 0) {
  const reactor = inReactor();
  const entered = step(reactor, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies });
  assert.equal(entered.state.phase, 'escape', 'helper precondition');
  return { state: entered.state, events: entered.events };
}

/** Steps `count` times, collecting every event with the resulting phase time. */
function run(state, count, overrides, dt = FIXED_STEP) {
  let current = state;
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const result = advanceRelayMission(current, dt, input(overrides));
    current = result.state;
    for (const event of result.events) events.push({ event, phaseTime: current.phaseTime, phase: current.phase });
    if (current.phase === 'won' || current.phase === 'lost') break;
  }
  return { state: current, events };
}

function eventTypes(events) {
  return events.map((entry) => entry.event.type);
}

function onlyOneOf(events, type) {
  return events.filter((entry) => entry.event.type === type);
}

test('a new mission starts in approach with every counter zeroed', () => {
  const state = createRelayMission();
  assert.equal(state.phase, 'approach');
  assert.equal(state.elapsed, 0);
  assert.equal(state.phaseTime, 0);
  assert.equal(state.reinforcementTime, 0);
  assert.equal(state.rescueCalled, false);
  assert.equal(state.lossReason, null);
  assert.deepEqual(
    Object.keys(state).sort(),
    ['elapsed', 'lossReason', 'phase', 'phaseTime', 'reinforcementTime', 'rescueCalled'].sort(),
  );
  // Two fresh missions must not share an object.
  assert.notEqual(createRelayMission(), state);
});

test('the frozen config still carries the numbers the contract states', () => {
  assert.equal(RELAY_CONFIG.maxEnemies, 8, 'enemy cap 8');
  assert.equal(RELAY_CONFIG.reinforcementSeconds, 24, 'reinforcement every 24s');
  assert.equal(RELAY_CONFIG.escapeSeconds, 60, 'escape window 60s');
  assert.equal(RELAY_CONFIG.rescueDelay, 8, 'rescue arrival at 8s');
  assert.equal(RELAY_CONFIG.rescueArrivalSeconds, 4, 'rescue needs a 4s fly-in, so win at 12s');
  // The numbers the tests below rely on, stated once.
  assert.equal(RELAY_CONFIG.rescueDelay + RELAY_CONFIG.rescueArrivalSeconds, 12);
  assert.ok(Object.isFrozen(RELAY_CONFIG));
});

test('approach only leaves for facilities when the patrol is clear and the player is in range', () => {
  for (const overrides of [
    {},
    { patrolCleared: true },
    { inStationRange: true },
  ]) {
    const result = step(createRelayMission(), FIXED_STEP, overrides);
    assert.equal(result.state.phase, 'approach', `${JSON.stringify(overrides)} must stay in approach`);
    assert.deepEqual(result.events, [], 'no event before the checkpoint');
  }

  const entered = step(createRelayMission(), FIXED_STEP, FACILITIES_OPEN);
  assert.equal(entered.state.phase, 'facilities');
  assert.deepEqual(entered.events, [{ type: 'checkpoint', point: 'facilities' }]);
});

test('the facilities checkpoint is reported exactly once', () => {
  const first = step(createRelayMission(), FIXED_STEP, FACILITIES_OPEN);
  const ran = run(first.state, 200, {});
  const checkpoints = onlyOneOf([{ event: first.events[0] }, ...ran.events], 'checkpoint');
  assert.equal(checkpoints.length, 1, 'the facilities checkpoint must not repeat');
  assert.equal(checkpoints[0].event.point, 'facilities');
});

test('either facility alone never exposes the reactor', () => {
  const facilities = inFacilities();
  for (const partial of [{ commsDestroyed: true }, { fireControlDestroyed: true }]) {
    const ran = run(facilities, 120, partial);
    assert.equal(ran.state.phase, 'facilities', `${JSON.stringify(partial)} alone must not advance`);
    assert.equal(eventTypes(ran.events).includes('reactor-exposed'), false);
  }
});

test('destroying both facilities exposes the reactor once and reports both events', () => {
  const facilities = inFacilities();
  const result = step(facilities, FIXED_STEP, BOTH_FACILITIES);
  assert.equal(result.state.phase, 'reactor');
  assert.deepEqual(result.events, [{ type: 'reactor-exposed' }, { type: 'checkpoint', point: 'reactor' }]);
  assert.equal(result.state.phaseTime, 0, 'the new phase starts its own timer');
});

test('both facilities plus the reactor in one step stops at reactor, never crossing into escape', () => {
  const facilities = inFacilities();
  const result = step(facilities, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true });
  assert.equal(result.state.phase, 'reactor', 'only one phase transition per step');
  assert.deepEqual(result.events, [{ type: 'reactor-exposed' }, { type: 'checkpoint', point: 'reactor' }]);
  assert.equal(
    result.events.some((event) => event.type === 'escape-started'),
    false,
    'escape must require a later step',
  );
  // The very next step may then leave for escape.
  const next = step(result.state, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true });
  assert.equal(next.state.phase, 'escape');
});

test('reinforcements arrive at 24 seconds, at most two at a time', () => {
  const facilities = inFacilities();
  // 23.9s of reinforcement time, then a 0.1s step that reaches the boundary.
  const warm = run(facilities, 239, { activeEnemies: 2 }, 0.1).state;
  assert.ok(warm.reinforcementTime < RELAY_CONFIG.reinforcementSeconds);

  const boundary = step(warm, 0.1, { activeEnemies: 2 });
  const spawns = boundary.events.filter((event) => event.type === 'spawn');
  assert.equal(spawns.length, 1, 'one reinforcement batch per boundary');
  assert.deepEqual(spawns[0], { type: 'spawn', count: 2, purpose: 'reinforcement' });
  assert.equal(boundary.state.reinforcementTime, 0, 'the batch timer restarts');
  assert.equal(boundary.state.phase, 'facilities');
});

test('a single step never back-fills more than one reinforcement batch', () => {
  const facilities = inFacilities();
  const warm = run(facilities, 239, { activeEnemies: 0 }, 0.1).state;
  // The maximum allowed dt cannot span two 24s intervals, so one call can only
  // ever produce one batch; assert that directly.
  const boundary = step(warm, 0.1, { activeEnemies: 0 });
  assert.equal(boundary.events.filter((event) => event.type === 'spawn').length, 1);
  assert.equal(boundary.state.reinforcementTime, 0);
});

test('reinforcement never pushes the field past the 8 enemy cap', () => {
  const facilities = inFacilities();
  const warm = run(facilities, 239, { activeEnemies: 7 }, 0.1).state;
  const spawn = step(warm, 0.1, { activeEnemies: 7 }).events.find((event) => event.type === 'spawn');
  assert.deepEqual(spawn, { type: 'spawn', count: 1, purpose: 'reinforcement' }, 'only the free slot is filled');

  const full = run(facilities, 239, { activeEnemies: REMAX() }, 0.1).state;
  const none = step(full, 0.1, { activeEnemies: REMAX() });
  assert.equal(none.events.length, 0, 'a full field gets no spawn event');
  assert.equal(none.state.reinforcementTime, 0, 'but the timer still restarts');
});

/** The cap, read from config so a config change is caught by the config test above. */
function REMAX() {
  return RELAY_CONFIG.maxEnemies;
}

test('destroying comms stops the reinforcement clock without losing the elapsed time', () => {
  const facilities = inFacilities();
  const ticking = run(facilities, 100, { activeEnemies: 2 }, 0.1).state;
  const frozenAt = ticking.reinforcementTime;
  assert.ok(frozenAt > 0);

  const afterComms = run(ticking, 100, { activeEnemies: 2, commsDestroyed: true }, 0.1).state;
  assert.equal(afterComms.reinforcementTime, frozenAt, 'the clock is frozen while comms are down');

  // No reinforcement may fire while frozen, even long past the boundary.
  const long = run(afterComms, 300, { activeEnemies: 2, commsDestroyed: true }, 0.1);
  assert.equal(eventTypes(long.events).includes('spawn'), false, 'no reinforcements while comms are down');
  assert.equal(long.state.phase, 'facilities');
  assert.equal(long.state.reinforcementTime, frozenAt);
});

test('the reinforcement clock resumes from its frozen value when comms return', () => {
  const facilities = inFacilities();
  const ticking = run(facilities, 100, { activeEnemies: 2 }, 0.1).state;
  const frozenAt = ticking.reinforcementTime;
  const frozen = run(ticking, 30, { activeEnemies: 2, commsDestroyed: true }, 0.1).state;
  assert.equal(frozen.reinforcementTime, frozenAt);

  const resumed = step(frozen, 0.1, { activeEnemies: 2 });
  assert.ok(
    Math.abs(resumed.state.reinforcementTime - (frozenAt + 0.1)) < 1e-9,
    `clock should continue from ${frozenAt}, got ${resumed.state.reinforcementTime}`,
  );
});

test('destroying comms while the timer is past due emits nothing on that step', () => {
  const facilities = inFacilities();
  const warm = run(facilities, 239, { activeEnemies: 2 }, 0.1).state;
  // Cross the boundary on a step where comms is already gone: the clock is frozen,
  // so the batch must not fire.
  const result = step(warm, 0.1, { activeEnemies: 2, commsDestroyed: true });
  assert.deepEqual(result.events, []);
  assert.ok(result.state.reinforcementTime < RELAY_CONFIG.reinforcementSeconds);
});

test('destroying the reactor starts escape with a zeroed timer and a pursuit spawn', () => {
  const reactor = inReactor();
  const result = step(reactor, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: 0 });
  assert.equal(result.state.phase, 'escape');
  assert.equal(result.state.phaseTime, 0, 'escape starts its own timer');
  assert.deepEqual(result.events, [
    { type: 'escape-started' },
    { type: 'spawn', count: 4, purpose: 'pursuit' },
  ]);
});

test('pursuers top the field up to four and never exceed the cap', () => {
  const cases = [
    [0, 4],
    [1, 3],
    [3, 1],
    [4, 0],
    [5, 0],
    [REMAX(), 0],
  ];
  for (const [active, expected] of cases) {
    const reactor = inReactor();
    const result = step(reactor, FIXED_STEP, {
      ...BOTH_FACILITIES,
      reactorDestroyed: true,
      activeEnemies: active,
    });
    const spawn = result.events.find((event) => event.type === 'spawn');
    if (expected === 0) {
      assert.equal(spawn, undefined, `active=${active} must not spawn`);
    } else {
      assert.deepEqual(spawn, { type: 'spawn', count: expected, purpose: 'pursuit' }, `active=${active}`);
      assert.ok(active + expected <= RELAY_CONFIG.maxEnemies);
    }
  }
});

test('escape does not tick on the entry step and the rescue arrives at 8 seconds', () => {
  const entered = inEscape(REMAX());
  assert.equal(entered.state.phaseTime, 0, 'entry step leaves the timer at zero');

  const oneStep = step(entered.state, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  assert.equal(oneStep.state.phaseTime, FIXED_STEP, 'timing starts on the step after entry');
  assert.deepEqual(oneStep.events, []);

  // 8 seconds of phase time, one step at a time.
  const ran = run(entered.state, 480, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  const arrivals = onlyOneOf(ran.events, 'rescue-arrival');
  assert.equal(arrivals.length, 1, 'the rescue arrival fires exactly once');
  assert.equal(ran.state.rescueCalled, true);
  assert.ok(
    Math.abs(arrivals[0].phaseTime - RELAY_CONFIG.rescueDelay) < 1e-6,
    `arrival at ${arrivals[0].phaseTime}s should be the 8s mark`,
  );
  assert.equal(ran.state.phase, 'escape', 'the rescue alone does not end the mission');
});

test('winning requires extraction at or after 12 seconds', () => {
  const entered = inEscape(REMAX());
  const winAt = RELAY_CONFIG.rescueDelay + RELAY_CONFIG.rescueArrivalSeconds;

  // Extracting too early is not a win, however long the player waits afterwards.
  // 800 steps is 13.3s of escape time, comfortably past the 12s window.
  const early = run(entered.state, 800, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: false });
  assert.equal(early.state.phase, 'escape');
  assert.ok(early.state.phaseTime > winAt, `the early run reached ${early.state.phaseTime}s, expected > ${winAt}`);
  assert.equal(early.state.rescueCalled, true, 'the rescue still arrived');

  // Extracting from the start wins only once 12s of flight have elapsed.
  const won = run(entered.state, 800, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true });
  assert.equal(won.state.phase, 'won');
  assert.equal(won.state.lossReason, null);
  assert.ok(won.state.elapsed >= winAt, `won after ${won.state.elapsed}s`);
  const arrivalIndex = won.events.findIndex((entry) => entry.event.type === 'rescue-arrival');
  assert.ok(arrivalIndex >= 0, 'the rescue still arrives before the win');
});

test('the 12 second boundary is inclusive', () => {
  const entered = inEscape(REMAX());
  const winAt = RELAY_CONFIG.rescueDelay + RELAY_CONFIG.rescueArrivalSeconds;

  // Synthetic escape state placed exactly one step short of the boundary.
  const justShort = { ...entered.state, phaseTime: winAt - FIXED_STEP };
  const notYet = step(justShort, FIXED_STEP / 2, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true });
  assert.equal(notYet.state.phase, 'escape', 'half a step early must not win');

  const exact = step(justShort, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true });
  assert.equal(exact.state.phase, 'won', 'reaching exactly 12s wins');
});

test('the rescue arrival boundary is inclusive and announced once', () => {
  const entered = inEscape(REMAX());
  const synthetic = { ...entered.state, phaseTime: RELAY_CONFIG.rescueDelay - FIXED_STEP };
  const before = step(synthetic, FIXED_STEP / 2, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  assert.equal(before.events.some((event) => event.type === 'rescue-arrival'), false);

  const at = step(synthetic, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  assert.equal(at.events.filter((event) => event.type === 'rescue-arrival').length, 1);
  assert.equal(at.state.rescueCalled, true);

  // Never announced twice, even much later.
  const later = run(at.state, 200, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  assert.equal(later.events.some((event) => event.type === 'rescue-arrival'), false);
});

test('the escape window times out at 60 seconds', () => {
  const entered = inEscape(REMAX());
  const ran = run(entered.state, 3700, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: false });
  assert.equal(ran.state.phase, 'lost');
  assert.equal(ran.state.lossReason, 'escape-timeout');
  assert.equal(ran.state.rescueCalled, true, 'the rescue had already been called');
  assert.ok(ran.state.elapsed < RELAY_CONFIG.escapeSeconds + 0.5, `timeout at ${ran.state.elapsed}s`);
});

test('arriving exactly at the 60 second mark still times out', () => {
  const entered = inEscape(REMAX());
  let state = entered.state;
  let outcome = null;
  for (let index = 0; index < 3800; index += 1) {
    // Arrive only on the step that reaches the limit.
    const arrivalsAtLimit = state.phaseTime + FIXED_STEP >= RELAY_CONFIG.escapeSeconds;
    const result = advanceRelayMission(
      state,
      FIXED_STEP,
      input({ ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: arrivalsAtLimit }),
    );
    state = result.state;
    if (state.phase !== 'escape') {
      outcome = state;
      break;
    }
  }
  assert.ok(outcome, 'the escape phase must end');
  assert.equal(outcome.phase, 'lost', 'timeout outranks the extraction check');
  assert.equal(outcome.lossReason, 'escape-timeout');
});

test('player death wins every same-frame race, in every phase', () => {
  const phases = [
    ['approach', createRelayMission(), { ...FACILITIES_OPEN }],
    ['facilities', inFacilities(), { ...BOTH_FACILITIES }],
    ['reactor', inReactor(), { ...BOTH_FACILITIES, reactorDestroyed: true }],
    ['escape', inEscape(REMAX()).state, { ...BOTH_FACILITIES, atExtraction: true }],
  ];
  for (const [label, state, successful] of phases) {
    const result = step(state, FIXED_STEP, { ...successful, playerAlive: false, activeEnemies: REMAX() });
    assert.equal(result.state.phase, 'lost', `${label}: death must lose`);
    assert.equal(result.state.lossReason, 'player-destroyed', `${label}: reason`);
    assert.deepEqual(result.events, [], `${label}: a loss emits no event`);
    // Entering `lost` is a phase transition, so its phase timer starts from zero --
    // the same rule the timeout path follows.
    assert.equal(result.state.phaseTime, 0, `${label}: a transition zeroes phaseTime`);
    assert.ok(result.state.elapsed >= state.elapsed, `${label}: elapsed still accumulates`);
  }
});

test('both loss paths zero phaseTime, so callers see one consistent rule', () => {
  // Player death and the escape timeout are the only two ways to reach `lost`;
  // both are phase transitions and must behave the same way for the phase timer.
  const facilities = inFacilities();
  const died = step(facilities, FIXED_STEP, { playerAlive: false, activeEnemies: 2 }).state;
  assert.equal(died.phase, 'lost');
  assert.equal(died.lossReason, 'player-destroyed');
  assert.equal(died.phaseTime, 0, 'death zeroes phaseTime');

  const timedOut = run(inEscape(REMAX()).state, 3700, { ...BOTH_FACILITIES, activeEnemies: REMAX() }).state;
  assert.equal(timedOut.phase, 'lost');
  assert.equal(timedOut.lossReason, 'escape-timeout');
  assert.equal(timedOut.phaseTime, 0, 'timeout zeroes phaseTime');
});

test('death beats a would-be win on the exact winning step', () => {
  const entered = inEscape(REMAX());
  const readyToWin = { ...entered.state, phaseTime: RELAY_CONFIG.rescueDelay + RELAY_CONFIG.rescueArrivalSeconds - FIXED_STEP };
  const okay = step(readyToWin, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true });
  assert.equal(okay.state.phase, 'won', 'precondition: this step wins when alive');

  const died = step(readyToWin, FIXED_STEP, {
    ...BOTH_FACILITIES,
    activeEnemies: REMAX(),
    atExtraction: true,
    playerAlive: false,
  });
  assert.equal(died.state.phase, 'lost');
  assert.equal(died.state.lossReason, 'player-destroyed');
});

test('terminal phases are stable and never re-emit events', () => {
  const won = run(inEscape(REMAX()).state, 800, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true }).state;
  assert.equal(won.phase, 'won');
  const lost = run(inEscape(REMAX()).state, 3700, { ...BOTH_FACILITIES, activeEnemies: REMAX() }).state;
  assert.equal(lost.phase, 'lost');

  for (const terminal of [won, lost]) {
    const again = step(terminal, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, atExtraction: true });
    assert.equal(again.state, terminal, 'the same state object is returned');
    assert.deepEqual(again.events, []);
    // Repeated calls stay stable.
    let current = terminal;
    for (let index = 0; index < 50; index += 1) {
      const repeat = step(current, 0.1, { activeEnemies: 0 });
      assert.equal(repeat.state, terminal);
      assert.deepEqual(repeat.events, []);
      current = repeat.state;
    }
  }
});

test('dt=0 can advance a phase condition but never advances time', () => {
  const entered = advanceRelayMission(createRelayMission(), 0, input(FACILITIES_OPEN));
  assert.equal(entered.state.phase, 'facilities', 'dt=0 still processes the checkpoint condition');
  assert.equal(entered.state.elapsed, 0);
  assert.equal(entered.state.phaseTime, 0);

  const facilities = inFacilities();
  const zero = advanceRelayMission(facilities, 0, input({ activeEnemies: 2 }));
  assert.equal(zero.state.phaseTime, facilities.phaseTime);
  assert.equal(zero.state.elapsed, facilities.elapsed);
  assert.equal(zero.state.reinforcementTime, facilities.reinforcementTime);
  assert.deepEqual(zero.events, []);

  // dt=0 must not complete a timer that is not yet reached.
  const escape = inEscape(REMAX()).state;
  const nearBoundary = { ...escape, phaseTime: RELAY_CONFIG.rescueDelay - 0.001 };
  const hold = step(nearBoundary, 0, { ...BOTH_FACILITIES, activeEnemies: REMAX() });
  assert.equal(hold.state.phase, 'escape');
  assert.deepEqual(hold.events, []);
});

test('illegal dt is rejected with RangeError before any state change', () => {
  for (const dt of [-0.001, -1, 0.1000001, 0.5, Number.NaN, Infinity, -Infinity, '0.1', undefined, null]) {
    assert.throws(() => advanceRelayMission(createRelayMission(), dt, input()), RangeError, `dt=${String(dt)}`);
  }
  assert.doesNotThrow(() => advanceRelayMission(createRelayMission(), 0, input()));
  assert.doesNotThrow(() => advanceRelayMission(createRelayMission(), 0.1, input()));
});

test('activeEnemies must be an integer in 0..8', () => {
  for (const activeEnemies of [-1, 9, 1.5, Number.NaN, Infinity, '3', undefined, null, true]) {
    assert.throws(
      () => advanceRelayMission(createRelayMission(), 0.1, input({ activeEnemies })),
      RangeError,
      `activeEnemies=${String(activeEnemies)}`,
    );
  }
  for (let activeEnemies = 0; activeEnemies <= RELAY_CONFIG.maxEnemies; activeEnemies += 1) {
    assert.doesNotThrow(() => advanceRelayMission(createRelayMission(), 0.1, input({ activeEnemies })));
  }
});

test('validation also runs for terminal states, so a caller bug is still reported', () => {
  const won = run(inEscape(REMAX()).state, 800, { ...BOTH_FACILITIES, activeEnemies: REMAX(), atExtraction: true }).state;
  assert.equal(won.phase, 'won');
  assert.throws(() => advanceRelayMission(won, FIXED_STEP, input({ activeEnemies: 99 })), RangeError);
  assert.throws(() => advanceRelayMission(won, 0.5, input()), RangeError);
  // With valid input the terminal state is returned untouched.
  assert.equal(advanceRelayMission(won, FIXED_STEP, input()).state, won);
});

test('inputs and states are never mutated', () => {
  const facilities = inFacilities();
  const frozenInput = Object.freeze(input({ activeEnemies: 3, commsDestroyed: true }));
  const before = JSON.stringify(facilities);

  const result = advanceRelayMission(facilities, 0.05, frozenInput);
  assert.equal(JSON.stringify(facilities), before, 'the input state values are untouched');
  assert.equal(frozenInput.activeEnemies, 3, 'a frozen input object survives');
  assert.notEqual(result.state, facilities, 'a new state object is returned');
  assert.deepEqual(Object.keys(frozenInput).sort(), [
    'activeEnemies',
    'atExtraction',
    'commsDestroyed',
    'fireControlDestroyed',
    'inStationRange',
    'patrolCleared',
    'playerAlive',
    'reactorDestroyed',
  ]);

  // Event payloads are plain objects the caller cannot use to corrupt the state.
  const spawned = step(inReactor(), FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: 0 });
  const spawn = spawned.events.find((event) => event.type === 'spawn');
  spawn.count = 999;
  assert.equal(spawned.state.phase, 'escape');
  assert.deepEqual(
    step(inReactor(), FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: 0 }).events.find(
      (event) => event.type === 'spawn',
    ),
    { type: 'spawn', count: 4, purpose: 'pursuit' },
    'mutating one event must not leak into later runs',
  );
});

test('elapsed accumulates while phaseTime restarts at each transition', () => {
  const facilities = run(inFacilities(), 30, { activeEnemies: 2 }).state;
  assert.ok(Math.abs(facilities.elapsed - facilities.phaseTime) < 1e-9, 'facilities began at elapsed 0 in this run');

  const reactor = step(facilities, FIXED_STEP, BOTH_FACILITIES).state;
  assert.equal(reactor.phaseTime, 0);
  assert.ok(reactor.elapsed > facilities.elapsed, 'elapsed keeps growing across the transition');

  const escape = step(reactor, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: RELAY_CONFIG.maxEnemies }).state;
  assert.equal(escape.phaseTime, 0);
  assert.ok(escape.elapsed > reactor.elapsed);

  const later = run(escape, 100, { ...BOTH_FACILITIES, activeEnemies: RELAY_CONFIG.maxEnemies }).state;
  assert.ok(later.phaseTime > 0);
  assert.ok(later.elapsed > later.phaseTime, 'elapsed is the running total, phaseTime the current phase');
});

test('the module stays a pure state machine with no clock, DOM or randomness', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  const forbidden = [
    ['Three.js', /\bfrom\s+['"]three/],
    ['DOM/window', /\b(?:window|document)\s*\./],
    ['timers', /\bset(?:Timeout|Interval)\b/],
    ['wall clock', /\b(?:Date\s*\.\s*now|performance\s*\.\s*now)\b/],
    ['global randomness', /\bMath\s*\.\s*random\b/],
    ['network', /\b(?:fetch|XMLHttpRequest|WebSocket)\b/],
    ['sleep', /\b(?:Atomics\s*\.\s*wait|sleep)\b/],
  ];
  for (const [label, pattern] of forbidden) {
    assert.doesNotMatch(source, pattern, `${label} must not appear in relay-mission.ts`);
  }
  // The only import may be the frozen relay contract (no app, visual or three imports).
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, 'the module should import the contract');
  for (const specifier of imports) {
    assert.equal(specifier, '../shared/relay-contract.ts', `unexpected import ${specifier}`);
  }
});

/** Deterministic PRNG for the seeded runs; no global random state. */
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

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Seeded bot that plays the whole mission through every phase. It only reads the
 * state it was given, so the trace must be reproducible.
 */
function playSeeded(seed, maxSteps) {
  const random = makeRandom(seed);
  let state = createRelayMission();
  let comms = random() < 0.5;
  let fireControl = random() < 0.5;
  const digestLines = [];
  const counters = { spawns: 0, checkpoints: 0, rescues: 0, escapeStarts: 0, reactorEvents: 0 };
  let steps = 0;

  while (steps < maxSteps && state.phase !== 'won' && state.phase !== 'lost') {
    const activeEnemies = Math.floor(random() * (RELAY_CONFIG.maxEnemies + 1));
    const overrides = { activeEnemies };

    if (state.phase === 'approach') {
      overrides.patrolCleared = random() < 0.9;
      overrides.inStationRange = random() < 0.7;
    } else if (state.phase === 'facilities') {
      if (random() < 0.05) comms = true;
      if (random() < 0.05) fireControl = true;
      overrides.commsDestroyed = comms;
      overrides.fireControlDestroyed = fireControl;
    } else if (state.phase === 'reactor') {
      overrides.commsDestroyed = true;
      overrides.fireControlDestroyed = true;
      if (random() < 0.3) overrides.reactorDestroyed = true;
    } else if (state.phase === 'escape') {
      overrides.commsDestroyed = true;
      overrides.fireControlDestroyed = true;
      overrides.atExtraction = random() < 0.6;
    }

    const result = advanceRelayMission(state, FIXED_STEP, input(overrides));
    const previous = state;
    state = result.state;

    // Per-step invariants.
    assert.ok(state.elapsed >= previous.elapsed, `step ${steps}: elapsed must not go backwards`);
    assert.ok(state.phaseTime >= 0 && Number.isFinite(state.phaseTime));
    assert.ok(Number.isFinite(state.reinforcementTime) && state.reinforcementTime >= 0);
    assert.ok(
      state.reinforcementTime <= RELAY_CONFIG.reinforcementSeconds + FIXED_STEP,
      `step ${steps}: reinforcement timer ${state.reinforcementTime} escaped its window`,
    );

    for (const event of result.events) {
      if (event.type === 'spawn') {
        counters.spawns += 1;
        assert.ok(Number.isInteger(event.count) && event.count >= 1, `step ${steps}: spawn count`);
        assert.ok(overrides.activeEnemies + event.count <= RELAY_CONFIG.maxEnemies, `step ${steps}: spawn above cap`);
        assert.ok(event.purpose === 'reinforcement' || event.purpose === 'pursuit');
      }
      if (event.type === 'checkpoint') counters.checkpoints += 1;
      if (event.type === 'rescue-arrival') counters.rescues += 1;
      if (event.type === 'escape-started') counters.escapeStarts += 1;
      if (event.type === 'reactor-exposed') counters.reactorEvents += 1;
    }

    if (steps % 97 === 0) {
      digestLines.push(
        [
          steps,
          state.phase,
          state.elapsed.toFixed(6),
          state.phaseTime.toFixed(6),
          state.reinforcementTime.toFixed(6),
          state.rescueCalled ? 1 : 0,
          state.lossReason ?? '-',
        ].join(','),
      );
    }
    steps += 1;
  }

  return { seed, state, steps, counters, digest: hashString(digestLines.join('\n')), samples: digestLines.length };
}

test('identical seeds produce identical traces', () => {
  for (const seed of [1, 20261017, 424242]) {
    const first = playSeeded(seed, 40000);
    const second = playSeeded(seed, 40000);
    assert.equal(first.digest, second.digest, `seed ${seed} digest`);
    assert.equal(first.steps, second.steps);
    assert.deepEqual(first.state, second.state);
    assert.deepEqual(first.counters, second.counters);
    assert.ok(first.samples > 5, 'the digest must cover many sampled steps');
  }
});

test('different seeds reach genuinely different outcomes', () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => playSeeded(seed, 40000));
  const outcomes = new Set(runs.map((run) => `${run.state.phase}:${run.steps}:${run.digest}`));
  assert.ok(outcomes.size > 1, 'the bot must not collapse every seed onto one result');
  for (const run of runs) {
    assert.ok(run.steps <= 40000, `seed ${run.seed} stayed bounded at ${run.steps} steps`);
    assert.ok(MAX_STEPS >= 40000);
  }
});

test('a seeded campaign respects every invariant and event budget', () => {
  const run = playSeeded(20261017, 40000);
  assert.ok(run.steps <= MAX_STEPS);

  // Each one-shot event happens at most once over an entire campaign.
  assert.ok(run.counters.checkpoints <= 2, `checkpoints ${run.counters.checkpoints}`);
  assert.ok(run.counters.rescues <= 1, `rescues ${run.counters.rescues}`);
  assert.ok(run.counters.escapeStarts <= 1, `escape-started ${run.counters.escapeStarts}`);
  assert.ok(run.counters.reactorEvents <= 1, `reactor-exposed ${run.counters.reactorEvents}`);

  // A finished campaign always ends in a declared terminal phase with a coherent reason.
  if (run.state.phase === 'won') {
    assert.equal(run.state.lossReason, null);
    assert.ok(run.state.phaseTime === 0 || run.state.phaseTime >= 0);
  } else if (run.state.phase === 'lost') {
    assert.ok(run.state.lossReason === 'player-destroyed' || run.state.lossReason === 'escape-timeout');
  } else {
    assert.fail(`the seeded campaign should finish inside ${MAX_STEPS} steps, stopped in ${run.state.phase}`);
  }
});

test('a long bounded sequence neither drifts nor mutates shared config', () => {
  const configBefore = JSON.stringify(RELAY_CONFIG);
  const initialBefore = JSON.stringify(createRelayMission());
  const template = input();
  const templateBefore = JSON.stringify(template);

  // 20000 facilities steps (~333 simulated seconds) is a long run that keeps firing
  // reinforcement batches, then the campaign is driven to its escape timeout.
  // The enemy count must NOT cycle with a period that divides 1440 steps (one 24s
  // window): a period of 9 would put a full field on every boundary and legitimately
  // suppress every batch, which would test nothing here.
  let state = inFacilities();
  let steps = 0;
  let reinforcementSpawns = 0;
  for (let index = 0; index < 20000; index += 1) {
    const activeEnemies = index % 7;
    const result = advanceRelayMission(state, FIXED_STEP, input({ activeEnemies }));
    state = result.state;
    steps += 1;
    for (const event of result.events) {
      if (event.type === 'spawn') {
        reinforcementSpawns += 1;
        assert.ok(activeEnemies + event.count <= RELAY_CONFIG.maxEnemies, `step ${index}: spawn above cap`);
        assert.equal(event.purpose, 'reinforcement');
      }
    }
    assert.equal(state.phase, 'facilities', 'facilities cannot end on its own');
    assert.ok(
      state.reinforcementTime <= RELAY_CONFIG.reinforcementSeconds + FIXED_STEP,
      `step ${index}: timer ${state.reinforcementTime} left its window`,
    );
    assert.ok(Number.isFinite(state.elapsed) && state.elapsed >= 0);
  }
  assert.ok(
    reinforcementSpawns >= 5,
    `~333s of facilities should fire about 13 batches, saw ${reinforcementSpawns}`,
  );
  assert.ok(Math.abs(state.elapsed - 20000 * FIXED_STEP) < 1e-6, 'elapsed tracked the step count');

  // Finish the campaign inside the same step budget.
  state = step(state, FIXED_STEP, BOTH_FACILITIES).state;
  state = step(state, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: 0 }).state;
  assert.equal(state.phase, 'escape');
  while (steps < MAX_STEPS && state.phase === 'escape') {
    state = step(state, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: RELAY_CONFIG.maxEnemies }).state;
    steps += 1;
  }
  assert.equal(state.phase, 'lost', 'without extraction the run times out');
  assert.equal(state.lossReason, 'escape-timeout');
  assert.ok(steps <= MAX_STEPS, `bounded at ${steps} steps (limit ${MAX_STEPS})`);

  assert.equal(JSON.stringify(RELAY_CONFIG), configBefore, 'shared config must not be rewritten');
  assert.equal(JSON.stringify(createRelayMission()), initialBefore, 'a fresh mission is still pristine');
  assert.equal(JSON.stringify(template), templateBefore, 'the input template must not be rewritten');
});

test('a full scripted campaign reaches a win and reports it once', () => {
  // Deterministic best case: clear the patrol, kill both facilities, kill the reactor,
  // then extract as soon as the 12s window opens.
  let state = advanceRelayMission(createRelayMission(), 0, input(FACILITIES_OPEN)).state;
  state = step(state, FIXED_STEP, BOTH_FACILITIES).state;
  state = step(state, FIXED_STEP, { ...BOTH_FACILITIES, reactorDestroyed: true, activeEnemies: 2 }).state;
  assert.equal(state.phase, 'escape');

  let events = [];
  for (let index = 0; index < 900 && state.phase === 'escape'; index += 1) {
    const result = step(state, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: RELAY_CONFIG.maxEnemies, atExtraction: true });
    state = result.state;
    events = events.concat(result.events);
  }
  assert.equal(state.phase, 'won', 'the scripted campaign must win');
  assert.equal(state.lossReason, null);
  assert.equal(events.filter((event) => event.type === 'rescue-arrival').length, 1, 'one rescue arrival');
  assert.equal(events.filter((event) => event.type === 'escape-started').length, 0, 'entry event was not replayed');

  // And it stays won.
  const confirm = step(state, FIXED_STEP, { ...BOTH_FACILITIES, activeEnemies: 0 });
  assert.equal(confirm.state, state);
  assert.deepEqual(confirm.events, []);
});

test('a lost escape cannot be revived by a later successful input', () => {
  const timedOut = run(inEscape(REMAX()).state, 3700, { ...BOTH_FACILITIES, activeEnemies: REMAX() }).state;
  assert.equal(timedOut.phase, 'lost');
  const revived = step(timedOut, FIXED_STEP, {
    ...BOTH_FACILITIES,
    atExtraction: true,
    reactorDestroyed: true,
    activeEnemies: 0,
  });
  assert.equal(revived.state.phase, 'lost');
  assert.equal(revived.state.lossReason, 'escape-timeout');
});

test('reactor keeps the same comms-driven reinforcement rule even though normal play cannot reach it', () => {
  // Reaching reactor through normal play always has comms destroyed (facilities are
  // what gate it), so this branch is defensive. The contract still states the rule,
  // so it is exercised with a synthetic reactor state: comms intact -> timer ticks.
  const synthetic = {
    phase: 'reactor',
    elapsed: 30,
    phaseTime: 3,
    reinforcementTime: RELAY_CONFIG.reinforcementSeconds - 0.05,
    rescueCalled: false,
    lossReason: null,
  };
  const spawn = step(synthetic, 0.1, { activeEnemies: 3 });
  assert.equal(spawn.state.phase, 'reactor');
  const spawns = spawn.events.filter((event) => event.type === 'spawn');
  assert.deepEqual(spawns, [{ type: 'spawn', count: 2, purpose: 'reinforcement' }]);

  const muted = step(synthetic, 0.1, { activeEnemies: 3, commsDestroyed: true });
  assert.deepEqual(muted.events, [], 'with comms destroyed the reactor phase adds nothing');
  assert.equal(muted.state.reinforcementTime, synthetic.reinforcementTime);
});
