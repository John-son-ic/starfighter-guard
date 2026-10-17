/** Contract v1. Pure data only. Coordinate system: meters, +Y up, -Z forward. */
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type ModelId = 'venator' | 'eta2' | 'arc170' | 'vulture' | 'munificent' | 'ywing';
export type MissionPhase = 'briefing' | 'combat' | 'intermission' | 'won' | 'lost';
export type LossReason = 'player-destroyed' | 'carrier-destroyed';

export interface MissionConfig {
  readonly waves: readonly number[];
  readonly briefingSeconds: number;
  readonly intermissionSeconds: number;
  readonly maxActiveEnemies: number;
}

export interface MissionState {
  readonly phase: MissionPhase;
  /** -1 before the first wave; zero-based afterwards. */
  readonly waveIndex: number;
  readonly activeEnemyIds: readonly string[];
  readonly elapsedSeconds: number;
  readonly phaseSeconds: number;
  readonly kills: number;
  readonly lossReason: LossReason | null;
}

export interface MissionInput {
  readonly playerAlive: boolean;
  readonly carrierAlive: boolean;
  readonly destroyedEnemyIds: readonly string[];
}

export type MissionEvent =
  | Readonly<{ type: 'spawn-wave'; waveIndex: number; enemyIds: readonly string[] }>
  | Readonly<{ type: 'mission-won' }>
  | Readonly<{ type: 'mission-lost'; reason: LossReason }>;

export interface MissionStep {
  readonly state: MissionState;
  readonly events: readonly MissionEvent[];
}

export interface WeaponConfig {
  readonly maxHeat: number;
  readonly heatPerShot: number;
  readonly coolingPerSecond: number;
  readonly shotIntervalSeconds: number;
  readonly unlockHeat: number;
}

export interface WeaponState {
  readonly heat: number;
  readonly cooldownSeconds: number;
  readonly overheated: boolean;
}

export interface WeaponStep {
  readonly state: WeaponState;
  readonly fired: boolean;
}

export interface Settings {
  readonly version: 1;
  readonly volume: number;
  readonly sensitivity: number;
  readonly quality: 'low' | 'medium';
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
