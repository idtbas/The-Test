// Render pipeline:
//   shadows -> normal/depth prepass (AO casters) -> SSAO (half res) + bilateral blur
//   -> skin irradiance pass -> separable SSS blur (2 passes)
//   -> main HDR pass (MSAA) -> bloom -> composite (exposure, tone mapping, grading,
//      vignette, grain) to the canvas.

import * as THREE from 'three';
import { COLOR } from './glsl.js';

export const LAYER_SKIN = 1;
export const LAYER_AO = 2;

const FS_VERT = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsMaterial(frag, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms,
    vertexShader: 'precision highp float;\n' + FS_VERT,
    fragmentShader: 'precision highp float;\nprecision highp sampler2D;\n' + frag,
    depthTest: false, depthWrite: false, ...extra,
  });
}

// ------------------------------------------------------------------ SSS kernel
function sssProfile(r, falloff) {
  const g = (v, x) => Math.exp(-(x * x) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
  return falloff.map((f) => {
    const x = r / f;
    return 0.100 * g(0.0484, x) + 0.118 * g(0.187, x) + 0.113 * g(0.567, x) + 0.358 * g(1.99, x) + 0.078 * g(7.41, x);
  });
}

export function sssKernel(n, strength = [0.48, 0.41, 0.28], falloff = [1.0, 0.37, 0.3]) {
  const RANGE = n > 20 ? 3.0 : 2.0, EXP = 2.0;
  const k = [];
  const step = 2 * RANGE / (n - 1);
  for (let i = 0; i < n; i++) {
    const o = -RANGE + i * step;
    k.push([0, 0, 0, RANGE * Math.sign(o) * Math.abs(Math.pow(o, EXP)) / Math.pow(RANGE, EXP)]);
  }
  for (let i = 0; i < n; i++) {
    const w0 = i > 0 ? Math.abs(k[i][3] - k[i - 1][3]) : 0;
    const w1 = i < n - 1 ? Math.abs(k[i][3] - k[i + 1][3]) : 0;
    const area = (w0 + w1) / 2;
    const p = sssProfile(k[i][3], falloff);
    k[i][0] = area * p[0]; k[i][1] = area * p[1]; k[i][2] = area * p[2];
  }
  const c = (n - 1) / 2;
  const center = k.splice(c, 1)[0];
  k.unshift(center);
  const sum = [0, 0, 0];
  for (const e of k) { sum[0] += e[0]; sum[1] += e[1]; sum[2] += e[2]; }
  for (const e of k) { e[0] /= sum[0]; e[1] /= sum[1]; e[2] /= sum[2]; }
  k[0][0] = (1 - strength[0]) + strength[0] * k[0][0];
  k[0][1] = (1 - strength[1]) + strength[1] * k[0][1];
  k[0][2] = (1 - strength[2]) + strength[2] * k[0][2];
  for (let i = 1; i < n; i++) { k[i][0] *= strength[0]; k[i][1] *= strength[1]; k[i][2] *= strength[2]; }
  return k.map((e) => new THREE.Vector4(...e));
}

const SSS_SAMPLES = 25;

const SSS_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec4 uKernel[${SSS_SAMPLES}];
uniform vec2 uDir;            // (1,0) or (0,1)
uniform float uWidth;         // world space filter width in meters
uniform float uProjY;         // projectionMatrix[1][1]
uniform float uAspect;
uniform float uNear, uFar;
in vec2 vUv;
out vec4 outColor;
float linDepth(vec2 uv) {
  float z = texture(tDepth, uv).r * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  vec4 cM = texture(tColor, vUv);
  if (cM.a < 0.5) { outColor = cM; return; }
  float dM = linDepth(vUv);
  // filter width in uv units: world width projected at this depth
  vec2 stepUV = uDir * (uWidth * uProjY * 0.5 / dM) / 3.0;
  stepUV.x /= uAspect;
  vec3 acc = cM.rgb * uKernel[0].rgb;
  for (int i = 1; i < ${SSS_SAMPLES}; i++) {
    vec2 o = vUv + uKernel[i].a * stepUV;
    vec4 c = texture(tColor, o);
    float d = linDepth(o);
    // follow the surface: reject samples from other depths / non-skin
    float s = clamp(abs(dM - d) / (uWidth * 1.5), 0.0, 1.0);
    vec3 col = mix(c.rgb, cM.rgb, max(s, 1.0 - c.a));
    acc += uKernel[i].rgb * col;
  }
  outColor = vec4(acc, cM.a);
}`;

const AO_FRAG = /* glsl */`
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform float uRadius, uNear, uFar, uIntensity;
uniform float uProjY;
uniform vec2 uRes;
uniform float uFrame;
in vec2 vUv;
out vec4 outColor;
vec3 viewPos(vec2 uv) {
  float z = texture(tDepth, uv).r;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float z = texture(tDepth, vUv).r;
  if (z >= 1.0) { outColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 N = normalize(texture(tNormal, vUv).xyz * 2.0 - 1.0);
  float rPix = uRadius * uProjY * 0.5 / -P.z;           // radius in uv units (y)
  float ang = ign(gl_FragCoord.xy + uFrame * 7.0) * 6.2831853;
  float occ = 0.0;
  const int S = 14;
  for (int i = 0; i < S; i++) {
    float t = (float(i) + 0.5) / float(S);
    float a = ang + float(i) * 2.39996;
    vec2 off = vec2(cos(a), sin(a)) * rPix * sqrt(t);
    off.x *= uRes.y / uRes.x;
    vec3 Q = viewPos(vUv + off);
    vec3 v = Q - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    occ += max(0.0, vn + P.z * 0.002) / (vv + 0.00005) * smoothstep(uRadius * 2.0, uRadius * 0.5, sqrt(vv));
  }
  float ao = max(0.0, 1.0 - uIntensity * 2.0 * uRadius * occ / float(S) * 0.25);
  outColor = vec4(vec3(pow(ao, 1.4)), 1.0);
}`;

const BLUR_AO_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform float uNear, uFar;
in vec2 vUv;
out vec4 outColor;
float linDepth(vec2 uv) {
  float z = texture(tDepth, uv).r * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  float d0 = linDepth(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 o = vUv + uDir * float(i);
    float d = linDepth(o);
    float w = exp(-float(i * i) / 8.0) * exp(-abs(d - d0) * 60.0);
    sum += texture(tAO, o).r * w; wsum += w;
  }
  outColor = vec4(vec3(sum / wsum), 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tColor, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(0.0, l - uThreshold) / max(l, 1e-4);
  outColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tColor, vUv).rgb * 4.0;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uMix;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = vec3(0.0);
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 12.0 + texture(tPrev, vUv).rgb * uMix, 1.0);
}`;

const ACCUM_FRAG = /* glsl */`
uniform sampler2D tCur;
uniform sampler2D tPrev;
uniform float uW;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tCur, vUv).rgb;
  vec3 p = texture(tPrev, vUv).rgb;
  outColor = vec4(mix(p, c, uW), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uExposure, uBloom, uVignette, uGrain, uTime, uSaturation, uContrast, uCA;
uniform vec3 uWhite;
uniform int uToneMap;
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;
${COLOR}
// AgX (Blender / Three.js style), Khronos PBR neutral, ACES fitted
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 AgxInsetMatrix = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 AgxOutsetMatrix = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float AgxMinEv = -12.47393, AgxMaxEv = 4.026069;
  c = LINEAR_SRGB_TO_LINEAR_REC2020 * c;
  c = AgxInsetMatrix * c;
  c = max(c, 1e-10);
  c = log2(c);
  c = (c - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  c = clamp(c, 0.0, 1.0);
  c = agxContrast(c);
  c = AgxOutsetMatrix * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  c = LINEAR_REC2020_TO_LINEAR_SRGB * c;
  return clamp(c, 0.0, 1.0);
}
vec3 neutral(vec3 color) {
  const float StartCompression = 0.8 - 0.04, Desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < StartCompression) return color;
  float d = 1.0 - StartCompression;
  float newPeak = 1.0 - d * d / (peak + d - StartCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 aces(vec3 c) {
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = I * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(O * (a / b), 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 d = vUv - 0.5;
  vec3 c;
  if (uCA > 0.0) {
    vec2 o = d * uCA * 0.004;
    c = vec3(texture(tColor, vUv - o).r, texture(tColor, vUv).g, texture(tColor, vUv + o).b);
  } else c = texture(tColor, vUv).rgb;
  c += texture(tBloom, vUv).rgb * uBloom;
  c *= uExposure * uWhite;
  if (uToneMap == 1) c = agx(c);
  else if (uToneMap == 2) c = neutral(c);
  else if (uToneMap == 3) c = aces(c);
  else c = clamp(c, 0.0, 1.0);
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  c = clamp((c - 0.5) * uContrast + 0.5 + (uContrast - 1.0) * 0.0, 0.0, 1.0);
  float v = 1.0 - uVignette * smoothstep(0.25, 0.95, length(d * vec2(uRes.x / uRes.y, 1.0)) * 0.9);
  c *= v;
  vec3 s = linearToSrgb(c);
  float g = hash(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;
  s += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  s += (hash(gl_FragCoord.xy * 1.7 + 3.1) - 0.5) / 255.0; // dither
  outColor = vec4(s, 1.0);
}`;

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export class Renderer {
  constructor(canvas, skinUniforms) {
    const gl = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: true, stencil: false, depth: true,
    });
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.autoUpdate = false;
    gl.autoClear = false;
    this.gl = gl;
    this.skinUniforms = skinUniforms;
    this.settings = {
      scale: 1, msaa: 4, sss: true, sssWidth: 0.0042, ao: true, aoRadius: 0.06, aoIntensity: 1.0,
      bloom: 0.06, bloomThreshold: 1.2, exposure: 1.0, toneMap: 1, vignette: 0.32, grain: 0.025,
      saturation: 1.0, contrast: 1.04, ca: 0.6, white: new THREE.Color(1, 1, 1),
    };
    this.kernel = sssKernel(SSS_SAMPLES);
    this.time = 0;
    this.frame = 0;

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fsMesh = new THREE.Mesh(tri);
    this.fsMesh.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.fsMesh);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.mSSS = fsMaterial(SSS_FRAG, {
      tColor: { value: null }, tDepth: { value: null }, uKernel: { value: this.kernel },
      uDir: { value: new THREE.Vector2() }, uWidth: { value: 0.004 }, uProjY: { value: 1 },
      uAspect: { value: 1 }, uNear: { value: 0.1 }, uFar: { value: 50 },
    });
    this.mAO = fsMaterial(AO_FRAG, {
      tNormal: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() },
      uRadius: { value: 0.06 }, uNear: { value: 0.1 }, uFar: { value: 50 }, uIntensity: { value: 1 },
      uProjY: { value: 1 }, uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 },
    });
    this.mAOBlur = fsMaterial(BLUR_AO_FRAG, {
      tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() },
      uNear: { value: 0.1 }, uFar: { value: 50 },
    });
    this.mAccum = fsMaterial(ACCUM_FRAG, { tCur: { value: null }, tPrev: { value: null }, uW: { value: 1 } });
    this.mBright = fsMaterial(BRIGHT_FRAG, { tColor: { value: null }, uThreshold: { value: 1 } });
    this.mDown = fsMaterial(DOWN_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = fsMaterial(UP_FRAG, {
      tColor: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 },
    });
    this.mComp = fsMaterial(COMPOSITE_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.05 },
      uVignette: { value: 0.3 }, uGrain: { value: 0.02 }, uTime: { value: 0 }, uSaturation: { value: 1 },
      uContrast: { value: 1 }, uCA: { value: 0 }, uWhite: { value: new THREE.Color(1, 1, 1) },
      uToneMap: { value: 1 }, uRes: { value: new THREE.Vector2() },
    });
    this.normalMat = new THREE.MeshNormalMaterial();
    this.width = 0; this.height = 0;
  }

  _rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, ...opts,
    });
  }

  setSize(cssW, cssH, dpr) {
    const s = this.settings.scale;
    const w = Math.max(1, Math.round(cssW * dpr * s)), h = Math.max(1, Math.round(cssH * dpr * s));
    this.gl.setPixelRatio(1);
    this.gl.setSize(w, h, false);
    this.gl.domElement.style.width = cssW + 'px';
    this.gl.domElement.style.height = cssH + 'px';
    if (w === this.width && h === this.height && this.rtMain && this.rtMain.samples === this.settings.msaa) return;
    this.width = w; this.height = h;
    for (const k of ['rtMain', 'rtSkin', 'rtSSS', 'rtSSS2', 'rtND', 'rtAO', 'rtAO2', 'rtAccA', 'rtAccB']) {
      if (this[k]) this[k].dispose();
    }
    for (const r of [...(this.bloomRTs || []), ...(this.bloomUp || [])]) r.dispose();
    const depthTex = () => { const d = new THREE.DepthTexture(w, h); d.type = THREE.UnsignedIntType; return d; };
    this.rtMain = this._rt(w, h, { depthBuffer: true, samples: this.settings.msaa });
    this.rtSkin = this._rt(w, h, { depthBuffer: true, depthTexture: depthTex() });
    this.rtSSS = this._rt(w, h);
    this.rtSSS2 = this._rt(w, h);
    this.rtAccA = this._rt(w, h);
    this.rtAccB = this._rt(w, h);
    this.rtND = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true, depthTexture: depthTex(), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.rtAO = this._rt(hw, hh, { type: THREE.UnsignedByteType });
    this.rtAO2 = this._rt(hw, hh, { type: THREE.UnsignedByteType });
    this.bloomRTs = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < 6 && bw > 2 && bh > 2; i++) {
      this.bloomRTs.push(this._rt(bw, bh));
      bw >>= 1; bh >>= 1;
    }
    this.bloomUp = this.bloomRTs.map((r) => this._rt(r.width, r.height));
    this.skinUniforms.uScreenInv.value.set(1 / w, 1 / h);
  }

  _fs(mat, target) {
    this.fsMesh.material = mat;
    this.gl.setRenderTarget(target);
    this.gl.render(this.fsScene, this.fsCam);
  }

  /**
   * accum: 0 = fresh frame, n > 0 = n-th jittered sample blended into the history
   * (progressive supersampling while the view is still).
   */
  render(scene, camera, skinPassMaterial, accum = 0) {
    const gl = this.gl, st = this.settings;
    this.frame++;
    camera.updateMatrixWorld();
    const proj = camera.projectionMatrix.clone();
    if (accum > 0) {
      const jx = halton(accum, 2) - 0.5, jy = halton(accum, 3) - 0.5;
      camera.projectionMatrix.elements[8] += (jx * 2) / this.width;
      camera.projectionMatrix.elements[9] += (jy * 2) / this.height;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    const prevMask = camera.layers.mask;
    const prevBg = scene.background;
    gl.shadowMap.needsUpdate = true;

    // ---- normal/depth prepass for AO
    const U = this.skinUniforms;
    if (st.ao) {
      camera.layers.set(LAYER_AO);
      scene.overrideMaterial = this.normalMat;
      scene.background = null;
      gl.setRenderTarget(this.rtND);
      gl.setClearColor(0x8080ff, 1);
      gl.clear(true, true, false);
      gl.render(scene, camera);
      scene.overrideMaterial = null;
      const m = this.mAO.uniforms;
      m.tNormal.value = this.rtND.texture; m.tDepth.value = this.rtND.depthTexture;
      m.uProjInv.value.copy(camera.projectionMatrixInverse);
      m.uRadius.value = st.aoRadius; m.uIntensity.value = st.aoIntensity;
      m.uNear.value = camera.near; m.uFar.value = camera.far;
      m.uProjY.value = camera.projectionMatrix.elements[5];
      m.uRes.value.set(this.rtAO.width, this.rtAO.height);
      m.uFrame.value = 0;
      this._fs(this.mAO, this.rtAO);
      const b = this.mAOBlur.uniforms;
      b.tDepth.value = this.rtND.depthTexture; b.uNear.value = camera.near; b.uFar.value = camera.far;
      b.tAO.value = this.rtAO.texture; b.uDir.value.set(1.5 / this.rtAO.width, 0);
      this._fs(this.mAOBlur, this.rtAO2);
      b.tAO.value = this.rtAO2.texture; b.uDir.value.set(0, 1.5 / this.rtAO.height);
      this._fs(this.mAOBlur, this.rtAO);
      U.tSSAO.value = this.rtAO.texture;
      U.uAOStrength.value = 0.85;
    } else {
      U.uAOStrength.value = 0;
      U.tSSAO.value = this.rtAO.texture;
    }

    // ---- skin irradiance + SSS blur
    if (st.sss && skinPassMaterial) {
      camera.layers.set(LAYER_SKIN);
      scene.overrideMaterial = skinPassMaterial;
      scene.background = null;
      gl.setRenderTarget(this.rtSkin);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, true, false);
      gl.render(scene, camera);
      scene.overrideMaterial = null;
      const m = this.mSSS.uniforms;
      m.tDepth.value = this.rtSkin.depthTexture;
      m.uWidth.value = st.sssWidth;
      m.uProjY.value = camera.projectionMatrix.elements[5];
      m.uAspect.value = this.width / this.height;
      m.uNear.value = camera.near; m.uFar.value = camera.far;
      m.tColor.value = this.rtSkin.texture; m.uDir.value.set(1, 0);
      this._fs(this.mSSS, this.rtSSS2);
      m.tColor.value = this.rtSSS2.texture; m.uDir.value.set(0, 1);
      this._fs(this.mSSS, this.rtSSS);
      U.tSSS.value = this.rtSSS.texture;
    }

    // ---- main pass
    camera.layers.mask = prevMask;
    scene.background = prevBg;
    gl.setRenderTarget(this.rtMain);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.render(scene, camera);
    if (accum > 0) {
      camera.projectionMatrix.copy(proj);
      camera.projectionMatrixInverse.copy(proj).invert();
    }

    // ---- progressive accumulation
    const prev = this.rtAccA, next = this.rtAccB;
    this.mAccum.uniforms.tCur.value = this.rtMain.texture;
    this.mAccum.uniforms.tPrev.value = prev.texture;
    this.mAccum.uniforms.uW.value = 1 / (accum + 1);
    this._fs(this.mAccum, next);
    this.rtAccA = next; this.rtAccB = prev;
    const color = this.rtAccA.texture;

    // ---- bloom
    let bloomTex = null;
    if (st.bloom > 0 && this.bloomRTs.length > 2) {
      this.mBright.uniforms.tColor.value = color;
      this.mBright.uniforms.uThreshold.value = st.bloomThreshold;
      this._fs(this.mBright, this.bloomRTs[0]);
      for (let i = 1; i < this.bloomRTs.length; i++) {
        const src = this.bloomRTs[i - 1];
        this.mDown.uniforms.tColor.value = src.texture;
        this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this._fs(this.mDown, this.bloomRTs[i]);
      }
      const n = this.bloomRTs.length;
      let prev = this.bloomRTs[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        this.mUp.uniforms.tColor.value = prev.texture;
        this.mUp.uniforms.tPrev.value = this.bloomRTs[i].texture;
        this.mUp.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
        this.mUp.uniforms.uMix.value = 1.0;
        this._fs(this.mUp, this.bloomUp[i]);
        prev = this.bloomUp[i];
      }
      bloomTex = prev.texture;
    }

    // ---- composite
    const c = this.mComp.uniforms;
    c.tColor.value = color;
    c.tBloom.value = bloomTex || this.rtAO.texture;
    c.uBloom.value = bloomTex ? st.bloom : 0;
    c.uExposure.value = st.exposure;
    c.uToneMap.value = st.toneMap;
    c.uVignette.value = st.vignette;
    c.uGrain.value = st.grain;
    c.uTime.value = 0.37;
    c.uSaturation.value = st.saturation;
    c.uContrast.value = st.contrast;
    c.uCA.value = st.ca;
    c.uWhite.value.copy(st.white);
    c.uRes.value.set(this.width, this.height);
    this._fs(this.mComp, null);
  }
}
