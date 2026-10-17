import assert from 'node:assert/strict';
import {build} from 'vite';
import {withBrowser} from './browser-session.mjs';
await build({logLevel:'error',build:{outDir:'artifacts/local/c22-qa-build',emptyOutDir:false},define:{'import.meta.env.DEV':'true'}});
await withBrowser('c22-torpedo',async({call,evaluate,capture,pageErrors})=>{
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate('!!window.__flightQA'))break;await new Promise(r=>setTimeout(r,100));}
 await evaluate(`document.querySelector('#launch-button').click();__flightQA.pause();__flightQA.advance(182);(()=>{const w=__flightQA.world,e=w.enemies[0];w.player.position.set(0,1000,0);w.player.previous.copy(w.player.position);w.player.rotation.identity();w.fighters.splice(1,w.fighters.length-1,e);w.targetId=e.id;e.health=e.maxHealth=10000;for(let i=0;i<125;i++){e.position.copy(w.player.position);e.position.z-=500;e.previous.copy(e.position);__flightQA.advance(1)}__flightQA.refresh()})()`);
 assert.equal(await evaluate('__flightQA.world.torpedoLock'),2);
 await capture('locked');
 await evaluate(`document.querySelector('#launch-button').click()`);
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r'});
 await new Promise(r=>setTimeout(r,150));
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r'});
 await evaluate('__flightQA.pause()');
 const result=await evaluate(`({cooldowns:__flightQA.world.torpedoCooldowns,ammo:document.querySelector('#torpedo-ammo').textContent,missiles:__flightQA.world.bolts.filter(b=>b.targetId).length,text:document.querySelector('#torpedo-status').textContent})`);
 assert.ok(result.cooldowns[0]>17);assert.equal(result.cooldowns[1],0);assert.equal(result.missiles,1);assert.match(result.ammo,/2号 就绪/);assert.doesNotMatch(result.text,/冷却/);
 await evaluate("document.querySelector('.flight-overlay').style.display='none'");await evaluate("document.documentElement.dataset.flightState='playing'");await capture('one-ready');
 await evaluate("(()=>{const w=__flightQA.world,e=w.enemies[0];for(let i=0;i<125;i++){e.position.copy(w.player.position);e.position.z-=500;e.previous.copy(e.position);__flightQA.advance(1)}__flightQA.refresh()})()");
 await evaluate("document.querySelector('#launch-button').click()");
 await call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r'});for(let i=0;i<50;i++){if(await evaluate('__flightQA.world.torpedoCooldowns[1]>0'))break;await new Promise(r=>setTimeout(r,100));}
 await call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r'});await evaluate('__flightQA.pause();__flightQA.refresh()');
 const slots=await evaluate('__flightQA.world.torpedoCooldowns');assert.ok(slots[0]>14&&slots[1]>17&&slots[1]>slots[0],JSON.stringify({slots,state:await evaluate("__flightQA.snapshot()"),lock:await evaluate("__flightQA.world.torpedoLock")}));
 assert.match(await evaluate("document.querySelector('#torpedo-status').textContent"),/冷却/);await evaluate("document.documentElement.dataset.flightState='playing'");await capture('both-cooling');
 await evaluate('__flightQA.restart();__flightQA.pause()');assert.deepEqual(await evaluate('__flightQA.world.torpedoCooldowns'),[0,0]);
 assert.deepEqual(pageErrors,[]);return{result,checks:['continuous lock','two actual R key launches','one slot ready while other cools','two independent cooldowns in HUD','restart replenishes both'],note:'Target staged in front of player for lock acquisition; software-rendered screenshots are not hardware performance evidence.'};
},{serverArgs:['--input-type=module','-e',"import{createReleaseServer}from'./scripts/serve-release.mjs';createReleaseServer('artifacts/local/c22-qa-build').listen(5188,'127.0.0.1',()=>console.log('Local: ready'))"]});
