import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { batchTile } from './tile-batch.js';

export function wantedTiles(tiles, camera, anchor, radius = 180) {
  camera.updateMatrixWorld();
  const projection = camera.projectionMatrix.clone();
  projection.elements[0] *= .72; projection.elements[5] *= .72;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection.multiply(camera.matrixWorldInverse), THREE.WebGLCoordinateSystem, camera.reversedDepth);
  return tiles.filter((tile) => tile.box.distanceToPoint(anchor) < radius || frustum.intersectsBox(tile.box))
    .sort((a,b) => a.box.distanceToPoint(anchor)-b.box.distanceToPoint(anchor));
}

export class TileStream {
  constructor(owner, manifest) {
    this.owner=owner; this.tiles=manifest.tiles.map((tile)=>({...tile,box:new THREE.Box3(new THREE.Vector3().fromArray(tile.bounds.min),new THREE.Vector3().fromArray(tile.bounds.max))}));
    this.total=manifest.triangles; this.loaded=new Map(); this.pending=new Map(); this.errors=new Map();
    this.materials=new Map(); this.queue=[]; this.wanted=new Set(); this.evictions=0; this.receivedBytes=0; this.lastUpdate=0; this.disposed=false;
  }
  select(camera,anchor,radius=180) {
    const selected=wantedTiles(this.tiles,camera,anchor,radius);
    this.wanted=new Set(selected.map((tile)=>tile.id));
    const now=performance.now();
    for(const id of this.wanted) if(this.loaded.has(id))this.loaded.get(id).lastUsed=now;
    this.queue=selected.filter((tile)=>!this.loaded.has(tile.id)&&!this.pending.has(tile.id)&&!this.errors.has(tile.id));
    this.pump(); this.evict(now); return selected;
  }
  pump() {
    while(!this.disposed&&this.pending.size<3&&this.queue.length) {
      const tile=this.queue.shift(); const controller=new AbortController();
      const job=this.fetchTile(tile,controller.signal).catch((error)=>{
        if(!this.disposed&&error.name!=='AbortError'){this.errors.set(tile.id,error);console.error('高清街区载入失败',tile.id,error);}
      }).finally(()=>{this.pending.delete(tile.id);this.pump();});
      this.pending.set(tile.id,{job,controller});
    }
  }
  async fetchTile(tile,signal) {
    const base=this.owner.base+'stream/';
    const response=await fetch(base+tile.url,{signal}); if(!response.ok)throw new Error(`HTTP ${response.status}: ${tile.url}`);
    const buffer=await response.arrayBuffer(); if(this.disposed)return;
    const gltf=await new GLTFLoader().parseAsync(buffer,base);
    if(this.disposed){this.owner.disposeTree(gltf.scene);return;}
    gltf.scene.updateMatrixWorld(true);
    const oldMaterials=new Set(),oldTextures=new Set(),rawMeshes=[];
    gltf.scene.traverse((object)=>{
      if(!object.isMesh)return;
      object.material=[].concat(object.material).map((material)=>{
        const sourceMaterial=gltf.parser.json.materials[gltf.parser.associations.get(material)?.materials];
        const key=this.owner.materialKey(material,sourceMaterial||{name:material.name});
        if(this.materials.has(key)){
          if(material!==this.materials.get(key)){oldMaterials.add(material); for(const value of Object.values(material))if(value?.isTexture)oldTextures.add(value);}
          return this.materials.get(key);
        }
        const prepared=this.owner.prepareMaterial(material);if(prepared!==material)oldMaterials.add(material);this.materials.set(key,prepared);return prepared;
      });
      if(object.material.length===1)object.material=object.material[0];
      let source=object;while(source&&gltf.parser.associations.get(source)?.nodes===undefined)source=source.parent;
      const sourceName=gltf.parser.json.nodes[gltf.parser.associations.get(source)?.nodes]?.name;
      object.userData.sourceName=sourceName;
      this.owner.spatialMaterials.prepareMesh(object,sourceName);
      object.castShadow=true;object.receiveShadow=true;object.geometry.computeBoundingBox();
      rawMeshes.push(object);
    });
    const keptTextures=new Set();for(const material of this.materials.values())for(const value of Object.values(material))if(value?.isTexture)keptTextures.add(value);
    oldMaterials.forEach((m)=>m.dispose());oldTextures.forEach((t)=>{if(!keptTextures.has(t)){t.dispose();t.source?.data?.close?.();}});
    const meshes=batchTile(gltf.scene,rawMeshes);
    meshes.forEach((mesh)=>{mesh.geometry.computeBoundingBox();if(mesh.geometry.attributes.position.count>90)mesh.geometry.computeBoundsTree({maxLeafTris:12,indirect:true});});
    this.owner.root.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
    meshes.forEach((mesh)=>{mesh.userData.worldBounds=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);});
    this.owner.meshes.push(...meshes);
    this.loaded.set(tile.id,{tile,root:gltf.scene,meshes,lastUsed:performance.now()});this.receivedBytes+=tile.bytes;
    this.owner.renderer.shadowMap.needsUpdate=true;
  }
  async ensure(camera,anchor,progress=()=>{},radius=180) {
    this.errors.clear();const required=this.select(camera,anchor,radius);
    while(!this.disposed){
      const done=required.filter((tile)=>this.loaded.has(tile.id)).length;
      progress(done/Math.max(required.length,1));
      const failed=required.find((tile)=>this.errors.has(tile.id));if(failed)throw this.errors.get(failed.id);
      if(done===required.length)return;
      await new Promise((resolve)=>setTimeout(resolve,50));
    }
  }
  update(camera,anchor,time) {
    if(time-this.lastUpdate<.3)return;
    this.lastUpdate=time;this.select(camera,anchor);
  }
  evict(now) {
    let bytes=[...this.loaded.values()].reduce((sum,entry)=>sum+entry.tile.bytes,0);
    // Never replace visible geometry with a reduced mesh to meet a memory budget.
    const stale=[...this.loaded.values()].filter((entry)=>!this.wanted.has(entry.tile.id)).sort((a,b)=>a.lastUsed-b.lastUsed);
    for(const entry of stale){
      if(now-entry.lastUsed<4000 || (bytes<650*1048576&&now-entry.lastUsed<12000))continue;
      this.owner.root.remove(entry.root);const removed=new Set(entry.meshes);
      this.owner.meshes=this.owner.meshes.filter((mesh)=>!removed.has(mesh));
      entry.meshes.forEach((mesh)=>{mesh.geometry.disposeBoundsTree?.();mesh.geometry.dispose();});
      entry.root.clear();this.loaded.delete(entry.tile.id);bytes-=entry.tile.bytes;this.evictions++;
    }
  }
  get stats(){return {resident:this.loaded.size,total:this.tiles.length,queued:this.queue.length,inflight:this.pending.size,failed:this.errors.size,evictions:this.evictions,receivedMB:Math.round(this.receivedBytes/1048576),residentMB:Math.round([...this.loaded.values()].reduce((sum,x)=>sum+x.tile.bytes,0)/1048576),triangles:[...this.loaded.values()].reduce((sum,x)=>sum+x.tile.triangles,0)};}
  dispose(){this.disposed=true;this.queue=[];this.pending.forEach(({controller})=>controller.abort());
    // Include materials belonging to already-evicted chunks in normal city disposal.
    const holder=new THREE.Group();for(const material of this.materials.values()){const object=new THREE.Object3D();object.material=material;holder.add(object);}this.owner.root.add(holder);
    this.loaded.clear();this.materials.clear();
  }
}
