/**
 * D10 behaviour tests — portable offline release packaging.
 * Run: node --test tests/dsh/package-release.test.mjs
 *
 * Fixtures and produced packages live under artifacts/local/ and are removed in
 * `after`. The real repository is only read (dist/, scripts/, start-play.cmd,
 * docs/OFFLINE_RELEASE.md), never modified.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseServer } from '../../scripts/serve-release.mjs';
import { packRelease, listPackageFiles, DEFAULT_OUTPUT_ROOT, DEFAULT_PROJECT_ROOT } from '../../scripts/package-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const TMP_ROOT = join(REPO_ROOT, 'artifacts', 'local', `package-release-test-${process.pid}`);

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

/**
 * Builds a miniature project that looks like a prepared repository: a dist build,
 * both scripts, the launcher, the offline doc, plus decoy files that must never ship.
 */
function stageProject(name, { withDist = true } = {}) {
  const project = join(TMP_ROOT, name, 'project');
  if (withDist) {
    writeFile(join(project, 'dist', 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="./assets/index-abc.js"></script>');
    writeFile(join(project, 'dist', 'assets', 'index-abc.js'), 'console.log("built");\n');
    writeFile(join(project, 'dist', 'assets', 'index-abc.css'), 'body{margin:0}\n');
    writeFile(join(project, 'dist', 'models', 'manifest.json'), '{"version":1}\n');
  }
  // The package copies the repository's own server script, so the fixture stays honest.
  cpSync(join(REPO_ROOT, 'scripts', 'serve-release.mjs'), join(project, 'scripts', 'serve-release.mjs'));
  cpSync(join(REPO_ROOT, 'start-play.cmd'), join(project, 'start-play.cmd'));
  cpSync(join(REPO_ROOT, 'docs', 'OFFLINE_RELEASE.md'), join(project, 'docs', 'OFFLINE_RELEASE.md'));

  // Decoys: none of these may appear in the package.
  writeFile(join(project, 'package.json'), '{"name":"decoy"}');
  writeFile(join(project, 'src', 'sim', 'mission.ts'), 'export const decoy = true;\n');
  writeFile(join(project, 'node_modules', 'three', 'package.json'), '{"name":"three"}');
  writeFile(join(project, '.git', 'config'), '[core]\n');
  writeFile(join(project, '.env.local'), 'SECRET=1\n');
  writeFile(join(project, 'artifacts', 'c01', 'shot.png'), Buffer.from([0x89, 0x50]));
  writeFile(join(project, 'tests', 'dsh', 'fake.test.mjs'), 'throw new Error("decoy");\n');
  return { project, outputRoot: join(TMP_ROOT, name, 'out') };
}

async function startServer(root) {
  const server = createReleaseServer(root);
  openServers.add(server);
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('importing the module has no write side effects', () => {
  assert.equal(typeof packRelease, 'function');
  assert.equal(DEFAULT_PROJECT_ROOT, REPO_ROOT);
  assert.equal(DEFAULT_OUTPUT_ROOT, join(REPO_ROOT, 'artifacts', 'local', 'release'));
  assert.equal(existsSync(TMP_ROOT), false, 'importing must not create fixture directories');
});

test('a prepared project packages into a self-contained directory', () => {
  const { project, outputRoot } = stageProject('ok');
  const result = packRelease({ projectRoot: project, outputRoot });

  assert.ok(isAbsolute(result.outputPath), 'the result must be an absolute path');
  assert.ok(result.outputPath.startsWith(outputRoot), 'the package must be created under outputRoot');
  assert.ok(existsSync(join(result.outputPath, 'dist', 'index.html')));
  assert.ok(result.fileCount > 0 && result.totalBytes > 0);

  const files = listPackageFiles(result.outputPath);
  assert.deepEqual(files, [
    'README.md',
    'dist/assets/index-abc.css',
    'dist/assets/index-abc.js',
    'dist/index.html',
    'dist/models/manifest.json',
    'scripts/serve-release.mjs',
    'start-play.cmd',
  ].sort());

  // Structure keeps the server's relative ../dist root valid.
  assert.ok(existsSync(join(result.outputPath, 'scripts', 'serve-release.mjs')));
  assert.ok(existsSync(join(result.outputPath, 'dist', 'index.html')));
  assert.match(readFileSync(join(result.outputPath, 'README.md'), 'utf8'), /离线试玩包说明/);
  assert.equal(result.fileCount, files.length, 'the reported count must match the files on disk');
});

test('decoys never enter the package', () => {
  const { project, outputRoot } = stageProject('decoys');
  const result = packRelease({ projectRoot: project, outputRoot });

  const files = listPackageFiles(result.outputPath);
  for (const forbidden of ['package.json', 'node_modules', 'src', '.git', '.env.local', 'artifacts', 'tests', 'docs']) {
    assert.equal(
      files.some((file) => file === forbidden || file.startsWith(`${forbidden}/`)),
      false,
      `${forbidden} must not be packaged`,
    );
  }
  // The doc is deliberately renamed to README.md rather than copied as docs/.
  assert.ok(files.includes('README.md'));
  assert.equal(files.includes('docs/OFFLINE_RELEASE.md'), false);
});

test('a missing build fails instead of producing a fake package', () => {
  const { project, outputRoot } = stageProject('nobuild', { withDist: false });
  assert.throws(() => packRelease({ projectRoot: project, outputRoot }), /缺少构建产物/);
  assert.equal(existsSync(outputRoot), false, 'no output directory may be created on failure');

  // A dist without index.html is still not a build.
  const partial = stageProject('nobuild-index');
  rmSync(join(partial.project, 'dist', 'index.html'));
  assert.throws(() => packRelease({ projectRoot: partial.project, outputRoot: partial.outputRoot }), /缺少构建产物/);
  assert.equal(existsSync(partial.outputRoot), false);
});

test('a missing launcher or doc fails with a preparation hint', () => {
  const noLauncher = stageProject('nolauncher');
  rmSync(join(noLauncher.project, 'start-play.cmd'));
  assert.throws(() => packRelease({ projectRoot: noLauncher.project, outputRoot: noLauncher.outputRoot }), /双击启动入口/);

  const noDoc = stageProject('nodoc');
  rmSync(join(noDoc.project, 'docs', 'OFFLINE_RELEASE.md'));
  assert.throws(() => packRelease({ projectRoot: noDoc.project, outputRoot: noDoc.outputRoot }), /缺少离线说明/);
});

test('repeated packaging never overwrites an earlier package', () => {
  const { project, outputRoot } = stageProject('repeat');
  const first = packRelease({ projectRoot: project, outputRoot });
  writeFile(join(first.outputPath, 'marker.txt'), 'first package');

  const second = packRelease({ projectRoot: project, outputRoot });
  assert.notEqual(second.outputPath, first.outputPath, 'each run must get its own directory');
  assert.equal(readFileSync(join(first.outputPath, 'marker.txt'), 'utf8'), 'first package', 'the first package stays intact');
  assert.equal(existsSync(join(second.outputPath, 'marker.txt')), false);
});

test('an output directory inside dist or the project is refused', () => {
  const insideDist = stageProject('inside-dist');
  assert.throws(
    () => packRelease({ projectRoot: insideDist.project, outputRoot: join(insideDist.project, 'dist', 'release') }),
    /输出目录不能位于 dist 内/,
  );

  const insideProject = stageProject('inside-project');
  // The default output lives inside the project, so that is allowed; only dist/ and
  // the project root itself are refused.
  const allowed = packRelease({ projectRoot: insideProject.project, outputRoot: join(insideProject.project, 'release') });
  assert.ok(existsSync(join(allowed.outputPath, 'dist', 'index.html')));
  assert.equal(listPackageFiles(allowed.outputPath).some((file) => file.startsWith('src/')), false);

  const sameAsRoot = stageProject('same-root');
  assert.throws(() => packRelease({ projectRoot: sameAsRoot.project, outputRoot: sameAsRoot.project }), /不能是项目根目录/);
});

test('symlinks are refused rather than followed', (t) => {
  const { project, outputRoot } = stageProject('symlink');
  const link = join(project, 'dist', 'linked.js');
  try {
    symlinkSync(join(project, 'package.json'), link, 'file');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip('this platform does not allow creating symlinks without elevated rights');
    return;
  }
  assert.throws(() => packRelease({ projectRoot: project, outputRoot }), /拒绝复制符号链接/);
  assert.equal(existsSync(outputRoot), false, 'a refused package must not leave a directory behind');
});

test('the packaged copy runs from a new path containing spaces, without node_modules', async () => {
  const { project, outputRoot } = stageProject('move');
  const built = packRelease({ projectRoot: project, outputRoot });

  // Move the package somewhere unrelated, with spaces in the path.
  const moved = join(TMP_ROOT, 'move', 'my games', 'starfighter guard');
  mkdirSync(dirname(moved), { recursive: true });
  cpSync(built.outputPath, moved, { recursive: true });
  rmSync(built.outputPath, { recursive: true, force: true });

  assert.equal(existsSync(join(moved, 'node_modules')), false, 'the package must not carry dependencies');
  assert.equal(existsSync(join(moved, 'dist', 'index.html')), true);

  // The package's own server script must resolve ../dist from its own location.
  const origin = await startServer(join(moved, 'dist'));
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="app"/);

  const entry = await fetch(`${origin}/assets/index-abc.js`);
  assert.equal(entry.status, 200, 'the local entry script must load');
  assert.match(entry.headers.get('content-type') ?? '', /^text\/javascript/);

  // And the packaged script itself must still be a valid module resolving its own dist.
  const packagedScript = join(moved, 'scripts', 'serve-release.mjs');
  assert.ok(statSync(packagedScript).isFile());
  const module = await import(`${new URL(`file://${packagedScript.replace(/\\/g, '/')}`).href}`);
  assert.equal(typeof module.createReleaseServer, 'function');
  assert.equal(module.DEFAULT_ROOT, join(moved, 'dist'), 'the packaged default root follows the package location');
});

test('the real repository packages (dist only) and the package can be served', async () => {
  const outputRoot = join(TMP_ROOT, 'real-output');
  const result = packRelease({ projectRoot: REPO_ROOT, outputRoot });
  const files = listPackageFiles(result.outputPath);

  assert.ok(files.includes('start-play.cmd'));
  assert.ok(files.includes('scripts/serve-release.mjs'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('dist/index.html'));
  assert.equal(files.some((file) => file.startsWith('node_modules/')), false);
  assert.equal(files.some((file) => file.startsWith('src/')), false);
  assert.ok(result.totalBytes > 100_000, `a real build should carry substantial bytes, got ${result.totalBytes}`);

  const origin = await startServer(join(result.outputPath, 'dist'));
  assert.equal((await fetch(`${origin}/`)).status, 200);
  const manifest = await fetch(`${origin}/models/manifest.json`);
  assert.equal(manifest.status, 200, 'the packaged model manifest must load locally');
  const models = JSON.parse(await manifest.text());
  assert.equal(models.models.length, 7);
});
