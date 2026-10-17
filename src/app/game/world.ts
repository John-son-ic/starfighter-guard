import {createMunificentModel} from '../../visual/models/munificent.ts';
import * as THREE from 'three';
import { createMission, advanceMission } from '../../sim/mission.ts';
import { createWeapon, advanceWeapon, applyDamage } from '../../sim/combat.ts';
import { solveIntercept } from '../../sim/intercept.ts';
import { MISSION_CONFIG, MVP_CONFIG, WEAPON_CONFIG } from '../../shared/config.ts';
import type { MissionState, ModelId, WeaponState } from '../../shared/types.ts';

export interface FlightInput { yaw: number; pitch: number; roll: number; throttle: number; boost: boolean; fire: boolean; torpedo?: boolean }
export const NEUTRAL_INPUT: FlightInput = { yaw: 0, pitch: 0, roll: 0, throttle: 0, boost: false, fire: false };
export interface Fighter {
  id: string; model: ModelId; team: 'republic' | 'separatist'; position: THREE.Vector3; previous: THREE.Vector3;
  rotation: THREE.Quaternion; speed: number; health: number; maxHealth: number; radius: number;
  weapon: WeaponState; cooldown: number; evadingUntil: number; phase: number; invulnerable: number;
}
export const TORPEDO_CONFIG = { lockTime: 2, cooldown: 18, range: 1200, cone: Math.PI / 12, speed: 330, turnRate: 1.8, lifetime: 7, damage: 120 } as const;
export interface Bolt { targetId?: string; id: number; team: Fighter['team']; owner: string; position: THREE.Vector3; previous: THREE.Vector3; velocity: THREE.Vector3; life: number; damage: number }
export interface CarrierTurret { id: string; position: THREE.Vector3; direction: THREE.Vector3; cooldown: number; flash: number; targetId: string | null; aim: THREE.Vector3 | null; scanAt: number }
export type WorldEvent = { type: 'explosion' | 'impact' | 'player-hit' | 'shot' | 'carrier-shot'; position: THREE.Vector3; enemy: boolean; size?: number };
const FORWARD = new THREE.Vector3(0, 0, -1);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
export const WEAK_POINT = new THREE.Vector3(145, -38, 210);
const PROJECTILE_SPEED = 720;
const PROJECTILE_LIFETIME = 2;

function fighter(id: string, model: ModelId, team: Fighter['team'], position: THREE.Vector3, health: number): Fighter {
  return { id, model, team, position, previous: position.clone(), rotation: new THREE.Quaternion(), speed: model === 'eta2' ? 115 : 110, health, maxHealth: health, radius: model === 'arc170' ? 7 : 3, weapon: createWeapon(), cooldown: 0, evadingUntil: 0, phase: 0, invulnerable: 0 };
}

/** Normalized entry time of a segment into a sphere, including an inside start. */
export function segmentSphere(start: THREE.Vector3, end: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  const offset = start.clone().sub(center);
  const delta = end.clone().sub(start);
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const a = delta.lengthSq();
  if (a < 1e-12) return null;
  const b = offset.dot(delta);
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

export class FlightWorld {
  readonly carrier: THREE.Object3D;
  readonly frigate: THREE.Group;
  readonly generator: Fighter;
  readonly bridge: Fighter;
  stage: 'defense' | 'arrival' | 'shield' | 'launch' | 'assault' | 'destroyed' = 'defense';
  stageTime = 0;
  hangarOpen = 0;
  private reinforcementTimer = 0;
  private reinforcementSequence = 0;
  private launched = 0;
  private frigateBounds: THREE.Box3;
  readonly shieldRadii = new THREE.Vector3(260,150,470);
  get shieldCenter() { return this.frigate.position.clone().add(new THREE.Vector3(0,-40,0)); }
  get shieldActive() { return this.stage !== 'defense' && this.stage !== 'destroyed' && this.generator.health > 0; }
  get objectives() { return this.stage === 'defense' || this.stage === 'arrival' || this.stage === 'destroyed' ? [] : this.generator.health > 0 ? [this.generator] : this.bridge.health > 0 ? [this.bridge] : []; }
  get attackTargets() { return [...this.enemies, ...this.objectives]; }
  get bombers() { return this.fighters.filter(f=>f.model==='ywing'&&f.health>0); }
  get objectiveText() {
    if(this.stage==='defense') return '清除三波敌机 · 守住狩猎者级';
    if(this.stage==='arrival') return '警报：慷慨级正在跃迁进入战场';
    if(this.stage==='shield') return '击毁外露护盾发生器 · 舰体受屏障保护';
    if(this.stage==='launch') return '护盾已瓦解 · 机库门开启，轰炸编队出击';
    if(this.stage==='assault') return this.bombers.length ? '护航Y翼轰炸机，或直接攻击敌舰舰桥' : '轰炸机已损失 · 亲自摧毁敌舰舰桥';
    return '慷慨级已摧毁';
  }
  readonly player: Fighter;
  readonly fighters: Fighter[];
  readonly bolts: Bolt[] = [];
  readonly events: WorldEvent[] = [];
  mission: MissionState = createMission(MISSION_CONFIG);
  carrierHealth: number = MVP_CONFIG.carrierHealth;
  readonly turrets: CarrierTurret[] = [];
  playerCollisionVersion = 0;
  readonly collisionNormal = new THREE.Vector3(0, 1, 0);
  turretShots = 0;
  torpedoCooldown = 0;
  torpedoLock = 0;
  torpedoTarget: string | null = null;
  private torpedoHeld = false;
  boostEnergy = 100;
  boosting = false;
  time = 0;
  targetId: string | null = null;
  wingOrder: 'guard' | 'focus' | 'follow' = 'guard';
  focusId: string | null = null;
  message = '编队集结。敌方机群正在接近。';
  hitFlash = 0;
  hitConfirm = 0;
  private boltSequence = 0;
  private ray = new THREE.Raycaster();
  private carrierBounds: THREE.Box3;

  constructor(carrier: THREE.Object3D, frigate = createMunificentModel()) {
    this.carrier = carrier;
    this.frigate = frigate; frigate.position.set(0,0,-5000);frigate.rotation.y=Math.PI;frigate.updateMatrixWorld(true);
    this.frigateBounds = new THREE.Box3().setFromObject(frigate);
    const point=(key:string)=>new THREE.Vector3().fromArray(frigate.userData[key]).applyMatrix4(frigate.matrixWorld);
    this.generator=fighter('shield-generator','munificent','separatist',point('generator'),360);this.generator.radius=28;this.generator.speed=0;
    this.bridge=fighter('frigate-bridge','munificent','separatist',point('bridge'),1800);this.bridge.radius=44;this.bridge.speed=0;
    carrier.updateMatrixWorld(true);
    this.carrierBounds = new THREE.Box3().setFromObject(carrier);
    this.player = fighter('player', 'eta2', 'republic', new THREE.Vector3(110, 95, 300), 100);
    this.fighters = [this.player, ...Array.from({length:MVP_CONFIG.friendlies},(_,i)=>fighter(`wing-${i+1}`, 'arc170', 'republic', new THREE.Vector3(110 + (i%2===0?-1:1)*(48+Math.floor(i/2)*40), 107+Math.floor(i/2)*15, 242-Math.floor(i/2)*36), 180))];
    for (const side of [-1,1]) for(let i=0;i<4;i++) this.turrets.push({id:`turret-${side}-${i}`,position:new THREE.Vector3(side*(111+i*17),-18.25,142+i*57),direction:FORWARD.clone(),cooldown:0.3+i*0.3+(side+1)*0.1,flash:0,targetId:null,aim:null,scanAt:i*0.04});
  }

  get enemies() { return this.fighters.filter(f => f.team === 'separatist' && f.health > 0); }
  get target() { return this.attackTargets.find(f => f.id === this.targetId) ?? null; }
  get terminal() { return this.mission.phase === 'won' || this.mission.phase === 'lost'; }
  forward(f: Fighter) { return FORWARD.clone().applyQuaternion(f.rotation); }

  selectNext() {
    const enemies = this.attackTargets.sort((a, b) => a.position.distanceToSquared(this.player.position) - b.position.distanceToSquared(this.player.position));
    this.targetId = enemies[(enemies.findIndex(f => f.id === this.targetId) + 1) % enemies.length]?.id ?? null;
  }

  command(order: 'focus' | 'follow') {
    if (order === 'focus' && !this.target) { this.message = '暂无可集火目标。Tab 选择敌机。'; return; }
    this.wingOrder = order; this.focusId = order === 'focus' ? this.targetId : null;
    this.message = order === 'focus' ? '苍鹭中队：收到，集火标记目标。' : '苍鹭中队：收到，返回掩护位置。';
  }

  /** Visual hull provides real occlusion. Physics keeps a conservative nose clearance. */
  hullHit(start: THREE.Vector3, end: THREE.Vector3, extra = 0) {
    const direction = end.clone().sub(start);
    const distance = direction.length();
    if (distance < 1e-8) return null;
    this.ray.set(start, direction.divideScalar(distance));
    this.ray.near = 0.001; this.ray.far = distance + extra;
    const hits: THREE.Intersection[] = [];
    if(this.ray.ray.intersectsBox(this.carrierBounds))hits.push(...this.ray.intersectObject(this.carrier,true));
    if(this.stage!=='defense'&&this.stage!=='arrival'&&this.stage!=='destroyed'&&this.ray.ray.intersectsBox(this.frigateBounds))hits.push(...this.ray.intersectObject(this.frigate,true));
    return hits.sort((a,b)=>a.distance-b.distance)[0]??null;
  }

  step(dt: number, input: FlightInput) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new RangeError('world dt must be in (0, 0.1]');
    this.events.length = 0;
    if (this.terminal) return;
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
    this.hitConfirm = Math.max(0, this.hitConfirm - dt * 4);
    for (const f of this.fighters) { f.previous.copy(f.position); f.invulnerable = Math.max(0, f.invulnerable - dt); }
    this.movePlayer(dt, input);
    for (const f of this.fighters) if (f.id !== 'player' && f.health > 0) this.moveAI(f, dt);
    this.updateTurrets(dt);
    const weapon = advanceWeapon(this.player.weapon, dt, input.fire, WEAPON_CONFIG);
    this.player.weapon = weapon.state;
    if (weapon.fired && this.player.health > 0) {
      let direction = this.forward(this.player);
      const target = this.target;
      if (target) {
        const prediction = this.aimPoint(target).sub(this.muzzlePosition(this.player)).normalize();
        if (direction.dot(prediction) > Math.cos(0.075)) direction = prediction;
      }
      this.shoot(this.player, direction, 18);
      this.events.push({ type: 'shot', position: this.player.position.clone(), enemy: false });
    }
    this.updateTorpedo(dt, !!input.torpedo);
    this.updateBolts(dt);
    const destroyed = this.fighters.filter(f => f.id !== 'player' && f.health <= 0);
    for (const f of destroyed) {
      this.events.push({ type: 'explosion', position: f.position.clone(), enemy: f.team === 'separatist' });
      this.fighters.splice(this.fighters.indexOf(f), 1);
    }
    if (this.focusId && !this.enemies.some(f => f.id === this.focusId)) { this.focusId = null; this.wingOrder = 'guard'; }
    if(this.stage!=='defense') {
      this.mission={...this.mission,kills:this.mission.kills+destroyed.filter(f=>f.team==='separatist').length,elapsedSeconds:this.mission.elapsedSeconds+dt};
      this.updateAssault(dt);
      if(!this.target)this.targetId=this.objectives[0]?.id??this.enemies[0]?.id??null;
      return;
    }
    const result = advanceMission(this.mission, dt, {
      playerAlive: this.player.health > 0, carrierAlive: this.carrierHealth > 0,
      destroyedEnemyIds: destroyed.filter(f => f.team === 'separatist').map(f => f.id),
    }, MISSION_CONFIG);
    const oldPhase = this.mission.phase;
    this.mission = result.state;
    if(this.mission.phase==='won') {
      this.stage='arrival';this.stageTime=0;this.mission={...this.mission,phase:'combat'};
      this.message='大型跃迁信号！前方5000米出现敌舰。';
    }
    for (const event of result.events) {
      if (event.type === 'spawn-wave') {
        event.enemyIds.forEach((id, i) => {
          const slot = i%5, row = Math.floor(i/5);
          const flank = event.waveIndex%2 ? -1 : 1;
          const f = fighter(id, 'vulture', 'separatist', new THREE.Vector3(flank*(-320 + slot*150), 135+row*65+slot*12, -780-row*160-slot*30), 90);
          f.rotation.setFromAxisAngle(Y, Math.PI); f.phase = i + event.waveIndex; f.cooldown = i * 0.4;
          this.fighters.push(f);
        });
        this.message = `敌机第 ${event.waveIndex + 1} 波！优先保护守望号。`;
      }
    }
    if (oldPhase !== this.mission.phase && this.mission.phase === 'intermission') {
      this.player.health=Math.min(100,this.player.health+25);
      this.carrierHealth=Math.min(MVP_CONFIG.carrierHealth,this.carrierHealth+180);
      for(const f of this.fighters)if(f.team==='republic'&&f.id!=='player')f.health=Math.min(f.maxHealth,f.health+35);
      this.message = '空域暂时安全：应急抢修恢复座机与舰体，下一波机群正在接近。';
    }
    if (!this.target) { this.targetId = null; if (this.enemies.length) this.selectNext(); }
  }

  targetSurface(target: Fighter,origin:THREE.Vector3) {
    return target.model==='munificent' ? target.position.clone().addScaledVector(origin.clone().sub(target.position).normalize(),target.radius+1) : target.position;
  }
  muzzlePosition(f: Fighter) { return f.position.clone().addScaledVector(this.forward(f), f.radius + 3); }

  /** Current heading/speed predict straight flight; subsequent AI turns are not forecast. */
  interceptPoint(target: Fighter) {
    const solution = solveIntercept(this.muzzlePosition(this.player), target.position, this.forward(target).multiplyScalar(target.speed), PROJECTILE_SPEED, PROJECTILE_LIFETIME);
    return solution ? new THREE.Vector3(solution.point.x, solution.point.y, solution.point.z) : null;
  }

  aimPoint(target: Fighter) { return this.interceptPoint(target) ?? target.position.clone(); }

  private movePlayer(dt: number, input: FlightInput) {
    const p = this.player;
    const clamp = THREE.MathUtils.clamp;
    p.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(Y, -clamp(input.yaw, -1, 1) * 1.15 * dt));
    p.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(X, clamp(input.pitch, -1, 1) * 1.0 * dt));
    p.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(Z, clamp(input.roll, -1, 1) * 1.4 * dt)).normalize();
    p.speed = clamp(p.speed + clamp(input.throttle, -1, 1) * dt * 65, 55, 190);
    const boosting = input.boost && this.boostEnergy > 1;
    this.boosting = boosting;
    this.boostEnergy = clamp(this.boostEnergy + (boosting ? -30 : 18) * dt, 0, 100);
    const speed = p.speed * (boosting ? 1.6 : 1);
    if (p.position.distanceTo(this.stage==='defense'?new THREE.Vector3():new THREE.Vector3(0,0,-2500)) > (this.stage==='defense'?2350:4200)) {
      const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(), (this.stage==='defense'?new THREE.Vector3():new THREE.Vector3(0,0,-2500)).sub(p.position), Y);
      p.rotation.slerp(new THREE.Quaternion().setFromRotationMatrix(matrix), dt * 0.7);
      this.message = '接近作战边界，飞行辅助正在引导返航。';
    }
    p.position.addScaledVector(this.forward(p), speed * dt);
    this.collideShip(p);
  }

  private steer(f: Fighter, point: THREE.Vector3, dt: number) {
    const desired = point.clone().sub(f.position).normalize();
    const ahead = f.position.clone().addScaledVector(this.forward(f), 170);
    const obstacle = this.hullHit(f.position, ahead, f.radius + 15);
    if (obstacle || (Math.abs(f.position.x) < 280 && Math.abs(f.position.z) < 590 && f.position.y < 95)) {
      desired.y += 2.5;
      desired.x += Math.sign(f.position.x || 1) * 0.4;
      desired.normalize();
    }
    if (f.team === 'republic' && f.position.distanceTo(this.player.position) < 40) {
      desired.add(f.position.clone().sub(this.player.position).normalize().multiplyScalar(2.5)).normalize();
    }
    const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(), desired, Y);
    const target = new THREE.Quaternion().setFromRotationMatrix(matrix);
    f.rotation.rotateTowards(target, dt * (f.team === 'separatist' ? 1.35 : 1.1));
    f.position.addScaledVector(this.forward(f), f.speed * dt);
    this.collideShip(f);
  }

  private moveAI(f: Fighter, dt: number) {
    if(f.model==='ywing'){this.moveBomber(f,dt);return;}
    const enemy = f.team === 'separatist';
    let target: Fighter | null = null;
    let destination: THREE.Vector3;
    let shootingCarrier = false;
    if (enemy) {
      shootingCarrier = this.stage==='defense' && Math.floor(f.phase) % 3 !== 0;
      const allies=this.fighters.filter(ship=>ship.team==='republic'&&ship.health>0);
      target = shootingCarrier ? null : (this.stage!=='defense'&&this.bombers.length ? this.bombers[Math.floor(f.phase)%this.bombers.length]! : allies[Math.floor(f.phase)%allies.length] ?? this.player);
      destination = shootingCarrier ? WEAK_POINT.clone() : target!.position.clone();
      if (f.position.distanceTo(destination) < (shootingCarrier ? 180 : 95)) f.evadingUntil = this.time + 4;
      if (this.time < f.evadingUntil) destination = new THREE.Vector3((f.phase % 2 ? -1 : 1) * 600, 220 + Math.sin(f.phase) * 40, this.stage==='defense'?-250:target!.position.z+600);
    } else {
      const enemies = this.enemies;
      target = (this.wingOrder === 'focus' ? enemies.find(e => e.id === this.focusId) : null) ?? enemies.sort((a, b) => a.position.distanceToSquared(f.position) - b.position.distanceToSquared(f.position))[0] ?? null;
      const index=Number(f.id.split('-')[1])-1;
      const anchor=index>=4&&this.bombers.length?this.bombers[0]!:this.player;
      const formation = new THREE.Vector3((index%2===0?-1:1)*(48+Math.floor(index/2)*38), 12+Math.floor(index/2)*14, -55-Math.floor(index/2)*38).applyQuaternion(anchor.rotation).add(anchor.position);
      destination = target && this.wingOrder !== 'follow' ? target.position.clone() : formation;
      f.speed = target && this.wingOrder !== 'follow' ? 130 : THREE.MathUtils.clamp(anchor.speed + formation.clone().sub(f.position).dot(this.forward(anchor)) * 1.5, 65, 200);
      if (target && f.position.distanceTo(target.position) < 80) f.evadingUntil = this.time + 2;
      if (this.time < f.evadingUntil) destination = formation;
    }
    this.steer(f, destination, dt);
    f.cooldown -= dt;
    const point = target ? target.position.clone().addScaledVector(this.forward(target), target.speed * target.position.distanceTo(f.position) / 720) : WEAK_POINT.clone();
    const distance = point.distanceTo(f.position);
    const direction = point.sub(f.position).normalize();
    const aligned = this.forward(f).dot(direction) > (enemy ? 0.975 : 0.95);
    if (f.cooldown <= 0 && distance < 820 && aligned && (enemy || target) && this.time >= f.evadingUntil) {
      if (enemy && target) direction.applyAxisAngle(Y, Math.sin(this.time * 3 + f.phase) * 0.045);
      this.shoot(f, direction, enemy ? 5 : 7);
      f.cooldown = enemy ? 0.75 : 0.6;
    }
  }

  private collideShip(f: Fighter) {
    const shield=this.shieldContact(f.previous,f.position);
    if(shield!==null) {
      const hit=f.previous.clone().lerp(f.position,shield);
      const normal=hit.clone().sub(this.shieldCenter).divide(this.shieldRadii).divide(this.shieldRadii).normalize();
      f.position.copy(hit).addScaledVector(normal,f.radius+8);f.previous.copy(f.position);
      const direction=this.forward(f).reflect(normal);f.rotation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(),direction,Y));
      if(f.id==='player'){this.playerCollisionVersion++;this.collisionNormal.copy(normal);this.message='粒子屏障阻挡通行，先攻击外露发生器。';}
      return;
    }
    const hit = this.hullHit(f.previous, f.position, f.radius);
    if (!hit) return;
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? Y.clone();
    // Retreat from the last outside position, then discard the interpolation segment
    // through the hull. A bounce must not leave the camera travelling through metal.
    if(normal.dot(f.previous.clone().sub(hit.point))<0) normal.negate();
    f.position.copy(f.previous).addScaledVector(normal, f.radius + 8);
    f.previous.copy(f.position);
    const direction = this.forward(f).reflect(normal).addScaledVector(normal, 0.6).normalize();
    f.rotation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, Y));
    if (f.id==='player') {
      this.playerCollisionVersion++; this.collisionNormal.copy(normal);
      f.health = 0;
      this.hitFlash = 1; this.message = this.stage==='defense'?'撞击母舰，座机已毁。':'撞击舰体，座机已毁。';
      this.events.push({ type: 'explosion', position: hit.point.clone(), enemy: false });
      return;
    }
    if (f.invulnerable <= 0) {
      f.health = applyDamage(f.health, 10); f.invulnerable = 0.9;
      this.events.push({ type: 'impact', position: hit.point.clone(), enemy: false });
    }
  }

  private updateTurrets(dt: number) {
    for(const turret of this.turrets) {
      turret.cooldown-=dt; turret.flash=Math.max(0,turret.flash-dt);
      if(this.time>=turret.scanAt) {
      turret.scanAt=this.time+0.25;
      const candidates=this.enemies.filter(e=>e.position.distanceTo(turret.position)<1250 && e.position.y>turret.position.y+8)
        .sort((a,b)=>a.position.distanceToSquared(turret.position)-b.position.distanceToSquared(turret.position));
      let aim: THREE.Vector3 | null=null;
      turret.targetId=null;
      for(const enemy of candidates) {
        const velocity=this.forward(enemy).multiplyScalar(enemy.speed);
        const solution=solveIntercept(turret.position,enemy.position,velocity,580,2.4);
        if(!solution)continue;
        const point=new THREE.Vector3(solution.point.x,solution.point.y,solution.point.z);
        const direction=point.clone().sub(turret.position).normalize();
        if(direction.y<0.04)continue;
        // Check the entire line from the mount; no firing through bridge or deck.
        if(this.hullHit(turret.position,point))continue;
        turret.targetId=enemy.id; aim=direction; break;
      }
      turret.aim=aim;
      }
      if(!turret.aim||!this.enemies.some(e=>e.id===turret.targetId))continue;
      turret.direction.lerp(turret.aim,1-Math.exp(-dt*2.8)).normalize();
      if(turret.cooldown>0||turret.direction.dot(turret.aim)<0.995||this.bolts.length>=192)continue;
      const position=turret.position.clone().addScaledVector(turret.direction,38);
      if(this.hullHit(turret.position,position))continue;
      const target=this.enemies.find(e=>e.id===turret.targetId)!;
      const solution=solveIntercept(position,target.position,this.forward(target).multiplyScalar(target.speed),580,2.4);
      if(!solution)continue;
      const direction=new THREE.Vector3(solution.point.x,solution.point.y,solution.point.z).sub(position).normalize();
      if(turret.direction.dot(direction)<0.995)continue;
      turret.direction.copy(direction);
      this.bolts.push({id:++this.boltSequence,team:'republic',owner:turret.id,position,previous:position.clone(),velocity:direction.clone().multiplyScalar(580),life:2.4,damage:12});
      turret.flash=0.13; turret.cooldown=2.6; this.turretShots++;
      if(this.turretShots%3===1)this.events.push({type:'carrier-shot',position:position.clone(),enemy:false});
    }
  }

  private shoot(f: Fighter, direction: THREE.Vector3, damage: number) {
    if (this.bolts.length >= 192) return;
    const position = this.muzzlePosition(f);
    this.bolts.push({ id: ++this.boltSequence, owner: f.id, team: f.team, position, previous: position.clone(), velocity: direction.clone().multiplyScalar(PROJECTILE_SPEED), life: PROJECTILE_LIFETIME, damage });
  }

  shieldContact(start: THREE.Vector3,end: THREE.Vector3) {
    if(!this.shieldActive||this.stage==='arrival')return null;
    return segmentSphere(start.clone().sub(this.shieldCenter).divide(this.shieldRadii),end.clone().sub(this.shieldCenter).divide(this.shieldRadii),new THREE.Vector3(),1);
  }

  private updateAssault(dt: number) {
    if(this.player.health<=0||this.carrierHealth<=0){this.mission={...this.mission,phase:'lost',lossReason:this.player.health<=0?'player-destroyed':'carrier-destroyed'};return;}
    this.stageTime+=dt;
    if(this.stage==='arrival') {
      if(this.stageTime>=4){this.stage='shield';this.stageTime=0;this.targetId=this.generator.id;this.message='外露护盾投射节点已标记。接近并摧毁它！';}
      return;
    }
    if(this.generator.health<=0&&this.stage==='shield') {
      this.stage='launch';this.stageTime=0;this.targetId=this.bridge.id;
      this.events.push({type:'explosion',position:this.generator.position.clone(),enemy:true});
      this.message='屏障瓦解！守望号机库开启，金色中队准备起飞。';
    }
    if(this.stage==='launch'||this.stage==='assault') {
      this.hangarOpen=Math.min(1,this.hangarOpen+dt/4);
      if(this.stage==='launch'&&this.stageTime>=4+this.launched*1.5&&this.launched<5) {
        const i=this.launched++,isBomber=i<3;
        const exit=new THREE.Vector3().fromArray(this.carrier.userData.hangarExit??[0,25,-150]);
        exit.x+=(i%3-1)*13;exit.y+=10;
        const f=fighter(isBomber?'gold-'+(i+1):'wing-'+(i+2),isBomber?'ywing':'arc170','republic',exit,isBomber?260:180);
        f.radius=isBomber?9:7;f.phase=i;f.evadingUntil=this.time+4;this.fighters.push(f);
        if(this.launched===5){this.stage='assault';this.stageTime=0;this.message='金色中队已出击！护航轰炸，或自行摧毁舰桥。';}
      }
    }
    this.reinforcementTimer-=dt;
    if(this.reinforcementTimer<=0){
      this.reinforcementTimer=22;
      for(let i=0;i<Math.min(3,10-this.enemies.length);i++) {
        const id=++this.reinforcementSequence;
        const f=fighter('interceptor-'+id,'vulture','separatist',this.frigate.position.clone().add(new THREE.Vector3((i-1)*100,230,550)),90);
        f.rotation.setFromAxisAngle(Y,Math.PI);f.phase=id;this.fighters.push(f);
      }
    }
    if(this.bridge.health<=0&&this.generator.health<=0){
      this.stage='destroyed';this.mission={...this.mission,phase:'won'};this.message='敌舰舰桥被摧毁，慷慨级失去作战能力！';
      for(let i=0;i<8;i++)this.events.push({type:'explosion',position:this.frigate.position.clone().add(new THREE.Vector3((i%2?1:-1)*90,40,-300+i*85)),enemy:true,size:150});
    }
  }

  private moveBomber(f: Fighter,dt:number) {
    const bridge=this.bridge;
    let destination: THREE.Vector3;
    if(f.position.z>-700)destination=new THREE.Vector3((f.phase-1)*45,200,-850);
    else if(f.position.distanceTo(bridge.position)<550||this.time<f.evadingUntil){
      if(this.time>=f.evadingUntil)f.evadingUntil=this.time+8;
      destination=bridge.position.clone().add(new THREE.Vector3((f.phase%2?1:-1)*950,260,600));
    } else destination=bridge.position.clone().add(new THREE.Vector3(0,100,250));
    f.speed=155;this.steer(f,destination,dt);f.cooldown-=dt;
    const delta=bridge.position.clone().sub(f.position);
    if(!this.shieldActive&&f.cooldown<=0&&delta.length()<1100&&this.forward(f).dot(delta.clone().normalize())>.8&&!this.hullHit(f.position,this.targetSurface(bridge,f.position))&&this.bolts.length<192){
      const position=this.muzzlePosition(f);
      this.bolts.push({id:++this.boltSequence,owner:f.id,team:'republic',targetId:bridge.id,position,previous:position.clone(),velocity:delta.normalize().multiplyScalar(330),life:7,damage:300});
      f.cooldown=7;this.events.push({type:'carrier-shot',position:position.clone(),enemy:false});
    }
  }

  private updateTorpedo(dt: number, pressed: boolean) {
    this.torpedoCooldown = Math.max(0, this.torpedoCooldown - dt);
    const target = this.target;
    const delta = target?.position.clone().sub(this.player.position);
    const valid = this.player.health > 0 && this.torpedoCooldown === 0 && target && delta && delta.length() <= TORPEDO_CONFIG.range
      && this.forward(this.player).dot(delta.clone().normalize()) >= Math.cos(TORPEDO_CONFIG.cone)
      && !this.hullHit(this.player.position, this.targetSurface(target,this.player.position));
    if (!valid) { this.torpedoLock = 0; this.torpedoTarget = null; }
    else {
      if (this.torpedoTarget !== target.id) this.torpedoLock = 0;
      this.torpedoTarget = target.id;
      this.torpedoLock = Math.min(TORPEDO_CONFIG.lockTime, this.torpedoLock + dt);
    }
    if (pressed && !this.torpedoHeld && valid && this.torpedoLock >= TORPEDO_CONFIG.lockTime && this.bolts.length < 192) {
      const position = this.muzzlePosition(this.player);
      this.bolts.push({ id: ++this.boltSequence, owner: 'player', team: 'republic', targetId: target.id,
        position, previous: position.clone(), velocity: this.forward(this.player).multiplyScalar(TORPEDO_CONFIG.speed), life: TORPEDO_CONFIG.lifetime, damage: TORPEDO_CONFIG.damage });
      this.torpedoCooldown = TORPEDO_CONFIG.cooldown; this.torpedoLock = 0; this.torpedoTarget = null;
      this.events.push({ type: 'carrier-shot', position: position.clone(), enemy: false });
      this.message = '质子鱼雷已发射！';
    }
    this.torpedoHeld = pressed;
  }

  private updateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!;
      if (bolt.targetId) {
        const target = this.attackTargets.find(f => f.id === bolt.targetId);
        if (target) {
          const intercept = solveIntercept(bolt.position, target.position, this.forward(target).multiplyScalar(target.speed), TORPEDO_CONFIG.speed, bolt.life);
          const aim = intercept ? new THREE.Vector3(intercept.point.x, intercept.point.y, intercept.point.z) : target.position;
          const desired = aim.clone().sub(bolt.position).normalize();
          const turn = new THREE.Quaternion().setFromUnitVectors(bolt.velocity.clone().normalize(), desired);
          const limited = new THREE.Quaternion().rotateTowards(turn, TORPEDO_CONFIG.turnRate * dt);
          bolt.velocity.applyQuaternion(limited);
        }
      }
      bolt.previous.copy(bolt.position); bolt.position.addScaledVector(bolt.velocity, dt); bolt.life -= dt;
      let firstT = Infinity;
      let victim: Fighter | null = null;
      for (const f of [...this.fighters,...this.objectives]) {
        if (f.team === bolt.team || f.health <= 0) continue;
        const start = bolt.previous.clone().sub(f.previous);
        const end = bolt.position.clone().sub(f.position);
        const t = segmentSphere(start, end, new THREE.Vector3(), f.radius + (bolt.owner === 'player' ? 2.2 : 0.2));
        if (t !== null && t < firstT) { firstT = t; victim = f; }
      }
      const shield=this.shieldContact(bolt.previous,bolt.position);
      if(shield!==null&&shield<firstT){
        this.events.push({type:'impact',position:bolt.previous.clone().lerp(bolt.position,shield),enemy:true});this.bolts.splice(i,1);continue;
      }
      const hull = this.hullHit(bolt.previous, bolt.position);
      const segmentLength = bolt.previous.distanceTo(bolt.position);
      if (hull && hull.distance / segmentLength < firstT) {
        if (bolt.team === 'separatist' && hull.point.distanceTo(WEAK_POINT) < 105) this.carrierHealth = applyDamage(this.carrierHealth, bolt.damage * 1.2);
        this.events.push({ type: bolt.targetId ? 'explosion' : 'impact', position: hull.point.clone(), enemy: bolt.team === 'separatist' });
        bolt.life = 0;
      } else if (victim) {
        victim.health = applyDamage(victim.health, bolt.damage); bolt.life = 0;
        this.events.push({ type: bolt.targetId ? 'explosion' : 'impact', position: bolt.previous.clone().lerp(bolt.position, firstT), enemy: victim.team === 'separatist' });
        if (bolt.owner === 'player') this.hitConfirm = 1;
        if (victim.id === 'player') { this.hitFlash = 1; this.events.push({ type: 'player-hit', position: victim.position.clone(), enemy: true }); }
      }
      if (bolt.life <= 0) this.bolts.splice(i, 1);
    }
  }
}
