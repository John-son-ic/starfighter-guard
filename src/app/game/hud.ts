import {RelayWorld} from './relay-world.ts';
import type { FlightWorld } from './world.ts';
import type { FlightScene } from './scene.ts';
import { fighterLabel } from './scene.ts';
import { isEnemyGun } from './world.ts';

interface Marker {
  root: HTMLDivElement;
  icon: HTMLElement;
  label: HTMLElement;
  distance: HTMLElement;
  health: HTMLElement;
}

function text(element: Element, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

/** Presentation-only markers. No aiming solver or combat decisions live here. */
export class TacticalHUD {
  private markers = new Map<string, Marker>();
  private home: Marker;
  private guide: SVGSVGElement;
  private guideLine: SVGLineElement;
  private hint: HTMLElement;
  private checkedId: string | null = null;
  private checkedAt = -Infinity;
  private occluded = false;

  constructor(privateLayer: HTMLElement, readout: HTMLElement, lead: HTMLElement, reticle: HTMLElement) {
    this.layer = privateLayer; this.readout = readout; this.lead = lead; this.reticle = reticle;
    this.hint = readout.querySelector('small')!;
    this.home = this.createMarker('守望号', 'home');
    this.home.root.className = 'ship-marker home-marker';
    this.guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.guide.classList.add('aim-guide'); this.guide.setAttribute('aria-hidden', 'true');
    this.guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.guide.append(this.guideLine); privateLayer.prepend(this.guide);
  }
  private layer: HTMLElement;
  private readout: HTMLElement;
  private lead: HTMLElement;
  private reticle: HTMLElement;

  private createMarker(name: string, id: string): Marker {
    const root = document.createElement('div'); root.dataset.entity = id;
    const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    const label = document.createElement('b'); label.className = 'marker-name'; label.textContent = name;
    const distance = document.createElement('small'); caption.append(label, distance);
    const track = document.createElement('div'); track.className = 'marker-health';
    const health = document.createElement('b'); track.append(health);
    root.append(icon, caption, track); this.layer.append(root);
    return { root, icon, label, distance, health };
  }

  private position(marker: Marker, point: ReturnType<FlightScene['project']>) {
    let { x, y } = point;
    if (!point.visible) {
      const dx = (x - 0.5) * (point.behind ? -1 : 1);
      const dy = (y - 0.5) * (point.behind ? -1 : 1);
      const scale = Math.max(Math.abs(dx) / 0.41, Math.abs(dy) / 0.30, 1);
      x = 0.5 + dx / scale; y = 0.5 + dy / scale;
      marker.icon.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg)`;
    } else marker.icon.style.transform = '';
    marker.root.style.left = `${x * 100}%`; marker.root.style.top = `${y * 100}%`;
    text(marker.icon, point.visible ? '' : '▴');
  }

  update(world: FlightWorld, scene: FlightScene) {
    const target = world.target;
    if (!target) { this.occluded = false; this.checkedId = null; }
    else if (target.id !== this.checkedId || world.time - this.checkedAt >= 0.1) {
      const hit = world.hullHit(world.player.position, world.targetSurface(target,world.player.position));
      this.occluded = !!hit && hit.distance < world.player.position.distanceTo(target.position) - 0.01;
      this.checkedId = target.id; this.checkedAt = world.time;
    }
    this.readout.dataset.occluded = String(this.occluded);
    this.readout.classList.toggle('blocked', this.occluded);
    text(this.readout.querySelector('#target-name')!, target ? fighterLabel(target) : '暂无目标');
    text(this.readout.querySelector('#target-distance')!, target ? `${Math.round(target.position.distanceTo(world.player.position))} m` : '—');
    text(this.hint, this.occluded ? '舰体遮挡 · 请改变攻击角度' : target ? '瞄准金色圆环 · 左键射击' : 'Tab 选择目标');
    this.lead.hidden = true; this.guide.style.display = 'none';
    this.reticle.classList.remove('aim-ready');
    if (target && !this.occluded) {
      const aim = world.interceptPoint(target);
      if (!aim) text(this.hint, '暂无有效截击点 · 接近目标');
      else {
        const point = scene.project(aim); const actual = scene.project(target.position);
        if (!actual.visible) text(this.hint, '目标在视野外 · 按箭头转向');
        else if (!point.visible) text(this.hint, '提前量在视野外 · 调整航向');
        this.lead.hidden = !point.visible;
        this.lead.style.left = `${point.x * 100}%`; this.lead.style.top = `${point.y * 100}%`;
        const aligned = world.forward(world.player).dot(aim.clone().sub(world.muzzlePosition(world.player)).normalize()) > Math.cos(0.075);
        this.reticle.classList.toggle('aim-ready', aligned && !world.player.weapon.overheated);
        if (point.visible && actual.visible) {
          this.guide.style.display = 'block';
          this.guideLine.setAttribute('x1', `${actual.x * 100}%`); this.guideLine.setAttribute('y1', `${actual.y * 100}%`);
          this.guideLine.setAttribute('x2', `${point.x * 100}%`); this.guideLine.setAttribute('y2', `${point.y * 100}%`);
        }
      }
    }
    for (const [id, marker] of this.markers) {
      if (![...world.fighters,...world.objectives,...world.exposedGuns].some(f => f.id === id)) { marker.root.remove(); this.markers.delete(id); }
    }
    for (const fighter of [...world.fighters,...world.objectives,...world.exposedGuns]) {
      if (fighter.id === 'player') continue;
      let marker = this.markers.get(fighter.id);
      if (!marker) { marker = this.createMarker(fighterLabel(fighter), fighter.id); this.markers.set(fighter.id, marker); }
      const point = scene.project(fighter.position);
      const hostile = fighter.team === 'separatist'; const selected = fighter.id === world.targetId;
      const threatened = world.threats.some(a=>a.subjectId===fighter.id);
      const kind = isEnemyGun(fighter)?(fighter.heavy?'heavy-target':'defense-target'):'';
      const className = `ship-marker ${hostile ? 'hostile' : 'friendly'} ${kind} ${threatened?'threatened':''} ${selected ? 'locked' : ''} ${selected && this.occluded ? 'blocked' : ''} ${point.visible ? '' : 'offscreen'}`;
      if (marker.root.className !== className) marker.root.className = className;
      marker.root.hidden = !hostile && !point.visible && !threatened;
      this.position(marker, point);
      const distance = fighter.position.distanceTo(world.player.position);
      text(marker.distance, ` ${Math.round(distance / (selected ? 1 : 10)) * (selected ? 1 : 10)} m`);
      marker.health.style.width = `${Math.max(0, fighter.health / fighter.maxHealth * 100)}%`;
    }
    const homePosition=world instanceof RelayWorld?(world.operation.phase==='escape'?world.extraction:world.station.position):world.carrier.position;
    text(this.home.label,world instanceof RelayWorld?(world.operation.phase==='escape'?'撤离点':'通讯中继站'):'守望号');
    const homePoint = scene.project(homePosition);
    this.home.root.hidden=world instanceof RelayWorld&&!['approach','escape'].includes(world.operation.phase);
    this.home.root.className = `ship-marker home-marker ${homePoint.visible ? '' : 'offscreen'}`;
    text(this.home.distance, ` ${Math.round(world.player.position.distanceTo(homePosition))} m`);
    this.position(this.home, homePoint);
    this.home.root.classList.toggle('threatened',world.threats.some(a=>a.subjectId==='home'));
    const purpose=this.readout.querySelector('.target-purpose');
    if(purpose) text(purpose,target?(target.id==='relay-comms'?'摧毁后停止敌机增援':target.id==='relay-control'?'摧毁后关闭空间站防御炮':target.id==='relay-core'?'摧毁后立即沿蓝色航标撤离':target.id.startsWith('relay-gun-')?'拆除近防 · 减轻抵近压力':isEnemyGun(target)?target.heavy?'拆除主炮 · 减轻母舰压力':'拆除近防 · 保护Y翼与座机':target.id.startsWith('shield-generator')?'破盾后派出 1 Y翼 + 2 护航机':target.id.startsWith('frigate-bridge')?'护航Y翼 · 重型鱼雷对舰伤害更高':''): '');
  }

  reset() {
    for (const marker of this.markers.values()) marker.root.remove();
    this.markers.clear(); this.checkedId = null; this.checkedAt = -Infinity; this.occluded = false;
  }

  dispose() { this.reset(); this.home.root.remove(); this.guide.remove(); }
}
