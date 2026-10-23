import * as THREE from 'three';

// Evaluate the source factor at normal/grazing incidence. Three's microfacet BRDF
// interpolates these endpoints using Schlick; this is a realtime approximation.
export function reflectionFactor(node, cosine) {
  if (typeof node === 'number') return node;
  if (node.type === 'ShaderNodeFresnel') {
    const ior = node.inputs.find((input) => input.name === 'IOR').value;
    const g = Math.sqrt(Math.max(0, ior * ior - 1 + cosine * cosine));
    const a = (g - cosine) / (g + cosine);
    const b = (cosine * (g + cosine) - 1) / (cosine * (g - cosine) + 1);
    return .5 * a * a * (1 + b * b);
  }
  if (node.type === 'ShaderNodeMath' && node.operation === 'MULTIPLY_ADD') {
    const [a, b, c] = node.inputs.map((input) => input.link ? reflectionFactor(input.link, cosine) : input.value);
    const result = a * b + c;
    return node.useClamp ? THREE.MathUtils.clamp(result, 0, 1) : result;
  }
  throw new Error('不支持的源玻璃混合节点');
}

export function physicalSourceKey(source) {
  if (!source) return null;
  const { sourceMaterial, sourceSurface, gltfExtensions, normalGraph, coatColorSemantics, ...values } = source;
  return values;
}

export function restoreSourceMaterial(material, source) {
  if (!source) return material;
  const mix = source.reflectionMix;
  if ((source.coatWeight > 0 || mix) && !material.isMeshPhysicalMaterial) {
    const physical = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(physical, material);
    physical.defines = { STANDARD: '', PHYSICAL: '' };
    material = physical;
  }
  if (source.coatWeight > 0) {
    material.clearcoat = source.coatWeight;
    material.clearcoatRoughness = source.coatRoughness;
  }
  if (mix) {
    material.metalness = 0;
    material.roughness = mix.reflectionRoughness;
    material.transmission = 1;
    material.thickness = 0;
    // Blender Transparent passes straight through without rough transmission blur.
    material.ior = mix.baseType === 'ShaderNodeBsdfTransparent' ? 1 : (source.ior || 1.5);
    material.color.fromArray(mix.transmissionColor || source.baseColor);
    material.opacity = 1; material.transparent = false;
  }
  return material;
}

export function patchSourceMaterial(material, source) {
  const coat = source?.coatWeight > 0, mix = source?.reflectionMix;
  if (!coat && !mix) return;
  const uniforms = {};
  if (coat) Object.assign(uniforms, {
    sourceCoatF0: { value: source.coatF0 },
    sourceCoatIOR: { value: source.coatIOR },
    sourceCoatTint: { value: new THREE.Vector3().fromArray(source.coatTint) },
  });
  if (mix) Object.assign(uniforms, {
    sourceReflectionF0: { value: reflectionFactor(mix.factor, 1) },
    sourceReflectionF90: { value: reflectionFactor(mix.factor, 0) },
    sourceReflectionTint: { value: new THREE.Vector3().fromArray(mix.reflectionColor) },
  });
  const previousHook = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    let declarations = '', physical = '';
    if (coat) {
      declarations += 'uniform float sourceCoatF0,sourceCoatIOR;uniform vec3 sourceCoatTint;\n';
      physical += '\n#ifdef USE_CLEARCOAT\nmaterial.clearcoatF0=vec3(sourceCoatF0);\n#endif\n';
      shader.fragmentShader = shader.fragmentShader.replace('outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc )',
        `float sourceCosNT=sqrt(max(1e-6,1.-(1.-dotNVcc*dotNVcc)/(sourceCoatIOR*sourceCoatIOR)));
        outgoingLight*=mix(vec3(1.),pow(sourceCoatTint,vec3(1./sourceCosNT)),material.clearcoat);
        outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc )`);
    }
    if (mix) {
      declarations += 'uniform float sourceReflectionF0,sourceReflectionF90;uniform vec3 sourceReflectionTint;\n';
      physical += '\nmaterial.specularColor=vec3(sourceReflectionF0);material.specularF90=sourceReflectionF90;\n';
      shader.fragmentShader = shader.fragmentShader.replace('vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
        'vec3 totalSpecular = (reflectedLight.directSpecular + reflectedLight.indirectSpecular)*sourceReflectionTint;');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + declarations)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + physical);
  };
  material.customProgramCacheKey = () => previousKey + `:source-physical:${Boolean(coat)}:${Boolean(mix)}`;
  material.needsUpdate = true;
}
