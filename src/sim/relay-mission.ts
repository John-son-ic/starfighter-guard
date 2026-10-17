import type {RelayState,RelayInput,RelayStep,RelayEvent} from '../shared/relay-contract.ts';
import {RELAY_CONFIG as C} from '../shared/relay-contract.ts';
export function createRelayMission(): RelayState {return{phase:'approach',elapsed:0,phaseTime:0,reinforcementTime:0,rescueCalled:false,lossReason:null};}
export function advanceRelayMission(state:RelayState,dt:number,input:RelayInput):RelayStep {
 if(!Number.isFinite(dt)||dt<0||dt>.1)throw new RangeError('relay dt must be in [0, 0.1]');
 if(!Number.isInteger(input.activeEnemies)||input.activeEnemies<0||input.activeEnemies>C.maxEnemies)throw new RangeError('relay enemy count must be in [0, 8]');
 if(state.phase==='won'||state.phase==='lost')return{state,events:[]};
 const events:RelayEvent[]=[];
 let next:RelayState={...state,elapsed:state.elapsed+dt,phaseTime:state.phaseTime+dt};
 if(!input.playerAlive)return{state:{...next,phase:'lost',phaseTime:0,lossReason:'player-destroyed'},events};
 const enter=(phase:RelayState['phase'])=>{next={...next,phase,phaseTime:0,reinforcementTime:0};};
 if(state.phase==='approach') {
  if(input.patrolCleared&&input.inStationRange){enter('facilities');events.push({type:'checkpoint',point:'facilities'});}
 } else if(state.phase==='facilities'||state.phase==='reactor') {
  if(state.phase==='facilities'&&input.commsDestroyed&&input.fireControlDestroyed){enter('reactor');events.push({type:'reactor-exposed'},{type:'checkpoint',point:'reactor'});}
  else if(state.phase==='reactor'&&input.reactorDestroyed){enter('escape');events.push({type:'escape-started'});const count=Math.max(0,4-input.activeEnemies);if(count)events.push({type:'spawn',count,purpose:'pursuit'});}
  else if(!input.commsDestroyed){const timer=state.reinforcementTime+dt;next={...next,reinforcementTime:timer};if(timer+1e-9>=C.reinforcementSeconds){next={...next,reinforcementTime:0};const count=Math.min(2,C.maxEnemies-input.activeEnemies);if(count)events.push({type:'spawn',count,purpose:'reinforcement'});}}
 } else if(state.phase==='escape') {
  if(next.phaseTime+1e-9>=C.escapeSeconds)enter('lost'),next={...next,lossReason:'escape-timeout'};
  else {
   if(!state.rescueCalled&&next.phaseTime+1e-9>=C.rescueDelay){next={...next,rescueCalled:true};events.push({type:'rescue-arrival'});}
   if(next.phaseTime+1e-9>=C.rescueDelay+C.rescueArrivalSeconds&&input.atExtraction)enter('won');
  }
 }
 return{state:next,events};
}
