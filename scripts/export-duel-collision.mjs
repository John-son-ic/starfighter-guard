import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Mesh,Vector3} from 'three';
import {createVenatorModel} from '../src/visual/models/venator.ts';
import {disposeModel} from '../src/visual/models/primitives.ts';
import {decodeDuelCollision} from '../src/sim/duel-collision.ts';

const root=new URL('../',import.meta.url),directory=new URL('public/collision/',root);
const model=createVenatorModel(false,false),vertices=[],indices=[],lookup=new Map(),v=new Vector3();
model.updateMatrixWorld(true);
try {
  model.traverse(mesh=>{
    if(!(mesh instanceof Mesh))return;
    const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
    for(let i=0;i<(index?.count??p.count);i++) {
      v.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      const point=v.toArray().map(Math.fround),key=point.join(',');
      let id=lookup.get(key);
      if(id===undefined){id=vertices.length/3;lookup.set(key,id);vertices.push(...point);}
      indices.push(id);
    }
  });
  const buffer=new ArrayBuffer(16+vertices.length*4+indices.length*4),view=new DataView(buffer),bytes=new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode('DUELCOL1'));view.setUint32(8,vertices.length/3,true);view.setUint32(12,indices.length/3,true);
  vertices.forEach((n,i)=>view.setFloat32(16+i*4,n,true));indices.forEach((n,i)=>view.setUint32(16+vertices.length*4+i*4,n,true));
  const collider=decodeDuelCollision(buffer);
  const sources=['venator.ts','venator-detail.ts','venator-geometry.ts','primitives.ts'];
  const sourceHashes={};
  for(const name of sources){const file='src/visual/models/'+name;sourceHashes[file]=createHash('sha256').update(await readFile(new URL(file,root))).digest('hex');}
  const manifest={version:1,format:'DUELCOL1',file:'venator-duel.bin',sourceFactory:'createVenatorModel(false,false)',units:'meters',vertices:vertices.length/3,triangles:indices.length/3,bytes:bytes.byteLength,bounds:collider.bounds,sha256:createHash('sha256').update(bytes).digest('hex'),sourceHashes};
  await mkdir(directory,{recursive:true});
  await writeFile(new URL(manifest.file,directory),bytes);await writeFile(new URL('manifest.json',directory),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({directory:fileURLToPath(directory),...manifest},null,2));
} finally {disposeModel(model);}
