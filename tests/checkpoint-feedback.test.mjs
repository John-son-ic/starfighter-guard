import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {FlightWorld,NEUTRAL_INPUT} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
function setup(){const carrier=createVenatorModel(false,true),w=new FlightWorld(carrier);w.player.position.set(1800,1400,0);w.player.previous.copy(w.player.position);return{w,close(){disposeModel(carrier);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
function finishDefense(w){
 w.mission={...w.mission,phase:'combat',waveIndex:2,kills:23,activeEnemyIds:['last-enemy']};
 const e={...w.player,id:'last-enemy',model:'vulture',team:'separatist',position:new Vector3(1800,1400,-100),previous:new Vector3(1800,1400,-100),rotation:w.player.rotation.clone(),health:90,maxHealth:90,cooldown:999,speed:0,weapon:{...w.player.weapon}};
 w.fighters.push(e);const p=e.position.clone().add(new Vector3(0,0,20));
 w.bolts.push({id:80,owner:'player',team:'republic',position:p,previous:p.clone(),velocity:new Vector3(0,0,-1200),life:1,damage:90});
 w.step(1/60,NEUTRAL_INPUT);
 assert.equal(w.stage,'arrival');assert.equal(w.hasCheckpoint,true);assert.equal(w.mission.kills,24);
}
function lose(w,carrier=false){if(carrier)w.carrierHealth=0;else w.player.health=0;w.step(1/60,NEUTRAL_INPUT);assert.equal(w.mission.phase,'lost')}

test('actual final-wave kill records one checkpoint and retries preserve damage, casualties, cooldowns and position',()=>{
 const {w,close}=setup();try{
  assert.equal(w.retryFromCheckpoint(),null);assert.equal(w.hasCheckpoint,false);
  w.fighters.splice(2,3);w.player.health=67;w.fighters[1].health=64;w.carrierHealth=1234;
  w.boostEnergy=32;w.shieldTime=2;w.shieldCooldown=27;w.jumpCooldown=4;w.torpedoCooldowns.splice(0,2,11,7);
  finishDefense(w);assert.equal(w.bolts.length,0);assert.equal(w.retryFromCheckpoint(),null,'no skip while playing');
  const expected={pos:w.player.position.toArray(),health:w.player.health,wing:w.fighters[1].health,time:w.time,shield:w.shieldTime,cooldowns:[...w.torpedoCooldowns],jump:w.jumpCooldown,boost:w.boostEnergy};
  w.capitalShips.forEach(s=>{s.generator.health=0;s.bridge.health=100;s.guns.forEach(g=>g.health=0);s.destroyed=true;s.launched=3;s.model.rotation.z=.2});
  w.hangarOpen=1;w.fighters[1].health=0;lose(w);
  const restored=w.retryFromCheckpoint();assert.ok(restored);assert.equal(restored.stage,'arrival');assert.equal(restored.stageTime,0);assert.equal(restored.carrierHealth,1234);
  assert.equal(restored.player.health,expected.health);assert.deepEqual(restored.player.position.toArray(),expected.pos);assert.deepEqual(restored.player.previous.toArray(),expected.pos);
  assert.equal(restored.fighters.length,2);assert.equal(restored.fighters[1].health,expected.wing);assert.equal(restored.time,expected.time);
  assert.equal(restored.shieldTime,expected.shield);assert.equal(restored.jumpCooldown,expected.jump);assert.equal(restored.boostEnergy,expected.boost);assert.deepEqual(restored.torpedoCooldowns,expected.cooldowns);
  assert.equal(restored.mission.kills,24);assert.equal(restored.mission.lossReason,null);assert.equal(restored.hangarOpen,0);assert.equal(restored.bolts.length,0);assert.equal(restored.events.length,0);
  assert.ok(restored.capitalShips.every(s=>s.generator.health===360&&s.bridge.health===1800&&!s.destroyed&&s.launched===0&&s.model.rotation.z===0));
  assert.ok(restored.enemyGuns.every(g=>g.health===150));assert.equal(restored.threats.length,0);
  restored.player.position.x+=999;restored.player.weapon={...restored.player.weapon,heat:99};restored.fighters[1].health=1;lose(restored,true);
  const again=restored.retryFromCheckpoint();assert.deepEqual(again.player.position.toArray(),expected.pos);assert.equal(again.fighters[1].health,expected.wing);assert.equal(again.carrierHealth,1234,'repeated carrier loss cannot damage the snapshot');
  const fresh=new FlightWorld(w.carrier,...w.capitalShips.map(s=>s.model));assert.equal(fresh.hasCheckpoint,false);assert.equal(fresh.player.health,100);
 }finally{close()}
});

test('a simultaneous last-wave kill and player loss never creates a checkpoint',()=>{
 const {w,close}=setup();try{w.mission={...w.mission,phase:'combat',waveIndex:2,activeEnemyIds:[]};w.player.health=0;w.step(1/60,NEUTRAL_INPUT);assert.equal(w.mission.phase,'lost');assert.equal(w.hasCheckpoint,false);assert.equal(w.retryFromCheckpoint(),null)}finally{close()}
});

test('real torpedo launch and victim damage emit distinct launch, hit and kill cues; a barrier hit gives no kill credit',()=>{
 const {w,close}=setup();try{
  for(let i=0;i<182;i++)w.step(1/60,NEUTRAL_INPUT);
  const e=w.enemies[0];w.fighters.splice(1,w.fighters.length-1,e);w.player.rotation.identity();e.position.copy(w.player.position).add(new Vector3(0,0,-200));e.previous.copy(e.position);e.speed=0;w.targetId=e.id;w.events.length=0;w.bolts.length=0;
  w.updateTorpedo(2,false);w.updateTorpedo(0,true);assert.ok(w.events.some(e=>e.type==='torpedo-launch'));
  for(let i=0;i<80&&w.bolts.length;i++)w.updateBolts(1/60);
  assert.equal(e.health,0);assert.equal(w.events.filter(e=>e.type==='torpedo-hit').length,1);assert.equal(w.events.filter(e=>e.type==='kill').length,1);
  w.stage='shield';w.events.length=0;
  const pos=w.bridge.position.clone().add(new Vector3(0,0,700));w.bolts.push({id:81,owner:'player',team:'republic',targetId:w.bridge.id,position:pos,previous:pos.clone(),velocity:new Vector3(0,0,-24000),life:1,damage:120});w.updateBolts(.05);
  assert.equal(w.bridge.health,1800);assert.ok(!w.events.some(e=>e.type==='torpedo-hit'||e.type==='kill'));
 }finally{close()}
});

test('shield laser absorption and real hull bounce have their own cues without health loss',()=>{
 const {w,close}=setup();try{
  w.updatePlayerShield(.01,true);const pos=w.player.position.clone().add(new Vector3(0,0,30));w.events.length=0;
  w.bolts.push({id:90,owner:'enemy',team:'separatist',position:pos,previous:pos.clone(),velocity:new Vector3(0,0,-600),life:1,damage:12});w.updateBolts(.1);
  assert.equal(w.player.health,100);assert.ok(w.events.some(e=>e.type==='shield-hit'&&e.normal.z>.9));assert.ok(!w.events.some(e=>e.type==='player-hit'));
  w.player.previous.set(0,-40,-620);w.player.position.set(0,-40,-400);w.collideShip(w.player);
  assert.equal(w.player.health,100);assert.ok(w.events.some(e=>e.type==='shield-bounce'));assert.equal(w.playerCollisionVersion,1);
 }finally{close()}
});
