import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function withBrowser(folder, run, { serverArgs = ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], readyPattern = /Local:/ } = {}) {
  const output = resolve(root, `artifacts/${folder}`);
  const profile = resolve(root, `artifacts/local/${folder}-${Date.now()}`);
  await mkdir(output, { recursive: true });
  let browser; let socket; let sequence = 0;
  const pending = new Map(); const pageErrors = []; const handlers = new Map();
  const waitOutput = (process, pattern) => new Promise((done, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('Startup timeout: ' + text.slice(-500))), 15000);
    const read = chunk => { text += chunk; const match = text.match(pattern); if (match) { clearTimeout(timer); done(match); } };
    process.stdout.on('data', read); process.stderr.on('data', read);
    process.once('error', reject); process.once('exit', code => { clearTimeout(timer); reject(new Error('Process exited: ' + code)); });
  });
  const server = spawn(process.execPath, serverArgs, { cwd: root, stdio: 'pipe' });
  const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    await waitOutput(server, readyPattern);
    browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-extensions', '--disable-component-update', '--disable-sync', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'pipe', windowsHide: true });
    const [, endpoint] = await waitOutput(browser, /DevTools listening on (ws:\/\/[^\s]+)/);
    socket = new WebSocket(endpoint);
    await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const item = pending.get(message.id); if (!item) return;
        clearTimeout(item.timer); pending.delete(message.id);
        if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.done(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      for (const handler of handlers.get(message.method) ?? []) Promise.resolve(handler(message.params)).catch(error => pageErrors.push(String(error)));
    });
    const createPage = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
    const call = (method, params = {}) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    const settle = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const capture = async name => { await call('Page.bringToFront');await settle(); const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64')); };
    return {call,evaluate,capture,settle};
    };
    const {call,evaluate,capture,settle}=await createPage();
    const onEvent = (method, handler) => { const list = handlers.get(method) ?? []; list.push(handler); handlers.set(method, list); };
    const result = await run({ call, evaluate, capture, settle, output, pageErrors, onEvent, createPage });
    await writeFile(join(output, 'browser-checks.json'), JSON.stringify({ ...result, browser: await send('Browser.getVersion'), renderer: 'SwiftShader software rendering; no hardware FPS claim', pageErrors }, null, 2) + '\n');
    console.log(JSON.stringify({ ...result, pageErrors }));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} socket.close(); }
    browser?.kill(); server.kill();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')); }
  }
}
