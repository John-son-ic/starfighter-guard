import { Group } from 'three';
import { box, cylinder, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';

export function createVultureModel(): Group {
  const g = new Group();
  const p = palette();
  ellipsoid(g, p.blue, [0.73, 0.46, 1.1], [0, 0, 0.72]);
  box(g, p.dark, [1.75, 0.3, 0.54], [0, -0.12, 0.95]);
  plate(g, p.trim, [[-0.37, 0.3], [0.37, 0.3], [0.43, 1.18], [0, 1.55], [-0.43, 1.18]], 0.06, 0.43);
  for (let i = 0; i < 5; i++) box(g, p.dark, [0.46, 0.035, 0.05], [0, 0.475, 0.54 + i * 0.14]);
  box(g, p.dark, [0.73, 0.27, 0.19], [0, 0.08, -0.31]);
  for (const s of [-1, 1]) {
    const wing = new Group();
    wing.position.x = s * 1.17;
    // Split paired claws, in flight configuration rather than walking mode.
    for (const y of [-0.34, 0.34]) {
      // Armor and surface fittings share the blade transform, including the lower face.
      const blade = new Group();
      blade.position.y = y;
      blade.rotation.z = s * (y > 0 ? -0.13 : 0.13);
      wing.add(blade);
      const face = Math.sign(y);
      plate(blade, p.blue, [[s * -0.28, 2.35], [s * 0.72, 1.33], [s * 0.91, -1.1], [s * 0.24, -3.48], [s * -0.19, -2.75], [s * -0.3, 0.0]], 0.24);
      plate(blade, p.tan, [[s * -0.13, -2.62], [s * 0.14, -3.22], [s * 0.49, -1.15], [s * 0.30, 0.76], [s * -0.11, 1.3]], 0.028, face * 0.135);
      for (let i = 0; i < 5; i++) {
        const z = -2.3 + i * 0.67;
        box(blade, p.dark, [0.29, 0.018, 0.028], [s * 0.16, face * 0.154, z]);
        box(blade, p.trim, [0.07, 0.027, 0.12], [s * 0.32, face * 0.16, z + 0.18]);
      }
      plate(blade, p.trim, [[s * 0.65, -0.8], [s * 0.77, -0.7], [s * 0.65, 0.9], [s * 0.52, 1.1]], 0.035, face * 0.14);
      for (let i = 0; i < 4; i++) box(blade, p.dark, [0.26, 0.02, 0.055], [s * 0.17, face * 0.154, 0.5 + i * 0.14]);
    }
    box(wing, p.trim, [0.45, 1.0, 0.58], [0.0, 0, 1.12]);
    const joint = cylinder(wing, p.dark, 0.32, 0.56, [0, 0, 1.12]);
    joint.rotation.y = Math.PI / 2;
    const cap = cylinder(wing, p.tan, 0.21, 0.035, [s * 0.3, 0, 1.12]);
    cap.rotation.y = Math.PI / 2;
    box(wing, p.dark, [0.18, 0.2, 1.1], [s * 0.05, 0, -0.95]);
    cylinder(wing, p.trim, 0.075, 0.62, [s * 0.05, 0, -1.73]);
    cylinder(wing, p.dark, 0.055, 0.06, [s * 0.05, 0, -2.06]);
    nozzle(wing, p, 0.25, 0.7, [s * 0.04, 0, 2.28]);
    for (const z of [2.06, 2.2, 2.34]) cylinder(wing, p.trim, 0.255, 0.035, [s * 0.04, 0, z]);
    box(g, p.sensor, [0.19, 0.13, 0.04], [s * 0.24, 0.1, -0.42], [0, s * 0.2, 0]);
    g.add(wing);
  }
  return finalize(g, 'vulture', 6.96);
}
