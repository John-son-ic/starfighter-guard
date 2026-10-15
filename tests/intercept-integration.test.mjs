import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveIntercept } from '../src/sim/intercept.ts';
import { FlightWorld, NEUTRAL_INPUT } from '../src/app/game/world.ts';

test('review: nearly equal approaching speeds keep the small root accurate', () => {
  const targetSpeed = 720 + 1e-8;
  const result = solveIntercept({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: targetSpeed }, 720);
  assert.ok(Math.abs(result.time - 1000 / (targetSpeed + 720)) < 1e-12);
});

test('review: a tangent trajectory with a repeated root remains solvable', () => {
  const result = solveIntercept({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: -3, y: 4, z: 0 }, 4);
  assert.equal(result.time, 1); assert.deepEqual(result.point, { x: 0, y: 4, z: 0 });
});

test('review: independent bisection confirms reachable and unreachable game-scale cases', () => {
  let seed = 7053; let reachable = 0; let unreachable = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 512; i++) {
    const shooter = { x: random() * 300, y: random() * 300, z: random() * 300 };
    const target = { x: random() * 3600 - 1800, y: random() * 600 - 300, z: random() * 3600 - 1800 };
    const velocity = { x: random() * 400 - 200, y: random() * 200 - 100, z: random() * 400 - 200 };
    // |velocity| < 720 means distance(target(t), shooter)-720*t strictly decreases.
    const remaining = t => Math.hypot(target.x + velocity.x * t - shooter.x, target.y + velocity.y * t - shooter.y, target.z + velocity.z * t - shooter.z) - 720 * t;
    const result = solveIntercept(shooter, target, velocity, 720);
    if (remaining(2) > 0) { assert.equal(result, null); unreachable++; continue; }
    reachable++; assert.ok(result);
    let low = 0; let high = 2;
    for (let j = 0; j < 70; j++) { const middle = (low + high) / 2; if (remaining(middle) > 0) low = middle; else high = middle; }
    assert.ok(Math.abs(result.time - (low + high) / 2) < 1e-10);
    assert.ok(Math.abs(remaining(result.time)) < 1e-7);
  }
  assert.ok(reachable > 50 && unreachable > 50);
});

test('world uses a muzzle-based exact lead and returns a fresh direct point when unreachable', () => {
  const world = new FlightWorld(new THREE.Group());
  world.player.position.set(0, 500, 1000); world.player.rotation.identity();
  const target = world.fighters[1];
  target.position.set(0, 620, 634); target.speed = 200;
  target.rotation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
  const point = world.interceptPoint(target);
  const expectedTime = Math.sqrt((120 ** 2 + 360 ** 2) / (720 ** 2 - 200 ** 2));
  assert.ok(Math.abs(point.x - 200 * expectedTime) < 1e-9);
  assert.equal(point.y, 620); assert.equal(point.z, 634);
  assert.deepEqual(target.position.toArray(), [0, 620, 634]);
  target.position.set(0, 500, -5000); target.speed = 0;
  assert.equal(world.interceptPoint(target), null);
  assert.deepEqual(world.aimPoint(target).toArray(), target.position.toArray());
  assert.notEqual(world.aimPoint(target), target.position);
});

test('real player shots use the same muzzle solution and do not inherit player speed', () => {
  const world = new FlightWorld(new THREE.Group());
  for (let i = 0; i < 182; i++) world.step(1 / 60, NEUTRAL_INPUT);
  const enemy = world.enemies[0]; world.fighters.splice(0, world.fighters.length, world.player, enemy);
  world.player.position.set(0, 500, 1000); world.player.speed = 190;
  enemy.position.set(20, 500, 700); enemy.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  world.targetId = enemy.id;
  const direction = world.aimPoint(enemy).sub(world.player.position).normalize();
  world.player.rotation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
  world.step(1 / 60, { ...NEUTRAL_INPUT, fire: true, boost: true });
  const bolt = world.bolts.find(b => b.owner === 'player'); assert.ok(bolt);
  assert.ok(Math.abs(bolt.velocity.length() - 720) < 1e-9);
  assert.ok(bolt.previous.distanceTo(world.muzzlePosition(world.player)) < 1e-9);
  const expected = world.aimPoint(enemy).sub(world.muzzlePosition(world.player)).normalize();
  assert.ok(bolt.velocity.clone().normalize().dot(expected) > 1 - 1e-12);
});
