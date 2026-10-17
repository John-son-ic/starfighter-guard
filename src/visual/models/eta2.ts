import { Box3, Group, Vector3 } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';
import { strut } from './venator-geometry.ts';

export function createEta2Model(): Group {
  const g = new Group();
  const p = palette();
  ellipsoid(g, p.dark, [0.76, 0.67, 1.02], [0, 0, 0.2]);
  ellipsoid(g, p.glass, [0.66, 0.58, 0.87], [0, 0.23, 0.13]);
  box(g, p.hull, [0.11, 0.05, 1.65], [0, 0.79, 0.2]);
  box(g, p.hull, [1.24, 0.07, 0.12], [0, 0.55, -0.41]);
  // Framing follows the glass ellipsoid, leaving the viewing panes visible.
  for (const z of [-0.39, 0.54]) {
    const r = Math.sqrt(1 - ((z - 0.13) / 0.87) ** 2);
    for (let i = 0; i < 10; i++) {
      const point = (a: number) => new Vector3(Math.cos(a) * 0.675 * r, 0.23 + Math.sin(a) * 0.595 * r, z);
      strut(g, p.hull, point(i * Math.PI / 10), point((i + 1) * Math.PI / 10), 0.042);
    }
  }
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
    // Raised maintenance panels and inset-looking seams on the forked wings.
    for (let i = 0; i < 5; i++) {
      const z = -2.3 + i * 0.57;
      const x = 0.83 + i * 0.105;
      box(g, p.trim, [0.27 + i * 0.075, 0.018, 0.025], [s * x, -0.119, z]);
      box(g, p.hull, [0.09, 0.025, 0.12], [s * (x + 0.1), -0.105, z + 0.12]);
    }
    for (let i = 0; i < 6; i++) {
      box(g, p.trim, [0.15, 0.025, 0.43], [s * (2.12 + (i - 2.5) * 0.012), 0.09 + i * 0.056, 0.53], [0, 0, s * -0.22]);
      box(g, p.trim, [0.25, 0.025, 0.035], [s * 1.31, -0.04, 0.48 + i * 0.1]);
    }
    // Exhaust collars and cooling ribs are visible from the gameplay camera.
    for (let i = 0; i < 4; i++) cylinder(g, p.hull, 0.295, 0.045, [s * 0.9, -0.18, 1.4 + i * 0.15]);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      box(g, p.trim, [0.045, 0.045, 0.35], [s * 0.9 + Math.cos(angle) * 0.29, -0.18 + Math.sin(angle) * 0.29, 2.38], [0, 0, angle]);
    }
    cylinder(g, p.dark, 0.09, 0.14, [s * 0.61, -0.12, -2.62]);
    cylinder(g, p.trim, 0.105, 0.04, [s * 0.61, -0.12, -2.68]);
    box(g, p.red, [0.12, 0.025, 0.18], [s * 1.8, -0.145, 0.8]);
  }
  cylinder(g, p.hull, 0.19, 0.34, [-1.36, 0.03, -0.3]).rotation.x = Math.PI / 2;
  ellipsoid(g, p.blue, [0.2, 0.16, 0.2], [-1.36, 0.23, -0.3]);
  box(g, p.glass, [0.08, 0.065, 0.035], [-1.36, 0.29, -0.48]);
  const bounds = new Box3().setFromObject(g);
  const center = bounds.getCenter(new Vector3());
  const scale = 5.47 / bounds.getSize(new Vector3()).z;
  const mounts = [-1, 1].map(side => new Vector3(side * 0.9, -0.18, 2.3 + 0.87 * 0.53).sub(center).multiplyScalar(scale).toArray());
  const result = finalize(g, 'eta2', 5.47);
  result.userData.engineMounts = mounts;
  return result;
}
