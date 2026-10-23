import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JumpPhysics, poseJump } from '../src/jump-physics.js';
import { Navigation } from '../src/navigation.js';

function surfaces(groundY = 0, roofY = null) {
  const meshes = [];
  for (const [height, rotation] of [[groundY, -Math.PI / 2], ...(roofY === null ? [] : [[roofY, Math.PI / 2]])]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.y = height; mesh.rotation.x = rotation; mesh.updateMatrixWorld(true); meshes.push(mesh);
  }
  const ray = new THREE.Raycaster();
  return {
    hits(origin, direction, far) { ray.set(origin, direction); ray.near = .03; ray.far = far; return ray.intersectObjects(meshes, false); },
    dispose() { meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); }); },
  };
}

test('jump seeds its starting floor immediately and rejects another launch in the air', (t) => {
  const scene = surfaces(12); t.after(() => scene.dispose());
  const physics = new JumpPhysics(), position = new THREE.Vector3(0, 13.7, 0);
  assert.equal(physics.jump(position), true);
  assert(Math.abs(physics.groundY - 12) < 1e-10);
  assert.equal(physics.jump(position), false);
  physics.update(position, .15, scene.hits);
  const velocity = physics.velocity;
  assert.equal(physics.jump(position), false);
  assert.equal(physics.velocity, velocity);
  assert(physics.height > .5, 'contact shadow uses the actual elevation on the first jump');
});

test('real ground raycasts land a jump with an approximately 0.81 meter apex', (t) => {
  const scene = surfaces(); t.after(() => scene.dispose());
  const physics = new JumpPhysics(), position = new THREE.Vector3(0, 1.7, 0);
  physics.jump(position); let apex = 0;
  for (let i = 0; i < 90 && !physics.grounded; i++) {
    physics.update(position, 1 / 60, scene.hits); apex = Math.max(apex, position.y - 1.7);
  }
  assert(Math.abs(apex - .81) < .003, `apex was ${apex}`);
  assert.equal(physics.grounded, true);
  assert(Math.abs(position.y - 1.7) < 1e-9);
  assert.equal(physics.height, 0);
  assert.equal(physics.jump(position), true, 'landing permits the next jump');
});

test('substeps prevent ground tunneling at low frame rates', (t) => {
  const scene = surfaces(); t.after(() => scene.dispose());
  for (const delta of [.2, .4, 1]) {
    const physics = new JumpPhysics(), position = new THREE.Vector3(0, 1.7, 0);
    physics.jump(position);
    for (let i = 0; i < 10 && !physics.grounded; i++) physics.update(position, delta, scene.hits);
    assert.equal(physics.grounded, true, `failed to land with delta ${delta}`);
    assert(Math.abs(position.y - 1.7) < 1e-9);
  }
});

test('a real ceiling stops the head and the character subsequently lands', (t) => {
  const scene = surfaces(0, 2.1); t.after(() => scene.dispose());
  const physics = new JumpPhysics(), position = new THREE.Vector3(0, 1.7, 0);
  physics.jump(position); let peak = position.y;
  for (let i = 0; i < 60 && !physics.grounded; i++) {
    physics.update(position, 1 / 120, scene.hits); peak = Math.max(peak, position.y);
    assert(position.y + .08 <= 2.1 + 1e-9, 'head passed through the roof');
  }
  assert(Math.abs(peak - 2.02) < .01);
  assert.equal(physics.grounded, true);
  assert(Math.abs(position.y - 1.7) < 1e-9);
});

test('suspended navigation and overview mode cannot launch a jump', () => {
  const nav = { suspended: true, mode: 'third', model: { navigationReady: true }, jumpPhysics: new JumpPhysics(), position: new THREE.Vector3(0, 1.7, 0) };
  assert.equal(Navigation.prototype.requestJump.call(nav), false);
  assert.equal(nav.jumpPhysics.grounded, true);
  nav.suspended = false; nav.mode = 'orbit';
  assert.equal(Navigation.prototype.requestJump.call(nav), false);
  nav.mode = 'third';
  assert.equal(Navigation.prototype.requestJump.call(nav), true);
});

test('jump pose follows world yaw even when the imported bone local axes are rotated', () => {
  const parent = new THREE.Group(), bone = new THREE.Bone();
  parent.rotation.set(.3, -.6, .7); bone.rotation.set(-.4, .2, .9); parent.add(bone); parent.updateMatrixWorld(true);
  const before = bone.getWorldQuaternion(new THREE.Quaternion()), yaw = 1.1;
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const expected = new THREE.Quaternion().setFromAxisAngle(right, .42 * .7).multiply(before);
  poseJump(new Map([['mixamorigLeftUpLeg', bone]]), 2, yaw);
  assert(bone.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected) < 1e-7);
});
