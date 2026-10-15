import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightWorld, NEUTRAL_INPUT, segmentSphere } from '../src/app/game/world.ts';
import { createVenatorModel } from '../src/visual/models/venator.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';

const dt = 1 / 60;
function setup() { const carrier = createVenatorModel(); return { carrier, world: new FlightWorld(carrier) }; }
function spawn(world) { for (let i = 0; i < 182; i++) world.step(dt, NEUTRAL_INPUT); }

test('swept sphere intersection catches a fast crossing and an inside start', () => {
  assert.equal(segmentSphere(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(), 2), 0.4);
  assert.equal(segmentSphere(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), 2), 0);
  assert.equal(segmentSphere(new THREE.Vector3(-10, 3, 0), new THREE.Vector3(10, 3, 0), new THREE.Vector3(), 2), null);
});

test('world consumes spawn IDs once, removes destroyed entities and advances waves', () => {
  const { carrier, world } = setup(); spawn(world);
  assert.equal(world.enemies.length, 3);
  assert.deepEqual(world.enemies.map(f => f.id), world.mission.activeEnemyIds);
  for (const enemy of world.enemies) enemy.health = 0;
  world.step(dt, NEUTRAL_INPUT);
  assert.equal(world.enemies.length, 0); assert.equal(world.mission.kills, 3); assert.equal(world.mission.phase, 'intermission');
  for (let i = 0; i < 482; i++) world.step(dt, NEUTRAL_INPUT);
  assert.equal(world.enemies.length, 4); assert.equal(world.mission.waveIndex, 1);
  disposeModel(carrier);
});

test('a moving laser really applies damage to a crossing enemy', () => {
  const { carrier, world } = setup(); spawn(world);
  const enemy = world.enemies[0];
  enemy.position.set(0, 200, -100); enemy.previous.copy(enemy.position);
  world.bolts.push({ id: 999, owner: 'player', team: 'republic', position: new THREE.Vector3(-20, 200, -100), previous: new THREE.Vector3(-20, 200, -100), velocity: new THREE.Vector3(2400, 0, 0), life: 1, damage: 18 });
  world.step(dt, NEUTRAL_INPUT);
  assert.equal(enemy.health, 54); assert.equal(world.hitConfirm, 1); assert.ok(!world.bolts.some(b => b.id === 999));
  disposeModel(carrier);
});

test('the visible carrier blocks a laser before it reaches an enemy below its deck', () => {
  const { carrier, world } = setup(); spawn(world);
  const enemy = world.enemies[0]; enemy.position.set(0, -180, 0); enemy.previous.copy(enemy.position);
  world.bolts.push({ id: 998, owner: 'player', team: 'republic', position: new THREE.Vector3(0, 150, 0), previous: new THREE.Vector3(0, 150, 0), velocity: new THREE.Vector3(0, -24000, 0), life: 1, damage: 72 });
  world.step(dt, NEUTRAL_INPUT);
  assert.equal(enemy.health, 72); assert.ok(!world.bolts.some(b => b.id === 998));
  disposeModel(carrier);
});

test('flying into the hull resolves contact and damage instead of passing through', () => {
  const { carrier, world } = setup();
  world.player.position.set(0, 100, 0); world.player.previous.copy(world.player.position);
  world.player.rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i < 95; i++) world.step(dt, NEUTRAL_INPUT);
  assert.ok(world.player.health < 100 && world.player.health > 0);
  assert.ok(world.player.position.y > -70, 'resolved player stays outside the lower hull');
  disposeModel(carrier);
});

test('terminal worlds stay still and a new world clears all combat state', () => {
  const { carrier, world } = setup(); spawn(world); world.carrierHealth = 0;
  world.step(dt, NEUTRAL_INPUT); assert.equal(world.mission.phase, 'lost');
  const before = { time: world.time, position: world.player.position.toArray() };
  world.step(dt, { ...NEUTRAL_INPUT, fire: true, boost: true });
  assert.equal(world.time, before.time); assert.deepEqual(world.player.position.toArray(), before.position);
  const fresh = new FlightWorld(carrier);
  assert.equal(fresh.mission.kills, 0); assert.equal(fresh.bolts.length, 0); assert.equal(fresh.fighters.length, 3); assert.equal(fresh.carrierHealth, 1000);
  disposeModel(carrier);
});
