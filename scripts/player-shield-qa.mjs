import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c23-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c23-player-shield',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate("document.querySelector('#launch-button').click()");
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyF',key:'f'});
 for(let i=0;i<50;i++){if(await evaluate('__flightQA.world.playerShieldActive'))break;await new Promise(r=>setTimeout(r,100));}
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyF',key:'f'});await evaluate('__flightQA.pause()');
 assert.ok(await evaluate('__flightQA.world.playerShieldActive'));assert.match(await evaluate("document.querySelector('#shield-status').textContent"),/护盾开启/);
 const frozen=await evaluate('__flightQA.world.shieldTime');await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('__flightQA.world.shieldTime'),frozen);
 await evaluate("document.querySelector('.flight-overlay').style.display='none';__flightQA.refresh()");await capture('active');
 await evaluate(`(()=>{const w=__flightQA.world,p=w.player;p.position.set(0,-40,-620);p.previous.copy(p.position);p.rotation.set(0,1,0,0);__flightQA.advance(90);__flightQA.refresh()})()`);
 assert.equal(await evaluate('__flightQA.world.player.health'),100);assert.ok(await evaluate('__flightQA.world.playerCollisionVersion>0'));assert.equal(await evaluate('__flightQA.world.terminal'),false);await capture('bounce');
 await evaluate('__flightQA.world.player.position.set(1800,1400,0);__flightQA.advance(301,{yaw:.3});__flightQA.refresh()');assert.equal(await evaluate('__flightQA.world.playerShieldActive'),false);assert.match(await evaluate("document.querySelector('#shield-status').textContent"),/护盾冷却/);
 await call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});await capture('cooldown-small');
 await evaluate('__flightQA.restart();__flightQA.pause()');assert.equal(await evaluate('__flightQA.world.shieldTime'),0);assert.equal(await evaluate('__flightQA.world.shieldCooldown'),0);
 assert.deepEqual(pageErrors,[]);return{checks:['actual F activation','pause freezes shield timer','visible shield and edge HUD','actual carrier bounce survives','expiry and cooldown','restart resets'],note:'Position fixture used to approach carrier; actual collision and fixed simulation steps exercised. No hardware FPS claim.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c23-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
