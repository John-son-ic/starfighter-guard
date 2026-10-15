import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type HullPoint = readonly [number, number];
export type Finish = ReturnType<typeof palette>;

export function palette() {
  const metal = (color: number, roughness = 0.72) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.35, flatShading: true });
  return {
    hull: metal(0xc6ced4), light: metal(0xe4e5df), trim: metal(0x667884),
    dark: metal(0x202e38), red: metal(0x963e43), yellow: metal(0xd9ad39),
    blue: metal(0x344e68), tan: metal(0x968568),
    glass: new THREE.MeshStandardMaterial({ color: 0x102b3c, metalness: 0.65, roughness: 0.22, emissive: 0x174358, emissiveIntensity: 0.2 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x9beaff, emissive: 0x3dbeff, emissiveIntensity: 2.5, roughness: 0.5 }),
    sensor: new THREE.MeshStandardMaterial({ color: 0xff5d40, emissive: 0xff230a, emissiveIntensity: 1.8 }),
  };
}

export function mesh(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  group.add(object);
  return object;
}

export function box(group: THREE.Group, material: THREE.Material, size: readonly [number, number, number], position: readonly [number, number, number], rotation: readonly [number, number, number] = [0, 0, 0]) {
  const object = mesh(group, new THREE.BoxGeometry(...size), material, ...position);
  object.rotation.set(...rotation);
  return object;
}

/** Extrude an X/Z outline upward. Shape plane has local -Y mapped onto world Z. */
export function plate(group: THREE.Group, material: THREE.Material, outline: readonly HullPoint[], thickness: number, y = 0) {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y - thickness / 2, 0);
  return mesh(group, geometry, material);
}

/** Taper a horizontal hull to a thin bow while retaining a broad stern. */
export function wedge(group: THREE.Group, material: THREE.Material, outline: readonly HullPoint[], thickness: number, y = 0) {
  const object = plate(group, material, outline, thickness, y);
  const positions = object.geometry.getAttribute('position');
  const minZ = Math.min(...outline.map(p => p[1]));
  const maxZ = Math.max(...outline.map(p => p[1]));
  for (let i = 0; i < positions.count; i++) {
    const t = (positions.getZ(i) - minZ) / (maxZ - minZ);
    positions.setY(i, y + (positions.getY(i) - y) * (0.12 + t * 0.88));
  }
  object.geometry.computeVertexNormals();
  return object;
}

export function ellipsoid(group: THREE.Group, material: THREE.Material, size: readonly [number, number, number], position: readonly [number, number, number]) {
  const object = mesh(group, new THREE.SphereGeometry(1, 12, 8), material, ...position);
  object.scale.set(...size);
  return object;
}

export function cylinder(group: THREE.Group, material: THREE.Material, radius: number, length: number, position: readonly [number, number, number], frontRadius = radius) {
  const geometry = new THREE.CylinderGeometry(frontRadius, radius, length, 12);
  geometry.rotateX(Math.PI / 2);
  return mesh(group, geometry, material, ...position);
}

export function nozzle(group: THREE.Group, finish: Finish, radius: number, length: number, position: readonly [number, number, number]) {
  cylinder(group, finish.dark, radius, length, position, radius * 0.86);
  const [x, y, z] = position;
  cylinder(group, finish.trim, radius * 1.04, length * 0.14, [x, y, z + length * 0.36]);
  cylinder(group, finish.engine, radius * 0.78, length * 0.08, [x, y, z + length * 0.49]);
}

/** Unique resources per factory call; batch by material for game-ready draw-call count. */
export function finalize(source: THREE.Group, name: string, length: number): THREE.Group {
  source.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) throw new Error('Model primitive must use one material');
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute);
    }
    const list = batches.get(material) ?? [];
    list.push(geometry);
    batches.set(material, list);
    originals.add(object.geometry);
  });
  const result = new THREE.Group();
  result.name = name;
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`Cannot merge ${name}`);
    geometry.computeBoundingSphere();
    const part = new THREE.Mesh(geometry, material);
    part.name = `${name}-material-${result.children.length}`;
    result.add(part);
    geometries.forEach(item => item.dispose());
  }
  originals.forEach(item => item.dispose());
  source.clear();
  const bounds = new THREE.Box3().setFromObject(result);
  const center = bounds.getCenter(new THREE.Vector3());
  const ratio = length / bounds.getSize(new THREE.Vector3()).z;
  result.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.translate(-center.x, -center.y, -center.z);
    object.geometry.scale(ratio, ratio, ratio);
    object.geometry.computeBoundingSphere();
  });
  result.userData = { units: 'meters', forward: '-Z', up: '+Y', resourceOwnership: 'unique-per-factory' };
  return result;
}

export function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(item => materials.add(item));
  });
  geometries.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
}
