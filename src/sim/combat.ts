/**
 * D02 — health and weapon state. Pure logic: no rendering, no DOM, no clock and
 * no randomness. Hit detection lives in the Codex 3D systems; this module only
 * resolves the numbers it is handed.
 * Behaviour source: docs/CONTRACTS.md ("D02 / src/sim/combat.ts").
 */
import type { WeaponConfig, WeaponState, WeaponStep } from '../shared/types.ts';

/** Maximum accepted step size, in seconds. Larger steps are rejected. */
const MAX_STEP_SECONDS = 0.1;

/**
 * A cooldown below this many seconds counts as spent. Without it, accumulated
 * floating-point error (2.08e-17 after 0.15 - 9/60) would delay a shot by one
 * whole step and make the rate depend on the frame timing.
 */
const COOLDOWN_EPSILON_SECONDS = 1e-9;

function describeNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'a non-finite number';
}

function failRange(what: string, value: number, expected: string): never {
  throw new RangeError(`combat: ${what} must be ${expected}, received ${describeNumber(value)}`);
}

function failType(what: string): never {
  throw new RangeError(`combat: ${what}`);
}

/** Validates a finite number that must not be negative, then returns it. */
function requireNonNegative(value: number, what: string): number {
  if (!Number.isFinite(value)) failRange(what, value, 'a finite number');
  if (value < 0) failRange(what, value, 'a finite non-negative number');
  return value;
}

/** Validates a finite number strictly greater than zero, then returns it. */
function requirePositive(value: number, what: string): number {
  if (!Number.isFinite(value)) failRange(what, value, 'a finite number');
  if (value <= 0) failRange(what, value, 'a finite number greater than 0');
  return value;
}

/**
 * Validates a WeaponConfig independently of any state, so a rejected call can
 * never half-advance a weapon. Returns it unchanged.
 */
function validateWeaponConfig(config: WeaponConfig | undefined): WeaponConfig {
  if (!config || typeof config !== 'object') failType('config is required');
  const maxHeat = requirePositive(config.maxHeat, 'config.maxHeat');
  const heatPerShot = requirePositive(config.heatPerShot, 'config.heatPerShot');
  requirePositive(config.coolingPerSecond, 'config.coolingPerSecond');
  requirePositive(config.shotIntervalSeconds, 'config.shotIntervalSeconds');

  if (heatPerShot > maxHeat) {
    failRange('config.heatPerShot', heatPerShot, `a value not greater than maxHeat (${maxHeat})`);
  }
  const unlockHeat = config.unlockHeat;
  if (!Number.isFinite(unlockHeat)) failRange('config.unlockHeat', unlockHeat, 'a finite number');
  if (unlockHeat < 0 || unlockHeat >= maxHeat) {
    failRange('config.unlockHeat', unlockHeat, `a finite number in [0, maxHeat) with maxHeat ${maxHeat}`);
  }
  return config;
}

/**
 * Clamps a possibly hostile state field into a finite, non-negative value. States
 * are expected to come from this module; this only keeps garbage from propagating.
 */
function requireFiniteValue(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value < 0 ? 0 : value;
}

function normalizeState(state: WeaponState | undefined, maxHeat: number): WeaponState {
  if (!state || typeof state !== 'object') failType('state is required');
  const heat = Math.min(requireFiniteValue(state.heat, 0), maxHeat);
  const cooldownSeconds = requireFiniteValue(state.cooldownSeconds, 0);
  return { heat, cooldownSeconds, overheated: state.overheated === true };
}

export function applyDamage(health: number, damage: number): number {
  requireNonNegative(health, 'health');
  requireNonNegative(damage, 'damage');
  return Math.max(0, health - damage);
}

export function createWeapon(): WeaponState {
  return { heat: 0, cooldownSeconds: 0, overheated: false };
}

/**
 * Advances one step: cool first, then unlock, then fire at most once. Firing adds
 * heat (clamped to maxHeat) and re-arms the cooldown; reaching maxHeat overheats
 * the weapon immediately, but that shot still counts.
 */
export function advanceWeapon(
  state: WeaponState,
  dt: number,
  triggerHeld: boolean,
  config: WeaponConfig,
): WeaponStep {
  const validated = validateWeaponConfig(config);
  if (typeof dt !== 'number' || !Number.isFinite(dt)) failType('dt must be a finite number');
  if (dt < 0 || (dt > MAX_STEP_SECONDS && dt - MAX_STEP_SECONDS > Number.EPSILON * MAX_STEP_SECONDS)) {
    failRange('dt', dt, `a finite number between 0 and ${MAX_STEP_SECONDS}`);
  }
  const maxHeat = validated.maxHeat;

  let { heat, cooldownSeconds, overheated } = normalizeState(state, maxHeat);

  // 1. Heat always cools, firing or not, and cooldown always counts down.
  heat = Math.max(0, heat - validated.coolingPerSecond * dt);
  cooldownSeconds = Math.max(0, cooldownSeconds - dt);
  // Repeated subtraction rarely lands exactly on 0 (e.g. 0.15 - 9/60 is 2.08e-17),
  // so a spent cooldown is snapped to 0 before the readiness test below.
  if (cooldownSeconds < COOLDOWN_EPSILON_SECONDS) cooldownSeconds = 0;

  // 2. Overheat clears once heat has dropped to the unlock threshold or below.
  if (overheated && heat <= validated.unlockHeat) overheated = false;

  // 3. At most one shot per call; intervals inside a long dt are not back-filled.
  let fired = false;
  if (triggerHeld === true && !overheated && cooldownSeconds === 0) {
    fired = true;
    heat = Math.min(maxHeat, heat + validated.heatPerShot);
    cooldownSeconds = validated.shotIntervalSeconds;
    if (heat >= maxHeat) overheated = true;
  }

  return { state: { heat, cooldownSeconds, overheated }, fired };
}
