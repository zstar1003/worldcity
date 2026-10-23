import * as THREE from 'three';
import { CityReflections } from './reflections.js';
import { TileStream } from './tile-stream.js';
import { SpatialMaterials } from './spatial-materials.js';
import { restoreSourceMaterial, patchSourceMaterial, physicalSourceKey } from './source-materials.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
    }
  });
  geometries.forEach((g) => { g.disposeBoundsTree?.(); g.dispose(); });
  textures.forEach((t) => { t.dispose(); t.source?.data?.close?.(); });
  materials.forEach((m) => m.dispose());
  root.clear();
}

export class CityModel {
  constructor(id, scene, renderer, camera) {
    this.id = id; this.scene = scene; this.renderer = renderer; this.camera = camera; this.disposeTree = disposeObject;
    this.base = `/cities/${id}/`; this.root = new THREE.Group();
    this.root.name = `City ${id}`; this.meshes = []; this.foliageGroups = [];
    this.disposed = false; this.navigationReady = false; this.detailPromise = null;
    this.reflections = new CityReflections(renderer, scene);
    this.lastVegetationUpdate = 0; this.detailCount = 0;
  }

  async load(progress) {
    const response = await fetch(`${this.base}city.json`);
    if (!response.ok) throw new Error('这座城市的模型仍在准备，请稍后重试');
    this.meta = await response.json();
    this.overrides = this.meta.files.materials ? await fetch(this.base + this.meta.files.materials).then((r) => r.json()) : { materials: {} };
    const manifest = await fetch(this.base + 'stream/tiles.json').then((r) => { if (!r.ok) throw new Error('高清分块尚未准备完成'); return r.json(); });
    const [details, transforms, renderSettings] = await Promise.all(['spatial-materials.json','object-transforms.json','render-settings.json'].map((file)=>fetch(this.base+file).then((r)=>{if(!r.ok)throw new Error('原材质细节清单尚未准备好');return r.json();})));
    if (this.disposed) return;
    this.renderSettings = renderSettings;
    this.spatialMaterials = new SpatialMaterials(this.base, details, transforms, this.renderer);
    this.stream = new TileStream(this, manifest);
    this.camera.position.fromArray(this.meta.camera.position); this.camera.fov = this.meta.camera.fov;
    this.camera.lookAt(this.camera.position.clone().add(new THREE.Vector3().fromArray(this.meta.camera.direction)));
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    await this.stream.ensure(this.camera, this.camera.position, (fraction) => progress('按视野加载原始精度建筑', .05 + fraction * .72));
    if (this.disposed) return;
    progress('加载当前视野的原节点材质纹理', 0.78);
    await this.spatialMaterials.ensure(this.meshes, this.camera);
    progress('还原天空与城市植被', 0.8);
    const [environment, instances] = await Promise.all([
      new HDRLoader().loadAsync(this.base + this.meta.files.environment),
      fetch(this.base + this.meta.files.instances).then((r) => r.json()),
    ]);
    if (this.disposed) { environment.dispose(); disposeObject(this.root); return; }
    environment.mapping = THREE.EquirectangularReflectionMapping;
    this.environment = environment;
    await this.createFoliage(instances);
    if (this.disposed) { this.dispose(); return; }
    this.scene.add(this.root);
    this.scene.environment = environment;
    this.scene.background = environment;
    this.scene.environmentIntensity = renderSettings.worldStrength;
    this.scene.backgroundIntensity = renderSettings.worldStrength;
    this.scene.environmentRotation.set(0, -renderSettings.worldRotation[2], 0);
    this.scene.backgroundRotation.copy(this.scene.environmentRotation);
    progress('准备进入城市', 0.98);
  }

  async createFoliage(data) {
    this.instances = data;
    const textureLoader = new THREE.TextureLoader();
    for (const proto of data.prototypes) {
      const map = await textureLoader.loadAsync(this.base + proto.impostor.url);
      map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: map }, fogColor: { value: new THREE.Color('#aebbc1') }, fogDensity: { value: 0.000065 } },
        vertexShader: `#include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float instanceVisible; varying vec2 vUv; varying float vVisible; varying float vDepth;
          void main(){vUv=uv;vVisible=instanceVisible;vec4 p=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
          vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));p.xy+=position.xy*size;
          vDepth=-p.z;gl_Position=projectionMatrix*p;
          #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `#include <logdepthbuf_pars_fragment>
          uniform sampler2D map;uniform vec3 fogColor;uniform float fogDensity;varying vec2 vUv;varying float vVisible;varying float vDepth;
          void main(){if(vVisible<.5)discard;vec4 c=texture2D(map,vUv);float edge=max(fwidth(c.a),.03);float coverage=smoothstep(.35-edge,.35+edge,c.a);if(coverage<.01)discard;
          #include <logdepthbuf_fragment>
          float fog=1.-exp(-fogDensity*fogDensity*vDepth*vDepth);gl_FragColor=vec4(mix(c.rgb,fogColor,fog),coverage);
          #include <colorspace_fragment>
          }`,
        side: THREE.DoubleSide, alphaToCoverage: true,
      });
      const geometry = new THREE.PlaneGeometry(1, 1);
      const visibility = new THREE.InstancedBufferAttribute(new Float32Array(proto.matrices.length).fill(1), 1);
      geometry.setAttribute('instanceVisible', visibility);
      const billboards = new THREE.InstancedMesh(geometry, material, proto.matrices.length);
      billboards.name = `Distant ${proto.name}`;
      const sourceMatrices = [], centers = [];
      const center = new THREE.Vector3().fromArray(proto.impostor.center);
      const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
      const identity = new THREE.Quaternion(), matrix = new THREE.Matrix4();
      proto.matrices.forEach((values, index) => {
        const source = new THREE.Matrix4().fromArray(values);
        sourceMatrices.push(source);
        source.decompose(position, rotation, scale);
        const worldCenter = center.clone().applyMatrix4(source);
        centers.push(worldCenter);
        matrix.compose(worldCenter, identity, new THREE.Vector3(proto.impostor.width * Math.max(Math.abs(scale.x), Math.abs(scale.z)), proto.impostor.height * Math.abs(scale.y), 1));
        billboards.setMatrixAt(index, matrix);
      });
      billboards.computeBoundingSphere();
      this.root.add(billboards);
      this.foliageGroups.push({ proto, billboards, visibility, sourceMatrices, centers, nearMeshes: [] });
    }
  }

  async loadNearFoliage(progress = () => {}) {
    if (this.detailPromise) return this.detailPromise;
    this.detailPromise = (async () => {
      const gltf = await new GLTFLoader().loadAsync(this.base + this.meta.files.foliage, (event) => {
        if (event.total) progress(event.loaded / event.total);
      });
      if (this.disposed) { disposeObject(gltf.scene); return; }
      this.foliageSource = gltf.scene;
      gltf.scene.updateMatrixWorld(true);
      for (const group of this.foliageGroups) {
        const proto = gltf.scene.getObjectByName(group.proto.name);
        if (!proto) throw new Error(`缺少原始树木网格 ${group.proto.name}`);
        proto.traverse((part) => {
          if (!part.isMesh) return;
          for (const material of [].concat(part.material)) if (material.alphaTest > 0) material.alphaToCoverage = true;
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, 48);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.count = 0; mesh.frustumCulled = false;
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.userData.partMatrix = part.matrixWorld.clone();
          group.nearMeshes.push(mesh);
          this.root.add(mesh);
        });
      }
      this.nearReady = true;
    })();
    return this.detailPromise;
  }

  updateVegetation(camera, time, detail = true) {
    const position = camera.position;
    if (time - this.lastVegetationUpdate < 0.5) return;
    this.lastVegetationUpdate = time;
    const candidates = [];
    const projection = camera.projectionMatrix.clone(); projection.elements[0] *= .85; projection.elements[5] *= .85;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection.multiply(camera.matrixWorldInverse), THREE.WebGLCoordinateSystem, camera.reversedDepth);
    const sphere = new THREE.Sphere();
    if (this.nearReady) this.foliageGroups.forEach((g, gi) => {
      g.centers.forEach((center, index) => {
        sphere.center.copy(center); sphere.radius = g.proto.impostor.height * g.sourceMatrices[index].getMaxScaleOnAxis() * .7;
        if (!frustum.intersectsSphere(sphere)) return;
        const distance = position.distanceToSquared(center);
        const retained = g.selected?.has(index);
        if (distance < ((detail ? 65 : 25) + (retained ? 10 : 0)) ** 2) candidates.push({ gi, index, distance: distance * (retained ? 0.65 : 1) });
      });
    });
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = []; let triangles = 0;
    for (const candidate of candidates) {
      const cost = this.foliageGroups[candidate.gi].proto.triangles;
      if (triangles + cost > (detail ? 5000000 : 2000000) && selected.length) continue;
      selected.push(candidate); triangles += cost;
      if (selected.length >= (detail ? 16 : 8)) break;
    }
    this.detailCount = selected.length;
    for (let gi = 0; gi < this.foliageGroups.length; gi++) {
      const group = this.foliageGroups[gi];
      group.visibility.array.fill(1);
      const nearby = selected.filter((c) => c.gi === gi);
      group.selected = new Set(nearby.map((c) => c.index));
      nearby.forEach(({ index }) => { group.visibility.array[index] = 0; });
      group.visibility.needsUpdate = true;
      group.nearMeshes.forEach((mesh) => {
        mesh.count = nearby.length;
        nearby.forEach(({ index }, ni) => mesh.setMatrixAt(ni, new THREE.Matrix4().multiplyMatrices(group.sourceMatrices[index], mesh.userData.partMatrix)));
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  }

  materialKey(material, source) {
    const { name, extras, ...physical } = source;
    const correction = this.overrides.materials[material.name] || null;
    const maps = this.spatialMaterials.description.materials[material.name]?.maps;
    const spatial = maps ? Object.fromEntries(Object.entries(maps).map(([channel, map]) => [channel, {url:map.url,colorSpace:map.colorSpace,mapping:map.mapping,normalScale:map.normalScale}])) : null;
    return JSON.stringify([physical, correction, spatial, physicalSourceKey(this.renderSettings.materials[material.name])]);
  }

  prepareMaterial(material) {
    material.envMapIntensity = 1;
    const correction = this.overrides.materials[material.name];
    if (correction?.baseColor && !material.map) material.color.setRGB(...correction.baseColor.slice(0, 3));
    if (correction?.roughness !== undefined && !material.roughnessMap) material.roughness = correction.roughness;
    if (correction?.metalness !== undefined && !material.metalnessMap) material.metalness = correction.metalness;
    if (material.alphaTest > 0) material.alphaToCoverage = true;
    for (const value of Object.values(material)) if(value?.isTexture) value.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const source = this.renderSettings.materials[material.name];
    material = restoreSourceMaterial(material, source);
    this.spatialMaterials?.prepare(material);
    patchSourceMaterial(material, source);
    this.reflections.register(material);
    return material;
  }

  async prepareNavigation(progress, camera = this.camera, anchor = camera.position) {
    await this.stream.ensure(camera, anchor, progress, 200);
    await this.spatialMaterials.ensure(this.meshes, camera);
    this.navigationReady = true;
  }

  updateStreaming(camera, anchor, elapsed) { this.stream?.update(camera, anchor, elapsed); this.spatialMaterials?.update(this.meshes, camera, elapsed); }

  dispose() {
    this.disposed = true;
    this.stream?.dispose();
    this.reflections.dispose();
    this.spatialMaterials?.dispose();
    this.scene.remove(this.root);
    if (this.scene.environment === this.environment) { this.scene.environment = null; this.scene.background = new THREE.Color('#aebbc1'); }
    disposeObject(this.root);
    this.foliageSource?.clear();
    this.environment?.dispose();
    this.meshes.length = 0;
    this.foliageGroups.length = 0;
  }
}
