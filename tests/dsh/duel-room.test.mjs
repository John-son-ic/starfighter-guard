/**
 * D13 behaviour tests — duel room / round / score state machine.
 * Run: node --test tests/dsh/duel-room.test.mjs
 *
 * Rules source: docs/tasks/DSH_DUEL.md (D13). Types source: src/shared/duel-contract.ts.
 * The implementation under test is src/sim/duel-room.ts; these tests only observe it.
 * No DOM, network, wall clock or randomness is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelRoom, reduceDuelRoom } from '../../src/sim/duel-room.ts';
import { DUEL_ROOM_ALPHABET, DUEL_RULES } from '../../src/shared/duel-contract.ts';

const CODE = 'ABCD23';
const P1 = 'conn-alpha';
const P2 = 'conn-beta';
const P3 = 'conn-gamma';

const { countdownTicks, intermissionTicks, matchLimitTicks, scoreToWin } = DUEL_RULES;

function room(code = CODE) {
  return createDuelRoom(code);
}

function apply(state, command) {
  return reduceDuelRoom(state, command);
}

function join(state, connectionId) {
  return apply(state, { type: 'join', connectionId });
}

function ready(state, connectionId, value = true) {
  return apply(state, { type: 'ready', connectionId, value });
}

function leave(state, connectionId, reason = 'leave') {
  return apply(state, { type: 'leave', connectionId, reason });
}

function tick(state, deadSlots = []) {
  return apply(state, { type: 'tick', deadSlots });
}

function tickMany(state, count, deadSlotsAt = () => []) {
  let current = state;
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const result = tick(current, deadSlotsAt(index));
    current = result.state;
    for (const event of result.events) events.push(event);
  }
  return { state: current, events };
}

/** Fresh room driven into countdown with both players ready. */
function toCountdown() {
  let state = room();
  state = join(state, P1).state;
  state = join(state, P2).state;
  state = ready(state, P1).state;
  const last = ready(state, P2);
  assert.equal(last.state.phase, 'countdown', 'helper precondition');
  return last.state;
}

/** Fresh room driven into the first playing round. */
function toPlaying() {
  const started = toCountdown();
  const advanced = tickMany(started, countdownTicks);
  assert.equal(advanced.state.phase, 'playing', 'helper precondition');
  return advanced.state;
}

/** Runs a full intermission and returns the next round's playing state. */
function throughIntermission(state) {
  assert.equal(state.phase, 'intermission', 'helper precondition');
  const advanced = tickMany(state, intermissionTicks);
  assert.equal(advanced.state.phase, 'playing', 'helper precondition');
  return advanced.state;
}

test('a new room starts in waiting with every counter zeroed', () => {
  const state = room();
  assert.deepEqual(state, {
    code: CODE,
    phase: 'waiting',
    members: [null, null],
    scores: [0, 0],
    matchId: 0,
    roundId: 0,
    phaseTicks: 0,
    matchTicks: 0,
    winner: null,
    finishReason: null,
  });
  assert.notEqual(room(), state, 'each room is a distinct object');
});

test('the room code must be six characters from DUEL_ROOM_ALPHABET', () => {
  assert.doesNotThrow(() => createDuelRoom(CODE));
  assert.doesNotThrow(() => createDuelRoom(DUEL_ROOM_ALPHABET.slice(0, 6)));

  const illegal = [
    '',
    'ABCD2', // 5 characters
    'ABCD234', // 7 characters
    'abcd23', // lower case is not in the alphabet and is not folded
    'ABCD 3',
    'ABCD 2',
    ' ABC23',
    'ABCD23 ',
    'AB0D23', // 0 is excluded from the alphabet
    'ABID23', // I is excluded
    'ABOD23', // O is excluded
    'AB1D23', // 1 is excluded
    'ABCD\u0000',
  ];
  for (const code of illegal) {
    assert.throws(() => createDuelRoom(code), RangeError, `code ${JSON.stringify(code)} must be rejected`);
  }
  for (const code of [undefined, null, 123456, [], {}]) {
    assert.throws(() => createDuelRoom(code), RangeError, `code ${String(code)} must be rejected`);
  }
});

test('command fields are validated at runtime before any state decision', () => {
  const waiting = room();
  const badConnectionIds = [
    '',
    'a'.repeat(65),
    'has space',
    'has.dot',
    'has/slash',
    'has\u00e9', // non ASCII
    123,
    null,
    undefined,
  ];
  for (const connectionId of badConnectionIds) {
    assert.throws(() => join(waiting, connectionId), RangeError, `join id ${String(connectionId)}`);
    assert.throws(() => ready(waiting, connectionId, true), RangeError, `ready id ${String(connectionId)}`);
    assert.throws(() => leave(waiting, connectionId), RangeError, `leave id ${String(connectionId)}`);
  }

  assert.doesNotThrow(() => join(waiting, 'a'.repeat(64)), '64 characters is the maximum');
  assert.doesNotThrow(() => join(waiting, 'A_b-9'), 'letters, digits, underscore and hyphen are allowed');

  for (const value of [0, 1, 'true', 'false', null, {}]) {
    assert.throws(() => ready(waiting, P1, value), RangeError, `ready.value ${String(value)}`);
  }
  // Called directly: the helper's default would turn an explicit undefined into true.
  assert.throws(() => apply(waiting, { type: 'ready', connectionId: P1, value: undefined }), RangeError, 'ready.value undefined');
  assert.throws(() => apply(waiting, { type: 'ready', connectionId: P1 }), RangeError, 'ready without value');

  for (const reason of ['quit', 'LEFT', '', null, 1]) {
    assert.throws(() => leave(waiting, P1, reason), RangeError, `leave.reason ${String(reason)}`);
  }
  assert.throws(() => apply(waiting, { type: 'leave', connectionId: P1, reason: undefined }), RangeError, 'leave.reason undefined');
  assert.throws(() => apply(waiting, { type: 'leave', connectionId: P1 }), RangeError, 'leave without reason');

  const badDeadSlots = [
    undefined,
    null,
    'none',
    0,
    [0, 0],
    [1, 1],
    [0, 1, 0],
    [2],
    [-1],
    [0.5],
    ['0'],
    [true],
    [null],
  ];
  for (const deadSlots of badDeadSlots) {
    assert.throws(() => apply(waiting, { type: 'tick', deadSlots }), RangeError, `deadSlots ${JSON.stringify(deadSlots)}`);
  }
  assert.doesNotThrow(() => tick(waiting, []));
  assert.doesNotThrow(() => tick(waiting, [0]));
  assert.doesNotThrow(() => tick(waiting, [1, 0]));
});

test('an unknown command type is a TypeError, not a business error', () => {
  const waiting = room();
  for (const command of [{ type: 'kick' }, { type: '' }, { type: 1 }, {}, { type: null }]) {
    assert.throws(() => reduceDuelRoom(waiting, command), TypeError, `command ${JSON.stringify(command)}`);
  }
  for (const command of [null, undefined, 'join', 42, []]) {
    assert.throws(() => reduceDuelRoom(waiting, command), TypeError, `command ${String(command)}`);
  }
});

test('validation still runs inside terminal phases', () => {
  const closed = leave(join(room(), P1).state, P1).state;
  assert.equal(closed.phase, 'closed');
  // A malformed command is a programming error even though the room is closed.
  assert.throws(() => join(closed, ''), RangeError);
  assert.throws(() => apply(closed, { type: 'tick', deadSlots: [0, 0] }), RangeError);
  assert.throws(() => reduceDuelRoom(closed, { type: 'nope' }), TypeError);
  // A well-formed command gets the business answer instead.
  assert.equal(join(closed, P3).error, 'room-closed');
});

test('inputs are never modified, even when deeply frozen', () => {
  const state = toPlaying();
  const frozenMembers = Object.freeze([Object.freeze(state.members[0]), Object.freeze(state.members[1])]);
  const frozenState = Object.freeze({
    ...state,
    members: frozenMembers,
    scores: Object.freeze([...state.scores]),
  });
  const before = JSON.stringify(frozenState);

  const frozenCommand = Object.freeze({ type: 'tick', deadSlots: Object.freeze([0]) });
  const result = apply(frozenState, frozenCommand);

  assert.equal(JSON.stringify(frozenState), before, 'the input state is untouched');
  assert.deepEqual([...frozenCommand.deadSlots], [0], 'the input command is untouched');
  assert.notEqual(result.state, frozenState, 'a new state object is returned');
  assert.equal(result.state.phase, 'intermission');
  assert.equal(result.state.scores[1], 1);
  assert.equal(frozenState.scores[1], 0, 'the frozen score array did not change');
});

test('join uses the first free slot and rejects duplicates then a full room', () => {
  let state = room();
  const first = join(state, P1);
  assert.equal(first.error, null);
  assert.deepEqual(first.events, [{ type: 'member-joined', slot: 0 }]);
  assert.deepEqual(first.state.members[0], { connectionId: P1, ready: false });
  assert.equal(first.state.members[1], null);
  state = first.state;

  const duplicate = join(state, P1);
  assert.equal(duplicate.error, 'already-member');
  assert.equal(duplicate.state, state, 'a rejection returns the original state');
  assert.deepEqual(duplicate.events, []);

  const second = join(state, P2);
  assert.deepEqual(second.events, [{ type: 'member-joined', slot: 1 }]);
  assert.equal(second.state.members[1].connectionId, P2);
  state = second.state;

  const third = join(state, P3);
  assert.equal(third.error, 'room-full', 'a full room wins over other checks');
  assert.equal(third.state, state);
});

test('ready is only accepted from members in waiting or finished', () => {
  const state = join(room(), P1).state;
  assert.equal(ready(state, P3).error, 'not-member');
  assert.equal(leave(state, P3).error, 'not-member');

  const countdown = toCountdown();
  assert.equal(ready(countdown, P1).error, 'not-ready-phase', 'countdown does not accept ready');
  assert.equal(ready(countdown, P1, false).error, 'not-ready-phase');

  const playing = toPlaying();
  assert.equal(ready(playing, P1).error, 'not-ready-phase');
});

test('one ready is not enough; both readies start a countdown once', () => {
  let state = room();
  state = join(state, P1).state;
  state = join(state, P2).state;

  const single = ready(state, P1);
  assert.equal(single.error, null);
  assert.deepEqual(single.events, [], 'one player ready starts nothing');
  assert.equal(single.state.phase, 'waiting');
  state = single.state;

  const repeated = ready(state, P1);
  assert.deepEqual(repeated.events, [], 'repeating the same ready value emits nothing');
  assert.equal(repeated.state, state, 'no change means the same state object');

  const started = ready(state, P2);
  assert.equal(started.error, null);
  assert.deepEqual(started.events, [{ type: 'countdown-started', matchId: 1 }]);
  assert.equal(started.state.phase, 'countdown');
  assert.equal(started.state.matchId, 1);
  assert.equal(started.state.roundId, 1);
  assert.deepEqual(started.state.scores, [0, 0]);
  assert.equal(started.state.phaseTicks, 0);
  assert.equal(started.state.matchTicks, 0);
  assert.equal(started.state.winner, null);
  assert.equal(started.state.finishReason, null);
  assert.equal(started.state.members[0].ready, true, 'both members stay ready');
  assert.equal(started.state.members[1].ready, true);
});

test('the countdown flips to playing on exactly the 180th tick', () => {
  const countdown = toCountdown();
  const before = tickMany(countdown, countdownTicks - 1);
  assert.equal(before.state.phase, 'countdown');
  assert.equal(before.state.phaseTicks, countdownTicks - 1);
  assert.equal(before.events.length, 0);

  const flip = tick(before.state);
  assert.equal(flip.state.phase, 'playing');
  assert.equal(flip.state.phaseTicks, 0, 'the new phase starts its own timer');
  assert.equal(flip.state.matchTicks, 0, 'playing has not advanced yet');
  assert.deepEqual(flip.events, [{ type: 'round-started', roundId: 1 }]);

  const next = tick(flip.state);
  assert.equal(next.state.phaseTicks, 1);
  assert.equal(next.state.matchTicks, 1);
  assert.deepEqual(next.events, []);
});

test('playing ticks accumulate both timers and a death scores the survivor', () => {
  const playing = toPlaying();
  const warm = tickMany(playing, 5);
  assert.equal(warm.state.phaseTicks, 5);
  assert.equal(warm.state.matchTicks, 5);
  assert.deepEqual(warm.state.scores, [0, 0]);

  // Slot 0 dies, so slot 1 scores.
  const killed = tick(warm.state, [0]);
  assert.equal(killed.error, null);
  assert.deepEqual(killed.state.scores, [0, 1]);
  assert.deepEqual(killed.events, [{ type: 'round-ended', winner: 1, deadSlots: [0] }]);
  assert.equal(killed.state.phase, 'intermission');
  assert.equal(killed.state.phaseTicks, 0, 'the intermission starts its own timer');
  assert.equal(killed.state.matchTicks, 6, 'match time is kept');
  assert.equal(killed.state.roundId, 1, 'roundId does not advance until the next round starts');

  // Slot 1 dies, so slot 0 scores.
  const other = tick({ ...playing }, [1]);
  assert.deepEqual(other.state.scores, [1, 0]);
  assert.deepEqual(other.events, [{ type: 'round-ended', winner: 0, deadSlots: [1] }]);
});

test('both deaths on one tick are a draw with no score and an ascending slot list', () => {
  const playing = toPlaying();
  const result = tick(playing, [1, 0]);
  assert.deepEqual(result.state.scores, [0, 0], 'nobody scores');
  assert.deepEqual(result.events, [{ type: 'round-ended', winner: null, deadSlots: [0, 1] }]);
  assert.equal(result.state.phase, 'intermission');

  // The caller's array is not reordered or reused.
  const command = { type: 'tick', deadSlots: [1, 0] };
  apply(playing, command);
  assert.deepEqual(command.deadSlots, [1, 0]);
});

test('the intermission never re-scores and starts round 2 on the 300th tick', () => {
  const killed = tick(toPlaying(), [0]);
  let state = killed.state;
  const mid = tickMany(state, intermissionTicks - 1);
  assert.equal(mid.state.phase, 'intermission');
  assert.equal(mid.state.phaseTicks, intermissionTicks - 1);
  assert.deepEqual(mid.state.scores, [0, 1], 'no further scoring during intermission');
  assert.equal(mid.state.matchTicks, killed.state.matchTicks, 'intermission does not add match time');
  assert.equal(mid.events.length, 0, 'no repeated round-ended events');

  const restart = tick(mid.state);
  assert.equal(restart.state.phase, 'playing');
  assert.equal(restart.state.roundId, 2);
  assert.equal(restart.state.phaseTicks, 0);
  assert.deepEqual(restart.events, [{ type: 'round-started', roundId: 2 }]);

  // A second death in the new round scores again and keeps the running total.
  const again = tick(restart.state, [0]);
  assert.deepEqual(again.state.scores, [0, 2]);
});

test('death slots are ignored outside playing', () => {
  const countdown = toCountdown();
  const duringCountdown = tick(countdown, [0, 1]);
  assert.deepEqual(duringCountdown.state.scores, [0, 0]);
  assert.deepEqual(duringCountdown.events, []);
  assert.equal(duringCountdown.state.phase, 'countdown');

  const intermission = tick(toPlaying(), [0]).state;
  const duringIntermission = tick(intermission, [1]);
  assert.deepEqual(duringIntermission.state.scores, [0, 1], 'unchanged from the first death');
  assert.deepEqual(duringIntermission.events, []);
});

test('three points ends the match with reason score', () => {
  let state = toPlaying();
  // Slot 1 scores three rounds; slot 0 dies each time.
  state = tick(state, [0]).state; // 0:1
  state = throughIntermission(state);
  state = tick(state, [0]).state; // 0:2
  state = throughIntermission(state);
  assert.equal(state.roundId, 3);

  const winning = tick(state, [0]); // 0:3
  assert.equal(winning.state.phase, 'finished');
  assert.deepEqual(winning.state.scores, [0, 3]);
  assert.equal(winning.state.winner, 1);
  assert.equal(winning.state.finishReason, 'score');
  assert.equal(winning.state.phaseTicks, 0);
  assert.equal(winning.state.members[0].ready, false, 'both ready flags are cleared');
  assert.equal(winning.state.members[1].ready, false);
  assert.deepEqual(winning.events, [
    { type: 'round-ended', winner: 1, deadSlots: [0] },
    { type: 'match-finished', winner: 1, reason: 'score' },
  ]);
});

test('the match ends at exactly the 36000th playing tick by score comparison', () => {
  const playing = toPlaying();
  const limit = matchLimitTicks;

  const before = { ...playing, matchTicks: limit - 1, scores: [2, 1] };
  const endpoint = tick(before);
  assert.equal(endpoint.state.matchTicks, limit);
  assert.equal(endpoint.state.phase, 'finished');
  assert.equal(endpoint.state.winner, 0, 'the higher score wins');
  assert.equal(endpoint.state.finishReason, 'time-limit');
  assert.deepEqual(endpoint.events, [{ type: 'match-finished', winner: 0, reason: 'time-limit' }]);

  // One tick earlier nothing happens.
  const justBefore = { ...playing, matchTicks: limit - 2, scores: [2, 1] };
  assert.equal(tick(justBefore).state.phase, 'playing');
});

test('a tied match at the time limit finishes without a winner', () => {
  const playing = toPlaying();
  const endpoint = tick({ ...playing, matchTicks: matchLimitTicks - 1, scores: [1, 1] });
  assert.equal(endpoint.state.phase, 'finished');
  assert.equal(endpoint.state.winner, null);
  assert.equal(endpoint.state.finishReason, 'time-limit');
  assert.deepEqual(endpoint.events, [{ type: 'match-finished', winner: null, reason: 'time-limit' }]);

  const trailing = tick({ ...playing, matchTicks: matchLimitTicks - 1, scores: [0, 1] });
  assert.equal(trailing.state.winner, 1);
});

test('scoring the third point on the last tick outranks the time limit', () => {
  const playing = toPlaying();
  const lastTick = { ...playing, matchTicks: matchLimitTicks - 1, scores: [2, 2] };
  const result = tick(lastTick, [0]); // slot 1 reaches 3 as the match clock expires
  assert.equal(result.state.matchTicks, matchLimitTicks, 'the clock did reach the limit');
  assert.equal(result.state.phase, 'finished');
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.finishReason, 'score', 'score is checked before the time limit');
  assert.deepEqual(result.events, [
    { type: 'round-ended', winner: 1, deadSlots: [0] },
    { type: 'match-finished', winner: 1, reason: 'score' },
  ]);
});

test('a time-limit finish on a death tick still reports both events in order', () => {
  const playing = toPlaying();
  // Slot 0 dies at the limit with no third point scored (scores 1:1 -> 1:2).
  const result = tick({ ...playing, matchTicks: matchLimitTicks - 1, scores: [1, 1] }, [0]);
  assert.deepEqual(result.events, [
    { type: 'round-ended', winner: 1, deadSlots: [0] },
    { type: 'match-finished', winner: 1, reason: 'time-limit' },
  ]);
  assert.equal(result.state.finishReason, 'time-limit');
  assert.equal(result.state.winner, 1);
});

test('leaving during the countdown cancels the match and returns to waiting', () => {
  const countdown = toCountdown();
  const result = leave(countdown, P2);
  assert.equal(result.error, null);
  assert.deepEqual(result.events, [{ type: 'member-left', slot: 1 }]);
  assert.equal(result.state.phase, 'waiting');
  assert.deepEqual(result.state.members, [{ connectionId: P1, ready: false }, null], 'both ready flags are cleared');
  assert.deepEqual(result.state.scores, [0, 0]);
  assert.equal(result.state.roundId, 0);
  assert.equal(result.state.phaseTicks, 0);
  assert.equal(result.state.matchTicks, 0);
  assert.equal(result.state.winner, null);
  assert.equal(result.state.finishReason, null);
  assert.equal(result.state.matchId, 1, 'matchId is kept');
  assert.equal(
    result.events.some((event) => event.type === 'match-finished'),
    false,
    'no match-finished for a cancelled match',
  );
});

test('leaving while playing finishes the match for the remaining player', () => {
  const playing = tick(toPlaying(), [0]).state; // 0:1 intermission, then continue
  const live = throughIntermission(playing);
  assert.equal(live.phase, 'playing');

  const disconnected = leave(live, P2, 'disconnect');
  assert.equal(disconnected.error, null);
  assert.equal(disconnected.state.phase, 'finished');
  assert.equal(disconnected.state.winner, 0);
  assert.equal(disconnected.state.finishReason, 'disconnect');
  assert.equal(disconnected.state.phaseTicks, 0);
  assert.deepEqual(disconnected.state.scores, [0, 1], 'the score is not padded or faked');
  assert.deepEqual(disconnected.events, [
    { type: 'member-left', slot: 1 },
    { type: 'match-finished', winner: 0, reason: 'disconnect' },
  ]);

  const left = leave(toPlaying(), P1, 'leave');
  assert.equal(left.state.finishReason, 'leave');
  assert.equal(left.state.winner, 1);
});

test('leaving a finished match keeps the result and never repeats match-finished', () => {
  let state = toPlaying();
  state = tick(state, [0]).state; // 0:1
  state = throughIntermission(state);
  state = tick(state, [0]).state; // 0:2
  state = throughIntermission(state);
  state = tick(state, [0]).state; // 0:3 finished
  assert.equal(state.phase, 'finished');
  const scores = state.scores;

  const result = leave(state, P1);
  assert.equal(result.state.phase, 'finished');
  assert.deepEqual(result.state.scores, scores, 'the final score is preserved');
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.finishReason, 'score');
  assert.deepEqual(result.events, [{ type: 'member-left', slot: 0 }], 'no second match-finished');
});

test('the last member leaving closes the room and keeps the recorded result', () => {
  let state = tick(toPlaying(), [0]).state; // intermission 0:1
  const closedByWinner = leave(state, P1); // winner leaves: still finished, P2 remains
  assert.equal(closedByWinner.state.phase, 'finished');

  const closed = leave(closedByWinner.state, P2);
  assert.equal(closed.state.phase, 'closed');
  assert.equal(closed.state.phaseTicks, 0);
  assert.deepEqual(closed.state.scores, [0, 1], 'the score is kept for the closing snapshot');
  assert.deepEqual(closed.events, [{ type: 'member-left', slot: 1 }, { type: 'room-closed' }], 'room-closed is emitted once');

  // A closed room stays closed and stable.
  assert.equal(tick(closed.state).state, closed.state);
  assert.deepEqual(tick(closed.state).events, []);
  assert.equal(join(closed.state, P3).error, 'room-closed');
  assert.equal(ready(closed.state, P2).error, 'room-closed');
  assert.equal(leave(closed.state, P2).error, 'room-closed');
});

test('a new member joining a finished room wipes the old result but keeps matchId', () => {
  const playing = toPlaying();
  // Give the finished match a real score first.
  const scored = { ...playing, scores: [2, 1] };
  const finished = leave(scored, P2, 'disconnect').state;
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.matchId, 1);
  assert.equal(finished.winner, 0);
  assert.deepEqual(finished.scores, [2, 1]);

  // The remaining member readies first, so we can prove join clears ready too.
  const readied = ready(finished, P1).state;
  assert.equal(readied.members[0].ready, true);

  const joined = join(readied, P3);
  assert.equal(joined.error, null);
  assert.deepEqual(joined.events, [{ type: 'member-joined', slot: 1 }]);
  assert.equal(joined.state.phase, 'waiting', 'the room reopens for a new match');
  assert.deepEqual(joined.state.scores, [0, 0]);
  assert.equal(joined.state.roundId, 0);
  assert.equal(joined.state.phaseTicks, 0);
  assert.equal(joined.state.matchTicks, 0);
  assert.equal(joined.state.winner, null);
  assert.equal(joined.state.finishReason, null);
  assert.equal(joined.state.matchId, 1, 'matchId is kept');
  assert.equal(joined.state.members[0].ready, false, 'join clears both ready flags');
  assert.equal(joined.state.members[1].ready, false);
});

test('a rematch increments matchId instead of resetting it', () => {
  let state = toPlaying();
  state = tick(state, [0]).state;
  state = throughIntermission(state);
  state = tick(state, [0]).state;
  state = throughIntermission(state);
  state = tick(state, [0]).state; // 0:3
  assert.equal(state.phase, 'finished');
  assert.equal(state.matchId, 1);

  // Both players ready again in the finished room.
  const first = ready(state, P1);
  assert.deepEqual(first.events, []);
  const second = ready(first.state, P2);
  assert.deepEqual(second.events, [{ type: 'countdown-started', matchId: 2 }]);
  assert.equal(second.state.phase, 'countdown');
  assert.equal(second.state.matchId, 2);
  assert.equal(second.state.roundId, 1);
  assert.deepEqual(second.state.scores, [0, 0], 'the old result does not carry over');
  assert.equal(second.state.matchTicks, 0);
  assert.equal(second.state.winner, null);
  assert.equal(second.state.finishReason, null);
});

test('waiting, finished and closed ticks are complete no-ops', () => {
  const waiting = join(room(), P1).state;
  assert.equal(tick(waiting).state, waiting);
  assert.equal(tick(waiting, [0]).state, waiting);
  assert.deepEqual(tick(waiting).events, []);

  const finished = leave(scoredPlaying(), P2, 'disconnect').state;
  assert.equal(finished.phase, 'finished');
  const doneTick = tick(finished, [0, 1]);
  assert.equal(doneTick.state, finished, 'a finished tick returns the same object');
  assert.deepEqual(doneTick.events, []);
});

/** Playing state with 2:1 on the board, used by a few finished-state tests. */
function scoredPlaying() {
  return { ...toPlaying(), scores: [2, 1] };
}

test('two independent rooms never share state', () => {
  const first = join(createDuelRoom('AAAA22'), P1).state;
  const second = join(createDuelRoom('BBBB33'), P1).state;

  assert.equal(first.code, 'AAAA22');
  assert.equal(second.code, 'BBBB33');
  assert.notEqual(first, second);

  const firstJoined = join(first, P2).state;
  assert.equal(second.members[1], null, 'the second room is untouched');

  const firstScored = tick({ ...toPlayingIn(firstJoined), matchTicks: 4 }, [0]).state;
  assert.deepEqual(firstScored.scores, [0, 1]);
  const secondPlaying = toPlayingIn(join(second, P2).state);
  assert.deepEqual(secondPlaying.scores, [0, 0]);

  // Match ids advance independently as well.
  assert.equal(firstJoined.matchId, 0);
  assert.equal(secondPlaying.matchId, 1);
});

/** Drives an arbitrary two-member waiting room into playing. */
function toPlayingIn(waiting) {
  let state = ready(waiting, P1).state;
  state = ready(state, P2).state;
  assert.equal(state.phase, 'countdown', 'helper precondition');
  return tickMany(state, countdownTicks).state;
}

test('a bounded real-progress sequence stays consistent', () => {
  const steps = { countdown: countdownTicks, toDeath: 60, intermission: intermissionTicks, nextRound: 60 };
  let state = toCountdown();
  let ticks = 0;

  const countdownPhase = tickMany(state, steps.countdown);
  ticks += steps.countdown;
  state = countdownPhase.state;
  assert.equal(state.phase, 'playing');

  const beforeDeath = tickMany(state, steps.toDeath);
  ticks += steps.toDeath;
  state = beforeDeath.state;
  assert.equal(state.matchTicks, steps.toDeath);
  assert.deepEqual(state.scores, [0, 0]);

  const death = tick(state, [0]);
  ticks += 1;
  state = death.state;
  assert.equal(state.phase, 'intermission');
  assert.deepEqual(state.scores, [0, 1]);
  assert.deepEqual(death.events, [{ type: 'round-ended', winner: 1, deadSlots: [0] }]);

  const intermissionPhase = tickMany(state, steps.intermission);
  ticks += steps.intermission;
  state = intermissionPhase.state;
  assert.equal(state.phase, 'playing');
  assert.equal(state.roundId, 2);
  assert.deepEqual(intermissionPhase.events, [{ type: 'round-started', roundId: 2 }]);

  const tail = tickMany(state, steps.nextRound);
  ticks += steps.nextRound;
  state = tail.state;
  assert.equal(state.phase, 'playing');
  assert.equal(state.roundId, 2);
  assert.equal(state.phaseTicks, steps.nextRound);
  assert.equal(state.matchTicks, steps.toDeath + 1 + steps.nextRound);
  assert.deepEqual(state.scores, [0, 1]);
  assert.ok(ticks <= 1000, `the scripted sequence stayed bounded at ${ticks} ticks`);
});
