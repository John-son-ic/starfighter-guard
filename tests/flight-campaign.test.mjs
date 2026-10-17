import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightWorld, NEUTRAL_INPUT } from '../src/app/game/world.ts';
import { createVenatorModel } from '../src/visual/models/venator.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';

test('a bounded pilot can finish the campaign through actual movement, shots and damage', () => {
  const carrier = createVenatorModel(false,true);
  const world = new FlightWorld(carrier);
  let shots = 0;
  let retreatUntil=0;
  for (let step = 0; step < 36000 && !world.terminal; step++) {
    const input = { ...NEUTRAL_INPUT };
    if(world.objectives.length)world.targetId=world.objectives[0].id;
    const target = world.target;
    if (target) {
      const distance=target.position.distanceTo(world.player.position);
      if(target.model==='munificent'&&distance<400)retreatUntil=world.time+8;
      const aim=world.time<retreatUntil?world.player.position.clone().add(new THREE.Vector3(650,500,700)):world.aimPoint(target);
      const local = aim.sub(world.player.position).applyQuaternion(world.player.rotation.clone().invert()).normalize();
      input.yaw = THREE.MathUtils.clamp(Math.atan2(local.x, -local.z) * 2, -1, 1);
      input.pitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)) * 2, -1, 1);
      input.throttle = target.position.distanceTo(world.player.position) > (target.model==='munificent'?1200:280) ? 1 : -1;
      input.fire = local.z < -0.985 && world.time>=retreatUntil;
      input.torpedo=world.torpedoLock>=2;
      input.boost=world.stage!=='defense'&&world.boostEnergy>20;
      input.jump=world.stage!=='defense'&&world.stage!=='arrival'&&world.jumpCooldown===0&&distance>1800&&local.z<-.999;
    }
    world.step(1 / 60, input);
    shots += world.events.filter(event => event.type === 'shot').length;
    assert.ok(world.enemies.length <= 10);
    assert.ok(Number.isFinite(world.player.position.lengthSq()));
  }
  assert.equal(world.mission.phase, 'won',JSON.stringify({time:world.time,kills:world.mission.kills,health:world.player.health,carrier:world.carrierHealth,reason:world.mission.lossReason,turretShots:world.turretShots,stage:world.stage,generator:world.generator.health,bridge:world.bridge.health,position:world.player.position.toArray()}));
  assert.equal(world.mission.kills >= 24, true);
  assert.ok(world.player.health > 0 && world.carrierHealth > 0);
  assert.ok(shots > 0, 'pilot fired actual projectiles; no health edits or synthetic death events');
  console.log(`[flight pilot] ${world.time.toFixed(1)}s simulated; ${shots} shots; carrier ${world.carrierHealth}; player ${world.player.health}`);
  disposeModel(carrier);
});
