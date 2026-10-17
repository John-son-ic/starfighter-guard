import {createMunificentModel} from '../../visual/models/munificent.ts';
import { PlayerExhaust } from './exhaust.ts';
import * as THREE from 'three';
import { MODEL_CATALOG } from '../../visual/models/index.ts';
import { disposeModel } from '../../visual/models/primitives.ts';
import { FlightWorld, WEAK_POINT, CAPITAL_ROLES, isEnemyGun } from './world.ts';
import type { Fighter, WorldEvent } from './world.ts';
import { createVenatorModel } from '../../visual/models/venator.ts';
import { createCarrierTurret } from '../../visual/models/carrier-turret.ts';
import { safeChaseCamera } from './camera.ts';
import { CapitalDamageEffects } from './capital-effects.ts';

export class FlightScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.4, 14000);
  readonly renderer: THREE.WebGLRenderer;
  readonly carrier = createVenatorModel(false,true);
  readonly frigate = createMunificentModel(false);
  readonly secondFrigate = createMunificentModel(false);
  private secondEffects!: {barrier: THREE.Mesh; particles: THREE.Points; relay: THREE.Mesh; bridge: THREE.Mesh};
  private barrier = new THREE.Mesh(new THREE.SphereGeometry(1,32,20),new THREE.ShaderMaterial({uniforms:{time:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:'varying vec3 n; varying vec3 v; varying vec3 p; void main(){vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-mv.xyz);p=position;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float time;varying vec3 n;varying vec3 v;varying vec3 p;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.);float wave=pow(.5+.5*sin(p.y*65.-time*2.),18.);gl_FragColor=vec4(.22,.58,1.,.025+rim*.22+wave*.055);}'}));
  private shieldParticles: THREE.Points;
  private relay = new THREE.Mesh(new THREE.SphereGeometry(28,12,8),new THREE.MeshBasicMaterial({color:0xffa84d,wireframe:true}));
  private bridgeBeacon = new THREE.Mesh(new THREE.SphereGeometry(44,12,8),new THREE.MeshBasicMaterial({color:0xff6655,wireframe:true}));
  private enemyHeads: THREE.Group[] = [];
  private enemyFlashes: THREE.Mesh[] = [];
  private turretHeads: THREE.Group[] = [];
  private turretFlashes: THREE.Mesh[] = [];
  private turretBases: THREE.InstancedMesh;
  private collisionVersion = -1;
  private ships = new Map<string, THREE.Group>();
  private republicBolts: THREE.InstancedMesh;
  private enemyBolts: THREE.InstancedMesh;
  private flashes: { mesh: THREE.Mesh; life: number; duration: number; size: number }[] = [];
  private flashPool: THREE.Mesh[] = [];
  private flashGeometry = new THREE.IcosahedronGeometry(1, 1);
  private dummy = new THREE.Object3D();
  private playerShield = new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0}},
    vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float time;varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.);gl_FragColor=vec4(.25,.8,1.,.015+rim*(.32+.04*sin(time*8.)));}'}));
  private ready = false;
  private exhaust = new PlayerExhaust();
  private capitalEffects = new CapitalDamageEffects();

  constructor(viewport: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', '余烬航道三维飞行场景');
    viewport.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x030a13);
    this.scene.add(new THREE.HemisphereLight(0xb7d8ee, 0x152638, 1.3));
    const light = new THREE.DirectionalLight(0xffedcf, 2.8); light.position.set(-1600, 2200, -900); this.scene.add(light);
    const rim = new THREE.DirectionalLight(0x436c9c, 1.2); rim.position.set(600, -500, 1200); this.scene.add(rim);
    this.scene.add(this.playerShield,this.capitalEffects.root);
    this.scene.add(this.carrier, this.exhaust.root,this.frigate,this.barrier,this.relay,this.bridgeBeacon);
    const particlePositions=new Float32Array(900*3);
    for(let i=0;i<900;i++){const y=1-2*(i+.5)/900,a=i*2.399963,r=Math.sqrt(1-y*y);particlePositions.set([r*Math.cos(a)*260,y*150,r*Math.sin(a)*470],i*3);}
    const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
    this.shieldParticles=new THREE.Points(particleGeometry,new THREE.PointsMaterial({color:0x8ad8ff,size:3,transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending}));this.scene.add(this.shieldParticles);
    this.secondEffects={barrier:this.barrier.clone(),particles:this.shieldParticles.clone(),relay:this.relay.clone(),bridge:this.bridgeBeacon.clone()};
    this.scene.add(this.secondFrigate,...Object.values(this.secondEffects));
    const flashGeometry=new THREE.SphereGeometry(1,8,6);
    const flashMaterial=new THREE.MeshBasicMaterial({color:0x9affb7});
    this.turretBases=new THREE.InstancedMesh(new THREE.CylinderGeometry(9,11,4,16),new THREE.MeshStandardMaterial({color:0x737775,roughness:0.8}),8);
    this.scene.add(this.turretBases);
    for(let i=0;i<8;i++) {
      const head=createCarrierTurret(); this.scene.add(head);this.turretHeads.push(head);
      const flash=new THREE.Mesh(flashGeometry,flashMaterial);flash.scale.setScalar(3);flash.visible=false;this.scene.add(flash);this.turretFlashes.push(flash);
    }
    for(let i=0;i<12;i++){
      const head=createCarrierTurret();head.scale.setScalar(.55);this.scene.add(head);this.enemyHeads.push(head);
      const flash=new THREE.Mesh(flashGeometry,new THREE.MeshBasicMaterial({color:0xff6740}));flash.scale.setScalar(4);this.scene.add(flash);this.enemyFlashes.push(flash);
    }
    const starPositions = new Float32Array(2400 * 3);
    for (let i = 0; i < 2400; i++) {
      const u = ((i * 0.61803398875) % 1) * Math.PI * 2;
      const v = Math.acos(2 * ((i * 0.754877666) % 1) - 1);
      const r = 6000 + (i % 7) * 600;
      starPositions.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
    }
    const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xb6ccdf, size: 2.3, sizeAttenuation: false, transparent: true, opacity: 0.65 })));
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 32), new THREE.MeshStandardMaterial({ color: 0x254c68, roughness: 1, metalness: 0, emissive: 0x071321, emissiveIntensity: 0.5 }));
    planet.position.set(-4200, -2300, -4800); this.scene.add(planet);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1920, 48, 32), new THREE.MeshBasicMaterial({ color: 0x4789aa, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false }));
    atmosphere.position.copy(planet.position); this.scene.add(atmosphere);
    const boltGeometry = new THREE.BoxGeometry(0.18, 0.18, 11);
    this.republicBolts = new THREE.InstancedMesh(boltGeometry, new THREE.MeshBasicMaterial({ color: 0x71d9ff }), 192);
    this.enemyBolts = new THREE.InstancedMesh(boltGeometry, new THREE.MeshBasicMaterial({ color: 0xff6049 }), 192);
    this.republicBolts.frustumCulled = false; this.enemyBolts.frustumCulled = false;
    this.scene.add(this.republicBolts, this.enemyBolts);
    const beacon = new THREE.Mesh(new THREE.TorusGeometry(24, 0.45, 4, 32), new THREE.MeshBasicMaterial({ color: 0xe4b05c, transparent: true, opacity: 0.6 }));
    beacon.position.copy(WEAK_POINT).add(new THREE.Vector3(0, 18, 0)); beacon.rotation.x = Math.PI / 2; this.scene.add(beacon);
  }

  resize(width: number, height: number, low: boolean) {
    this.renderer.setPixelRatio(low ? 0.75 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  consume(events: readonly WorldEvent[]) {
    for (const event of events) {
      if (event.type !== 'impact' && event.type !== 'explosion') continue;
      if (this.flashes.length >= 40) break;
      const duration = event.type === 'explosion' ? 0.8 : 0.2;
      const mesh = this.flashPool.pop() ?? new THREE.Mesh(this.flashGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
      (mesh.material as THREE.MeshBasicMaterial).color.set(event.enemy ? 0xffa15b : 0x89ccf2);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
      mesh.scale.setScalar(0.2);
      mesh.position.copy(event.position); this.scene.add(mesh);
      this.flashes.push({ mesh, life: event.size ? duration * .6 : duration, duration, size: event.size ?? (event.type === 'explosion' ? 17 : 3) });
    }
  }

  render(world: FlightWorld, dt: number, interpolation = 1) {
    this.capitalEffects.update(world,dt);
    for(const [index,ship] of world.capitalShips.entries()) {
      const model=index===0?this.frigate:this.secondFrigate;
      const fx=index===0?{barrier:this.barrier,particles:this.shieldParticles,relay:this.relay,bridge:this.bridgeBeacon}:this.secondEffects;
      const deathAge=this.capitalEffects.deathAges[index]!;
      model.visible=world.stage!=='defense'&&(!ship.destroyed||deathAge<4);
      model.position.copy(ship.position);
      model.rotation.z=ship.destroyed?deathAge*.05:0;
      if(ship.destroyed)model.position.y-=deathAge*18;
      model.traverse(o=>{if(o instanceof THREE.Mesh){const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials){if(m.transparent!==ship.destroyed){m.transparent=ship.destroyed;m.needsUpdate=true;}m.opacity=ship.destroyed?Math.max(0,1-deathAge/4):1;}}});
      if(world.stage==='arrival')model.position.z-=Math.pow(1-world.stageTime/4,3)*14000;
      model.scale.set(1,1,world.stage==='arrival'?1+(1-world.stageTime/4)*3:1);model.updateMatrixWorld(true);
      fx.barrier.visible=fx.particles.visible=model.visible&&!ship.destroyed&&world.stage!=='arrival'&&ship.generator.health>0;
      fx.barrier.position.copy(world.shieldCenterFor(ship));fx.barrier.scale.copy(world.shieldRadii);
      fx.particles.position.copy(world.shieldCenterFor(ship));
      (fx.particles.material as THREE.PointsMaterial).opacity=.5+.15*Math.sin(world.time*3);
      (fx.barrier.material as THREE.ShaderMaterial).uniforms.time!.value=world.time;
      fx.relay.visible=model.visible&&world.stage!=='arrival'&&ship.generator.health>0;fx.relay.position.copy(ship.generator.position);
      fx.bridge.visible=model.visible&&!ship.destroyed&&world.stage!=='arrival'&&ship.generator.health<=0;fx.bridge.position.copy(ship.bridge.position);
    }
    for(let i=0;i<2;i++){const door=this.carrier.getObjectByName('hangar-door-'+i);if(door)door.position.x=(i===0?-1:1)*world.hangarOpen*48;}
    this.carrier.updateMatrixWorld(true);
    for (const [id, group] of this.ships) {
      if (!world.fighters.some(f => f.id === id)) { this.scene.remove(group); disposeModel(group); this.ships.delete(id); }
    }
    for (const f of world.fighters) {
      let model = this.ships.get(f.id);
      if (!model) { model = MODEL_CATALOG[f.model].factory(); this.ships.set(f.id, model); this.scene.add(model); }
      model.position.copy(f.previous).lerp(f.position, interpolation); model.quaternion.copy(f.rotation);
      model.visible = f.health > 0;
      if (f.id === 'player') this.exhaust.update(model, world.boosting && !world.terminal, f.health > 0, dt, world.time);
    }
    const playerModel = this.ships.get('player');
    this.playerShield.visible = world.playerShieldActive && !world.terminal;
    if (playerModel) {this.playerShield.position.copy(playerModel.position);this.playerShield.quaternion.copy(playerModel.quaternion);}
    this.playerShield.scale.set(5.5,3.5,5.5);
    this.playerShield.material.uniforms.time!.value=world.time;
    let republic = 0; let enemy = 0;
    for (const bolt of world.bolts) {
      this.dummy.position.copy(bolt.previous).lerp(bolt.position, interpolation);
      this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), bolt.velocity.clone().normalize());
      this.dummy.scale.set(bolt.owner.startsWith('turret-')?2.8:1, bolt.owner.startsWith('turret-')?2.8:1, bolt.owner.startsWith('turret-')?2.2:1); if (bolt.targetId) this.dummy.scale.set(5, 5, 1.5); if(bolt.capital)this.dummy.scale.set(5,5,8); this.dummy.updateMatrix();
      if (bolt.team === 'republic') this.republicBolts.setMatrixAt(republic++, this.dummy.matrix);
      else this.enemyBolts.setMatrixAt(enemy++, this.dummy.matrix);
    }
    this.republicBolts.count = republic; this.enemyBolts.count = enemy;
    this.republicBolts.instanceMatrix.needsUpdate = true; this.enemyBolts.instanceMatrix.needsUpdate = true;
    world.turrets.forEach((turret,i)=>{
      const head=this.turretHeads[i]!;head.position.copy(turret.position);
      head.rotation.y=Math.atan2(-turret.direction.x,-turret.direction.z);
      head.getObjectByName('barrels')!.rotation.x=Math.asin(THREE.MathUtils.clamp(turret.direction.y,-1,1));
      this.dummy.position.copy(turret.position);this.dummy.position.y-=5;this.dummy.quaternion.identity();this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.turretBases.setMatrixAt(i,this.dummy.matrix);
      const flash=this.turretFlashes[i]!;flash.position.copy(turret.position).addScaledVector(turret.direction,38);flash.visible=turret.flash>0;
    });
    this.turretBases.instanceMatrix.needsUpdate=true;
    world.enemyGuns.forEach((gun,i)=>{
      const head=this.enemyHeads[i]!,flash=this.enemyFlashes[i]!;
      head.visible=world.stage!=='defense'&&world.stage!=='arrival'&&world.stage!=='destroyed'&&gun.health>0;
      head.position.copy(gun.position);head.rotation.y=Math.atan2(-gun.direction.x,-gun.direction.z);
      head.getObjectByName('barrels')!.rotation.x=Math.asin(THREE.MathUtils.clamp(gun.direction.y,-1,1));
      flash.visible=head.visible&&gun.flash>0;flash.position.copy(gun.position).addScaledVector(gun.direction,30);
    });
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!; flash.life -= dt;
      flash.mesh.scale.setScalar(flash.size * (1 - flash.life / flash.duration) + 0.2);
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, flash.life / flash.duration);
      if (flash.life <= 0) { this.scene.remove(flash.mesh); this.flashPool.push(flash.mesh); this.flashes.splice(i, 1); }
    }
    const p = world.player;
    const targetUp = new THREE.Vector3(0, 1, 0).applyQuaternion(p.rotation);
    const desired = safeChaseCamera(world,new THREE.Vector3(0, 4.8, 22).applyQuaternion(p.rotation).add(p.position));
    if(this.collisionVersion!==world.playerCollisionVersion){this.ready=false;this.collisionVersion=world.playerCollisionVersion;}
    if (!this.ready) { this.camera.position.copy(desired); this.camera.up.copy(targetUp); }
    else if (dt > 0) {
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
      this.camera.up.lerp(targetUp, 1 - Math.exp(-dt * 7)).normalize();
      const cameraHit = world.hullHit(p.position, this.camera.position);
      if (cameraHit || this.camera.position.distanceTo(p.position)<p.radius+6) this.camera.position.copy(desired);
    }
    this.camera.lookAt(p.position.clone().addScaledVector(world.forward(p), 100));
    this.camera.updateMatrixWorld(); this.ready = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.dataset.ready = 'true';
  }

  project(position: THREE.Vector3) {
    const projected = position.clone().project(this.camera);
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)) return { x: 0.5, y: 1.5, visible: false, behind: false };
    return { x: (projected.x + 1) / 2, y: (-projected.y + 1) / 2, visible: projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.96 && Math.abs(projected.y) < 0.84, behind: projected.z > 1 };
  }

  reset() {
    this.capitalEffects.reset();
    this.exhaust.reset();
    for (const group of this.ships.values()) { this.scene.remove(group); disposeModel(group); }
    this.ships.clear();
    for (const flash of this.flashes) { this.scene.remove(flash.mesh); this.flashPool.push(flash.mesh); }
    this.flashes.length = 0; this.ready = false; this.collisionVersion=-1;
  }

  dispose() {
    this.reset();
    this.scene.remove(this.exhaust.root); this.exhaust.dispose();
    const geometry = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometry.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    this.flashGeometry.dispose();
    for (const mesh of this.flashPool) (mesh.material as THREE.Material).dispose();
    this.flashPool.length = 0;
    this.capitalEffects.dispose();
    this.republicBolts.dispose(); this.enemyBolts.dispose(); this.turretBases.dispose();
    geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.renderer.dispose();
  }

  diagnostics() {
    return { capitalEffects:this.capitalEffects.diagnostics(), exhaust: this.exhaust.intensity, camera: this.camera.position.toArray(), up: this.camera.up.toArray(), pixelRatio: this.renderer.getPixelRatio(), geometries: this.renderer.info.memory.geometries, drawCalls: this.renderer.info.render.calls, activeEffects: this.flashes.length, pooledEffects: this.flashPool.length };
  }
}

export function fighterLabel(f: Fighter) {
  if(isEnemyGun(f)) return CAPITAL_ROLES[f.shipIndex as 0 | 1].name+' '+(f.heavy?'重型主炮':'近防炮')+' '+f.id.split('-').at(-1);
  if(f.id.startsWith('shield-generator')) return CAPITAL_ROLES[f.id.endsWith('-2')?1:0].name+' 护盾发生器';
  if(f.id.startsWith('frigate-bridge')) return CAPITAL_ROLES[f.id.endsWith('-2')?1:0].name+' 舰桥';
  return f.model==='ywing'?`金色 ${f.id.split('-')[1]}`:f.id === 'player' ? '绝地座机' : f.team === 'republic' ? `苍鹭 ${f.id.split('-')[1]}号` : `秃鹫 ${f.id.split('-').at(-1)}`;
}
