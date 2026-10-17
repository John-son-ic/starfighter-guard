import test from 'node:test';
import assert from 'node:assert/strict';
import {Group, Vector3, Mesh, BoxGeometry, MeshBasicMaterial} from 'three';
import {FlightWorld, NEUTRAL_INPUT, TORPEDO_CONFIG as C} from '../src/app/game/world.ts';
function setup(){
 const w=new FlightWorld(new Group());
 for(let i=0;i<182;i++)w.step(1/60,NEUTRAL_INPUT);
 const e=w.enemies[0];w.fighters.splice(1,w.fighters.length-1,e);
 w.player.position.set(0,100,0);w.player.previous.copy(w.player.position);w.player.rotation.identity();
 e.position.set(0,100,-500);e.previous.copy(e.position);e.rotation.identity();e.speed=110;
 w.targetId=e.id;w.bolts.length=0;w.events.length=0;return {w,e};
}
test('torpedo requires continuous same-target lock, rejects range/cone/occlusion, and cooldown blocks shots',()=>{
 const {w,e}=setup();
 w.updateTorpedo(1,true);assert.equal(w.bolts.length,0);
 w.updateTorpedo(1,false);assert.equal(w.torpedoLock,2);
 e.position.x=1000;w.updateTorpedo(.1,false);assert.equal(w.torpedoLock,0);
 e.position.set(0,100,-1300);w.updateTorpedo(2,false);assert.equal(w.torpedoLock,0);
 e.position.set(0,100,-500);w.updateTorpedo(1,false);
 w.targetId=null;w.updateTorpedo(.1,false);assert.equal(w.torpedoLock,0);
 w.targetId=e.id;w.updateTorpedo(2,false);w.updateTorpedo(.01,true);
 assert.equal(w.bolts.length,1);assert.equal(w.torpedoCooldown,C.cooldown);
 w.updateTorpedo(.1,false);w.updateTorpedo(.1,true);assert.equal(w.bolts.length,1);
 w.updateTorpedo(18,true);assert.equal(w.bolts.length,1,'held key cannot auto-fire');
 const blocker=new Mesh(new BoxGeometry(100,100,10),new MeshBasicMaterial());blocker.position.set(0,100,-250);
 const blocked=new FlightWorld(blocker);blocked.fighters.push(e);blocked.targetId=e.id;blocked.player.position.set(0,100,0);
 blocked.updateTorpedo(2,false);assert.equal(blocked.torpedoLock,0);
 blocker.geometry.dispose();blocker.material.dispose();
});
test('guided torpedo turns, hits a moving target, and resets in a new mission',()=>{
 const {w,e}=setup();w.updateTorpedo(2,false);w.updateTorpedo(.01,true);
 const initial=w.bolts[0].velocity.clone();e.rotation.setFromAxisAngle(new Vector3(0,1,0),-.25);
 for(let i=0;i<360&&e.health>0&&w.bolts.length;i++){
  e.previous.copy(e.position);e.position.addScaledVector(w.forward(e),e.speed/60);w.updateBolts(1/60);
 }
 assert.equal(e.health,0);assert.equal(w.bolts.length,0);assert.ok(w.events.some(e=>e.type==='explosion'));
 assert.equal(initial.length(),C.speed);
 const fresh=new FlightWorld(new Group());assert.equal(fresh.torpedoCooldown,0);assert.equal(fresh.torpedoLock,0);
});
test('torpedo is stopped by hull and survives loss of its target without retargeting',()=>{
 const {w,e}=setup();w.updateTorpedo(2,false);w.updateTorpedo(.01,true);
 e.health=0;const bolt=w.bolts[0],velocity=bolt.velocity.clone();w.updateBolts(.1);
 assert.deepEqual(bolt.velocity.toArray(),velocity.toArray());
 for(let i=0;i<80;i++)w.updateBolts(.1);assert.equal(w.bolts.length,0);
 const wall=new Mesh(new BoxGeometry(100,100,10),new MeshBasicMaterial());wall.position.set(0,100,-100);
 const blocked=new FlightWorld(wall);blocked.bolts.push({...bolt,life:7,position:new Vector3(0,100,0),previous:new Vector3(0,100,0)});
 for(let i=0;i<60&&blocked.bolts.length;i++)blocked.updateBolts(1/60);
 assert.equal(blocked.bolts.length,0);assert.ok(blocked.events.some(e=>e.type==='explosion'));assert.equal(blocked.carrierHealth,4000);
 wall.geometry.dispose();wall.material.dispose();
});
