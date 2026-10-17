import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {FlightWorld} from '../src/app/game/world.ts';
const choose=FlightWorld.prototype.selectNext;
const target=(id,x,y,z)=>({id,position:new Vector3(x,y,z)});
test('Tab chooses screen center ahead of range/current selection and rejects rear projection',()=>{
 const camera=new PerspectiveCamera(58,16/9,.4,14000);camera.updateMatrixWorld();
 const world={player:{position:new Vector3()},targetId:'near',attackTargets:[target('near',25,0,-50),target('center',1,0,-500),target('rear',0,0,10)]};
 choose.call(world,camera);assert.equal(world.targetId,'center');choose.call(world,camera);assert.equal(world.targetId,'center');
 camera.rotation.y=Math.PI;camera.updateMatrixWorld();choose.call(world,camera);assert.equal(world.targetId,'rear');
 world.attackTargets=[];choose.call(world,camera);assert.equal(world.targetId,null);
});
test('Tab uses pixel distance rather than uncorrected NDC on wide screens',()=>{
 const camera=new PerspectiveCamera(58,2,.4,14000);camera.updateMatrixWorld();
 const world={player:{position:new Vector3()},attackTargets:[target('horizontal',15,0,-100),target('vertical',0,10,-100)]};
 choose.call(world,camera);assert.equal(world.targetId,'vertical');
});
