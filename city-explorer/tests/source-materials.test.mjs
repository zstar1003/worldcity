import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import * as THREE from 'three';
import { restoreSourceMaterial, patchSourceMaterial, reflectionFactor, physicalSourceKey } from '../src/source-materials.js';
const settings = (city) => JSON.parse(fs.readFileSync(`public/cities/${city}/render-settings.json`));
test('original glass coating restores its IOR and absorption while keeping spatial shader hooks', () => {
  const source = Object.values(settings('shenzhen').materials).find(s => s.coatIOR > 3 && s.coatWeight === 1);
  const material = restoreSourceMaterial(new THREE.MeshPhysicalMaterial(), source);
  let called = false; material.onBeforeCompile = () => { called = true; };
  patchSourceMaterial(material, source);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  assert(called); assert(Math.abs(shader.uniforms.sourceCoatF0.value - .2743764) < 1e-6);
  assert(shader.fragmentShader.includes('material.clearcoatF0=vec3(sourceCoatF0)'));
  assert(shader.fragmentShader.includes('outgoingLight*=mix'));
  assert(!shader.fragmentShader.includes('clearcoatSpecularDirect * sourceCoatTint'));
  assert.notDeepEqual(physicalSourceKey(source), physicalSourceKey({...source,coatIOR:1.5}));
});
test('Guangzhou source transparent glass becomes physical transmission, preserving original texture references', () => {
  const source = Object.values(settings('guangzhou').materials).find(s => s.reflectionMix);
  const original = new THREE.MeshStandardMaterial({ metalness: .32 }); original.map = new THREE.Texture();
  const restored = restoreSourceMaterial(original, source);
  assert(restored.isMeshPhysicalMaterial); assert('PHYSICAL' in restored.defines);
  assert.equal(restored.map, original.map); assert.equal(restored.transmission, 1);
  assert.equal(restored.metalness, 0); assert.equal(restored.thickness, 0);
  const f0 = ((1.48 - 1) / (1.48 + 1)) ** 2 * .88 + .12;
  assert(Math.abs(reflectionFactor(source.reflectionMix.factor, 1) - f0) < 1e-6);
  assert(Math.abs(reflectionFactor(source.reflectionMix.factor, 0) - 1) < 1e-6);
});
test('source display LUT reproduces independently rendered Blender calibration sample', () => {
  const config = JSON.parse(fs.readFileSync('public/render/agx-medium-high.json'));
  const bytes = fs.readFileSync('public/render/agx-medium-high.bin');
  const data = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  const linear = .3342253565788269 * 2 ** .3;
  const u = Math.log2(1 + config.shaper.scale * linear) / config.shaper.logDenominator * (config.size - 1);
  const low = Math.floor(u), frac = u - low; let result = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const weight = (x ? frac : 1-frac) * (y ? frac : 1-frac) * (z ? frac : 1-frac);
    result += THREE.DataUtils.fromHalfFloat(data[(((low+z)*config.size+low+y)*config.size+low+x)*4]) * weight;
  }
  assert(Math.abs(Math.round(result * 255) - 168) <= 1);
  assert.equal(config.output.additionalSRGBEncoding, false);
});
