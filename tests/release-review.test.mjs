import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createReleaseServer, resolveRequestPath } from '../scripts/serve-release.mjs';
import { packRelease } from '../scripts/package-release.mjs';

const scratch = resolve(import.meta.dirname, '../artifacts/local');
mkdirSync(scratch, { recursive: true });
function fixture(t) {
  const root = mkdtempSync(join(scratch, 'codex-link-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  for (const folder of ['dist', 'scripts', 'docs']) mkdirSync(join(project, folder), { recursive: true });
  writeFileSync(join(project, 'dist/index.html'), '<title>review</title>');
  writeFileSync(join(project, 'scripts/serve-release.mjs'), 'export const test=true;');
  writeFileSync(join(project, 'docs/OFFLINE_RELEASE.md'), 'review readme');
  writeFileSync(join(project, 'start-play.cmd'), '@echo off');
  return { root, project, outputRoot: join(root, 'packages') };
}
function directoryLink(target, link) { symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }

test('review: directory links cannot serve outside content, including absent descendants', async t => {
  const { root, project } = fixture(t);
  const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret.txt'), 'external sentinel');
  directoryLink(outside, join(project, 'dist/linked'));
  const server = createReleaseServer(join(project, 'dist'));
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['secret.txt', 'absent.txt']) {
    assert.equal(resolveRequestPath(join(project, 'dist'), `/linked/${name}`), null);
    const response = await fetch(`${origin}/linked/${name}`);
    assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /external sentinel/);
  }
});

test('review: failing realpath permissions do not fall back to an unchecked file', t => {
  const { project } = fixture(t);
  assert.equal(resolveRequestPath(join(project, 'dist'), '/index.html', { realpath() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }), null);
});

test('review: raw Windows separators and network paths are rejected before URL normalization', async t => {
  const { project } = fixture(t);
  const server = createReleaseServer(join(project, 'dist'));
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  t.after(() => new Promise(done => server.close(done)));
  for (const path of ['//elsewhere/', '/\\elsewhere/', '/assets\\file.js', 'http://elsewhere/']) {
    const status = await new Promise((done, fail) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path }, response => { response.resume(); done(response.statusCode); });
      req.once('error', fail); req.end();
    });
    assert.equal(status, 403, path);
  }
});

test('review: linked dist root is rejected before creating any package', t => {
  const { root, project, outputRoot } = fixture(t);
  const outside = join(root, 'outside-build'); mkdirSync(outside); writeFileSync(join(outside, 'index.html'), 'external build');
  rmSync(join(project, 'dist'), { recursive: true }); directoryLink(outside, join(project, 'dist'));
  assert.throws(() => packRelease({ projectRoot: project, outputRoot }), /链接/);
  assert.equal(existsSync(outputRoot), false);
});

for (const [folder, file] of [['scripts', 'serve-release.mjs'], ['docs', 'OFFLINE_RELEASE.md']]) {
  test(`review: linked ${folder} parent is rejected instead of copying external input`, t => {
    const { root, project, outputRoot } = fixture(t);
    const outside = join(root, `outside-${folder}`); mkdirSync(outside); writeFileSync(join(outside, file), 'external input');
    rmSync(join(project, folder), { recursive: true }); directoryLink(outside, join(project, folder));
    assert.throws(() => packRelease({ projectRoot: project, outputRoot }), /链接/);
    assert.equal(existsSync(outputRoot), false);
  });
}

test('review: output alias pointing into dist is refused before source mutation', t => {
  const { root, project } = fixture(t);
  const alias = join(root, 'alias'); directoryLink(join(project, 'dist'), alias);
  assert.throws(() => packRelease({ projectRoot: project, outputRoot: join(alias, 'packages') }), /输出目录.*dist/);
  assert.equal(existsSync(join(project, 'dist/packages')), false);
});

test('review: packaged Windows launchers use CRLF even when input uses LF', t => {
  const { project, outputRoot } = fixture(t);
  writeFileSync(join(project, 'start-play.cmd'), '@echo off\nchcp 65001 >nul\necho 正在启动\n');
  const result = packRelease({ projectRoot: project, outputRoot });
  const batch = readFileSync(join(result.outputPath, 'start-play.cmd'), 'utf8');
  assert.match(batch, /\r\n/); assert.doesNotMatch(batch, /(?<!\r)\n/); assert.match(batch, /正在启动/);
});

test('review: directory index cannot follow a file symlink outside the static root', async t => {
  const { root, project } = fixture(t);
  const outside = join(root, 'secret.html'); writeFileSync(outside, 'external sentinel');
  mkdirSync(join(project, 'dist/sub'));
  try { symlinkSync(outside, join(project, 'dist/sub/index.html'), 'file'); }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; t.skip('file symlink creation unavailable'); return; }
  const server = createReleaseServer(join(project, 'dist'));
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  t.after(() => new Promise(done => server.close(done)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/sub/`);
  assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /external sentinel/);
});
