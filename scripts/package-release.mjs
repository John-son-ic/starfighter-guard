/**
 * D10 — packages the already-built game into a movable offline directory.
 *
 * The produced directory contains no node_modules: copy it anywhere, install
 * Node.js 24, double-click start-play.cmd, and the game runs from local files.
 * Nothing is uploaded, published or installed.
 *
 * Node built-ins only. Importing this module performs no writes.
 *
 * CLI:  node scripts/package-release.mjs
 *       projectRoot = repository root, outputRoot = artifacts/local/release
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_OUTPUT_ROOT = resolve(DEFAULT_PROJECT_ROOT, 'artifacts', 'local', 'release');

/** Files copied verbatim, keyed by their path inside the package. */
const REQUIRED_FILES = Object.freeze([
  { source: join('scripts', 'serve-release.mjs'), destination: join('scripts', 'serve-release.mjs'), label: '本地启动脚本' },
  { source: 'start-play.cmd', destination: 'start-play.cmd', label: '双击启动入口' },
]);
/** Explanation copied in as the package README. */
const README_SOURCE = join('docs', 'OFFLINE_RELEASE.md');
const README_DESTINATION = 'README.md';
/** Everything under this directory ships as-is. */
const DIST_DIRECTORY = 'dist';

function describe(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
}

function rejectLinkedInput(project, path) {
  let component = project;
  for (const part of ['', ...relative(project, path).split(sep).filter(Boolean)]) {
    if (part) component = join(component, part);
    if (lstatSync(component).isSymbolicLink()) throw new Error(`拒绝复制符号链接：${component}`);
  }
}

// Resolve existing ancestors even when the final output directories do not exist.
function realOutput(path) {
  const missing = []; let current = path;
  for (;;) {
    try { return resolve(realpathSync(current), ...missing); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) || dirname(current) === current) throw error;
      missing.unshift(relative(dirname(current), current)); current = dirname(current);
    }
  }
}

/** Recursively lists regular files under `directory`, refusing symlinks. */
function collectFiles(directory, prefix, errors) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(`无法读取目录 ${directory}：${error.message}`);
    return files;
  }
  for (const entry of entries) {
    const source = join(directory, entry.name);
    const destination = join(prefix, entry.name);
    let stats;
    try {
      stats = lstatSync(source);
    } catch (error) {
      errors.push(`无法读取 ${source}：${error.message}`);
      continue;
    }
    if (stats.isSymbolicLink()) {
      errors.push(`拒绝复制符号链接：${source}`);
      continue;
    }
    if (stats.isDirectory()) {
      files.push(...collectFiles(source, destination, errors));
    } else if (stats.isFile()) {
      files.push({ source, destination, bytes: stats.size });
    } else {
      errors.push(`跳过非普通文件：${source}`);
    }
  }
  return files;
}

/** Copies one planned file, creating parent directories as needed. */
function copyPlanned(packageRoot, planned) {
  const destination = join(packageRoot, planned.destination);
  mkdirSync(dirname(destination), { recursive: true });
  // cmd.exe can misparse a UTF-8 batch with LF-only lines, even when the same
  // server starts correctly with node. Make the portable launcher Windows-native.
  if (planned.destination === 'start-play.cmd') writeFileSync(destination, readFileSync(planned.source, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
  else copyFileSync(planned.source, destination);
  return statSync(destination).size;
}

/**
 * Builds a new package directory under outputRoot.
 * Resolves to { outputPath, fileCount, totalBytes, files }.
 * Throws an Error listing what is missing or unsafe instead of writing a fake package.
 */
export function packRelease({ projectRoot = DEFAULT_PROJECT_ROOT, outputRoot = DEFAULT_OUTPUT_ROOT } = {}) {
  const source = resolve(projectRoot);
  const output = resolve(outputRoot);
  const errors = [];

  const dist = join(source, DIST_DIRECTORY);
  for (const path of [dist, ...REQUIRED_FILES.map(item => join(source, item.source)), join(source, README_SOURCE)]) {
    // Check parent directories too; missing prerequisites retain the helpful errors below.
    if (existsSync(path)) rejectLinkedInput(source, path);
    else {
      let parent = dirname(path);
      while (!existsSync(parent) && parent !== source) parent = dirname(parent);
      rejectLinkedInput(source, parent);
      try { if (lstatSync(path).isSymbolicLink()) throw new Error(`拒绝复制符号链接：${path}`); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    errors.push(`缺少构建产物 ${indexPath}：请先在开发副本中运行 npm run build。`);
  }

  const planned = [];
  for (const required of REQUIRED_FILES) {
    const path = join(source, required.source);
    if (!existsSync(path)) {
      errors.push(`缺少${required.label}：${path}`);
      continue;
    }
    if (lstatSync(path).isSymbolicLink()) {
      errors.push(`拒绝复制符号链接：${path}`);
      continue;
    }
    planned.push({ source: path, destination: required.destination });
  }

  const readme = join(source, README_SOURCE);
  if (!existsSync(readme)) {
    errors.push(`缺少离线说明 ${readme}`);
  } else {
    planned.push({ source: readme, destination: README_DESTINATION });
  }

  if (existsSync(dist)) {
    if (isInside(realpathSync(dist), realOutput(output))) {
      errors.push(`输出目录不能位于 dist 内：${output}`);
    }
    planned.push(...collectFiles(dist, DIST_DIRECTORY, errors));
  }

  if (errors.length === 0) {
    // The default output (artifacts/local/release) legitimately lives inside the
    // project, so being inside the project is fine. What must not happen is writing
    // into dist/ (the source of the build) or replacing the project root itself.
    if (realOutput(output) === realpathSync(source)) {
      errors.push('输出目录不能是项目根目录本身。');
    }
  }

  if (errors.length > 0) {
    throw new Error(`无法生成离线包：\n${errors.map((line) => `  - ${line}`).join('\n')}`);
  }

  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, 'pack-'));
  let fileCount = 0;
  let totalBytes = 0;
  try {
    for (const item of planned) {
      totalBytes += copyPlanned(staging, item);
      fileCount += 1;
    }
  } catch (error) {
    throw new Error(`复制文件失败：${error.message}`);
  }

  // The staging directory name becomes the package name, so repeated runs never collide.
  return { outputPath: staging, fileCount, totalBytes, files: planned.map((item) => item.destination) };
}

/**
 * Every file in a produced package, relative to its root and always slash-separated,
 * so the listing reads the same on Windows and POSIX.
 */
export function listPackageFiles(packageRoot) {
  const errors = [];
  return collectFiles(packageRoot, '', errors)
    .map((item) => item.destination.split(sep).join('/'))
    .sort();
}

function runCli(argv) {
  if (argv.length > 0) {
    console.error(`无法识别的参数：${argv.join(' ')}`);
    console.error('用法：node scripts/package-release.mjs');
    return 2;
  }
  try {
    const result = packRelease();
    console.log(`离线包已生成：${result.outputPath}`);
    console.log(`文件数 ${result.fileCount}，总字节 ${result.totalBytes}`);
    console.log('把该目录整体复制到任意位置，双击 start-play.cmd 即可试玩（需要已安装 Node.js 24）。');
    return 0;
  } catch (error) {
    for (const line of String(error.message).split('\n')) console.error(line.startsWith('  - ') ? line.slice(4) : line);
    return 1;
  }
}

const isCli =
  import.meta.main === true ||
  (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isCli) process.exitCode = runCli(process.argv.slice(2));
