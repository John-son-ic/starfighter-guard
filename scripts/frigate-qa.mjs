import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c16-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c16-frigate',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const wait=async()=>{for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))return;await new Promise(r=>setTimeout(r,100));}throw Error('not ready')};
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});await wait();
 await evaluate(`document.querySelector('#launch-button').click();__flightQA.pause();for(let wave=0;wave<3;wave++){__flightQA.advance(wave?602:182);__flightQA.world.enemies.forEach(e=>e.health=0);__flightQA.advance(1)}`);
 assert.equal(await evaluate('__flightQA.world.stage'),'arrival');
 await evaluate(`document.querySelector('.flight-overlay').style.display='none';__flightQA.refresh()`);await capture('arrival');
 await evaluate(`__flightQA.advance(241);(()=>{const w=__flightQA.world,p=w.player;p.position.set(420,260,-4100);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,w.generator.position,p.position.clone().set(0,1,0)));__flightQA.refresh()})()`);
 assert.equal(await evaluate('__flightQA.world.stage'),'shield');await capture('shield');
 await evaluate(`__flightQA.world.generator.health=0;__flightQA.advance(181);(()=>{const w=__flightQA.world,p=w.player;p.position.set(160,140,-20);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,p.position.clone().set(0,-25,-200),p.position.clone().set(0,1,0)));__flightQA.refresh()})()`);await capture('hangar-opening');
 await evaluate(`__flightQA.world.player.position.set(1800,1400,0);__flightQA.world.player.rotation.identity();__flightQA.advance(470);__flightQA.refresh()`);
 assert.equal(await evaluate('__flightQA.world.stage'),'assault');assert.equal(await evaluate('__flightQA.world.bombers.length'),3);
 await evaluate(`(()=>{const w=__flightQA.world,p=w.player,b=w.bombers[0];p.position.copy(b.position).add(p.position.clone().set(35,30,100));p.previous.copy(p.position);p.rotation.copy(b.rotation);__flightQA.refresh()})()`);await capture('escort');
 await evaluate(`__flightQA.world.bridge.health=0;__flightQA.advance(1);document.querySelector('.flight-overlay').style.removeProperty('display');document.querySelector('#launch-button').click()`);
 for(let i=0;i<80;i++){if(await evaluate("document.documentElement.dataset.flightState==='result'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('__flightQA.world.mission.phase'),'won');await capture('victory');
 await evaluate(`document.querySelector('#restart-button').click();__flightQA.pause()`);assert.equal(await evaluate('__flightQA.world.stage'),'defense');assert.equal(await evaluate('__flightQA.world.hangarOpen'),0);
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?mode=models&model=munificent'});await wait();await capture('munificent');
 await evaluate(`document.querySelector('[data-view="rear"]').click()`);await capture('munificent-rear');
 await evaluate(`document.querySelector('[data-model="ywing"]').click();document.querySelector('[data-view="perspective"]').click()`);await capture('ywing');
 assert.deepEqual(pageErrors,[]);return{checks:['three waves then arrival','shield stage','opening hangar','three bombers launched','victory and restart','two new gallery models'],note:'Stage progression screenshots use health edits; actual damage and flight are separately covered by Node pilot and bomber tests.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c16-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
