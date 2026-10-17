import assert from 'node:assert/strict';
import {withBrowser} from './browser-session.mjs';
await withBrowser('c26-checkpoint-feedback',async({call,evaluate,capture,pageErrors})=>{
 const click=async(selector)=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:5188/?qa=1'});
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('canvas')?.dataset.ready==='true'"))break;await new Promise(r=>setTimeout(r,100));}
 await click('#launch-button');await evaluate('__flightQA.pause()');
 assert.equal(await evaluate("document.querySelector('#checkpoint-button').hidden"),true);
 await evaluate(`(()=>{const q=__flightQA,w=q.world;w.player.position.set(1800,1400,0);w.player.previous.copy(w.player.position);for(let wave=0;wave<3;wave++){q.advance(wave?602:182,{yaw:.3});if(wave===2){w.carrierHealth=2600;w.player.health=58;w.fighters.find(f=>f.id==='wing-1').health=55;w.fighters.find(f=>f.id==='wing-4').health=0;}w.enemies.forEach(e=>e.health=0);q.advance(1)}q.refresh()})()`);
 assert.equal(await evaluate('__flightQA.world.stage'),'arrival');assert.equal(await evaluate('__flightQA.world.hasCheckpoint'),true);
 const expected=await evaluate('({...__flightQA.world.checkpointInfo,kills:__flightQA.world.mission.kills})');assert.equal(expected.friendlies,3);
 await evaluate("document.querySelector('#launch-button').click();__flightQA.world.player.health=0;__flightQA.advance(1)");
 assert.equal(await evaluate('document.documentElement.dataset.flightState'),'result');assert.equal(await evaluate("document.querySelector('#checkpoint-button').hidden"),false);
 assert.match(await evaluate("document.querySelector('#checkpoint-note').textContent"),/58%.*65%.*3 架/);await capture('checkpoint-result');
 await call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});
 await evaluate("document.querySelector('#checkpoint-button').scrollIntoView({block:'center'})");await capture('checkpoint-small');
 await click('#checkpoint-button');await evaluate('__flightQA.pause()');assert.equal(await evaluate('__flightQA.world.stage'),'arrival');assert.equal(await evaluate('__flightQA.world.player.health'),expected.playerHealth);assert.equal(await evaluate('__flightQA.world.carrierHealth'),expected.carrierHealth);assert.equal(await evaluate('__flightQA.world.mission.kills'),expected.kills);assert.equal(await evaluate('__flightQA.world.fighters.length'),4);
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate("document.querySelector('#launch-button').click();__flightQA.world.carrierHealth=0;__flightQA.advance(1)");await click('#checkpoint-button');await evaluate('__flightQA.pause()');assert.equal(await evaluate('__flightQA.world.carrierHealth'),2600);
 await evaluate("document.querySelector('#launch-button').click();__flightQA.world.player.health=0;__flightQA.advance(1)");await click('#restart-button');await evaluate('__flightQA.pause()');assert.equal(await evaluate('__flightQA.world.hasCheckpoint'),false);assert.equal(await evaluate('__flightQA.world.stage'),'defense');
 // Real swept bolt hits the active player shield; scene receives the world event.
 await evaluate(`(()=>{const q=__flightQA,w=q.world,p=w.player;p.position.set(0,150,300);p.previous.copy(p.position);p.rotation.identity();q.refresh();q.advance(1,{shield:true});const pos=p.position.clone();pos.z+=30;w.bolts.push({id:900,owner:'test-enemy',team:'separatist',position:pos,previous:pos.clone(),velocity:pos.clone().set(0,0,-600),life:1,damage:12});q.advance(5)})()`);
 assert.equal(await evaluate('__flightQA.world.player.health'),100);assert.ok(await evaluate('__flightQA.diagnostics().shieldPulse>.7'));
 await evaluate("__flightQA.render(.1);document.querySelector('.flight-overlay').hidden=true");
 assert.ok(await evaluate('__flightQA.diagnostics().shieldPulse>0&&__flightQA.diagnostics().shieldPulse<1'));await capture('shield-ripple');
 // An actual hull intersection produces bounce and a bounded camera impulse.
 await evaluate(`(()=>{const q=__flightQA,w=q.world,p=w.player;p.position.set(0,-40,-622);p.previous.copy(p.position);p.rotation.set(0,1,0,0);p.speed=190;q.advance(25)})()`);
 assert.equal(await evaluate('__flightQA.world.player.health'),100);assert.ok(await evaluate('__flightQA.diagnostics().bounceTime>0'));await capture('shield-bounce');
 const paused=await evaluate('__flightQA.diagnostics().bounceTime');await new Promise(r=>setTimeout(r,150));assert.equal(await evaluate('__flightQA.diagnostics().bounceTime'),paused);
 await evaluate("document.querySelector('#launch-button').click()");
 for(let i=0;i<100;i++){if(await evaluate('__flightQA.diagnostics().bounceTime===0&&__flightQA.diagnostics().shieldPulse===0'))break;await new Promise(r=>setTimeout(r,50));}
 await evaluate('__flightQA.pause()');assert.equal(await evaluate('__flightQA.diagnostics().bounceTime'),0);assert.equal(await evaluate('__flightQA.diagnostics().shieldPulse'),0);
 const audio=await evaluate(`(async()=>{const {synthesizeCue}=await import('/src/app/game/audio.ts');const results={};for(const kind of ['torpedo-launch','torpedo-hit','kill','shield-hit','shield-bounce']){const c=new OfflineAudioContext(1,24000,24000);synthesizeCue(c,kind,.6);const b=await c.startRendering(),a=b.getChannelData(0);let sum=0,peak=0,signature=0;for(let i=0;i<a.length;i++){sum+=a[i]*a[i];peak=Math.max(peak,Math.abs(a[i]));signature+=a[i]*Math.sin(i*.17)}results[kind]={rms:Math.sqrt(sum/a.length),peak,signature};}const muted=new OfflineAudioContext(1,12000,24000);synthesizeCue(muted,'torpedo-launch',0);const b=await muted.startRendering();results.mutedPeak=Math.max(...b.getChannelData(0).map(Math.abs));return results})()`);
 for(const kind of ['torpedo-launch','torpedo-hit','kill','shield-hit','shield-bounce']){assert.ok(audio[kind].rms>0);assert.ok(audio[kind].peak<1)}assert.equal(new Set(Object.values(audio).filter(x=>typeof x==='object').map(x=>x.signature.toFixed(6))).size,5);assert.equal(audio.mutedPeak,0);
 await evaluate('__flightQA.restart();__flightQA.pause()');assert.equal(await evaluate('__flightQA.diagnostics().bounceTime'),0);assert.equal(await evaluate('__flightQA.diagnostics().shieldPulse'),0);
 assert.deepEqual(pageErrors,[]);
 return{checks:['actual retry button preserves saved damage and casualties','player and carrier defeat can both retry repeatedly','full restart clears checkpoint','1024 scrollable result card','real laser absorption ripple and hull bounce camera impulse','pause freezes and resume expires feedback','five distinct non-silent unclipped offline audio cues and zero-volume silence'],audio,note:'Wave/position/health fixtures used for targeted UI validation; Node test exercises actual last-wave projectile kill. Session-only checkpoint; no reload persistence or human listening/hardware FPS acceptance.'};
});
