import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePilot,interpolatePilot} from '../src/app/duel/prediction.ts';
import {createDuelFlight,advanceDuelMotion,NEUTRAL_DUEL_INPUT as N} from '../src/sim/duel-flight.ts';
const collider={triangleCount:0,bounds:[[0,0,0],[0,0,0]],sweepSphere:()=>null};
test('prediction reconciliation discards acknowledged frames and replays only remaining controls',()=>{
  const p=createDuelFlight().pilots[0],frames=Array.from({length:5},(_,i)=>({...N,seq:i+1,yaw:.5}));
  let authoritative=p;for(const frame of frames.slice(0,3))authoritative=advanceDuelMotion(authoritative,frame,collider).pilot;
  const result=reconcilePilot(authoritative,frames,collider);assert.deepEqual(result.pending.map(f=>f.seq),[4,5]);
  let expected=authoritative;for(const frame of frames.slice(3))expected=advanceDuelMotion(expected,frame,collider).pilot;assert.deepEqual(result.pilot,expected);assert.equal(authoritative.lastProcessedSeq,3);
});
test('interpolation clamps time and takes the shortest quaternion hemisphere',()=>{
  const p=createDuelFlight().pilots[0],b={...p,position:[100,0,0],rotation:p.rotation.map(n=>-n)};
  assert.deepEqual(interpolatePilot(p,b,-1).position,p.position);assert.deepEqual(interpolatePilot(p,b,2).position,b.position);
  const middle=interpolatePilot(p,b,.5);assert.ok(middle.rotation.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...middle.rotation)-1)<1e-8);assert.equal(middle.position[0],(p.position[0]+100)/2);
});
