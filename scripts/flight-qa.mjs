import assert from 'node:assert/strict';
import { withBrowser } from './browser-session.mjs';

await withBrowser(process.argv[2] ?? 'c02', async ({ call, evaluate, capture, settle, pageErrors }) => {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5188/?qa=1' });
  const waitReady = () => evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(window.__flightQA&&document.querySelector('canvas')?.dataset.ready==='true'){clearInterval(timer);resolve(true)}else if(++n>150){clearInterval(timer);reject(new Error(document.body.innerText))}},100)})`);
  const waitResult = () => evaluate(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(document.documentElement.dataset.flightState==='result'){clearInterval(timer);resolve(true)}else if(++n>100){clearInterval(timer);reject(new Error('Result screen timeout: '+document.documentElement.dataset.flightState))}},100)})`);
  await waitReady(); await capture('briefing');
  await evaluate(`document.querySelector('#launch-button').click()`);
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'playing');
  await evaluate(`window.__flightQA.pause();window.__flightQA.advance(200);window.__flightQA.refresh()`);
  assert.equal(await evaluate('window.__flightQA.world.enemies.length'), 3);
  await evaluate(`document.querySelector('#launch-button').click()`);
  await capture('flight');
  const before = await evaluate('window.__flightQA.snapshot()');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 850, y: 460 });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 850, y: 460, button: 'left', clickCount: 1 });
  await evaluate('new Promise(r=>setTimeout(r,500))');
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 850, y: 460, button: 'left', clickCount: 1 });
  const after = await evaluate('window.__flightQA.snapshot()');
  assert.notDeepEqual(after.player, before.player); assert.ok(after.heat > before.heat);
  await evaluate(`(()=>{const w=window.__flightQA.world;for(let step=0;step<2400&&!w.terminal;step++){const input={yaw:0,pitch:0,roll:0,throttle:0,boost:false,fire:false};const t=w.target;if(t){const v=w.aimPoint(t).sub(w.player.position).applyQuaternion(w.player.rotation.clone().invert()).normalize();input.yaw=Math.max(-1,Math.min(1,Math.atan2(v.x,-v.z)*2));input.pitch=Math.max(-1,Math.min(1,Math.atan2(v.y,Math.hypot(v.x,v.z))*2));input.throttle=t.position.distanceTo(w.player.position)>280?1:-1;input.fire=v.z<-.985;}w.step(1/60,input);}})()`);
  // The pilot above fast-forwards the world without render frames. Reinitialize the
  // camera before taking a representative view instead of photographing artificial lag.
  await evaluate('window.__flightQA.refresh()');
  await capture('combat');
  for (const [code, key] of [['Digit1', '1'], ['Digit2', '2']]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  }
  assert.equal(await evaluate('window.__flightQA.world.wingOrder'), 'follow');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape' });
  const time = await evaluate('window.__flightQA.world.time'); await settle();
  assert.equal(await evaluate('window.__flightQA.world.time'), time);
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'paused');
  await capture('paused');
  await evaluate(`window.__flightQA.restart();window.__flightQA.pause();window.__flightQA.world.carrierHealth=0;window.__flightQA.advance(1);document.querySelector('#launch-button').click()`);
  await waitResult();
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'result');
  await capture('failure');
  await evaluate(`window.__flightQA.restart();window.__flightQA.pause();for(let wave=0;wave<3;wave++){window.__flightQA.advance(wave===0?182:482);window.__flightQA.world.enemies.forEach(e=>e.health=0);window.__flightQA.advance(1)}document.querySelector('#launch-button').click()`);
  await waitResult();
  assert.equal(await evaluate('window.__flightQA.world.mission.phase'), 'won');
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'result');
  await capture('victory');
  await evaluate(`document.querySelector('#restart-button').click();window.__flightQA.pause()`);
  const fresh = await evaluate('window.__flightQA.snapshot()');
  assert.equal(fresh.kills, 0); assert.equal(fresh.health, 100); assert.equal(fresh.carrier, 1000); assert.equal(fresh.active, 0);
  await evaluate(`document.querySelector('#volume').value='0.2';document.querySelector('#volume').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('starfighter-guard:settings:v1')).volume`), 0.2);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked')}})` });
  await call('Page.navigate', { url: 'http://127.0.0.1:5188/?qa=1' }); await waitReady();
  assert.equal(await evaluate('document.documentElement.dataset.flightState'), 'menu');
  assert.deepEqual(pageErrors, []);
  return { checks: ['launch briefing', 'actual keyboard and pointer movement/fire', 'wing recall', 'pause freezes simulation', 'scripted loss branch', 'scripted three-wave win branch', 'restart clears world', 'real localStorage save', 'blocked localStorage property fallback'], note: 'Scripted outcome checks validate transitions; they are not a human gameplay balance test.' };
});
