import type { MissionConfig, ModelId, Settings, WeaponConfig } from './types.ts';

export const MVP_CONFIG = Object.freeze({
  friendlies: 2,
  maxActiveEnemies: 4,
  models: Object.freeze(['venator', 'eta2', 'arc170', 'vulture'] satisfies ModelId[]),
  playerHealth: 100,
  carrierHealth: 1000,
  fixedStepSeconds: 1 / 60,
});

export const MISSION_CONFIG: MissionConfig = Object.freeze({
  waves: Object.freeze([3, 4, 4]),
  briefingSeconds: 3,
  intermissionSeconds: 8,
  maxActiveEnemies: MVP_CONFIG.maxActiveEnemies,
});

/** Initial tuning values, not canon specifications or final game balance. */
export const WEAPON_CONFIG: WeaponConfig = Object.freeze({
  maxHeat: 100,
  heatPerShot: 12,
  coolingPerSecond: 20,
  shotIntervalSeconds: 0.15,
  unlockHeat: 35,
});

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  version: 1,
  volume: 0.6,
  sensitivity: 1,
  quality: 'medium',
});

export const SETTINGS_KEY = 'starfighter-guard:settings:v1';
