/**
 * D14 behaviour tests — strict client message decoding and the pure token bucket.
 * Run: node --test tests/dsh/duel-protocol.test.mjs
 *
 * Rules source: docs/tasks/DSH_DUEL.md (D14). Types source: src/shared/duel-contract.ts.
 * The implementation under test is src/platform/duel-protocol.ts.
 * Boundary assertions only: no random sampling, no network, no timers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeDuelMessageBudget,
  createDuelMessageBudget,
  decodeDuelClientMessage,
} from '../../src/platform/duel-protocol.ts';
import { DUEL_NET } from '../../src/shared/duel-contract.ts';

const encoder = new TextEncoder();
const CAPACITY = DUEL_NET.bucketCapacity; // 120
const REFILL = DUEL_NET.bucketRefillPerSecond; // 60

function frame(overrides = {}) {
  return {
    seq: 1,
    yaw: 0,
    pitch: 0,
    roll: 0,
    throttle: 0,
    boost: false,
    fire: false,
    torpedo: false,
    shield: false,
    ...overrides,
  };
}

function inputMessage(frames, extra = {}) {
  return JSON.stringify({ v: 1, type: 'input', matchId: 1, roundId: 1, frames, ...extra });
}

function expectInvalid(text, label) {
  const result = decodeDuelClientMessage(text);
  assert.equal(result.ok, false, `${label}: expected a rejection`);
  assert.equal(result.error, 'invalid-message', `${label}: expected invalid-message`);
}

function expectOk(text, label) {
  const result = decodeDuelClientMessage(text);
  assert.equal(result.ok, true, `${label}: expected success, got ${JSON.stringify(result)}`);
  return result.message;
}

function closeTo(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ~${expected}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// Decoding: accepted shapes
// ---------------------------------------------------------------------------

test('every v1 client message type decodes to an exact rebuilt object', () => {
  assert.deepEqual(expectOk('{"v":1,"type":"create"}', 'create'), { v: 1, type: 'create' });
  assert.deepEqual(expectOk('{"v":1,"type":"leave"}', 'leave'), { v: 1, type: 'leave' });
  assert.deepEqual(expectOk('{"v":1,"type":"join","code":"ABCD23"}', 'join'), {
    v: 1,
    type: 'join',
    code: 'ABCD23',
  });
  assert.deepEqual(expectOk('{"v":1,"type":"ready","value":true}', 'ready true'), {
    v: 1,
    type: 'ready',
    value: true,
  });
  assert.deepEqual(expectOk('{"v":1,"type":"ready","value":false}', 'ready false'), {
    v: 1,
    type: 'ready',
    value: false,
  });
  assert.deepEqual(expectOk('{"v":1,"type":"ping","nonce":0}', 'ping low'), { v: 1, type: 'ping', nonce: 0 });
  assert.deepEqual(expectOk(`{"v":1,"type":"ping","nonce":${DUEL_NET.maxSequence}}`, 'ping high'), {
    v: 1,
    type: 'ping',
    nonce: DUEL_NET.maxSequence,
  });
});

test('an input message accepts one or two strictly increasing frames', () => {
  const single = expectOk(inputMessage([frame({ seq: 7 })]), 'single frame');
  assert.equal(single.type, 'input');
  assert.equal(single.frames.length, 1);
  assert.equal(single.frames[0].seq, 7);
  assert.deepEqual(single.frames[0], frame({ seq: 7 }));

  const double = expectOk(inputMessage([frame({ seq: 3 }), frame({ seq: 4, yaw: 1, fire: true })]), 'two frames');
  assert.equal(double.frames.length, 2);
  assert.deepEqual(double.frames[0], frame({ seq: 3 }));
  assert.equal(double.frames[1].yaw, 1);
  assert.equal(double.frames[1].fire, true);

  // Gaps in the sequence are allowed inside one packet.
  assert.equal(expectOk(inputMessage([frame({ seq: 1 }), frame({ seq: 9 })]), 'gap').frames[1].seq, 9);
  // Axis boundaries are inclusive.
  const edges = expectOk(
    inputMessage([frame({ yaw: -1, pitch: 1, roll: -1, throttle: 1 })]),
    'axis edges',
  );
  assert.equal(edges.frames[0].yaw, -1);
  assert.equal(edges.frames[0].pitch, 1);
});

test('the room code follows the same six-character alphabet rule', () => {
  for (const code of ['ABCD23', 'ZZZZZZ', '234567', 'AAAAAA']) {
    assert.equal(expectOk(`{"v":1,"type":"join","code":"${code}"}`, code).code, code);
  }
  for (const code of ['ABCD2', 'ABCD234', 'abcd23', 'AB0D23', 'ABID23', 'ABCD 3', 'ABCD23 ', '']) {
    expectInvalid(`{"v":1,"type":"join","code":${JSON.stringify(code)}}`, `code ${JSON.stringify(code)}`);
  }
  expectInvalid('{"v":1,"type":"join","code":null}', 'code null');
  expectInvalid('{"v":1,"type":"join","code":123456}', 'code number');
});

// ---------------------------------------------------------------------------
// Decoding: rejected shapes
// ---------------------------------------------------------------------------

test('the version must be the number 1', () => {
  expectInvalid('{"type":"create"}', 'missing v');
  expectInvalid('{"v":0,"type":"create"}', 'v 0');
  expectInvalid('{"v":2,"type":"create"}', 'v 2');
  expectInvalid('{"v":"1","type":"create"}', 'v string');
  expectInvalid('{"v":true,"type":"create"}', 'v boolean');
  expectInvalid('{"v":null,"type":"create"}', 'v null');
  // JSON has one numeric type: 1.0 parses to the same number as 1, so it is valid.
  assert.equal(decodeDuelClientMessage('{"v":1.0,"type":"create"}').ok, true, 'v 1.0 is the number 1');
  assert.equal(decodeDuelClientMessage('{"v":1e0,"type":"create"}').ok, true, 'v 1e0 is the number 1');
});

test('unknown or missing types are rejected', () => {
  for (const type of ['snapshot', 'welcome', 'spawn', 'hit', 'state', 'input ', 'INPUT', '', 'create ']) {
    expectInvalid(JSON.stringify({ v: 1, type }), `type ${JSON.stringify(type)}`);
  }
  expectInvalid('{"v":1}', 'missing type');
  expectInvalid('{"v":1,"type":1}', 'numeric type');
  expectInvalid('{"v":1,"type":null}', 'null type');
});

test('missing and extra fields are both rejected', () => {
  expectInvalid('{"v":1,"type":"join"}', 'join without code');
  expectInvalid('{"v":1,"type":"ready"}', 'ready without value');
  expectInvalid('{"v":1,"type":"ping"}', 'ping without nonce');
  expectInvalid('{"v":1,"type":"input","matchId":1,"roundId":1}', 'input without frames');
  expectInvalid('{"v":1,"type":"input","matchId":1,"frames":[]}', 'input without roundId');

  expectInvalid('{"v":1,"type":"create","code":"ABCD23"}', 'create with join field');
  expectInvalid('{"v":1,"type":"join","code":"ABCD23","x":1}', 'join with extra field');
  expectInvalid('{"v":1,"type":"ready","value":true,"ready":true}', 'ready with extra field');
  expectInvalid('{"v":1,"type":"ping","nonce":1,"t":2}', 'ping with extra field');
  expectInvalid('{"v":1,"type":"leave","reason":"leave"}', 'leave with extra field');
});

test('client messages may not carry server-owned state', () => {
  const frames = [frame()];
  expectInvalid(inputMessage(frames, { position: { x: 0, y: 0, z: 0 } }), 'position');
  expectInvalid(inputMessage(frames, { hit: true }), 'hit');
  expectInvalid(inputMessage(frames, { victimId: 1 }), 'victimId');
  expectInvalid(inputMessage(frames, { damage: 10 }), 'damage');
  expectInvalid(inputMessage(frames, { connectionId: 'abc' }), 'connectionId');
  expectInvalid(inputMessage(frames, { serverTick: 5 }), 'serverTick');
  expectInvalid(inputMessage(frames, { dt: 0.016 }), 'dt');
  expectInvalid(inputMessage(frames, { health: 100 }), 'health');
  expectInvalid(inputMessage(frames, { score: 3 }), 'score');
});

test('the JSON root must be an object', () => {
  for (const text of ['null', '[]', '[1]', '"create"', '1', '0', 'true', 'false', '{}']) {
    expectInvalid(text, `root ${text}`);
  }
});

test('booleans are strict, never coerced', () => {
  for (const value of [0, 1, 'true', 'false', null, [], {}]) {
    expectInvalid(JSON.stringify({ v: 1, type: 'ready', value }), `ready value ${JSON.stringify(value)}`);
  }
  for (const flag of ['boost', 'fire', 'torpedo', 'shield']) {
    for (const value of [0, 1, 'true', null]) {
      expectInvalid(inputMessage([frame({ [flag]: value })]), `${flag}=${JSON.stringify(value)}`);
    }
  }
});

test('numeric fields are never strings and never fractions', () => {
  expectInvalid('{"v":1,"type":"ping","nonce":"1"}', 'nonce string');
  expectInvalid(inputMessage([frame({ seq: '1' })]), 'seq string');
  expectInvalid(inputMessage([frame({ yaw: '0' })]), 'yaw string');
  expectInvalid(inputMessage([frame()], { matchId: '1' }), 'matchId string');
  expectInvalid(inputMessage([frame()], { roundId: '1' }), 'roundId string');
  expectInvalid(inputMessage([frame({ seq: 1.5 })]), 'seq fraction');
  expectInvalid('{"v":1,"type":"ping","nonce":1.5}', 'nonce fraction');
  expectInvalid(inputMessage([frame()], { matchId: 1.5 }), 'matchId fraction');
});

test('overflowing exponents and non-finite numbers are rejected', () => {
  expectInvalid(inputMessage([frame({ yaw: 1e999 })]), 'yaw 1e999');
  expectInvalid(inputMessage([frame({ seq: 1e999 })]), 'seq 1e999');
  expectInvalid('{"v":1,"type":"ping","nonce":1e999}', 'nonce 1e999');
  expectInvalid(inputMessage([frame()], { matchId: 1e999 }), 'matchId 1e999');
  // JSON has no NaN/Infinity literals; a raw one is invalid JSON instead.
  const raw = decodeDuelClientMessage('{"v":1,"type":"ping","nonce":NaN}');
  assert.equal(raw.ok, false);
  assert.equal(raw.error, 'bad-json');
});

test('sequences must be positive integers, ascending inside one packet', () => {
  for (const seq of [0, -1, -100]) {
    expectInvalid(inputMessage([frame({ seq })]), `seq ${seq}`);
  }
  expectInvalid(inputMessage([frame({ seq: 5 }), frame({ seq: 4 })]), 'descending');
  expectInvalid(inputMessage([frame({ seq: 5 }), frame({ seq: 5 })]), 'equal sequences');
  expectInvalid(inputMessage([frame({ seq: 2 }), frame({ seq: 2, yaw: 0.5 })]), 'duplicate sequence');
  // Out of range on the high end.
  expectInvalid(inputMessage([frame({ seq: DUEL_NET.maxSequence + 1 })]), 'seq above maximum');
});

test('match and round ids must be positive integers', () => {
  for (const matchId of [0, -1, DUEL_NET.maxSequence + 1]) {
    expectInvalid(inputMessage([frame()], { matchId }), `matchId ${matchId}`);
  }
  for (const roundId of [0, -1, DUEL_NET.maxSequence + 1]) {
    expectInvalid(inputMessage([frame()], { roundId }), `roundId ${roundId}`);
  }
  assert.equal(expectOk(inputMessage([frame()], { matchId: DUEL_NET.maxSequence }), 'max match').matchId, DUEL_NET.maxSequence);
});

test('the frames array is limited to one or two entries', () => {
  expectInvalid(inputMessage([]), 'zero frames');
  expectInvalid(inputMessage([frame({ seq: 1 }), frame({ seq: 2 }), frame({ seq: 3 })]), 'three frames');
  expectInvalid('{"v":1,"type":"input","matchId":1,"roundId":1,"frames":{}}', 'frames object');
  expectInvalid('{"v":1,"type":"input","matchId":1,"roundId":1,"frames":"x"}', 'frames string');
  expectInvalid('{"v":1,"type":"input","matchId":1,"roundId":1,"frames":null}', 'frames null');
});

test('axes must stay inside -1..1', () => {
  for (const axis of ['yaw', 'pitch', 'roll', 'throttle']) {
    expectInvalid(inputMessage([frame({ [axis]: 1.0001 })]), `${axis} above 1`);
    expectInvalid(inputMessage([frame({ [axis]: -1.0001 })]), `${axis} below -1`);
    expectInvalid(inputMessage([frame({ [axis]: 1000 })]), `${axis} way out`);
  }
});

test('frames require the complete field set', () => {
  const complete = frame();
  for (const field of Object.keys(complete)) {
    const partial = { ...complete };
    delete partial[field];
    expectInvalid(inputMessage([partial]), `frame without ${field}`);
  }
  expectInvalid(inputMessage([{ ...complete, aim: 1 }]), 'frame with extra aim');
  expectInvalid(inputMessage([{ ...complete, damage: 10 }]), 'frame with extra damage');
  expectInvalid(inputMessage([null]), 'null frame');
  expectInvalid(inputMessage([[complete]]), 'array frame');
  expectInvalid(inputMessage(['frame']), 'string frame');
});

test('prototype-smuggling keys are treated as extra fields', () => {
  // JSON.parse creates these as own properties, so they must be rejected as extras.
  expectInvalid('{"v":1,"type":"create","__proto__":{"polluted":true}}', '__proto__ extra');
  expectInvalid('{"v":1,"type":"create","constructor":{"x":1}}', 'constructor extra');
  expectInvalid('{"v":1,"type":"create","toString":1}', 'toString extra');
  expectInvalid('{"v":1,"type":"join","code":"ABCD23","__proto__":{"x":1}}', 'join __proto__ extra');

  // A frame that carries an own __proto__ key is rejected too.
  const frameWithProto = '{"v":1,"type":"input","matchId":1,"roundId":1,"frames":[{"seq":1,"yaw":0,"pitch":0,"roll":0,"throttle":0,"boost":false,"fire":false,"torpedo":false,"shield":false,"__proto__":{"x":1}}]}';
  expectInvalid(frameWithProto, 'frame __proto__');

  // Object.prototype must not have been polluted by the attempts above.
  assert.equal(Object.prototype.polluted, undefined);
});

// ---------------------------------------------------------------------------
// Decoding: size, JSON and argument handling
// ---------------------------------------------------------------------------

/** Builds a well-formed JSON string of an exact UTF-8 byte length (schema-invalid). */
function paddedCreateMessage(bytes) {
  const head = '{"v":1,"type":"create","pad":"';
  const tail = '"}';
  const fixed = encoder.encode(head).length + encoder.encode(tail).length;
  const fill = bytes - fixed;
  assert.ok(fill >= 0, `cannot build ${bytes} bytes`);
  const text = `${head}${'a'.repeat(fill)}${tail}`;
  assert.equal(encoder.encode(text).length, bytes, 'fixture byte length');
  return text;
}

test('the 8192 byte limit is measured in UTF-8 bytes and the boundary is inclusive', () => {
  const limit = DUEL_NET.maxMessageBytes;
  assert.equal(limit, 8192);

  const atLimit = paddedCreateMessage(limit);
  const boundary = decodeDuelClientMessage(atLimit);
  assert.equal(boundary.ok, false);
  assert.equal(boundary.error, 'invalid-message', 'exactly 8192 bytes still reaches schema validation');

  const overLimit = paddedCreateMessage(limit + 1);
  const over = decodeDuelClientMessage(overLimit);
  assert.equal(over.ok, false);
  assert.equal(over.error, 'too-large');

  // A tiny valid message is far below the limit.
  assert.equal(decodeDuelClientMessage('{"v":1,"type":"create"}').ok, true);
});

test('multi-byte payloads are limited by bytes, not by character count', () => {
  const head = '{"v":1,"type":"create","pad":"';
  const tail = '"}';
  const text = `${head}${'中'.repeat(2800)}${tail}`;

  assert.ok(text.length < DUEL_NET.maxMessageBytes, `character count ${text.length} is below the limit`);
  assert.ok(encoder.encode(text).length > DUEL_NET.maxMessageBytes, 'but the byte count is above it');

  const result = decodeDuelClientMessage(text);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'too-large', 'the byte budget, not the character count, decided');

  // The same payload trimmed below the byte limit reaches schema validation instead.
  const shortText = `${head}${'中'.repeat(2000)}${tail}`;
  assert.ok(encoder.encode(shortText).length < DUEL_NET.maxMessageBytes);
  assert.equal(decodeDuelClientMessage(shortText).error, 'invalid-message');
});

test('malformed JSON is reported without throwing', () => {
  for (const text of ['', '   ', '{', '}', '{"v":1,', 'not json', 'undefined', 'NaN', "{'v':1}", '{"v":1}extra']) {
    const result = decodeDuelClientMessage(text);
    assert.equal(result.ok, false, `text ${JSON.stringify(text)}`);
    assert.equal(result.error, 'bad-json', `text ${JSON.stringify(text)}`);
  }
});

test('a non-string argument is a TypeError', () => {
  for (const value of [undefined, null, 123, true, {}, [], Symbol('x')]) {
    assert.throws(() => decodeDuelClientMessage(value), TypeError, `value ${String(value)}`);
  }
});

test('decoding never shares or mutates parsed state', () => {
  const text = inputMessage([frame({ seq: 1, yaw: 0.5 }), frame({ seq: 2 })]);
  const first = decodeDuelClientMessage(text);
  const second = decodeDuelClientMessage(text);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.message, second.message, 'each decode returns a fresh object');
  assert.notEqual(first.message.frames, second.message.frames, 'each decode returns a fresh frames array');
  assert.deepEqual(first.message, second.message);

  // Mutating one result must not leak into the next decode.
  first.message.frames[0].yaw = 99;
  first.message.frames.push(frame({ seq: 3 }));
  const third = decodeDuelClientMessage(text);
  assert.equal(third.message.frames.length, 2);
  assert.equal(third.message.frames[0].yaw, 0.5);

  // The source text is a primitive and cannot be changed by the decoder.
  assert.equal(typeof text, 'string');
});

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

test('a new budget starts full at the given time', () => {
  const budget = createDuelMessageBudget(1000);
  assert.deepEqual(budget, { tokens: CAPACITY, lastMs: 1000 });
  assert.equal(CAPACITY, 120);
  assert.equal(REFILL, 60);
});

test('the budget constructor rejects illegal times', () => {
  for (const nowMs of [-1, -0.001, Number.NaN, Infinity, -Infinity, '0', null, undefined, {}]) {
    assert.throws(() => createDuelMessageBudget(nowMs), RangeError, `nowMs ${String(nowMs)}`);
  }
  assert.doesNotThrow(() => createDuelMessageBudget(0));
  assert.doesNotThrow(() => createDuelMessageBudget(0.5));
});

test('consuming defaults to a cost of one and drains the bucket', () => {
  let budget = createDuelMessageBudget(0);
  const drained = consumeDuelMessageBudget(budget, 0, CAPACITY);
  assert.equal(drained.allowed, true);
  assert.equal(drained.state.tokens, 0);
  assert.equal(drained.state.lastMs, 0);
  budget = drained.state;

  const refused = consumeDuelMessageBudget(budget, 0);
  assert.equal(refused.allowed, false, 'an empty bucket refuses immediately');
  assert.equal(refused.state.tokens, 0);
  assert.equal(refused.state.lastMs, 0, 'lastMs still advances (it was already 0)');

  // Default cost is 1, not 0: from full, one consume leaves 119.
  const one = consumeDuelMessageBudget(createDuelMessageBudget(0), 0);
  assert.equal(one.allowed, true);
  assert.equal(one.state.tokens, CAPACITY - 1);
});

test('tokens refill at 60 per second and are capped at capacity', () => {
  const empty = { tokens: 0, lastMs: 0 };

  const afterOneSecond = consumeDuelMessageBudget(empty, 1000, 1);
  assert.equal(afterOneSecond.allowed, true);
  closeTo(afterOneSecond.state.tokens, 60 - 1, 'one second of refill minus the cost');

  const capped = consumeDuelMessageBudget(empty, 100000, 1);
  assert.equal(capped.allowed, true);
  assert.equal(capped.state.tokens, CAPACITY - 1, 'a long idle period cannot exceed capacity');

  const exactCap = consumeDuelMessageBudget({ tokens: 100, lastMs: 0 }, 100000, 1);
  assert.equal(exactCap.state.tokens, CAPACITY - 1);
});

test('exact-cost recovery is allowed and float error is tolerated', () => {
  // 20 ms at 60/s is exactly 1.2 tokens, enough for a 1-token message.
  const twentyMs = consumeDuelMessageBudget({ tokens: 0, lastMs: 0 }, 20, 1);
  assert.equal(twentyMs.allowed, true);
  closeTo(twentyMs.state.tokens, 0.2, '1.2 refilled minus 1 spent');

  // A hair under a whole token is accepted thanks to the 1e-9 tolerance.
  const almost = consumeDuelMessageBudget({ tokens: 0.9999999995, lastMs: 0 }, 0, 1);
  assert.equal(almost.allowed, true, '0.9999999995 + 1e-9 clears a cost of 1');
  assert.equal(almost.state.tokens, 0);

  // Clearly short is refused.
  const short = consumeDuelMessageBudget({ tokens: 0.99, lastMs: 0 }, 0, 1);
  assert.equal(short.allowed, false);
});

test('a rejection still advances the clock and keeps the refilled tokens', () => {
  const state = { tokens: 0, lastMs: 0 };
  const refused = consumeDuelMessageBudget(state, 0.5, 5); // 0.03 tokens available
  assert.equal(refused.allowed, false);
  assert.equal(refused.state.lastMs, 0.5, 'the clock advances even on rejection');
  closeTo(refused.state.tokens, 0.03, 'the refilled amount is kept');

  // The next call refills from the new timestamp, not from the old one.
  const next = consumeDuelMessageBudget(refused.state, 1000.5, 1);
  assert.equal(next.allowed, true);
  closeTo(next.state.tokens, 60.03 - 1, 'refill continues from the updated lastMs');
});

test('the admission cost of 20 is chargeable in one call', () => {
  const budget = createDuelMessageBudget(0);
  const create = consumeDuelMessageBudget(budget, 0, DUEL_NET.admissionCost);
  assert.equal(DUEL_NET.admissionCost, 20);
  assert.equal(create.allowed, true);
  assert.equal(create.state.tokens, CAPACITY - 20);

  // Six admissions drain the bucket exactly.
  let state = createDuelMessageBudget(0);
  let allowedCount = 0;
  let ms = 0;
  for (let index = 0; index < 6; index += 1) {
    const step = consumeDuelMessageBudget(state, ms, 20);
    if (step.allowed) allowedCount += 1;
    state = step.state;
    ms += 1;
  }
  assert.equal(allowedCount, 6, '120 tokens pay for six admissions');
  assert.equal(state.tokens < 20, true);

  const seventh = consumeDuelMessageBudget(state, ms, 20);
  assert.equal(seventh.allowed, false, 'the seventh admission is refused');
});

test('illegal costs and backwards clocks raise RangeError without touching the state', () => {
  const state = Object.freeze({ tokens: 50, lastMs: 1000 });
  for (const cost of [0, -1, 121, 1000, 1.5, Number.NaN, Infinity, -Infinity, '1', null, {}, []]) {
    assert.throws(() => consumeDuelMessageBudget(state, 1000, cost), RangeError, `cost ${String(cost)}`);
  }
  for (const nowMs of [999.999, 0, -1, Number.NaN, Infinity, '1000', null, undefined]) {
    assert.throws(() => consumeDuelMessageBudget(state, nowMs, 1), RangeError, `nowMs ${String(nowMs)}`);
  }
  assert.deepEqual(state, { tokens: 50, lastMs: 1000 }, 'the frozen input state is untouched');
});

test('an equal timestamp is accepted and yields no refill', () => {
  const step = consumeDuelMessageBudget({ tokens: 2, lastMs: 500 }, 500, 1);
  assert.equal(step.allowed, true);
  assert.equal(step.state.tokens, 1);
  assert.equal(step.state.lastMs, 500);
});

test('two connections hold independent buckets', () => {
  let first = createDuelMessageBudget(0);
  let second = createDuelMessageBudget(0);

  first = consumeDuelMessageBudget(first, 0, CAPACITY).state;
  assert.equal(first.tokens, 0);
  assert.equal(second.tokens, CAPACITY, 'the second bucket is untouched');

  second = consumeDuelMessageBudget(second, 0, 20).state;
  assert.equal(second.tokens, 100);
  assert.equal(first.tokens, 0);

  const firstRefill = consumeDuelMessageBudget(first, 1000, 1);
  assert.equal(firstRefill.allowed, true);
  assert.equal(second.tokens, 100, 'refilling one bucket does not refill the other');
});

test('budget steps return new objects and never mutate the input', () => {
  const state = Object.freeze({ tokens: 120, lastMs: 0 });
  const step = consumeDuelMessageBudget(state, 10, 20);
  assert.notEqual(step.state, state, 'a new state object is returned');
  assert.deepEqual(state, { tokens: 120, lastMs: 0 });
  assert.equal(step.allowed, true);
  // A full bucket is capped at 120, so the 0.6 tokens of refill cannot be banked.
  assert.equal(step.state.tokens, 100, 'capacity first, then the cost');
  assert.equal(step.state.lastMs, 10);

  // From below capacity the same 0.6 tokens do apply.
  const partial = consumeDuelMessageBudget(Object.freeze({ tokens: 50, lastMs: 0 }), 10, 20);
  closeTo(partial.state.tokens, 30.6, '50 + 0.6 refill - 20');
});
