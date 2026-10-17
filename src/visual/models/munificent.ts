import { Box3, Group, Vector3 } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';
import { armorBlock, strut } from './venator-geometry.ts';
import { accelerateRaycast } from './venator-raycast.ts';
import { Mesh } from 'three';

/** Skeletal banking-clan frigate; exterior game interpretation, with exposed mission relay. */
export function createMunificentModel(includeDefenses = true): Group {
 const g=new Group(),p=palette();p.hull.color.setHex(0x8d999c);p.red.color.setHex(0x614548);
 box(g,p.dark,[42,34,710],[0,-20,0]);
 for(const side of [-1,1]) {
  for(let i=0;i<8;i++) {
   const z=-310+i*88, x=side*(75+Math.sin(i/7*Math.PI)*70);
   strut(g,p.trim,new Vector3(side*16,-15,z-25),new Vector3(x,-15,z+20),12);
   strut(g,p.dark,new Vector3(x,-15,z),new Vector3(x*0.88,58,z+24),8);
   const w=68+Math.sin(i/7*Math.PI)*58;
   plate(g,i%3===0?p.red:p.hull,[[x-w*.5,z-32],[x+w*.5,z-20],[x+w*.43,z+30],[x-w*.5,z+36]],9,58-i*2);
   armorBlock(g,p.hull,w*.7,16,48,x,-49,z,3);
   for(let j=0;j<3;j++)box(g,p.trim,[w*.75,2,2],[x,64-i*2,z-16+j*13]);
   cylinder(g,p.dark,4,30,[x,68-i*2,z-24]);
  }
  ellipsoid(g,p.trim,[58,55,80],[side*73,-12,125]);
  for(let i=0;i<5;i++)cylinder(g,p.hull,51,5,[side*73,-12,86+i*17]);
  nozzle(g,p,30,98,[side*76,-22,355]);
  cylinder(g,p.trim,9,115,[side*25,4,-355]);
  cylinder(g,p.dark,6,18,[side*25,4,-403]);
  armorBlock(g,p.hull,65,24,220,side*58,18,-270,5);
 }
 armorBlock(g,p.dark,60,65,90,0,30,-252,5);
 armorBlock(g,p.hull,130,25,72,0,74,-267,5);
 box(g,p.glass,[108,7,3],[0,78,-305]);
 for(let i=-4;i<=4;i++)box(g,p.light,[3,9,4],[i*12,78,-307]);
 // Exposed shield relay on a dorsal mast: attackable from outside the particle barrier.
 strut(g,p.trim,new Vector3(0,0,-90),new Vector3(0,190,-90),12);
 ellipsoid(g,p.blue,[25,18,25],[0,190,-90]);
 box(g,p.engine,[18,9,18],[0,207,-90]);
 const gunMounts: Vector3[]=[];
 for(const side of [-1,1])for(const i of [2,4,6]) {
  const mount=new Vector3(side*(75+Math.sin(i/7*Math.PI)*70),76-i*2,-310+i*88);gunMounts.push(mount);
  if(includeDefenses){armorBlock(g,p.trim,24,13,28,mount.x,mount.y,mount.z,2);for(const x of [-5,5])cylinder(g,p.dark,2.5,36,[mount.x+x,mount.y+5,mount.z-20]);}
 }
 // Layered armor islands leave the characteristic open rib structure visible.
 for(const side of [-1,1]) {
  for(let i=0;i<8;i++) {
   const z=-310+i*88,x=side*(75+Math.sin(i/7*Math.PI)*70),w=68+Math.sin(i/7*Math.PI)*58,y=58-i*2;
   plate(g,p.trim,[[x-w*.46,z-29],[x+w*.46,z-18],[x+w*.4,z+27],[x-w*.46,z+32]],2,y+5.5);
   for(const lane of [-1,1]) {
    armorBlock(g,p.hull,w*.34,3,43,x+lane*w*.24,y+8,z+1,1);
    for(let j=0;j<4;j++)box(g,p.dark,[w*.24,1.3,1.8],[x+lane*w*.24,y+10,z-13+j*8]);
   }
   box(g,p.red,[w*.65,2,7],[x,y+10,z+23]);
   for(const edge of [-1,1]) {
    box(g,p.trim,[3,14,54],[x+edge*w*.42,y-6,z]);
    for(let j=0;j<3;j++)box(g,p.light,[3,3,6],[x+edge*w*.42,y+2,z-18+j*18]);
   }
   strut(g,p.trim,new Vector3(side*22,-25,z-22),new Vector3(x,-35,z+22),4);
   strut(g,p.hull,new Vector3(side*25,-30,z+24),new Vector3(x,-32,z-24),3);
   armorBlock(g,p.trim,22,18,36,side*37,-18,z,2);
   for(let j=0;j<3;j++)box(g,p.dark,[w*.48,2,5],[x,-39,z-15+j*14]);
  }
  // Armored prow, recessed gun collars and segmented long spinal barrels.
  for(let i=0;i<5;i++) {
   armorBlock(g,p.trim,48,3,28,side*58,32,-351+i*38,1);
   box(g,p.red,[12,2,22],[side*58,34,-351+i*38]);
  }
  for(let i=0;i<5;i++)cylinder(g,p.hull,10.5,4,[side*25,4,-395+i*19]);
  cylinder(g,p.trim,13,14,[side*25,4,-311]);
  cylinder(g,p.dark,4.5,2,[side*25,4,-412]);
  // Machinery, pipes and radiator fins around the reactor and engine roots.
  for(let i=0;i<7;i++) {
   armorBlock(g,p.trim,24,5,9,side*116,17,78+i*14,1);
   strut(g,p.hull,new Vector3(side*55,-42,215+i*16),new Vector3(side*100,-42,215+i*16),3);
  }
  for(const dx of [-16,16])cylinder(g,p.trim,3,136,[side*76+dx,-49,260]);
  armorBlock(g,p.hull,64,19,105,side*76,6,290,4);
  for(let i=0;i<6;i++)box(g,p.dark,[45,2,6],[side*76,17,251+i*14]);
  for(let i=0;i<4;i++)cylinder(g,p.trim,31,4,[side*76,-22,325+i*17]);
  for(let i=0;i<8;i++) {
   const angle=i*Math.PI/4;
   strut(g,p.hull,new Vector3(side*76+Math.cos(angle)*29,-22+Math.sin(angle)*29,330),new Vector3(side*76+Math.cos(angle)*30,-22+Math.sin(angle)*30,389),2);
  }
 }
 // Terraced command deck, window mullions and antenna assemblies.
 armorBlock(g,p.trim,96,10,52,0,91,-263,3);
 armorBlock(g,p.hull,66,8,34,0,100,-258,2);
 for(const side of [-1,1]) {
  box(g,p.glass,[3,6,43],[side*65,78,-266]);
  for(let i=0;i<5;i++)box(g,p.trim,[4,8,2],[side*66,78,-283+i*9]);
  strut(g,p.trim,new Vector3(side*20,103,-252),new Vector3(side*20,131,-252),2);
  box(g,p.light,[12,3,4],[side*20,122,-252]);
  strut(g,p.trim,new Vector3(side*24,20,-115),new Vector3(side*8,166,-90),4);
 }
 for(let i=0;i<6;i++)box(g,p.trim,[18,4,18],[0,32+i*25,-90]);
 cylinder(g,p.trim,28,8,[0,190,-90]);
 const bounds=new Box3().setFromObject(g),center=bounds.getCenter(new Vector3()),ratio=825/bounds.getSize(new Vector3()).z;
 const result=finalize(g,'munificent',825);
 result.userData.gunMounts=gunMounts.map(v=>v.sub(center).multiplyScalar(ratio).toArray());
 result.userData.bridge=new Vector3(0,78,-308).sub(center).multiplyScalar(ratio).toArray();
 result.userData.generator=new Vector3(0,205,-90).sub(center).multiplyScalar(ratio).toArray();
 result.traverse(o=>{if(o instanceof Mesh)accelerateRaycast(o)});
 return result;
}
