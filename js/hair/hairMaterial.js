// Strand rendering: camera-facing ribbons pulled from float textures (one instance per
// strand), Marschner-style shading (R, TRT, TT lobes) with shadow maps and self occlusion.

import * as THREE from 'three';

const VERT_COMMON = /* glsl */`
uniform highp sampler2D tPos;
uniform highp sampler2D tAttr;
uniform int uK;
uniform int uW;
uniform float uWidth;
uniform float uMinPx;
uniform float uViewH;
uniform float uTaper;
uniform float uWidthScale;
uniform mat4 uDelta;
attribute float aPoint;
attribute float aSide;
vec4 fetchP(int i) { return texelFetch(tPos, ivec2(i % uW, i / uW), 0); }
`;

const VERT_MAIN = /* glsl */`
  int strand = gl_InstanceID;
  int k = int(aPoint + 0.5);
  int base = strand * uK;
  vec4 p = fetchP(base + k);
  vec3 pa = fetchP(base + max(k - 1, 0)).xyz;
  vec3 pb = fetchP(base + min(k + 1, uK - 1)).xyz;
  vec4 attr = texelFetch(tAttr, ivec2(strand % uW, strand / uW), 0);
  vec3 posW = (uDelta * vec4(p.xyz, 1.0)).xyz;
  vec3 tanW = normalize(mat3(uDelta) * (pb - pa) + vec3(0.0, 1e-6, 0.0));
  vec4 mv = viewMatrix * vec4(posW, 1.0);
  vec3 tV = normalize(mat3(viewMatrix) * tanW);
  vec3 toCam = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  vec3 side = normalize(cross(tV, toCam) + vec3(1e-6, 0.0, 0.0));
  float w = uWidth * attr.x * (1.0 - pow(p.w, 2.5) * uTaper) * uWidthScale;
  float pix = isOrthographic ? (2.0 / projectionMatrix[1][1]) / uViewH : 2.0 * (-mv.z) / (projectionMatrix[1][1] * uViewH);
  float wr = max(w, pix * uMinPx);
  mv.xyz += side * aSide * wr * 0.5;
`;

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
${VERT_COMMON}
varying float vT;
varying vec3 vTan;
varying vec3 vViewPos;
varying vec4 vAttr;
varying float vCover;
varying float vSide;
varying vec3 vWorldPos;
void main() {
  ${VERT_MAIN}
  vT = p.w; vTan = tV; vViewPos = mv.xyz; vAttr = attr; vCover = w / wr; vSide = aSide;
  vWorldPos = posW;
  vec4 worldPosition = vec4((inverse(viewMatrix) * mv).xyz, 1.0);
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform vec3 uRoot, uTip, uHigh, uGrayCol;
uniform float uOmbre, uGray, uHighAmt, uSpec, uSpec2, uShift, uAO, uTT, uAmb, uRough, uSheen;
uniform vec3 uAmbTop, uAmbBot;
uniform float uFrame;
varying float vT;
varying vec3 vTan;
varying vec3 vViewPos;
varying vec4 vAttr;
varying float vCover;
varying float vSide;
varying vec3 vWorldPos;
float h11(float n) { return fract(sin(n * 91.345) * 47453.5453); }
void main() {
  float tone = vAttr.y, rnd = vAttr.z, layer = vAttr.w;
  vec3 base = mix(uRoot, uTip, smoothstep(0.15, 1.0, vT) * uOmbre);
  base *= 0.78 + 0.44 * tone;
  if (rnd < uHighAmt) base = mix(base, uHigh, 0.75);
  if (fract(rnd * 7.31) < uGray) base = uGrayCol * (0.8 + 0.3 * tone);
  vec3 T = normalize(vTan);
  vec3 V = normalize(-vViewPos);
  vec3 B = normalize(cross(T, V));
  vec3 Nf = normalize(cross(B, T));
  float s = clamp(vSide, -0.98, 0.98);
  vec3 N = normalize(Nf * sqrt(1.0 - s * s) + B * s);
  vec3 col = vec3(0.0);
  float sparkle = 0.6 + 0.8 * h11(floor(vT * 18.0) + rnd * 100.0);
  float roughK = mix(1.0, 0.25, uRough);
  #if NUM_DIR_LIGHTS > 0
  DirectionalLight dl;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow dls;
  #endif
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    {
    dl = directionalLights[i];
    vec3 L = dl.direction;
    float sh = 1.0;
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      dls = directionalLightShadows[i];
      sh = getShadow(directionalShadowMap[i], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[i]);
    #endif
    float TL = dot(T, L);
    float sinTL = sqrt(max(0.0, 1.0 - TL * TL));
    float NL = dot(N, L);
    float diff = sinTL * (0.55 + 0.45 * clamp(NL * 0.5 + 0.5, 0.0, 1.0));
    vec3 H = normalize(L + V);
    vec3 T1 = normalize(T + N * uShift);
    vec3 T2 = normalize(T - N * uShift * 1.6);
    float th1 = dot(T1, H), th2 = dot(T2, H);
    float r = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 90.0 * roughK) * uSpec;
    float trt = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 26.0 * roughK) * uSpec2 * sparkle;
    float tt = pow(clamp(dot(-L, V), 0.0, 1.0), 5.0) * uTT * (1.0 - abs(TL));
    vec3 c = base * diff * 0.85 + vec3(r) * 0.18 + base * trt * 0.9 + base * base * tt * 2.5 + uSheen * base * pow(1.0 - abs(dot(N, V)), 4.0);
    col += dl.color * sh * c * RECIPROCAL_PI;
    }
  }
  #pragma unroll_loop_end
  #endif
  vec3 Nw = inverseTransformDirection(N, viewMatrix);
  vec3 amb = mix(uAmbBot, uAmbTop, Nw.y * 0.5 + 0.5) * uAmb;
  float ao = mix(uAO, 1.0, smoothstep(0.0, 0.55, vT)) * (1.0 - layer * 0.35);
  col += base * amb;
  col *= ao;
  // strands narrower than the minimum ribbon width are darkened towards the background
  // proportionally less often by randomly dropping fragments (keeps density consistent)
  if (vCover < 0.999 && h11(gl_FragCoord.x * 0.37 + gl_FragCoord.y * 1.91 + rnd * 53.0 + uFrame * 7.13) > vCover * 1.3) discard;
  gl_FragColor = vec4(col, 1.0);
}`;

const DEPTH_FRAG = /* glsl */`
void main() { gl_FragColor = vec4(1.0); }`;

export function createStrandTemplate(K) {
  const g = new THREE.InstancedBufferGeometry();
  const pt = new Float32Array(K * 2), sd = new Float32Array(K * 2), pos = new Float32Array(K * 2 * 3);
  for (let k = 0; k < K; k++) { pt[k * 2] = k; pt[k * 2 + 1] = k; sd[k * 2] = -1; sd[k * 2 + 1] = 1; }
  const idx = [];
  for (let k = 0; k < K - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPoint', new THREE.BufferAttribute(pt, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(sd, 1));
  g.setIndex(idx);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
  return g;
}

export function createHairMaterial() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    tPos: { value: null }, tAttr: { value: null }, uK: { value: 2 }, uW: { value: 1 },
    uWidth: { value: 0.00008 }, uMinPx: { value: 0.55 }, uViewH: { value: 1000 }, uTaper: { value: 0.8 },
    uWidthScale: { value: 1 }, uDelta: { value: new THREE.Matrix4() },
    uRoot: { value: new THREE.Color(0.1, 0.06, 0.035) }, uTip: { value: new THREE.Color(0.1, 0.06, 0.035) },
    uHigh: { value: new THREE.Color(0.6, 0.45, 0.25) }, uGrayCol: { value: new THREE.Color(0.7, 0.7, 0.68) },
    uOmbre: { value: 0 }, uGray: { value: 0 }, uHighAmt: { value: 0 }, uSpec: { value: 1 }, uSpec2: { value: 1 },
    uShift: { value: 0.12 }, uAO: { value: 0.35 }, uTT: { value: 0.8 }, uAmb: { value: 1 }, uRough: { value: 0.3 },
    uSheen: { value: 0.1 }, uFrame: { value: 0 },
    uAmbTop: { value: new THREE.Color(0.5, 0.5, 0.52) }, uAmbBot: { value: new THREE.Color(0.18, 0.17, 0.16) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true,
    // opaque strands with true geometric width: MSAA resolves the sub-pixel coverage and,
    // unlike alpha-to-coverage, overlapping strands hit different samples
    side: THREE.DoubleSide, transparent: false,
  });
  const depth = new THREE.ShaderMaterial({
    uniforms: {
      tPos: uniforms.tPos, tAttr: uniforms.tAttr, uK: uniforms.uK, uW: uniforms.uW, uWidth: uniforms.uWidth,
      uMinPx: { value: 1.0 }, uViewH: { value: 2048 }, uTaper: uniforms.uTaper, uWidthScale: { value: 2.5 },
      uDelta: uniforms.uDelta,
    },
    vertexShader: `${VERT_COMMON}\nvoid main() {\n${VERT_MAIN}\n gl_Position = projectionMatrix * mv; }`,
    fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide,
  });
  return { mat, depth };
}

// Melanin model -> linear RGB hair color, fitted to photographed hair swatches
// (platinum, blonde, brown, black, red, auburn): c = c0 * exp(-eu^0.55 * A - pheo * B)
export function hairColor(eumelanin, pheomelanin) {
  const e = Math.pow(Math.max(0, eumelanin), 0.55), p = Math.max(0, pheomelanin);
  const c0 = [1.473, 1.275, 0.666], A = [1.372, 1.371, 1.228], B = [0.281, 0.948, 1.228];
  const ch = (i) => Math.min(0.92, c0[i] * Math.exp(-e * A[i] - p * B[i]));
  return new THREE.Color().setRGB(ch(0), ch(1), ch(2), THREE.LinearSRGBColorSpace);
}
