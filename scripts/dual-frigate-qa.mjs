import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c21-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c21-dual-frigates',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate(`document.querySelector('#launch-button').click();__flightQA.pause();for(let wave=0;wave<3;wave++){__flightQA.advance(wave?602:182);__flightQA.world.enemies.forEach(e=>e.health=0);__flightQA.advance(1)}`);
 assert.equal(await evaluate('__flightQA.world.stage'),'arrival');
 await evaluate(`document.querySelector('.flight-overlay').style.display='none';__flightQA.advance(241);(()=>{const w=__flightQA.world,p=w.player;p.position.set(0,500,-3000);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,p.position.clone().set(0,0,-5000),p.position.clone().set(0,1,0)));__flightQA.refresh()})()`);
 assert.deepEqual(await evaluate('__flightQA.world.capitalShips.map(s=>s.generator.health)'),[360,360]);await capture('two-shields');
 await evaluate(`__flightQA.world.generator.health=0;__flightQA.advance(1);__flightQA.refresh()`);
 assert.equal(await evaluate('__flightQA.world.capitalShips[1].generator.health'),360);await capture('first-shield-down');
 const safe=()=>evaluate(`(()=>{const w=__flightQA.world,p=w.player;p.position.set(1800,1400,0);p.previous.copy(p.position);p.rotation.identity()})()`);
 await safe();await evaluate('__flightQA.advance(650,{yaw:.3});__flightQA.refresh()');
 assert.deepEqual(await evaluate('__flightQA.world.capitalShips.map(s=>s.launched)'),[3,0]);
 assert.deepEqual(await evaluate('__flightQA.world.bombers.map(f=>[f.id,f.maxHealth])'),[['gold-1',320]]);
 assert.equal(await evaluate('__flightQA.world.fighters.filter(f=>f.id===\'wing-5\'||f.id===\'wing-6\').length'),2);
 await evaluate(`(()=>{const w=__flightQA.world,p=w.player,b=w.bombers[0];p.position.copy(b.position).add(p.position.clone().set(35,30,100));p.previous.copy(p.position);p.rotation.copy(b.rotation);__flightQA.refresh()})()`);await capture('first-team');
 await safe();await evaluate('__flightQA.world.bridge.health=0;__flightQA.advance(1);__flightQA.refresh()');
 assert.equal(await evaluate('__flightQA.world.terminal'),false);assert.equal(await evaluate('__flightQA.world.capitalShips[0].destroyed'),true);
 await evaluate('__flightQA.world.capitalShips[1].generator.health=0;__flightQA.advance(650,{yaw:.3});__flightQA.refresh()');
 assert.deepEqual(await evaluate('__flightQA.world.capitalShips.map(s=>s.launched)'),[3,3]);
 assert.equal(await evaluate('__flightQA.world.fighters.filter(f=>f.id===\'wing-7\'||f.id===\'wing-8\').length'),2);
 assert.ok(await evaluate('__flightQA.world.fighters.filter(f=>f.model===\'arc170\').every(f=>f.maxHealth===120)'));
 await evaluate(`(()=>{const w=__flightQA.world,p=w.player;p.position.set(650,320,-4200);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,w.capitalShips[1].bridge.position,p.position.clone().set(0,1,0)));__flightQA.refresh()})()`);
 await call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});await capture('second-ship-small');
 await evaluate(`__flightQA.world.capitalShips[1].bridge.health=0;__flightQA.advance(1);document.querySelector('.flight-overlay').style.removeProperty('display');document.querySelector('#launch-button').click()`);
 for(let i=0;i<80;i++){if(await evaluate("document.documentElement.dataset.flightState==='result'"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('__flightQA.world.mission.phase'),'won');await capture('victory');
 await evaluate(`document.querySelector('#restart-button').click();__flightQA.pause()`);
 assert.equal(await evaluate('__flightQA.world.stage'),'defense');assert.equal(await evaluate('__flightQA.world.hangarOpen'),0);
 assert.deepEqual(await evaluate('__flightQA.world.capitalShips.map(s=>[s.generator.health,s.bridge.health,s.launched,s.destroyed])'),[[360,1800,0,false],[360,1800,0,false]]);
 assert.equal(await evaluate('__flightQA.world.enemyGuns.filter(g=>g.health>0).length'),12);
 assert.deepEqual(pageErrors,[]);return{checks:['three waves then two ships','independent shield rendering','first break launches one Y-wing and two escorts','first ship kill does not win','second break launches second team','320 bomber / 120 ARC health','both ships required for victory','restart resets both ships and twelve turrets','1440 and 1024 viewport screenshots'],note:'Health/stage fixtures used for browser progression; actual damage and flight covered separately by Node campaign and bomber tests.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c21-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
