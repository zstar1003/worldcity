import * as THREE from 'three';

// One bounded local reflection probe. Capture only on arrival or after moving to
// another block and stopping; never recursively render probes into themselves.
export class CityReflections {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.target = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.camera = new THREE.CubeCamera(.3, 12000, this.target);
    for (const camera of this.camera.children) {
      camera._reversedDepth = renderer.capabilities.reversedDepthBuffer; camera.updateProjectionMatrix();
    }
    this.materials = new Set(); this.position = new THREE.Vector3(Infinity, Infinity, Infinity);
  }
  register(material) {
    if (!material.isMeshPhysicalMaterial || !(material.transmission > 0 || material.clearcoat > .5)) return;
    this.materials.add(material);
    if (this.ready) { material.envMap = this.filtered.texture; material.envMapRotation.set(0,0,0); material.needsUpdate = true; }
  }
  capture(position, avatar) {
    this.position.copy(position); this.camera.position.copy(position); this.camera.updateMatrixWorld();
    const visible = avatar?.visible;
    if (avatar) avatar.visible = false;
    for (const material of this.materials) { material.envMap = null; material.needsUpdate = true; }
    const shadowUpdate = this.renderer.shadowMap.needsUpdate;
    this.renderer.shadowMap.needsUpdate = false;
    try { this.camera.update(this.renderer, this.scene); this.filtered = this.pmrem.fromCubemap(this.target.texture, this.filtered); }
    finally {
      for (const material of this.materials) { material.envMap = this.filtered?.texture || null; material.envMapRotation.set(0,0,0); material.needsUpdate = true; }
      if (avatar) avatar.visible = visible;
      this.renderer.shadowMap.needsUpdate = shadowUpdate;
    }
    this.ready = true;
  }
  dispose() { this.materials.clear(); this.filtered?.dispose(); this.pmrem.dispose(); this.target.dispose(); this.target.texture.dispose(); }
}
