/**
 * D01 — wave/outcome state machine. Pure logic: no rendering, no DOM, no clock,
 * no randomness. Time and input are passed in by the caller.
 * Behaviour source: docs/CONTRACTS.md ("D01 / src/sim/mission.ts").
 */
import type {
  LossReason,
  MissionConfig,
  MissionEvent,
  MissionInput,
  MissionState,
  MissionStep,
} from '../shared/types.ts';

/** Maximum accepted step size, in seconds. Larger steps are rejected. */
const MAX_STEP_SECONDS = 0.1;

function describeNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'a non-finite number';
}

function failRange(what: string, value: number, expected: string): never {
  throw new RangeError(`mission: ${what} must be ${expected}, received ${describeNumber(value)}`);
}

function failType(what: string): never {
  throw new RangeError(`mission: ${what}`);
}

/** 0.1 is not exactly representable, so accept a one-ulp overflow of the bound. */
function exceedsMaxStep(dt: number): boolean {
  return dt > MAX_STEP_SECONDS && dt - MAX_STEP_SECONDS > Number.EPSILON * MAX_STEP_SECONDS;
}

/** Validates a finite non-negative duration and returns it. */
function requireDuration(value: number, what: string): number {
  if (!Number.isFinite(value)) failRange(what, value, 'a finite number');
  if (value < 0) failRange(what, value, 'a finite non-negative number');
  return value;
}

/**
 * Validates a real dt and returns it. `{ finite: false }` lets mission advance
 * report a non-finite step as a RangeError instead of NaN-propagating it.
 */
function requireStep(value: number, what: string): { readonly finite: boolean; readonly seconds: number } {
  if (!Number.isFinite(value)) return { finite: false, seconds: Number.NaN };
  if (value < 0 || exceedsMaxStep(value)) failRange(what, value, `a finite number between 0 and ${MAX_STEP_SECONDS}`);
  return { finite: true, seconds: value };
}

/** Validates a wave size: an integer in 1..maxActiveEnemies. */
function requireWaveSize(count: number, maxActiveEnemies: number, what: string): number {
  if (!Number.isFinite(count) || !Number.isInteger(count)) failRange(what, count, 'an integer');
  if (count < 1 || count > maxActiveEnemies) {
    failRange(what, count, `an integer between 1 and maxActiveEnemies (${maxActiveEnemies})`);
  }
  return count;
}

/**
 * Validates a MissionConfig. Throws RangeError before any state is touched so a
 * rejected call cannot half-advance a mission.
 */
function validateConfig(config: MissionConfig | undefined): MissionConfig {
  if (!config || typeof config !== 'object') failType('config is required');
  const maxActiveEnemies = config.maxActiveEnemies;
  if (!Number.isFinite(maxActiveEnemies) || !Number.isInteger(maxActiveEnemies) || maxActiveEnemies < 1) {
    failRange('config.maxActiveEnemies', maxActiveEnemies, 'a positive integer');
  }
  const waves: readonly number[] | undefined = config.waves;
  if (!Array.isArray(waves)) failType('config.waves must be an array');
  if (waves.length === 0) failType('config.waves must not be empty');
  for (let index = 0; index < waves.length; index += 1) {
    requireWaveSize(waves[index] as number, maxActiveEnemies, `config.waves[${index}]`);
  }
  requireDuration(config.briefingSeconds, 'config.briefingSeconds');
  requireDuration(config.intermissionSeconds, 'config.intermissionSeconds');
  return config;
}

/** Builds the deterministic enemy IDs for a one-based wave number. */
function spawnEnemyIds(waveNumber: number, count: number): string[] {
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    ids.push(`wave-${waveNumber}-enemy-${index}`);
  }
  return ids;
}

function missionState(fields: MissionState): MissionState {
  return fields;
}

export function createMission(config: MissionConfig): MissionState {
  validateConfig(config);
  return missionState({
    phase: 'briefing',
    waveIndex: -1,
    activeEnemyIds: [],
    elapsedSeconds: 0,
    phaseSeconds: 0,
    kills: 0,
    lossReason: null,
  });
}

/**
 * Advances one fixed step. Exactly one phase transition per call, in the fixed
 * order documented in docs/CONTRACTS.md; leftover time inside a step is dropped.
 */
export function advanceMission(
  state: MissionState,
  dt: number,
  input: MissionInput,
  config: MissionConfig,
): MissionStep {
  validateConfig(config);
  const step = requireStep(dt, 'dt');
  if (!step.finite) failType('dt must be a finite number');
  const seconds = step.seconds;

  // 1. Terminal phases never change, and never re-emit their event.
  if (state.phase === 'won' || state.phase === 'lost') {
    return { state, events: [] };
  }

  // 2. Destruction resolves before time, kills and spawning. Player wins ties.
  const playerAlive = input?.playerAlive === true;
  const carrierAlive = input?.carrierAlive === true;
  if (!playerAlive || !carrierAlive) {
    const reason: LossReason = !playerAlive ? 'player-destroyed' : 'carrier-destroyed';
    const lost = missionState({
      phase: 'lost',
      waveIndex: state.waveIndex,
      activeEnemyIds: state.activeEnemyIds,
      elapsedSeconds: state.elapsedSeconds,
      phaseSeconds: state.phaseSeconds,
      kills: state.kills,
      lossReason: reason,
    });
    const events: readonly MissionEvent[] = [Object.freeze({ type: 'mission-lost', reason })];
    return { state: lost, events };
  }

  // 3. Time only accumulates for surviving missions.
  let phaseSeconds = state.phaseSeconds + seconds;
  let kills = state.kills;
  let waveIndex = state.waveIndex;
  let activeEnemyIds: readonly string[] = state.activeEnemyIds;
  let events: readonly MissionEvent[] = [];

  if (state.phase === 'combat') {
    // 4. Only IDs currently active count. Unknown, duplicated and stale-wave IDs
    // are ignored, so one ID can never be counted twice.
    const destroyed = new Set(Array.isArray(input.destroyedEnemyIds) ? input.destroyedEnemyIds : []);
    if (destroyed.size > 0) {
      const survivors = activeEnemyIds.filter((id) => !destroyed.has(id));
      kills += activeEnemyIds.length - survivors.length;
      activeEnemyIds = survivors;
    }

    // 5. Clearing the wave either wins the mission or starts the intermission.
    // The next wave is never spawned in the same step.
    if (activeEnemyIds.length === 0) {
      if (waveIndex >= config.waves.length - 1) {
        const won = missionState({
          phase: 'won',
          waveIndex,
          activeEnemyIds,
          elapsedSeconds: state.elapsedSeconds + seconds,
          phaseSeconds,
          kills,
          lossReason: null,
        });
        return { state: won, events: [Object.freeze({ type: 'mission-won' })] };
      }
      const intermission = missionState({
        phase: 'intermission',
        waveIndex,
        activeEnemyIds,
        elapsedSeconds: state.elapsedSeconds + seconds,
        phaseSeconds: 0,
        kills,
        lossReason: null,
      });
      return { state: intermission, events: [] };
    }
  } else if (
    // 6. A briefing/intermission that has run its course spawns the next wave.
    (state.phase === 'briefing' && phaseSeconds >= config.briefingSeconds) ||
    (state.phase === 'intermission' && phaseSeconds >= config.intermissionSeconds)
  ) {
    waveIndex = state.waveIndex + 1;
    activeEnemyIds = spawnEnemyIds(waveIndex + 1, config.waves[waveIndex] as number);
    phaseSeconds = 0;
    events = [Object.freeze({ type: 'spawn-wave', waveIndex, enemyIds: Object.freeze([...activeEnemyIds]) })];
    // Destruction events are deliberately not applied in a spawn step.
    return {
      state: missionState({
        phase: 'combat',
        waveIndex,
        activeEnemyIds,
        elapsedSeconds: state.elapsedSeconds + seconds,
        phaseSeconds,
        kills,
        lossReason: null,
      }),
      events,
    };
  }

  return {
    state: missionState({
      phase: state.phase,
      waveIndex,
      activeEnemyIds,
      elapsedSeconds: state.elapsedSeconds + seconds,
      phaseSeconds,
      kills,
      lossReason: null,
    }),
    events,
  };
}
