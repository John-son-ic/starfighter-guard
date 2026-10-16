import { CircleGeometry, CylinderGeometry, Group, MeshStandardMaterial, RingGeometry, TorusGeometry, Vector3 } from 'three';
import { box, cylinder, mesh, plate, wedge, type Finish, type HullPoint } from './primitives.ts';
import { armorBlock, loft, strut } from './venator-geometry.ts';

/** Exterior authored against the user's three-quarter Venator reference. */
export function addVenatorDetail(g: Group, p: Finish, includeTurrets = true) {
  const armor = new MeshStandardMaterial({ color: 0x94968f, roughness: 0.92, metalness: 0.18 });
  const windows = new MeshStandardMaterial({ color: 0xbad6d3, emissive: 0x6b9192, emissiveIntensity: 0.55 });
  let seed = 19016;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const block = (w: number, h: number, d: number, x: number, y: number, z: number, material = armor) => armorBlock(g, material, w, h, d, x, y, z, Math.min(1.1, h * 0.3));
  const ring = (radius: number, thickness: number, x: number, y: number, z: number, material = p.trim) => mesh(g, new TorusGeometry(radius, thickness, 6, 32), material, x, y, z);
  function machinery(x: number, y: number, z: number, w: number, d: number, count: number) {
    // Deliberately clustered assemblies with gaps, not a uniform carpet of blocks.
    for (let i = 0; i < count; i++) {
      const px = x + (random() - 0.5) * (w - 4), pz = z + (random() - 0.5) * (d - 4);
      const width = 1.4 + random() * 3, depth = 2 + random() * 6;
      block(width, 0.8 + random()*2, depth, px, y+1.1, pz, i%4===0?p.trim:armor);
      if (i%4===0) cylinder(g,p.trim,0.65,depth+3,[px+width*0.8,y+1.5,pz]);
      if (i%11===0) box(g, windows, [0.65,0.3,1.1], [px,y+2.9,pz]);
    }
  }
  function well(x: number,z: number,w: number,d: number) {
    block(w,0.8,d,x,28,z,p.dark);
    for(const side of [-1,1]) {
      block(2,2.5,d+3,x+side*(w/2+0.5),29,z,p.hull);
      block(w+3,2.5,2,x,29,z+side*(d/2+0.5),p.hull);
    }
    machinery(x,28.8,z,w-4,d-4,22);
  }

  // Paired red hangar doors with bevels, border strips, inset leaves and scuffed paint.
  for (const side of [-1,1]) {
    const outline: HullPoint[] = [[side*2,-487],[side*10,-480],[side*45,106],[side*2,106]];
    plate(g,p.trim,outline,1,28);
    for(let i=0;i<15;i++) {
      const z=-478+i*38.5, w=10.4+i*2.25;
      const shape: HullPoint[]=[[side*2,z],[side*w,z],[side*(w+2),z+36],[side*2,z+36]];
      plate(g,p.red,shape,3,29.7);
      const inset: HullPoint[]=[[side*4,z+3],[side*(w-2),z+3],[side*w,z+32],[side*4,z+32]];
      plate(g,p.red,inset,0.7,31.6);
      box(g,p.trim,[w-4,0.4,0.7],[side*(w+3)/2,32,z+4]);
      box(g,armor,[1.3,1.5,5],[side*(w+1),31,z+17]);
      for(let j=0;j<4;j++) box(g,armor,[0.4+random()*1.2,0.15,1+random()*4],[side*(4+random()*(w-4)),32.05,z+5+random()*25]);
    }
  }
  box(g,p.dark,[1.6,0.6,578],[0,31.7,-189]);

  for(const side of [-1,1]) {
    // Larger armor fields are broken into asymmetrical subplates and conduit grooves.
    for(let row=0;row<20;row++) {
      const z=-424+row*35;
      const edge=25+(z+455)*216/730;
      const inner=z<115?20+(z+455)*0.063:89+(z-115)*0.17;
      const columns=row<5?1:row<12?2:3;
      for(let col=0;col<columns;col++) {
        const a=inner+(edge-inner-7)*col/columns+1.5;
        const b=inner+(edge-inner-7)*(col+1)/columns-1.2;
        if(b-a<5) continue;
        if(z<91 && z+32.4>53 && a<103 && b>67) continue;
        const shape: HullPoint[]=[[side*a,z],[side*b,z],[side*(b+8.6),z+32.4],[side*a,z+32.4]];
        plate(g,(row+col)%7===0?armor:p.hull,shape,0.8,28.2);
        const x=side*(a+b)/2;
        const width=b-a-3;
        // Panel relief: thin raised border, small access cover and maintenance rails.
        block(Math.max(2,width*0.7),0.5,18,x,29,z+16,(row+col)%4===0?armor:p.light);
        if((row+col)%3===0) {
          box(g,p.dark,[Math.min(width,8),0.6,12],[x,29.6,z+17]);
          for(let j=0;j<5;j++) box(g,armor,[Math.min(width-1,7),0.6,0.7],[x,30,z+12+j*2]);
        } else {
          block(2,1.2,6,x+side*width*0.2,29.5,z+13,p.light);
          box(g,armor,[Math.max(2,width*0.5),0.5,0.65],[x,29.3,z+25]);
        }
        for(let chip=0;chip<3;chip++) box(g,armor,[0.3+random()*0.7,0.2,1+random()*4],[x+(random()-.5)*width,29,z+random()*30]);
      }
    }
    // Continuous mechanical belt following the hull edge, including its aft shoulder.
    for(let i=0;i<67;i++) {
      const z=-464+i*13;
      const x=z<=282?32+(z+486)*238/768:270-(z-282)*6/116;
      const h=4+(z+464)*0.016;
      block(4,h,2.4,side*(x-1.5),-4,z,p.trim).rotation.y=side*-0.3;
      for(let j=0;j<3;j++) {
        const dz=z-4+j*3.3;
        block(3+random()*3,1.5+random()*3,1.8+random()*3,side*(x-2.3),-7+j*3.6,dz,j%2?armor:p.trim);
      }
      if(i%3===0) box(g,windows,[0.65,0.7,1.3],[side*(x+0.8),-1,z]);
      if(i%5===0) cylinder(g,p.trim,1,11,[side*(x-0.5),-8,z]);
    }
    // Vertical paneling of the exposed aft edge, with relief instead of a blank black wall.
    for(let i=0;i<17;i++) {
      const z=287+i*6.3,x=269-(z-282)*6/116;
      block(2,18,3.8,side*x,-3,z,p.trim);
      block(3,5,2,side*(x+1.2),-2+(i%3)*3,z,armor);
    }
    // Framed side docking doors on both shoulders.
    const bay=new Group();g.add(bay);
    const bx=side*269;
    box(bay,p.dark,[1.2,21,58],[bx,-1,318]);
    for(const y of [-12,10]) block(5,3,64,bx,y,318,p.hull);
    for(const z of [287,349]) block(5,25,3,bx,-1,z,p.hull);
    for(let i=0;i<8;i++) {
      box(g,p.trim,[1.5,17,0.8],[bx+side*1,-1,292+i*7]);
      box(g,windows,[1.8,0.65,2],[bx+side*1.5,8,293+i*7]);
    }
    // Painted wing stripes interrupted by ribs, as in the supplied reference.
    plate(g,p.red,[[side*159,327],[side*231,350],[side*217,381],[side*150,354]],0.8,28.6);
    for(let i=0;i<5;i++) block(3.5,1,34,side*(159+i*13),29.4,350,p.hull).rotation.y=side*0.35;
    // Four main battery emplacements each side, recessed dark equipment beds and twin guns.
    for(let i=0;i<4;i++) {
      const x=side*(111+i*17),z=142+i*57;
      well(x,z,29,40);
      if(!includeTurrets)continue;
      cylinder(g,p.trim,9,3,[x,31,z]).rotation.x=Math.PI/2;
      block(17,6,18,x,35,z,p.hull);
      block(13,2,13,x,39,z+1,p.light);
      block(19,2,4,x,34,z+8,armor);
      for(const b of [-1,1]) {
        cylinder(g,p.trim,2.3,11,[x+b*4,36,z-11]);
        cylinder(g,p.dark,1.25,22,[x+b*4,36,z-26]);
        cylinder(g,armor,1.8,3,[x+b*4,36,z-34]);
      }
    }
    for(const z of [-30,40,106]) well(side*(60+(z+30)*0.17),z,17,28);
    // Wing insignia: layered painted gold disk, red perimeter and six inset spokes.
    const mx=side*85,mz=72;
    const disk=mesh(g,new CircleGeometry(15,48),p.yellow,mx,29.2,mz);disk.rotation.x=-Math.PI/2;
    const border=mesh(g,new RingGeometry(14.2,16.4,48),p.red,mx,29.35,mz);border.rotation.x=-Math.PI/2;
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      box(g,p.red,[1,0.15,4],[mx+Math.sin(a)*11,29.5,mz+Math.cos(a)*11],[0,a,0]);
    }
  }

  // Command citadel: broad chamfered base, narrower upper terrace and long twin pylons.
  loft(g,p.hull,[{y:28,outline:[[-65,105],[65,105],[115,364],[-115,364]]},{y:46,outline:[[-53,118],[53,118],[101,354],[-101,354]]}]);
  loft(g,p.light,[{y:46,outline:[[-49,146],[49,146],[83,346],[-83,346]]},{y:63,outline:[[-38,164],[38,164],[72,336],[-72,336]]}]);
  box(g,p.red,[13,0.8,161],[0,63.8,249]);
  for(const side of [-1,1]) {
    const cx=side*46;
    const section=(half:number,front:number,back:number):HullPoint[]=>[[cx-half,front],[cx+half,front],[cx+half,back],[cx-half,back]];
    loft(g,p.hull,[{y:62,outline:section(20,157,344)},{y:121,outline:section(13,294,338)}]);
    // Each side panel sits on the tapered wall; raked supports meet the tower surface.
    for(const face of [-1,1]) {
      for(let tier=0;tier<4;tier++) {
        const y=70+tier*13,front=157+(y-62)*137/59,back=344-(y-62)*6/59;
        const x=cx+face*(20-(y-62)*7/59+0.5);
        const wall=block(0.9,7,Math.max(4,back-front-5),x,y,(front+back)/2,p.trim);
        wall.rotation.z=face*0.118;
        for(let j=0;j<Math.floor((back-front)/7);j++) {
          const z=front+5+j*7;
          block(1,4,3,x+face*0.8,y,z,armor).rotation.z=face*0.118;
          if(j%3===0) box(g,windows,[1.4,0.8,2.2],[x+face*1.2,y+3.8,z]);
        }
        strut(g,p.light,new Vector3(x+face, y-5, front+3),new Vector3(x+face,y+4,Math.min(back-2,front+23)),1.2);
      }
    }
    // Mechanical strip on the forward rake, with transverse ribs and paired pipes.
    for(let i=0;i<20;i++) {
      const z=167+i*6.6, y=62+(z-157)*59/137;
      block(21,1.3,2.5,cx,y+1.8,z,p.trim).rotation.x=-0.406;
      for(const offset of [-7,7]) block(1.2,1,5,cx+offset,y+2.3,z,armor).rotation.x=-0.406;
    }
    // Faceted bridge head: forward nose, wraparound windows, sensor drum, roof pods.
    const cap:HullPoint[]=[[cx-22,263],[cx+19,263],[cx+31,282],[cx+31,331],[cx+21,343],[cx-24,343],[cx-29,328],[cx-29,279]];
    loft(g,p.trim,[{y:121,outline:cap},{y:128,outline:cap}]);
    loft(g,p.hull,[{y:128,outline:cap},{y:137,outline:cap.map(([x,z])=>[cx+(x-cx)*0.91,303+(z-303)*0.94])}]);
    for(let i=0;i<9;i++) box(g,windows,[2.7,2.5,0.7],[cx-19+i*4.1,125,262.5]);
    for(const face of [-1,1]) for(let i=0;i<10;i++) box(g,windows,[0.8,2,2.3],[cx+face*30.2,125,285+i*4.3]);
    block(30,5,26,cx,140,322,p.hull);
    for(let i=0;i<6;i++) block(24,0.8,1,cx,143,312+i*3.5,p.dark);
    cylinder(g,p.trim,9.5,7,[cx,139,285]);
    cylinder(g,p.dark,7.4,1.2,[cx,139,281]);
    ring(8.4,0.8,cx,139,280.4,armor);
    block(14,3,15,cx,139,304,p.light);
    for(const face of [-1,1]) {
      block(7,4,13,cx+face*18,139,307,armor);
      block(1.2,5,1.2,cx+face*22,141,332,p.trim);
    }
    // Aft machinery fields: long parallel wells and crosswalks.
    for(let col=0;col<6;col++) {
      const x=side*(20+col*29);
      block(22,0.8,111,x,27,434,p.dark);
      machinery(x,27.7,434,19,105,30);
      for(let i=0;i<7;i++) block(22,1,1.2,x,31,386+i*16,p.light);
      cylinder(g,p.trim,0.9,111,[x+8,31,434]);
    }
  }

  // Ventral plating follows the keel taper rather than intersecting a flat floor.
  wedge(g,p.hull,[[0,-450],[130,230],[95,434],[-95,434],[-130,230]],13,-25);
  cylinder(g,p.trim,51,6,[0,-32,244]).rotation.x=Math.PI/2;
  cylinder(g,armor,43,8,[0,-36,244]).rotation.x=Math.PI/2;
  for(const side of [-1,1]) for(let i=0;i<18;i++) {
    const z=-300+i*39,y=-25-6.5*(0.12+(z+450)/884*0.88)-0.9;
    block(12+i,1.5,29,side*(20+i*4.5),y,z,armor).rotation.x=0.0065;
  }

  function engine(x:number,y:number,r:number,end:number) {
    cylinder(g,armor,r*0.92,38,[x,y,499],r*0.8);
    const bell=new CylinderGeometry(r,r*0.8,end-514,32,1,true);bell.rotateX(Math.PI/2);mesh(g,bell,p.dark,x,y,(end+514)/2);
    for(let i=0;i<6;i++) ring(r*(0.82+i*0.031),1.15,x,y,516+i*(end-519)/6,p.trim);
    ring(r*0.91,r*0.07,x,y,end-r*0.08,armor);
    cylinder(g,p.engine,r*0.73,1,[x,y,end-3]);
    for(let i=0;i<16;i++) {
      const a=i*Math.PI/8;
      block(1.3,1.3,end-520,x+Math.cos(a)*r*0.95,y+Math.sin(a)*r*0.95,(end+520)/2,armor);
    }
  }
  for(const side of [-1,1]) {engine(side*47,-5,25,577.5);engine(side*112,-5,25,577.5);engine(side*177,-9,17,552);engine(side*210,-12,10,532);}
}
