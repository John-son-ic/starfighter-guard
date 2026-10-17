import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RelayWorld} from '../src/app/game/relay-world.ts';
import {NEUTRAL_INPUT} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
function setup(){const c=createVenatorModel(false,true),w=new RelayWorld(c);return{w,close(){disposeModel(c);disposeModel(w.station);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
function hit(w,target,damage=600){const p=target.position.clone().add(new THREE.Vector3(0,200,0));w.bolts.push({id:999,owner:'player',team:'republic',position:p,previous:p.clone(),velocity:new THREE.Vector3(0,-20000,0),life:1,damage});w.updateBolts(.02)}
function step(w,n=1){for(let i=0;i<n&&!w.terminal;i++)w.step(1/60,NEUTRAL_INPUT)}
function stationRange(w){for(const f of [...w.enemies])hit(w,f,90);w.player.position.set(0,350,-900);w.player.previous.copy(w.player.position);step(w);assert.equal(w.operation.phase,'facilities')}

test('relay facilities use real projectiles in either order; reactor opens and checkpoints preserve casualties',()=>{
 for(const order of [[0,1],[1,0]]){const {w,close}=setup();try{
  assert.equal(w.fighters.filter(f=>f.team==='republic').length,3);assert.equal(w.enemies.length,4);assert.equal(w.objectives.length,0);
  stationRange(w);assert.equal(w.hasCheckpoint,true);w.player.health=63;w.fighters.find(f=>f.id==='wing-2').health=0;step(w);
  hit(w,w.facilities[order[0]]);step(w);assert.equal(w.operation.phase,'facilities');hit(w,w.facilities[order[1]]);step(w);assert.equal(w.operation.phase,'reactor');assert.equal(w.checkpointTitle,'反应堆暴露');assert.equal(w.exposedGuns.length,0);
  w.enemyGuns[0].flash=.15;const bolts=w.bolts.length;w.updateEnemyGuns(.2);assert.equal(w.enemyGuns[0].flash,0);assert.equal(w.bolts.length,bolts,'disabled defenses stop firing and their muzzle flashes expire');
  hit(w,w.core,1200);step(w);assert.equal(w.operation.phase,'escape');assert.ok(w.enemies.length>=4);assert.equal(w.rescueActive,false);
  w.player.health=0;step(w);const r=w.retryFromCheckpoint();assert.equal(r.operation.phase,'reactor');assert.equal(r.core.health,1200);assert.equal(r.player.health,63);assert.equal(r.fighters.filter(f=>f.team==='republic').length,2);assert.equal(r.rescueActive,false);
 }finally{close()}}
});

test('rescue physically fires at pursuers, cannot win before arrival, and times out without extraction',()=>{
 const {w,close}=setup();try{
  stationRange(w);hit(w,w.comms);hit(w,w.control);step(w);hit(w,w.core,1200);step(w);
  w.player.position.copy(w.extraction);w.player.previous.copy(w.player.position);step(w,100);assert.equal(w.terminal,false);
  // Place pursuers above the carrier for a clear real line of fire; no synthetic kills.
  w.operation={...w.operation,phaseTime:12.1,rescueCalled:true};w.rescueActive=true;w.carrier.position.copy(w.rescuePosition);w.carrier.updateMatrixWorld(true);
  const e=w.enemies[0];e.position.copy(w.rescuePosition).add(new THREE.Vector3(0,350,-500));e.previous.copy(e.position);e.speed=0;
  const before=e.health;for(let i=0;i<200;i++){w.updateTurrets(1/60);w.updateBolts(1/60)}assert.ok(w.turretShots>0);assert.ok(e.health<before,'actual rescue bolts damage pursuers');
  w.operation={...w.operation,phaseTime:18};w.updateAssault(1/60);assert.equal(w.mission.phase,'won');
  const r=w.retryFromCheckpoint();assert.equal(r,null,'cannot restore a victorious mission');
  const other=setup();try{other.w.operation={...other.w.operation,phase:'escape',phaseTime:59.99};other.w.rescueActive=true;other.w.updateAssault(.02);assert.equal(other.w.operation.lossReason,'escape-timeout');assert.equal(other.w.mission.phase,'lost');assert.equal(other.w.rescueProgress,1,'rescue carrier stays in place on a failed result')}finally{other.close()}
 }finally{close()}
});

test('bounded relay pilot completes patrol, both facilities, reactor and rescued extraction through actual controls',()=>{
 const {w,close}=setup();try{
  const phases=new Set();let retreat=0,shots=0;
  for(let i=0;i<36000&&!w.terminal;i++){
   phases.add(w.operation.phase);const input={...NEUTRAL_INPUT};
   const target=w.objectives[0]??w.enemies[0];
   let point;
   if(w.operation.phase==='escape')point=w.extraction.clone();
   else if(w.operation.phase==='approach'&&!w.enemies.length)point=w.station.position.clone().add(new THREE.Vector3(0,500,1100));
   else if(target){
    w.targetId=target.id;const d=target.position.distanceTo(w.player.position);
    if(target.model==='relay'&&d<420)retreat=w.time+5;
    point=w.time<retreat?w.player.position.clone().add(new THREE.Vector3(600,500,800)):w.aimPoint(target);
   }else point=w.station.position.clone().add(new THREE.Vector3(0,500,900));
   const delta=point.clone().sub(w.player.position),distance=delta.length(),local=delta.applyQuaternion(w.player.rotation.clone().invert()).normalize();
   input.yaw=THREE.MathUtils.clamp(Math.atan2(local.x,-local.z)*2,-1,1);input.pitch=THREE.MathUtils.clamp(Math.atan2(local.y,Math.hypot(local.x,local.z))*2,-1,1);
   input.throttle=distance>900?1:-1;input.fire=!!target&&w.operation.phase!=='escape'&&local.z<-.985&&w.time>=retreat;
   input.torpedo=w.torpedoLock>=2;input.shield=w.shieldCooldown===0;input.boost=distance>1400&&w.boostEnergy>20;
   input.jump=w.operation.phase==='escape'&&distance>1500&&local.z<-.999&&w.jumpCooldown===0;
   w.step(1/60,input);shots+=w.events.filter(e=>e.type==='shot').length;
   assert.ok(w.enemies.length<=8);
  }
  const state={phase:w.operation.phase,time:w.time,reason:w.operation.lossReason,health:w.player.health,facilities:w.facilities.map(f=>f.health),pos:w.player.position.toArray(),kills:w.mission.kills,shots,phases:[...phases],turretShots:w.turretShots};
  assert.equal(w.mission.phase,'won',JSON.stringify(state));assert.ok(phases.has('facilities')&&phases.has('reactor')&&phases.has('escape'));assert.ok(shots>0);assert.ok(w.turretShots>0,'rescue carrier really fires before extraction');console.log('[relay pilot]',JSON.stringify(state));
 }finally{close()}
});
