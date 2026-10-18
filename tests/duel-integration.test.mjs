import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDuelRoom,reduceDuelRoom} from '../src/sim/duel-room.ts';
import {decodeDuelClientMessage} from '../src/platform/duel-protocol.ts';
import {createDuelFlight,advanceDuelFlight,resetDuelRound,NEUTRAL_DUEL_INPUT as N} from '../src/sim/duel-flight.ts';
import {decodeDuelCollision} from '../src/sim/duel-collision.ts';
import {sub,rotate,clamp} from '../src/sim/duel-math.ts';
import {solveIntercept} from '../src/sim/intercept.ts';
import {createDuelSnapshot} from '../src/sim/duel-snapshot.ts';

const data=readFileSync(new URL('../public/collision/venator-duel.bin',import.meta.url));
const collider=decodeDuelCollision(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
function readyRoom(){
  let r=createDuelRoom('DUEL23');
  for(const cmd of [{type:'join',connectionId:'pilot-0'},{type:'join',connectionId:'pilot-1'},{type:'ready',connectionId:'pilot-0',value:true},{type:'ready',connectionId:'pilot-1',value:true}])r=reduceDuelRoom(r,cmd).state;
  return r;
}
function aim(p,other,seq,fire){
  const point=solveIntercept({x:p.position[0],y:p.position[1],z:p.position[2]},{x:other.position[0],y:other.position[1],z:other.position[2]},{x:other.velocity[0],y:other.velocity[1],z:other.velocity[2]},720,2)?.point;
  const direction=sub(point?[point.x,point.y,point.z]:other.position,p.position),q=p.rotation;
  const local=rotate(direction,[-q[0],-q[1],-q[2],q[3]]);
  return {...N,seq,yaw:clamp(Math.atan2(local[0],-local[2])*2,-1,1),pitch:clamp(Math.atan2(local[1],Math.hypot(local[0],local[2]))*2,-1,1),throttle:-1,fire};
}

test('real protocol, room and flight compose into three actual kills, resets, result and rematch',()=>{
  let room=readyRoom(),flight=createDuelFlight(),rounds=0,shots=0,kills=0,seq=0;
  for(let i=0;i<12000&&room.phase!=='finished';i++){
    let deaths=[];
    if(room.phase==='playing'){
      seq++;
      const controls=flight.pilots.map((p,slot)=>aim(p,flight.pilots[1-slot],seq,slot===0));
      const parsed=controls.map(frame=>decodeDuelClientMessage(JSON.stringify({v:1,type:'input',matchId:room.matchId,roundId:room.roundId,frames:[frame]})));
      assert.ok(parsed.every(p=>p.ok));
      const step=advanceDuelFlight(flight,parsed.map(p=>p.message.frames[0]),collider);
      flight=step.state;deaths=step.deadSlots;shots+=step.events.filter(e=>e.type==='shot').length;kills+=step.events.filter(e=>e.type==='destroyed').length;
    }
    const reduced=reduceDuelRoom(room,{type:'tick',deadSlots:deaths});room=reduced.state;
    for(const event of reduced.events)if(event.type==='round-started'){
      if(event.roundId>flight.roundId)flight=resetDuelRound(flight,event.roundId);
      rounds++;assert.equal(flight.projectiles.length,0);assert.ok(flight.pilots.every(p=>p.health===100&&p.shieldCooldownTicks===0));
    }
  }
  assert.equal(room.phase,'finished');assert.equal(room.winner,0);assert.deepEqual(room.scores,[3,0]);assert.equal(room.finishReason,'score');assert.equal(rounds,3);assert.equal(kills,3);assert.ok(shots>=30);
  room=reduceDuelRoom(room,{type:'ready',connectionId:'pilot-0',value:true}).state;
  room=reduceDuelRoom(room,{type:'ready',connectionId:'pilot-1',value:true}).state;
  assert.equal(room.matchId,2);assert.equal(room.roundId,1);assert.deepEqual(room.scores,[0,0]);assert.equal(room.phase,'countdown');
  flight=createDuelFlight();assert.equal(flight.nextEventId,1);assert.equal(flight.pilots[0].lastProcessedSeq,0);
});

test('same-tick mutual kills become a draw and the next round starts without stale ammunition',()=>{
  let room={...readyRoom(),phase:'playing'},flight=createDuelFlight();
  flight={...flight,pilots:flight.pilots.map((p,i)=>({...p,position:[i?100:-100,300,0],health:10})),projectiles:[{id:1,owner:0,kind:'laser',position:[95,300,0],velocity:[720,0,0],lifeTicks:2},{id:2,owner:1,kind:'laser',position:[-95,300,0],velocity:[-720,0,0],lifeTicks:2}]};
  const result=advanceDuelFlight(flight,[N,N],collider);assert.deepEqual(result.deadSlots,[0,1]);
  const ended=reduceDuelRoom(room,{type:'tick',deadSlots:result.deadSlots});room=ended.state;
  assert.equal(room.phase,'intermission');assert.deepEqual(room.scores,[0,0]);assert.equal(ended.events[0].winner,null);
  for(let i=0;i<300;i++)room=reduceDuelRoom(room,{type:'tick',deadSlots:[]}).state;
  const next=resetDuelRound(result.state,room.roundId);assert.equal(room.phase,'playing');assert.deepEqual(next.projectiles,[]);assert.ok(next.pilots.every(p=>p.health===100));
});

test('snapshots expose room occupancy but no connection identity, with a bounded event window',()=>{
  const room=readyRoom(),flight=createDuelFlight(),events=Array.from({length:200},(_,i)=>({id:i+1,type:'shot',slot:0,position:[0,0,0],normal:null}));
  const snapshot=createDuelSnapshot(room,flight,180,events);
  assert.deepEqual(snapshot.occupied,[true,true]);assert.deepEqual(snapshot.ready,[true,true]);assert.equal(snapshot.events.length,96);assert.equal(snapshot.events[0].id,105);
  assert.doesNotMatch(JSON.stringify(snapshot),/connectionId|pilot-0|pilot-1/);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot);assert.equal(events.length,200);
  const waiting=createDuelSnapshot(createDuelRoom('DUEL23'),null,0);assert.equal(waiting.flight,null);assert.deepEqual(waiting.occupied,[false,false]);
  assert.throws(()=>createDuelSnapshot({...room,phase:'playing'},null,1),RangeError);
  assert.throws(()=>createDuelSnapshot(room,createDuelFlight(2),1),RangeError);
  assert.throws(()=>createDuelSnapshot(createDuelRoom('DUEL23'),flight,1),RangeError);
  assert.throws(()=>createDuelSnapshot(room,flight,-1),RangeError);
});
