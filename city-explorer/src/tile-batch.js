import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merge only compatible primitives inside one independently evictable tile.
// Source material coordinates are already attributes, so batching preserves their mapping.
export function batchTile(root, meshes) {
  const groups=new Map(),result=[];
  for(const mesh of meshes) {
    const signature=JSON.stringify(Object.entries(mesh.geometry.attributes).map(([name,a])=>[name,a.itemSize,a.normalized,a.array.constructor.name]));
    const key=mesh.material.uuid+signature;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);
  }
  for(const entries of groups.values()) {
    if(entries.length===1){result.push(entries[0]);continue;}
    const geometries=entries.map((mesh)=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const merged=mergeGeometries(geometries,false);
    geometries.forEach((g)=>g.dispose());
    if(!merged){result.push(...entries);continue;}
    const combined=new THREE.Mesh(merged,entries[0].material);
    combined.castShadow=true;combined.receiveShadow=true;combined.name='Tile material batch';
    entries.forEach((mesh)=>{mesh.parent.remove(mesh);mesh.geometry.dispose();});
    root.add(combined);result.push(combined);
  }
  return result;
}
