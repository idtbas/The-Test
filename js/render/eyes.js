// Procedural eye shading: refracted iris with fibers, crypts and collarette, limbal ring,
// pupil (round to slit), sclera with vessels; plus an additive glossy cornea layer.

import * as THREE from 'three';
import { NOISE, COLOR } from './glsl.js';
import { withSSAO } from './skinMaterial.js';

export const EYE_DEFAULTS = {
  irisColor1: '#6b4a2b', irisColor2: '#3d6b8a', irisColorR1: '#6b4a2b', irisColorR2: '#3d6b8a',
  irisMix: 0.35, irisSize: 1.0, pupil: 0.35, pupilShape: 0.0, limbus: 0.65, irisDetail: 1.0,
  sclera: '#e8ddd4', scleraVeins: 0.3, heterochromia: false, glow: 0.0, seed: 0.5,
};

const PARS = /* glsl */`
uniform mat4 uEyeInv;          // world -> eye local (radius 1, +z forward, +y up)
uniform vec3 uIris1, uIris2, uSclera;
uniform float uIrisMix, uIrisR, uPupil, uSlit, uLimbus, uDetail, uVeins, uGlow, uSeed;
varying vec3 vEyeLocal;
varying vec3 vWorldPos;
${NOISE}
${COLOR}

vec3 eyeColor(vec3 p, vec3 Vl, out float irisMask) {
  // refract the view ray through the cornea dome onto the (recessed) iris plane
  float rI = 0.47 * uIrisR;
  float zPlane = sqrt(max(0.0, 1.0 - rI * rI)) - 0.03;
  vec3 q = p;
  if (p.z > zPlane - 0.05) {
    vec3 nC = normalize(p - vec3(0.0, 0.0, -0.35));     // cornea is a smaller, forward sphere
    vec3 rd = refract(Vl, nC, 1.0 / 1.376);
    float t = (zPlane - p.z) / min(rd.z, -0.05);
    q = p + rd * max(t, 0.0);
  }
  vec2 ip = q.xy / rI;
  float r = length(ip);
  float th = atan(ip.y, ip.x);
  vec2 dir = vec2(cos(th), sin(th));
  float sd = uSeed * 13.7;
  // pupil (slit stretches horizontally -> vertical slit)
  float rp = mix(0.16, 0.66, uPupil);
  float rpS = length(ip * vec2(1.0 + uSlit * 6.0, 1.0 - uSlit * 0.15));
  float pupil = smoothstep(rp + 0.02, rp - 0.02, rpS);
  // fibers + collarette + crypts
  float fib = gnoise(vec3(dir * 38.0, r * 3.0 + sd)) * 0.5 + gnoise(vec3(dir * 90.0, r * 7.0 + sd)) * 0.3;
  float wav = gnoise(vec3(dir * 6.0, sd)) * 0.06;
  float collR = mix(rp, 1.0, 0.33) + wav;
  float coll = smoothstep(0.07, 0.0, abs(r - collR));
  vec3 cw = worley(vec3(dir * 7.0, r * 5.0 + sd), 1.0);
  float crypt = smoothstep(0.35, 0.1, cw.x) * smoothstep(collR, collR + 0.1, r) * smoothstep(0.95, 0.75, r);
  float radial = smoothstep(rp, 1.0, r);
  vec3 inner = uIris1, outer = uIris2;
  vec3 iris = mix(inner, outer, smoothstep(collR - 0.1, collR + 0.35, r + fib * 0.15) * uIrisMix + (1.0 - uIrisMix) * 0.0);
  iris = mix(iris, inner * 1.25 + 0.03, coll * 0.55);
  iris *= 0.75 + 0.5 * (fib * 0.5 + 0.5) * uDetail + 0.25 * (1.0 - uDetail);
  iris *= 1.0 - crypt * 0.45 * uDetail;
  // contraction furrows: faint concentric rings in the outer iris
  float furrow = smoothstep(0.75, 1.0, sin((r - rp) * 42.0 + gnoise(vec3(dir * 4.0, sd)) * 2.0)) * smoothstep(collR + 0.1, 0.9, r);
  iris *= 1.0 - furrow * 0.18 * uDetail;
  iris *= mix(1.0, 0.55, smoothstep(0.82, 1.0, r) * uLimbus);       // limbal ring
  iris *= mix(0.7, 1.0, smoothstep(rp, rp + 0.12, r));               // pupillary ruff
  iris = mix(iris, iris * 1.6 + 0.02, smoothstep(0.03, 0.0, abs(rpS - rp - 0.025)) * 0.35);
  vec3 col = mix(iris, vec3(0.006, 0.004, 0.004), pupil);
  // sclera with vessels
  float pz = p.z;
  vec3 vd = p * 5.0 + sd;
  float vein = smoothstep(0.08, 0.0, abs(gnoise(vd))) * 0.6 + smoothstep(0.05, 0.0, abs(gnoise(vd * 2.3 + 4.0))) * 0.4;
  float periph = smoothstep(0.7, -0.2, pz) * (0.6 + 0.4 * smoothstep(0.2, 0.9, abs(p.x)));
  vec3 scl = uSclera * (0.92 + 0.08 * gnoise(p * 9.0 + sd));
  scl = mix(scl, vec3(0.55, 0.12, 0.1), clamp(vein * periph * uVeins * 1.2, 0.0, 1.0));
  scl = mix(scl, scl * vec3(1.0, 0.86, 0.8), smoothstep(0.4, -0.3, pz) * 0.5);
  // towards the corners the conjunctiva gets pinker, above/below it is shadowed and greyer
  scl = mix(scl, scl * vec3(1.0, 0.8, 0.78), smoothstep(0.35, 0.9, abs(p.x)) * 0.45);
  scl = mix(scl, scl * vec3(0.86, 0.88, 0.94), smoothstep(0.3, 0.8, abs(p.y)) * 0.5);
  // corneal limbus: soft bluish-grey transition into the sclera
  float lim = smoothstep(1.25, 1.0, r) * smoothstep(0.95, 1.05, r);
  scl = mix(scl, vec3(0.45, 0.48, 0.52) * luma(scl) * 1.6, lim * 0.35 * uLimbus);
  irisMask = smoothstep(1.06, 0.98, r) * step(zPlane - 0.15, p.z);
  return mix(scl, col, irisMask);
}
`;

export function createEyeMaterial(aoUniforms, side) {
  const u = {
    uEyeInv: { value: new THREE.Matrix4() },
    uIris1: { value: new THREE.Color() }, uIris2: { value: new THREE.Color() }, uSclera: { value: new THREE.Color() },
    uIrisMix: { value: 0.35 }, uIrisR: { value: 1 }, uPupil: { value: 0.35 }, uSlit: { value: 0 },
    uLimbus: { value: 0.6 }, uDetail: { value: 1 }, uVeins: { value: 0.3 }, uGlow: { value: 0 }, uSeed: { value: 0.5 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.12, metalness: 0, ior: 1.376, specularIntensity: 0.6,
    clearcoat: 0.0,
  });
  mat.userData.u = u;
  withSSAO(mat, aoUniforms, 'eye' + side);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aEyeLocal;\nvarying vec3 vEyeLocal;\nvarying vec3 vWorldPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeLocal = aEyeLocal;\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', `
        vec3 camL = (uEyeInv * vec4(cameraPosition, 1.0)).xyz;
        vec3 pL = normalize(vEyeLocal);
        vec3 Vl = normalize(pL - camL);
        float irisMask;
        vec3 eyeCol = eyeColor(pL, Vl, irisMask);
        diffuseColor.rgb = eyeCol;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.5, irisMask);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * irisMask * uGlow * 3.0;');
  };
  mat.customProgramCacheKey = () => 'eye' + side;
  return mat;
}

export function createCorneaMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.03, metalness: 0, ior: 1.376, specularIntensity: 1,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export function applyEyeParams(mats, p) {
  const sides = [['L', mats.L], ['R', mats.R]];
  for (const [s, m] of sides) {
    const u = m.userData.u;
    const het = p.heterochromia && s === 'R';
    u.uIris1.value.set(het ? p.irisColorR1 : p.irisColor1);
    u.uIris2.value.set(het ? p.irisColorR2 : p.irisColor2);
    u.uSclera.value.set(p.sclera);
    u.uIrisMix.value = p.irisMix;
    u.uIrisR.value = p.irisSize;
    u.uPupil.value = p.pupil;
    u.uSlit.value = p.pupilShape;
    u.uLimbus.value = p.limbus;
    u.uDetail.value = p.irisDetail;
    u.uVeins.value = p.scleraVeins;
    u.uGlow.value = p.glow;
    u.uSeed.value = p.seed + (s === 'R' ? 0.173 : 0);
  }
}
