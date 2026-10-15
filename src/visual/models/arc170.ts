import { Group } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate, wedge } from './primitives.ts';

export function createArc170Model(): Group {
  const g = new Group();
  const p = palette();
  wedge(g, p.hull, [[0, -6.355], [0.68, -4.5], [0.82, 3.95], [0.5, 5.05], [-0.5, 5.05], [-0.82, 3.95], [-0.68, -4.5]], 1.25, 0);
  plate(g, p.red, [[0, -6.15], [0.28, -4.4], [0.32, 3.9], [-0.32, 3.9], [-0.28, -4.4]], 0.05, 0.65);
  for (const z of [-2.8, -0.3, 2.3]) {
    ellipsoid(g, p.trim, [0.64, 0.5, 1.13], [0, 0.65, z]);
    ellipsoid(g, p.glass, [0.51, 0.41, 0.95], [0, 0.78, z]);
    box(g, p.hull, [0.08, 0.06, 1.8], [0, 1.18, z]);
  }
  for (const s of [-1, 1]) {
    plate(g, p.hull, [[s * 0.6, 0.3], [s * 9.925, 2.22], [s * 9.925, 3.24], [s * 0.65, 3.0]], 0.23, -0.2);
    plate(g, p.red, [[s * 3.7, 1.05], [s * 8.8, 2.11], [s * 8.8, 2.6], [s * 3.7, 1.72]], 0.035, -0.065);
    cylinder(g, p.hull, 0.88, 6.9, [s * 2.9, -0.08, 0.91], 0.67);
    cylinder(g, p.dark, 0.59, 0.14, [s * 2.9, -0.08, -2.62]);
    cylinder(g, p.trim, 0.77, 0.42, [s * 2.9, -0.08, -2.19]);
    nozzle(g, p, 0.71, 1.75, [s * 2.9, -0.08, 5.48]);
    // Two auxiliary S-foils above/below each main wing = six-wing silhouette.
    for (const angle of [-0.38, 0.38]) {
      const foil = new Group();
      foil.position.set(s * 3.0, -0.08, 1.4);
      foil.rotation.z = s * angle;
      plate(foil, p.light, [[0, 0], [s * 5.5, 0.75], [s * 5.1, 1.48], [0, 1.4]], 0.12);
      plate(foil, p.red, [[s * 1.1, 0.25], [s * 4.5, 0.76], [s * 4.4, 1.05], [s * 1.1, 0.62]], 0.025, 0.075);
      g.add(foil);
    }
    cylinder(g, p.dark, 0.085, 3.2, [s * 9.64, -0.12, 0.38]);
    cylinder(g, p.trim, 0.17, 0.72, [s * 9.64, -0.12, 1.8]);
  }
  return finalize(g, 'arc170', 12.71);
}
