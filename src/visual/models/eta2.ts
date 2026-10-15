import { Group } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';

export function createEta2Model(): Group {
  const g = new Group();
  const p = palette();
  ellipsoid(g, p.dark, [0.76, 0.67, 1.02], [0, 0, 0.2]);
  ellipsoid(g, p.glass, [0.66, 0.58, 0.87], [0, 0.23, 0.13]);
  box(g, p.hull, [0.11, 0.05, 1.65], [0, 0.79, 0.2]);
  box(g, p.hull, [1.24, 0.07, 0.12], [0, 0.55, -0.41]);
  for (const s of [-1, 1]) {
    plate(g, p.hull, [[s * 0.53, 1.63], [s * 2.17, 1.05], [s * 2.1, -0.56], [s * 1.03, -2.735], [s * 0.59, -2.735]], 0.16, -0.24);
    plate(g, p.yellow, [[s * 0.67, 1.46], [s * 1.64, 1.13], [s * 1.57, -0.28], [s * 0.94, -2.54], [s * 0.72, -2.54]], 0.025, -0.144);
    plate(g, p.trim, [[s * 1.96, 0.6], [s * 2.62, 0.95], [s * 2.43, -0.1], [s * 1.93, -0.55]], 0.10, -0.12);
    // Vertical heat-radiator foils give the Eta-2 its distinctive rear silhouette.
    box(g, p.yellow, [0.1, 0.68, 0.93], [s * 2.12, 0.22, 0.52], [0, 0, s * -0.22]);
    box(g, p.dark, [0.11, 0.45, 0.67], [s * 2.12, 0.24, 0.53], [0, 0, s * -0.22]);
    box(g, p.hull, [0.1, 0.45, 0.8], [s * 2.1, -0.49, 0.55], [0, 0, s * 0.22]);
    cylinder(g, p.dark, 0.07, 1.5, [s * 0.61, -0.12, -1.93]);
    cylinder(g, p.trim, 0.13, 0.43, [s * 0.61, -0.12, -1.16]);
    cylinder(g, p.trim, 0.28, 0.8, [s * 0.9, -0.18, 1.65]);
    nozzle(g, p, 0.31, 0.87, [s * 0.9, -0.18, 2.3]);
    box(g, p.dark, [0.29, 0.12, 0.74], [s * 1.31, -0.11, 0.78]);
  }
  cylinder(g, p.hull, 0.19, 0.34, [-1.36, 0.03, -0.3]).rotation.x = Math.PI / 2;
  ellipsoid(g, p.blue, [0.2, 0.16, 0.2], [-1.36, 0.23, -0.3]);
  return finalize(g, 'eta2', 5.47);
}
