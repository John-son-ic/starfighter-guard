import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3,Matrix4 } from 'three';
import { createVenatorModel } from '../src/visual/models/venator.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';
import { FlightWorld,NEUTRAL_INPUT } from '../src/app/game/world.ts';
import { safeChaseCamera } from '../src/app/game/camera.ts';

test('deck, bridge, side and ventral impacts kill the player and leave a clear result camera',()=>{
  const carrier=createVenatorModel(false);
  try {
    for(const [start,direction] of [[[100,5,0],[0,-1,0]],[[46,150,300],[0,-1,0]],[[320,-50,280],[-1,0,0]],[[100,-130,0],[0,1,0]]]) {
      const w=new FlightWorld(carrier),p=w.player;
      p.invulnerable=10; // A collision is fatal even during the old collision grace period.
      p.position.set(...start);p.previous.copy(p.position);
      p.rotation.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(),new Vector3(...direction),new Vector3(0,1,0)));
      for(let i=0;i<150&&w.playerCollisionVersion===0;i++)w.step(1/60,NEUTRAL_INPUT);
      assert.ok(w.playerCollisionVersion>0,'impact actually happened');
      assert.deepEqual(p.position.toArray(),p.previous.toArray(),'collision interpolation is reset');
      const camera=safeChaseCamera(w,new Vector3(0,4.8,22).applyQuaternion(p.rotation).add(p.position));
      assert.ok(camera.distanceTo(p.position)>p.radius+6,'camera remains outside player mesh');
      assert.equal(w.hullHit(p.position,camera),null,'carrier does not cover camera');
      assert.equal(p.health,0);assert.equal(w.mission.phase,'lost');
      assert.ok(w.events.some(e=>e.type==='explosion'));
      const position=p.position.clone();
      for(let i=0;i<30;i++)w.step(1/60,{...NEUTRAL_INPUT,yaw:0.5,pitch:0.2});
      assert.deepEqual(p.position.toArray(),position.toArray());
      const fresh=new FlightWorld(carrier);
      assert.equal(fresh.player.health,100);assert.equal(fresh.terminal,false);
    }
  } finally {disposeModel(carrier)}
});

test('carrier guns shoot physical bolts that damage enemies, with no friendly damage',()=>{
  const carrier=createVenatorModel(false),w=new FlightWorld(carrier);
  try {
    for(let i=0;i<182;i++)w.step(1/60,NEUTRAL_INPUT);
    const target=w.enemies[0];
    // Remove escorts to prove observed damage comes from carrier shells only.
    w.fighters.splice(1,w.fighters.length-1,target);
    target.position.set(120,180,100);target.previous.copy(target.position);target.phase=0;
    w.player.position.set(1000,500,1000);w.player.previous.copy(w.player.position);
    let damaged=false,maxBolts=0;
    for(let i=0;i<1200&&!damaged;i++) {
      w.step(1/60,NEUTRAL_INPUT);damaged=target.health<90;maxBolts=Math.max(maxBolts,w.bolts.filter(b=>b.owner.startsWith('turret-')).length);
    }
    assert.ok(w.turretShots>0&&maxBolts>0);assert.ok(damaged,'actual carrier projectile hit');
    assert.equal(w.player.health,100);
  } finally {disposeModel(carrier)}
});

test('guns do not fire below the deck, and restart resets turret state',()=>{
  const carrier=createVenatorModel(false),w=new FlightWorld(carrier);
  try {
    for(let i=0;i<182;i++)w.step(1/60,NEUTRAL_INPUT);
    w.enemies.forEach((e,i)=>{e.position.set(700+i*20,-300,0);e.previous.copy(e.position)});
    for(let i=0;i<60;i++)w.step(1/60,NEUTRAL_INPUT);
    assert.equal(w.turretShots,0);
    const fresh=new FlightWorld(carrier);assert.equal(fresh.turretShots,0);assert.equal(fresh.turrets.length,8);assert.equal(fresh.fighters.length,5);
  } finally {disposeModel(carrier)}
});
