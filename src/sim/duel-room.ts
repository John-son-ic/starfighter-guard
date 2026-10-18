/**
 * D13 — pure room / round / score state machine for duel v1.
 *
 * One call advances exactly one command. No DOM, no Three.js, no network, no wall
 * clock, no timers, no randomness: every duration is an integer tick supplied by the
 * caller. Inputs (state and command, including nested arrays) are never modified.
 *
 * Rules source: docs/tasks/DSH_DUEL.md (D13) and docs/DUEL_MODE.md.
 * Types source: src/shared/duel-contract.ts (not modified by this module).
 */
import type {
  DuelFinishReason,
  DuelMember,
  DuelPair,
  DuelRoomCommand,
  DuelRoomError,
  DuelRoomEvent,
  DuelRoomState,
  DuelRoomStep,
  DuelSlot,
} from '../shared/duel-contract.ts';
import { DUEL_ROOM_ALPHABET, DUEL_RULES } from '../shared/duel-contract.ts';

const CODE_LENGTH = 6;
/** 1..64 ASCII letters, digits, underscore or hyphen. */
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function failRange(what: string, detail: string): never {
  throw new RangeError(`duel-room: ${what} ${detail}`);
}

function assertCode(code: unknown): string {
  if (typeof code !== 'string') failRange('code', 'must be a string');
  const text = code as string;
  if (text.length !== CODE_LENGTH) failRange('code', `must be exactly ${CODE_LENGTH} characters, received ${text.length}`);
  for (const character of text) {
    if (!DUEL_ROOM_ALPHABET.includes(character)) {
      failRange('code', `may only use DUEL_ROOM_ALPHABET characters, received ${JSON.stringify(character)}`);
    }
  }
  return text;
}

function assertConnectionId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CONNECTION_ID_PATTERN.test(value)) {
    failRange(field, 'must be 1..64 characters of A-Z, a-z, 0-9, "_" or "-"');
  }
  return value as string;
}

/**
 * Validates a command at runtime. Field problems are RangeError; an unknown type is
 * TypeError. Validation happens before any terminal-state decision, so a malformed
 * command is always reported as a programming error rather than a business error.
 */
function assertCommand(command: DuelRoomCommand): DuelRoomCommand {
  if (command === null || typeof command !== 'object' || Array.isArray(command)) {
    throw new TypeError('duel-room: command must be an object');
  }
  const type: unknown = (command as { readonly type?: unknown }).type;
  switch (type) {
    case 'join':
      return { type: 'join', connectionId: assertConnectionId((command as { connectionId?: unknown }).connectionId, 'join.connectionId') };
    case 'ready': {
      const value: unknown = (command as { value?: unknown }).value;
      if (typeof value !== 'boolean') failRange('ready.value', 'must be a boolean');
      return {
        type: 'ready',
        connectionId: assertConnectionId((command as { connectionId?: unknown }).connectionId, 'ready.connectionId'),
        value: value as boolean,
      };
    }
    case 'leave': {
      const reason: unknown = (command as { reason?: unknown }).reason;
      if (reason !== 'leave' && reason !== 'disconnect') failRange('leave.reason', 'must be "leave" or "disconnect"');
      return {
        type: 'leave',
        connectionId: assertConnectionId((command as { connectionId?: unknown }).connectionId, 'leave.connectionId'),
        reason: reason as 'leave' | 'disconnect',
      };
    }
    case 'tick': {
      const deadSlots: unknown = (command as { deadSlots?: unknown }).deadSlots;
      if (!Array.isArray(deadSlots)) failRange('tick.deadSlots', 'must be an array of 0..2 slots');
      const slots = deadSlots as readonly unknown[];
      if (slots.length > 2) failRange('tick.deadSlots', `must hold at most 2 slots, received ${slots.length}`);
      const seen = new Set<number>();
      for (const slot of slots) {
        if (slot !== 0 && slot !== 1) failRange('tick.deadSlots', `entries must be 0 or 1, received ${String(slot)}`);
        if (seen.has(slot as number)) failRange('tick.deadSlots', `must not repeat slot ${String(slot)}`);
        seen.add(slot as number);
      }
      return { type: 'tick', deadSlots: slots as readonly DuelSlot[] };
    }
    default:
      throw new TypeError(`duel-room: unknown command type ${JSON.stringify(type)}`);
  }
}

function slotOf(state: DuelRoomState, connectionId: string): DuelSlot | null {
  if (state.members[0]?.connectionId === connectionId) return 0;
  if (state.members[1]?.connectionId === connectionId) return 1;
  return null;
}

function firstFreeSlot(state: DuelRoomState): DuelSlot | null {
  if (state.members[0] === null) return 0;
  if (state.members[1] === null) return 1;
  return null;
}

function withSlot<T>(pair: DuelPair<T>, slot: DuelSlot, value: T): DuelPair<T> {
  return slot === 0 ? [value, pair[1]] : [pair[0], value];
}

function clearReady(members: DuelPair<DuelMember | null>): DuelPair<DuelMember | null> {
  const [first, second] = members;
  return [
    first === null ? null : { connectionId: first.connectionId, ready: false },
    second === null ? null : { connectionId: second.connectionId, ready: false },
  ];
}

function bothReady(members: DuelPair<DuelMember | null>): boolean {
  return members[0] !== null && members[1] !== null && members[0].ready && members[1].ready;
}

function scoreFor(scores: DuelPair<number>, slot: DuelSlot): DuelPair<number> {
  return slot === 0 ? [scores[0] + 1, scores[1]] : [scores[0], scores[1] + 1];
}

function step(state: DuelRoomState, events: readonly DuelRoomEvent[], error: DuelRoomError | null = null): DuelRoomStep {
  return { state, events, error };
}

function reject(state: DuelRoomState, error: DuelRoomError): DuelRoomStep {
  return { state, events: [], error };
}

/** Creates the initial waiting room. Throws RangeError for an illegal room code. */
export function createDuelRoom(code: string): DuelRoomState {
  return {
    code: assertCode(code),
    phase: 'waiting',
    members: [null, null],
    scores: [0, 0],
    matchId: 0,
    roundId: 0,
    phaseTicks: 0,
    matchTicks: 0,
    winner: null,
    finishReason: null,
  };
}

function reduceJoin(state: DuelRoomState, connectionId: string): DuelRoomStep {
  // Check order is fixed by the task book: duplicate, then capacity, then phase.
  if (slotOf(state, connectionId) !== null) return reject(state, 'already-member');
  const free = firstFreeSlot(state);
  if (free === null) return reject(state, 'room-full');
  if (state.phase !== 'waiting' && state.phase !== 'finished') return reject(state, 'room-busy');

  const members = clearReady(withSlot(state.members, free, { connectionId, ready: false }));
  const joined: DuelRoomEvent = { type: 'member-joined', slot: free };

  if (state.phase === 'finished') {
    // A new member cancels the old result: nobody is carried into the finished match.
    return step(
      {
        ...state,
        phase: 'waiting',
        members,
        scores: [0, 0],
        roundId: 0,
        phaseTicks: 0,
        matchTicks: 0,
        winner: null,
        finishReason: null,
      },
      [joined],
    );
  }
  return step({ ...state, members }, [joined]);
}

function reduceReady(state: DuelRoomState, connectionId: string, value: boolean): DuelRoomStep {
  const slot = slotOf(state, connectionId);
  if (slot === null) return reject(state, 'not-member');
  if (state.phase !== 'waiting' && state.phase !== 'finished') return reject(state, 'not-ready-phase');

  const member = state.members[slot];
  if (member === null) return reject(state, 'not-member');
  if (member.ready === value) return step(state, []);

  const members = withSlot(state.members, slot, { connectionId: member.connectionId, ready: value });
  if (!bothReady(members)) return step({ ...state, members }, []);

  const matchId = state.matchId + 1;
  return step(
    {
      ...state,
      members,
      phase: 'countdown',
      matchId,
      roundId: 1,
      scores: [0, 0],
      phaseTicks: 0,
      matchTicks: 0,
      winner: null,
      finishReason: null,
    },
    [{ type: 'countdown-started', matchId }],
  );
}

function reduceLeave(state: DuelRoomState, connectionId: string, reason: 'leave' | 'disconnect'): DuelRoomStep {
  const slot = slotOf(state, connectionId);
  if (slot === null) return reject(state, 'not-member');

  const otherSlot: DuelSlot = slot === 0 ? 1 : 0;
  const other = state.members[otherSlot];
  const members = clearReady(withSlot(state.members, slot, null));
  const left: DuelRoomEvent = { type: 'member-left', slot };

  if (other === null) {
    // Last member gone: close the room and keep the historical scores and result.
    return step({ ...state, members, phase: 'closed', phaseTicks: 0 }, [left, { type: 'room-closed' }]);
  }

  switch (state.phase) {
    case 'waiting':
    case 'countdown':
      // Cancelling a match that never started: drop scores and timers, keep matchId.
      return step(
        {
          ...state,
          members,
          phase: 'waiting',
          scores: [0, 0],
          roundId: 0,
          phaseTicks: 0,
          matchTicks: 0,
          winner: null,
          finishReason: null,
        },
        [left],
      );
    case 'playing':
    case 'intermission':
      // The remaining player wins; no invented kills or points.
      return step(
        { ...state, members, phase: 'finished', phaseTicks: 0, winner: otherSlot, finishReason: reason },
        [left, { type: 'match-finished', winner: otherSlot, reason }],
      );
    case 'finished':
      // Keep the finished result and never re-emit match-finished.
      return step({ ...state, members }, [left]);
    default:
      return step({ ...state, members, phase: 'closed', phaseTicks: 0 }, [left, { type: 'room-closed' }]);
  }
}

function reduceTick(state: DuelRoomState, deadSlots: readonly DuelSlot[]): DuelRoomStep {
  switch (state.phase) {
    case 'waiting':
    case 'finished':
    case 'closed':
      // Valid tick in these phases is a complete no-op.
      return step(state, []);

    case 'countdown': {
      const phaseTicks = state.phaseTicks + 1;
      if (phaseTicks < DUEL_RULES.countdownTicks) return step({ ...state, phaseTicks }, []);
      // Reach the countdown exactly once; the new playing phase is not advanced here.
      return step({ ...state, phase: 'playing', phaseTicks: 0 }, [{ type: 'round-started', roundId: state.roundId }]);
    }

    case 'intermission': {
      const phaseTicks = state.phaseTicks + 1;
      if (phaseTicks < DUEL_RULES.intermissionTicks) return step({ ...state, phaseTicks }, []);
      const roundId = state.roundId + 1;
      return step({ ...state, phase: 'playing', roundId, phaseTicks: 0 }, [{ type: 'round-started', roundId }]);
    }

    case 'playing':
      return reducePlaying(state, deadSlots);

    default:
      return step(state, []);
  }
}

function reducePlaying(state: DuelRoomState, deadSlots: readonly DuelSlot[]): DuelRoomStep {
  const phaseTicks = state.phaseTicks + 1;
  const matchTicks = state.matchTicks + 1;
  const events: DuelRoomEvent[] = [];
  // Ascending copy for the event; never reuse or reorder the caller's array.
  const dead = [...deadSlots].sort((left, right) => left - right);

  let scores = state.scores;
  if (dead.length === 1) {
    const scorer: DuelSlot = dead[0] === 0 ? 1 : 0;
    scores = scoreFor(state.scores, scorer);
    events.push({ type: 'round-ended', winner: scorer, deadSlots: dead });
  } else if (dead.length === 2) {
    // Both die on the same tick: a draw, so nobody scores.
    events.push({ type: 'round-ended', winner: null, deadSlots: dead });
  }

  // Score win is decided before the time limit, using the already-updated scores.
  const scorerWinner: DuelSlot | null =
    scores[0] >= DUEL_RULES.scoreToWin ? 0 : scores[1] >= DUEL_RULES.scoreToWin ? 1 : null;

  let finishWinner: DuelSlot | null = null;
  let finishReason: DuelFinishReason | null = null;
  if (scorerWinner !== null) {
    finishWinner = scorerWinner;
    finishReason = 'score';
  } else if (matchTicks >= DUEL_RULES.matchLimitTicks) {
    finishWinner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
    finishReason = 'time-limit';
  }

  if (finishReason !== null) {
    // Same-tick order is round-ended -> match-finished.
    events.push({ type: 'match-finished', winner: finishWinner, reason: finishReason });
    return step(
      {
        ...state,
        phase: 'finished',
        members: clearReady(state.members),
        scores,
        phaseTicks: 0,
        matchTicks,
        winner: finishWinner,
        finishReason,
      },
      events,
    );
  }

  if (dead.length > 0) {
    // Intermission: keep matchTicks, do not bump roundId, and never re-score.
    return step({ ...state, phase: 'intermission', scores, phaseTicks: 0, matchTicks }, events);
  }

  return step({ ...state, scores, phaseTicks, matchTicks }, []);
}

/**
 * Advances one command. Business rejections return the original state with an empty
 * event list and an error; successes return `error: null`.
 */
export function reduceDuelRoom(state: DuelRoomState, command: DuelRoomCommand): DuelRoomStep {
  const valid = assertCommand(command);

  if (state.phase === 'closed') {
    // Valid ticks stay stable; every other command is refused by the closed room.
    if (valid.type === 'tick') return step(state, []);
    return reject(state, 'room-closed');
  }

  switch (valid.type) {
    case 'join':
      return reduceJoin(state, valid.connectionId);
    case 'ready':
      return reduceReady(state, valid.connectionId, valid.value);
    case 'leave':
      return reduceLeave(state, valid.connectionId, valid.reason);
    case 'tick':
      return reduceTick(state, valid.deadSlots);
    default:
      return step(state, []);
  }
}
