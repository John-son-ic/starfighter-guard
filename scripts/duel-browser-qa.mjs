import assert from 'node:assert/strict';
import {withBrowser} from './browser-session.mjs';
import {createDuelServer} from '../src/server/duel-server.ts';

const server=createDuelServer({port:8787,allowedOrigins:['http://127.0.0.1:5188']});
await server.listen();
try{
await withBrowser('c34-duel',async({call,evaluate,capture,createPage,pageErrors})=>{
  const a={call,evaluate,capture},b=await createPage();
  const wait=(page,condition)=>page.evaluate(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true)}else if(++tries>100){clearInterval(timer);reject(new Error(document.body.innerText))}},100)})`);
  for(const page of [a,b]){await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await page.call('Page.navigate',{url:'http://127.0.0.1:5188/?mode=duel&qa=1'});await page.call('Page.bringToFront');try{await wait(page,`window.__duelQA&&document.querySelector('canvas')?.dataset.ready==='true'`);}catch(error){console.log(JSON.stringify({pageErrors,canvas:await page.evaluate(`({qa:!!window.__duelQA,canvas:!!document.querySelector('canvas'),ready:document.querySelector('canvas')?.dataset.ready})`)}));throw error;}}
  await a.capture('01-lobby');
  await a.evaluate(`document.querySelector('#duel-create').click()`);await wait(a,`window.__duelQA.snapshot()?.phase==='waiting'`);
  const code=await a.evaluate(`document.querySelector('#duel-room-code').textContent`);
  await b.evaluate(`document.querySelector('#duel-code').value=${JSON.stringify(code)};document.querySelector('#duel-join-form').requestSubmit()`);await wait(b,`window.__duelQA.snapshot()?.occupied.every(Boolean)`);
  assert.equal(await a.evaluate('window.__duelQA.pending().slot'),0);assert.equal(await b.evaluate('window.__duelQA.pending().slot'),1);
  await a.capture('02-room');
  for(const page of [a,b])await page.evaluate(`document.querySelector('#duel-ready').click()`);
  await wait(a,`window.__duelQA.snapshot()?.phase==='playing'`);await wait(b,`window.__duelQA.snapshot()?.phase==='playing'`);
  await a.capture('03-playing-p1');await b.capture('04-playing-p2');
  const before=await a.evaluate(`window.__duelQA.snapshot().flight.pilots[0]`);
  await a.call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyD',key:'d'});await a.call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyF',key:'f'});await a.call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyF',key:'f'});
  await a.evaluate('new Promise(r=>setTimeout(r,350))');await a.call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyD',key:'d'});
  const moved=await a.evaluate(`window.__duelQA.snapshot().flight.pilots[0]`);assert.ok(moved.lastProcessedSeq>before.lastProcessedSeq);assert.notDeepEqual(moved.rotation,before.rotation);assert.ok(moved.shieldCooldownTicks>0);
  await a.capture('05-shield');
  await a.call('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape'});await a.call('Input.dispatchKeyEvent',{type:'keyUp',code:'Escape',key:'Escape'});
  const tick=await a.evaluate('window.__duelQA.snapshot().serverTick');await a.evaluate('new Promise(r=>setTimeout(r,350))');assert.ok(await a.evaluate('window.__duelQA.snapshot().serverTick')>tick);assert.equal(await a.evaluate(`document.querySelector('#duel-menu').hidden`),false);await a.capture('06-menu-live');
  await a.evaluate(`document.querySelector('#duel-resume').click()`);
  await a.call('Emulation.setDeviceMetricsOverride',{width:1024,height:640,deviceScaleFactor:1,mobile:false});await a.capture('07-small-hud');
  // Browser inputs travel through native WebSocket and authoritative simulation.
  // This pilot only chooses controls; it never changes snapshots, health or server time.
  await a.evaluate(`(async()=>{window.__duelSolve=(await import('/src/sim/intercept.ts')).solveIntercept;window.__duelPilot=setInterval(()=>{const s=window.__duelQA.snapshot();if(s?.phase!=='playing'||!s.flight)return;const p=s.flight.pilots[0],t=s.flight.pilots[1];const q=p.rotation;const lead=window.__duelSolve({x:p.position[0],y:p.position[1],z:p.position[2]},{x:t.position[0],y:t.position[1],z:t.position[2]},{x:t.velocity[0],y:t.velocity[1],z:t.velocity[2]},720,2)?.point;let d=(lead?[lead.x,lead.y,lead.z]:t.position).map((n,i)=>n-p.position[i]);const v={x:-q[0],y:-q[1],z:-q[2],w:q[3]};const x=d[0],y=d[1],z=d[2],ix=v.w*x+v.y*z-v.z*y,iy=v.w*y+v.z*x-v.x*z,iz=v.w*z+v.x*y-v.y*x,iw=-v.x*x-v.y*y-v.z*z;d=[ix*v.w+iw*-v.x+iy*-v.z-iz*-v.y,iy*v.w+iw*-v.y+iz*-v.x-ix*-v.z,iz*v.w+iw*-v.z+ix*-v.y-iy*-v.x];window.__duelQA.controls({yaw:Math.max(-1,Math.min(1,Math.atan2(d[0],-d[2])*5)),pitch:Math.max(-1,Math.min(1,Math.atan2(d[1],Math.hypot(d[0],d[2]))*5)),throttle:Math.hypot(...d)>450?1:-1,fire:d[2]<0&&Math.hypot(d[0],d[1])/-d[2]<.04})},40);})()`);
  await b.evaluate(`window.__duelQA.controls({throttle:-1})`);
  let scored=false;
  for(let i=0;i<4&&!scored;i++){
    await a.evaluate('new Promise(r=>setTimeout(r,4000))');scored=await a.evaluate(`window.__duelQA.snapshot()?.scores.some(n=>n>0)`);
  }
  if(!scored){console.log(JSON.stringify({pageErrors,snapshot:await a.evaluate('window.__duelQA.snapshot()')}));await a.capture('failed-score');}assert.equal(scored,true,'real browser inputs should produce a scored round');await a.capture('08-scored-round');
  await a.evaluate(`clearInterval(window.__duelPilot);window.__duelQA.controls(null)`);await b.evaluate(`window.__duelQA.controls(null);document.querySelector('#duel-menu-button').click();document.querySelector('#duel-menu-leave').click()`);
  await wait(a,`window.__duelQA.snapshot()?.phase==='finished'`);assert.equal(await a.evaluate(`window.__duelQA.snapshot().winner`),0);await a.capture('09-opponent-left');
  await a.evaluate(`document.querySelector('#duel-leave').click()`);await wait(a,`!window.__duelQA.pending().connected`);assert.equal(await a.evaluate(`document.querySelector('#duel-entry').hidden`),false);
  assert.deepEqual(pageErrors,[]);
  return {checks:['two independent browser pages create/join/ready','automatic countdown','native input moves and shields','menu leaves authoritative time running','1024x640 HUD','browser control stream produces real scored round','opponent leaves and match finishes','return to lobby'],code,localOnly:true,note:'Chrome SwiftShader; no hardware FPS or LAN-device claim'};
});
}finally{await server.close();}
