import * as THREE from 'three';
import {palette,box,mesh,finalize} from './primitives.ts';
/** Original Separatist relay outpost, a modular exterior with a broad open reactor well. */
export function createRelayModel(runtime=false) {
 const p=palette(),g=new THREE.Group();
 const ring=(radius:number,tube:number,y:number,mat:THREE.Material)=>{const m=mesh(g,new THREE.TorusGeometry(radius,tube,6,48),mat,0,y,0);m.rotation.x=Math.PI/2;return m;};
 ring(165,22,0,p.trim);ring(165,10,35,p.light);ring(112,12,75,p.dark);ring(104,8,105,p.red);
 mesh(g,new THREE.CylinderGeometry(90,110,30,12),p.dark,0,-65,0);
 for(let i=0;i<8;i++){
  const a=i*Math.PI/4,x=Math.cos(a),z=Math.sin(a);
  box(g,p.hull,[36,80,32],[x*130,10,z*130],[0,-a,0]);
  box(g,p.trim,[40,8,105],[x*215,-12,z*215],[0,Math.PI/2-a,0]);
  box(g,p.red,[10,4,66],[x*214,-6,z*214],[0,Math.PI/2-a,0]);
 }
 for(const side of [-1,1]) {
  box(g,p.dark,[180,34,120],[side*275,0,0]);box(g,p.hull,[160,18,112],[side*275,28,0]);
  for(let j=0;j<6;j++){box(g,p.trim,[18,4,80],[side*(210+j*23),40,0]);box(g,p.engine,[5,2,12],[side*(210+j*23),43,47]);}
  box(g,p.hull,[70,65,90],[0,0,side*340]);box(g,p.trim,[90,20,110],[0,40,side*340]);
  box(g,p.dark,[65,18,115],[0,-10,side*392]);
  for(let j=0;j<4;j++)box(g,p.light,[66,4,10],[0,52,side*(306+j*23)]);
 }
 // Tall communications dish and a lower, angular fire-control block are recognizable at a distance.
 box(g,p.trim,[18,110,18],[-285,93,0]);
 const dish=mesh(g,new THREE.SphereGeometry(58,16,8,0,Math.PI*2,0,Math.PI*.35),p.light,-285,150,0);dish.rotation.z=-.45;
 const inner=mesh(g,new THREE.TorusGeometry(49,3,5,24),p.dark,-285,169,0);inner.rotation.x=Math.PI/2;inner.rotation.z=-.45;
 box(g,p.red,[10,52,10],[-285,178,0]);mesh(g,new THREE.SphereGeometry(10,8,6),p.sensor,-285,207,0);
 box(g,p.blue,[100,65,96],[285,75,0]);box(g,p.hull,[118,10,108],[285,112,0]);
 for(let i=0;i<5;i++){box(g,p.trim,[10,5,65],[247+i*19,120,0]);box(g,p.sensor,[8,5,8],[247+i*19,125,33]);}
 box(g,p.dark,[60,20,65],[285,134,0]);
 for(const side of [-1,1])for(let j=0;j<4;j++){
  const x=side*(90+j*30),z=side*210;
  box(g,p.hull,[26,14,75],[x,14,z]);box(g,p.dark,[17,2,50],[x,23,z]);
 }
 // Exposed equipment, pipe racks and landing beacons; no traversable interior.
 for(let j=0;j<24;j++){const a=j*Math.PI/12;box(g,j%4===0?p.red:p.hull,[18,6,28],[Math.cos(a)*162,54,Math.sin(a)*162],[0,-a,0]);}
 const sourceBounds=new THREE.Box3().setFromObject(g),center=sourceBounds.getCenter(new THREE.Vector3()),ratio=900/sourceBounds.getSize(new THREE.Vector3()).z;
 const point=(v:number[])=>new THREE.Vector3().fromArray(v).sub(center).multiplyScalar(ratio).toArray();
 if(!runtime){
  mesh(g,new THREE.SphereGeometry(32,16,10),p.engine,0,78,0);
  for(let i=0;i<2;i++)box(g,p.hull,[99,10,196],[(i?1:-1)*50,120,0]);
 }
 const root=finalize(g,'relay',900);
 root.userData.facilities=[point([-285,190,0]),point([285,136,0]),point([0,104,0])];
 root.userData.gunMounts=Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return point([Math.cos(a)*190,66,Math.sin(a)*190]);});
 if(runtime){
 const reactor=new THREE.Mesh(new THREE.SphereGeometry(32*ratio,16,10),p.engine);reactor.position.fromArray(point([0,78,0]));reactor.name='relay-reactor';root.add(reactor);
 for(let i=0;i<2;i++){
  const door=new THREE.Mesh(new THREE.BoxGeometry(99*ratio,10*ratio,196*ratio),p.hull);door.position.fromArray(point([(i?1:-1)*50,120,0]));door.name='relay-door-'+i;door.userData.closedX=door.position.x;root.add(door);
 }
 }
 root.userData.runtimeDoors=runtime;return root;
}
