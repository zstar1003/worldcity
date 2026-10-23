import assert from 'node:assert/strict';
import * as THREE from 'three';
import { partitionCity } from '../src/spatial.js';
globalThis.requestAnimationFrame = (callback) => setTimeout(callback,0);
const root = new THREE.Group();
const geometry = new THREE.PlaneGeometry(2000,2000,150,150).rotateX(-Math.PI/2);
const original = Array.from(geometry.index.array);
const mesh = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
mesh.position.set(12,3,17); root.add(mesh);
await partitionCity(root,()=>{});
const result=[];
root.traverse((object)=>{if(object.isMesh){
  assert.equal(object.geometry.attributes.position,geometry.attributes.position);
  assert.equal(object.geometry.attributes.normal,geometry.attributes.normal);
  assert.equal(object.geometry.attributes.uv,geometry.attributes.uv);
  for(let i=0;i<object.geometry.index.count;i+=3){
    const triangle=[];
    for(let j=0;j<3;j++){
      const index=object.geometry.index.getX(i+j); triangle.push(index);
      assert(object.geometry.boundingBox.containsPoint(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,index)));
    }
    result.push(triangle.join(','));
  }
}});
const source=[];for(let i=0;i<original.length;i+=3)source.push(original.slice(i,i+3).join(','));
assert.deepEqual(result.sort(),source.sort());
assert.equal(root.children[0].position.y,3);
console.log(`PASS: ${source.length} triangles preserved exactly, attributes shared, spatial bounds contain every vertex.`);
