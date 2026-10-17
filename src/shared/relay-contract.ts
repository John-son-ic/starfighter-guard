/** Mission 2 contract. Pure state; coordinates, damage and rendering belong to app. */
export type RelayPhase = 'approach' | 'facilities' | 'reactor' | 'escape' | 'won' | 'lost';
export interface RelayState { readonly phase: RelayPhase; readonly elapsed: number; readonly phaseTime: number; readonly reinforcementTime: number; readonly rescueCalled: boolean; readonly lossReason: 'player-destroyed' | 'escape-timeout' | null }
export interface RelayInput { readonly playerAlive: boolean; readonly patrolCleared: boolean; readonly inStationRange: boolean; readonly commsDestroyed: boolean; readonly fireControlDestroyed: boolean; readonly reactorDestroyed: boolean; readonly atExtraction: boolean; readonly activeEnemies: number }
export type RelayEvent = Readonly<{type:'checkpoint'; point:'facilities'|'reactor'}> | Readonly<{type:'spawn'; count:number; purpose:'reinforcement'|'pursuit'}> | Readonly<{type:'rescue-arrival'}> | Readonly<{type:'reactor-exposed'}> | Readonly<{type:'escape-started'}>;
export interface RelayStep { readonly state: RelayState; readonly events: readonly RelayEvent[] }
export const RELAY_CONFIG = Object.freeze({maxEnemies:8,reinforcementSeconds:24,escapeSeconds:60,rescueDelay:8,rescueArrivalSeconds:4,facilityHealth:600,reactorHealth:1200,patrolCount:4});
