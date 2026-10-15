import assert from 'node:assert/strict';
import { withBrowser } from './browser-session.mjs';

await withBrowser('c03-usability', async ({ call, evaluate, capture, settle, pageErrors }) => {
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5188/?qa=1' });
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.__flightQA&&document.querySelector('canvas')?.dataset.ready==='true'){clearInterval(t);resolve(true)}else if(++n>150){clearInterval(t);reject(new Error(document.body.innerText))}},100)})`);
  await evaluate(`document.querySelector('#launch-button').click()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 400 });
  await evaluate('new Promise(r=>setTimeout(r,250))');
  assert.ok((await evaluate('window.__flightQA.input()')).yaw > 0.2);
  // Capture before pausing in the same JS task, so an immediate camera jump cannot escape detection.
  const paused = await evaluate('(()=>{const before={time:__flightQA.world.time,...__flightQA.diagnostics()};__flightQA.pause();return before})()');
  await settle(); await settle();
  const still = await evaluate('({time:__flightQA.world.time,...__flightQA.diagnostics()})');
  assert.deepEqual(still.camera, paused.camera); assert.deepEqual(still.up, paused.up); assert.equal(still.time, paused.time);
  await evaluate(`document.querySelector('#launch-button').click()`);
  assert.deepEqual(await evaluate('__flightQA.input()'), { yaw: 0, pitch: 0, roll: 0, throttle: 0, boost: false, fire: false });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1050, y: 450 });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1050, y: 450, button: 'left', clickCount: 1 });
  assert.equal((await evaluate('__flightQA.input()')).fire, true);
  await evaluate(`document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel'))`);
  assert.equal((await evaluate('__flightQA.input()')).fire, false);
  assert.equal((await evaluate('__flightQA.input()')).yaw, 0);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1050, y: 450, button: 'left', clickCount: 1 });

  // A controlled scene tests visibility independently of AI or player skill.
  await evaluate(`__flightQA.restart();__flightQA.pause();__flightQA.advance(190);(()=>{const w=__flightQA.world;w.player.position.set(0,160,0);w.player.previous.copy(w.player.position);w.player.rotation.setFromAxisAngle(w.player.position.clone().set(1,0,0),-Math.PI/2);const t=w.enemies[0];t.position.set(0,-160,0);t.previous.copy(t.position);w.targetId=t.id;__flightQA.refresh()})()`);
  assert.equal(await evaluate(`document.querySelector('.target-readout').dataset.occluded`), 'true');
  assert.equal(await evaluate(`document.querySelector('.lead-marker').hidden`), true);
  assert.match(await evaluate(`document.querySelector('.target-readout small').textContent`), /舰体遮挡/);
  await evaluate(`document.querySelector('.flight-overlay').hidden=true`); await capture('target-blocked');
  await evaluate(`(()=>{const w=__flightQA.world;w.player.position.set(145,140,300);w.player.previous.copy(w.player.position);w.player.rotation.identity();const t=w.target;t.position.set(145,145,-110);t.previous.copy(t.position);__flightQA.refresh();window.savedMarker=document.querySelector('[data-entity="'+t.id+'"] i');window.savedWing=document.querySelector('#wing-status>div')})()`);
  assert.equal(await evaluate(`document.querySelector('.target-readout').dataset.occluded`), 'false');
  assert.equal(await evaluate(`document.querySelector('.lead-marker').hidden`), false);
  await settle();
  assert.equal(await evaluate(`savedMarker===document.querySelector('[data-entity="'+__flightQA.world.targetId+'"] i')&&savedWing===document.querySelector('#wing-status>div')`), true);
  await capture('target-clear');
  await evaluate(`(()=>{const w=__flightQA.world;w.target.position.set(700,150,800);w.target.previous.copy(w.target.position);__flightQA.refresh()})()`);
  assert.equal(await evaluate(`document.querySelector('[data-entity="'+__flightQA.world.targetId+'"]').classList.contains('offscreen')`), true);
  assert.equal(await evaluate(`document.querySelector('[data-entity="'+__flightQA.world.targetId+'"] i').textContent`), '▴');
  assert.match(await evaluate(`document.querySelector('.target-readout small').textContent`), /按箭头转向/);
  await capture('target-behind');

  await evaluate(`(()=>{const w=__flightQA.world;w.target.position.set(145,145,-2200);w.target.previous.copy(w.target.position);__flightQA.refresh()})()`);
  assert.equal(await evaluate(`document.querySelector('.lead-marker').hidden`), true);
  assert.match(await evaluate(`document.querySelector('.target-readout small').textContent`), /暂无有效截击点/);
  await capture('target-out-of-range');

  const standard = await evaluate(`({ratio:__flightQA.diagnostics().pixelRatio,width:document.querySelector('canvas').width,height:document.querySelector('canvas').height})`);
  await evaluate(`document.querySelector('#quality').value='low';document.querySelector('#quality').dispatchEvent(new Event('change'))`);
  const low = await evaluate(`({ratio:__flightQA.diagnostics().pixelRatio,width:document.querySelector('canvas').width,height:document.querySelector('canvas').height})`);
  assert.equal(standard.ratio, 1); assert.equal(low.ratio, 0.75);
  assert.equal(low.width, standard.width * 0.75); assert.equal(low.height, standard.height * 0.75);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('starfighter-guard:settings:v1')).quality`), 'low');
  await evaluate(`document.querySelector('#quality').value='medium';document.querySelector('#quality').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate('__flightQA.diagnostics().pixelRatio'), standard.ratio);
  const memory = [];
  for (let i = 0; i < 6; i++) {
    await evaluate('__flightQA.restart();__flightQA.pause()'); await settle();
    memory.push((await evaluate('__flightQA.diagnostics()')).geometries);
  }
  assert.equal(new Set(memory).size, 1, 'Reopening a fresh mission should not accumulate GPU geometries');
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await settle(); await capture('compact-paused');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  const button = await evaluate(`(()=>{const r=document.querySelector('#launch-button').getBoundingClientRect();return{top:r.top,bottom:r.bottom}})()`);
  assert.ok(button.top >= 0 && button.bottom <= 640, 'Resume must remain visible on a compact desktop');
  assert.deepEqual(pageErrors, []);
  return { checks: ['actual pointer steering', 'pause freezes camera/up and simulation', 'resume clears steering', 'pointer cancellation releases fire and steering', 'carrier occlusion hides lead and explains obstruction', 'clear target lead visible', 'HUD nodes persist across frames', 'rear target has direction arrow', 'unreachable intercept hides lead and explains why', 'low quality reduces each framebuffer dimension by 25% at DPR 1', 'quality saved and switch back works', 'six restarts retain geometry count', 'compact desktop controls remain accessible'], framebuffer: { standard, low }, restartGeometries: memory, note: 'Occlusion scenes are deliberately staged. These checks do not validate human handling or hardware FPS.' };
});
