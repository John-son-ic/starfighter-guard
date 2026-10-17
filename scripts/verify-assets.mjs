/**
 * D06 — consistency check for the exported model assets.
 *
 * Read-only: parses public/models/manifest.json and the GLB files it lists, and
 * compares the declared numbers against the bytes actually on disk. It never
 * rewrites the manifest, never re-exports a model and never touches the network.
 *
 * CLI:  node scripts/verify-assets.mjs [modelsDirectory]
 *       exit 0 + "verified N models, B bytes"   when every check passes
 *       exit 1 + one line per problem            otherwise
 *
 * Importable: `verifyAssets(directory)` returns {modelCount, totalBytes} and, on
 * failure, throws an Error whose message lists every problem.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** glTF binary container magic: ASCII "glTF" little-endian. */
const GLB_MAGIC = 0x46546c67;
/** JSON chunk type: ASCII "JSON" little-endian. */
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_VERSION = 2;
const DEFAULT_MODELS_DIRECTORY = 'public/models';
const MANIFEST_FILE = 'manifest.json';

/** MVP v0.1 model set, from src/shared/config.ts MVP_CONFIG.models. */
const EXPECTED_MODEL_IDS = Object.freeze(['venator', 'eta2', 'arc170', 'vulture', 'munificent', 'ywing']);

/** Only these primitive modes are exported; 4 is TRIANGLES. */
const TRIANGLES_MODE = 4;

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  return typeof value;
}

function isSafeFileName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name !== name.trim()) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..') || name.includes(':')) return false;
  return true;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** Reads the manifest; returns {manifest, errors}. */
function readManifest(directory) {
  const path = join(directory, MANIFEST_FILE);
  const errors = [];
  if (!existsSync(path)) return { manifest: null, path, errors: [`${MANIFEST_FILE}: manifest file not found`] };

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { manifest: null, path, errors: [`${MANIFEST_FILE}: cannot be read (${error.message})`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { manifest: null, path, errors: [`${MANIFEST_FILE}: invalid JSON (${error.message})`] };
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { manifest: null, path, errors: [`${MANIFEST_FILE}: top level must be a JSON object`] };
  }
  if (!Array.isArray(manifest.models)) {
    return { manifest: null, path, errors: [`${MANIFEST_FILE}: "models" must be an array`] };
  }
  return { manifest, path, errors };
}

/**
 * Extracts the JSON chunk of a GLB container after checking magic, version, header
 * length and chunk framing against the real file size.
 */
function readGlbJson(buffer, label, errors) {
  if (buffer.length < 20) {
    errors.push(`${label}: file is ${buffer.length} bytes, too short to hold a GLB header`);
    return null;
  }
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  const jsonLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);

  if (magic !== GLB_MAGIC) {
    errors.push(`${label}: bad GLB magic 0x${magic.toString(16)} (expected 0x${GLB_MAGIC.toString(16)})`);
    return null;
  }
  if (version !== GLB_VERSION) {
    errors.push(`${label}: glTF container version ${version} (expected ${GLB_VERSION})`);
    return null;
  }
  if (declaredLength !== buffer.length) {
    errors.push(`${label}: header declares ${declaredLength} bytes but the file is ${buffer.length} bytes`);
    return null;
  }
  if (jsonLength === 0 || 20 + jsonLength > buffer.length) {
    errors.push(`${label}: JSON chunk length ${jsonLength} does not fit in ${buffer.length} bytes`);
    return null;
  }
  if (chunkType !== GLB_CHUNK_JSON) {
    errors.push(`${label}: first chunk type 0x${chunkType.toString(16)} is not JSON`);
    return null;
  }

  const jsonText = buffer.subarray(20, 20 + jsonLength).toString('utf8');
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${label}: JSON chunk is not an object`);
      return null;
    }
    return parsed;
  } catch (error) {
    errors.push(`${label}: JSON chunk is not parseable (${error.message})`);
    return null;
  }
}

/** Triangle count of one primitive, derived from its accessors. */
function primitiveTriangles(gltf, primitive, label, errors) {
  const attributes = primitive.attributes;
  if (attributes === null || typeof attributes !== 'object') {
    errors.push(`${label}: primitive has no attributes object`);
    return 0;
  }
  const positionAccessor = gltf.accessors?.[attributes.POSITION];
  if (positionAccessor === undefined || !Number.isInteger(positionAccessor.count)) {
    errors.push(`${label}: POSITION accessor ${describe(attributes.POSITION)} is missing or has no count`);
    return 0;
  }

  const mode = primitive.mode === undefined ? TRIANGLES_MODE : primitive.mode;
  if (mode !== TRIANGLES_MODE) {
    errors.push(`${label}: primitive mode ${mode} is not TRIANGLES (${TRIANGLES_MODE})`);
    return 0;
  }

  if (primitive.indices === undefined) return positionAccessor.count / 3;

  const indexAccessor = gltf.accessors?.[primitive.indices];
  if (indexAccessor === undefined || !Number.isInteger(indexAccessor.count)) {
    errors.push(`${label}: index accessor ${describe(primitive.indices)} is missing or has no count`);
    return 0;
  }
  return indexAccessor.count / 3;
}

/** Counts triangles across every primitive, and rejects fractional results. */
function countTriangles(gltf, label, errors) {
  if (!Array.isArray(gltf.meshes)) {
    errors.push(`${label}: JSON chunk has no meshes array`);
    return 0;
  }
  let triangles = 0;
  gltf.meshes.forEach((mesh, meshIndex) => {
    if (!Array.isArray(mesh?.primitives) || mesh.primitives.length === 0) {
      errors.push(`${label}: mesh ${meshIndex} has no primitives`);
      return;
    }
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const label2 = `${label}: mesh ${meshIndex} primitive ${primitiveIndex}`;
      const count = primitiveTriangles(gltf, primitive, label2, errors);
      if (!Number.isInteger(count)) {
        errors.push(`${label2}: ${count} triangles is not a whole number (non-triangle accessor count)`);
        return;
      }
      triangles += count;
    });
  });
  return triangles;
}

/** Mesh-referencing nodes in the top-level scene, matching manifest.materialBatches. */
function countSceneMeshNodes(gltf, label, errors) {
  const scenes = gltf.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push(`${label}: JSON chunk has no scenes array`);
    return 0;
  }
  const sceneIndex = gltf.scene === undefined ? 0 : gltf.scene;
  const scene = scenes[sceneIndex];
  if (scene === undefined) {
    errors.push(`${label}: scene index ${sceneIndex} does not exist`);
    return 0;
  }
  if (!Array.isArray(scene.nodes)) {
    errors.push(`${label}: scene ${sceneIndex} has no nodes array`);
    return 0;
  }
  const nodes = gltf.nodes;
  if (!Array.isArray(nodes)) {
    errors.push(`${label}: JSON chunk has no nodes array`);
    return 0;
  }

  let meshNodes = 0;
  const seen = new Set();
  const pending = [...scene.nodes];
  while (pending.length > 0) {
    const nodeIndex = pending.pop();
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      errors.push(`${label}: scene references node ${describe(nodeIndex)}, which does not exist`);
      continue;
    }
    if (seen.has(nodeIndex)) {
      errors.push(`${label}: node ${nodeIndex} is referenced more than once in the scene`);
      continue;
    }
    seen.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (node?.mesh !== undefined) meshNodes += 1;
    if (Array.isArray(node?.children)) pending.push(...node.children);
  }
  return meshNodes;
}

/** Checks one manifest entry against the GLB on disk. */
function verifyModel(entry, index, directory, errors, expectedIds) {
  const label = `models[${index}]`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${label}: entry must be an object`);
    return null;
  }

  const id = entry.id;
  const file = entry.file;
  if (typeof id !== 'string' || !expectedIds.includes(id)) {
    errors.push(`${label}: unexpected model id ${describe(id)}`);
  }
  if (!isSafeFileName(file)) {
    errors.push(`${label}: file name ${describe(file)} is not a bare file name (path traversal refused)`);
    return null;
  }
  if (typeof id === 'string' && file !== `${id}.glb`) {
    errors.push(`${label}: file ${describe(file)} must be named ${id}.glb`);
  }

  for (const field of ['triangles', 'materialBatches', 'bytes']) {
    if (!isPositiveInteger(entry[field])) {
      errors.push(`${label} (${describe(id)}): ${field} must be a positive integer, got ${describe(entry[field])}`);
    }
  }

  const path = join(directory, file);
  if (!existsSync(path)) {
    errors.push(`${label} (${describe(id)}): ${file} is listed in the manifest but missing on disk`);
    return null;
  }

  const actualBytes = statSync(path).size;
  if (isPositiveInteger(entry.bytes) && entry.bytes !== actualBytes) {
    errors.push(`${label} (${describe(id)}): manifest bytes ${entry.bytes} but ${file} is ${actualBytes} bytes`);
  }

  let buffer;
  try {
    buffer = readFileSync(path);
  } catch (error) {
    errors.push(`${label} (${describe(id)}): ${file} cannot be read (${error.message})`);
    return null;
  }

  const gltf = readGlbJson(buffer, file, errors);
  if (gltf === null) return { id, file, bytes: actualBytes };

  const triangles = countTriangles(gltf, file, errors);
  if (isPositiveInteger(entry.triangles) && triangles !== entry.triangles) {
    errors.push(`${label} (${describe(id)}): ${file} declares ${triangles} triangles but the manifest says ${entry.triangles}`);
  }

  const meshNodes = countSceneMeshNodes(gltf, file, errors);
  if (isPositiveInteger(entry.materialBatches) && meshNodes !== entry.materialBatches) {
    errors.push(
      `${label} (${describe(id)}): ${file} has ${meshNodes} mesh nodes in the top-level scene but the manifest says ${entry.materialBatches} material batches`,
    );
  }

  return { id, file, bytes: actualBytes };
}

/**
 * Verifies every model listed in the manifest.
 * Returns {modelCount, totalBytes} and throws an Error listing every problem found.
 * Pass {throwOnError: false} to receive the problems instead of throwing.
 */
export function verifyAssets(directory = DEFAULT_MODELS_DIRECTORY, options = {}) {
  const throwOnError = options.throwOnError !== false;
  const errors = [];
  const root = resolve(directory);
  const { manifest, errors: manifestErrors } = readManifest(root);
  errors.push(...manifestErrors);

  if (manifest === null) {
    return finish(null, errors, throwOnError, root);
  }

  const entries = manifest.models;
  const ids = [];
  const files = [];
  for (const entry of entries) {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      if (typeof entry.id === 'string') ids.push(entry.id);
      if (typeof entry.file === 'string') files.push(entry.file);
    }
  }

  for (const expected of EXPECTED_MODEL_IDS) {
    const found = ids.filter((id) => id === expected).length;
    if (found === 0) errors.push(`${MANIFEST_FILE}: expected model "${expected}" is missing`);
    if (found > 1) errors.push(`${MANIFEST_FILE}: model "${expected}" is listed ${found} times`);
  }
  for (const id of new Set(ids)) {
    if (!EXPECTED_MODEL_IDS.includes(id)) errors.push(`${MANIFEST_FILE}: unexpected model id "${id}"`);
  }
  const duplicateFiles = files.filter((file, index) => files.indexOf(file) !== index);
  for (const file of new Set(duplicateFiles)) errors.push(`${MANIFEST_FILE}: file "${file}" is listed more than once`);

  let modelCount = 0;
  let totalBytes = 0;
  entries.forEach((entry, index) => {
    const verified = verifyModel(entry, index, root, errors, EXPECTED_MODEL_IDS);
    if (verified !== null) {
      modelCount += 1;
      totalBytes += verified.bytes;
    }
  });

  return finish({ modelCount, totalBytes }, errors, throwOnError, root);
}

function finish(result, errors, throwOnError, root) {
  if (errors.length > 0 && throwOnError) {
    throw new Error(`asset verification failed for ${root}:\n${errors.map((line) => `  - ${line}`).join('\n')}`);
  }
  return {
    modelCount: result === null ? 0 : result.modelCount,
    totalBytes: result === null ? 0 : result.totalBytes,
    errors,
    directory: root,
  };
}

function runCli() {
  const directory = process.argv[2] ?? DEFAULT_MODELS_DIRECTORY;
  try {
    const result = verifyAssets(directory);
    console.log(`verified ${result.modelCount} models, ${result.totalBytes} bytes`);
    return 0;
  } catch (error) {
    const lines = String(error.message).split('\n');
    for (const line of lines) console.error(line.startsWith('  - ') ? line.slice(4) : line);
    return 1;
  }
}

// Only run the CLI when this file is the program entry point, so tests can import it.
const isCli = import.meta.main === true || (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isCli) {
  process.exitCode = runCli();
}
