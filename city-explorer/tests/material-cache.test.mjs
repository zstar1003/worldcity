import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpatialMaterials } from '../src/spatial-materials.js';

function fixture() {
  const level = { url: 'cached-base-color.png', resolution: [2048, 2048] };
  const map = { mapping: { space: 'uv', repeat: [1, 1], offset: [0, 0] }, levels: [level] };
  const manager = new SpatialMaterials('/', { materials: { M: { maps: { baseColor: map } } } },
    { objects: {} }, { capabilities: { getMaxAnisotropy: () => 1 } });
  const material = new THREE.MeshStandardMaterial();
  material.name = 'M';
  manager.prepare(material);
  const texture = new THREE.Texture();
  let disposals = 0;
  texture.addEventListener('dispose', () => disposals++);
  const entry = { url: level.url, texture, lastUsed: performance.now() - 13000, size: 2048 };
  entry.promise = Promise.resolve(entry);
  manager.cache.set(entry.url, entry);
  const mesh = { material, userData: { worldBounds: new THREE.Box3(
    new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)) } };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  return { manager, material, texture, entry, mesh, camera, disposals: () => disposals };
}

test('revisiting an expired cached texture keeps it alive until its Promise installs it', async (t) => {
  const f = fixture();
  t.after(() => { f.manager.dispose(); f.material.dispose(); });
  const slot = f.manager.records.get(f.material).slots.baseColor;

  // The cache hit resolves asynchronously, whereas eviction runs inside update().
  f.manager.update([f.mesh], f.camera, 0, true);
  assert.equal(slot.entry, null, 'the Promise callback has not run yet');
  assert.equal(slot.request, f.entry.url);
  assert.equal(f.disposals(), 0, 'a requested cached texture must survive synchronous eviction');
  assert.equal(f.manager.cache.get(f.entry.url), f.entry);

  await Promise.resolve();
  assert.equal(slot.entry, f.entry);
  assert.equal(slot.uniform.value, f.texture);
  assert.equal(slot.request, null);
  assert.equal(f.disposals(), 0);
  assert.equal(f.manager.cache.get(f.entry.url), f.entry, 'the live uniform remains tracked for disposal');

  f.manager.dispose();
  assert.equal(f.disposals(), 1, 'city disposal releases the retained texture exactly once');
});

test('an expired texture with no active or pending consumer is still evicted', (t) => {
  const f = fixture();
  t.after(() => { f.manager.dispose(); f.material.dispose(); });
  f.manager.update([], f.camera, 0, true);
  assert.equal(f.manager.cache.has(f.entry.url), false);
  assert.equal(f.disposals(), 1);
  f.manager.dispose();
  assert.equal(f.disposals(), 1, 'evicted textures are not disposed again at city shutdown');
});
