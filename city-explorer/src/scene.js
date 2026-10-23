import * as THREE from 'three';
import { TemporalResolve } from './temporal.js';

export function createScene(host) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
  const reverseDepth = !!context?.getExtension('EXT_clip_control');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, reversedDepthBuffer: reverseDepth, logarithmicDepthBuffer: !reverseDepth, powerPreference: 'high-performance' });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = Math.pow(2, .3);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#aebbc1');
  scene.fog = new THREE.FogExp2('#aebbc1', 0.000065);
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.15, 18000);
  camera._reversedDepth = reverseDepth; camera.updateProjectionMatrix();
  const sun = new THREE.DirectionalLight('#fff5df', 2.1);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = reverseDepth ? 0.00001 : -0.00001; sun.shadow.normalBias = 0.05;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 7000;
  sun.shadow.camera._reversedDepth = reverseDepth; sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const temporal = new TemporalResolve(renderer, reverseDepth);
  let sunDirection = new THREE.Vector3(-1, -1.5, -1).normalize();
  let lastShadowCenter = new THREE.Vector3(Infinity, Infinity, Infinity), lastMode = '';
  return {
    renderer, scene, camera, temporal, ready: temporal.loadDisplayTransform(),
    render() { temporal.render(scene, camera); },
    setLighting(meta, settings) {
      sunDirection.fromArray(settings.sun.direction).normalize();
      sun.color.fromArray(settings.sun.color); sun.intensity = settings.sun.energy;
      temporal.output.uniforms.exposure.value = Math.pow(2, settings.viewSettings.exposure);
      lastShadowCenter.set(Infinity, Infinity, Infinity);
    },
    updateShadows(center, mode) {
      if (lastMode === mode && lastShadowCenter.distanceToSquared(center) < (mode === 'orbit' ? 350 : 35) ** 2) return;
      lastShadowCenter.copy(center); lastMode = mode;
      const radius = mode === 'orbit' ? 1600 : 130;
      sun.target.position.copy(center); sun.target.position.y = Math.min(20, center.y);
      sun.position.copy(sun.target.position).addScaledVector(sunDirection, -3000);
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
      sun.shadow.camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
    },
    setQuality(quality) {
      renderer.setPixelRatio(quality === 'high' ? window.devicePixelRatio : Math.min(window.devicePixelRatio, 1));
      renderer.shadowMap.enabled = quality === 'high'; renderer.shadowMap.needsUpdate = true;
    },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}
