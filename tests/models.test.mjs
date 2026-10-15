import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MODEL_CATALOG } from '../src/visual/models/index.ts';
import { disposeModel } from '../src/visual/models/primitives.ts';

for (const [id, entry] of Object.entries(MODEL_CATALOG)) {
  test(`${id}: centered meter-scale geometry with bounded material batches`, () => {
    const root = entry.factory();
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    assert.ok(center.length() < entry.length * 0.00001);
    assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).z - entry.length) < entry.length * 0.00001);
    assert.ok(root.children.length <= 10);
    root.traverse(object => {
      if (!object.isMesh) return;
      for (const key of ['position', 'normal']) assert.ok(Array.from(object.geometry.getAttribute(key).array).every(Number.isFinite));
      assert.ok(object.geometry.getAttribute('position').count > 0);
    });
    const second = entry.factory();
    const originalGeometries = new Set(root.children.map(child => child.geometry));
    const originalMaterials = new Set(root.children.map(child => child.material));
    for (const child of second.children) {
      assert.ok(!originalGeometries.has(child.geometry));
      assert.ok(!originalMaterials.has(child.material));
    }
    disposeModel(root); disposeModel(second);
  });
}
