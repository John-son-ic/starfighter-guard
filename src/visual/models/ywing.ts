import {Group} from 'three';
import {box,cylinder,ellipsoid,finalize,nozzle,palette,plate} from './primitives.ts';
export function createYWingModel():Group {
 const g=new Group(),p=palette();
 box(g,p.trim,[1.3,.7,8],[0,0,0]);
 plate(g,p.hull,[[-1.2,-6],[1.2,-6],[1.5,-3],[.6,-1],[-.6,-1],[-1.5,-3]],.7,.2);
 box(g,p.yellow,[.55,.06,2.4],[0,.59,-4.5]);ellipsoid(g,p.glass,[.65,.48,1.1],[0,.65,-2.8]);
 box(g,p.hull,[8,.35,1.3],[0,0,.3]);
 for(const s of [-1,1]) {
  cylinder(g,p.hull,.85,5.8,[s*3.7,0,-.5],.65);nozzle(g,p,.7,1,[s*3.7,0,2.7]);
  for(const x of [-.55,.55])box(g,p.trim,[.12,.12,5.1],[s*3.7+x,0,4.3]);
  box(g,p.hull,[1.5,.16,.4],[s*3.7,0,6.7]);cylinder(g,p.dark,.08,1.8,[s*.55,.12,-5.9]);
  for(let i=0;i<5;i++)box(g,p.dark,[.3,.15,.5],[s*.5,.5,-.6+i*.8]);
 }
 return finalize(g,'ywing',23.4);
}
