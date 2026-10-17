/**
 * D06 behaviour tests — exported model asset consistency.
 * Run: node --test tests/dsh/assets.test.mjs
 *
 * Every broken case is staged in a temporary copy under artifacts/local/; the real
 * public/models files are only ever read. Cleanup removes exactly the directory this
 * file creates.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyAssets } from '../../scripts/verify-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REAL_DIR = join(REPO_ROOT, 'public', 'models');
const REAL_MANIFEST = JSON.parse(readFileSync(join(REAL_DIR, 'manifest.json'), 'utf8'));
const EXPECTED_IDS = ['venator', 'eta2', 'arc170', 'vulture', 'munificent', 'ywing', 'relay'];
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'verify-assets.mjs');

const TMP_ROOT = join(REPO_ROOT, 'artifacts', 'local', `assets-test-${process.pid}`);

after(() => {
  // Only the directory this test file created is removed.
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** Stages a fixture directory containing the real GLBs plus a mutable manifest. */
function stage(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const id of EXPECTED_IDS) copyFileSync(join(REAL_DIR, `${id}.glb`), join(dir, `${id}.glb`));
  const manifest = structuredClone(REAL_MANIFEST);
  writeManifest(dir, manifest);
  return {
    dir,
    manifest,
    save() {
      writeManifest(dir, this.manifest);
      return this;
    },
    entry(id) {
      const found = this.manifest.models.find((model) => model.id === id);
      assert.ok(found, `fixture must contain ${id}`);
      return found;
    },
    /** Reads the value from an expected failure. */
    errors() {
      const result = verifyAssets(this.dir, { throwOnError: false });
      return result.errors;
    },
  };
}

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function runCli(...args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function expectError(errors, fragment, message) {
  assert.ok(
    errors.some((line) => line.includes(fragment)),
    `${message}\n  wanted fragment: ${fragment}\n  got:\n${errors.map((line) => `    ${line}`).join('\n')}`,
  );
}

test('importing the module does not run the CLI', () => {
  // Reaching this line at all proves the import had no side effects.
  assert.equal(typeof verifyAssets, 'function');
  const result = verifyAssets(REAL_DIR);
  assert.equal(result.modelCount, 7);
  assert.equal(result.totalBytes, REAL_MANIFEST.models.reduce((sum, model) => sum + model.bytes, 0));
});

test('the real exported assets pass verification', () => {
  const result = verifyAssets(REAL_DIR);
  assert.equal(result.modelCount, EXPECTED_IDS.length);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalBytes, EXPECTED_IDS.reduce((sum,id)=>sum+statSync(join(REAL_DIR,id+'.glb')).size,0));
  for (const id of EXPECTED_IDS) assert.ok(existsSync(join(REAL_DIR, `${id}.glb`)), `${id}.glb exists`);

  // The unmodified fixture copy must pass too, so later failures come from the mutation.
  const staged = stage('clean');
  assert.deepEqual(staged.errors(), []);
  assert.equal(verifyAssets(staged.dir).modelCount, 7);
});

test('a missing expected model is reported by id', () => {
  const staged = stage('missing-id');
  staged.manifest.models = staged.manifest.models.filter((model) => model.id !== 'vulture');
  staged.save();
  expectError(staged.errors(), 'expected model "vulture" is missing', 'a missing id must be reported');
  assert.throws(() => verifyAssets(staged.dir), /asset verification failed/);
});

test('a duplicated model id is reported', () => {
  const staged = stage('duplicate-id');
  staged.manifest.models.push(structuredClone(staged.entry('eta2')));
  staged.save();
  expectError(staged.errors(), 'model "eta2" is listed 2 times', 'a duplicate id must be reported');
});

test('an unexpected model id is reported', () => {
  const staged = stage('unexpected-id');
  copyFileSync(join(staged.dir, 'eta2.glb'), join(staged.dir, 'xwing.glb'));
  const clone = structuredClone(staged.entry('eta2'));
  clone.id = 'xwing';
  clone.file = 'xwing.glb';
  staged.manifest.models.push(clone);
  staged.save();
  expectError(staged.errors(), 'unexpected model id "xwing"', 'an unknown id must be reported');
});

test('a file name that is not <id>.glb is rejected', () => {
  const staged = stage('wrong-file');
  staged.entry('arc170').file = 'arc170_export.glb';
  staged.save();
  expectError(staged.errors(), 'must be named arc170.glb', 'a mismatched file name must be reported');
});

test('path traversal in the manifest is refused', () => {
  const staged = stage('traversal');
  const outside = join(TMP_ROOT, 'outside');
  mkdirSync(outside, { recursive: true });
  copyFileSync(join(REAL_DIR, 'eta2.glb'), join(outside, 'eta2.glb'));

  for (const attempt of ['../outside/eta2.glb', '..\\outside\\eta2.glb', 'sub/eta2.glb', 'C:/tmp/eta2.glb', '/etc/eta2.glb']) {
    staged.entry('eta2').file = attempt;
    staged.save();
    expectError(staged.errors(), 'path traversal refused', `traversal attempt ${JSON.stringify(attempt)} must be refused`);
  }
  // The refused entry must never be counted as verified.
  assert.equal(verifyAssets(staged.dir, { throwOnError: false }).modelCount, EXPECTED_IDS.length - 1);
});

test('a manifest file name pointing at a missing GLB is reported', () => {
  const staged = stage('missing-glb');
  rmSync(join(staged.dir, 'vulture.glb'));
  expectError(staged.errors(), 'vulture.glb is listed in the manifest but missing on disk', 'a missing GLB must be reported');
});

test('a bad GLB magic is reported', () => {
  const staged = stage('bad-magic');
  const path = join(staged.dir, 'eta2.glb');
  const buffer = readFileSync(path);
  buffer.writeUInt32LE(0x12345678, 0);
  writeFileSync(path, buffer);
  expectError(staged.errors(), 'bad GLB magic', 'a wrong magic number must be reported');
});

test('a non-2 container version is reported', () => {
  const staged = stage('bad-version');
  const path = join(staged.dir, 'arc170.glb');
  const buffer = readFileSync(path);
  buffer.writeUInt32LE(1, 4);
  writeFileSync(path, buffer);
  expectError(staged.errors(), 'glTF container version 1', 'version 1 must be rejected');
});

test('a header length that does not match the file is reported', () => {
  const staged = stage('bad-length');
  const path = join(staged.dir, 'venator.glb');
  const buffer = readFileSync(path);
  buffer.writeUInt32LE(buffer.length - 8, 8);
  writeFileSync(path, buffer);
  expectError(staged.errors(), 'header declares', 'a stale header length must be reported');
  expectError(staged.errors(), 'but the file is', 'the report must include the real size');
});

test('a truncated GLB is reported rather than crashing', () => {
  const staged = stage('truncated');
  const full = readFileSync(join(staged.dir, 'arc170.glb'));
  writeFileSync(join(staged.dir, 'arc170.glb'), full.subarray(0, 100));
  expectError(staged.errors(), 'arc170.glb', 'the truncated file must be named');
});

test('a clearly invalid JSON chunk is reported', () => {
  const staged = stage('bad-json');
  const path = join(staged.dir, 'vulture.glb');
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  // Replace the JSON payload with bytes that cannot parse, keeping the framing valid.
  buffer.write('{"meshes":[', 20, 'utf8');
  for (let offset = 31; offset < 20 + jsonLength; offset += 1) buffer.writeUInt8(0x20, offset);
  writeFileSync(path, buffer);
  expectError(staged.errors(), 'JSON chunk is not parseable', 'an unparseable JSON chunk must be reported');
});

test('declared bytes must match the file size', () => {
  const staged = stage('bad-bytes');
  staged.entry('venator').bytes = staged.entry('venator').bytes + 1;
  staged.save();
  expectError(staged.errors(), 'manifest bytes', 'a byte mismatch must be reported');
});

test('declared triangles must match the accessors', () => {
  const staged = stage('bad-triangles');
  staged.entry('arc170').triangles = staged.entry('arc170').triangles + 3;
  staged.save();
  expectError(staged.errors(), 'triangles but the manifest says', 'a triangle mismatch must be reported');

  // And a wrong value that is still a positive integer must not slip through.
  const staged2 = stage('bad-triangles-low');
  staged2.entry('venator').triangles = 3;
  staged2.save();
  expectError(staged2.errors(), 'triangles but the manifest says', 'an understated triangle count must be reported');
});

test('declared material batches must match the scene mesh nodes', () => {
  const staged = stage('bad-batches');
  staged.entry('vulture').materialBatches = staged.entry('vulture').materialBatches + 1;
  staged.save();
  expectError(staged.errors(), 'mesh nodes in the top-level scene', 'a batch mismatch must be reported');
});

test('non-positive or non-integer manifest numbers are rejected', () => {
  const staged = stage('bad-numbers');
  staged.entry('eta2').bytes = 0;
  staged.save();
  expectError(staged.errors(), 'bytes must be a positive integer', 'a zero byte count must be reported');

  const staged2 = stage('bad-numbers-2');
  staged2.entry('eta2').triangles = 1.5;
  staged2.save();
  expectError(staged2.errors(), 'triangles must be a positive integer', 'a fractional triangle count must be reported');
});

test('a malformed or missing manifest is reported without throwing raw errors', () => {
  const missing = stage('no-manifest');
  rmSync(join(missing.dir, 'manifest.json'));
  const missingErrors = verifyAssets(missing.dir, { throwOnError: false }).errors;
  expectError(missingErrors, 'manifest file not found', 'a missing manifest must be reported');

  const broken = stage('broken-manifest');
  writeFileSync(join(broken.dir, 'manifest.json'), '{ not json ');
  expectError(verifyAssets(broken.dir, { throwOnError: false }).errors, 'invalid JSON', 'a broken manifest must be reported');

  const notArray = stage('manifest-not-array');
  writeFileSync(join(notArray.dir, 'manifest.json'), '{"models":{}}');
  expectError(verifyAssets(notArray.dir, { throwOnError: false }).errors, '"models" must be an array', 'a non-array models field must be reported');
});

test('the CLI reports every failure with the file and reason, and exits non-zero', () => {
  const staged = stage('cli-failure');
  staged.entry('arc170').bytes = staged.entry('arc170').bytes + 5;
  staged.entry('vulture').triangles = staged.entry('vulture').triangles + 6;
  staged.save();

  const result = runCli(staged.dir);
  assert.equal(result.status, 1, `CLI must exit 1 on failure, got ${result.status}`);
  assert.match(result.stderr, /arc170\.glb/, 'the failing file must be printed');
  assert.match(result.stderr, /vulture\.glb/, 'every failing file must be printed');
  assert.match(result.stderr, /manifest bytes/, 'the reason must be printed');
  assert.match(result.stderr, /triangles/, 'the second reason must be printed');
  assert.equal(result.stdout.trim(), '', 'nothing is reported as verified when verification fails');
});

test('the CLI prints the model count and total bytes and exits zero', () => {
  const staged = stage('cli-success');
  const expectedBytes = staged.manifest.models.reduce((sum, model) => sum + model.bytes, 0);
  const result = runCli(staged.dir);

  assert.equal(result.status, 0, `CLI must exit 0 on success, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /verified 7 models/);
  assert.match(result.stdout, new RegExp(`${expectedBytes} bytes`));
  assert.equal(result.stderr.trim(), '', 'a successful run prints nothing to stderr');
});

test('the CLI fails on a missing manifest without a stack trace', () => {
  const dir = join(TMP_ROOT, 'cli-empty');
  mkdirSync(dir, { recursive: true });
  const result = runCli(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest file not found/);
  assert.doesNotMatch(result.stderr, /at .*verify-assets\.mjs/, 'a clean failure must not dump a stack trace');
});
