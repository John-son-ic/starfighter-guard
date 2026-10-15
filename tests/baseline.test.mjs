import test from 'node:test';
import assert from 'node:assert/strict';
import { MVP_CONFIG, MISSION_CONFIG, WEAPON_CONFIG, DEFAULT_SETTINGS } from '../src/shared/config.ts';

test('mission remains within the agreed seven-fighter budget', () => {
  assert.equal(1 + MVP_CONFIG.friendlies + MVP_CONFIG.maxActiveEnemies, 7);
  assert.ok(MISSION_CONFIG.waves.every((count) => Number.isInteger(count) && count > 0 && count <= 4));
  assert.equal(MISSION_CONFIG.waves.reduce((sum, count) => sum + count, 0), 11);
  assert.ok(Object.isFrozen(MISSION_CONFIG.waves));
});

test('weapon has a real cooldown and a lower unlock threshold', () => {
  assert.ok(WEAPON_CONFIG.shotIntervalSeconds > 0);
  assert.ok(WEAPON_CONFIG.heatPerShot > 0 && WEAPON_CONFIG.heatPerShot <= WEAPON_CONFIG.maxHeat);
  assert.ok(WEAPON_CONFIG.unlockHeat >= 0 && WEAPON_CONFIG.unlockHeat < WEAPON_CONFIG.maxHeat);
  assert.ok(WEAPON_CONFIG.coolingPerSecond > 0);
});

test('settings defaults can be represented in the versioned storage format', () => {
  assert.equal(DEFAULT_SETTINGS.version, 1);
  assert.ok(DEFAULT_SETTINGS.volume >= 0 && DEFAULT_SETTINGS.volume <= 1);
  assert.ok(DEFAULT_SETTINGS.sensitivity >= 0.2 && DEFAULT_SETTINGS.sensitivity <= 3);
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), DEFAULT_SETTINGS);
});
