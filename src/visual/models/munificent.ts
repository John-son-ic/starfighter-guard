import { Box3, Group, Vector3 } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';
import { armorBlock, strut } from './venator-geometry.ts';
import { accelerateRaycast } from './venator-raycast.ts';
import { Mesh } from 'three';

/** Skeletal banking-clan frigate; exterior game interpretation, with exposed mission relay. */
export function createMunificentModel(): Group {
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
 const bounds=new Box3().setFromObject(g),center=bounds.getCenter(new Vector3()),ratio=825/bounds.getSize(new Vector3()).z;
 const result=finalize(g,'munificent',825);
 result.userData.bridge=new Vector3(0,78,-308).sub(center).multiplyScalar(ratio).toArray();
 result.userData.generator=new Vector3(0,205,-90).sub(center).multiplyScalar(ratio).toArray();
 result.traverse(o=>{if(o instanceof Mesh)accelerateRaycast(o)});
 return result;
}
