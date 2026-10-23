import * as THREE from 'three';
import { calibrateArmPose, transferLocomotion } from './character-animation.js';
import { JumpPhysics, poseJump, walkableSurface } from './jump-physics.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Navigation {
  constructor(camera, canvas, scene, onChange, notify) {
    this.camera = camera; this.canvas = canvas; this.scene = scene;
    this.onChange = onChange; this.notify = notify;
    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.065;
    this.orbit.minDistance = 3; this.orbit.maxDistance = 12000;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.mode = 'orbit'; this.speed = 5; this.yaw = 0; this.pitch = 0; this.suspended = false;
    this.distance = 6; this.eyeHeight = 1.7;
    this.position = new THREE.Vector3(); this.keys = new Set();
    this.jumpPhysics = new JumpPhysics(this.eyeHeight); this.lastSafePosition = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster(); this.raycaster.firstHitOnly = true;
    this.avatar = this.createAvatar(); scene.add(this.avatar); this.avatar.visible = false;
    this.dragging = false; this.moved = false;
    this.bindInput();
  }

  createAvatar() {
    const group = new THREE.Group();
    this.avatarReady = Promise.all([new GLTFLoader().loadAsync('/characters/rocketbox-male-09/tourist.glb'), new GLTFLoader().loadAsync('/characters/traveler.glb')]).then(([gltf, motion]) => {
      const person = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(person);
      const scale = 1.78 / bounds.getSize(new THREE.Vector3()).y;
      person.scale.setScalar(scale); person.position.y = -bounds.min.y * scale;
      person.rotation.y = Math.PI;
      person.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = false; object.receiveShadow = true;
          if (object.isSkinnedMesh) object.frustumCulled = false;
          for (const material of [].concat(object.material)) {
            if (material.map) material.map.anisotropy = 8;
          }
        }
      });
      group.add(person);
      let body, sourceBody;
      person.traverse((o) => { if (o.isSkinnedMesh && (!body || o.skeleton.bones.length > body.skeleton.bones.length)) body = o; });
      motion.scene.traverse((o) => { if (o.isSkinnedMesh && (!sourceBody || o.skeleton.bones.length > sourceBody.skeleton.bones.length)) sourceBody = o; });
      const sourceBounds = new THREE.Box3().setFromObject(motion.scene);
      motion.scene.scale.setScalar(1.78 / sourceBounds.getSize(new THREE.Vector3()).y);
      person.updateMatrixWorld(true); motion.scene.updateMatrixWorld(true);
      calibrateArmPose(person, body.skeleton, motion.scene, sourceBody.skeleton);
      const clips = transferLocomotion(person, body.skeleton, motion.scene, sourceBody.skeleton, motion.animations.filter((clip) => clip.name !== 'TPose'));
      body.frustumCulled = false; this.avatarBones = new Map(body.skeleton.bones.map((bone) => [bone.name, bone]));
      this.mixer = new THREE.AnimationMixer(person);
      this.actions = Object.fromEntries(clips.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
      motion.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { for (const v of Object.values(m)) if(v?.isTexture)v.dispose(); m.dispose(); } } });
      this.playAnimation('Idle');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
      gradient.addColorStop(0, 'rgba(0,0,0,.35)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; group.add(shadow); this.contactShadow = shadow;
    }).catch((error) => { this.notify('人物资源未能载入，请刷新后重试。'); throw error; });
    return group;
  }

  playAnimation(name, speed = 1) {
    if (!this.actions) return;
    const action = this.actions[name];
    if (!action) return;
    action.timeScale = speed;
    if (this.animation === name) return;
    const previous = this.actions[this.animation];
    action.reset().setEffectiveWeight(1).play();
    if (previous) action.crossFadeFrom(previous, 0.25, false);
    this.animation = name;
  }

  bindInput() {
    const inputActive = () => document.activeElement?.matches('input,select,textarea') || document.querySelector('dialog[open]');
    window.addEventListener('keydown', (event) => {
      if (inputActive()) return;
      if (event.code === 'Space' && this.mode !== 'orbit') {
        event.preventDefault(); if (!event.repeat) this.requestJump(); return;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        if (this.mode !== 'orbit') event.preventDefault();
        this.keys.add(event.code);
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => this.onChange(this.mode));
    document.addEventListener('pointerlockerror', () => this.notify('当前浏览器未启用锁定鼠标，可以按住画面拖动环视。'));
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.mode === 'orbit') return;
      this.dragging = true; this.moved = false; this.lastX = event.clientX; this.lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.mode === 'orbit') return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && !this.dragging) return;
      const dx = locked ? event.movementX : event.clientX - this.lastX;
      const dy = locked ? event.movementY : event.clientY - this.lastY;
      this.lastX = event.clientX; this.lastY = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
      this.yaw -= dx * 0.0024;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0024, -1.35, this.mode === 'third' ? 0.55 : 1.45);
    });
    this.canvas.addEventListener('pointerup', (event) => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      if (this.mode === 'first' && !this.moved && event.pointerType === 'mouse') {
        const promise = this.canvas.requestPointerLock?.();
        promise?.catch?.(() => this.notify('按住画面拖动即可环视。'));
      }
    });
    this.canvas.addEventListener('wheel', (event) => {
      if (this.mode === 'third') { event.preventDefault(); this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.006, 2.5, 15); }
    }, { passive: false });
    document.getElementById('jump-button')?.addEventListener('click', () => this.requestJump());
    document.querySelectorAll('[data-move]').forEach((button) => {
      const key = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' }[button.dataset.move];
      button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.keys.add(key); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => button.addEventListener(name, () => this.keys.delete(key)));
    });
  }

  setCity(model) {
    this.model = model;
    this.spawnIndex = 0;
    this.position.fromArray(model.meta.spawns[0].position); this.jumpPhysics.reset(); this.lastSafePosition.copy(this.position);
    this.overview();
  }

  overview() {
    if (!this.model) return;
    this.setMode('orbit');
    const source = this.model.meta.camera;
    this.camera.position.fromArray(source.position);
    this.camera.fov = source.fov;
    const direction = new THREE.Vector3().fromArray(source.direction);
    this.orbit.target.copy(this.camera.position).addScaledVector(direction, 900);
    this.camera.lookAt(this.orbit.target);
    this.camera.updateProjectionMatrix(); this.orbit.update();
  }

  setMode(mode) {
    if (mode !== 'first' && document.pointerLockElement) document.exitPointerLock();
    this.mode = mode; this.keys.clear();
    this.orbit.enabled = mode === 'orbit'; this.avatar.visible = mode === 'third';
    if (mode !== 'orbit') {
      this.camera.fov = mode === 'first' ? 70 : 60; this.camera.updateProjectionMatrix();
      if (!this.hasWalked) this.goTo(this.spawnIndex || 0, false);
      this.updateCamera(1);
    }
    this.onChange(mode);
  }

  goTo(index, changeMode = true) {
    if (!this.model) return;
    this.spawnIndex = index;
    const spawn = this.model.meta.spawns[index];
    this.position.fromArray(spawn.position); this.jumpPhysics.reset(); this.lastSafePosition.copy(this.position);
    const direction = new THREE.Vector3().fromArray(spawn.target).sub(this.position).normalize();
    this.yaw = Math.atan2(-direction.x, -direction.z);
    this.pitch = this.mode === 'third' ? 0.06 : THREE.MathUtils.clamp(Math.asin(direction.y), -0.3, 0.35);
    this.hasWalked = true;
    if (changeMode && this.mode === 'orbit') this.setMode('third');
    this.updateCamera(1);
  }

  hits(origin, direction, far) {
    this.raycaster.set(origin, direction); this.raycaster.near = 0.03; this.raycaster.far = far;
    const candidates = this.model.meshes.filter((mesh) => this.raycaster.ray.intersectsBox(mesh.userData.worldBounds));
    return this.raycaster.intersectObjects(candidates, false);
  }

  tryMove(delta) {
    const horizontal = new THREE.Vector3(delta.x, 0, delta.z);
    const length = horizontal.length();
    if (!length) return false;
    const direction = horizontal.clone().normalize();
    const chest = this.position.clone().add(new THREE.Vector3(0, -0.65, 0));
    if (this.hits(chest, direction, length + 0.35).length) return false;
    const candidate = this.position.clone().add(horizontal);
    const boundary = this.model.meta.bounds;
    if (candidate.x < boundary.min[0] || candidate.x > boundary.max[0] || candidate.z < boundary.min[2] || candidate.z > boundary.max[2]) return false;
    if (!this.jumpPhysics.grounded) { this.position.copy(candidate); return true; }
    const ground = this.hits(candidate.clone().add(new THREE.Vector3(0, 0.65, 0)), new THREE.Vector3(0, -1, 0), 6);
    const surface = ground.find(walkableSurface);
    if (!surface) return false;
    const step = surface.point.y + this.eyeHeight - this.position.y;
    if (step > 0.6 || step < -2.5) return false;
    candidate.y = surface.point.y + this.eyeHeight;
    this.position.copy(candidate); return true;
  }

  requestJump() {
    if (this.suspended || this.mode === 'orbit' || !this.model?.navigationReady) return false;
    return this.jumpPhysics.jump(this.position);
  }

  update(delta, elapsed) {
    if (this.suspended) return;
    if (this.mode === 'orbit') { this.orbit.update(); return; }
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const side = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1;
    const velocity = new THREE.Vector3(side, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).multiplyScalar(this.speed * boost * delta);
    let moving = false;
    if (this.model?.navigationReady && (forward || side)) {
      // Small substeps prevent running through thin walls at high speed.
      const steps = Math.max(1, Math.ceil(velocity.length() / 0.25)); velocity.divideScalar(steps);
      for (let i = 0; i < steps; i++) {
        if (this.tryMove(velocity)) moving = true;
        else {
          moving = this.tryMove(new THREE.Vector3(velocity.x, 0, 0)) || moving;
          moving = this.tryMove(new THREE.Vector3(0, 0, velocity.z)) || moving;
        }
      }
    }
    const speed = this.speed * boost;
    this.playAnimation(moving ? (speed > 3.5 ? 'Run' : 'Walk') : 'Idle', moving ? Math.min(speed / (speed > 3.5 ? 4.5 : 1.8), 1.6) : 1);
    this.mixer?.update(delta);
    if (this.model?.navigationReady) {
      this.jumpPhysics.update(this.position, delta, (origin, direction, far) => this.hits(origin, direction, far));
      if (this.jumpPhysics.grounded) this.lastSafePosition.copy(this.position);
      if (this.position.y < this.model.meta.bounds.min[1] - 12) { this.position.copy(this.lastSafePosition); this.jumpPhysics.reset(); }
    }
    this.avatar.position.copy(this.position).y -= this.eyeHeight;
    this.avatar.rotation.y = this.yaw;
    if (!this.jumpPhysics.grounded && this.avatarBones) {
      this.avatar.updateMatrixWorld(true);
      poseJump(this.avatarBones, this.jumpPhysics.velocity, this.yaw);
    }
    if (this.contactShadow) { this.contactShadow.position.y = .025 - this.jumpPhysics.height; this.contactShadow.material.opacity = Math.max(.2, 1 - this.jumpPhysics.height * .6); }
    this.updateCamera(1 - Math.exp(-delta * 14));
  }

  updateCamera(alpha) {
    if (this.mode === 'first') {
      this.camera.position.copy(this.position);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    } else if (this.mode === 'third') {
      const target = this.position.clone().add(new THREE.Vector3(0, -0.35, 0));
      const offset = new THREE.Vector3(0, 1.1, this.distance).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const desired = target.clone().add(offset);
      if (this.model?.navigationReady) {
        const hit = this.hits(target, offset.clone().normalize(), offset.length())[0];
        if (hit) desired.copy(target).addScaledVector(offset.normalize(), Math.max(0.6, hit.distance - 0.3));
      }
      this.camera.position.lerp(desired, alpha); this.camera.lookAt(target);
    }
  }
}
