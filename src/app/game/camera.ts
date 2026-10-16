import { Vector3 } from 'three';
import type { FlightWorld } from './world.ts';

/** Keep the camera outside both carrier and player, including immediately after a bounce. */
export function safeChaseCamera(world: FlightWorld, preferred: Vector3) {
  const p=world.player;
  const candidates=[preferred,p.position.clone().addScaledVector(world.collisionNormal,24),new Vector3(0,22,8).applyQuaternion(p.rotation).add(p.position),new Vector3(20,8,0).applyQuaternion(p.rotation).add(p.position),new Vector3(-20,8,0).applyQuaternion(p.rotation).add(p.position)];
  for(const point of candidates) {
    const hit=world.hullHit(p.position,point);
    if(!hit)return point;
    if(hit.distance>p.radius+9)return point.clone().sub(p.position).setLength(hit.distance-3).add(p.position);
  }
  return p.position.clone().addScaledVector(world.collisionNormal,24);
}
