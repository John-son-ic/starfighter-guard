/** Duel v1 design contract. No networking, game integration or implementation here. */
export const DUEL_PROTOCOL_VERSION = 1 as const;
export const DUEL_ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DUEL_RULES = Object.freeze({
  tickRate: 60,
  scoreToWin: 3,
  countdownTicks: 180,
  intermissionTicks: 300,
  matchLimitTicks: 36000,
});
export const DUEL_NET = Object.freeze({
  inputRate: 30,
  snapshotRate: 20,
  maxFramesPerMessage: 2,
  maxMessageBytes: 8192,
  maxSequence: 2147483647,
  inputTimeoutMs: 250,
  bucketCapacity: 120,
  bucketRefillPerSecond: 60,
  admissionCost: 20,
});

export type DuelSlot = 0 | 1;
export type DuelPair<T> = readonly [T, T];
export type DuelPhase = 'waiting' | 'countdown' | 'playing' | 'intermission' | 'finished' | 'closed';
export type DuelFinishReason = 'score' | 'time-limit' | 'disconnect' | 'leave';
export interface DuelMember {
  readonly connectionId: string;
  readonly ready: boolean;
}
export interface DuelRoomState {
  readonly code: string;
  readonly phase: DuelPhase;
  readonly members: DuelPair<DuelMember | null>;
  readonly scores: DuelPair<number>;
  readonly matchId: number;
  readonly roundId: number;
  readonly phaseTicks: number;
  readonly matchTicks: number;
  readonly winner: DuelSlot | null;
  readonly finishReason: DuelFinishReason | null;
}
/** Internal trusted commands. A client cannot supply connectionId or deadSlots. */
export type DuelRoomCommand =
  | { readonly type: 'join'; readonly connectionId: string }
  | { readonly type: 'ready'; readonly connectionId: string; readonly value: boolean }
  | { readonly type: 'leave'; readonly connectionId: string; readonly reason: 'leave' | 'disconnect' }
  | { readonly type: 'tick'; readonly deadSlots: readonly DuelSlot[] };
export type DuelRoomError = 'room-full' | 'already-member' | 'not-member' | 'room-busy' | 'not-ready-phase' | 'room-closed';
export type DuelRoomEvent =
  | { readonly type: 'member-joined'; readonly slot: DuelSlot }
  | { readonly type: 'member-left'; readonly slot: DuelSlot }
  | { readonly type: 'countdown-started'; readonly matchId: number }
  | { readonly type: 'round-started'; readonly roundId: number }
  | { readonly type: 'round-ended'; readonly winner: DuelSlot | null; readonly deadSlots: readonly DuelSlot[] }
  | { readonly type: 'match-finished'; readonly winner: DuelSlot | null; readonly reason: DuelFinishReason }
  | { readonly type: 'room-closed' };
export interface DuelRoomStep {
  readonly state: DuelRoomState;
  readonly events: readonly DuelRoomEvent[];
  readonly error: DuelRoomError | null;
}

export interface DuelInputFrame {
  readonly seq: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly throttle: number;
  readonly boost: boolean;
  readonly fire: boolean;
  readonly torpedo: boolean;
  readonly shield: boolean;
}
/** Only client -> server v1 messages. No client-reported hits, transforms or time steps. */
export type DuelClientMessage =
  | { readonly v: 1; readonly type: 'create' }
  | { readonly v: 1; readonly type: 'join'; readonly code: string }
  | { readonly v: 1; readonly type: 'ready'; readonly value: boolean }
  | { readonly v: 1; readonly type: 'input'; readonly matchId: number; readonly roundId: number; readonly frames: readonly DuelInputFrame[] }
  | { readonly v: 1; readonly type: 'ping'; readonly nonce: number }
  | { readonly v: 1; readonly type: 'leave' };
export type DuelDecodeResult =
  | { readonly ok: true; readonly message: DuelClientMessage }
  | { readonly ok: false; readonly error: 'too-large' | 'bad-json' | 'invalid-message' };
export interface DuelMessageBudget {
  readonly tokens: number;
  readonly lastMs: number;
}
export interface DuelBudgetStep {
  readonly state: DuelMessageBudget;
  readonly allowed: boolean;
}
