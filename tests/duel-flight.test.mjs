import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {createDuelFlight,advanceDuelFlight,advanceDuelMotion,resetDuelRound,NEUTRAL_DUEL_INPUT as N,DUEL_FLIGHT as C} from '../src/sim/duel-flight.ts';
import {decodeDuelCollision,createDuelCollider} from '../src/sim/duel-collision.ts';
import {face,forward} from '../src/sim/duel-math.ts';

// Empty space is injected deliberately; real geometry is exercised separately below.
const empty={triangleCount:0,bounds:[[0,0,0],[0,0,0]],sweepSphere:()=>null};
const frame=(values={})=>({...N,...values});
const step=(s,a=N,b=N,collider=empty)=>advanceDuelFlight(s,[a,b],collider);
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function formation(){const s=createDuelFlight();return {...s,pilots:s.pilots.map((p,i)=>({...p,position:[-600+i*600,300,0],rotation:face([1,0,0]),speed:55}))};}
function incoming(kind='laser',owner=0,id=1){return {id,owner,kind,position:[95,300,0],velocity:[kind==='laser'?720:330,0,0],lifeTicks:60};}
function targetState(shieldTicks=0){const s=formation();return {...s,pilots:[s.pilots[0],{...s.pilots[1],position:[100,300,0],shieldTicks}],nextProjectileId:2,projectiles:[incoming()]};}

test('round spawns are fair, independent and alternate physical sides without switching slots',()=>{
  const a=createDuelFlight(),b=createDuelFlight();assert.notEqual(a.pilots[0],b.pilots[0]);
  assert.equal(a.pilots[0].position[0],-650);assert.equal(a.pilots[1].position[0],650);
  close(forward(a.pilots[0].rotation)[0],1);close(forward(a.pilots[1].rotation)[0],-1);
  const next=resetDuelRound({...a,nextEventId:18,nextProjectileId:44,tick:200},2);
  assert.equal(next.pilots[0].slot,0);assert.equal(next.pilots[0].position[0],650);assert.equal(next.nextEventId,18);assert.equal(next.nextProjectileId,44);assert.equal(next.tick,200);
  assert.deepEqual(next.projectiles,[]);assert.equal(next.pilots[0].health,100);
  assert.throws(()=>resetDuelRound(a,1),RangeError);assert.throws(()=>createDuelFlight(0),RangeError);
});
test('shared quaternion movement matches the solo Three.js yaw/pitch/roll convention',()=>{
  const s=formation(),p=s.pilots[0],input=frame({seq:3,yaw:0.7,pitch:-0.4,roll:0.5,throttle:1,boost:true});
  const q=new Quaternion(...p.rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-0.7*1.15/60)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-0.4/60)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),0.5*1.4/60)).normalize();
  const moved=advanceDuelMotion(p,input,empty).pilot;
  moved.rotation.forEach((v,i)=>close(v,q.toArray()[i]));assert.equal(moved.lastProcessedSeq,3);assert.equal(moved.energy,99.5);
  const expected=p.position.map((v,i)=>v+new Vector3(0,0,-1).applyQuaternion(q).toArray()[i]*moved.speed*1.6/60);
  moved.position.forEach((v,i)=>close(v,expected[i]));
});
test('inputs and snapshots stay unchanged; no clock, random, DOM or renderer is needed',()=>{
  const s=freeze(formation()),inputs=freeze([frame({seq:1,fire:true}),frame({seq:1,shield:true})]);
  const before=JSON.stringify(s),a=advanceDuelFlight(s,inputs,empty),b=advanceDuelFlight(s,inputs,empty);
  assert.deepEqual(a,b);assert.equal(JSON.stringify(s),before);assert.doesNotThrow(()=>JSON.stringify(a));
});
test('axis and sequence errors are rejected before either player advances',()=>{
  const s=freeze(formation());for(const bad of [{yaw:NaN},{pitch:2},{seq:-1},{seq:1.5},{fire:1}]) assert.throws(()=>step(s,N,frame(bad)),RangeError);
  assert.equal(s.tick,0);
});
test('laser hits use moving-target sweeps and deal the same damage for either slot',()=>{
  let s=targetState(),r=step(s);assert.equal(r.state.pilots[1].health,90);assert.equal(r.state.projectiles.length,0);
  s={...s,pilots:[{...s.pilots[1],slot:0},{...s.pilots[0],slot:1}],projectiles:[incoming('laser',1)]};
  r=step(s);assert.equal(r.state.pilots[0].health,90);
});
test('a target crossing the ray between frames is hit instead of tunnelling',()=>{
  const s=formation();s.pilots[1]={...s.pilots[1],position:[0,300,-3],rotation:face([0,0,1]),speed:190};
  s.projectiles=[{...incoming(),position:[-8,300,0]}];assert.equal(step(s).state.pilots[1].health,90);
});
test('shield blocks lasers, halves torpedoes, and activates before same-tick incoming damage',()=>{
  assert.equal(step(targetState(2)).state.pilots[1].health,100);
  const s=targetState();s.projectiles=[incoming('torpedo')];assert.equal(step(s,N,frame({shield:true})).state.pilots[1].health,70);
  const a=step(targetState(),N,frame({shield:true}));assert.equal(a.state.pilots[1].health,100);assert.equal(a.state.pilots[1].shieldTicks,180);
});
test('shield exact duration/cooldown and held-key behavior do not depend on frame timestamps',()=>{
  let s=formation(),r=step(s,frame({shield:true}));s=r.state;assert.equal(s.pilots[0].shieldCooldownTicks,1500);
  for(let i=0;i<180;i++)s=step(s,frame({shield:true})).state;
  assert.equal(s.pilots[0].shieldTicks,0);assert.equal(s.pilots[0].shieldCooldownTicks,1320);
  for(let i=0;i<1320;i++)s=step(s,frame({shield:true})).state;
  assert.equal(s.pilots[0].shieldTicks,0);s=step(s).state;s=step(s,frame({shield:true})).state;assert.equal(s.pilots[0].shieldTicks,180);
});
test('two independent torpedoes each require a fresh continuous lock and edge press',()=>{
  let s=formation();
  for(let i=0;i<119;i++)s=step(s).state;
  assert.equal(s.pilots[0].lockTicks,119);
  let r=step(s,frame({torpedo:true}));s=r.state;assert.equal(r.events.filter(e=>e.type==='torpedo-launch').length,1);assert.deepEqual(s.pilots[0].torpedoCooldownTicks,[1080,0]);assert.equal(s.pilots[0].lockTicks,0);
  // Keep the target alive while testing lock/cooldown state, not missile damage.
  for(let i=0;i<119;i++)s=step({...s,projectiles:[]}).state;
  r=step(s,frame({torpedo:true}));s=r.state;assert.deepEqual(s.pilots[0].torpedoCooldownTicks,[960,1080]);
  r=step(s,frame({torpedo:true}));assert.equal(r.events.some(e=>e.type==='torpedo-launch'),false);
  assert.deepEqual(r.state.pilots[0].torpedoCooldownTicks,[959,1079]);
  const reset=resetDuelRound(s,2);assert.deepEqual(reset.pilots[0].torpedoCooldownTicks,[0,0]);
});
test('lock resets on loss of cone, range or hull visibility and cannot fire while unlocked',()=>{
  let s=formation();for(let i=0;i<60;i++)s=step(s).state;
  const hidden={...empty,sweepSphere:()=>({fraction:0.5,point:[-300,300,0],normal:[1,0,0]})};
  // Use visibility-only blocking here; separate tests cover physical hull collision.
  const wall={...empty,sweepSphere:(a,b,r)=>r===0?hidden.sweepSphere(a,b,r):null};
  assert.equal(step(s,N,N,wall).state.pilots[0].lockTicks,0);
  const behind={...s,pilots:[{...s.pilots[0],rotation:face([-1,0,0])},s.pilots[1]]};assert.equal(step(behind).state.pilots[0].lockTicks,0);
  const far={...s,pilots:[s.pilots[0],{...s.pilots[1],position:[1500,300,0]}]};assert.equal(step(far).state.pilots[0].lockTicks,0);
  assert.equal(step(createDuelFlight(),frame({torpedo:true})).events.some(e=>e.type==='torpedo-launch'),false);
});
test('torpedo guidance turns at a bounded rate and hits an actually moving target',()=>{
  let s=formation();s.pilots[1]={...s.pilots[1],position:[-300,300,20]};
  s.projectiles=[{...incoming('torpedo'),position:[-500,300,0],velocity:[330,0,0],lifeTicks:420}];
  const guided=step(s).state.projectiles[0].velocity;
  assert.ok(Math.acos(Math.max(-1,Math.min(1,guided[0]/Math.hypot(...guided))))<=C.torpedoTurnRate/60+1e-8);
  let hit=false;
  for(let i=0;i<180;i++){const r=step(s);s=r.state;if(s.pilots[1].health<100){hit=true;break;}}
  assert.equal(hit,true);assert.equal(s.pilots[1].health,40);
});
test('real hull blocks both projectile types and denies shooting through the muzzle',()=>{
  const wall=createDuelCollider([0,200,-100,0,400,-100,0,300,100],[0,1,2]);
  for(const kind of ['laser','torpedo']) {
    const s=formation();s.pilots[0]={...s.pilots[0],position:[-100,300,0]};s.pilots[1]={...s.pilots[1],position:[100,300,0]};
    s.projectiles=[{...incoming(kind),position:[-4,300,0],velocity:[kind==='laser'?720:330,0,0]}];
    const r=step(s,N,N,wall);assert.equal(r.state.projectiles.length,0);assert.equal(r.state.pilots[1].health,100);assert.ok(r.events.some(e=>e.type==='impact'));
  }
  const atWall=formation();atWall.pilots[0]={...atWall.pilots[0],position:[-8,300,0]};atWall.pilots[1]={...atWall.pilots[1],position:[100,300,0]};
  const fired=step(atWall,frame({fire:true}),N,wall);assert.equal(fired.state.projectiles.length,0);assert.ok(fired.events.some(e=>e.type==='shot'));assert.ok(fired.events.some(e=>e.type==='impact'));
});
test('unshielded hull collision kills; shielded high-speed collision bounces out of geometry',()=>{
  const wall=createDuelCollider([0,200,-100,0,400,-100,0,300,100],[0,1,2]);
  const s=formation();s.pilots[0]={...s.pilots[0],position:[-4,300,0],speed:190};s.pilots[1]={...s.pilots[1],position:[100,300,0]};
  const dead=step(s,N,N,wall);assert.deepEqual(dead.deadSlots,[0]);assert.equal(dead.events.filter(e=>e.type==='destroyed').length,1);
  const bounced=step(s,frame({shield:true}),N,wall);assert.equal(bounced.state.pilots[0].health,100);assert.ok(bounced.state.pilots[0].position[0]<-3);assert.ok(forward(bounced.state.pilots[0].rotation)[0]<0);
  assert.equal(wall.sweepSphere(bounced.state.pilots[0].position,bounced.state.pilots[0].position,3),null);
});
test('simultaneous lethal shots report both dead independent of projectile iteration order',()=>{
  const s=formation();s.pilots=s.pilots.map((p,i)=>({...p,position:[i?100:-100,300,0],health:10}));
  s.projectiles=[{...incoming(),id:1},{...incoming('laser',1,2),position:[-105,300,0]}];
  const a=step(s),b=step({...s,projectiles:[...s.projectiles].reverse()});assert.deepEqual(a.deadSlots,[0,1]);assert.deepEqual(b.deadSlots,[0,1]);assert.equal(a.events.filter(e=>e.type==='destroyed').length,2);
  const terminal=step(a.state);assert.equal(terminal.state,a.state);assert.deepEqual(terminal.events,[]);
});
test('arena boundary clips position and outward velocity instead of wrapping or teleporting',()=>{
  const p={...formation().pilots[0],position:[1799,180,0],rotation:face([1,0,0]),speed:190};
  const moved=advanceDuelMotion(p,frame({boost:true}),empty).pilot;
  close(moved.position[0],1800);assert.ok(moved.velocity[0]<=1e-8);assert.equal(moved.health,100);
});
test('last lifetime tick can hit; expired missiles and projectiles do not accumulate',()=>{
  const s=targetState();s.projectiles=[{...s.projectiles[0],lifeTicks:1}];assert.equal(step(s).state.pilots[1].health,90);
  s.projectiles=[{...incoming(),position:[800,100,800],lifeTicks:1}];assert.equal(step(s).state.projectiles.length,0);
});
test('real exported map accepts both spawn spheres and deterministic 600-tick manoeuvres',()=>{
  const file=readFileSync(new URL('../public/collision/venator-duel.bin',import.meta.url)),collider=decodeDuelCollision(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength));
  const run=()=>{
    let s=createDuelFlight();
    for(let i=0;i<600;i++) {
      const a=frame({seq:i+1,yaw:0.8,pitch:0.15,fire:i%3===0,boost:i%100<20}),b=frame({seq:i+1,yaw:-0.8,pitch:-0.15,fire:i%5===0,shield:i===100});
      s=step(s,a,b,collider).state;
      assert.ok(s.projectiles.length<=C.maxProjectiles);
      for(const p of s.pilots){assert.ok(p.position.every(Number.isFinite));close(Math.hypot(...p.rotation),1);assert.ok(p.health>=0&&p.health<=100);}
    }
    return s;
  };
  assert.deepEqual(run(),run());
});
