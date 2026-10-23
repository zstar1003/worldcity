import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Reproject previous samples instead of redrawing the entire city for supersampling.
export class TemporalResolve {
  constructor(renderer, reverseDepth) {
    this.renderer = renderer; this.valid = false; this.frame = 0;
    this.size = new THREE.Vector2(); this.previous = new THREE.Matrix4(); this.previousPosition = new THREE.Vector3(Infinity,Infinity,Infinity); this.previousQuaternion = new THREE.Quaternion();
    this.current = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.current.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.history = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    }));
    this.resolve = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        currentColor: { value: null }, currentDepth: { value: null }, historyColor: { value: null },
        inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
        previousVP: { value: this.previous }, texel: { value: new THREE.Vector2() },
        reverseDepth: { value: reverseDepth }, logFar: { value: 1 }, historyWeight: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D currentColor,currentDepth,historyColor;
        uniform mat4 inverseProjection,cameraWorld,previousVP;
        uniform vec2 texel; uniform float logFar,historyWeight; uniform bool reverseDepth;
        void main(){
          vec3 now=texture2D(currentColor,vUv).rgb;
          float depth=texture2D(currentDepth,vUv).r;
          vec4 ray=inverseProjection*vec4(vUv*2.-1.,1.,1.);
          float distance=exp2(depth*logFar)-1.;
          vec3 view=ray.xyz*(-distance/ray.z);
          if(reverseDepth){ vec4 reconstructed=inverseProjection*vec4(vUv*2.-1.,depth,1.); view=reconstructed.xyz/reconstructed.w; }
          vec4 oldClip=previousVP*cameraWorld*vec4(view,1.);
          vec2 oldUv=oldClip.xy/oldClip.w*.5+.5;
          vec4 old=texture2D(historyColor,oldUv);
          float expected=reverseDepth ? oldClip.z/oldClip.w : log2(max(1.+oldClip.w,1.))/logFar;
          float tolerance=reverseDepth ? max(.00000005,abs(expected)*.01) : .00015;
          bool surface=reverseDepth ? depth>.00000001 : depth<.99999;
          bool inside=all(greaterThan(oldUv,vec2(0.)))&&all(lessThan(oldUv,vec2(1.)));
          float weight=(inside&&oldClip.w>0.&&abs(old.a-expected)<tolerance&&surface)?historyWeight:0.;
          vec3 lo=now,hi=now;
          for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
            vec3 sampleColor=texture2D(currentColor,vUv+vec2(float(x),float(y))*texel).rgb;
            lo=min(lo,sampleColor); hi=max(hi,sampleColor);
          }
          vec3 filtered=mix(now,clamp(old.rgb,lo,hi),weight);
          gl_FragColor=vec4(filtered,depth);
        }`,
    });
    this.output = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { image: { value: null }, displayLut: { value: null }, exposure: { value: Math.pow(2, .3) },
        lutSize: { value: 64 }, shaperScale: { value: 64 }, shaperMaximum: { value: 4096 }, shaperDenominator: { value: 18.00000550343433 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D image; uniform highp sampler3D displayLut;
        uniform float exposure,lutSize,shaperScale,shaperMaximum,shaperDenominator; varying vec2 vUv;
        void main(){
          vec3 linearColor=clamp(texture2D(image,vUv).rgb*exposure,vec3(0.),vec3(shaperMaximum));
          vec3 shaped=log2(vec3(1.)+shaperScale*linearColor)/shaperDenominator;
          vec3 coordinate=(shaped*(lutSize-1.)+.5)/lutSize;
          gl_FragColor=vec4(texture(displayLut,coordinate).rgb,1.);
        }`,
    });
    this.quad = new FullScreenQuad(this.resolve);
  }
  async loadDisplayTransform() {
    const response = await fetch('/render/agx-medium-high.json');
    if (!response.ok) throw new Error('原渲染色彩配置加载失败');
    const config = await response.json();
    const binary = await fetch('/render/' + config.texture.url);
    if (!binary.ok) throw new Error('原渲染色彩曲线加载失败');
    const buffer = await binary.arrayBuffer();
    if (buffer.byteLength !== config.size ** 3 * 8) throw new Error('色彩曲线数据不完整');
    const texture = new THREE.Data3DTexture(new Uint16Array(buffer), config.size, config.size, config.size);
    texture.format = THREE.RGBAFormat; texture.type = THREE.HalfFloatType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1; texture.needsUpdate = true;
    const uniforms = this.output.uniforms;
    uniforms.displayLut.value = texture; uniforms.lutSize.value = config.size;
    uniforms.shaperScale.value = config.shaper.scale; uniforms.shaperMaximum.value = config.shaper.maximum;
    uniforms.shaperDenominator.value = config.shaper.logDenominator;
  }
  reset() { this.valid = false; }
  render(scene, camera) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    if (this.current.width !== width || this.current.height !== height) {
      this.current.setSize(width, height); this.history.forEach((target) => target.setSize(width, height));
      this.resolve.uniforms.texel.value.set(1 / width, 1 / height); this.reset();
    }
    const jitter = [[0,-1/6],[-1/4,1/6],[1/4,-7/18],[-3/8,-1/18],[1/8,5/18],[-1/8,-5/18],[3/8,1/18],[-7/16,7/18]][this.frame % 8];
    camera.setViewOffset(width,height,jitter[0],jitter[1],width,height);
    camera.updateMatrixWorld();
    r.setRenderTarget(this.current); r.render(scene,camera);
    this.stats = { calls: r.info.render.calls, triangles: r.info.render.triangles };
    const uniforms = this.resolve.uniforms;
    uniforms.currentColor.value=this.current.texture; uniforms.currentDepth.value=this.current.depthTexture;
    uniforms.historyColor.value=this.history[(this.frame+1)%2].texture;
    uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraWorld.value.copy(camera.matrixWorld);
    uniforms.logFar.value=Math.log2(camera.far+1); uniforms.historyWeight.value=this.valid ? (camera.position.distanceToSquared(this.previousPosition) > .0001 || camera.quaternion.angleTo(this.previousQuaternion) > .0001 ? .45 : .72) : 0;
    this.previousPosition.copy(camera.position); this.previousQuaternion.copy(camera.quaternion);
    this.quad.material=this.resolve;
    const result=this.history[this.frame%2];
    r.setRenderTarget(result); this.quad.render(r);
    this.output.uniforms.image.value=result.texture; this.quad.material=this.output;
    r.setRenderTarget(null); this.quad.render(r);
    this.previous.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    camera.clearViewOffset(); this.valid=true; this.frame++;
  }
}
