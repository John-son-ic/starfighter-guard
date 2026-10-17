import { Group, Vector3 } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate, wedge } from './primitives.ts';
import { strut } from './venator-geometry.ts';

export function createArc170Model(): Group {
  const g = new Group();
  const p = palette();
  wedge(g, p.hull, [[0, -6.355], [0.68, -4.5], [0.82, 3.95], [0.5, 5.05], [-0.5, 5.05], [-0.82, 3.95], [-0.68, -4.5]], 1.25, 0);
  plate(g, p.red, [[0, -6.15], [0.28, -4.4], [0.32, 3.9], [-0.32, 3.9], [-0.28, -4.4]], 0.05, 0.65);
  for (const z of [-2.8, -0.3, 2.3]) {
    ellipsoid(g, p.trim, [0.64, 0.5, 1.13], [0, 0.65, z]);
    ellipsoid(g, p.glass, [0.51, 0.41, 0.95], [0, 0.78, z]);
    box(g, p.hull, [0.08, 0.06, 1.8], [0, 1.18, z]);
    for (const offset of [-0.48, 0.48]) {
      const r = Math.sqrt(1 - (offset / 0.95) ** 2);
      for (let i = 0; i < 8; i++) {
        const point = (a: number) => new Vector3(0.525 * r * Math.cos(a), 0.78 + 0.425 * r * Math.sin(a), z + offset);
        strut(g, p.hull, point(i * Math.PI / 8), point((i + 1) * Math.PI / 8), 0.055);
      }
    }
  }
  for (const s of [-1, 1]) {
    plate(g, p.hull, [[s * 0.6, 0.3], [s * 9.925, 2.22], [s * 9.925, 3.24], [s * 0.65, 3.0]], 0.23, -0.2);
    plate(g, p.red, [[s * 3.7, 1.05], [s * 8.8, 2.11], [s * 8.8, 2.6], [s * 3.7, 1.72]], 0.035, -0.065);
    cylinder(g, p.hull, 0.88, 6.9, [s * 2.9, -0.08, 0.91], 0.67);
    cylinder(g, p.dark, 0.59, 0.14, [s * 2.9, -0.08, -2.62]);
    cylinder(g, p.trim, 0.77, 0.42, [s * 2.9, -0.08, -2.19]);
    nozzle(g, p, 0.71, 1.75, [s * 2.9, -0.08, 5.48]);
    // Intake hub and radial stators; rear collars expose the engine construction.
    cylinder(g, p.trim, 0.22, 0.22, [s * 2.9, -0.08, -2.72], 0.12);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const center = new Vector3(s * 2.9, -0.08, -2.705);
      strut(g, p.trim, center.clone().add(new Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0)), center.clone().add(new Vector3(Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0)), 0.045);
      box(g, p.trim, [0.065, 0.065, 0.8], [s * 2.9 + Math.cos(a) * 0.67, -0.08 + Math.sin(a) * 0.67, 5.55], [0, 0, a]);
    }
    for (const z of [3.5, 3.85, 4.2]) cylinder(g, p.trim, 0.875, 0.075, [s * 2.9, -0.08, z]);
    box(g, p.red, [0.34, 0.08, 3.1], [s * 2.9, 0.7, 0.55]);
    for (let i = 0; i < 6; i++) {
      box(g, p.dark, [0.27, 0.035, 0.075], [s * 2.9, 0.77, 2.1 + i * 0.15]);
    }
    for (let i = 0; i < 5; i++) {
      const x = 4.1 + i * 1.05;
      const z = 1.3 + i * 0.21;
      box(g, p.trim, [0.035, 0.025, 0.7], [s * x, -0.065, z + 0.35]);
      box(g, p.light, [0.32, 0.04, 0.19], [s * (x + 0.25), -0.04, z + 0.6]);
    }
    // Two auxiliary S-foils above/below each main wing = six-wing silhouette.
    for (const angle of [-0.38, 0.38]) {
      const foil = new Group();
      foil.position.set(s * 3.0, -0.08, 1.4);
      foil.rotation.z = s * angle;
      plate(foil, p.light, [[0, 0], [s * 5.5, 0.75], [s * 5.1, 1.48], [0, 1.4]], 0.12);
      plate(foil, p.red, [[s * 1.1, 0.25], [s * 4.5, 0.76], [s * 4.4, 1.05], [s * 1.1, 0.62]], 0.025, 0.075);
      for (let i = 1; i <= 4; i++) {
        box(foil, p.trim, [0.035, 0.025, 0.5], [s * i, 0.075, 0.35 + i * 0.14]);
      }
      box(foil, p.trim, [0.45, 0.22, 0.9], [s * 0.25, 0, 0.7]);
      g.add(foil);
      strut(g, p.trim, new Vector3(s * 3.4, -0.08, 2.15), new Vector3(s * 4.65, -0.08 + Math.sin(angle) * 1.65, 2.15), 0.1);
    }
    cylinder(g, p.dark, 0.085, 3.2, [s * 9.64, -0.12, 0.38]);
    cylinder(g, p.trim, 0.17, 0.72, [s * 9.64, -0.12, 1.8]);
    cylinder(g, p.hull, 0.13, 0.25, [s * 9.64, -0.12, -1.08]);
    cylinder(g, p.dark, 0.07, 0.05, [s * 9.64, -0.12, -1.23]);
    // Fixed aft defensive barrels: visual detail only, not a new weapon system.
    cylinder(g, p.dark, 0.065, 1.45, [s * 0.24, 0.68, 4.4]);
    box(g, p.trim, [0.13, 0.3, 0.5], [s * 0.24, 0.61, 3.8]);
  }
  return finalize(g, 'arc170', 12.71);
}
