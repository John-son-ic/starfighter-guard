import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVenatorModel } from '../src/visual/models/venator.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';

test('Venator spatial index matches native triangle hits, normals and ray ranges', () => {
  const root = createVenatorModel(); root.updateMatrixWorld(true);
  try {
    const ray = new Raycaster();
    for(let i=0;i<100;i++) {
      if (i===50) { root.position.set(25,-15,40); root.rotation.set(0.12,0.31,-0.06); root.scale.set(1.1,0.9,1.2); root.updateMatrixWorld(true); }
      const origin = new Vector3(Math.sin(i*2.4)*800,Math.cos(i*1.7)*450,Math.sin(i*.83)*900);
      const target = new Vector3(Math.sin(i*1.3)*170,Math.cos(i*.93)*30,Math.cos(i*.61)*420);
      ray.set(origin,target.sub(origin).normalize()); ray.near=i%4===0?400:0; ray.far=i%7===0?250:2500;
      const accelerated = ray.intersectObject(root,true);
      const native = [];
      for(const part of root.children) Mesh.prototype.raycast.call(part,ray,native);
      native.sort((a,b)=>a.distance-b.distance);
      assert.equal(accelerated.length,native.length,`ray ${i}: intersection count`);
      for(let j=0;j<native.length;j++) {
        assert.ok(Math.abs(accelerated[j].distance-native[j].distance)<1e-7,`ray ${i}: distance`);
        assert.ok(accelerated[j].point.distanceTo(native[j].point)<1e-7);
        assert.ok(accelerated[j].face.normal.distanceTo(native[j].face.normal)<1e-7);
      }
    }
  } finally { disposeModel(root); }
});

test('Venator GLB preserves compact vertex wear, dimensions and material batches', async () => {
  const source = createVenatorModel();
  const data = await readFile(new URL('../public/models/venator.glb',import.meta.url));
  const parsed = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
  try {
    const size = new Box3().setFromObject(parsed.scene).getSize(new Vector3());
    assert.ok(Math.abs(size.z-1155)<0.001);
    const parts=[]; parsed.scene.traverse(o=>{if(o.isMesh) parts.push(o)});
    assert.equal(parts.length,9);
    assert.ok(data.byteLength<7_000_000,'portable model size budget');
    for(const original of source.children) {
      const restored = parts.find(p=>p.name===original.name);
      assert.ok(restored);
      const colors=original.geometry.getAttribute('color'), exported=restored.geometry.getAttribute('color');
      assert.ok(colors.normalized && exported.normalized);
      assert.equal(exported.count,colors.count);
      assert.ok(restored.material.vertexColors);
      for(let i=0;i<colors.count;i+=97) for(const accessor of ['getX','getY','getZ']) {
        assert.ok(Math.abs(colors[accessor](i)-exported[accessor](i))<1/255);
      }
    }
  } finally { disposeModel(source); disposeModel(parsed.scene); }
});
