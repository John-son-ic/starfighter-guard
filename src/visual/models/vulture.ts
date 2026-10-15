import { Group } from 'three';
import { box, ellipsoid, finalize, nozzle, palette, plate } from './primitives.ts';

export function createVultureModel(): Group {
  const g = new Group();
  const p = palette();
  ellipsoid(g, p.blue, [0.73, 0.46, 1.1], [0, 0, 0.72]);
  box(g, p.dark, [1.75, 0.3, 0.54], [0, -0.12, 0.95]);
  for (const s of [-1, 1]) {
    const wing = new Group();
    wing.position.x = s * 1.17;
    // Split paired claws, in flight configuration rather than walking mode.
    for (const y of [-0.34, 0.34]) {
      const blade = plate(wing, p.blue, [[s * -0.28, 2.35], [s * 0.72, 1.33], [s * 0.91, -1.1], [s * 0.24, -3.48], [s * -0.19, -2.75], [s * -0.3, 0.0]], 0.24, y);
      blade.rotation.z = s * (y > 0 ? -0.13 : 0.13);
      plate(wing, p.tan, [[s * -0.13, -2.62], [s * 0.14, -3.22], [s * 0.49, -1.15], [s * 0.30, 0.76], [s * -0.11, 1.3]], 0.028, y + 0.15);
    }
    box(wing, p.trim, [0.45, 1.0, 0.58], [0.0, 0, 1.12]);
    nozzle(wing, p, 0.25, 0.7, [s * 0.04, 0, 2.28]);
    box(g, p.sensor, [0.19, 0.13, 0.04], [s * 0.24, 0.1, -0.35], [0, s * 0.2, 0]);
    g.add(wing);
  }
  return finalize(g, 'vulture', 6.96);
}
