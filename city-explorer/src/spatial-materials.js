import * as THREE from 'three';

const fields={baseColor:'map_fragment',roughness:'roughnessmap_fragment',metalness:'metalnessmap_fragment',normal:'normal_fragment_maps'};
const vertexDetail=`
attribute vec3 sourceCoordinate;
attribute vec3 generatedCoordinate;
varying vec3 vSourceCoordinate;
varying vec3 vGeneratedCoordinate;
varying vec2 vSourceUv;
`;
const fragmentDetail=`
varying vec3 vSourceCoordinate;
varying vec3 vGeneratedCoordinate;
varying vec2 vSourceUv;
vec3 detailWeights(vec3 p) {
  vec3 n=abs(cross(dFdx(p),dFdy(p)));
  n=pow(n/max(max(n.x,n.y),max(n.z,1e-20)),vec3(4.));
  return n/max(n.x+n.y+n.z,1e-20);
}
mat3 detailTangent(vec3 N,vec2 uv) {
  vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);
  vec2 st0=dFdx(uv),st1=dFdy(uv);
  vec3 T=cross(q1,N)*st0.x+cross(N,q0)*st1.x;
  vec3 B=cross(q1,N)*st0.y+cross(N,q0)*st1.y;
  float det=max(dot(T,T),dot(B,B));
  float scale=det>1e-20?inversesqrt(det):0.;
  return mat3(T*scale,B*scale,N);
}
`;

function channelShader(channel,map) {
  const n='detail_'+channel,space=map.mapping.space,uv=space==='uv';
  const p=space==='generated'?'vGeneratedCoordinate':'vSourceCoordinate';
  const normal=channel==='normal';
  const sample=(coord)=>normal?`normalize(detailTangent(N,${coord})*(texture2D(${n},${coord}).xyz*2.-1.))`:`texture2D(${n},${coord})`;
  return `uniform sampler2D ${n};uniform vec2 ${n}_repeat;uniform vec2 ${n}_offset;
  ${normal?'vec3':'vec4'} sample_${channel}(${normal?'vec3 N':''}) {
    ${uv?`vec2 uv=vSourceUv*${n}_repeat+${n}_offset;return ${sample('uv')};`:
      `vec3 w=detailWeights(${p});vec2 a=${p}.yz*${n}_repeat+${n}_offset;vec2 b=${p}.xz*${n}_repeat+${n}_offset;vec2 c=${p}.xy*${n}_repeat+${n}_offset;return ${sample('a')}*w.x+${sample('b')}*w.y+${sample('c')}*w.z;`}
  }`;
}

export function attachSourceCoordinates(mesh,transform) {
  if(mesh.geometry.attributes.sourceCoordinate)return;
  const position=mesh.geometry.attributes.position,coordinates=new Float32Array(position.count*3),generated=new Float32Array(position.count*3);
  const matrix=new THREE.Matrix4().fromArray(transform.worldThreeToObjectBlender).multiply(mesh.matrixWorld);
  const bounds=transform.generatedBounds,point=new THREE.Vector3();
  for(let i=0;i<position.count;i++) {
    point.fromBufferAttribute(position,i).applyMatrix4(matrix);point.toArray(coordinates,i*3);
    for(let axis=0;axis<3;axis++)generated[i*3+axis]=(coordinates[i*3+axis]-bounds.min[axis])/Math.max(bounds.max[axis]-bounds.min[axis],1e-12);
  }
  mesh.geometry.setAttribute('sourceCoordinate',new THREE.BufferAttribute(coordinates,3));
  mesh.geometry.setAttribute('generatedCoordinate',new THREE.BufferAttribute(generated,3));
}

// Sidecars only replace channels that glTF cannot represent; embedded image maps stay untouched.
export class SpatialMaterials {
  constructor(base,description,transforms,renderer) {
    this.base=base;this.description=description;this.transforms=transforms.objects;this.renderer=renderer;
    this.records=new Map();this.cache=new Map();this.queue=[];this.inflight=0;this.errors=0;this.disposed=false;this.lastUpdate=-Infinity;
    this.white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);this.white.needsUpdate=true;
    this.flat=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);this.flat.needsUpdate=true;
  }
  prepare(material) {
    const info=this.description.materials[material.name];if(!info)return;
    const maps=Object.fromEntries(Object.entries(info.maps).filter(([channel])=>fields[channel]));
    const uniforms={},slots={};
    for(const [channel,map] of Object.entries(maps)) {
      uniforms['detail_'+channel]={value:channel==='normal'?this.flat:this.white};
      uniforms['detail_'+channel+'_repeat']={value:new THREE.Vector2(...map.mapping.repeat)};
      uniforms['detail_'+channel+'_offset']={value:new THREE.Vector2(...map.mapping.offset)};
      slots[channel]={map,uniform:uniforms['detail_'+channel],entry:null,request:null};
    }
    const record={material,maps,slots,lastSeen:0,fallbackColor:material.color.clone(),fallbackRoughness:material.roughness,fallbackMetalness:material.metalness};
    this.records.set(material,record);
    material.onBeforeCompile=(shader)=>{
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+vertexDetail).replace('#include <begin_vertex>','#include <begin_vertex>\nvSourceCoordinate=sourceCoordinate;vGeneratedCoordinate=generatedCoordinate;vSourceUv=vec2(uv.x,1.-uv.y);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_pars_fragment>','#include <normal_pars_fragment>\n'+fragmentDetail+Object.entries(maps).map(([c,m])=>channelShader(c,m)).join('\n'));
      for(const channel of Object.keys(maps)) {
        const addition={baseColor:'diffuseColor*=sample_baseColor();',roughness:'roughnessFactor*=sample_roughness().g;',metalness:'metalnessFactor*=sample_metalness().b;',normal:'normal=normalize(sample_normal(normal));'}[channel];
        shader.fragmentShader=shader.fragmentShader.replace(`#include <${fields[channel]}>`,`#include <${fields[channel]}>\n${addition}`);
      }
    };
    material.customProgramCacheKey=()=>JSON.stringify(Object.entries(maps).map(([c,m])=>[c,m.mapping.space]));
    material.needsUpdate=true;
  }
  prepareMesh(mesh,sourceName) {
    if(![].concat(mesh.material).some((m)=>Object.values(this.records.get(m)?.maps||{}).some((map)=>map.mapping.space!=='uv')))return;
    const transform=this.transforms[sourceName];
    if(!transform)throw new Error(`缺少原材质坐标：${sourceName}`);
    attachSourceCoordinates(mesh,transform);
  }
  update(meshes,camera,time,force=false) {
    if(this.disposed||(!force&&time-this.lastUpdate<.75))return;
    this.lastUpdate=time;camera.updateMatrixWorld();
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),THREE.WebGLCoordinateSystem,camera.reversedDepth);
    const distances=new Map();
    for(const mesh of meshes) {
      const bounds=mesh.userData.worldBounds;if(!bounds)continue;
      const distance=bounds.distanceToPoint(camera.position);
      if(distance>150&&!frustum.intersectsBox(bounds))continue;
      for(const material of [].concat(mesh.material))if(this.records.has(material))distances.set(material,Math.min(distances.get(material)??Infinity,distance));
    }
    const now=performance.now();
    for(const record of this.records.values()) {
      const distance=distances.get(record.material);
      if(distance===undefined){if(now-record.lastSeen>10000)this.release(record);continue;}
      record.lastSeen=now;
      const resolution=distance<240?2048:distance<1200?1024:256;
      for(const [channel,slot] of Object.entries(record.slots)) {
        let targetResolution=resolution;
        // Keep the current level through a margin so moving near a boundary does not oscillate.
        if(slot.entry?.size===2048&&distance<290)targetResolution=2048;
        if(slot.entry?.size===1024&&distance>=190&&distance<1440)targetResolution=1024;
        if(slot.entry?.size===256&&distance>=1000)targetResolution=256;
        const levels=slot.map.levels||[{url:slot.map.url,resolution:slot.map.resolution}];
        const level=levels.find((l)=>l.resolution[0]>=targetResolution)||levels.at(-1);
        if(slot.entry?.url===level.url||slot.request===level.url)continue;
        slot.request=level.url;
        this.getTexture(level,slot.map).then((entry)=>{
          if(this.disposed||slot.request!==entry.url)return;
          slot.entry=entry;slot.uniform.value=entry.texture;slot.request=null;
          if(channel==='baseColor')record.material.color.setRGB(1,1,1);
          if(channel==='roughness')record.material.roughness=1;
          if(channel==='metalness')record.material.metalness=1;
        }).catch((error)=>{slot.request=null;if(!this.disposed){this.errors++;console.error('原材质纹理加载失败',level.url,error);}});
      }
    }
    const used=new Set([...this.records.values()].flatMap((r)=>Object.values(r.slots).flatMap((s)=>[s.entry?.url,s.request])));
    for(const [url,entry] of this.cache)if(entry.texture){
      if(used.has(url))entry.lastUsed=now;
      else if(now-entry.lastUsed>12000){entry.texture.dispose();entry.texture.image?.close?.();this.cache.delete(url);}
    }
  }
  getTexture(level,map) {
    if(this.cache.has(level.url)){const cached=this.cache.get(level.url);cached.lastUsed=performance.now();return cached.promise;}
    const entry={url:level.url,texture:null,lastUsed:performance.now(),size:level.resolution[0]};
    entry.promise=new Promise((resolve,reject)=>this.queue.push({entry,map,resolve,reject}));this.cache.set(level.url,entry);this.pump();return entry.promise;
  }
  pump() {
    while(!this.disposed&&this.inflight<4&&this.queue.length){
      const {entry,map,resolve,reject}=this.queue.shift();this.inflight++;
      new THREE.TextureLoader().loadAsync(this.base+entry.url).then((texture)=>{
        if(this.disposed){texture.dispose();resolve(entry);return;}
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.flipY=map.textureFlipY!==false;
        texture.colorSpace=map.colorSpace==='srgb'?THREE.SRGBColorSpace:THREE.NoColorSpace;
        texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();texture.minFilter=THREE.LinearMipmapLinearFilter;
        entry.texture=texture;entry.lastUsed=performance.now();resolve(entry);
      }).catch((error)=>{this.cache.delete(entry.url);reject(error);}).finally(()=>{this.inflight--;this.pump();});
    }
  }
  async ensure(meshes,camera){this.update(meshes,camera,0,true);while(!this.disposed&&(this.queue.length||this.inflight))await new Promise((r)=>setTimeout(r,50));}
  release(record){
    for(const [channel,slot] of Object.entries(record.slots)){slot.request=null;slot.entry=null;slot.uniform.value=channel==='normal'?this.flat:this.white;}
    record.material.color.copy(record.fallbackColor);record.material.roughness=record.fallbackRoughness;record.material.metalness=record.fallbackMetalness;
  }
  get stats(){return {materials:this.records.size,textures:[...this.cache.values()].filter((e)=>e.texture).length,high:[...this.cache.values()].filter((e)=>e.texture&&e.size===2048).length,pending:this.queue.length+this.inflight,failed:this.errors,gpuMB:Math.round([...this.cache.values()].reduce((s,e)=>s+(e.texture?e.size**2*4*4/3:0),0)/1048576)};}
  dispose(){this.disposed=true;this.queue.splice(0).forEach(({resolve,entry})=>resolve(entry));this.cache.forEach((e)=>e.texture?.dispose());this.cache.clear();this.records.clear();this.white.dispose();this.flat.dispose();}
}
