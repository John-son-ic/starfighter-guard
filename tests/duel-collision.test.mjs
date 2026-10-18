import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Mesh,Raycaster,Vector3,DoubleSide} from 'three';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
import {createDuelCollider,decodeDuelCollision} from '../src/sim/duel-collision.ts';

const plane=()=>createDuelCollider([-10,-10,0,10,-10,0,0,10,0],[0,1,2]);
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const asset=readFileSync(new URL('../public/collision/venator-duel.bin',import.meta.url));
const buffer=()=>asset.buffer.slice(asset.byteOffset,asset.byteOffset+asset.byteLength);

test('swept sphere hits a thin triangle before its center crosses, from either side',()=>{
  for(const sign of [1,-1]) {
    const hit=plane().sweepSphere([0,0,sign*10],[0,0,-sign*10],2);
    close(hit.fraction,0.4);close(hit.point[2],0);close(hit.normal[2],sign);
  }
});
test('point sweeps retain an opposing normal and do not miss fast crossings',()=>{
  for(const sign of [1,-1]) {
    const hit=plane().sweepSphere([0,0,sign*1000],[0,0,-sign*1000],0);
    close(hit.fraction,0.5);close(hit.normal[2],sign);
  }
});
test('sphere edge and vertex contacts work when the center misses the triangle',()=>{
  const triangle=createDuelCollider([0,0,0,10,0,0,0,10,0],[0,1,2]);
  const edge=triangle.sweepSphere([5,-1,4],[5,-1,-4],2);
  close(edge.fraction,(4-Math.sqrt(3))/8);
  const corner=triangle.sweepSphere([-1,-1,4],[-1,-1,-4],2);
  close(corner.fraction,(4-Math.sqrt(2))/8);
  assert.equal(triangle.sweepSphere([-3,-3,4],[-3,-3,-4],2),null);
});
test('initial contact, stationary overlap, parallel miss and nearest triangle are defined',()=>{
  const c=plane();assert.equal(c.sweepSphere([0,0,1],[0,0,1],2).fraction,0);
  assert.equal(c.sweepSphere([0,0,4],[1,0,4],2),null);
  const stacked=createDuelCollider([-10,-10,0,10,-10,0,0,10,0,-10,-10,5,10,-10,5,0,10,5],[0,1,2,3,4,5]);
  close(stacked.sweepSphere([0,0,10],[0,0,-10],0).fraction,0.25);
});
test('geometry and exposed bounds cannot mutate the private index; malformed data rejects',()=>{
  const vertices=[-10,-10,0,10,-10,0,0,10,0],indices=[0,1,2],c=createDuelCollider(vertices,indices);
  vertices.fill(999);indices.fill(0);c.bounds[0].fill(999);
  assert.ok(c.sweepSphere([0,0,10],[0,0,-10],0));
  for(const bad of [[[],[]],[[0,0,0],[0,1,2]],[[0,0,NaN,1,0,0,0,1,0],[0,1,2]],[[0,0,0,1,0,0,0,1,0],[0,1,1.2]]]) assert.throws(()=>createDuelCollider(...bad),RangeError);
  assert.throws(()=>c.sweepSphere([0,0,0],[0,0,1],-1),RangeError);
});
test('collision binary has verified source and content hashes and bounded exact length',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/collision/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.bytes,asset.length);assert.equal(manifest.sha256,createHash('sha256').update(asset).digest('hex'));
  for(const [path,hash] of Object.entries(manifest.sourceHashes)) assert.equal(createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),hash,`stale collision: run node scripts/export-duel-collision.mjs (${path})`);
  const c=decodeDuelCollision(buffer());assert.equal(c.triangleCount,manifest.triangles);assert.deepEqual(c.bounds,manifest.bounds);
  for(const size of [0,15,asset.length-4]) assert.throws(()=>decodeDuelCollision(buffer().slice(0,size)),RangeError);
  const bad=buffer();new Uint8Array(bad)[0]=0;assert.throws(()=>decodeDuelCollision(bad),RangeError);
});
test('exported BVH matches rendered Venator triangles for 96 independent outside rays',()=>{
  const collider=decodeDuelCollision(buffer()),model=createVenatorModel(false,false);
  model.traverse(mesh=>{if(mesh instanceof Mesh){mesh.raycast=Mesh.prototype.raycast;mesh.material.side=DoubleSide;}});model.updateMatrixWorld(true);
  try {
    let hits=0;
    for(let i=0;i<96;i++) {
      const az=i*2.3999632297,y=((i*37)%97)/48-1;
      const start=new Vector3(Math.cos(az)*1400,y*1000,Math.sin(az)*1400),target=new Vector3(Math.sin(i)*70,Math.cos(i*3)*15,Math.cos(i*2)*250);
      const delta=target.clone().sub(start),end=target.clone().addScaledVector(delta,0.4),distance=start.distanceTo(end);
      const native=new Raycaster(start,delta.normalize(),0,distance).intersectObject(model,true)[0];
      const hit=collider.sweepSphere(start.toArray(),end.toArray(),0);
      assert.equal(!!hit,!!native,`ray ${i}`);
      if(hit){hits++;close(hit.fraction*distance,native.distance,0.001);}
    }
    assert.ok(hits>60);
    for(const p of [[-650,180,250],[650,180,250]]) assert.equal(collider.sweepSphere(p,p,3),null);
  } finally {disposeModel(model);}
});
