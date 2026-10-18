/**
 * D14 — client message decoding and the pure token bucket.
 *
 * Scope (docs/tasks/DSH_DUEL.md / docs/DUEL_MODE.md):
 *   - decode only client -> server v1 messages, strictly and completely;
 *   - enforce the 8192 UTF-8 byte limit before parsing;
 *   - provide a pure refill bucket with no timers, waits or I/O.
 *
 * No network, no WebSocket, no DOM, no Node-only APIs, no wall clock: callers pass
 * `nowMs`, so the same code runs in the browser and on the server.
 * Types come from src/shared/duel-contract.ts (not modified here).
 */
import type {
  DuelBudgetStep,
  DuelClientMessage,
  DuelDecodeResult,
  DuelInputFrame,
  DuelMessageBudget,
} from '../shared/duel-contract.ts';
import { DUEL_NET, DUEL_PROTOCOL_VERSION, DUEL_ROOM_ALPHABET } from '../shared/duel-contract.ts';

const ROOM_CODE_LENGTH = 6;
/** Allowed own keys per message type; anything else means the message is invalid. */
const MESSAGE_FIELDS = Object.freeze({
  create: Object.freeze(['v', 'type']),
  leave: Object.freeze(['v', 'type']),
  join: Object.freeze(['v', 'type', 'code']),
  ready: Object.freeze(['v', 'type', 'value']),
  ping: Object.freeze(['v', 'type', 'nonce']),
  input: Object.freeze(['v', 'type', 'matchId', 'roundId', 'frames']),
});
const FRAME_FIELDS = Object.freeze([
  'seq',
  'yaw',
  'pitch',
  'roll',
  'throttle',
  'boost',
  'fire',
  'torpedo',
  'shield',
]);
const AXIS_FIELDS = Object.freeze(['yaw', 'pitch', 'roll', 'throttle']);
const FLAG_FIELDS = Object.freeze(['boost', 'fire', 'torpedo', 'shield']);
/** Absorbs float error when comparing an exact-cost refill against the cost. */
const BUDGET_EPSILON = 1e-9;

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True when the object's own keys are exactly `expected`. Extra keys (including
 * `__proto__` and `constructor`) and missing keys both fail. Own-property names are
 * used so no inherited or prototype value can ever be read as a field.
 */
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const own = Object.getOwnPropertyNames(value);
  if (own.length !== expected.length) return false;
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isUnitAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

function isRoomCode(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== ROOM_CODE_LENGTH) return false;
  for (const character of value) {
    if (!DUEL_ROOM_ALPHABET.includes(character)) return false;
  }
  return true;
}

function toFrame(value: unknown): DuelInputFrame | null {
  if (!isPlainRecord(value)) return null;
  if (!hasExactKeys(value, FRAME_FIELDS)) return null;

  const seq = value['seq'];
  if (!isIntegerInRange(seq, 1, DUEL_NET.maxSequence)) return null;

  for (const axis of AXIS_FIELDS) {
    if (!isUnitAxis(value[axis])) return null;
  }
  for (const flag of FLAG_FIELDS) {
    if (typeof value[flag] !== 'boolean') return null;
  }

  return {
    seq,
    yaw: value['yaw'] as number,
    pitch: value['pitch'] as number,
    roll: value['roll'] as number,
    throttle: value['throttle'] as number,
    boost: value['boost'] as boolean,
    fire: value['fire'] as boolean,
    torpedo: value['torpedo'] as boolean,
    shield: value['shield'] as boolean,
  };
}

/** Returns a fully rebuilt message, or null when the shape is not accepted. */
function toClientMessage(value: unknown): DuelClientMessage | null {
  if (!isPlainRecord(value)) return null;

  const type = value['type'];
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'create':
    case 'leave': {
      if (!hasExactKeys(value, MESSAGE_FIELDS[type])) return null;
      if (value['v'] !== DUEL_PROTOCOL_VERSION) return null;
      return type === 'create' ? { v: 1, type: 'create' } : { v: 1, type: 'leave' };
    }
    case 'join': {
      if (!hasExactKeys(value, MESSAGE_FIELDS.join)) return null;
      if (value['v'] !== DUEL_PROTOCOL_VERSION) return null;
      const code = value['code'];
      if (!isRoomCode(code)) return null;
      return { v: 1, type: 'join', code };
    }
    case 'ready': {
      if (!hasExactKeys(value, MESSAGE_FIELDS.ready)) return null;
      if (value['v'] !== DUEL_PROTOCOL_VERSION) return null;
      const ready = value['value'];
      if (typeof ready !== 'boolean') return null;
      return { v: 1, type: 'ready', value: ready };
    }
    case 'ping': {
      if (!hasExactKeys(value, MESSAGE_FIELDS.ping)) return null;
      if (value['v'] !== DUEL_PROTOCOL_VERSION) return null;
      const nonce = value['nonce'];
      if (!isIntegerInRange(nonce, 0, DUEL_NET.maxSequence)) return null;
      return { v: 1, type: 'ping', nonce };
    }
    case 'input': {
      if (!hasExactKeys(value, MESSAGE_FIELDS.input)) return null;
      if (value['v'] !== DUEL_PROTOCOL_VERSION) return null;
      const matchId = value['matchId'];
      const roundId = value['roundId'];
      if (!isIntegerInRange(matchId, 1, DUEL_NET.maxSequence)) return null;
      if (!isIntegerInRange(roundId, 1, DUEL_NET.maxSequence)) return null;

      const rawFrames = value['frames'];
      if (!Array.isArray(rawFrames)) return null;
      if (rawFrames.length < 1 || rawFrames.length > DUEL_NET.maxFramesPerMessage) return null;

      const frames: DuelInputFrame[] = [];
      let previousSeq = Number.NEGATIVE_INFINITY;
      for (const rawFrame of rawFrames) {
        const frame = toFrame(rawFrame);
        if (frame === null) return null;
        // Within one packet the sequence must strictly increase; gaps are allowed.
        if (frame.seq <= previousSeq) return null;
        previousSeq = frame.seq;
        frames.push(frame);
      }
      return { v: 1, type: 'input', matchId, roundId, frames };
    }
    default:
      return null;
  }
}

/**
 * Decodes one client message. Returns a tagged result instead of throwing for data
 * problems; only a non-string argument is a programming error (TypeError).
 */
export function decodeDuelClientMessage(text: string): DuelDecodeResult {
  if (typeof text !== 'string') throw new TypeError('duel-protocol: text must be a string');

  // Byte length first: a multi-byte payload must not sneak past a character count.
  if (utf8Length(text) > DUEL_NET.maxMessageBytes) return { ok: false, error: 'too-large' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'bad-json' };
  }

  const message = toClientMessage(parsed);
  if (message === null) return { ok: false, error: 'invalid-message' };
  return { ok: true, message };
}

/** Creates a full bucket starting at `nowMs`. */
export function createDuelMessageBudget(nowMs: number): DuelMessageBudget {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError('duel-protocol: nowMs must be a finite number >= 0');
  }
  return { tokens: DUEL_NET.bucketCapacity, lastMs: nowMs };
}

/**
 * Consumes `cost` tokens after refilling at 60/s, capped at the bucket capacity.
 * A rejection still advances `lastMs`, and the input state is never modified.
 */
export function consumeDuelMessageBudget(
  state: DuelMessageBudget,
  nowMs: number,
  cost = 1,
): DuelBudgetStep {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new RangeError('duel-protocol: nowMs must be a finite number');
  }
  if (nowMs < state.lastMs) {
    throw new RangeError('duel-protocol: nowMs must not move backwards');
  }
  if (!Number.isInteger(cost) || cost < 1 || cost > DUEL_NET.bucketCapacity) {
    throw new RangeError(`duel-protocol: cost must be an integer in 1..${DUEL_NET.bucketCapacity}`);
  }

  const refilled = state.tokens + ((nowMs - state.lastMs) * DUEL_NET.bucketRefillPerSecond) / 1000;
  const available = Math.min(DUEL_NET.bucketCapacity, refilled);
  const allowed = available + BUDGET_EPSILON >= cost;
  const tokens = allowed ? Math.max(0, available - cost) : available;

  return { state: { tokens, lastMs: nowMs }, allowed };
}
