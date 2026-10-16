import { BufferAttribute, BufferGeometry, Group, Material, Vector3 } from 'three';
import { mesh, type HullPoint } from './primitives.ts';

/** Convex cross sections ordered around X/Z. All sections must have equal vertex counts. */
export function loft(g: Group, material: Material, sections: { y: number; outline: readonly HullPoint[] }[]) {
  const positions: number[] = [];
  const n = sections[0]!.outline.length;
  const point = (s: number, i: number) => new Vector3(sections[s]!.outline[i]![0], sections[s]!.y, sections[s]!.outline[i]![1]);
  const triangle = (a: Vector3, b: Vector3, c: Vector3, outward: Vector3) => {
    if (b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) [b, c] = [c, b];
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  for (let s = 0; s < sections.length - 1; s++) {
    const center = sections[s]!.outline.reduce((p, [x, z]) => p.add(new Vector3(x, 0, z)), new Vector3()).divideScalar(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = point(s, i), b = point(s, j), c = point(s + 1, j), d = point(s + 1, i);
      const outward = a.clone().add(b).multiplyScalar(0.5).setY(0).sub(center);
      triangle(a, b, c, outward); triangle(a, c, d, outward);
    }
  }
  for (const s of [0, sections.length - 1]) for (let i = 1; i < n - 1; i++) {
    triangle(point(s, 0), point(s, i), point(s, i + 1), new Vector3(0, s === 0 ? -1 : 1, 0));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return mesh(g, geometry, material);
}

export function armorBlock(g: Group, material: Material, w: number, h: number, d: number, x: number, y: number, z: number, bevel = 1) {
  const outline = (inset: number): HullPoint[] => [[-w / 2 + inset, -d / 2 + inset], [w / 2 - inset, -d / 2 + inset], [w / 2 - inset, d / 2 - inset], [-w / 2 + inset, d / 2 - inset]];
  const b = Math.min(bevel, w / 4, d / 4, h * 0.45);
  const object = loft(g, material, [{ y: -h / 2, outline: outline(0) }, { y: h / 2 - b, outline: outline(0) }, { y: h / 2, outline: outline(b) }]);
  object.position.set(x, y, z);
  return object;
}

/** A true 3D strut, oriented between authored attachment points. */
export function strut(g: Group, material: Material, a: Vector3, b: Vector3, width: number) {
  const object = armorBlock(g, material, width, width, a.distanceTo(b), 0, 0, 0, width * 0.2);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), b.clone().sub(a).normalize());
  return object;
}
