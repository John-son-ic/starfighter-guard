import assert from 'node:assert/strict';
import { build } from 'vite';
import { withBrowser } from './browser-session.mjs';

// Isolated local QA build: test hooks enabled here, never in the production build.
await build({logLevel:'error',build:{outDir:'artifacts/local/c07-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c11-fatal-collision', async ({call,evaluate,capture,pageErrors})=>{
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
  let ready=false;
  for(let n=0;n<100;n++) {ready=await evaluate(`!!window.__flightQA&&document.querySelector('canvas')?.dataset.ready==='true'`);if(ready)break;await new Promise(r=>setTimeout(r,150));}
  assert.ok(ready,'QA build initialized');
  await evaluate(`document.querySelector('#launch-button').click();__flightQA.pause();(()=>{const w=__flightQA.world;w.player.position.set(100,5,0);w.player.previous.copy(w.player.position);w.player.rotation.set(-Math.SQRT1_2,0,0,Math.SQRT1_2);__flightQA.refresh()})()`);
  await evaluate(`__flightQA.advance(30)`);
  const collision=await evaluate(`({snapshot:__flightQA.snapshot(),diagnostics:__flightQA.diagnostics(),collisions:__flightQA.world.playerCollisionVersion})`);
  assert.ok(collision.collisions>0);assert.equal(collision.snapshot.health,0);assert.equal(await evaluate(`__flightQA.world.mission.phase`),'lost');
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  assert.ok(distance(collision.snapshot.player,collision.diagnostics.camera)>9);
  await evaluate(`document.querySelector('#launch-button').click()`);
  for(let n=0;n<100;n++){if(await evaluate(`document.documentElement.dataset.flightState==='result'`))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate(`document.documentElement.dataset.flightState`),'result');
  await capture('collision-result');
  await evaluate(`document.querySelector('#restart-button').click()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1000,y:400});
  await new Promise(r=>setTimeout(r,1000));
  const after=await evaluate(`({snapshot:__flightQA.snapshot(),diagnostics:__flightQA.diagnostics(),input:__flightQA.input()})`);
  assert.equal(after.snapshot.state,'playing');assert.ok(after.input.yaw>0.2);
  assert.ok(distance(after.snapshot.player,collision.snapshot.player)>1);
  await capture('after-collision');
  await evaluate(`__flightQA.restart();__flightQA.pause();__flightQA.advance(182);(()=>{const w=__flightQA.world;w.player.position.set(430,150,400);w.player.previous.copy(w.player.position);w.player.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(w.player.position,w.player.position.clone().set(0,-25,180),w.player.position.clone().set(0,1,0)));for(const [i,e]of w.enemies.entries()){e.position.set(220+i*28,140+i*12,140+i*65);e.previous.copy(e.position)}for(let i=0;i<1800&&!w.turrets.some(t=>t.flash>0);i++)w.step(1/60,{yaw:0,pitch:0,roll:0,throttle:0,boost:false,fire:false});__flightQA.advance(1);__flightQA.refresh()})()`);
  const battery=await evaluate(`({shots:__flightQA.world.turretShots,flashes:__flightQA.world.turrets.filter(t=>t.flash>0).length,bolts:__flightQA.world.bolts.filter(b=>b.owner.startsWith('turret-')).length,escorts:document.querySelectorAll('#wing-status>div').length})`);
  assert.ok(battery.shots>0&&battery.bolts>0&&battery.flashes>0);assert.equal(battery.escorts,4);
  await evaluate(`(()=>{const w=__flightQA.world,t=w.turrets.find(t=>t.flash>0),p=w.player;p.position.copy(t.position).add(p.position.clone().set(Math.sign(t.position.x)*180,100,140));p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,t.position,p.position.clone().set(0,1,0)));__flightQA.refresh()})()`);
  // Freeze a real emitted shell/flash for inspection; only hide the pause card for this image.
  await evaluate(`document.querySelector('.flight-overlay').style.display='none'`);
  await capture('carrier-battery');
  await evaluate(`document.querySelector('.flight-overlay').style.removeProperty('display')`);
  await evaluate(`__flightQA.restart();__flightQA.pause();for(let wave=0;wave<3;wave++){__flightQA.advance(wave===0?182:602);__flightQA.world.enemies.forEach(e=>e.health=0);__flightQA.advance(1)}__flightQA.advance(241);__flightQA.world.generator.health=0;__flightQA.advance(1);__flightQA.world.bridge.health=0;__flightQA.advance(1);document.querySelector('#launch-button').click()`);
  for(let n=0;n<100;n++){if(await evaluate(`document.documentElement.dataset.flightState==='result'`))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate(`__flightQA.world.mission.phase`),'won');
  assert.equal(await evaluate(`__flightQA.world.mission.kills`),24);
  await capture('three-wave and frigate-victory');
  await evaluate(`document.querySelector('#restart-button').click();__flightQA.pause()`);
  assert.equal(await evaluate(`__flightQA.world.turretShots`),0);
  assert.deepEqual(pageErrors,[]);
  return {collision,after,battery,checks:['actual collision and camera clearance','fatal collision result and pointer steering after restart','four escort HUD rows','carrier muzzle flash and physical shells','three-wave and frigate result and restart reset'],note:'Staged outcome checks are not a human balance or hardware FPS test.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c07-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
