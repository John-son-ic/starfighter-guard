import * as THREE from 'three';
import {FlightWorld,createFighter} from './world.ts';
import type {Fighter,EnemyGun,FlightCheckpoint} from './world.ts';
import {createRelayModel} from '../../visual/models/relay.ts';
import {createRelayMission,advanceRelayMission} from '../../sim/relay-mission.ts';
import {RELAY_CONFIG as C} from '../../shared/relay-contract.ts';
import type {RelayState} from '../../shared/relay-contract.ts';
import {solveIntercept} from '../../sim/intercept.ts';
interface RelayCheckpoint {flight:FlightCheckpoint;operation:RelayState;health:number[];gunHealth:number[];sequence:number;title:string}
export class RelayWorld extends FlightWorld {
 readonly station:THREE.Group;
 readonly debris:THREE.Group;
 readonly facilities:Fighter[]=[];
 readonly extraction=new THREE.Vector3(0,220,1600);
 readonly rescuePosition=new THREE.Vector3(-750,80,2100);
 operation=createRelayMission();
 private relayCheckpoint:RelayCheckpoint|null=null;
 private sequence=0;
 private relayRay=new THREE.Raycaster();
 private stationBounds:THREE.Box3;
 rescueActive=false;
 private rescueFrozenProgress=0;
 constructor(carrier:THREE.Object3D,station=createRelayModel(true),debris=new THREE.Group(),frigate?:THREE.Group,secondFrigate?:THREE.Group){
  super(carrier,frigate,secondFrigate);this.station=station;this.debris=debris;
  station.position.set(0,0,-2100);this.syncDoors();this.stationBounds=new THREE.Box3().setFromObject(station);
  this.stage='shield';this.mission={...this.mission,phase:'combat',waveIndex:0};
  this.player.position.set(0,220,850);this.player.previous.copy(this.player.position);
  this.fighters.splice(3);this.fighters.slice(1).forEach((f,i)=>{f.position.set((i?1:-1)*60,240,790);f.previous.copy(f.position)});
  this.carrier.position.copy(this.rescuePosition);this.carrier.updateMatrixWorld(true);
  this.turrets.forEach(t=>t.position.add(this.rescuePosition));
  const ids=['relay-comms','relay-control','relay-core'];
  (station.userData.facilities as number[][]).forEach((point,i)=>{const f=createFighter(ids[i]!,'relay','separatist',new THREE.Vector3().fromArray(point).add(station.position),i===2?C.reactorHealth:C.facilityHealth);f.speed=0;f.radius=i===2?38:42;this.facilities.push(f)});
  this.enemyGuns.splice(0,this.enemyGuns.length,...(station.userData.gunMounts as number[][]).map((p,i)=>{
   const f=createFighter('relay-gun-'+(i+1),'relay','separatist',new THREE.Vector3().fromArray(p).add(station.position),150);f.radius=19;f.speed=0;
   return{...f,direction:new THREE.Vector3(0,1,0),heavy:false,shipIndex:-1,flash:0,cooldown:i*.4} as EnemyGun;
  }));
  for(let i=0;i<C.patrolCount;i++)this.spawnInterceptor('patrol');
  this.message='断链行动：带两架僚机清除巡逻队，抵近通讯中继站。';
 }
 get comms(){return this.facilities[0]!}get control(){return this.facilities[1]!}get core(){return this.facilities[2]!}
 override get objectives(){return this.operation.phase==='facilities'?this.facilities.slice(0,2).filter(f=>f.health>0):this.operation.phase==='reactor'&&this.core.health>0?[this.core]:[];}
 override get exposedGuns(){return (this.operation.phase==='facilities'||this.operation.phase==='reactor')&&this.control.health>0?this.enemyGuns.filter(g=>g.health>0):[];}
 override get shieldActive(){return false}
 override shieldShip(_start:THREE.Vector3,_end:THREE.Vector3){return null}
 override get hasCheckpoint(){return this.relayCheckpoint!==null}
 override get checkpointTitle(){return this.relayCheckpoint?.title??'抵达中继站'}
 override get checkpointInfo(){const c=this.relayCheckpoint?.flight;return c?{carrierHealth:c.carrierHealth,playerHealth:c.fighters[0]!.health,friendlies:c.fighters.filter(f=>f.team==='republic').length-1}:null}
 get escapeRemaining(){return Math.max(0,C.escapeSeconds-this.operation.phaseTime)}
 get extractionOpen(){return this.operation.phase==='escape'&&this.operation.phaseTime>=18}
 get rescueProgress(){return this.operation.phase==='lost'?this.rescueFrozenProgress:this.operation.phase==='won'?1:this.rescueActive?THREE.MathUtils.clamp((this.operation.phaseTime-C.rescueDelay)/C.rescueArrivalSeconds,0,1):0}
 override get objectiveText(){
  if(this.operation.phase==='approach')return '清除巡逻队 · 抵近中继站1800米内';
  if(this.operation.phase==='facilities')return '自主选择顺序 · 通讯阵列断增援 / 火控中心停炮';
  if(this.operation.phase==='reactor')return '装甲门开启 · 从上方攻击暴露的反应堆';
  if(this.operation.phase==='escape')return '撤离 '+Math.ceil(this.escapeRemaining)+'秒 · '+(this.rescueActive?(this.rescueProgress<1?'守望号正在跃迁入场':this.extractionOpen?'守望号火力掩护 · 抵达蓝色撤离点':'守望号正在压制追兵 · 保持撤离航向'):'守望号正在赶来 · 摆脱追击');
  return this.operation.phase==='won'?'断链行动完成 · 编队安全撤离':'断链行动失败';
 }
 override hullHit(start:THREE.Vector3,end:THREE.Vector3,extra=0){
  const dir=end.clone().sub(start),distance=dir.length();if(distance<1e-8)return null;
  this.relayRay.set(start,dir.divideScalar(distance));this.relayRay.near=.001;this.relayRay.far=distance+extra;
  const hits:THREE.Intersection[]=[];
  if(this.relayRay.ray.intersectsBox(this.stationBounds))hits.push(...this.relayRay.intersectObject(this.station,true));
  if(this.rescueProgress>=1)hits.push(...this.relayRay.intersectObject(this.carrier,true));
  hits.push(...this.relayRay.intersectObject(this.debris,true));
  return hits.sort((a,b)=>a.distance-b.distance)[0]??null;
 }
 private spawnInterceptor(purpose:'patrol'|'reinforcement'|'pursuit'){
  if(this.enemies.length>=C.maxEnemies)return;
  const n=++this.sequence,position=purpose==='patrol'?new THREE.Vector3((n%2?1:-1)*(220+n*25),270,-100-n*90):purpose==='pursuit'?this.player.position.clone().add(new THREE.Vector3((n%2?1:-1)*280,110,-550)):this.station.position.clone().add(new THREE.Vector3((n%2?1:-1)*400,200,200));
  const f=createFighter((purpose==='patrol'?'patrol-':'relay-interceptor-')+n,'vulture','separatist',position,90);f.phase=n;f.cooldown=n*.2;f.rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);this.fighters.push(f);
 }
 private syncDoors(){
  const open=this.operation.phase==='reactor'?Math.min(1,this.operation.phaseTime/2):['escape','won','lost'].includes(this.operation.phase)?1:0;
  for(let i=0;i<2;i++){const d=this.station.getObjectByName('relay-door-'+i)!;d.position.x=d.userData.closedX+(i?1:-1)*open*120;}
  this.station.updateMatrixWorld(true);
 }
 protected override updateAssault(dt:number){
  this.rescueFrozenProgress=this.rescueProgress;
  const result=advanceRelayMission(this.operation,dt,{playerAlive:this.player.health>0,patrolCleared:!this.enemies.some(f=>f.id.startsWith('patrol-')),inStationRange:this.player.position.distanceTo(this.station.position)<1800,commsDestroyed:this.comms.health<=0,fireControlDestroyed:this.control.health<=0,reactorDestroyed:this.core.health<=0,atExtraction:this.extractionOpen&&this.player.position.distanceTo(this.extraction)<240,activeEnemies:this.enemies.length});
  this.operation=result.state;this.stageTime=this.operation.phaseTime;this.syncDoors();
  for(const event of result.events){
   if(event.type==='checkpoint')this.relayCheckpoint={flight:this.captureFlightCheckpoint(true),operation:{...this.operation},health:this.facilities.map(f=>f.health),gunHealth:this.enemyGuns.map(g=>g.health),sequence:this.sequence,title:event.point==='facilities'?'抵达中继站':'反应堆暴露'};
   if(event.type==='spawn')for(let i=0;i<event.count;i++)this.spawnInterceptor(event.purpose==='pursuit'?'pursuit':'reinforcement');
   if(event.type==='reactor-exposed'){this.message='两处设施失效！中央反应堆装甲门打开。';this.events.push({type:'warning',position:this.core.position.clone(),enemy:false})}
   if(event.type==='escape-started'){this.message='反应堆失控！沿蓝色航标撤离，守望号正在赶来。';this.events.push({type:'explosion',position:this.core.position.clone(),enemy:true,size:100});}
   if(event.type==='rescue-arrival'){this.rescueActive=true;this.message='守望号：我们已抵达，舰炮正在压制追兵！';this.events.push({type:'carrier-shot',position:this.rescuePosition.clone(),enemy:false});}
  }
  if(this.operation.phase==='won')this.mission={...this.mission,phase:'won'};
  if(this.operation.phase==='lost')this.mission={...this.mission,phase:'lost',lossReason:'player-destroyed'};
 }
 override retryFromCheckpoint():RelayWorld|null {
  const c=this.relayCheckpoint;if(!c||this.mission.phase!=='lost')return null;
  const restored=new RelayWorld(this.carrier,this.station,this.debris,...this.capitalShips.map(s=>s.model) as [THREE.Group,THREE.Group]);
  restored.restoreFlightCheckpoint(c.flight);restored.operation={...c.operation};restored.stageTime=c.operation.phaseTime;
  c.health.forEach((h,i)=>restored.facilities[i]!.health=h);c.gunHealth.forEach((h,i)=>restored.enemyGuns[i]!.health=h);restored.sequence=c.sequence;restored.relayCheckpoint=c;
  restored.syncDoors();restored.message='已返回'+c.title+'检查点 · 损伤与僚机损失已保留。';return restored;
 }
 protected override updateEnemyGuns(dt:number){
  for(const gun of this.enemyGuns)gun.flash=Math.max(0,gun.flash-dt);
  if(this.control.health<=0||this.operation.phase==='approach'||this.operation.phase==='escape')return;
  for(const gun of this.enemyGuns){gun.cooldown-=dt;if(gun.health<=0)continue;
   const target=this.fighters.filter(f=>f.team==='republic'&&f.health>0).sort((a,b)=>a.position.distanceToSquared(gun.position)-b.position.distanceToSquared(gun.position))[0];if(!target||target.position.distanceTo(gun.position)>1700)continue;
   const delta=target.position.clone().sub(gun.position).normalize();gun.direction.lerp(delta,1-Math.exp(-dt*4)).normalize();if(gun.cooldown>0||gun.direction.dot(delta)<.99||this.bolts.length>=192)continue;
   const pos=gun.position.clone().addScaledVector(gun.direction,30);if(this.hullHit(pos,target.position))continue;
   this.bolts.push({id:++this.boltSequence,owner:gun.id,team:'separatist',position:pos,previous:pos.clone(),velocity:gun.direction.clone().multiplyScalar(650),life:3,damage:10});gun.flash=.15;gun.cooldown=2.5;
  }
 }
 protected override updateTurrets(dt:number){
  if(!this.rescueActive||this.rescueProgress<1)return;
  for(const t of this.turrets){t.cooldown-=dt;t.flash=Math.max(0,t.flash-dt);
   const target=this.enemies.filter(e=>e.position.distanceTo(t.position)<3300).sort((a,b)=>a.position.distanceToSquared(t.position)-b.position.distanceToSquared(t.position))[0];if(!target)continue;
   const aim=solveIntercept(t.position,target.position,this.forward(target).multiplyScalar(target.speed),1500,4);if(!aim)continue;
   const point=new THREE.Vector3(aim.point.x,aim.point.y,aim.point.z),dir=point.sub(t.position).normalize();t.direction.lerp(dir,1-Math.exp(-dt*6)).normalize();
   if(t.cooldown>0||t.direction.dot(dir)<.98||this.bolts.length>=192)continue;
   const pos=t.position.clone().addScaledVector(t.direction,38);if(this.hullHit(t.position,pos)||this.hullHit(pos,target.position))continue;
   this.bolts.push({id:++this.boltSequence,owner:t.id,team:'republic',position:pos,previous:pos.clone(),velocity:dir.multiplyScalar(1500),life:4,damage:36});t.cooldown=.9;t.flash=.15;this.turretShots++;if(this.turretShots%3===1)this.events.push({type:'carrier-shot',position:pos.clone(),enemy:false});
  }
 }
}
