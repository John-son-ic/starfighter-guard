/**
 * D15 — independent black-box regression for the duel WebSocket service.
 * Run: node --test tests/dsh/duel-server-regression.test.mjs
 *
 * Scope (docs/tasks/DSH_DUEL_SERVER.md):
 *   admission budget, fragment/encoding limits, countdown withdrawal and replacement,
 *   explicit origins and the connection cap, rejected-sequence integrity,
 *   automatic-mode catch-up bounds, and close/port/timer hygiene.
 *
 * Only the frozen API from docs/DUEL_SERVER.md is used: createDuelServer(...).listen/
 * close/advance/maintain/stats over a real loopback socket. Nothing reaches into
 * server internals, no state is forged, and every server listens on 127.0.0.1 only.
 * Complements tests/duel-server.test.mjs rather than repeating it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { WebSocket } from 'ws';
import { createDuelServer } from '../../src/server/duel-server.ts';
import { decodeDuelCollision } from '../../src/sim/duel-collision.ts';

const HOST = '127.0.0.1';
const WAIT_MS = 3000;
const COUNTDOWN_TICKS = 180;

const collisionBytes = readFileSync(new URL('../../public/collision/venator-duel.bin', import.meta.url));
const collider = decodeDuelCollision(
  collisionBytes.buffer.slice(collisionBytes.byteOffset, collisionBytes.byteOffset + collisionBytes.byteLength),
);

let nonceSeed = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Bounded polling: every wait in this file gives up after WAIT_MS. */
async function waitUntil(predicate, label, timeout = WAIT_MS) {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** Starts a manual-mode server on an ephemeral loopback port with a frozen clock. */
async function startServer(t, options = {}) {
  const clock = { ms: 0 };
  const app = createDuelServer({
    host: HOST,
    port: 0,
    automatic: false,
    collider,
    nowMs: () => clock.ms,
    ...options,
  });
  const address = await app.listen();
  t.after(async () => {
    await app.close().catch(() => undefined);
  });
  return { app, address, clock };
}

/** Real WebSocket client that records every message and its close outcome from the start. */
async function openClient(t, address, { origin = address.origin, ...socketOptions } = {}) {
  const ws = new WebSocket(address.wsUrl, { origin, ...socketOptions });
  const inbox = [];
  const close = { closed: false, code: null, reason: '' };
  ws.on('message', (raw) => {
    inbox.push(JSON.parse(raw.toString()));
  });
  ws.on('close', (code, reason) => {
    close.closed = true;
    close.code = code;
    close.reason = reason.toString();
  });
  ws.on('error', () => undefined);
  t.after(() => ws.terminate());
  await once(ws, 'open', { signal: AbortSignal.timeout(WAIT_MS) });

  const client = {
    ws,
    inbox,
    close,
    send(message) {
      ws.send(JSON.stringify({ v: 1, ...message }));
    },
    sendRaw(data, options) {
      ws.send(data, options);
    },
    find(predicate, from = 0) {
      return inbox.slice(from).find(predicate);
    },
    waitFor(predicate, from = 0, label = 'message') {
      const found = inbox.slice(from).find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timed out waiting for ${label}`));
        }, WAIT_MS);
        const onMessage = () => {
          const hit = inbox.slice(from).find(predicate);
          if (hit) {
            cleanup();
            resolve(hit);
          }
        };
        const onClose = () => {
          const hit = inbox.slice(from).find(predicate);
          cleanup();
          if (hit) resolve(hit);
          else reject(new Error(`socket closed while waiting for ${label}`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          ws.off('message', onMessage);
          ws.off('close', onClose);
        };
        ws.on('message', onMessage);
        ws.on('close', onClose);
      });
    },
    waitClose() {
      if (close.closed) return Promise.resolve(close);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('timed out waiting for close'));
        }, WAIT_MS);
        const onClose = () => {
          cleanup();
          resolve(close);
        };
        const cleanup = () => {
          clearTimeout(timer);
          ws.off('close', onClose);
        };
        ws.on('close', onClose);
      });
    },
    request(message, predicate, label) {
      const mark = inbox.length;
      client.send(message);
      return client.waitFor(predicate, mark, label ?? message.type);
    },
    sync() {
      const nonce = ++nonceSeed;
      return client.request({ type: 'ping', nonce }, (m) => m.type === 'pong' && m.nonce === nonce, 'pong');
    },
    lastSnapshot() {
      return inbox.findLast((m) => m.type === 'snapshot');
    },
  };
  return client;
}

/** Independent upgrade attempt: resolves {ok:true, ws} or {ok:false, status}. */
function tryUpgrade(address, { origin } = {}, path = '/ws') {
  return new Promise((resolve, reject) => {
    const options = origin === undefined ? {} : { origin };
    const ws = new WebSocket(address.wsUrl.replace('/ws', path), options);
    ws.on('error', () => undefined);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('upgrade attempt timed out'));
    }, WAIT_MS);
    ws.on('unexpected-response', (request, response) => {
      clearTimeout(timer);
      response.resume();
      request.destroy();
      ws.terminate();
      resolve({ ok: false, status: response.statusCode });
    });
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ok: true, ws });
    });
  });
}

async function upgradeStatus(address, options) {
  const result = await tryUpgrade(address, options);
  assert.equal(result.ok, false, 'the upgrade must be refused');
  return result.status;
}

/** Two real clients with one waiting room; caller drive ready/advance itself. */
async function twoPlayers(t, options = {}) {
  const env = await startServer(t, options);
  const a = await openClient(t, env.address);
  const b = await openClient(t, env.address);
  const welcomeA = await a.request({ type: 'create' }, (m) => m.type === 'welcome', 'create welcome');
  await b.request({ type: 'join', code: welcomeA.code }, (m) => m.type === 'welcome', 'join welcome');
  return { ...env, a, b, code: welcomeA.code };
}

const NEUTRAL_FRAME = Object.freeze({
  seq: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  throttle: 0,
  boost: false,
  fire: false,
  torpedo: false,
  shield: false,
});

function frameAt(seq) {
  return { ...NEUTRAL_FRAME, seq };
}

function inputPacket(snapshot, frames) {
  return { type: 'input', matchId: snapshot.matchId, roundId: snapshot.roundId, frames };
}

// ---------------------------------------------------------------------------
// 1. Admission budget and base cost
// ---------------------------------------------------------------------------

test('one connection is charged 20 per admission, and the seventh attempt is fatal', async (t) => {
  const env = await startServer(t);
  const client = await openClient(t, env.address);

  // Six failed joins of a nonexistent room still cost 20 each: 6 * 20 = 120 = capacity.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const error = await client.request(
      { type: 'join', code: 'ZZZZZZ' },
      (m) => m.type === 'error',
      `admission error ${attempt}`,
    );
    assert.equal(error.error, 'room-not-found', `attempt ${attempt} reached the room lookup`);
    assert.equal(error.fatal, false, `attempt ${attempt} is a business error, not a ban`);
    assert.equal(env.app.stats().connections, 1, `attempt ${attempt} used the same connection`);
    assert.equal(env.app.stats().rooms, 0);
  }

  const mark = client.inbox.length;
  client.send({ type: 'join', code: 'ZZZZZZ' });
  const limited = await client.waitFor((m) => m.type === 'error', mark, 'rate limit');
  assert.equal(limited.error, 'rate-limited');
  assert.equal(limited.fatal, true);

  const closed = await client.waitClose();
  assert.ok(closed.closed, 'a fatal rate limit closes the connection');
  await waitUntil(() => env.app.stats().connections === 0, 'the limited session to leave');
});

test('the base cost is one token per message and malformed messages are charged too', async (t) => {
  const env = await startServer(t);

  // 120 pings exactly drain a full bucket (120 tokens at 1 each).
  const pingOnly = await openClient(t, env.address);
  for (let index = 0; index < 120; index += 1) pingOnly.send({ type: 'ping', nonce: index });
  await waitUntil(
    () => pingOnly.inbox.filter((m) => m.type === 'pong').length === 120,
    '120 pongs',
  );
  const pingMark = pingOnly.inbox.length;
  pingOnly.send({ type: 'ping', nonce: 999 });
  const pingLimited = await pingOnly.waitFor((m) => m.type === 'error', pingMark, 'ping rate limit');
  assert.equal(pingLimited.error, 'rate-limited');
  assert.equal(pingLimited.fatal, true);

  // Alternating an invalid message with a valid ping keeps the invalid counter down
  // while still charging one token per message. 60 + 60 = 120, so the next one fails.
  // If malformed traffic were free, 60 tokens would remain and no limit would fire.
  const mixed = await openClient(t, env.address);
  for (let index = 0; index < 60; index += 1) {
    mixed.send({ type: 'not-a-real-message' });
    mixed.send({ type: 'ping', nonce: index });
  }
  await waitUntil(() => mixed.inbox.filter((m) => m.type === 'pong').length === 60, '60 mixed pongs');
  assert.equal(
    mixed.inbox.filter((m) => m.type === 'error' && m.error === 'invalid-message').length,
    60,
    'every malformed message was rejected but tolerated because a valid message reset the counter',
  );
  const mixedMark = mixed.inbox.length;
  mixed.send({ type: 'ping', nonce: 4242 });
  const mixedLimited = await mixed.waitFor((m) => m.type === 'error', mixedMark, 'mixed rate limit');
  assert.equal(mixedLimited.error, 'rate-limited');
  assert.equal(mixedLimited.fatal, true);
});

// ---------------------------------------------------------------------------
// 2. Transport-level limits
// ---------------------------------------------------------------------------

test('oversize fragments, invalid UTF-8 text and binary frames close only the offender', async (t) => {
  const env = await startServer(t);
  const healthy = await openClient(t, env.address);
  const welcome = await healthy.request({ type: 'create' }, (m) => m.type === 'welcome', 'create');

  // Two fragments that are individually small but add up past the 8192-byte payload cap.
  const fragmented = await openClient(t, env.address);
  fragmented.sendRaw('a'.repeat(5000), { fin: false });
  fragmented.sendRaw('b'.repeat(5000), { fin: true });
  const fragmentedClose = await fragmented.waitClose();
  assert.ok(fragmentedClose.closed, 'the reassembled oversize message closes the connection');

  // A text frame whose bytes are not valid UTF-8 must not be accepted as a message.
  const invalidText = await openClient(t, env.address);
  invalidText.sendRaw(Buffer.from([0xc3, 0x28, 0xa0, 0xa1]), { binary: false });
  const invalidTextClose = await invalidText.waitClose();
  assert.ok(invalidTextClose.closed, 'invalid UTF-8 text closes the connection');

  // A binary frame reaches the application, which refuses it fatally.
  const binary = await openClient(t, env.address);
  const binaryMark = binary.inbox.length;
  binary.sendRaw(Buffer.from([0x00, 0x01, 0x02, 0x03]), { binary: true });
  const binaryError = await binary.waitFor((m) => m.type === 'error', binaryMark, 'binary refusal');
  assert.equal(binaryError.error, 'invalid-message');
  assert.equal(binaryError.fatal, true);
  assert.ok((await binary.waitClose()).closed);

  // The healthy neighbour is untouched: it still gets pongs and room snapshots.
  await healthy.sync();
  const snapshot = healthy.lastSnapshot();
  assert.ok(snapshot, 'the healthy client still receives snapshots');
  assert.equal(snapshot.code, welcome.code);
  assert.equal(snapshot.phase, 'waiting');
  await waitUntil(() => env.app.stats().connections === 1, 'only the healthy connection survives');
  assert.equal(env.app.stats().rooms, 1, 'the healthy connection kept its room');
});

// ---------------------------------------------------------------------------
// 3. Withdrawal during countdown and replacement
// ---------------------------------------------------------------------------

test('leaving during countdown rewinds the room, and a replacement starts a fresh match', async (t) => {
  const env = await startServer(t);
  const a = await openClient(t, env.address);
  const b = await openClient(t, env.address);
  const welcome = await a.request({ type: 'create' }, (m) => m.type === 'welcome', 'create');
  const joinWelcome = await b.request({ type: 'join', code: welcome.code }, (m) => m.type === 'welcome', 'join');
  assert.equal(joinWelcome.slot, 1);

  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  const countdown = await a.waitFor((m) => m.type === 'snapshot' && m.phase === 'countdown', 0, 'countdown');
  assert.equal(countdown.matchId, 1);
  assert.equal(countdown.roundId, 1);
  assert.deepEqual(countdown.scores, [0, 0]);
  assert.ok(countdown.flight, 'countdown owns a flight state');

  const mark = a.inbox.length;
  b.send({ type: 'leave' });
  const rewound = await a.waitFor((m) => m.type === 'snapshot' && m.phase === 'waiting', mark, 'rewound snapshot');
  assert.equal(rewound.flight, null, 'the flight is dropped');
  assert.equal(rewound.roundId, 0, 'the round is rewound');
  assert.equal(rewound.matchId, 1, 'matchId is kept so the next match increments');
  assert.deepEqual(rewound.scores, [0, 0]);
  assert.equal(rewound.ready[0], false, 'the remaining player must ready again');
  assert.ok((await b.waitClose()).closed, 'an explicit leave closes that connection');

  // A replacement joins the same code and both ready up.
  const c = await openClient(t, env.address);
  const replacementWelcome = await c.request(
    { type: 'join', code: welcome.code },
    (m) => m.type === 'welcome',
    'replacement join',
  );
  assert.equal(replacementWelcome.slot, 1, 'the replacement takes the free slot');

  const readyMark = a.inbox.length;
  a.send({ type: 'ready', value: true });
  c.send({ type: 'ready', value: true });
  const rematch = await a.waitFor(
    (m) => m.type === 'snapshot' && m.phase === 'countdown' && m.matchId === 2,
    readyMark,
    'second match countdown',
  );
  assert.equal(rematch.roundId, 1);
  assert.deepEqual(rematch.scores, [0, 0], 'the new match starts from zero');
  assert.ok(rematch.flight, 'the new match has a flight');
  assert.equal(rematch.flight.pilots[0].health, 100);
  assert.equal(rematch.flight.pilots[1].health, 100);
  assert.equal(rematch.flight.pilots[0].lastProcessedSeq, 0);
  assert.equal(rematch.flight.pilots[1].lastProcessedSeq, 0);
  assert.deepEqual(rematch.flight.projectiles, [], 'no projectiles survive into the new match');
  assert.equal(rematch.flight.tick, 0);
});

// ---------------------------------------------------------------------------
// 4. Origins and the connection cap
// ---------------------------------------------------------------------------

test('explicit allowedOrigins replaces the defaults and refusals consume no capacity', async (t) => {
  const devOrigin = 'http://127.0.0.1:5173';
  const env = await startServer(t, { allowedOrigins: [devOrigin], maxConnections: 2 });

  // The server's own origin is no longer allowed once the list is explicit.
  assert.equal(await upgradeStatus(env.address, { origin: env.address.origin }), 403);
  assert.equal(await upgradeStatus(env.address, {}), 403, 'a missing Origin is refused');
  assert.equal(await upgradeStatus(env.address, { origin: 'https://elsewhere.invalid' }), 403);
  await waitUntil(
    () => env.app.stats().reserved === 0 && env.app.stats().connections === 0,
    'refused handshakes to release capacity',
  );
  assert.equal(env.app.stats().rooms, 0, 'refused handshakes created no room');

  // Four concurrent upgrades: at most the cap may be accepted.
  const attempts = await Promise.all([0, 1, 2, 3].map(() => tryUpgrade(env.address, { origin: devOrigin })));
  const accepted = attempts.filter((attempt) => attempt.ok);
  const refused = attempts.filter((attempt) => !attempt.ok);
  assert.equal(accepted.length, 2, 'exactly the connection cap is accepted');
  assert.equal(refused.length, 2);
  for (const attempt of refused) assert.equal(attempt.status, 503);
  await waitUntil(() => env.app.stats().connections === 2, 'two accepted sessions');

  // Releasing one slot lets a new client in.
  accepted[0].ws.close();
  await waitUntil(() => env.app.stats().connections === 1, 'one session remaining');
  const reusable = await tryUpgrade(env.address, { origin: devOrigin });
  assert.equal(reusable.ok, true, 'capacity is reusable after a close');
  assert.equal(env.app.stats().connections, 2);

  for (const handle of [reusable.ws, accepted[1].ws]) handle.close();
  await waitUntil(() => env.app.stats().connections === 0, 'all sessions released');
});

// ---------------------------------------------------------------------------
// 5. Sequence integrity and forged input
// ---------------------------------------------------------------------------

test('an overflow-rejected sequence is not banked and is accepted after the queue drains', async (t) => {
  const env = await startServer(t);
  const a = await openClient(t, env.address);
  const b = await openClient(t, env.address);
  const welcome = await a.request({ type: 'create' }, (m) => m.type === 'welcome', 'create');
  await b.request({ type: 'join', code: welcome.code }, (m) => m.type === 'welcome', 'join');
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await a.waitFor((m) => m.type === 'snapshot' && m.phase === 'countdown', 0, 'countdown');
  for (let step = 0; step < COUNTDOWN_TICKS / 5; step += 1) env.app.advance(5);
  await a.sync();
  const playing = a.lastSnapshot();
  assert.equal(playing.phase, 'playing');

  // Fill the six-frame queue with sequences 1..6.
  for (let start = 1; start <= 5; start += 2) {
    a.send(inputPacket(playing, [frameAt(start), frameAt(start + 1)]));
  }
  await waitUntil(() => env.app.stats().queuedInputs === 6, 'queue filled to six');

  // The seventh/eighth frame is refused atomically.
  const overflowMark = a.inbox.length;
  a.send(inputPacket(playing, [frameAt(7), frameAt(8)]));
  const overflow = await a.waitFor((m) => m.type === 'error', overflowMark, 'queue overflow');
  assert.equal(overflow.error, 'input-queue-full');
  assert.equal(env.app.stats().queuedInputs, 6, 'the refused packet added nothing');

  // Drain one frame per tick, then confirm the ack stopped at 6.
  env.app.advance(5);
  env.app.advance(1);
  await a.sync();
  const drained = a.lastSnapshot();
  assert.equal(env.app.stats().queuedInputs, 0);
  assert.equal(drained.flight.pilots[0].lastProcessedSeq, 6, 'sequence 7 was never accepted');

  // Because 7 was never banked, resubmitting it is valid and is really consumed.
  // Snapshots are broadcast every third tick, so advance enough to observe the ack.
  a.send(inputPacket(drained, [frameAt(7)]));
  await a.sync();
  env.app.advance(3);
  await a.sync();
  const acknowledged = a.lastSnapshot();
  assert.equal(acknowledged.flight.pilots[0].lastProcessedSeq, 7, 'the resubmitted sequence is acknowledged');
  assert.equal(acknowledged.phase, 'playing');
});

test('stale rounds, forged pilot state and illegal packets cannot move tick, ack or score', async (t) => {
  const env = await startServer(t);
  const a = await openClient(t, env.address);
  const b = await openClient(t, env.address);
  const welcome = await a.request({ type: 'create' }, (m) => m.type === 'welcome', 'create');
  await b.request({ type: 'join', code: welcome.code }, (m) => m.type === 'welcome', 'join');
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await a.waitFor((m) => m.type === 'snapshot' && m.phase === 'countdown', 0, 'countdown');
  for (let step = 0; step < COUNTDOWN_TICKS / 5; step += 1) env.app.advance(5);
  await a.sync();

  const baseline = a.lastSnapshot();
  const baselineTick = env.app.stats().serverTick;
  assert.equal(baseline.phase, 'playing');

  const staleRoundMark = a.inbox.length;
  a.send({ ...inputPacket(baseline, [frameAt(1)]), roundId: baseline.roundId + 1 });
  assert.equal(
    (await a.waitFor((m) => m.type === 'error', staleRoundMark, 'stale round')).error,
    'stale-input',
  );

  const staleMatchMark = a.inbox.length;
  a.send({ ...inputPacket(baseline, [frameAt(1)]), matchId: baseline.matchId + 1 });
  assert.equal(
    (await a.waitFor((m) => m.type === 'error', staleMatchMark, 'stale match')).error,
    'stale-input',
  );

  // Forged server-owned fields make the message fail schema validation.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const forgedMark = a.inbox.length;
    a.send({
      ...inputPacket(baseline, [frameAt(1)]),
      position: [0, 0, 0],
      health: 1,
      score: 3,
    });
    assert.equal(
      (await a.waitFor((m) => m.type === 'error', forgedMark, 'forged fields')).error,
      'invalid-message',
    );
  }
  // A valid message resets the consecutive-invalid counter before it reaches three.
  await a.sync();

  assert.equal(env.app.stats().serverTick, baselineTick, 'no message advanced the simulation');
  const after = a.lastSnapshot();
  assert.equal(after.matchId, baseline.matchId);
  assert.equal(after.roundId, baseline.roundId);
  assert.deepEqual(after.scores, baseline.scores, 'scores are untouched');
  assert.equal(after.flight.pilots[0].lastProcessedSeq, 0, 'nothing was acknowledged');
  assert.equal(after.flight.pilots[1].lastProcessedSeq, 0);
  assert.equal(after.flight.tick, baseline.flight.tick);
});

// ---------------------------------------------------------------------------
// 6. Automatic catch-up bounds
// ---------------------------------------------------------------------------

test('automatic mode advances at most five steps per wake and records dropped backlog', async (t) => {
  const clock = { ms: 0 };
  const app = createDuelServer({ host: HOST, port: 0, automatic: true, collider, nowMs: () => clock.ms });
  t.after(async () => {
    await app.close().catch(() => undefined);
  });
  const address = await app.listen();
  assert.equal(app.stats().serverTick, 0);

  // One second of backlog is about sixty ticks; a single wake may take only five.
  clock.ms = 1000;
  await waitUntil(() => app.stats().serverTick >= 1, 'the real timer to fire once');
  const afterWake = app.stats();
  assert.equal(afterWake.serverTick, 5, 'one wake advances exactly five steps');
  assert.ok(afterWake.droppedSteps >= 50, `a large backlog was dropped (${afterWake.droppedSteps})`);
  assert.ok(afterWake.droppedSteps <= 60, `the drop count stays near the backlog (${afterWake.droppedSteps})`);

  // A chatty client cannot push simulation frames: ticks only move with the clock.
  const client = await openClient(t, address);
  await client.request({ type: 'create' }, (m) => m.type === 'welcome', 'create');
  for (let index = 0; index < 5; index += 1) client.send({ type: 'ping', nonce: index });
  await sleep(120);
  assert.equal(app.stats().serverTick, 5, 'messages never advance the simulation');
  assert.equal(clock.ms, 1000, 'the test clock moved only when written');
});

// ---------------------------------------------------------------------------
// 7. Close, port and timer hygiene
// ---------------------------------------------------------------------------

test('close is safe before listen, twice, during listen, and after a failed listen', async (t) => {
  // (a) Closing before listening, twice, then listen refuses.
  const early = createDuelServer({ host: HOST, port: 0, automatic: false, collider, nowMs: () => 0 });
  await early.close();
  await early.close();
  await assert.rejects(early.listen(), /closed/i);

  // (b) Closing while the listen promise is still in flight settles both.
  const racing = createDuelServer({ host: HOST, port: 0, automatic: false, collider, nowMs: () => 0 });
  const listening = racing.listen();
  const closing = racing.close();
  const settled = await Promise.allSettled([listening, closing]);
  assert.equal(settled[1].status, 'fulfilled', 'close settles even mid-listen');

  // (c) A real listen, then double close, releases the port for a plain TCP bind.
  const clock = { ms: 0 };
  const app = createDuelServer({ host: HOST, port: 0, automatic: false, collider, nowMs: () => clock.ms });
  const address = await app.listen();
  await app.close();
  await app.close();
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(address.port, HOST, resolve);
  });
  await new Promise((resolve) => probe.close(resolve));

  // (d) A failed listen leaves nothing behind; close still settles and the port frees.
  const occupied = createNetServer();
  await new Promise((resolve) => occupied.listen(0, HOST, resolve));
  const takenPort = occupied.address().port;
  const failing = createDuelServer({ host: HOST, port: takenPort, automatic: false, collider, nowMs: () => 0 });
  await assert.rejects(failing.listen(), (error) => error.code === 'EADDRINUSE');
  await failing.close();
  await failing.close();
  await new Promise((resolve) => occupied.close(resolve));
  const probeAgain = createNetServer();
  await new Promise((resolve, reject) => {
    probeAgain.once('error', reject);
    probeAgain.listen(takenPort, HOST, resolve);
  });
  await new Promise((resolve) => probeAgain.close(resolve));
});

test('constructing never listens or installs timers, and closing stops them', async (t) => {
  // Construction with automatic mode still installs nothing until listen.
  const clock = { ms: 0 };
  const idle = createDuelServer({ host: HOST, port: 0, automatic: true, collider, nowMs: () => clock.ms });
  t.after(async () => {
    await idle.close().catch(() => undefined);
  });
  assert.deepEqual(idle.stats(), {
    connections: 0,
    rooms: 0,
    serverTick: 0,
    reserved: 0,
    droppedSteps: 0,
    queuedInputs: 0,
  });
  clock.ms = 5000;
  await sleep(60);
  assert.equal(idle.stats().serverTick, 0, 'no simulation timer exists before listen');
  await idle.close();

  // An automatic server that does run stops advancing after close.
  const liveClock = { ms: 0 };
  const live = createDuelServer({ host: HOST, port: 0, automatic: true, collider, nowMs: () => liveClock.ms });
  t.after(async () => {
    await live.close().catch(() => undefined);
  });
  await live.listen();
  liveClock.ms = 1000;
  await waitUntil(() => live.stats().serverTick >= 1, 'automatic ticks');
  await live.close();
  const frozen = live.stats().serverTick;
  liveClock.ms += 10000;
  await sleep(80);
  assert.equal(live.stats().serverTick, frozen, 'no simulation timer survives close');
});
