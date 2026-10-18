import type { DuelPair, DuelPhase, DuelSlot, DuelFinishReason, DuelRoomError } from './duel-contract.ts';
import type { WeaponState } from './types.ts';

export type DuelVec3 = readonly [number, number, number];
/** Quaternion order follows Three.js: x, y, z, w; forward is local -Z. */
export type DuelQuat = readonly [number, number, number, number];
export interface DuelPilotState {
  readonly slot: DuelSlot;
  readonly position: DuelVec3;
  readonly rotation: DuelQuat;
  readonly speed: number;
  readonly velocity: DuelVec3;
  readonly health: number;
  readonly energy: number;
  readonly boosting: boolean;
  readonly weapon: Readonly<WeaponState>;
  readonly torpedoCooldownTicks: DuelPair<number>;
  readonly lockTicks: number;
  readonly shieldTicks: number;
  readonly shieldCooldownTicks: number;
  readonly torpedoHeld: boolean;
  readonly shieldHeld: boolean;
  readonly lastProcessedSeq: number;
}
export interface DuelProjectile {
  readonly id: number;
  readonly owner: DuelSlot;
  readonly kind: 'laser' | 'torpedo';
  readonly position: DuelVec3;
  readonly velocity: DuelVec3;
  readonly lifeTicks: number;
}
export interface DuelFlightState {
  readonly tick: number;
  readonly roundId: number;
  readonly pilots: DuelPair<DuelPilotState>;
  readonly projectiles: readonly DuelProjectile[];
  readonly nextProjectileId: number;
  readonly nextEventId: number;
}
export interface DuelFlightEvent {
  readonly id: number;
  readonly type: 'shot' | 'torpedo-launch' | 'impact' | 'shield-hit' | 'shield-bounce' | 'shield-on' | 'destroyed';
  readonly slot: DuelSlot;
  readonly position: DuelVec3;
  readonly normal: DuelVec3 | null;
}
export interface DuelFlightStep {
  readonly state: DuelFlightState;
  readonly events: readonly DuelFlightEvent[];
  readonly deadSlots: readonly DuelSlot[];
}
/** Outbound snapshots are built by the server, never accepted as player input. */
export interface DuelSnapshot {
  readonly v: 1;
  readonly type: 'snapshot';
  readonly code: string;
  readonly matchId: number;
  readonly roundId: number;
  readonly serverTick: number;
  readonly phase: DuelPhase;
  readonly phaseTicks: number;
  readonly matchTicks: number;
  readonly scores: DuelPair<number>;
  readonly occupied: DuelPair<boolean>;
  readonly ready: DuelPair<boolean>;
  readonly winner: DuelSlot | null;
  readonly finishReason: DuelFinishReason | null;
  readonly flight: DuelFlightState | null;
  /** Recent bounded event window. Clients deduplicate by (matchId, event.id). */
  readonly events: readonly DuelFlightEvent[];
}
export type DuelServerMessage = DuelSnapshot
  | { readonly v: 1; readonly type: 'welcome'; readonly code: string; readonly slot: DuelSlot }
  | { readonly v: 1; readonly type: 'pong'; readonly nonce: number }
  | { readonly v: 1; readonly type: 'error'; readonly error: DuelRoomError | 'room-not-found' | 'server-full' | 'already-in-room' | 'invalid-message' | 'rate-limited' | 'stale-input' | 'input-queue-full'; readonly fatal: boolean }
  | { readonly v: 1; readonly type: 'closed'; readonly reason: 'idle' | 'server-shutdown' | 'room-closed' };
