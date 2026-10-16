import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { packRelease, listPackageFiles } from './package-release.mjs';
import { withBrowser } from './browser-session.mjs';

// A space in this path verifies that neither the package nor its server assumes
// the repository location. Runtime only uses the package's built files and Node.
const root = resolve(import.meta.dirname, '..');
const pack = packRelease({ projectRoot: root, outputRoot: join(root, 'artifacts/local/release review with spaces') });
assert.equal(listPackageFiles(pack.outputPath).some(file => file.startsWith('node_modules/') || file.startsWith('src/')), false);

await withBrowser(process.argv[2] ?? 'c04-release', async ({ call, evaluate, capture, pageErrors, onEvent }) => {
  const externalRequests = []; const failedRequests = []; const origins = new Set();
  const origin = 'http://127.0.0.1:5188';
  onEvent('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url); origins.add(url.origin);
    if (url.origin === origin) await call('Fetch.continueRequest', { requestId });
    else { externalRequests.push(request.url); await call('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }); }
  });
  onEvent('Network.loadingFailed', ({ errorText, canceled }) => { if (!canceled) failedRequests.push(errorText); });
  await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Fetch.enable', { patterns: [{ urlPattern: 'http*' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const ready = () => evaluate(`new Promise((done,fail)=>{let n=0;const timer=setInterval(()=>{if(document.querySelector('canvas')?.dataset.ready==='true'){clearInterval(timer);done(true)}else if(++n>180){clearInterval(timer);fail(new Error(document.body.innerText))}},100)})`);
  await call('Page.navigate', { url: origin + '/?qa=1' }); await ready();
  assert.equal(await evaluate('typeof window.__flightQA'), 'undefined', 'Production must not expose developer world manipulation');
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'menu');
  await capture('release-briefing');
  await evaluate(`document.querySelector('#launch-button').click()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' });
  await evaluate('new Promise(r=>setTimeout(r,750))');
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
  assert.notEqual(await evaluate(`document.querySelector('#heat-value').textContent`), '0%');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Digit2', key: '2' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Digit2', key: '2' });
  await evaluate('new Promise(r=>setTimeout(r,250))');
  assert.match(await evaluate(`document.querySelector('#wing-status small').textContent`), /归队/);
  await capture('release-flight');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape' });
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'paused');
  await call('Page.navigate', { url: origin + '/?mode=models' }); await ready();
  await evaluate(`document.querySelector('[data-model="eta2"]').click()`);
  assert.equal(await evaluate('document.documentElement.dataset.model'), 'eta2');
  await capture('release-models');
  assert.deepEqual(externalRequests, []); assert.deepEqual(failedRequests, []); assert.deepEqual(pageErrors, []);
  return { checks: ['portable production package in a path with spaces', 'briefing renders', 'actual keyboard shooting changes weapon heat', 'wing recall and pause work', 'model gallery and switching work', 'production hides QA world API', 'all external HTTP(S) requests blocked throughout', 'no external request attempted'], packagePath: pack.outputPath, files: pack.fileCount, bytes: pack.totalBytes, origins: [...origins], externalRequests, failedRequests, note: 'External network requests were blocked in the test page; OS networking was not disabled. This is not a human double-click, hardware FPS or other-browser acceptance test.' };
}, { serverArgs: [join(pack.outputPath, 'scripts/serve-release.mjs'), '--port', '5188'], readyPattern: /游戏已就绪/ });
