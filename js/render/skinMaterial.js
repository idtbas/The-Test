// Skin material: MeshPhysicalMaterial extended with baked albedo/maps, physically scaled
// procedural pores, screen-space subsurface scattering hooks, thickness based light
// transmission and screen-space ambient occlusion.
//
// SSS_PASS 1: irradiance pass (diffuse light * albedo^pre) -> blurred by the SSS filter
// SSS_PASS 2: final pass, combines blurred diffuse with specular + transmission
// SSS_PASS 0: single pass fallback without screen-space scattering

import * as THREE from 'three';
import { NOISE, COLOR } from './glsl.js';

export const AO_PARS = /* glsl */`
uniform sampler2D tSSAO;
uniform vec2 uScreenInv;
uniform float uAOStrength;
float screenAO() {
  float ao = texture2D(tSSAO, gl_FragCoord.xy * uScreenInv).r;
  return mix(1.0, ao, uAOStrength);
}`;

export const AO_APPLY = /* glsl */`
  float ambientOcclusion = screenAO();
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
  #endif
`;

export function sharedSkinUniforms() {
  return {
    tAlbedo: { value: null },
    tMaps: { value: null },
    tSSS: { value: null },
    tSSAO: { value: null },
    uScreenInv: { value: new THREE.Vector2(1, 1) },
    uAOStrength: { value: 0.85 },
    uSSSPre: { value: 0.5 },
    uPores: { value: 1.0 },
    uPoreSize: { value: 0.00032 },
    uPoreDepth: { value: 0.00006 },
    uWrinkleDepth: { value: 0.0006 },
    uSpecular: { value: 1.0 },
    uWet: { value: 0.0 },
    uTranslucency: { value: 1.0 },
    uTransScale: { value: 0.32 },
    uMicro: { value: 1.0 },
  };
}

const VERT_PARS = /* glsl */`
attribute vec3 aRest;
attribute float aThick;
varying vec3 vRest;
varying float vThick;
varying vec2 vSkinUv;
varying vec3 vGeoNormal;
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D tAlbedo;
uniform sampler2D tMaps;
uniform sampler2D tSSS;
uniform float uSSSPre, uPores, uPoreSize, uPoreDepth, uWrinkleDepth, uSpecular, uWet;
uniform float uTranslucency, uTransScale, uMicro;
varying vec3 vRest;
varying float vThick;
varying vec2 vSkinUv;
varying vec3 vGeoNormal;
${NOISE}
${COLOR}
${AO_PARS}

// Bump mapping with physically scaled height (same units as the view-space position).
vec3 perturbPhys(vec3 pos, vec3 N, float H, float faceDir) {
  vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
  float dHx = dFdx(H), dHy = dFdy(H);
  vec3 R1 = cross(dpdy, N), R2 = cross(N, dpdx);
  float det = dot(dpdx, R1) * faceDir;
  vec3 grad = sign(det) * (dHx * R1 + dHy * R2);
  return normalize(abs(det) * N - grad);
}

// Separable SSS transmittance profile (Jimenez et al.)
vec3 transProfile(float s) {
  float d = -s * s;
  return vec3(0.233, 0.455, 0.649) * exp(d / 0.0064) + vec3(0.1, 0.336, 0.344) * exp(d / 0.0484)
       + vec3(0.118, 0.198, 0.0) * exp(d / 0.187) + vec3(0.113, 0.007, 0.007) * exp(d / 0.567)
       + vec3(0.358, 0.004, 0.0) * exp(d / 1.99) + vec3(0.078, 0.0, 0.0) * exp(d / 7.41);
}
`;

export function createSkinMaterial(uniforms, pass) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    ior: 1.4,
    specularIntensity: 1,
    sheen: 0.35,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0.55, 0.5, 0.48),
    clearcoat: 0.18,
    clearcoatRoughness: 0.32,
  });
  mat.defines = { SSS_PASS: pass };
  mat.customProgramCacheKey = () => 'skin' + pass;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRest = aRest; vThick = aThick; vSkinUv = uv;
        vGeoNormal = normalize(normalMatrix * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', `
        vec4 skinA = texture2D(tAlbedo, vSkinUv);
        vec4 skinM = texture2D(tMaps, vSkinUv);
        vec3 skinAlbedo = srgbToLinear(skinA.rgb);
        {
          // sub-texel speckle (follicles, tiny capillaries), faded where it would alias
          float spFoot = length(fwidth(vRest));
          float spFade = smoothstep(0.0012, 0.0004, spFoot) * uMicro;
          if (spFade > 0.0) {
            vec2 sw = worleyFast(vRest / 0.0011);
            float speck = smoothstep(0.32, 0.0, sw.x) * (sw.y - 0.35);
            skinAlbedo *= 1.0 + (speck * 0.12 + gnoise(vRest * 1400.0) * 0.035) * spFade;
          }
        }
        diffuseColor.rgb *= pow(skinAlbedo, vec3(uSSSPre));`)
      .replace('#include <roughnessmap_fragment>', `
        float poreFoot = length(fwidth(vRest));
        float poreFade = smoothstep(uPoreSize * 1.6, uPoreSize * 0.45, poreFoot);
        float roughnessFactor = roughness * 2.0 * skinM.g;
        // unresolved pores still roughen the specular lobe
        roughnessFactor = mix(roughnessFactor + 0.06 * skinM.a * uPores, roughnessFactor, poreFade);
        roughnessFactor = mix(roughnessFactor, 0.18, uWet);`)
      .replace('#include <normal_fragment_maps>', `
        {
          float H = (skinM.r - 0.5) * uWrinkleDepth;
          if (poreFade > 0.001) {
            vec2 wf = worleyFast(vRest / uPoreSize);
            float pit = smoothstep(0.38 + 0.12 * wf.y, 0.05, wf.x);
            float micro = gnoise(vRest * (1.0 / (uPoreSize * 0.45))) * 0.25;
            H += (-pit + micro * uMicro) * uPoreDepth * skinM.a * uPores * poreFade;
          }
          normal = perturbPhys(-vViewPosition, normal, H, faceDirection);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor *= uSpecular * (0.55 + 0.9 * skinM.b) * (1.0 + uWet);
        #ifdef USE_CLEARCOAT
          material.clearcoat *= (0.4 + 1.2 * skinM.b) + uWet * 3.0;
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.08, uWet);
        #endif`)
      .replace('#include <aomap_fragment>', AO_APPLY)
      .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `
        #if SSS_PASS == 1
          gl_FragColor = vec4(totalDiffuse, 1.0);
          return;
        #endif
        vec3 transmit = vec3(0.0);
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 Ng = normalize(vGeoNormal);
          vec3 Lsum = vec3(0.0);
          DirectionalLight dl;
          #pragma unroll_loop_start
          for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
            dl = directionalLights[ i ];
            Lsum += dl.color * pow(saturate(dot(-Ng, dl.direction) * 0.9 + 0.1), 1.5);
          }
          #pragma unroll_loop_end
          float transMask = saturate(skinA.a * 2.0 - 1.0);
          transmit = Lsum * transProfile(max(vThick * 1000.0, 2.5) * uTransScale) * skinAlbedo * uTranslucency * transMask;
        }
        #endif
        vec3 postAlb = pow(skinAlbedo, vec3(1.0 - uSSSPre));
        #if SSS_PASS == 2
          vec4 sss = texture2D(tSSS, gl_FragCoord.xy * uScreenInv);
          vec3 diffuseOut = mix(totalDiffuse, sss.rgb, sss.a) * postAlb;
        #else
          vec3 diffuseOut = totalDiffuse * postAlb;
        #endif
        vec3 outgoingLight = diffuseOut + totalSpecular + transmit + totalEmissiveRadiance;`);
  };
  return mat;
}

/** Add screen-space AO to any standard/physical material. */
export function withSSAO(mat, uniforms, key) {
  mat.customProgramCacheKey = () => 'ssao-' + key;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.tSSAO = uniforms.tSSAO;
    shader.uniforms.uScreenInv = uniforms.uScreenInv;
    shader.uniforms.uAOStrength = uniforms.uAOStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + AO_PARS)
      .replace('#include <aomap_fragment>', AO_APPLY);
  };
  return mat;
}
