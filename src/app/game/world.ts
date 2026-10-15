import * as THREE from 'three';
import { createMission, advanceMission } from '../../sim/mission.ts';
import { createWeapon, advanceWeapon, applyDamage } from '../../sim/combat.ts';
import { solveIntercept } from '../../sim/intercept.ts';
import { MISSION_CONFIG, WEAPON_CONFIG } from '../../shared/config.ts';
import type { MissionState, ModelId, WeaponState } from '../../shared/types.ts';

export interface FlightInput { yaw: number; pitch: number; roll: number; throttle: number; boost: boolean; fire: boolean }
export const NEUTRAL_INPUT: FlightInput = { yaw: 0, pitch: 0, roll: 0, throttle: 0, boost: false, fire: false };
export interface Fighter {
  id: string; model: ModelId; team: 'republic' | 'separatist'; position: THREE.Vector3; previous: THREE.Vector3;
  rotation: THREE.Quaternion; speed: number; health: number; maxHealth: number; radius: number;
  weapon: WeaponState; cooldown: number; evadingUntil: number; phase: number; invulnerable: number;
}
export interface Bolt { id: number; team: Fighter['team']; owner: string; position: THREE.Vector3; previous: THREE.Vector3; velocity: THREE.Vector3; life: number; damage: number }
export type WorldEvent = { type: 'explosion' | 'impact' | 'player-hit' | 'shot'; position: THREE.Vector3; enemy: boolean };
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
  readonly player: Fighter;
  readonly fighters: Fighter[];
  readonly bolts: Bolt[] = [];
  readonly events: WorldEvent[] = [];
  mission: MissionState = createMission(MISSION_CONFIG);
  carrierHealth = 1000;
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

  constructor(carrier: THREE.Object3D) {
    this.carrier = carrier;
    carrier.updateMatrixWorld(true);
    this.carrierBounds = new THREE.Box3().setFromObject(carrier);
    this.player = fighter('player', 'eta2', 'republic', new THREE.Vector3(110, 95, 300), 100);
    this.fighters = [this.player,
      fighter('wing-1', 'arc170', 'republic', new THREE.Vector3(68, 99, 255), 160),
      fighter('wing-2', 'arc170', 'republic', new THREE.Vector3(152, 99, 255), 160)];
  }

  get enemies() { return this.fighters.filter(f => f.team === 'separatist' && f.health > 0); }
  get target() { return this.enemies.find(f => f.id === this.targetId) ?? null; }
  get terminal() { return this.mission.phase === 'won' || this.mission.phase === 'lost'; }
  forward(f: Fighter) { return FORWARD.clone().applyQuaternion(f.rotation); }

  selectNext() {
    const enemies = this.enemies.sort((a, b) => a.position.distanceToSquared(this.player.position) - b.position.distanceToSquared(this.player.position));
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
    if (!this.ray.ray.intersectsBox(this.carrierBounds)) return null;
    return this.ray.intersectObject(this.carrier, true)[0] ?? null;
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
    this.updateBolts(dt);
    const destroyed = this.fighters.filter(f => f.id !== 'player' && f.health <= 0);
    for (const f of destroyed) {
      this.events.push({ type: 'explosion', position: f.position.clone(), enemy: f.team === 'separatist' });
      this.fighters.splice(this.fighters.indexOf(f), 1);
    }
    if (this.focusId && !this.enemies.some(f => f.id === this.focusId)) { this.focusId = null; this.wingOrder = 'guard'; }
    const result = advanceMission(this.mission, dt, {
      playerAlive: this.player.health > 0, carrierAlive: this.carrierHealth > 0,
      destroyedEnemyIds: destroyed.filter(f => f.team === 'separatist').map(f => f.id),
    }, MISSION_CONFIG);
    const oldPhase = this.mission.phase;
    this.mission = result.state;
    for (const event of result.events) {
      if (event.type === 'spawn-wave') {
        event.enemyIds.forEach((id, i) => {
          const f = fighter(id, 'vulture', 'separatist', new THREE.Vector3(-180 + i * 140, 120 + i * 25, -700 - i * 65), 72);
          f.rotation.setFromAxisAngle(Y, Math.PI); f.phase = i + event.waveIndex; f.cooldown = i * 0.4;
          this.fighters.push(f);
        });
        this.message = `敌机第 ${event.waveIndex + 1} 波！优先保护守望号。`;
      }
    }
    if (oldPhase !== this.mission.phase && this.mission.phase === 'intermission') this.message = '当前空域已清理。下一波机群正在接近。';
    if (!this.target) { this.targetId = null; if (this.enemies.length) this.selectNext(); }
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
    if (p.position.length() > 2350) {
      const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(), p.position.clone().negate(), Y);
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
    const enemy = f.team === 'separatist';
    let target: Fighter | null = null;
    let destination: THREE.Vector3;
    let shootingCarrier = false;
    if (enemy) {
      shootingCarrier = Math.floor(f.phase) % 3 !== 0;
      target = shootingCarrier ? null : this.player;
      destination = shootingCarrier ? WEAK_POINT.clone() : this.player.position.clone();
      if (f.position.distanceTo(destination) < (shootingCarrier ? 180 : 95)) f.evadingUntil = this.time + 4;
      if (this.time < f.evadingUntil) destination = new THREE.Vector3((f.phase % 2 ? -1 : 1) * 600, 180 + Math.sin(f.phase) * 40, -250);
    } else {
      const enemies = this.enemies;
      target = (this.wingOrder === 'focus' ? enemies.find(e => e.id === this.focusId) : null) ?? enemies.sort((a, b) => a.position.distanceToSquared(f.position) - b.position.distanceToSquared(f.position))[0] ?? null;
      const formation = new THREE.Vector3(f.id === 'wing-1' ? -42 : 42, 4, -45).applyQuaternion(this.player.rotation).add(this.player.position);
      destination = target && this.wingOrder !== 'follow' ? target.position.clone() : formation;
      f.speed = target && this.wingOrder !== 'follow' ? 130 : THREE.MathUtils.clamp(this.player.speed + formation.clone().sub(f.position).dot(this.forward(this.player)) * 1.5, 65, 200);
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
    const hit = this.hullHit(f.previous, f.position, f.radius);
    if (!hit) return;
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? Y.clone();
    f.position.copy(hit.point).addScaledVector(normal, f.radius + 2);
    const direction = this.forward(f).reflect(normal).addScaledVector(normal, 0.6).normalize();
    f.rotation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, Y));
    if (f.invulnerable <= 0) {
      f.health = applyDamage(f.health, f.id === 'player' ? 24 : 10); f.invulnerable = 0.9;
      this.events.push({ type: 'impact', position: hit.point.clone(), enemy: false });
      if (f.id === 'player') { this.hitFlash = 1; this.message = '舰体碰撞！注意保持安全距离。'; }
    }
  }

  private shoot(f: Fighter, direction: THREE.Vector3, damage: number) {
    if (this.bolts.length >= 192) return;
    const position = this.muzzlePosition(f);
    this.bolts.push({ id: ++this.boltSequence, owner: f.id, team: f.team, position, previous: position.clone(), velocity: direction.clone().multiplyScalar(PROJECTILE_SPEED), life: PROJECTILE_LIFETIME, damage });
  }

  private updateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!;
      bolt.previous.copy(bolt.position); bolt.position.addScaledVector(bolt.velocity, dt); bolt.life -= dt;
      let firstT = Infinity;
      let victim: Fighter | null = null;
      for (const f of this.fighters) {
        if (f.team === bolt.team || f.health <= 0) continue;
        const start = bolt.previous.clone().sub(f.previous);
        const end = bolt.position.clone().sub(f.position);
        const t = segmentSphere(start, end, new THREE.Vector3(), f.radius + (bolt.owner === 'player' ? 2.2 : 0.2));
        if (t !== null && t < firstT) { firstT = t; victim = f; }
      }
      const hull = this.hullHit(bolt.previous, bolt.position);
      const segmentLength = bolt.previous.distanceTo(bolt.position);
      if (hull && hull.distance / segmentLength < firstT) {
        if (bolt.team === 'separatist' && hull.point.distanceTo(WEAK_POINT) < 105) this.carrierHealth = applyDamage(this.carrierHealth, bolt.damage * 1.2);
        this.events.push({ type: 'impact', position: hull.point.clone(), enemy: bolt.team === 'separatist' });
        bolt.life = 0;
      } else if (victim) {
        victim.health = applyDamage(victim.health, bolt.damage); bolt.life = 0;
        this.events.push({ type: 'impact', position: bolt.previous.clone().lerp(bolt.position, firstT), enemy: victim.team === 'separatist' });
        if (bolt.owner === 'player') this.hitConfirm = 1;
        if (victim.id === 'player') { this.hitFlash = 1; this.events.push({ type: 'player-hit', position: victim.position.clone(), enemy: true }); }
      }
      if (bolt.life <= 0) this.bolts.splice(i, 1);
    }
  }
}
