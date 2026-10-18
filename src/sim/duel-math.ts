import type { DuelQuat, DuelVec3 } from '../shared/duel-snapshot.ts';

export const add = (a: DuelVec3, b: DuelVec3): DuelVec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub = (a: DuelVec3, b: DuelVec3): DuelVec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale = (a: DuelVec3, n: number): DuelVec3 => [a[0]*n,a[1]*n,a[2]*n];
export const dot = (a: DuelVec3, b: DuelVec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross = (a: DuelVec3, b: DuelVec3): DuelVec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length = (a: DuelVec3) => Math.hypot(...a);
export const normalize = (a: DuelVec3, fallback: DuelVec3 = [0,0,-1]): DuelVec3 => length(a)>1e-12 ? scale(a,1/length(a)) : [...fallback];
export const mix = (a: DuelVec3,b: DuelVec3,t: number): DuelVec3 => add(a,scale(sub(b,a),t));
export const clamp = (n: number,a: number,b: number) => Math.max(a,Math.min(b,n));
export function multiplyQuat(a: DuelQuat,b: DuelQuat): DuelQuat {
  const [x,y,z,w]=a,[u,v,s,t]=b;
  return [w*u+x*t+y*s-z*v,w*v-x*s+y*t+z*u,w*s+x*v-y*u+z*t,w*t-x*u-y*v-z*s];
}
export function normalizeQuat(q: DuelQuat): DuelQuat {
  const n=Math.hypot(...q);
  if(n<1e-12) return [0,0,0,1];
  return [q[0]/n,q[1]/n,q[2]/n,q[3]/n];
}
export function rotate(v: DuelVec3,q: DuelQuat): DuelVec3 {
  const qv: DuelVec3=[q[0],q[1],q[2]],t=scale(cross(qv,v),2);
  return add(v,add(scale(t,q[3]),cross(qv,t)));
}
export const forward = (q: DuelQuat): DuelVec3 => rotate([0,0,-1],q);
/** Minimal rotation from -Z. Roll resets after a collision, as in the solo mode. */
export function face(direction: DuelVec3): DuelQuat {
  const d=normalize(direction),w=1-d[2];
  if(w<1e-10) return [0,1,0,0];
  return normalizeQuat([d[1],-d[0],0,w]);
}
export function turnTowards(from: DuelVec3,to: DuelVec3,maxAngle: number): DuelVec3 {
  const a=normalize(from),b=normalize(to),angle=Math.acos(clamp(dot(a,b),-1,1));
  if(angle<=maxAngle) return b;
  let axis=cross(a,b);
  if(length(axis)<1e-10) axis=cross(a,Math.abs(a[1])<0.9?[0,1,0]:[1,0,0]);
  axis=normalize(axis);
  return normalize(add(add(scale(a,Math.cos(maxAngle)),scale(cross(axis,a),Math.sin(maxAngle))),scale(axis,dot(axis,a)*(1-Math.cos(maxAngle)))));
}
/** Entry fraction for a moving point vs a sphere; also handles initial overlap. */
export function segmentSphere(start: DuelVec3,end: DuelVec3,center: DuelVec3,radius: number): number | null {
  const m=sub(start,center),d=sub(end,start),c=dot(m,m)-radius*radius;
  if(c<=0) return 0;
  const a=dot(d,d),b=dot(m,d),h=b*b-a*c;
  if(a<1e-20||h<0) return null;
  const t=(-b-Math.sqrt(h))/a;
  return t>=0&&t<=1?t:null;
}
