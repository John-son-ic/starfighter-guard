import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4} from 'three';
import {FlightWorld,BOMBER_DAMAGE} from '../src/app/game/world.ts';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
import {fighterLabel} from '../src/app/game/scene.ts';
import {CapitalDamageEffects} from '../src/app/game/capital-effects.ts';
function setup(){const c=createVenatorModel(false,true),w=new FlightWorld(c);w.stage='shield';return{w,close(){disposeModel(c);w.capitalShips.forEach(s=>disposeModel(s.model))}}}
test('capital roles produce different real heavy shells and 1/3 interceptor groups; destroyed ships stop support',()=>{
 const {w,close}=setup();try{
  for(let i=0;i<400;i++){w.time+=1/60;w.updateEnemyGuns(1/60)}
  for(const gun of w.enemyGuns.filter(g=>g.heavy)){assert.match(fighterLabel(gun),/重型主炮/);assert.ok(w.bolts.some(b=>b.owner===gun.id&&b.damage===(gun.shipIndex===0?36:18)));}
  assert.match(fighterLabel(w.enemyGuns[1]),/近防炮/);
  w.updateAssault(.01);assert.equal(w.enemies.filter(f=>f.position.x<0).length,1);assert.equal(w.enemies.filter(f=>f.position.x>0).length,3);
  w.capitalShips[0].generator.health=w.bridge.health=0;w.updateAssault(.01);w.reinforcementTimer=0;
  const before=w.enemies.length;w.updateAssault(.01);assert.equal(w.enemies.length-before,3);
 }finally{close()}
});
test('bomber fires a real heavy torpedo that deals 600 bridge damage',()=>{
 const {w,close}=setup();try{
  w.generator.health=0;
  const f={...w.player,id:'gold-1',model:'ywing',position:w.bridge.position.clone().add(new Vector3(0,100,700)),previous:new Vector3(),rotation:w.player.rotation.clone(),phase:0,evadingUntil:0,cooldown:0};
  f.previous.copy(f.position);f.rotation.setFromRotationMatrix(new Matrix4().lookAt(f.position,w.bridge.position,new Vector3(0,1,0)));w.fighters.push(f);
  w.moveBomber(f,1/60);assert.equal(w.bolts.length,1);assert.equal(w.bolts[0].damage,BOMBER_DAMAGE);
  for(let i=0;i<300&&w.bolts.length;i++)w.updateBolts(1/60);
  assert.equal(w.bridge.health,1200);
 }finally{close()}
});
test('actual bomber and carrier damage raises throttled expiring alerts with usable threat targets',()=>{
 const {w,close}=setup();try{
  const bomber={...w.player,id:'gold-1',model:'ywing',position:new Vector3(1700,1000,-2000),previous:new Vector3(1700,1000,-2000),health:320,maxHealth:320};w.fighters.push(bomber);
  const owner=w.enemyGuns[1].id;
  for(let i=0;i<3;i++){const position=bomber.position.clone().add(new Vector3(0,0,30));w.bolts.push({id:i,team:'separatist',owner,position,previous:position.clone(),velocity:new Vector3(0,0,-600),damage:12,life:1});w.updateBolts(.1);}
  assert.equal(bomber.health,284);assert.equal(w.threats.length,1);assert.equal(w.events.filter(e=>e.type==='warning').length,1);w.selectThreat();assert.equal(w.targetId,w.generator.id,'shielded gun redirects to its generator');
  w.generator.health=0;const p=new Vector3(0,-40,-620);w.bolts.push({id:9,team:'separatist',owner,capital:true,position:p,previous:p.clone(),velocity:new Vector3(0,0,2000),damage:36,life:1});w.updateBolts(.1);
  assert.ok(w.carrierHealth<4000);assert.ok(w.threats.some(a=>a.id==='carrier'));w.time+=6;assert.equal(w.threats.length,0);
 }finally{close()}
});
test('bounded capital effects show wrecks, damage fire, shield rupture and staged death; reset restores clean state',()=>{
 const {w,close}=setup(),fx=new CapitalDamageEffects();try{
  w.generator.health=0;w.capitalShips[0].launchTime=.1;w.enemyGuns[0].health=0;w.bridge.health=500;fx.update(w,0);
  assert.equal(fx.diagnostics().wrecks,1);assert.ok(fx.diagnostics().fires>0);
  w.capitalShips.forEach(s=>s.destroyed=true);fx.update(w,1);const first=fx.diagnostics().fires;fx.update(w,1);assert.ok(fx.diagnostics().fires>first);assert.ok(fx.diagnostics().fires<=12);
  fx.update(w,3);assert.equal(fx.diagnostics().fires,0);fx.reset();assert.deepEqual(fx.diagnostics().deathAges,[0,0]);
  w.frigate.rotation.z=.2;const fresh=new FlightWorld(w.carrier,...w.capitalShips.map(s=>s.model));assert.equal(fresh.frigate.rotation.z,0);
 }finally{disposeModel(fx.root);fx.dispose();close()}
});
