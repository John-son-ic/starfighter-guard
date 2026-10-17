import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c17-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c17-batteries',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate("document.querySelector('#launch-button').click();__flightQA.world.stage='shield';__flightQA.world.player.position.set(0,400,0);__flightQA.world.player.previous.copy(__flightQA.world.player.position);__flightQA.world.player.rotation.identity()");
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});
 await evaluate('new Promise(r=>setTimeout(r,100))');await evaluate('__flightQA.pause()');
 assert.ok(await evaluate('__flightQA.world.player.position.z < -2400'));
 assert.ok(await evaluate('__flightQA.world.jumpCooldown > 9'));
 assert.equal(await evaluate('__flightQA.world.player.weapon.heat'),0);
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
 await evaluate("document.querySelector('.flight-overlay').style.display='none';__flightQA.refresh()");await capture('jump');
 await evaluate(`(()=>{const w=__flightQA.world,p=w.player;w.generator.health=0;w.stage='assault';w.jumpFlash=0;p.position.set(470,340,-4300);p.previous.copy(p.position);p.rotation.setFromRotationMatrix(w.carrier.matrix.clone().lookAt(p.position,w.frigate.position,p.position.clone().set(0,1,0)));w.targetId=w.enemyGuns[1].id;__flightQA.refresh()})()`);
 assert.equal(await evaluate('__flightQA.world.exposedGuns.length'),6);await capture('batteries');
 await call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});await capture('batteries-small');
 await evaluate('__flightQA.world.enemyGuns[1].health=0;__flightQA.refresh()');assert.equal(await evaluate('__flightQA.world.exposedGuns.length'),5);await capture('gun-destroyed');
 await evaluate('__flightQA.restart();__flightQA.pause()');assert.equal(await evaluate('__flightQA.world.jumpCooldown'),0);assert.equal(await evaluate('__flightQA.world.enemyGuns.filter(g=>g.health>0).length'),12);
 assert.deepEqual(pageErrors,[]);return {checks:['actual Space input jumps without laser heat','jump cooldown','six gun targets and destroyed target removal','restart resets jump and guns','1440 and 1024 viewport screenshots'],note:'Gun screenshots use stage/health fixtures; real damage verified by Node tests.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c17-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
