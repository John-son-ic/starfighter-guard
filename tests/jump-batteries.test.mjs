import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {FlightWorld,NEUTRAL_INPUT} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
function setup(){const c=createVenatorModel(false,true),w=new FlightWorld(c);w.stage='shield';w.player.position.set(-650,100,0);w.player.previous.copy(w.player.position);return{w,close(){disposeModel(c);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
test('jump moves 2500m, consumes cooldown once and stops before shield',()=>{const {w,close}=setup();try{
 const before=w.player.position.clone();w.step(1/60,{...NEUTRAL_INPUT,jump:true});assert.ok(Math.abs(before.distanceTo(w.player.position)-2500)<.01);assert.equal(w.jumpCooldown,10);assert.deepEqual(w.player.previous.toArray(),w.player.position.toArray());
 const p=w.player.position.clone();w.step(1/60,{...NEUTRAL_INPUT,jump:true});assert.ok(p.distanceTo(w.player.position)<10);
 w.updateJump(10,false);const a=w.player.position.clone();assert.ok(w.updateJump(1/60,true));assert.ok(a.distanceTo(w.player.position)<2500);
 assert.ok(w.player.position.clone().sub(w.shieldCenter).divide(w.shieldRadii).length()>1);assert.equal(w.player.health,100);
 const fresh=new FlightWorld(w.carrier,w.frigate);assert.equal(fresh.jumpCooldown,0);
 }finally{close()}});
test('jump rejects close hull obstruction and stays within battle boundary',()=>{const {w,close}=setup();try{
 w.stage='defense';w.player.position.set(0,-40,-620);w.player.rotation.setFromAxisAngle(new Vector3(0,1,0),Math.PI);
 assert.equal(w.updateJump(.01,true),false);assert.equal(w.jumpCooldown,0);
 w.updateJump(.01,false);w.stage='shield';w.player.position.set(3000,100,-2500);w.player.rotation.setFromUnitVectors(new Vector3(0,0,-1),new Vector3(1,0,0));
 assert.ok(w.updateJump(.01,true));assert.ok(w.player.position.distanceTo(new Vector3(0,0,-2500))<=4000.01);
 }finally{close()}});
test('capital batteries exchange physical shots; shield blocks Republic damage until generator falls',()=>{const {w,close}=setup();try{
 for(let i=0;i<900;i++){w.time+=1/60;w.updateTurrets(1/60);w.updateEnemyGuns(1/60);w.updateBolts(1/60)}
 assert.ok(w.carrierHealth<4000,'enemy heavy shells actually hit Venator');assert.equal(w.bridge.health,1800);
 w.generator.health=0;w.stage='assault';
 for(let i=0;i<900;i++){w.time+=1/60;w.updateTurrets(1/60);w.updateBolts(1/60)}
 assert.ok(w.bridge.health<1800,'Republic capital fire damages exposed bridge');
 }finally{close()}});
test('point defense can hit player; destroyed gun stops firing and loses target marker',()=>{const {w,close}=setup();try{
 const gun=w.enemyGuns.find(g=>!g.heavy);w.enemyGuns.forEach(g=>{if(g!==gun)g.health=0});
 w.player.position.copy(gun.position).add(new Vector3(0,110,160));w.player.previous.copy(w.player.position);w.player.speed=0;
 for(let i=0;i<600&&w.player.health===100;i++){w.time+=1/60;w.updateEnemyGuns(1/60);w.updateBolts(1/60)}
 assert.ok(w.player.health<100,'nearby flak hits actual moving bolt collision');
 w.generator.health=0;w.stage='assault';const position=gun.position.clone().add(new Vector3(0,100,0));w.bolts.length=0;
 w.bolts.push({id:999,owner:'player',team:'republic',position,previous:position.clone(),velocity:new Vector3(0,-6000,0),damage:150,life:1});w.updateBolts(1/60);
 assert.equal(gun.health,0);assert.ok(!w.attackTargets.includes(gun));w.bolts.length=0;
 for(let i=0;i<600;i++)w.updateEnemyGuns(1/60);assert.equal(w.bolts.length,0);
 }finally{close()}});
