import * as THREE from 'three';
import type {FlightWorld} from './world.ts';

/** Bounded instanced exterior effects; all resources owned and disposed with FlightScene. */
export class CapitalDamageEffects {
  readonly root = new THREE.Group();
  readonly deathAges = [0,0];
  private flames = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:0xff9d40,transparent:true,opacity:.75,depthWrite:false,blending:THREE.AdditiveBlending}),12);
  private smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:0x53616a,transparent:true,opacity:.32,depthWrite:false}),12);
  private wrecks = new THREE.InstancedMesh(new THREE.BoxGeometry(19,5,24),new THREE.MeshStandardMaterial({color:0x302c2b,roughness:1}),12);
  private rings: THREE.Mesh[]=[];
  private dummy=new THREE.Object3D();
  constructor(){
    for(const mesh of [this.flames,this.smoke,this.wrecks]){mesh.frustumCulled=false;mesh.count=0;this.root.add(mesh);}
    for(let i=0;i<2;i++){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1,.012,4,48),new THREE.MeshBasicMaterial({color:0x7ccaff,transparent:true,opacity:.6,depthWrite:false,blending:THREE.AdditiveBlending}));
      ring.rotation.x=Math.PI/2;ring.visible=false;this.root.add(ring);this.rings.push(ring);
    }
  }
  update(world:FlightWorld,dt:number){
    let fires=0,wrecks=0;
    const active=world.stage!=='defense'&&world.stage!=='arrival';
    for(const [index,ship] of world.capitalShips.entries()){
      this.deathAges[index]=ship.destroyed?this.deathAges[index]!+dt:0;
      const age=this.deathAges[index]!;
      const ring=this.rings[index]!;
      ring.visible=active&&ship.launchTime>=0&&ship.launchTime<1.2&&!ship.destroyed;
      ring.position.copy(world.shieldCenterFor(ship));ring.scale.setScalar(210+ship.launchTime*240);
      (ring.material as THREE.MeshBasicMaterial).opacity=Math.max(0,.65*(1-ship.launchTime/1.2));
      if(!active||ship.destroyed&&age>=4)continue;
      for(const gun of ship.guns)if(gun.health<=0&&!ship.destroyed){
        this.dummy.position.copy(gun.position).add(new THREE.Vector3(0,-4,0));this.dummy.rotation.set(.12,.4,.2);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.wrecks.setMatrixAt(wrecks++,this.dummy.matrix);
      }
      const count=ship.destroyed?Math.min(6,1+Math.floor(age/.35)):ship.bridge.health/ship.bridge.maxHealth<.65?Math.ceil((1-ship.bridge.health/ship.bridge.maxHealth)*3):0;
      for(let j=0;j<count;j++){
        const base=j===0?ship.bridge.position:ship.guns[j]!.position;
        const pulse=.85+.15*Math.sin(world.time*11+j*4+age*9),size=ship.destroyed?22+age*12:9+j*2;
        this.dummy.position.copy(base).add(new THREE.Vector3(0,size*.6,0));this.dummy.rotation.set(.2,j*.7,.1);this.dummy.scale.set(size*.5*pulse,size*pulse,size*.5);this.dummy.updateMatrix();this.flames.setMatrixAt(fires,this.dummy.matrix);
        this.dummy.position.y+=size*(1.1+(world.time*.25+j)%1);this.dummy.scale.set(size*.8,size*1.1,size*.8);this.dummy.updateMatrix();this.smoke.setMatrixAt(fires++,this.dummy.matrix);
      }
    }
    this.flames.count=this.smoke.count=fires;this.wrecks.count=wrecks;
    for(const mesh of [this.flames,this.smoke,this.wrecks])mesh.instanceMatrix.needsUpdate=true;
  }
  reset(){this.deathAges.fill(0);this.flames.count=this.smoke.count=this.wrecks.count=0;for(const ring of this.rings)ring.visible=false;}
  dispose(){for(const mesh of [this.flames,this.smoke,this.wrecks])mesh.dispose();}
  diagnostics(){return{fires:this.flames.count,wrecks:this.wrecks.count,deathAges:[...this.deathAges]};}
}
