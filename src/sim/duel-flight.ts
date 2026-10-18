import { DUEL_NET, DUEL_RULES, type DuelInputFrame, type DuelPair, type DuelSlot } from '../shared/duel-contract.ts';
import type { DuelFlightEvent, DuelFlightState, DuelFlightStep, DuelPilotState, DuelProjectile, DuelVec3 } from '../shared/duel-snapshot.ts';
import { WEAPON_CONFIG } from '../shared/config.ts';
import { advanceWeapon, createWeapon } from './combat.ts';
import { solveIntercept } from './intercept.ts';
import type { DuelCollider, DuelHullHit } from './duel-collision.ts';
import { add,sub,scale,dot,length,normalize,clamp,multiplyQuat,normalizeQuat,forward,face,turnTowards,mix,segmentSphere } from './duel-math.ts';

export const DUEL_FLIGHT = Object.freeze({
  health:100, radius:3, minSpeed:55, maxSpeed:190, acceleration:65,
  boostMultiplier:1.6, boostDrain:30, energyRecharge:18,
  laserDamage:10, laserSpeed:720, laserLifeTicks:120, laserRadius:0.6,
  torpedoDamage:60, torpedoSpeed:330, torpedoLifeTicks:420, torpedoRadius:1.2,
  torpedoLockTicks:120, torpedoCooldownTicks:1080, torpedoRange:1200,
  torpedoCone:Math.PI/12, torpedoTurnRate:1.8,
  shieldTicks:180, shieldCooldownTicks:1500,
  arenaRadius:1800, maxProjectiles:64,
});
const DT=1/DUEL_RULES.tickRate;
const CENTER: DuelVec3=[0,180,0];
export const NEUTRAL_DUEL_INPUT: DuelInputFrame=Object.freeze({seq:0,yaw:0,pitch:0,roll:0,throttle:0,boost:false,fire:false,torpedo:false,shield:false});

function validateInput(input: DuelInputFrame) {
  if(!Number.isInteger(input.seq)||input.seq<0||input.seq>DUEL_NET.maxSequence) throw new RangeError('Invalid internal input sequence');
  for(const key of ['yaw','pitch','roll','throttle'] as const) if(!Number.isFinite(input[key])||Math.abs(input[key])>1) throw new RangeError(`Invalid ${key}`);
  for(const key of ['boost','fire','torpedo','shield'] as const) if(typeof input[key]!=='boolean') throw new RangeError(`Invalid ${key}`);
}
function validateRound(roundId: number) {
  if(!Number.isSafeInteger(roundId)||roundId<1||roundId>DUEL_NET.maxSequence) throw new RangeError('Invalid roundId');
}
function pilot(slot: DuelSlot,roundId: number,lastProcessedSeq=0): DuelPilotState {
  const side=((slot+(roundId-1)%2)%2)===0?-1:1;
  return {
    slot,position:[side*650,180,250],rotation:face([-side,0,0]),speed:115,velocity:[0,0,0],
    health:DUEL_FLIGHT.health,energy:100,boosting:false,weapon:createWeapon(),
    torpedoCooldownTicks:[0,0],lockTicks:0,shieldTicks:0,shieldCooldownTicks:0,
    torpedoHeld:false,shieldHeld:false,lastProcessedSeq,
  };
}
export function createDuelFlight(roundId=1): DuelFlightState {
  validateRound(roundId);
  return {tick:0,roundId,pilots:[pilot(0,roundId),pilot(1,roundId)],projectiles:[],nextProjectileId:1,nextEventId:1};
}
/** Same match: retain tick/event/projectile sequences so stale effects cannot replay. */
export function resetDuelRound(state: DuelFlightState,roundId: number): DuelFlightState {
  validateRound(roundId);
  if(roundId<=state.roundId) throw new RangeError('Round must advance');
  return {...state,roundId,pilots:[pilot(0,roundId,state.pilots[0].lastProcessedSeq),pilot(1,roundId,state.pilots[1].lastProcessedSeq)],projectiles:[]};
}
export interface DuelMotionStep { readonly pilot: DuelPilotState; readonly hullHit: DuelHullHit | null }
/** Shared by server and later client prediction. Exactly one 1/60 s step, no clock. */
export function advanceDuelMotion(p: DuelPilotState,input: DuelInputFrame,collider: DuelCollider): DuelMotionStep {
  validateInput(input);
  if(p.health<=0) return {pilot:p,hullHit:null};
  let shieldTicks=Math.max(0,p.shieldTicks-1),shieldCooldownTicks=Math.max(0,p.shieldCooldownTicks-1);
  if(input.shield&&!p.shieldHeld&&shieldCooldownTicks===0) {shieldTicks=DUEL_FLIGHT.shieldTicks;shieldCooldownTicks=DUEL_FLIGHT.shieldCooldownTicks;}
  let rotation=p.rotation;
  for(const [axis,angle] of [[1,-input.yaw*1.15*DT],[0,input.pitch*DT],[2,input.roll*1.4*DT]] as const) {
    const q: [number,number,number,number]=[0,0,0,Math.cos(angle/2)];q[axis]=Math.sin(angle/2);
    rotation=multiplyQuat(rotation,q);
  }
  rotation=normalizeQuat(rotation);
  const speed=clamp(p.speed+input.throttle*DUEL_FLIGHT.acceleration*DT,DUEL_FLIGHT.minSpeed,DUEL_FLIGHT.maxSpeed);
  const boosting=input.boost&&p.energy>1;
  const energy=clamp(p.energy+(boosting?-DUEL_FLIGHT.boostDrain:DUEL_FLIGHT.energyRecharge)*DT,0,100);
  let velocity=scale(forward(rotation),speed*(boosting?DUEL_FLIGHT.boostMultiplier:1));
  let position=add(p.position,scale(velocity,DT));
  const away=sub(position,CENTER);
  if(length(away)>DUEL_FLIGHT.arenaRadius) {
    const normal=normalize(away);position=add(CENTER,scale(normal,DUEL_FLIGHT.arenaRadius));
    velocity=sub(velocity,scale(normal,Math.max(0,dot(velocity,normal))));
  }
  const hullHit=collider.sweepSphere(p.position,position,DUEL_FLIGHT.radius);
  let health=p.health;
  if(hullHit) {
    if(shieldTicks>0) {
      position=add(hullHit.point,scale(hullHit.normal,DUEL_FLIGHT.radius+0.1));
      const direction=forward(rotation),reflected=normalize(add(sub(direction,scale(hullHit.normal,2*dot(direction,hullHit.normal))),scale(hullHit.normal,0.4)));
      rotation=face(reflected);velocity=scale(reflected,speed*(boosting?DUEL_FLIGHT.boostMultiplier:1));
    } else {position=mix(p.position,position,hullHit.fraction);health=0;velocity=[0,0,0];}
  }
  return {pilot:{...p,position,rotation,speed,velocity,health,energy,boosting,shieldTicks,shieldCooldownTicks,shieldHeld:input.shield,lastProcessedSeq:Math.max(p.lastProcessedSeq,input.seq)},hullHit};
}

/** Simultaneous movement/fire, accumulate all damage, then report both deaths together. */
export function advanceDuelFlight(state: DuelFlightState,inputs: DuelPair<DuelInputFrame>,collider: DuelCollider): DuelFlightStep {
  validateInput(inputs[0]);validateInput(inputs[1]);
  if(state.pilots.some(p=>p.health<=0)) return {state,events:[],deadSlots:state.pilots.filter(p=>p.health<=0).map(p=>p.slot)};
  const movements=[advanceDuelMotion(state.pilots[0],inputs[0],collider),advanceDuelMotion(state.pilots[1],inputs[1],collider)] as const;
  const pilots: [DuelPilotState,DuelPilotState]=[movements[0].pilot,movements[1].pilot];
  const projectiles: DuelProjectile[]=[...state.projectiles],events: DuelFlightEvent[]=[];
  let nextProjectileId=state.nextProjectileId,nextEventId=state.nextEventId;
  const emit=(type: DuelFlightEvent['type'],slot: DuelSlot,position: DuelVec3,normal: DuelVec3 | null=null)=>events.push({id:nextEventId++,type,slot,position,normal});
  for(const slot of [0,1] as const) {
    const p=pilots[slot],old=state.pilots[slot];
    if(p.shieldTicks===DUEL_FLIGHT.shieldTicks&&p.shieldCooldownTicks===DUEL_FLIGHT.shieldCooldownTicks&&!old.shieldHeld) emit('shield-on',slot,p.position);
    const hit=movements[slot].hullHit;
    if(hit&&p.health>0) emit('shield-bounce',slot,hit.point,hit.normal);
  }
  function launch(slot: DuelSlot,kind: DuelProjectile['kind']) {
    const p=pilots[slot],direction=forward(p.rotation),position=add(p.position,scale(direction,12));
    const hit=collider.sweepSphere(p.position,position,kind==='laser'?DUEL_FLIGHT.laserRadius:DUEL_FLIGHT.torpedoRadius);
    emit(kind==='laser'?'shot':'torpedo-launch',slot,p.position);
    if(hit) {emit('impact',slot,hit.point,hit.normal);return;}
    projectiles.push({id:nextProjectileId++,owner:slot,kind,position,velocity:scale(direction,kind==='laser'?DUEL_FLIGHT.laserSpeed:DUEL_FLIGHT.torpedoSpeed),lifeTicks:kind==='laser'?DUEL_FLIGHT.laserLifeTicks:DUEL_FLIGHT.torpedoLifeTicks});
  }
  for(const slot of [0,1] as const) {
    let p=pilots[slot];const input=inputs[slot],other=pilots[(1-slot) as DuelSlot];
    if(p.health<=0) continue;
    const cooldowns=p.torpedoCooldownTicks.map(t=>Math.max(0,t-1)) as [number,number];
    const delta=sub(other.position,p.position),range=length(delta);
    const valid=other.health>0&&cooldowns.some(t=>t===0)&&range>1e-9&&range<=DUEL_FLIGHT.torpedoRange&&dot(forward(p.rotation),scale(delta,1/range))>=Math.cos(DUEL_FLIGHT.torpedoCone)&&!collider.sweepSphere(p.position,other.position,0);
    let lockTicks=valid?Math.min(DUEL_FLIGHT.torpedoLockTicks,p.lockTicks+1):0;
    const weapon=advanceWeapon(p.weapon,DT,input.fire,WEAPON_CONFIG);
    p={...p,weapon:weapon.state,torpedoCooldownTicks:cooldowns,lockTicks,torpedoHeld:input.torpedo};pilots[slot]=p;
    if(weapon.fired&&projectiles.length<DUEL_FLIGHT.maxProjectiles) launch(slot,'laser');
    if(input.torpedo&&!state.pilots[slot].torpedoHeld&&valid&&lockTicks===DUEL_FLIGHT.torpedoLockTicks&&projectiles.length<DUEL_FLIGHT.maxProjectiles) {
      const ready=cooldowns.findIndex(t=>t===0);cooldowns[ready]=DUEL_FLIGHT.torpedoCooldownTicks;lockTicks=0;
      pilots[slot]={...p,torpedoCooldownTicks:cooldowns,lockTicks};launch(slot,'torpedo');
    }
  }
  const damage=[0,0],survivors: DuelProjectile[]=[];
  for(const bolt of projectiles) {
    const victimSlot=(1-bolt.owner) as DuelSlot,victim=pilots[victimSlot];
    let velocity=bolt.velocity;
    if(bolt.kind==='torpedo'&&victim.health>0) {
      const target=solveIntercept({x:bolt.position[0],y:bolt.position[1],z:bolt.position[2]},{x:victim.position[0],y:victim.position[1],z:victim.position[2]},{x:victim.velocity[0],y:victim.velocity[1],z:victim.velocity[2]},DUEL_FLIGHT.torpedoSpeed,bolt.lifeTicks*DT);
      const desired=target?[target.point.x,target.point.y,target.point.z] as DuelVec3:victim.position;
      velocity=scale(turnTowards(velocity,sub(desired,bolt.position),DUEL_FLIGHT.torpedoTurnRate*DT),DUEL_FLIGHT.torpedoSpeed);
    }
    const end=add(bolt.position,scale(velocity,DT)),radius=bolt.kind==='laser'?DUEL_FLIGHT.laserRadius:DUEL_FLIGHT.torpedoRadius;
    const hull=collider.sweepSphere(bolt.position,end,radius);
    // Relative sweep accounts for the target moving through the projectile this tick.
    const t=victim.health>0?segmentSphere(sub(bolt.position,state.pilots[victimSlot].position),sub(end,victim.position),[0,0,0],DUEL_FLIGHT.radius+radius):null;
    if(hull&&(t===null||hull.fraction<=t)) {emit('impact',bolt.owner,hull.point,hull.normal);continue;}
    if(t!==null) {
      const point=mix(bolt.position,end,t),normal=normalize(sub(point,mix(state.pilots[victimSlot].position,victim.position,t)));
      const shield=victim.shieldTicks>0;
      damage[victimSlot]=damage[victimSlot]!+(bolt.kind==='laser'?(shield?0:DUEL_FLIGHT.laserDamage):DUEL_FLIGHT.torpedoDamage*(shield?0.5:1));
      emit(shield?'shield-hit':'impact',victimSlot,point,normal);continue;
    }
    if(bolt.lifeTicks>1) survivors.push({...bolt,position:end,velocity,lifeTicks:bolt.lifeTicks-1});
  }
  for(const slot of [0,1] as const) {
    pilots[slot]={...pilots[slot],health:Math.max(0,pilots[slot].health-damage[slot]!)};
    if(pilots[slot].health===0) emit('destroyed',slot,pilots[slot].position);
  }
  return {state:{tick:state.tick+1,roundId:state.roundId,pilots,projectiles:survivors,nextProjectileId,nextEventId},events,deadSlots:pilots.filter(p=>p.health===0).map(p=>p.slot)};
}
