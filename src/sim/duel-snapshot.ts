import type { DuelRoomState } from '../shared/duel-contract.ts';
import type { DuelFlightEvent, DuelFlightState, DuelSnapshot } from '../shared/duel-snapshot.ts';

/** Project only public room data. Never serialize the internal connection/member objects. */
export function createDuelSnapshot(room: DuelRoomState,flight: DuelFlightState | null,serverTick: number,recentEvents: readonly DuelFlightEvent[]=[]): DuelSnapshot {
  if(!Number.isSafeInteger(serverTick)||serverTick<0) throw new RangeError('Invalid server tick');
  if(room.phase==='playing'&&!flight) throw new RangeError('Playing room requires flight state');
  if(flight&&flight.roundId!==room.roundId) throw new RangeError('Room/flight round mismatch');
  if(room.phase==='waiting'&&flight) throw new RangeError('Waiting room cannot expose stale flight');
  return {
    v:1,type:'snapshot',code:room.code,matchId:room.matchId,roundId:room.roundId,
    serverTick,phase:room.phase,phaseTicks:room.phaseTicks,matchTicks:room.matchTicks,
    scores:[...room.scores],occupied:[room.members[0]!==null,room.members[1]!==null],
    ready:[room.members[0]?.ready??false,room.members[1]?.ready??false],
    winner:room.winner,finishReason:room.finishReason,flight,
    events:recentEvents.slice(-96),
  };
}
