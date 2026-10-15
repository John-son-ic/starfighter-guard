import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Windows Chrome + native CDP. No automation package or persistent browser profile required.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'artifacts/c01');
const profile = resolve(root, `artifacts/local/qa-${Date.now()}`);
const downloads = join(profile, 'downloads');
await mkdir(output, { recursive: true }); await mkdir(downloads, { recursive: true });
const browserPath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: root, stdio: 'pipe' });
let chrome;
let socket;
const pending = new Map();
const pageErrors = [];
let sequence = 0;

function send(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: resolvePromise, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
function waitOutput(child, pattern) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Process startup timeout')), 15000);
    let text = '';
    const onData = chunk => {
      text += chunk;
      const match = text.match(pattern);
      if (match) { clearTimeout(timeout); resolvePromise(match); }
    };
    child.stdout?.on('data', onData); child.stderr?.on('data', onData);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Process exited ${code}: ${text.slice(-1200)}`)); });
  });
}

try {
  await waitOutput(server, /Local:/);
  chrome = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-component-update', '--disable-sync', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'pipe', windowsHide: true });
  const [, endpoint] = await waitOutput(chrome, /DevTools listening on (ws:\/\/[^\s]+)/);
  socket = new WebSocket(endpoint);
  await new Promise((resolvePromise, reject) => { socket.addEventListener('open', resolvePromise, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const promise = pending.get(message.id);
      if (!promise) return;
      clearTimeout(promise.timeout); pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
      else promise.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description ?? ''));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const viewport = async (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const screenshot = async name => {
    await settle();
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await viewport(1440, 1000);
  await send('Page.navigate', { url: 'http://127.0.0.1:5187/?mode=models' }, sessionId);
  await evaluate(`new Promise((resolve, reject) => { let count=0; const timer=setInterval(() => { if (document.querySelector('canvas')?.dataset.ready === 'true') {clearInterval(timer);resolve(true)} else if (++count>150) {clearInterval(timer);reject(new Error(document.body.innerText))} },100) })`);
  const report = { browser: await send('Browser.getVersion'), renderer: 'SwiftShader software rendering (visual QA only, no GPU performance claim)', checks: [] };
  for (const id of ['venator', 'eta2', 'arc170', 'vulture']) {
    await evaluate(`document.querySelector('[data-model="${id}"]').click()`);
    assert.equal(await evaluate('document.documentElement.dataset.model'), id);
    await screenshot(id);
    await evaluate(`document.querySelector('[data-view="top"]').click()`);
    await screenshot(`${id}-top`);
    report.checks.push(`${id}: selection, perspective, top view`);
  }
  await evaluate(`document.querySelector('[data-view="perspective"]').click()`);
  await settle();
  const beforeOrbit = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 950, y: 470, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1070, y: 510, button: 'left', buttons: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1070, y: 510, button: 'left', clickCount: 1 }, sessionId);
  await settle();
  const afterOrbit = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  assert.notEqual(beforeOrbit.data, afterOrbit.data, 'Dragging updates the orbit camera');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 950, y: 470, deltaY: 120, deltaX: 0 }, sessionId);
  await settle();
  const afterZoom = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  assert.notEqual(afterOrbit.data, afterZoom.data, 'Mouse wheel updates the camera distance');
  report.checks.push('actual pointer drag and mouse wheel change the rendered view');
  await evaluate(`document.querySelector('[data-view="rear"]').click()`); await screenshot('vulture-rear');
  await evaluate(`document.querySelector('[data-model="venator"]').click();document.querySelector('[data-view="rear"]').click()`); await screenshot('venator-rear');
  await evaluate(`document.querySelector('#wireframe').click()`);
  assert.equal(await evaluate(`document.querySelector('#wireframe').getAttribute('aria-pressed')`), 'true');
  await screenshot('venator-wireframe');
  await evaluate(`document.querySelector('#wireframe').click(); document.querySelector('#rotate').click()`);
  assert.equal(await evaluate(`document.querySelector('#rotate').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('#rotate').click();document.querySelector('#scale-view').click()`);
  assert.equal(await evaluate('document.documentElement.dataset.model'), 'formation');
  await screenshot('formation');
  await evaluate(`document.querySelector('#scale-view').click()`); await screenshot('formation-close');
  await evaluate(`document.querySelector('[data-model="eta2"]').click();document.querySelector('#export').click()`);
  await evaluate(`new Promise((resolve,reject) => {let i=0;const timer=setInterval(()=>{if(document.querySelector('#render-status').textContent.includes('已导出')){clearInterval(timer);resolve(true)}else if(++i>100){clearInterval(timer);reject(new Error('Export timeout'))}},50)})`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 300));
  const filename = (await readdir(downloads)).find(name => name.endsWith('.glb'));
  assert.ok(filename, 'Browser GLB download exists');
  const bytes = await readFile(join(downloads, filename));
  assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
  report.checks.push('wireframe and autorotate toggles', 'true-scale formation and close view', 'browser GLB export download and magic header');
  await viewport(390, 844); await settle(); await screenshot('mobile');
  const metrics = await evaluate('({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })');
  assert.ok(metrics.scrollWidth <= metrics.width, 'No horizontal overflow on narrow viewport');
  report.checks.push('390px viewport: no horizontal overflow');
  assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
  report.pageErrors = pageErrors;
  await writeFile(join(output, 'browser-checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} socket.close(); }
  chrome?.kill(); server.kill();
  for (const promise of pending.values()) { clearTimeout(promise.timeout); promise.reject(new Error('Browser shutdown')); }
}
