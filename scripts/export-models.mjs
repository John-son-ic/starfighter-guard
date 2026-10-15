import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_CATALOG } from '../src/visual/models/index.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';

// These assets contain no textures; only Blob -> ArrayBuffer is needed by the browser exporter.
globalThis.FileReader = class {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); });
  }
};
const directory = fileURLToPath(new URL('../public/models/', import.meta.url));
await mkdir(directory, { recursive: true });
const entries = [];
for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
  const root = entry.factory();
  const data = await new GLTFExporter().parseAsync(root, { binary: true });
  if (!(data instanceof ArrayBuffer)) throw new Error(`Expected binary GLB for ${id}`);
  // Parse the exported file back, verifying the artifact rather than just its source.
  const parsed = await new GLTFLoader().parseAsync(data, '');
  const bounds = new THREE.Box3().setFromObject(parsed.scene);
  const size = bounds.getSize(new THREE.Vector3());
  if (Math.abs(size.z - entry.length) > entry.length * 0.00001) throw new Error(`${id} export scale mismatch`);
  let triangles = 0;
  root.traverse(object => { if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3; });
  await writeFile(`${directory}/${id}.glb`, new Uint8Array(data));
  entries.push({ id, file: `${id}.glb`, source: `src/visual/models/${id}.ts`, lengthMeters: entry.length, dimensionsMeters: size.toArray(), triangles, materialBatches: root.children.length, bytes: data.byteLength });
  console.log(`${id}: ${triangles} triangles, ${root.children.length} batches, ${data.byteLength} bytes, GLB round-trip OK`);
  disposeModel(root); disposeModel(parsed.scene);
}
await writeFile(`${directory}/manifest.json`, JSON.stringify({ version: 1, units: 'meters', forward: '-Z', up: '+Y', models: entries }, null, 2) + '\n');
