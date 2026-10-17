import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {FlightWorld,NEUTRAL_INPUT,PLAYER_SHIELD_CONFIG as C} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
function setup(){const carrier=createVenatorModel(false,true),w=new FlightWorld(carrier);return{w,close(){disposeModel(carrier);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
function shot(w){const p=w.player.position.clone().add(new Vector3(0,0,30));w.player.previous.copy(w.player.position);w.bolts.push({id:99,owner:'enemy',team:'separatist',position:p,previous:p.clone(),velocity:new Vector3(0,0,-600),life:1,damage:12});w.updateBolts(.1)}
test('F shield lasts five seconds, blocks lasers, expires, and has edge-triggered cooldown',()=>{
 const{w,close}=setup();try{
  w.player.position.set(1800,1400,0);w.step(1/60,{...NEUTRAL_INPUT,shield:true});
  assert.equal(w.shieldTime,C.duration);assert.equal(w.shieldCooldown,C.cooldown);shot(w);assert.equal(w.player.health,100);assert.equal(w.bolts.length,0);
  for(let i=0;i<301;i++)w.updatePlayerShield(1/60,true);
  assert.equal(w.playerShieldActive,false);shot(w);assert.equal(w.player.health,88);
  w.updatePlayerShield(25,true);assert.equal(w.shieldCooldown,0);assert.equal(w.playerShieldActive,false,'held F never reactivates');
  w.updatePlayerShield(.01,false);w.updatePlayerShield(.01,true);assert.ok(w.playerShieldActive);
  const fresh=new FlightWorld(w.carrier,...w.capitalShips.map(s=>s.model));assert.equal(fresh.shieldTime,0);assert.equal(fresh.shieldCooldown,0);
 }finally{close()}
});
test('shield bounces player from actual carrier and both enemy hulls; expiry restores fatal collision',()=>{
 const{w,close}=setup();try{
  w.updatePlayerShield(.01,true);
  const collide=(start,end)=>{const p=w.player;p.previous.copy(start);p.position.copy(end);p.rotation.identity();assert.ok(w.hullHit(start,end,p.radius),'fixture crosses actual hull');const version=w.playerCollisionVersion;w.collideShip(p);assert.equal(w.playerCollisionVersion,version+1);assert.deepEqual(p.previous.toArray(),p.position.toArray());};
  collide(new Vector3(0,-40,-620),new Vector3(0,-40,-400));assert.equal(w.player.health,100);
  w.stage='assault';w.capitalShips.forEach(s=>s.generator.health=0);
  for(const ship of w.capitalShips){collide(ship.bridge.position.clone().add(new Vector3(0,100,0)),ship.bridge.position.clone().add(new Vector3(0,-80,0)));assert.equal(w.player.health,100);}
  w.updatePlayerShield(5.01,false);collide(new Vector3(0,-40,-620),new Vector3(0,-40,-400));assert.equal(w.player.health,0);
 }finally{close()}
});
