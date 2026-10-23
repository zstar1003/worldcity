import assert from 'node:assert/strict';
import * as THREE from 'three';
for (const reverse of [false,true]) {
 const camera=new THREE.PerspectiveCamera(65,1.5,.15,18000);
 camera._reversedDepth=reverse;camera.updateProjectionMatrix();
 for(const z of [1,10,500,15000]){
  const point=new THREE.Vector3(.12*z,.05*z,-z);
  const clip=new THREE.Vector4(...point,1).applyMatrix4(camera.projectionMatrix);
  const depth=reverse?clip.z/clip.w:Math.log2(1+z)/Math.log2(camera.far+1);
  const ray=new THREE.Vector4(clip.x/clip.w,clip.y/clip.w,reverse?depth:1,1).applyMatrix4(camera.projectionMatrixInverse);
  const recovered=reverse?new THREE.Vector3(ray.x,ray.y,ray.z).divideScalar(ray.w):new THREE.Vector3(ray.x,ray.y,ray.z).multiplyScalar(-(2**(depth*Math.log2(camera.far+1))-1)/ray.z);
  assert(point.distanceTo(recovered)<1e-6);
 }
}
console.log('PASS: standard/log and reversed depth reconstruct world-space positions from 1–15000 m.');
