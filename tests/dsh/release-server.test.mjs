/**
 * D09 behaviour tests — local static release server.
 * Run: node --test tests/dsh/release-server.test.mjs
 *
 * Fixtures are staged in a temporary directory under artifacts/local/; the real dist/
 * is only ever read. Every server opened here is closed in `after`, and only the
 * directory this file created is removed.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReleaseServer,
  parsePortArgument,
  resolveRequestPath,
  DEFAULT_PORT,
  DEFAULT_ROOT,
} from '../../scripts/serve-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REAL_DIST = join(REPO_ROOT, 'dist');
const TMP_ROOT = join(REPO_ROOT, 'artifacts', 'local', `release-server-test-${process.pid}`);

const openServers = new Set();

after(async () => {
  await Promise.all([...openServers].map((server) => new Promise((done) => server.close(done))));
  openServers.clear();
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function writeFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

/** Builds a small fixture tree plus a sibling directory used for prefix checks. */
function stageFixture(name) {
  const root = join(TMP_ROOT, name, 'dist');
  const sibling = join(TMP_ROOT, name, 'dist-evil');
  writeFile(join(root, 'index.html'), '<!doctype html><title>fixture</title><div id="app"></div>');
  writeFile(join(root, 'assets', 'index-abc123.js'), 'export const ready = true;\n');
  writeFile(join(root, 'assets', 'index-abc123.css'), 'body{margin:0}\n');
  writeFile(join(root, 'models', 'manifest.json'), '{"version":1,"models":[]}\n');
  writeFile(join(root, 'models', 'venator.glb'), Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]));
  writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFile(join(sibling, 'secret.txt'), 'should never be served');
  writeFile(join(TMP_ROOT, name, 'outside.txt'), 'outside the static root');
  return { root, sibling, parent: join(TMP_ROOT, name) };
}

/** Starts a server on an ephemeral port; the OS picks a free one. */
async function startServer(root) {
  const server = createReleaseServer(root);
  openServers.add(server);
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port, address } = server.address();
  return { server, port, address, origin: `http://127.0.0.1:${port}` };
}

async function request(origin, path, { method = 'GET' } = {}) {
  const response = await fetch(`${origin}${path}`, { method, redirect: 'manual' });
  const body = method === 'HEAD' ? '' : await response.text();
  return { status: response.status, headers: response.headers, body };
}

test('importing the module has no side effects', () => {
  // Reaching here proves the import neither listened, exited nor opened a browser.
  assert.equal(typeof createReleaseServer, 'function');
  assert.equal(typeof resolveRequestPath, 'function');
  assert.equal(DEFAULT_PORT, 5174);
  assert.ok(DEFAULT_ROOT.endsWith('dist'), `default root should be a dist directory, got ${DEFAULT_ROOT}`);
  assert.equal(DEFAULT_ROOT, join(REPO_ROOT, 'dist'), 'default root resolves from the script location, not the cwd');
  assert.equal(openServers.size, 0, 'no server was opened by importing');
});

test('port argument parsing accepts valid ports and reports bad ones', () => {
  assert.deepEqual(parsePortArgument([]), { port: DEFAULT_PORT });
  assert.deepEqual(parsePortArgument(['--port', '5175']), { port: 5175 });
  assert.deepEqual(parsePortArgument(['--port=6000']), { port: 6000 });
  assert.deepEqual(parsePortArgument(['--port', '1']), { port: 1 });
  assert.deepEqual(parsePortArgument(['--port', '65535']), { port: 65535 });

  for (const argv of [['--port'], ['--port', '0'], ['--port', '65536'], ['--port', '-1'], ['--port', 'abc'], ['--port', '51.5'], ['--port', ''], ['--verbose'], ['extra']]) {
    const result = parsePortArgument(argv);
    assert.ok(result.error, `argv ${JSON.stringify(argv)} must be rejected`);
    assert.equal(result.port, undefined);
  }
});

test('the fixture index and its query route are served as HTML', async () => {
  const { root } = stageFixture('basic');
  const origin = (await startServer(root)).origin;

  for (const path of ['/', '/?mode=models', '/index.html']) {
    const response = await request(origin, path);
    assert.equal(response.status, 200, `${path} should be 200`);
    assert.match(response.headers.get('content-type'), /^text\/html/, `${path} content-type`);
    assert.match(response.body, /fixture/, `${path} body`);
  }
});

test('ES modules, styles, models, data and images get usable content types', async () => {
  const { root } = stageFixture('mime');
  const origin = (await startServer(root)).origin;

  const cases = [
    ['/assets/index-abc123.js', /^text\/javascript/, /^export const ready = true;$/m],
    ['/assets/index-abc123.css', /^text\/css/, /^body\{margin:0\}$/m],
    ['/models/manifest.json', /^application\/json/, /"version":1/],
    ['/logo.png', /^image\/png/, null],
  ];
  for (const [path, pattern, expectedBody] of cases) {
    const response = await request(origin, path);
    assert.equal(response.status, 200, `${path} should be 200`);
    assert.match(response.headers.get('content-type'), pattern, `${path} content-type`);
    if (expectedBody !== null) assert.match(response.body, expectedBody, `${path} body`);
  }

  const glb = await fetch(`${origin}/models/venator.glb`);
  assert.equal(glb.status, 200);
  assert.match(glb.headers.get('content-type') ?? '', /gltf-binary/);
  assert.equal((await glb.arrayBuffer()).byteLength, 8);

  // Browsers only execute a module when the response carries a JavaScript MIME type,
  // so the served bytes plus that header are what make the entry loadable.
  const entry = await request(origin, '/assets/index-abc123.js');
  assert.equal(entry.body, readFileSync(join(root, 'assets', 'index-abc123.js'), 'utf8'), 'the module must be served byte-for-byte');
  assert.match(entry.body, /^export /m, 'the served file is still an ES module');
  assert.match(entry.headers.get('content-type') ?? '', /^text\/javascript/, 'a module MIME type is required to execute');
});

test('HEAD returns headers without a body', async () => {
  const { root } = stageFixture('head');
  const origin = (await startServer(root)).origin;

  const response = await request(origin, '/assets/index-abc123.js', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  assert.equal(response.headers.get('content-length'), String(statSync(join(root, 'assets', 'index-abc123.js')).size));
  assert.equal(response.body, '', 'HEAD must not send a body');

  // HEAD on a missing file still reports 404.
  assert.equal((await request(origin, '/nope.js', { method: 'HEAD' })).status, 404);
});

test('missing assets are 404 and never fall back to index.html', async () => {
  const { root } = stageFixture('missing');
  const origin = (await startServer(root)).origin;

  for (const path of ['/nope.js', '/assets/missing-xyz.css', '/models/absent.glb', '/deep/path/that/does/not/exist.png']) {
    const response = await request(origin, path);
    assert.equal(response.status, 404, `${path} should be 404`);
    assert.doesNotMatch(response.body, /<!doctype html>/i, `${path} must not return the index page`);
  }
});

test('directories are not listed', async () => {
  const { root } = stageFixture('listing');
  const origin = (await startServer(root)).origin;

  for (const path of ['/assets', '/assets/', '/models', '/models/']) {
    const response = await request(origin, path);
    assert.equal(response.status, 404, `${path} must not list a directory`);
    assert.doesNotMatch(response.body, /index-abc123|manifest\.json/, 'no directory contents may leak');
  }
});

test('methods other than GET and HEAD are rejected with 405', async () => {
  const { root } = stageFixture('methods');
  const origin = (await startServer(root)).origin;

  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const response = await request(origin, '/', { method });
    assert.equal(response.status, 405, `${method} should be 405`);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('paths outside the static root are refused', async () => {
  const { root, sibling } = stageFixture('traversal');
  const origin = (await startServer(root)).origin;

  const attempts = [
    '/../outside.txt',
    '/%2e%2e/outside.txt',
    '/%2e%2e%2foutside.txt',
    '/assets/../../outside.txt',
    '/....//outside.txt',
    '/dist-evil/secret.txt',
    '/..%5Coutside.txt',
    '/%5C..%5Coutside.txt',
    '/C:/Windows/win.ini',
    '/C:%5CWindows%5Cwin.ini',
    '/%5C%5Cserver%5Cshare%5Cfile.txt',
    '/%00index.html',
    '/assets/%ZZ',
    '/%',
  ];
  for (const path of attempts) {
    const response = await request(origin, path);
    assert.ok(response.status === 403 || response.status === 404, `${path} should be refused, got ${response.status}`);
    assert.doesNotMatch(response.body, /should never be served|outside the static root|\u0000/i, `${path} leaked content`);
  }

  // The sibling directory really does exist, so 404 above is a containment decision.
  assert.ok(existsSync(join(sibling, 'secret.txt')));
});

test('resolveRequestPath keeps every request inside the root', () => {
  const root = join(TMP_ROOT, 'resolve', 'dist');
  mkdirSync(root, { recursive: true });

  assert.equal(resolveRequestPath(root, '/'), resolve(root), 'the root maps to the static root itself');
  assert.equal(resolveRequestPath(root, '/index.html'), join(root, 'index.html'));
  assert.equal(resolveRequestPath(root, '/assets/app.js'), join(root, 'assets', 'app.js'));
  assert.equal(resolveRequestPath(root, '/assets/'), join(root, 'assets'), 'a trailing slash is normalised away');

  for (const pathname of [
    '/../outside.txt',
    '/../../etc/passwd',
    '/assets/../../outside.txt',
    '/%2e%2e/outside.txt',
    '/..%5Coutside.txt',
    '/C:/Windows/win.ini',
    '/C:%5CWindows%5Cwin.ini',
    '//server/share',
    '/a%00b',
    '/%ZZ',
    '/%',
    '/a\\b',
    '',
  ]) {
    assert.equal(resolveRequestPath(root, pathname), null, `${pathname} must resolve to null`);
  }

  // A sibling whose name merely starts with the root name must not pass.
  const sibling = join(TMP_ROOT, 'resolve', 'dist-evil');
  mkdirSync(sibling, { recursive: true });
  assert.equal(resolveRequestPath(root, '/../dist-evil/secret.txt'), null);
});

test('symlinks pointing outside the root are refused', (t) => {
  const root = join(TMP_ROOT, 'symlink', 'dist');
  mkdirSync(root, { recursive: true });
  const realInside = writeFile(join(root, 'real.txt'), 'inside');
  const outside = writeFile(join(TMP_ROOT, 'symlink', 'outside.txt'), 'outside');
  const link = join(root, 'link.txt');

  try {
    symlinkSync(outside, link, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip('this platform does not allow creating symlinks without elevated rights');
    return;
  }

  assert.equal(resolveRequestPath(root, '/link.txt'), null, 'a link out of the root must be refused');
  assert.equal(resolveRequestPath(root, '/real.txt'), realInside, 'a real file inside the root still resolves');
});

test('a symlink is refused even when the target does not exist yet', (t) => {
  const root = join(TMP_ROOT, 'symlink-missing', 'dist');
  mkdirSync(root, { recursive: true });
  const link = join(root, 'dangling.txt');
  try {
    symlinkSync(join(TMP_ROOT, 'symlink-missing', 'elsewhere.txt'), link, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip('this platform does not allow creating symlinks without elevated rights');
    return;
  }
  assert.equal(resolveRequestPath(root, '/dangling.txt'), null);
});

test('the real built dist is served, including the entry JS and CSS', async () => {
  const index = join(REAL_DIST, 'index.html');
  assert.ok(existsSync(index), `expected a build at ${index}; run npm run build first`);
  const html = readFileSync(index, 'utf8');

  const origin = (await startServer(REAL_DIST)).origin;
  const home = await request(origin, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  assert.match(home.body, /id="app"/);

  const models = await request(origin, '/?mode=models');
  assert.equal(models.status, 200, 'the model viewer route must be served');

  // Follow the references the build actually emitted.
  const referenced = [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(referenced.length > 0, 'the built index must reference at least one JS or CSS asset');
  for (const asset of referenced) {
    const response = await request(origin, `/${asset}`);
    assert.equal(response.status, 200, `${asset} should be 200`);
    const type = response.headers.get('content-type') ?? '';
    if (asset.endsWith('.js')) assert.match(type, /^text\/javascript/, `${asset} must be served as a module`);
    if (asset.endsWith('.css')) assert.match(type, /^text\/css/, `${asset} content-type`);
    assert.ok(response.body.length > 0, `${asset} should not be empty`);
  }

  // The exported model files are part of the release payload.
  const manifest = await request(origin, '/models/manifest.json');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type') ?? '', /^application\/json/);
});

test('the server binds to loopback only', async () => {
  const { root } = stageFixture('bind');
  const { address } = await startServer(root);
  assert.equal(address, '127.0.0.1', 'the listener must be bound to 127.0.0.1');
});
