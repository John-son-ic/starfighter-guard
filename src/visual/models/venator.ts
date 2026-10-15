import { Group } from 'three';
import { box, cylinder, finalize, nozzle, palette, plate, wedge } from './primitives.ts';

export function createVenatorModel(): Group {
  const g = new Group();
  const p = palette();
  const hull = [[0, -577.5], [32, -486], [270, 282], [264, 398], [222, 442], [205, 503], [-205, 503], [-222, 442], [-264, 398], [-270, 282], [-32, -486]] as const;
  wedge(g, p.trim, hull, 38, -5);
  wedge(g, p.hull, hull.map(([x, z]) => [x * 0.985, z * 0.995]), 24, 9);
  const upper = [[0, -540], [25, -455], [229, 263], [205, 367], [121, 405], [-121, 405], [-205, 367], [-229, 263], [-25, -455]] as const;
  plate(g, p.light, upper, 17, 19);
  // Long red split hangar doors; dark seam intentionally remains visible.
  plate(g, p.red, [[-6, -473], [-17, -400], [-27, 117], [-2, 117], [-2, -473]], 1.8, 28);
  plate(g, p.red, [[6, -473], [17, -400], [27, 117], [2, 117], [2, -473]], 1.8, 28);
  box(g, p.dark, [3, 1, 568], [0, 28.5, -165]);
  box(g, p.trim, [65, 8, 35], [0, 30, 135]);
  // Stepped aft command superstructure.
  plate(g, p.hull, [[-64, 90], [64, 90], [117, 365], [-117, 365]], 27, 39);
  plate(g, p.light, [[-48, 143], [48, 143], [83, 340], [-83, 340]], 19, 60);
  box(g, p.red, [17, 2, 186], [0, 70, 243]);
  for (const side of [-1, 1]) {
    box(g, p.trim, [25, 54, 38], [side * 46, 94, 312], [0, 0, side * -0.07]);
    plate(g, p.hull, [[side * 24, 257], [side * 74, 278], [side * 82, 333], [side * 21, 333]], 20, 128);
    box(g, p.glass, [43, 6, 1.5], [side * 48, 128, 266], [0, side * -0.35, 0]);
    box(g, p.dark, [16, 17, 151], [side * 252, -1, 312]);
    box(g, p.glass, [1.2, 6, 125], [side * 261, -1, 314]);
    // Red aft panels and small deck structures read at close range, without greeble overload.
    plate(g, p.red, [[side * 111, 300], [side * 185, 340], [side * 174, 376], [side * 113, 354]], 1, 28);
    for (let i = 0; i < 7; i++) {
      const z = -190 + i * 72;
      const x = side * (55 + i * 14);
      box(g, i % 2 ? p.trim : p.hull, [17 + i * 2, 1.4, 34], [x, 28, z], [0, side * -0.27, 0]);
    }
    for (let i = 0; i < 4; i++) {
      const x = side * (106 + i * 15);
      const z = 130 + i * 59;
      cylinder(g, p.trim, 12, 8, [x, 31, z]).rotation.x = Math.PI / 2;
      box(g, p.hull, [17, 7, 18], [x, 37, z]);
      for (const barrel of [-1, 1]) cylinder(g, p.dark, 1.7, 22, [x + barrel * 4, 39, z - 14]);
    }
    cylinder(g, p.trim, 23, 40, [side * 139, -1, 511]);
    cylinder(g, p.trim, 17, 40, [side * 194, -9, 504]);
    cylinder(g, p.trim, 11, 30, [side * 70, -16, 502]);
    nozzle(g, p, 25, 58, [side * 139, -1, 548.5]);
    nozzle(g, p, 18, 48, [side * 194, -9, 534]);
    nozzle(g, p, 12, 31, [side * 70, -16, 529]);
  }
  cylinder(g, p.trim, 25, 40, [0, -9, 511]);
  nozzle(g, p, 27, 58, [0, -9, 548.5]);
  return finalize(g, 'venator', 1155);
}
