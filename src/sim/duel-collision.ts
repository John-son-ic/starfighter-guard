import type { DuelVec3 } from '../shared/duel-snapshot.ts';
import { add,sub,scale,dot,cross,length,normalize,mix,segmentSphere } from './duel-math.ts';

export interface DuelHullHit { readonly fraction: number; readonly point: DuelVec3; readonly normal: DuelVec3 }
export interface DuelCollider {
  readonly triangleCount: number;
  readonly bounds: readonly [DuelVec3,DuelVec3];
  sweepSphere(start: DuelVec3,end: DuelVec3,radius: number): DuelHullHit | null;
}
interface Node { lo: DuelVec3; hi: DuelVec3; left?: Node; right?: Node; ids?: number[] }
const EPS=1e-9;

function closest(p: DuelVec3,a: DuelVec3,b: DuelVec3,c: DuelVec3): DuelVec3 {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0) return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3) return b;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0) return add(a,scale(ab,d1/(d1-d3)));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6) return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0) return add(a,scale(ac,d2/(d2-d6)));
  const va=d3*d6-d5*d4;
  if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0) return add(b,scale(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));
  const inv=1/(va+vb+vc);
  return add(a,add(scale(ab,vb*inv),scale(ac,vc*inv)));
}
function inTriangle(p: DuelVec3,a: DuelVec3,b: DuelVec3,c: DuelVec3,n: DuelVec3) {
  return dot(cross(sub(b,a),sub(p,a)),n)>=-EPS && dot(cross(sub(c,b),sub(p,b)),n)>=-EPS && dot(cross(sub(a,c),sub(p,c)),n)>=-EPS;
}
function sweepTriangle(start: DuelVec3,end: DuelVec3,r: number,a: DuelVec3,b: DuelVec3,c: DuelVec3): DuelHullHit | null {
  const raw=cross(sub(b,a),sub(c,a));
  if(length(raw)<1e-10) return null;
  const n=normalize(raw),v=sub(end,start),near=closest(start,a,b,c),offset=sub(start,near);
  const opposing=dot(n,v)>0?scale(n,-1):n;
  if(dot(offset,offset)<=r*r+1e-12) return {fraction:0,point:near,normal:normalize(offset,opposing)};
  let result: DuelHullHit | null=null;
  const candidate=(t: number,point: DuelVec3,normal: DuelVec3)=>{
    if(t>=-EPS&&t<=1+EPS&&(!result||t<result.fraction)) result={fraction:Math.max(0,Math.min(1,t)),point,normal};
  };
  const distance=dot(sub(start,a),n),denom=dot(v,n);
  if(Math.abs(denom)>1e-12) for(const side of [-1,1]) {
    const t=(side*r-distance)/denom;
    if(t<0||t>1) continue;
    const point=sub(mix(start,end,t),scale(n,side*r));
    if(inTriangle(point,a,b,c,n)) candidate(t,point,r===0?opposing:scale(n,side));
  }
  if(r>0) for(const [u,w] of [[a,b],[b,c],[c,a]] as const) {
    const edge=sub(w,u),m=sub(start,u),l2=dot(edge,edge);
    if(l2>1e-16) {
      const ve=dot(v,edge),me=dot(m,edge),qa=dot(v,v)-ve*ve/l2,qb=2*(dot(m,v)-me*ve/l2),qc=dot(m,m)-me*me/l2-r*r;
      const h=qb*qb-4*qa*qc;
      if(qa>1e-16&&h>=0) {
        const t=(-qb-Math.sqrt(h))/(2*qa),along=(me+t*ve)/l2;
        if(t>=0&&t<=1&&along>=0&&along<=1) {
          const point=add(u,scale(edge,along));
          candidate(t,point,normalize(sub(mix(start,end,t),point),opposing));
        }
      }
    }
    const t=segmentSphere(start,end,u,r);
    if(t!==null) candidate(t,u,normalize(sub(mix(start,end,t),u),opposing));
  }
  return result;
}
function boxEntry(start: DuelVec3,end: DuelVec3,lo: DuelVec3,hi: DuelVec3,r: number): number | null {
  let first=0,last=1;
  for(const axis of [0,1,2] as const) {
    const d=end[axis]-start[axis],a=lo[axis]-r,b=hi[axis]+r;
    if(Math.abs(d)<1e-14) {if(start[axis]<a||start[axis]>b)return null;continue;}
    let t=(a-start[axis])/d,u=(b-start[axis])/d;
    if(t>u) [t,u]=[u,t];
    first=Math.max(first,t);last=Math.min(last,u);
    if(first>last) return null;
  }
  return first;
}

/** Copies input geometry; BVH leaves still test actual triangles, edges and corners. */
export function createDuelCollider(positions: ArrayLike<number>,indices: ArrayLike<number>): DuelCollider {
  if(positions.length%3||indices.length%3||indices.length===0||positions.length===0) throw new RangeError('Invalid collision geometry');
  const vertices=Float32Array.from(positions),faces=Uint32Array.from(indices),count=faces.length/3;
  if(!Array.from(vertices).every(Number.isFinite)) throw new RangeError('Nonfinite collision geometry');
  for(let i=0;i<indices.length;i++) if(!Number.isInteger(indices[i])||indices[i]!<0||indices[i]!>=vertices.length/3) throw new RangeError('Invalid triangle index');
  const vertex=(i: number): DuelVec3=>[vertices[i*3]!,vertices[i*3+1]!,vertices[i*3+2]!];
  const triangle=(i: number)=>[vertex(faces[i*3]!),vertex(faces[i*3+1]!),vertex(faces[i*3+2]!)] as const;
  const boxes=Array.from({length:count},(_,i)=>{
    const t=triangle(i);
    return {lo:[0,1,2].map(k=>Math.min(...t.map(v=>v[k]!))) as [number,number,number],hi:[0,1,2].map(k=>Math.max(...t.map(v=>v[k]!))) as [number,number,number]};
  });
  function build(ids: number[]): Node {
    const lo: [number,number,number]=[Infinity,Infinity,Infinity],hi: [number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(const id of ids) for(const k of [0,1,2] as const) {lo[k]=Math.min(lo[k],boxes[id]!.lo[k]);hi[k]=Math.max(hi[k],boxes[id]!.hi[k]);}
    if(ids.length<=16) return {lo,hi,ids};
    const spans=hi.map((n,k)=>n-lo[k]!);const axis=spans.indexOf(Math.max(...spans)) as 0|1|2;
    ids.sort((a,b)=>(boxes[a]!.lo[axis]+boxes[a]!.hi[axis])-(boxes[b]!.lo[axis]+boxes[b]!.hi[axis]));
    const mid=Math.floor(ids.length/2);
    return {lo,hi,left:build(ids.slice(0,mid)),right:build(ids.slice(mid))};
  }
  const root=build(Array.from({length:count},(_,i)=>i));
  return {
    triangleCount:count,bounds:[[...root.lo],[...root.hi]],
    sweepSphere(start,end,radius) {
      if(!Number.isFinite(radius)||radius<0||start.length!==3||end.length!==3||![...start,...end].every(Number.isFinite)) throw new RangeError('Invalid sweep');
      let nearest: DuelHullHit | null=null;
      function visit(node: Node) {
        const entry=boxEntry(start,end,node.lo,node.hi,radius);
        if(entry===null||(nearest&&entry>nearest.fraction+EPS)) return;
        if(node.ids) for(const id of node.ids) {
          const [a,b,c]=triangle(id),hit=sweepTriangle(start,end,radius,a,b,c);
          if(hit&&(!nearest||hit.fraction<nearest.fraction)) nearest=hit;
        } else {if(node.left)visit(node.left);if(node.right)visit(node.right);}
      }
      visit(root);return nearest;
    },
  };
}

/** DUELCOL1: 8-byte magic, u32 vertex/triangle counts, float32 XYZ, u32 indices; LE. */
export function decodeDuelCollision(buffer: ArrayBuffer): DuelCollider {
  if(buffer.byteLength<16) throw new RangeError('Truncated collision file');
  const bytes=new Uint8Array(buffer),magic=String.fromCharCode(...bytes.subarray(0,8));
  if(magic!=='DUELCOL1') throw new RangeError('Invalid collision file version');
  const view=new DataView(buffer),vertexCount=view.getUint32(8,true),triangleCount=view.getUint32(12,true);
  if(vertexCount<3||triangleCount<1||vertexCount>1000000||triangleCount>2000000||16+vertexCount*12+triangleCount*12!==buffer.byteLength) throw new RangeError('Invalid collision file length');
  const positions=new Float32Array(vertexCount*3),indices=new Uint32Array(triangleCount*3);
  for(let i=0;i<positions.length;i++) positions[i]=view.getFloat32(16+i*4,true);
  for(let i=0;i<indices.length;i++) indices[i]=view.getUint32(16+positions.byteLength+i*4,true);
  return createDuelCollider(positions,indices);
}
