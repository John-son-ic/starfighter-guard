import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c25-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c25-tactical',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate(`document.querySelector('#launch-button').click();__flightQA.pause();__flightQA.advance(182);(()=>{const w=__flightQA.world,p=w.player;w.stage='assault';w.generator.health=0;w.capitalShips[0].launchTime=8;w.capitalShips[0].launched=3;p.position.set(-250,330,-4200);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,w.frigate.position,p.position.clone().set(0,1,0)));w.targetId=w.enemyGuns[0].id;const b={...p,id:'gold-1',model:'ywing',position:p.position.clone().add(p.position.clone().set(-180,0,-250)),previous:p.position.clone(),rotation:p.rotation.clone(),radius:9,health:320,maxHealth:320};b.previous.copy(b.position);w.fighters.push(b);const e=w.enemies[0];e.position.copy(b.position).add(e.position.clone().set(0,0,100));e.previous.copy(e.position);const pos=b.position.clone().add(b.position.clone().set(0,0,30));w.bolts.push({id:999,owner:e.id,team:'separatist',position:pos,previous:pos.clone(),velocity:pos.clone().set(0,0,-600),damage:5,life:1});w.updateBolts(.1);__flightQA.refresh();document.querySelector('.flight-overlay').style.display='none'})()`);
 assert.match(await evaluate("document.querySelector('#target-name').textContent"),/重型主炮/);
 assert.match(await evaluate("document.querySelector('.target-purpose').textContent"),/母舰/);
 assert.match(await evaluate("document.querySelector('#threat-lines').textContent"),/金色 1 遭到攻击/);
 assert.match(await evaluate("document.querySelector('[data-entity=enemy-gun-1]').className"),/heavy-target/);await capture('heavy-and-warning');
 await evaluate("document.querySelector('#launch-button').click()");
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'Digit3',key:'3'});await call('Input.dispatchKeyEvent',{type:'keyUp',code:'Digit3',key:'3'});await evaluate('__flightQA.pause()');
 assert.ok(await evaluate('__flightQA.world.targetId===__flightQA.world.enemies[0].id'));
 await evaluate('__flightQA.world.targetId=__flightQA.world.enemyGuns[1].id;__flightQA.refresh()');assert.match(await evaluate("document.querySelector('#target-name').textContent"),/近防炮/);assert.match(await evaluate("document.querySelector('.target-purpose').textContent"),/Y翼/);
 await call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});await capture('defense-small');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate('__flightQA.world.enemyGuns[0].health=0;__flightQA.world.bridge.health=500;__flightQA.refresh()');
 assert.equal(await evaluate('__flightQA.diagnostics().capitalEffects.wrecks'),1);assert.ok(await evaluate('__flightQA.diagnostics().capitalEffects.fires>0'));await capture('damage-and-wreck');
 await evaluate(`__flightQA.world.capitalShips.forEach(s=>{s.generator.health=0;s.bridge.health=0});__flightQA.advance(1);document.querySelector('#launch-button').click()`);
 for(let i=0;i<100;i++){if(await evaluate("document.documentElement.dataset.flightState==='result'&&__flightQA.diagnostics().capitalEffects.deathAges[0]>.7"))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('__flightQA.world.mission.phase'),'won');await evaluate("document.querySelector('.flight-overlay').style.display='none'");await capture('staged-destruction');
 for(let i=0;i<100;i++){if(await evaluate('__flightQA.diagnostics().capitalEffects.deathAges[0]>=4'))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('__flightQA.diagnostics().capitalEffects.fires'),0);
 await evaluate('__flightQA.restart();__flightQA.pause();__flightQA.refresh()');const count=await evaluate('__flightQA.diagnostics().geometries');
 await evaluate('__flightQA.restart();__flightQA.pause();__flightQA.refresh()');assert.equal(await evaluate('__flightQA.diagnostics().geometries'),count);
 assert.equal(await evaluate('__flightQA.world.threats.length'),0);assert.equal(await evaluate('__flightQA.diagnostics().capitalEffects.wrecks'),0);assert.deepEqual(await evaluate('__flightQA.diagnostics().capitalEffects.deathAges'),[0,0]);
 assert.deepEqual(pageErrors,[]);return{checks:['heavy and point defense labels and purposes','real bomber-hit warning','actual Digit3 threat selection','1440 and 1024 layout','destroyed turret wreck and damaged hull fire','staged destruction continues at result','restart clears effects and threats without geometry growth'],note:'Combat positions and health staged for UI/effect inspection; actual full campaign and damage validated separately in Node. No hardware FPS or human balance claim.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c25-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
