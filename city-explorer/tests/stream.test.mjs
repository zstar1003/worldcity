import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wantedTiles, TileStream } from '../src/tile-stream.js';
import { attachSourceCoordinates } from '../src/spatial-materials.js';
import { batchTile } from '../src/tile-batch.js';

for(const reverse of [false,true]) {
 const camera=new THREE.PerspectiveCamera(60,1,.1,10000);camera._reversedDepth=reverse;camera.updateProjectionMatrix();
 const tiles=[['ahead',[0,0,-600]],['near behind',[0,0,50]],['behind',[0,0,600]],['far skyline',[0,0,-5000]]].map(([id,point])=>({id,box:new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...point),new THREE.Vector3(20,20,20))}));
 assert.deepEqual(new Set(wantedTiles(tiles,camera,camera.position).map((t)=>t.id)),new Set(['near behind','ahead','far skyline']));
 camera.lookAt(0,0,1000);assert(wantedTiles(tiles,camera,camera.position).some((t)=>t.id==='behind'));
}
const owner={root:new THREE.Group(),meshes:[],renderer:{shadowMap:{}}};
const stream=new TileStream(owner,{triangles:3,tiles:[]});
for(const [id,lastUsed] of [['visible',0],['recent',9500],['old',0]]){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());let disposed=false;
 mesh.geometry.addEventListener('dispose',()=>disposed=true);mesh.userData.wasDisposed=()=>disposed;
 const root=new THREE.Group();root.add(mesh);owner.root.add(root);owner.meshes.push(mesh);
 stream.loaded.set(id,{tile:{id,bytes:1e6},root,meshes:[mesh],lastUsed});
}
stream.wanted.add('visible');stream.evict(14000);
assert.deepEqual([...stream.loaded.keys()],['visible','recent']);assert.equal(owner.meshes.length,2);

// A transformed source object must keep its procedural coordinate phase across tile boundaries.
const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),parts=[];
for(const offset of [5,15]){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);mesh.position.set(offset,2,-3);root.add(mesh);parts.push(mesh);
}
root.updateMatrixWorld(true);
const transform={worldThreeToObjectBlender:new THREE.Matrix4().makeTranslation(-5,-2,3).toArray(),generatedBounds:{min:[-1,-1,-1],max:[11,1,1]}};
for(const mesh of parts)attachSourceCoordinates(mesh,transform);
const expected=parts.flatMap((mesh)=>Array.from(mesh.geometry.attributes.sourceCoordinate.array));
const combined=batchTile(root,parts);assert.equal(combined.length,1);assert.deepEqual(Array.from(combined[0].geometry.attributes.sourceCoordinate.array),expected);
assert.equal(combined[0].geometry.index.count,72);assert.equal(combined[0].geometry.attributes.position.getX(0),6);
console.log('PASS: both depth modes preserve distant visible geometry, prefetch nearby geometry, evict only stale offscreen tiles, and batching preserves source material phase and triangle count.');
