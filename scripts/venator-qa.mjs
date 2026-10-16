import assert from 'node:assert/strict';
import { withBrowser } from './browser-session.mjs';

await withBrowser(process.argv[2] ?? 'c05-venator', async ({ call, evaluate, capture, pageErrors }) => {
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5188/?mode=models&model=venator' });
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector('canvas[data-ready="true"]')){clearInterval(t);resolve(true)}else if(++n>200){clearInterval(t);reject(Error('model timeout'))}},50)})`);
  const stats = await evaluate(`document.querySelector('#geometry-stats').textContent`);
  for (const view of ['perspective', 'top', 'bridge', 'engines', 'bottom']) {
    await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await capture(view);
  }
  await evaluate(`document.querySelector('[data-model="eta2"]').click()`);
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-detail-view]')].every(b=>b.hidden)`), true);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('[data-model="venator"]').click()`);
  await capture('mobile');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.deepEqual(pageErrors, []);
  return { stats, checks: ['five Venator views', 'detail controls hidden for fighters', '390px no horizontal overflow'] };
});
