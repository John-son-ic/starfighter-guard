import {createMunificentModel} from '../../visual/models/munificent.ts';
import * as THREE from 'three';
import { createMission, advanceMission } from '../../sim/mission.ts';
import { createWeapon, advanceWeapon, applyDamage } from '../../sim/combat.ts';
import { solveIntercept } from '../../sim/intercept.ts';
import { MISSION_CONFIG, MVP_CONFIG, WEAPON_CONFIG } from '../../shared/config.ts';
import type { MissionState, ModelId, WeaponState } from '../../shared/types.ts';

export interface FlightInput { yaw: number; pitch: number; roll: number; throttle: number; boost: boolean; fire: boolean; torpedo?: boolean; jump?: boolean; shield?: boolean }
export const NEUTRAL_INPUT: FlightInput = { yaw: 0, pitch: 0, roll: 0, throttle: 0, boost: false, fire: false };
export interface Fighter {
  id: string; model: ModelId; team: 'republic' | 'separatist'; position: THREE.Vector3; previous: THREE.Vector3;
  rotation: THREE.Quaternion; speed: number; health: number; maxHealth: number; radius: number;
  weapon: WeaponState; cooldown: number; evadingUntil: number; phase: number; invulnerable: number;
}
export const TORPEDO_CONFIG = { lockTime: 2, cooldown: 18, range: 1200, cone: Math.PI / 12, speed: 330, turnRate: 1.8, lifetime: 7, damage: 120 } as const;
export const PLAYER_SHIELD_CONFIG = { duration: 5, cooldown: 30 } as const;
export const JUMP_CONFIG = { distance: 2500, cooldown: 10, clearance: 180 } as const;
export const BOMBER_DAMAGE = 600;
export const CAPITAL_ROLES = [
  { name: '重炮舰', heavyDamage: 36, reinforcements: 1 },
  { name: '拦截舰', heavyDamage: 18, reinforcements: 3 },
] as const;
export interface AssaultShip { model: THREE.Group; position: THREE.Vector3; bounds: THREE.Box3; generator: Fighter; bridge: Fighter; guns: EnemyGun[]; launched: number; launchTime: number; destroyed: boolean; role: 0 | 1; }
export interface EnemyGun extends Fighter { direction: THREE.Vector3; flash: number; heavy: boolean; shipIndex: number; }
export function isEnemyGun(f: Fighter): f is EnemyGun { return 'heavy' in f; }
export interface TacticalAlert { id: string; text: string; subjectId: string; position: THREE.Vector3; targetId: string | null; expires: number; }
export interface Bolt { capital?: boolean; targetId?: string; id: number; team: Fighter['team']; owner: string; position: THREE.Vector3; previous: THREE.Vector3; velocity: THREE.Vector3; life: number; damage: number }
export interface CarrierTurret { id: string; position: THREE.Vector3; direction: THREE.Vector3; cooldown: number; flash: number; targetId: string | null; aim: THREE.Vector3 | null; scanAt: number }
export type WorldEvent = { type: 'explosion' | 'impact' | 'player-hit' | 'shot' | 'carrier-shot' | 'warning' | 'torpedo-launch' | 'torpedo-hit' | 'kill' | 'shield-hit' | 'shield-bounce'; position: THREE.Vector3; enemy: boolean; size?: number; normal?: THREE.Vector3 };
export interface FlightCheckpoint {
  fighters: Fighter[]; mission: MissionState; turrets: CarrierTurret[];
  time: number; carrierHealth: number; turretShots: number; boltSequence: number;
  boostEnergy: number; jumpCooldown: number; shieldTime: number; shieldCooldown: number;
  torpedoCooldowns: number[]; wingOrder: 'guard' | 'focus' | 'follow'; focusId: string | null;
}
export function copyFighter(f: Fighter): Fighter {
  return {...f,position:f.position.clone(),previous:f.position.clone(),rotation:f.rotation.clone(),weapon:{...f.weapon}};
}
function copyTurret(t: CarrierTurret): CarrierTurret {
  return {...t,position:t.position.clone(),direction:t.direction.clone(),aim:t.aim?.clone()??null};
}
const FORWARD = new THREE.Vector3(0, 0, -1);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
export const WEAK_POINT = new THREE.Vector3(145, -38, 210);
const PROJECTILE_SPEED = 720;
const PROJECTILE_LIFETIME = 2;

export function createFighter(id: string, model: ModelId, team: Fighter['team'], position: THREE.Vector3, health: number): Fighter {
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
  readonly capitalShips: AssaultShip[] = [];
  readonly generator: Fighter;
  readonly bridge: Fighter;
  readonly enemyGuns: EnemyGun[] = [];
  private alerts: TacticalAlert[] = [];
  private nextWarningSound = 0;
  private checkpoint: FlightCheckpoint | null = null;
  get hasCheckpoint() { return this.checkpoint !== null; }
  get checkpointInfo() {
    const c=this.checkpoint;
    return c?{carrierHealth:c.carrierHealth,playerHealth:c.fighters[0]!.health,friendlies:c.fighters.length-1}:null;
  }

  /** One session-only snapshot, captured once after the last defense wave. */
  protected captureFlightCheckpoint(includeEnemies=false): FlightCheckpoint {
    this.bolts.length=0; // The completed wave leaves no stray rounds in the new stage.
    this.torpedoLock=0;this.torpedoTarget=null;this.targetId=null;
    return {fighters:this.fighters.filter(f=>(includeEnemies||f.team==='republic')&&f.health>0).map(copyFighter),mission:structuredClone(this.mission),
      turrets:this.turrets.map(copyTurret),time:this.time,carrierHealth:this.carrierHealth,turretShots:this.turretShots,boltSequence:this.boltSequence,
      boostEnergy:this.boostEnergy,jumpCooldown:this.jumpCooldown,shieldTime:this.shieldTime,shieldCooldown:this.shieldCooldown,
      torpedoCooldowns:[...this.torpedoCooldowns],wingOrder:this.wingOrder,focusId:this.focusId};
  }

  retryFromCheckpoint(): FlightWorld | null {
    const c=this.checkpoint;
    if(!c||this.mission.phase!=='lost')return null;
    const restored=new FlightWorld(this.carrier,...this.capitalShips.map(s=>s.model) as [THREE.Group,THREE.Group]);
    restored.restoreFlightCheckpoint(c);
    restored.stage='arrival';restored.stageTime=0;
    restored.checkpoint=c;restored.message='已返回敌舰来袭检查点 · 当时的损伤与僚机状态已保留。';
    return restored;
  }
  protected restoreFlightCheckpoint(c:FlightCheckpoint) {
    const restored=this;
    Object.assign(restored.player,copyFighter(c.fighters[0]!));
    restored.fighters.splice(0,restored.fighters.length,restored.player,...c.fighters.slice(1).map(copyFighter));
    restored.mission=structuredClone(c.mission);
    restored.turrets.splice(0,restored.turrets.length,...c.turrets.map(copyTurret));
    restored.time=c.time;restored.carrierHealth=c.carrierHealth;restored.turretShots=c.turretShots;restored.boltSequence=c.boltSequence;
    restored.boostEnergy=c.boostEnergy;restored.jumpCooldown=c.jumpCooldown;restored.shieldTime=c.shieldTime;restored.shieldCooldown=c.shieldCooldown;
    restored.torpedoCooldowns.splice(0,2,...c.torpedoCooldowns);restored.wingOrder=c.wingOrder;restored.focusId=c.focusId;
  }
  get checkpointTitle() {return '敌舰来袭';}
  get threats() { return this.terminal ? [] : this.alerts.filter(a => a.expires > this.time).sort((a,b) => Number(b.id.startsWith('gold-')) - Number(a.id.startsWith('gold-'))); }

  private warn(id: string, text: string, subjectId: string, position: THREE.Vector3, owner: string) {
    const gun = this.enemyGuns.find(g => g.id === owner && g.health > 0);
    const ship = gun ? this.capitalShips[gun.shipIndex] : null;
    const targetId = ship && ship.generator.health > 0 ? ship.generator.id : this.attackTargets.find(f => f.id === owner)?.id ?? null;
    const alert = {id,text,subjectId,position:position.clone(),targetId,expires:this.time+5};
    this.alerts = [...this.alerts.filter(a => a.id !== id && a.expires > this.time),alert];
    if(this.time >= this.nextWarningSound) {
      this.nextWarningSound = this.time + 6;
      this.events.push({type:'warning',position:position.clone(),enemy:false});
    }
  }

  selectThreat() {
    const alert = this.threats.find(a => this.attackTargets.some(f => f.id === a.targetId));
    if (alert) this.targetId = alert.targetId;
    else this.message = '暂无可拦截的威胁目标。';
  }
  shieldTime = 0;
  shieldCooldown = 0;
  private shieldHeld = false;
  get playerShieldActive() { return this.shieldTime > 0 && this.player.health > 0; }
  jumpCooldown = 0;
  jumpFlash = 0;
  private jumpHeld = false;
  get exposedGuns() {return this.stage!=='defense'&&this.stage!=='arrival'&&this.stage!=='destroyed'?this.capitalShips.filter(s=>!s.destroyed&&s.generator.health<=0).flatMap(s=>s.guns.filter(g=>g.health>0)):[];}
  stage: 'defense' | 'arrival' | 'shield' | 'launch' | 'assault' | 'destroyed' = 'defense';
  stageTime = 0;
  hangarOpen = 0;
  private reinforcementTimer = 0;
  private reinforcementSequence = 0;


  readonly shieldRadii = new THREE.Vector3(260,150,470);
  shieldCenterFor(ship: AssaultShip) { return ship.position.clone().add(new THREE.Vector3(0,-40,0)); }
  get shieldCenter() { return this.shieldCenterFor(this.capitalShips[0]!); }
  get shieldActive() { return this.stage !== 'defense' && this.stage !== 'destroyed' && this.generator.health > 0; }
  get objectives() { return this.stage === 'defense' || this.stage === 'arrival' || this.stage === 'destroyed' ? [] : this.capitalShips.filter(s=>!s.destroyed).map(s=>s.generator.health>0?s.generator:s.bridge).filter(f=>f.health>0); }
  get attackTargets() { return [...this.enemies, ...this.objectives,...this.exposedGuns]; }
  get bombers() { return this.fighters.filter(f=>f.model==='ywing'&&f.health>0); }
  get objectiveText():string {
    if(this.stage==='defense') return '清除三波敌机 · 守住狩猎者级';
    if(this.stage==='arrival') return '警报：两艘慷慨级正在跃迁进入战场';
    if(this.stage==='shield') return '击毁外露护盾发生器 · 舰体受屏障保护';
    if(this.stage==='launch') return '护盾已瓦解 · 机库门开启，轰炸编队出击';
    if(this.stage==='assault') return this.bombers.length ? '护航Y翼轰炸机，或直接攻击敌舰舰桥' : '轰炸机已损失 · 亲自摧毁敌舰舰桥';
    return '两艘慷慨级已摧毁';
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
  readonly torpedoCooldowns = [0, 0];
  get torpedoCooldown() { return Math.min(...this.torpedoCooldowns); }
  get torpedoCharges() { return this.torpedoCooldowns.filter(t => t === 0).length; }
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
  protected boltSequence = 0;
  private ray = new THREE.Raycaster();
  private carrierBounds: THREE.Box3;

  constructor(carrier: THREE.Object3D, frigate = createMunificentModel(false), secondFrigate = createMunificentModel(false)) {
    this.carrier = carrier;
    this.frigate = frigate;
    for(const [index,model] of [frigate,secondFrigate].entries()) {
      const position=new THREE.Vector3(index===0?-650:650,0,index===0?-5000:-5250);
      model.position.copy(position);model.scale.setScalar(1);model.rotation.set(0,Math.PI,0);model.updateMatrixWorld(true);
      const point=(key:string)=>new THREE.Vector3().fromArray(model.userData[key]).applyMatrix4(model.matrixWorld);
      const suffix=index===0?'':'-2';
      const generator=createFighter('shield-generator'+suffix,'munificent','separatist',point('generator'),360);generator.radius=28;generator.speed=0;
      const bridge=createFighter('frigate-bridge'+suffix,'munificent','separatist',point('bridge'),1800);bridge.radius=44;bridge.speed=0;
      const guns=(model.userData.gunMounts as number[][]).map((mount,i)=>{
        const gun=createFighter('enemy-gun-'+(index*6+i+1),'munificent','separatist',new THREE.Vector3().fromArray(mount).applyMatrix4(model.matrixWorld),150);
        gun.radius=20;gun.speed=0;gun.cooldown=.4+i*.6+index;
        return {...gun,direction:new THREE.Vector3(0,0,1),flash:0,heavy:i%3===0,shipIndex:index};
      });
      this.enemyGuns.push(...guns);
      this.capitalShips.push({model,position,bounds:new THREE.Box3().setFromObject(model),generator,bridge,guns,launched:0,launchTime:-1,destroyed:false,role:index as 0 | 1});
    }
    this.generator=this.capitalShips[0]!.generator;this.bridge=this.capitalShips[0]!.bridge;
    carrier.updateMatrixWorld(true);
    this.carrierBounds = new THREE.Box3().setFromObject(carrier);
    this.player = createFighter('player', 'eta2', 'republic', new THREE.Vector3(110, 95, 300), 100);
    this.fighters = [this.player, ...Array.from({length:MVP_CONFIG.friendlies},(_,i)=>createFighter(`wing-${i+1}`, 'arc170', 'republic', new THREE.Vector3(110 + (i%2===0?-1:1)*(48+Math.floor(i/2)*40), 107+Math.floor(i/2)*15, 242-Math.floor(i/2)*36), 120))];
    for (const side of [-1,1]) for(let i=0;i<4;i++) this.turrets.push({id:`turret-${side}-${i}`,position:new THREE.Vector3(side*(111+i*17),-18.25,142+i*57),direction:FORWARD.clone(),cooldown:0.3+i*0.3+(side+1)*0.1,flash:0,targetId:null,aim:null,scanAt:i*0.04});
  }

  get enemies() { return this.fighters.filter(f => f.team === 'separatist' && f.health > 0); }
  get target() { return this.attackTargets.find(f => f.id === this.targetId) ?? null; }
  get terminal() { return this.mission.phase === 'won' || this.mission.phase === 'lost'; }
  forward(f: Fighter) { return FORWARD.clone().applyQuaternion(f.rotation); }

  selectNext(camera?: THREE.PerspectiveCamera) {
    const candidates = this.attackTargets.map(target => {
      const offset = target.position.clone().sub(camera?.position ?? this.player.position);
      if (camera) offset.applyQuaternion(camera.quaternion.clone().invert());
      else offset.applyQuaternion(this.player.rotation.clone().invert());
      const depth = -offset.z;
      const projected = camera ? target.position.clone().project(camera) : null;
      const visible = depth > 0 && (!projected || (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1));
      // Pixel distance from the real camera's screen center; aspect corrects NDC.
      const score = projected && depth > 0
        ? Math.hypot(projected.x * camera!.aspect, projected.y)
        : Math.atan2(Math.hypot(offset.x, offset.y), depth);
      return { target, visible, score, distance: offset.lengthSq() };
    });
    candidates.sort((a, b) => Number(b.visible) - Number(a.visible) || a.score - b.score || a.distance - b.distance);
    this.targetId = candidates[0]?.target.id ?? null;
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
    if(this.stage!=='defense'&&this.stage!=='arrival'&&this.stage!=='destroyed')for(const ship of this.capitalShips)if(!ship.destroyed&&this.ray.ray.intersectsBox(ship.bounds))hits.push(...this.ray.intersectObject(ship.model,true));
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
    this.updatePlayerShield(dt, !!input.shield);
    this.movePlayer(dt, input);
    for (const f of this.fighters) if (f.id !== 'player' && f.health > 0) this.moveAI(f, dt);
    this.updateTurrets(dt);
    this.updateEnemyGuns(dt);
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
      this.checkpoint=this.captureFlightCheckpoint();
      this.message='检查点已记录 · 大型跃迁信号！前方5000米出现敌舰。';
    }
    for (const event of result.events) {
      if (event.type === 'spawn-wave') {
        event.enemyIds.forEach((id, i) => {
          const slot = i%5, row = Math.floor(i/5);
          const flank = event.waveIndex%2 ? -1 : 1;
          const f = createFighter(id, 'vulture', 'separatist', new THREE.Vector3(flank*(-320 + slot*150), 135+row*65+slot*12, -780-row*160-slot*30), 90);
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
    return (target.model==='munificent'||target.model==='relay') ? target.position.clone().addScaledVector(origin.clone().sub(target.position).normalize(),target.radius+1) : target.position;
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
    if(this.updateJump(dt,!!input.jump))return;
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
      const anchor=index>=4&&this.bombers.length?(this.bombers.find(b=>b.phase===f.phase)??this.bombers[0]!):this.player;
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
      const normal=hit.clone().sub(this.shieldCenterFor(this.shieldShip(f.previous,f.position)!.ship)).divide(this.shieldRadii).divide(this.shieldRadii).normalize();
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
      if (this.playerShieldActive) {
        this.message = '护盾缓冲撞击，座机已弹开。';
        this.events.push({type:'shield-bounce',position:hit.point.clone(),normal:normal.clone().negate(),enemy:false});
        return;
      }
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

  private updatePlayerShield(dt: number, pressed: boolean) {
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.shieldCooldown = Math.max(0, this.shieldCooldown - dt);
    const trigger = pressed && !this.shieldHeld;
    this.shieldHeld = pressed;
    if (trigger && this.shieldCooldown === 0 && this.player.health > 0) {
      this.shieldTime = PLAYER_SHIELD_CONFIG.duration;
      this.shieldCooldown = PLAYER_SHIELD_CONFIG.cooldown;
      this.message = '主动护盾开启 · 激光免伤与撞击缓冲 5 秒';
      this.events.push({type:'carrier-shot',position:this.player.position.clone(),enemy:false});
    }
  }

  private updateJump(dt:number,pressed:boolean) {
    this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);this.jumpFlash=Math.max(0,this.jumpFlash-dt*2);
    const trigger=pressed&&!this.jumpHeld;this.jumpHeld=pressed;
    if(!trigger||this.jumpCooldown>0||this.player.health<=0)return false;
    const p=this.player,direction=this.forward(p),start=p.position.clone(),end=start.clone().addScaledVector(direction,JUMP_CONFIG.distance);
    let distance=JUMP_CONFIG.distance as number;
    const right=new THREE.Vector3(1,0,0).applyQuaternion(p.rotation).multiplyScalar(12),up=new THREE.Vector3(0,1,0).applyQuaternion(p.rotation).multiplyScalar(12);
    for(const offset of [new THREE.Vector3(),right,right.clone().negate(),up,up.clone().negate()]){
      const a=start.clone().add(offset),b=end.clone().add(offset),hit=this.hullHit(a,b),shield=this.shieldContact(a,b);
      if(hit)distance=Math.min(distance,hit.distance-JUMP_CONFIG.clearance);
      if(shield!==null)distance=Math.min(distance,shield*JUMP_CONFIG.distance-JUMP_CONFIG.clearance);
    }
    const center=this.stage==='defense'?new THREE.Vector3():new THREE.Vector3(0,0,-2500),radius=this.stage==='defense'?2200:4000;
    const offset=start.clone().sub(center),b=offset.dot(direction),disc=b*b-offset.lengthSq()+radius*radius;
    distance=Math.min(distance,disc>=0?-b+Math.sqrt(disc):0);
    if(distance<100){this.message='跃迁路径受阻，请改变朝向。';return false;}
    p.position.addScaledVector(direction,distance);p.previous.copy(p.position);
    this.playerCollisionVersion++;this.collisionNormal.copy(direction).negate();
    this.jumpCooldown=JUMP_CONFIG.cooldown;this.jumpFlash=1;this.torpedoLock=0;this.torpedoTarget=null;
    this.message='短程跃迁完成 · '+Math.round(distance)+' 米';this.events.push({type:'carrier-shot',position:p.position.clone(),enemy:false});return true;
  }

  protected updateEnemyGuns(dt:number) {
    if(this.stage==='defense'||this.stage==='arrival'||this.stage==='destroyed')return;
    for(const gun of this.enemyGuns){
      gun.flash=Math.max(0,gun.flash-dt);if(gun.health<=0)continue;gun.cooldown-=dt;
      let point:THREE.Vector3|null=null;
      const speed=gun.heavy?1600:650;
      if(gun.heavy)point=new THREE.Vector3(Math.sign(gun.position.x)*105,-40,-250);
      else {
        const target=this.fighters.filter(f=>f.team==='republic'&&f.health>0&&f.position.distanceTo(gun.position)<1500).sort((a,b)=>a.position.distanceToSquared(gun.position)-b.position.distanceToSquared(gun.position))[0];
        if(target){const aim=solveIntercept(gun.position,target.position,this.forward(target).multiplyScalar(target.speed),speed,3);if(aim)point=new THREE.Vector3(aim.point.x,aim.point.y,aim.point.z);}
      }
      if(!point)continue;
      const desired=point.clone().sub(gun.position).normalize();gun.direction.lerp(desired,1-Math.exp(-dt*4)).normalize();
      if(gun.cooldown>0||gun.direction.dot(desired)<.995||this.bolts.length>=192)continue;
      const position=gun.position.clone().addScaledVector(gun.direction,30);
      // Test the entire path up to the target's surface; never shoot through own hull.
      if(this.hullHit(gun.position,position))continue;
      if(!gun.heavy&&this.hullHit(position,point.clone().addScaledVector(desired,-12)))continue;
      this.bolts.push({id:++this.boltSequence,owner:gun.id,team:'separatist',capital:gun.heavy,position,previous:position.clone(),velocity:gun.direction.clone().applyAxisAngle(Y,gun.heavy?0:Math.sin(this.time*3+Number(gun.id.split('-').at(-1)))*.02).multiplyScalar(speed),life:gun.heavy?5:3,damage:gun.heavy?CAPITAL_ROLES[this.capitalShips[gun.shipIndex]!.role].heavyDamage:12});
      gun.cooldown=gun.heavy?6:2.4;gun.flash=.15;
      if(gun.heavy)this.events.push({type:'carrier-shot',position:position.clone(),enemy:true});
    }
  }

  protected updateTurrets(dt: number) {
    for(const turret of this.turrets) {
      turret.cooldown-=dt; turret.flash=Math.max(0,turret.flash-dt);
      if(this.stage!=='defense'&&this.stage!=='arrival'&&this.stage!=='destroyed') {
        const alive=this.capitalShips.filter(s=>!s.destroyed);
        const ship=alive[(this.turrets.indexOf(turret)%2)%alive.length];if(!ship)continue;
        const direction=ship.bridge.position.clone().sub(turret.position).normalize();
        turret.direction.lerp(direction,1-Math.exp(-dt*2.8)).normalize();turret.targetId=ship.bridge.id;
        if(turret.cooldown<=0&&turret.direction.dot(direction)>.995&&this.bolts.length<192){
          const position=turret.position.clone().addScaledVector(turret.direction,38);
          if(!this.hullHit(turret.position,position)){
            this.bolts.push({id:++this.boltSequence,owner:turret.id,team:'republic',capital:true,position,previous:position.clone(),velocity:direction.multiplyScalar(1600),life:5,damage:6});
            turret.cooldown=5;turret.flash=.13;this.turretShots++;
          }
        }
        continue;
      }
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

  shieldShip(start: THREE.Vector3,end: THREE.Vector3) {
    if(this.stage==='defense'||this.stage==='arrival'||this.stage==='destroyed')return null;
    let closest: {ship:AssaultShip;t:number}|null=null;
    for(const ship of this.capitalShips) {
      if(ship.destroyed||ship.generator.health<=0)continue;
      const center=this.shieldCenterFor(ship);
      const t=segmentSphere(start.clone().sub(center).divide(this.shieldRadii),end.clone().sub(center).divide(this.shieldRadii),new THREE.Vector3(),1);
      if(t!==null&&(!closest||t<closest.t))closest={ship,t};
    }
    return closest;
  }
  shieldContact(start: THREE.Vector3,end: THREE.Vector3) {return this.shieldShip(start,end)?.t??null;}

  protected updateAssault(dt: number) {
    if(this.player.health<=0||this.carrierHealth<=0){this.mission={...this.mission,phase:'lost',lossReason:this.player.health<=0?'player-destroyed':'carrier-destroyed'};return;}
    this.stageTime+=dt;
    if(this.stage==='arrival') {
      if(this.stageTime>=4){this.stage='shield';this.stageTime=0;this.targetId=this.generator.id;this.message='两艘慷慨级抵达！分别击破护盾，呼叫轰炸支援。';}
      return;
    }
    for(const [index,ship] of this.capitalShips.entries()) {
      if(ship.generator.health<=0&&ship.launchTime<0) {
        ship.launchTime=0;this.targetId=ship.bridge.id;
        this.events.push({type:'explosion',position:ship.generator.position.clone(),enemy:true});
        this.message='敌舰 '+(index+1)+' 护盾瓦解：1架Y翼和2架护航机准备出击。';
      }
      if(ship.launchTime>=0&&ship.launched<3) {
        ship.launchTime+=dt;
        if(this.hangarOpen>=1&&ship.launchTime>=4+ship.launched*1.5) {
          const i=ship.launched++,isBomber=i===0;
          const exit=new THREE.Vector3().fromArray(this.carrier.userData.hangarExit??[0,25,-150]);
          exit.x+=(index===0?-1:1)*20;exit.y+=10;
          const f=createFighter(isBomber?'gold-'+(index+1):'wing-'+(5+index*2+i-1),isBomber?'ywing':'arc170','republic',exit,isBomber?320:120);
          f.radius=isBomber?9:7;f.phase=index;f.evadingUntil=this.time+4;this.fighters.push(f);
        }
      }
      if(!ship.destroyed&&ship.bridge.health<=0&&ship.generator.health<=0) {
        ship.destroyed=true;ship.guns.forEach(g=>g.health=0);
        this.events.push({type:'explosion',position:ship.bridge.position.clone(),enemy:true,size:110});
        this.message=CAPITAL_ROLES[ship.role].name+'已摧毁，其炮火与增援停止。';
      }
    }
    const triggered=this.capitalShips.filter(s=>s.launchTime>=0);
    if(triggered.length){this.hangarOpen=Math.min(1,this.hangarOpen+dt/4);this.stage=triggered.some(s=>s.launched<3)?'launch':'assault';}
    this.reinforcementTimer-=dt;
    if(this.reinforcementTimer<=0){
      this.reinforcementTimer=22;
      for(const ship of this.capitalShips.filter(s=>!s.destroyed))for(let i=0;i<CAPITAL_ROLES[ship.role].reinforcements&&this.enemies.length<10;i++) {
        const id=++this.reinforcementSequence;
        const f=createFighter('interceptor-'+id,'vulture','separatist',ship.position.clone().add(new THREE.Vector3((i-.5)*150,230,550)),90);
        f.rotation.setFromAxisAngle(Y,Math.PI);f.phase=id;this.fighters.push(f);
      }
    }
    if(this.capitalShips.every(s=>s.destroyed)){
      this.stage='destroyed';this.mission={...this.mission,phase:'won'};this.message='两艘敌舰均已摧毁，航道已清空！';
    }
  }

  private moveBomber(f: Fighter,dt:number) {
    const available=this.capitalShips.filter(s=>!s.destroyed&&s.generator.health<=0);
    const ship=available.find(s=>s===this.capitalShips[f.phase])??available[0];
    if(!ship){f.speed=155;this.steer(f,new THREE.Vector3((f.phase?1:-1)*800,350,-2500),dt);return;}
    const bridge=ship.bridge;
    let destination: THREE.Vector3;
    if(f.position.z>-700)destination=new THREE.Vector3((f.phase-1)*45,200,-850);
    else if(f.position.distanceTo(bridge.position)<550||this.time<f.evadingUntil){
      if(this.time>=f.evadingUntil)f.evadingUntil=this.time+8;
      destination=bridge.position.clone().add(new THREE.Vector3((f.phase%2?1:-1)*950,260,600));
    } else destination=bridge.position.clone().add(new THREE.Vector3(0,100,250));
    f.speed=155;this.steer(f,destination,dt);f.cooldown-=dt;
    const delta=bridge.position.clone().sub(f.position);
    if(ship.generator.health<=0&&f.cooldown<=0&&delta.length()<1100&&this.forward(f).dot(delta.clone().normalize())>.8&&!this.hullHit(f.position,this.targetSurface(bridge,f.position))&&this.bolts.length<192){
      const position=this.muzzlePosition(f);
      this.bolts.push({id:++this.boltSequence,owner:f.id,team:'republic',targetId:bridge.id,position,previous:position.clone(),velocity:delta.normalize().multiplyScalar(330),life:7,damage:BOMBER_DAMAGE});
      f.cooldown=7;this.events.push({type:'carrier-shot',position:position.clone(),enemy:false});
    }
  }

  private updateTorpedo(dt: number, pressed: boolean) {
    for (let i = 0; i < this.torpedoCooldowns.length; i++) this.torpedoCooldowns[i] = Math.max(0, this.torpedoCooldowns[i]! - dt);
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
      this.torpedoCooldowns[this.torpedoCooldowns.findIndex(t => t === 0)] = TORPEDO_CONFIG.cooldown; this.torpedoLock = 0; this.torpedoTarget = null;
      this.events.push({ type: 'torpedo-launch', position: position.clone(), enemy: false });
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
      for (const f of [...this.fighters,...this.objectives,...this.exposedGuns]) {
        if (f.team === bolt.team || f.health <= 0) continue;
        const start = bolt.previous.clone().sub(f.previous);
        const end = bolt.position.clone().sub(f.position);
        const t = segmentSphere(start, end, new THREE.Vector3(), f.radius + (bolt.owner === 'player' ? 2.2 : 0.2));
        if (t !== null && t < firstT) { firstT = t; victim = f; }
      }
      const shield=bolt.owner.startsWith('enemy-gun-')?null:this.shieldContact(bolt.previous,bolt.position);
      if(shield!==null&&shield<firstT){
        this.events.push({type:'impact',position:bolt.previous.clone().lerp(bolt.position,shield),enemy:true});this.bolts.splice(i,1);continue;
      }
      const hull = this.hullHit(bolt.previous, bolt.position);
      const segmentLength = bolt.previous.distanceTo(bolt.position);
      if (hull && hull.distance / segmentLength < firstT) {
        if (bolt.team === 'separatist' && (bolt.capital && hull.point.distanceTo(this.carrier.position)<850 || hull.point.distanceTo(WEAK_POINT) < 105)) {
          this.carrierHealth = applyDamage(this.carrierHealth, bolt.damage * 1.2);
          if(bolt.capital)this.warn('carrier','守望号遭重炮轰击 · 拆除重型主炮','home',hull.point,bolt.owner);
        }
        this.events.push({ type: bolt.targetId ? 'explosion' : 'impact', position: hull.point.clone(), enemy: bolt.team === 'separatist' });
        bolt.life = 0;
      } else if (victim) {
        if (victim.id === 'player' && this.playerShieldActive && bolt.team === 'separatist' && !bolt.targetId) {
          const point=bolt.previous.clone().lerp(bolt.position,firstT);
          const normal=point.clone().sub(victim.previous.clone().lerp(victim.position,firstT)).normalize();
          this.events.push({type:'shield-hit',position:point,normal,enemy:false});
          this.bolts.splice(i,1); continue;
        }
        victim.health = applyDamage(victim.health, bolt.damage); bolt.life = 0;
        if(bolt.owner==='player') {
          if(bolt.targetId)this.events.push({type:'torpedo-hit',position:victim.position.clone(),enemy:true});
          if(victim.health===0)this.events.push({type:'kill',position:victim.position.clone(),enemy:true});
        }
        if(victim.model==='ywing')this.warn(victim.id,'金色 '+victim.id.split('-')[1]+(victim.health>0?' 遭到攻击 · 拦截来袭敌机':' 已损失'),victim.id,victim.position,bolt.owner);
        if(victim.id.startsWith('enemy-gun-')&&victim.health===0)this.events.push({type:'explosion',position:victim.position.clone(),enemy:true,size:35});
        this.events.push({ type: bolt.targetId ? 'explosion' : 'impact', position: bolt.previous.clone().lerp(bolt.position, firstT), enemy: victim.team === 'separatist' });
        if (bolt.owner === 'player') this.hitConfirm = 1;
        if (victim.id === 'player') { this.hitFlash = 1; this.events.push({ type: 'player-hit', position: victim.position.clone(), enemy: true }); }
      }
      if (bolt.life <= 0) this.bolts.splice(i, 1);
    }
  }
}
