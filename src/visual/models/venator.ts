import { BufferAttribute, Color, Group, Mesh, Vector3 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { finalize, palette, plate, wedge } from './primitives.ts';
import { addVenatorDetail } from './venator-detail.ts';
import { accelerateRaycast } from './venator-raycast.ts';

export function createVenatorModel(): Group {
  const g = new Group();
  const p = palette();
  // Warm painted metal; the other fighters retain their existing palettes.
  p.hull.color.setHex(0xb5b3aa); p.light.color.setHex(0xc5c2b7);
  p.trim.color.setHex(0x737775); p.dark.color.setHex(0x282e30);
  p.red.color.setHex(0x793c38);
  for (const material of [p.hull, p.light, p.red]) { material.roughness = 0.88; material.metalness = 0.16; }
  const hull = [[0,-577.5],[32,-486],[270,282],[264,398],[222,442],[205,503],[-205,503],[-222,442],[-264,398],[-270,282],[-32,-486]] as const;
  plate(g, p.dark, hull, 40, -2);
  plate(g, p.hull, hull.map(([x,z])=>[x*1.006,z]), 5, -23);
  wedge(g, p.trim, hull, 7, 12);
  wedge(g, p.hull, hull.map(([x,z])=>[x*0.985,z*0.997]), 13, 18);
  const deck = [[0,-542],[25,-455],[241,275],[232,380],[205,410],[105,428],[-105,428],[-205,410],[-232,380],[-241,275],[-25,-455]] as const;
  plate(g, p.light, deck, 5, 25);
  addVenatorDetail(g, p);
  const result = finalize(g, 'venator', 1155);
  // Baked vertex tint survives GLB export. No image/texture fetches or shader-only detail.
  result.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) return;
    const positions = object.geometry.getAttribute('position');
    const colors = new Uint8Array(positions.count * 3);
    const color = new Color();
    const v = new Vector3(), edgeA = new Vector3(), edgeB = new Vector3();
    for (let i = 0; i < positions.count; i += 3) {
      const x = (positions.getX(i) + positions.getX(i+1) + positions.getX(i+2)) / 3;
      const z = (positions.getZ(i) + positions.getZ(i+1) + positions.getZ(i+2)) / 3;
      const hash = Math.sin(Math.floor(x / 5) * 127.1 + Math.floor(z / 8) * 311.7) * 43758.5453;
      v.fromBufferAttribute(positions,i);
      edgeA.fromBufferAttribute(positions,i+1).sub(v); edgeB.fromBufferAttribute(positions,i+2).sub(v);
      const broadFace = edgeA.cross(edgeB).lengthSq() > 57600;
      const shade = material === p.engine ? 1 : broadFace ? 0.93 : 0.83 + (hash - Math.floor(hash)) * 0.17;
      color.setRGB(shade, shade * 0.992, shade * 0.972);
      for (let v = 0; v < 3; v++) colors.set([Math.round(color.r*255), Math.round(color.g*255), Math.round(color.b*255)], (i+v)*3);
    }
    object.geometry.setAttribute('color', new BufferAttribute(colors, 3, true));
    material.vertexColors = true;
    const original = object.geometry;
    object.geometry = mergeVertices(original, 0.0001);
    original.dispose();
    accelerateRaycast(object);
  });
  return result;
}
