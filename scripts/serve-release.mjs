/**
 * D09 — local static file server for an already-built copy of the game.
 *
 * Purpose: a user who has the built files and Node.js 24 can double-click
 * start-play.cmd and play, without npm install and without Vite.
 *
 * Node built-ins only. Importing this module has no side effects: no listening
 * socket, no network access, no process exit.
 *
 * CLI:  node scripts/serve-release.mjs [--port N]
 *       serves the ../dist directory next to this script on 127.0.0.1 only.
 */
import { createServer } from 'node:http';
import { createReadStream, lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default static root: the dist/ directory beside this script, not the cwd. */
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, '..', 'dist');
export const DEFAULT_PORT = 5174;
export const DEFAULT_HOST = '127.0.0.1';
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Content types needed by the built game: scripts, styles, models, data, images. */
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
});

function contentTypeFor(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  if (body === undefined) response.end();
  else response.end(body);
}

/**
 * Resolves a URL pathname to an absolute file path inside `root`, or null when the
 * path is malformed or escapes the root.
 *
 * Rejections cover: encoded traversal, Windows separators, drive letters, UNC
 * prefixes, NUL bytes, malformed percent-encoding and symlinks pointing outside.
 * The containment test compares full path segments (root + sep), so a sibling
 * directory such as `dist-evil` cannot pass by sharing a string prefix.
 */
export function resolveRequestPath(root, pathname, { realpath = realpathSync } = {}) {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;
  if (pathname.includes('\0')) return null;
  if (pathname.includes('\\')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // Malformed percent-encoding.
  }
  if (decoded.includes('\0')) return null;
  if (decoded.includes('\\')) return null;
  // A colon has no place in a static URL path and is how Windows drive letters and
  // NTFS alternate data streams are smuggled in (e.g. /C:/Windows/win.ini).
  if (decoded.includes(':')) return null;
  if (decoded.startsWith('//')) return null; // UNC-style prefix.

  // resolve() (not normalize) strips any trailing separator, so a request for the
  // root itself compares equal to `root` instead of failing the containment test.
  const candidate = resolve(join(root, decoded));
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(prefix)) return null;

  // Reject links in every path component, including dangling links. realpath alone
  // cannot distinguish a missing file from an unresolved link to outside the root.
  let component = root;
  for (const part of ['', ...relative(root, candidate).split(sep).filter(Boolean)]) {
    if (part) component = join(component, part);
    try { if (lstatSync(component).isSymbolicLink()) return null; }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return null; break; }
  }

  // Resolve symlinks so a link inside the root cannot expose files outside it.
  try {
    const real = realpath(root);
    const realCandidate = realpath(candidate);
    const realPrefix = real.endsWith(sep) ? real : real + sep;
    if (realCandidate !== real && !realCandidate.startsWith(realPrefix)) return null;
    return realCandidate;
  } catch (error) {
    return ['ENOENT', 'ENOTDIR'].includes(error.code) ? candidate : null;
  }
}

/** Returns the file to serve: the path itself, or its index.html when it is a directory. */
function resolveDirectoryIndex(filePath) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return null;
  }
  if (stats.isFile()) return filePath;
  if (!stats.isDirectory()) return null;
  const index = join(filePath, 'index.html');
  try {
    return statSync(index).isFile() ? index : null;
  } catch {
    return null;
  }
}

/** Static file handler shared by GET and HEAD. */
function handleRequest(root, request, response) {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    send(response, 405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }, 'Method Not Allowed');
    return;
  }

  let pathname;
  const rawPath = request.url ?? '/';
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\')) {
    send(response, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return;
  }
  try {
    pathname = new URL(rawPath, 'http://127.0.0.1').pathname;
  } catch {
    send(response, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad Request');
    return;
  }

  const filePath = resolveRequestPath(root, pathname);
  if (filePath === null) {
    send(response, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return;
  }

  // A directory maps to its own index.html (this is how "/" serves the game); it is
  // never listed, and a missing file never falls back to the site index.
  let target = resolveDirectoryIndex(filePath);
  if (target === null) {
    send(response, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }

  // Selecting a directory's index.html adds a component that was not checked by
  // the original request. It must obey exactly the same link/containment rules.
  target = resolveRequestPath(root, '/' + relative(root, target).split(sep).map(encodeURIComponent).join('/'));
  if (target === null) {
    send(response, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return;
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    send(response, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }
  if (!stats.isFile()) {
    send(response, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not Found');
    return;
  }

  const headers = {
    'content-type': contentTypeFor(target),
    'content-length': String(stats.size),
    'cache-control': 'no-cache',
  };
  if (method === 'HEAD') {
    send(response, 200, headers);
    return;
  }
  response.writeHead(200, headers);
  const stream = createReadStream(target);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

/**
 * Creates (but does not start) the static server. The caller decides host, port and
 * when to listen, which keeps tests and the CLI in control of sockets.
 */
export function createReleaseServer(rootDirectory = DEFAULT_ROOT) {
  const root = resolve(rootDirectory);
  return createServer((request, response) => handleRequest(root, request, response));
}

/** Parses --port; returns {port} or {error} with a message for the CLI. */
export function parsePortArgument(argv) {
  let raw;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--port') {
      raw = argv[index + 1];
      if (raw === undefined) return { error: '--port 需要一个端口号。' };
      index += 1;
      continue;
    }
    if (token.startsWith('--port=')) {
      raw = token.slice('--port='.length);
      continue;
    }
    return { error: `无法识别的参数：${token}` };
  }
  if (raw === undefined) return { port: DEFAULT_PORT };

  if (!/^\d+$/.test(raw)) return { error: `端口必须是整数，收到：${raw}` };
  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return { error: `端口必须在 ${MIN_PORT}..${MAX_PORT} 之间，收到：${raw}` };
  }
  return { port };
}

function runCli(argv) {
  const parsed = parsePortArgument(argv);
  if (parsed.error) {
    console.error(parsed.error);
    console.error(`用法：node scripts/serve-release.mjs [--port ${MIN_PORT}..${MAX_PORT}]`);
    return 2;
  }

  // Fail before listening, so the user gets one clear instruction instead of a blank page.
  let indexExists = false;
  try {
    indexExists = statSync(join(DEFAULT_ROOT, 'index.html')).isFile();
  } catch {
    indexExists = false;
  }
  if (!indexExists) {
    console.error(`未找到构建产物：${join(DEFAULT_ROOT, 'index.html')}`);
    console.error('请先在开发副本中运行 npm run build，然后重新启动本工具。');
    return 2;
  }

  const server = createReleaseServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${parsed.port} 已被占用。请换一个端口，例如：`);
      console.error(`  node scripts/serve-release.mjs --port ${parsed.port === MAX_PORT ? DEFAULT_PORT : parsed.port + 1}`);
      console.error('本工具不会结束其他进程。');
    } else {
      console.error(`启动失败：${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(parsed.port, DEFAULT_HOST, () => {
    console.log(`游戏已就绪：http://${DEFAULT_HOST}:${parsed.port}/`);
    console.log(`舰船模型页：http://${DEFAULT_HOST}:${parsed.port}/?mode=models`);
    console.log('按 Ctrl+C 或关闭本窗口停止服务。');
  });
  return 0;
}

const isCli =
  import.meta.main === true ||
  (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isCli) process.exitCode = runCli(process.argv.slice(2));
