import { Box3, Group, Mesh, Vector3 } from 'three';
import { box,cylinder,finalize,palette } from './primitives.ts';

/** Yawing armored head with independently elevating twin barrels. Pivot at trunnion. */
export function createCarrierTurret(): Group {
  const root=new Group(),body=new Group(),barrels=new Group(),p=palette();
  box(body,p.hull,[17,6,18],[0,0,0]);
  box(body,p.light,[13,2,13],[0,4,1]);
  box(body,p.trim,[19,2,4],[0,-1,8]);
  for(const side of [-1,1]) {
    cylinder(barrels,p.trim,2.3,11,[side*4,1,-11]);
    cylinder(barrels,p.dark,1.25,22,[side*4,1,-26]);
    cylinder(barrels,p.trim,1.8,3,[side*4,1,-34]);
  }
  function finish(source:Group,name:string) {
    const bounds=new Box3().setFromObject(source),center=bounds.getCenter(new Vector3());
    const result=finalize(source,name,bounds.getSize(new Vector3()).z);
    result.traverse(o=>{if(o instanceof Mesh)o.geometry.translate(center.x,center.y,center.z)});
    return result;
  }
  const tubes=finish(barrels,'barrels');tubes.name='barrels';
  root.add(finish(body,'turret-head'),tubes);
  return root;
}
