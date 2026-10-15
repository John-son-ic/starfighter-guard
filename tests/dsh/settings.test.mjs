/**
 * D03 behaviour tests — settings persistence over injected storage.
 * Run: node --test tests/dsh/settings.test.mjs
 *
 * Everything is asserted through a fake StorageLike, so no browser is needed and
 * the exact written key/payload can be inspected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../../src/platform/settings.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../src/shared/config.ts';

/** Minimal in-memory storage; `writes` records every accepted key/value pair. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    data,
    writes,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      data.set(key, value);
    },
  };
}

function storageWith(raw) {
  return memoryStorage({ [SETTINGS_KEY]: raw });
}

/** A storage whose operations throw, to prove the module degrades instead of crashing. */
function throwingStorage(which) {
  return {
    getItem() {
      if (which === 'getItem' || which === 'both') throw new Error('read blocked');
      return null;
    },
    setItem() {
      if (which === 'setItem' || which === 'both') throw new Error('quota exceeded');
    },
  };
}

const DEFAULT_SHAPE = { version: 1, volume: 0.6, sensitivity: 1, quality: 'medium' };

test('an empty storage loads a complete default set', () => {
  const settings = loadSettings(memoryStorage());
  assert.deepEqual(settings, DEFAULT_SHAPE);
  assert.notEqual(settings, DEFAULT_SETTINGS, 'a fresh object is returned, not the shared default');
});

test('malformed, empty and non-object payloads fall back to defaults', () => {
  const payloads = [
    '',
    '   ',
    'not json at all',
    '{',
    '{"version":1,',
    'null',
    'undefined',
    '[]',
    '[1,2,3]',
    '"a string"',
    '42',
    '0',
    'true',
    'false',
    '{"volume":0.1}',
    '{"sensitivity":2,"quality":"low"}',
    '{"version":2,"volume":0.1,"sensitivity":2,"quality":"low"}',
    '{"version":0,"volume":0.1}',
    '{"version":"1","volume":0.1,"sensitivity":2,"quality":"low"}',
    '{"version":null}',
    '{"version":1.5,"volume":0.1}',
  ];
  for (const payload of payloads) {
    const settings = loadSettings(storageWith(payload));
    assert.deepEqual(settings, DEFAULT_SHAPE, `payload ${JSON.stringify(payload)} must give full defaults`);
    assert.notEqual(settings, DEFAULT_SETTINGS);
  }
});

test('a version 1 object restores each valid field', () => {
  const settings = loadSettings(storageWith('{"version":1,"volume":0.25,"sensitivity":2.5,"quality":"low"}'));
  assert.deepEqual(settings, { version: 1, volume: 0.25, sensitivity: 2.5, quality: 'low' });

  const boundary = loadSettings(storageWith('{"version":1,"volume":0,"sensitivity":0.2,"quality":"medium"}'));
  assert.deepEqual(boundary, { version: 1, volume: 0, sensitivity: 0.2, quality: 'medium' });

  const upper = loadSettings(storageWith('{"version":1,"volume":1,"sensitivity":3,"quality":"medium"}'));
  assert.deepEqual(upper, { version: 1, volume: 1, sensitivity: 3, quality: 'medium' });
});

test('missing fields take the field default while valid siblings survive', () => {
  assert.deepEqual(loadSettings(storageWith('{"version":1}')), DEFAULT_SHAPE);
  assert.deepEqual(loadSettings(storageWith('{"version":1,"volume":0.9}')), {
    version: 1,
    volume: 0.9,
    sensitivity: DEFAULT_SHAPE.sensitivity,
    quality: DEFAULT_SHAPE.quality,
  });
  assert.deepEqual(loadSettings(storageWith('{"version":1,"quality":"low"}')), {
    version: 1,
    volume: DEFAULT_SHAPE.volume,
    sensitivity: DEFAULT_SHAPE.sensitivity,
    quality: 'low',
  });
});

test('out-of-range numbers are clamped to the documented bounds', () => {
  const cases = [
    [1.5, 1],
    [12, 1],
    [-0.5, 0],
    [-99, 0],
  ];
  for (const [input, expected] of cases) {
    const settings = loadSettings(storageWith(`{"version":1,"volume":${input}}`));
    assert.equal(settings.volume, expected, `volume ${input} must clamp to ${expected}`);
  }

  const sensitivityCases = [
    [0, 0.2],
    [0.1, 0.2],
    [-3, 0.2],
    [3.5, 3],
    [1000, 3],
  ];
  for (const [input, expected] of sensitivityCases) {
    const settings = loadSettings(storageWith(`{"version":1,"sensitivity":${input}}`));
    assert.equal(settings.sensitivity, expected, `sensitivity ${input} must clamp to ${expected}`);
  }
});

test('string, boolean and null numbers are not coerced', () => {
  const payloads = [
    '{"version":1,"volume":"0.3"}',
    '{"version":1,"volume":true}',
    '{"version":1,"volume":null}',
    '{"version":1,"volume":[0.3]}',
    '{"version":1,"volume":{"value":0.3}}',
    '{"version":1,"sensitivity":"2"}',
    '{"version":1,"sensitivity":false}',
  ];
  for (const payload of payloads) {
    const settings = loadSettings(storageWith(payload));
    assert.deepEqual(settings, DEFAULT_SHAPE, `${payload} must not be coerced`);
  }
  assert.equal(loadSettings(storageWith('{"version":1,"volume":NaN}')).volume, DEFAULT_SHAPE.volume);
  assert.equal(loadSettings(storageWith('{"version":1,"volume":Infinity}')).volume, DEFAULT_SHAPE.volume);
  assert.equal(loadSettings(storageWith('{"version":1,"sensitivity":-Infinity}')).sensitivity, DEFAULT_SHAPE.sensitivity);
});

test('only low and medium are accepted qualities', () => {
  for (const quality of ['low', 'medium']) {
    assert.equal(loadSettings(storageWith(`{"version":1,"quality":"${quality}"}`)).quality, quality);
  }
  for (const quality of ['LOW', 'Low', 'high', 'ultra', 'medium ', '', 'null', 0, 1, true, null, ['low']]) {
    const settings = loadSettings(storageWith(`{"version":1,"quality":${JSON.stringify(quality)}}`));
    assert.equal(settings.quality, DEFAULT_SHAPE.quality, `quality ${JSON.stringify(quality)} must fall back`);
  }
});

test('a storage read error degrades to defaults instead of throwing', () => {
  assert.deepEqual(loadSettings(throwingStorage('getItem')), DEFAULT_SHAPE);
  assert.deepEqual(loadSettings(throwingStorage('both')), DEFAULT_SHAPE);
});

test('a storage write error is reported as false, never thrown', () => {
  assert.equal(saveSettings(throwingStorage('setItem'), DEFAULT_SETTINGS), false);
  assert.equal(saveSettings(throwingStorage('both'), DEFAULT_SETTINGS), false);
  assert.equal(saveSettings(memoryStorage(), DEFAULT_SETTINGS), true);
});

test('a save then load round trip preserves every field', () => {
  const storage = memoryStorage();
  const original = { version: 1, volume: 0.42, sensitivity: 1.75, quality: 'low' };
  assert.equal(saveSettings(storage, original), true);
  assert.deepEqual(loadSettings(storage), original);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], SETTINGS_KEY, 'exactly one write, to the agreed key');
  assert.deepEqual(JSON.parse(storage.writes[0][1]), original);
});

test('saves write only the four agreed fields and the exact key', () => {
  const storage = memoryStorage();
  const noisy = {
    version: 1,
    volume: 0.5,
    sensitivity: 1.5,
    quality: 'low',
    extra: 'must not be stored',
    nested: { secret: true },
    playerName: 'private',
  };
  assert.equal(saveSettings(storage, noisy), true);
  assert.equal(storage.writes.length, 1);
  const [key, payload] = storage.writes[0];
  assert.equal(key, SETTINGS_KEY);
  assert.equal(key, 'starfighter-guard:settings:v1');
  assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ['quality', 'sensitivity', 'version', 'volume']);
  assert.equal(payload.includes('must not be stored'), false);
  assert.equal(payload.includes('private'), false);
  assert.deepEqual(loadSettings(storage), { version: 1, volume: 0.5, sensitivity: 1.5, quality: 'low' });
});

test('a save normalizes untrusted values before writing', () => {
  const storage = memoryStorage();
  const hostile = { version: 99, volume: 5, sensitivity: 'x', quality: 'high' };
  assert.equal(saveSettings(storage, hostile), true);
  const written = JSON.parse(storage.writes[0][1]);
  assert.deepEqual(written, {
    version: 1,
    volume: 1,
    sensitivity: DEFAULT_SHAPE.sensitivity,
    quality: DEFAULT_SHAPE.quality,
  });
  assert.deepEqual(loadSettings(storage), written);
});

test('DEFAULT_SETTINGS and the caller value are never modified', () => {
  const before = { ...DEFAULT_SETTINGS };
  const storage = memoryStorage();
  const caller = { version: 1, volume: 0.9, sensitivity: 0.5, quality: 'low' };
  const snapshot = { ...caller };

  saveSettings(storage, caller);
  loadSettings(storage);
  loadSettings(storageWith('{"version":1,"volume":0.1,"sensitivity":2,"quality":"high"}'));

  assert.deepEqual(DEFAULT_SETTINGS, before, 'the frozen default object is untouched');
  assert.deepEqual(caller, snapshot, 'the caller object is untouched');
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  assert.notEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test('loading ignores extra fields', () => {
  const settings = loadSettings(
    storageWith('{"version":1,"volume":0.3,"sensitivity":2,"quality":"low","extra":1,"nested":{"a":1}}'),
  );
  assert.deepEqual(settings, { version: 1, volume: 0.3, sensitivity: 2, quality: 'low' });
  assert.deepEqual(Object.keys(settings).sort(), ['quality', 'sensitivity', 'version', 'volume']);
  assert.equal('extra' in settings, false);
});

test('repeated saves overwrite rather than accumulate', () => {
  const storage = memoryStorage();
  saveSettings(storage, { version: 1, volume: 0.1, sensitivity: 1, quality: 'low' });
  saveSettings(storage, { version: 1, volume: 0.9, sensitivity: 2, quality: 'medium' });
  assert.equal(storage.writes.length, 2);
  assert.equal(storage.data.size, 1, 'one key only');
  assert.deepEqual(loadSettings(storage), { version: 1, volume: 0.9, sensitivity: 2, quality: 'medium' });
});

test('the module reads only the four documented fields', () => {
  const allowed = new Set(['version', 'volume', 'sensitivity', 'quality']);
  const watch = (source) => {
    const extraReads = [];
    const storage = {
      getItem: (key) => (key === SETTINGS_KEY ? JSON.stringify(source) : null),
      setItem: () => {},
    };
    const watched = new Proxy(storage, {
      get(target, property, receiver) {
        if (typeof property === 'string' && !allowed.has(property) && !(property in target)) {
          extraReads.push(property);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const settings = new Proxy({ ...source }, {
      get(target, property, receiver) {
        if (typeof property === 'string' && !allowed.has(property)) extraReads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    return { raw: source, settings, storage: watched, extraReads };
  };

  const loaded = watch({ version: 1, volume: 0.3, sensitivity: 2, quality: 'low', extra: 1, secret: 'x' });
  assert.deepEqual(loadSettings(loaded.storage), { version: 1, volume: 0.3, sensitivity: 2, quality: 'low' });

  const saved = watch({ version: 1, volume: 0.3, sensitivity: 2, quality: 'low', junk: 'x' });
  assert.equal(saveSettings(saved.storage, saved.settings), true);
  assert.deepEqual(saved.extraReads, [], 'no private or unknown field is ever touched');
  assert.deepEqual(loaded.extraReads, []);
});
