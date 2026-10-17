import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {FlightWorld,NEUTRAL_INPUT} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
function setup(){const carrier=createVenatorModel(false,true),w=new FlightWorld(carrier);w.player.position.set(1800,1400,0);w.player.previous.copy(w.player.position);return{w,close(){disposeModel(carrier);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
function step(w,n){for(let i=0;i<n&&!w.terminal;i++)w.step(1/60,{...NEUTRAL_INPUT,yaw:.3})}
function bolt(w,target,damage=120){const position=target.position.clone().add(new Vector3(0,0,100));w.bolts.push({id:999,owner:'player',team:'republic',position,previous:position.clone(),velocity:new Vector3(0,0,-6000),damage,life:1});w.updateBolts(1/60)}
test('three defensive waves lead to two frigates arriving instead of victory; restart is clean',()=>{
 const {w,close}=setup();try{
  for(let wave=0;wave<3;wave++){step(w,wave?602:182);w.enemies.forEach(e=>e.health=0);step(w,1)}
  assert.equal(w.stage,'arrival');assert.equal(w.terminal,false);assert.equal(w.mission.kills,24);
  step(w,241);assert.equal(w.stage,'shield');assert.equal(w.capitalShips.length,2);assert.equal(w.enemyGuns.length,12);assert.equal(w.frigate.position.z,-5000);assert.ok(w.shieldActive);
  step(w,3000);assert.ok(w.enemies.length<=10);assert.equal(w.bombers.length,0);
  const fresh=new FlightWorld(w.carrier,w.frigate);assert.equal(fresh.stage,'defense');assert.equal(fresh.hangarOpen,0);assert.equal(fresh.bombers.length,0);assert.equal(fresh.generator.health,360);
 }finally{close()}
});
test('shield intercepts fire and protects bridge, while exposed generator takes swept hits',()=>{
 const {w,close}=setup();try{
  w.stage='shield';const start=w.bridge.position.clone().add(new Vector3(0,0,600));
  w.bolts.push({id:1,owner:'player',team:'republic',position:start,previous:start.clone(),velocity:new Vector3(0,0,-24000),damage:1800,life:1});w.updateBolts(.05);
  assert.equal(w.bridge.health,1800);assert.equal(w.bolts.length,0);
  for(let i=0;i<3;i++)bolt(w,w.generator);assert.equal(w.generator.health,0);
  step(w,1);assert.equal(w.stage,'launch');assert.equal(w.shieldActive,false);
  step(w,650);assert.equal(w.stage,'assault');assert.equal(w.hangarOpen,1);assert.equal(w.fighters.filter(f=>f.model==='ywing').length,1);assert.equal(w.bombers[0].maxHealth,320);assert.ok(w.fighters.filter(f=>f.model==='arc170').every(f=>f.maxHealth===120));assert.equal(w.player.maxHealth,100);
  assert.equal(w.fighters.filter(f=>f.id==='wing-5'||f.id==='wing-6').length,2);
  w.bombers.forEach(f=>f.health=0);step(w,1);assert.equal(w.terminal,false);
  bolt(w,w.bridge,1800);step(w,1);assert.equal(w.terminal,false);assert.equal(w.capitalShips[0].destroyed,true);assert.ok(w.capitalShips[0].guns.every(g=>g.health===0));
  const second=w.capitalShips[1];assert.equal(second.generator.health,360);assert.equal(second.bridge.health,1800);for(let i=0;i<3;i++)bolt(w,second.generator);step(w,650);assert.equal(second.launched,3);assert.equal(w.fighters.filter(f=>f.id==='wing-7'||f.id==='wing-8').length,2);assert.equal(w.bombers.length,1);assert.equal(w.bombers[0].id,'gold-2');bolt(w,second.bridge,1800);step(w,1);assert.equal(w.stage,'destroyed');assert.equal(w.mission.phase,'won');
 }finally{close()}
});
test('Y-wings launch, travel and destroy bridge with batteries active and no fighter reinforcements',()=>{
 const {w,close}=setup();try{
  w.stage='shield';w.capitalShips.forEach(s=>s.generator.health=0);w.reinforcementTimer=1e9;
  let launched=false,shots=0,closest=Infinity;
  for(let i=0;i<15000&&!w.terminal;i++){
   w.step(1/60,{...NEUTRAL_INPUT,yaw:.3});
   if(w.bombers.length===2)launched=true;
   shots+=w.events.filter(e=>e.type==='carrier-shot').length;
   for(const b of w.bombers)closest=Math.min(closest,b.position.distanceTo(w.bridge.position));
  }
  assert.ok(launched);assert.ok(closest<1100);assert.ok(shots>=6);
  assert.equal(w.mission.phase,'won',JSON.stringify({stage:w.stage,bridge:w.bridge.health,health:w.player.health,bombers:w.bombers.map(f=>({p:f.position.toArray(),h:f.health})),shots,closest}));
 }finally{close()}
});
test('player destruction has priority over final bridge kill',()=>{const {w,close}=setup();try{w.stage='assault';w.generator.health=0;w.bridge.health=0;w.player.health=0;step(w,1);assert.equal(w.mission.phase,'lost')}finally{close()}});

test('second shield independently blocks fire and simultaneous breaks launch exactly two bomber teams',()=>{
 const {w,close}=setup();try{
  w.stage='shield';const second=w.capitalShips[1];w.generator.health=0;
  const start=second.bridge.position.clone().add(new Vector3(0,0,600));
  w.bolts.push({id:1,owner:'player',team:'republic',position:start,previous:start.clone(),velocity:new Vector3(0,0,-24000),damage:1800,life:1});w.updateBolts(.05);
  assert.equal(second.bridge.health,1800);assert.ok(!w.attackTargets.includes(second.bridge));assert.ok(w.attackTargets.includes(w.bridge));
  second.generator.health=0;w.reinforcementTimer=1e9;step(w,650);
  assert.deepEqual(w.capitalShips.map(s=>s.launched),[3,3]);
  assert.deepEqual(w.bombers.map(f=>f.id).sort(),['gold-1','gold-2']);
  assert.equal(w.fighters.filter(f=>/^wing-[5-8]$/.test(f.id)).length,4);
  step(w,120);assert.deepEqual(w.capitalShips.map(s=>s.launched),[3,3]);
  const fresh=new FlightWorld(w.carrier,...w.capitalShips.map(s=>s.model));assert.deepEqual(fresh.capitalShips.map(s=>[s.generator.health,s.bridge.health,s.launched,s.destroyed]),[[360,1800,0,false],[360,1800,0,false]]);
 }finally{close()}
});
