import * as T from 'three';
import {createVenatorModel} from '../../visual/models/venator.ts';
import {createEta2Model} from '../../visual/models/eta2.ts';
import {disposeModel} from '../../visual/models/primitives.ts';
import {PlayerExhaust} from '../game/exhaust.ts';
import {FlightAudio} from '../game/audio.ts';
import type {DuelFlightEvent,DuelPilotState} from '../../shared/duel-snapshot.ts';
import type {DuelCollider} from '../../sim/duel-collision.ts';
import {createDuelFlight} from '../../sim/duel-flight.ts';
import type {DuelClient} from './client.ts';

export class DuelScene {
  readonly camera=new T.PerspectiveCamera(62,1,.2,15000);
  readonly renderer=new T.WebGLRenderer({antialias:true});
  readonly scene=new T.Scene();
  private carrier=createVenatorModel(false,false);
  private models=[createEta2Model(),createEta2Model()];
  private exhausts=[new PlayerExhaust(),new PlayerExhaust()];
  private shields=[0,1].map(i=>new T.Mesh(new T.SphereGeometry(3.8,20,12),new T.MeshBasicMaterial({color:i===0?0x66ddff:0xff886b,transparent:true,opacity:.14,depthWrite:false,wireframe:true})));
  private bolts=new T.InstancedMesh(new T.CylinderGeometry(.45,.45,10,5).rotateX(Math.PI/2),new T.MeshBasicMaterial({color:0xffffff}),64);
  private flashes: {mesh:T.Mesh<T.IcosahedronGeometry,T.MeshBasicMaterial>;life:number}[]=[];
  private flashGeometry=new T.IcosahedronGeometry(1,1);
  private dummy=new T.Object3D();
  private following=false;
  private followEpoch='';
  private audio=new FlightAudio();
  private collider: DuelCollider;
  constructor(viewport: HTMLElement,collider: DuelCollider){
    this.collider=collider;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.renderer.domElement.setAttribute('aria-label','双人空战三维视图');viewport.append(this.renderer.domElement);
    this.scene.background=new T.Color(0x030912);
    this.scene.add(new T.HemisphereLight(0xcbe9ff,0x19293a,1.5));
    const sun=new T.DirectionalLight(0xffe8c9,3);sun.position.set(-900,1700,-1200);this.scene.add(sun);
    const rim=new T.DirectionalLight(0x568fc7,1.2);rim.position.set(1000,-300,800);this.scene.add(rim);
    this.scene.add(this.carrier,this.bolts);this.bolts.count=0;
    const starPositions=new Float32Array(1800*3);
    for(let i=0;i<1800;i++){const theta=i*2.399963,y=1-2*(i+.5)/1800,r=Math.sqrt(1-y*y);starPositions.set([Math.cos(theta)*r*6500,y*6500,Math.sin(theta)*r*6500],i*3);}
    this.scene.add(new T.Points(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(starPositions,3)),new T.PointsMaterial({color:0x93b5d4,size:3.2,sizeAttenuation:true})));
    this.models.forEach((model,i)=>{
      model.traverse(object=>{if(object instanceof T.Mesh&&!Array.isArray(object.material)&&object.material instanceof T.MeshStandardMaterial){const c=object.material.color;if(c.r>c.b*1.5&&c.g>c.b*1.3)c.setHex(i===0?0x40b9e5:0xdc684e);}});
      this.scene.add(model,this.shields[i]!,this.exhausts[i]!.root);
    });
    this.resize();
  }
  startAudio(){this.audio.start();}
  effects(events: readonly DuelFlightEvent[]){
    for(const event of events){
      if(event.type==='shot'){this.audio.cue('shot');continue;}
      if(event.type==='torpedo-launch'){this.audio.cue('torpedo-launch');continue;}
      if(event.type==='shield-on'){this.audio.cue('command');continue;}
      this.audio.cue(event.type==='destroyed'?'explosion':event.type==='shield-hit'?'shield-hit':event.type==='shield-bounce'?'shield-bounce':'impact');
      if(this.flashes.length>=24){const old=this.flashes.shift()!;this.scene.remove(old.mesh);old.mesh.material.dispose();}
      const material=new T.MeshBasicMaterial({color:event.type.startsWith('shield')?0x80e7ff:0xffb66c,transparent:true,opacity:.8,depthWrite:false});
      const mesh=new T.Mesh(this.flashGeometry,material);mesh.position.fromArray(event.position);mesh.scale.setScalar(event.type==='destroyed'?14:3);this.scene.add(mesh);this.flashes.push({mesh,life:.6});
    }
  }
  resize(){const w=innerWidth,h=innerHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(Math.min(devicePixelRatio,1)*.85);this.renderer.setSize(w,h);}
  draw(client: DuelClient,dt:number,time:number){
    const snapshot=client.snapshot,flight=snapshot?.flight;
    const base=createDuelFlight().pilots;
    const own=client.predicted,remote=client.remote();
    const pilots: readonly DuelPilotState[]=flight?flight.pilots:base;
    this.models.forEach((model,i)=>{
      const pilot=(client.slot===i?own:remote)??pilots[i]!;
      const epoch=`${snapshot?.matchId}:${snapshot?.roundId}:${snapshot?.phase}`;
      const snap=epoch!==this.followEpoch||model.position.distanceTo(new T.Vector3(...pilot.position))>60||pilot.health===0;
      if(snap){model.position.fromArray(pilot.position);model.quaternion.fromArray(pilot.rotation);}
      else{model.position.lerp(new T.Vector3(...pilot.position),1-Math.exp(-dt*22));model.quaternion.slerp(new T.Quaternion(...pilot.rotation),1-Math.exp(-dt*22));}
      model.visible=pilot.health>0;
      this.shields[i]!.position.copy(model.position);this.shields[i]!.visible=pilot.health>0&&pilot.shieldTicks>0;
      this.shields[i]!.rotation.y=time*.25;
      this.exhausts[i]!.update(model,pilot.boosting,pilot.health>0&&snapshot?.phase==='playing',dt,time);
    });
    const chase=!!flight&&client.slot!==null,epoch=`${snapshot?.matchId}:${snapshot?.roundId}`;
    if(chase){
      const model=this.models[client.slot!]!;
      let desired=new T.Vector3(0,15,0).applyQuaternion(model.quaternion).add(model.position);
      for(const offset of [[0,4.5,18],[12,8,0],[-12,8,0],[0,18,0],[0,0,-12]]){
        const candidate=new T.Vector3(...offset).applyQuaternion(model.quaternion).add(model.position),hit=this.collider.sweepSphere(model.position.toArray(),candidate.toArray(),.5);
        if(hit)candidate.lerpVectors(model.position,candidate.clone(),Math.max(0,hit.fraction-.08));
        if(candidate.distanceTo(model.position)>7){desired=candidate;break;}
      }
      if(!this.following||this.followEpoch.split(':').slice(0,2).join(':')!==epoch||this.camera.position.distanceTo(desired)>80)this.camera.position.copy(desired);
      else this.camera.position.lerp(desired,1-Math.exp(-dt*10));
      // The smoothed camera itself must not cut across geometry after a turn/bounce.
      const occlusion=this.collider.sweepSphere(model.position.toArray(),this.camera.position.toArray(),.3);
      if(occlusion)this.camera.position.copy(desired);
      this.camera.up.set(0,1,0).applyQuaternion(model.quaternion);this.camera.lookAt(new T.Vector3(0,0,-1000).applyQuaternion(model.quaternion).add(model.position));
    }else{
      this.camera.position.set(-1250,430,-1350);this.camera.up.set(0,1,0);this.camera.lookAt(110,-5,100);
    }
    this.following=chase;this.followEpoch=`${snapshot?.matchId}:${snapshot?.roundId}:${snapshot?.phase}`;
    const projectiles=snapshot?.phase==='playing'?flight?.projectiles??[]:[];this.bolts.count=Math.min(64,projectiles.length);
    for(let i=0;i<this.bolts.count;i++){
      const bolt=projectiles[i]!;this.dummy.position.fromArray(bolt.position);this.dummy.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...bolt.velocity).normalize());this.dummy.scale.setScalar(bolt.kind==='torpedo'?1.8:1);this.dummy.updateMatrix();this.bolts.setMatrixAt(i,this.dummy.matrix);this.bolts.setColorAt(i,new T.Color(bolt.kind==='torpedo'?0xffe9a3:bolt.owner===0?0x63dcff:0xff7b59));
    }
    this.bolts.instanceMatrix.needsUpdate=true;if(this.bolts.instanceColor)this.bolts.instanceColor.needsUpdate=true;
    for(let i=this.flashes.length-1;i>=0;i--){const effect=this.flashes[i]!;effect.life-=dt;(effect.mesh.material as T.MeshBasicMaterial).opacity=Math.max(0,effect.life);effect.mesh.scale.multiplyScalar(1+dt*2);if(effect.life<=0){this.scene.remove(effect.mesh);effect.mesh.material.dispose();this.flashes.splice(i,1);}}
    this.renderer.render(this.scene,this.camera);this.renderer.domElement.dataset.ready='true';
  }
  project(pilot:DuelPilotState){const v=new T.Vector3(...pilot.position),local=this.camera.worldToLocal(v.clone()),screen=v.project(this.camera);return {x:(screen.x*.5+.5)*innerWidth,y:(-.5*screen.y+.5)*innerHeight,front:local.z<0};}
  dispose(){this.exhausts.forEach(e=>e.dispose());this.audio.dispose();this.scene.traverse(object=>{if(object instanceof T.Points){object.geometry.dispose();const m=object.material;if(Array.isArray(m))m.forEach(item=>item.dispose());else m.dispose();}});disposeModel(this.scene);this.flashGeometry.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
