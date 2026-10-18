import type { DuelInputFrame } from '../../shared/duel-contract.ts';
import type { DuelPilotState } from '../../shared/duel-snapshot.ts';
import type { DuelCollider } from '../../sim/duel-collision.ts';
import { advanceDuelMotion } from '../../sim/duel-flight.ts';
import { mix, normalizeQuat } from '../../sim/duel-math.ts';

export function reconcilePilot(authoritative: DuelPilotState,frames: readonly DuelInputFrame[],collider: DuelCollider) {
  const pending=frames.filter(frame=>frame.seq>authoritative.lastProcessedSeq).slice(-120);
  let pilot=authoritative;
  for(const frame of pending)pilot=advanceDuelMotion(pilot,frame,collider).pilot;
  return {pilot,pending};
}
/** Shortest quaternion hemisphere; interpolation never crosses a round boundary. */
export function interpolatePilot(a: DuelPilotState,b: DuelPilotState,t: number): DuelPilotState {
  const fraction=Math.max(0,Math.min(1,t)),sign=a.rotation.reduce((n,v,i)=>n+v*b.rotation[i]!,0)<0?-1:1;
  return {...b,position:mix(a.position,b.position,fraction),rotation:normalizeQuat(a.rotation.map((v,i)=>v+(b.rotation[i]!*sign-v)*fraction) as [number,number,number,number])};
}
