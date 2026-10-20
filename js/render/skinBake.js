// GPU baker for the skin textures. Renders the body in UV space using the rest-pose
// position of every texel, so all procedural features are placed in anatomical space and
// keep a constant physical size regardless of how the UV islands are scaled.
//
// Output A (albedo, sRGB-encoded RGB, alpha = coverage)
// Output B (maps): R height (0.5 = neutral), G roughness, B specular/oil, A pore amount

import * as THREE from 'three';
import { NOISE, COLOR } from './glsl.js';

// Landmarks of the (constant) base mesh in meters.
export const LANDMARKS = /* glsl */`
const vec3 EYE_L = vec3(0.0308, 0.7284, 0.1245);
const vec3 NOSE_TIP = vec3(0.0, 0.6909, 0.1681);
const vec3 MOUTH = vec3(0.0, 0.6616, 0.1490);
const vec3 GLABELLA = vec3(0.0, 0.7560, 0.1534);
const vec3 EAR_L = vec3(0.0764, 0.7113, 0.0499);
const vec3 HEAD_TOP = vec3(0.0, 0.8491, 0.0696);
const vec3 NAVEL = vec3(0.0, 0.1840, 0.1362);
const vec3 AREOLA_L = vec3(0.0805, 0.3794, 0.1580);
const vec3 WRIST_L = vec3(0.4312, 0.2452, 0.1757);
const vec3 ELBOW_L = vec3(0.3129, 0.3493, 0.0132);
const vec3 KNEE_L = vec3(0.1581, -0.3695, 0.0320);
const vec3 FINGER3_L = vec3(0.4608, 0.1886, 0.2479);
`;

const VERT = /* glsl */`
in vec3 aRest;
in vec3 aRestN;
in vec4 aRegion;
in vec2 uv;
out vec3 vRest;
out vec3 vRestN;
out vec4 vRegion;
out vec2 vUv;
void main() {
  vRest = aRest; vRestN = aRestN; vRegion = aRegion; vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
in vec3 vRest;
in vec3 vRestN;
in vec4 vRegion;     // x scalp, y beard, z brow, w body hair
in vec2 vUv;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outMaps;

uniform sampler2D tMask1;   // R lips, G nails, B areola
uniform sampler2D tMask2;   // R ears, G eyelids, B mouth interior
uniform float uSeed;
uniform float uMelanin, uHemo, uUndertone, uFlush;
uniform float uFreckles, uFreckleScale, uMoles, uVeins, uSpots, uAge, uWrinkles, uMottle;
uniform vec3 uTint; uniform float uTintAmount;
uniform float uStubble; uniform vec3 uStubbleColor;
uniform float uScalpShade; uniform vec3 uHairColor;
uniform vec3 uLipColor; uniform float uLipAmount, uLipGloss;
uniform vec3 uBlushColor; uniform float uBlushAmount;
uniform vec3 uShadowColor; uniform float uShadowAmount;
uniform float uLinerAmount; uniform vec3 uLinerColor;
uniform vec3 uNailColor; uniform float uNailAmount;
uniform float uFoundation, uAreola, uLipTone, uOil, uRough;
uniform float uTanLines;
uniform float uScars;

${NOISE}
${COLOR}
${LANDMARKS}

vec3 skinTone(float mel) {
  return vec3(1.0, 0.66, 0.456) * exp(-vec3(3.28, 3.79, 4.17) * pow(max(mel, 0.0), 1.4));
}

void main() {
  vec3 p = vRest;
  vec3 pm = vec3(abs(p.x), p.y, p.z);          // mirrored for symmetric features
  vec3 n = normalize(vRestN);
  vec3 ps = p + uSeed * 7.31;
  vec4 m1 = texture(tMask1, vUv);
  vec4 m2 = texture(tMask2, vUv);
  float lips = m1.r, nails = m1.g, areola = m1.b;
  float ears = m2.r, eyelids = m2.g, mouthIn = m2.b;

  float head = smoothstep(0.585, 0.62, p.y) * (1.0 - smoothstep(0.30, 0.36, abs(p.x)));
  float face = head * smoothstep(0.02, 0.07, p.z) * (1.0 - smoothstep(0.80, 0.83, p.y));
  float age = uAge;

  // ---------------------------------------------------------------- pigment
  float mel = uMelanin;
  float hem = uHemo;
  // low frequency mottling of melanin and blood
  float mot1 = fbm(ps * 9.0, 4), mot2 = fbm(ps * 23.0 + 3.0, 3), mot3 = fbm(ps * 70.0 + 7.0, 3);
  float mottle = uMottle * (1.0 - uFoundation * 0.8);
  mel += (mot1 * 0.05 + mot3 * 0.02) * mottle;
  hem += (mot2 * 0.22 + mot3 * 0.08) * mottle;
  // large scale tone zones: warmer/redder neck & upper chest, slightly paler belly & inner arms
  hem += gauss3(p, vec3(0.0, 0.53, 0.09), vec3(0.11, 0.07, 0.08)) * 0.18;
  mel -= smoothstep(0.35, 0.05, p.y) * smoothstep(-0.25, 0.0, p.y) * smoothstep(0.0, 0.08, p.z) * 0.02;
  // redness at the alar crease, lid rims and lip surroundings
  hem += gauss3(pm, vec3(0.017, 0.688, 0.15), vec3(0.008, 0.008, 0.012)) * 0.35;
  hem += smoothstep(0.016, 0.0, abs(length((pm.xy - EYE_L.xy) * vec2(1.0, 2.0)) - 0.0145)) * face * 0.25;
  // regional redness: cheeks, nose, ears, lips surroundings, knuckles, elbows, knees
  float cheek = gauss3(pm, vec3(0.040, 0.697, 0.118), vec3(0.022, 0.018, 0.03));
  float noseR = gauss3(p, NOSE_TIP + vec3(0.0, 0.004, -0.006), vec3(0.014, 0.016, 0.02));
  float knuckle = 0.0;
  float joints = gauss3(pm, ELBOW_L + vec3(0.0, 0.0, -0.01), vec3(0.025)) + gauss3(pm, KNEE_L + vec3(0.0, 0.0, 0.03), vec3(0.03, 0.035, 0.03));
  float hands = smoothstep(0.38, 0.42, abs(p.x));
  float feet = 1.0 - smoothstep(-0.72, -0.68, p.y);
  hem += (cheek * (0.35 + uFlush * 1.1) + noseR * 0.35 + ears * 0.35 + joints * 0.25) * (1.0 - uFoundation * 0.6);
  hem += hands * 0.12 + feet * 0.18;
  // palms and soles: less melanin, more blood
  float palm = hands * smoothstep(0.1, 0.6, -dot(n, normalize(vec3(0.62, -0.55, 0.45))));
  float sole = feet * smoothstep(0.3, 0.8, -n.y);
  mel *= 1.0 - 0.55 * max(palm, sole);
  hem += max(palm, sole) * 0.25;
  // periorbital: thin, darker, bluish skin below/inside the eyes
  float dEye = length((pm - EYE_L) * vec3(1.0, 1.5, 1.0));
  float orbit = smoothstep(0.024, 0.012, dEye) * smoothstep(-0.002, -0.012, pm.y - EYE_L.y) * face;
  // genital/crotch & armpit slightly darker
  float crotch = gauss3(p, vec3(0.0, 0.03, 0.06), vec3(0.06, 0.05, 0.08));
  mel += crotch * 0.06 + areola * 0.18 * uAreola;
  hem += areola * 0.35;

  vec3 col = skinTone(mel);
  // blood: absorbs green/blue -> warmer
  col *= exp(-(hem - 0.5) * vec3(-0.12, 0.62, 0.42));
  // undertone: + olive/golden, - rosy
  col *= exp(-max(uUndertone, 0.0) * vec3(0.0, 0.07, 0.42) - max(-uUndertone, 0.0) * vec3(-0.06, 0.18, 0.02));
  col = mix(col, col * vec3(0.82, 0.78, 0.92), orbit * 0.55);
  // lips: rosy mucosa, darker and browner with more melanin; lighter vermilion border
  vec3 lipCol = mix(col * vec3(0.86, 0.5, 0.56), vec3(0.42, 0.13, 0.15) * (0.6 + 0.4 * col.r), 0.35);
  lipCol *= mix(1.0, 0.72, uMelanin) * (1.0 + uLipTone * 0.4 * vec3(0.2, -0.25, -0.1));
  lipCol *= 0.92 + 0.16 * fbm(ps * vec3(900.0, 260.0, 900.0), 2);
  float border = smoothstep(0.15, 0.45, lips) * smoothstep(0.85, 0.5, lips);
  col = mix(col, lipCol, smoothstep(0.35, 0.8, lips));
  col = mix(col, col * 1.08 + 0.01, border * 0.5);
  // mouth interior: wet mucosa
  col = mix(col, vec3(0.42, 0.10, 0.10), mouthIn);
  // nails: pink bed (blood) with paler free edge
  vec3 nailBed = mix(col, vec3(0.78, 0.55, 0.52), 0.55);
  col = mix(col, nailBed, nails);

  // ---------------------------------------------------------------- features
  // freckles: sun-exposed areas (face, shoulders, upper back, arms)
  float sunExp = max(face * 1.2, smoothstep(0.45, 0.58, p.y) * (1.0 - head) * 0.7 + smoothstep(0.1, 0.2, abs(p.x)) * (1.0 - head) * 0.35);
  sunExp *= 0.5 + 0.5 * smoothstep(-0.3, 0.6, n.y + n.z * 0.4);
  float noseBridge = gauss3(pm, vec3(0.022, 0.708, 0.14), vec3(0.04, 0.02, 0.03));
  sunExp += noseBridge * 1.2;
  vec3 fw = worley(ps * (420.0 / max(uFreckleScale, 0.2)), 1.0);
  float fr = smoothstep(0.42, 0.18, fw.x) * step(fw.z, 0.55 * uFreckles + 0.05);
  fr *= smoothstep(0.15, 0.5, sunExp * uFreckles + fbm(ps * 30.0, 2) * 0.3);
  col = mix(col, col * vec3(0.72, 0.56, 0.45), clamp(fr * (0.4 + 0.6 * hash11(fw.z * 91.0)), 0.0, 1.0) * 0.85);
  // moles
  vec3 mw = worley(ps * 38.0, 1.0);
  float mole = smoothstep(0.075, 0.05, mw.x) * step(mw.z, uMoles * 0.06) * (1.0 - lips) * (1.0 - nails);
  col = mix(col, vec3(0.10, 0.055, 0.035), mole * 0.85);
  // age spots (lentigines): hands, face, forearms
  float spotArea = max(face, hands) + smoothstep(0.25, 0.35, abs(p.x)) * 0.6;
  vec3 aw = worley(ps * 95.0, 1.0);
  float spots = smoothstep(0.35, 0.1, aw.x) * step(aw.z, 0.25) * spotArea * uSpots * smoothstep(0.55, 0.9, age);
  col = mix(col, col * vec3(0.7, 0.58, 0.48), spots * 0.6);
  // veins: subtle blue-green under thin skin (inner wrists, temples, chest, breasts)
  float veinArea = gauss3(pm, WRIST_L + vec3(-0.02, 0.03, -0.01), vec3(0.06, 0.08, 0.05)) * smoothstep(-0.2, 0.4, n.y)
                 + gauss3(pm, vec3(0.06, 0.765, 0.09), vec3(0.015, 0.02, 0.02))
                 + gauss3(pm, AREOLA_L + vec3(0.0, 0.02, 0.0), vec3(0.06, 0.05, 0.05)) * 0.6;
  float vn = abs(fbm(ps * vec3(60.0, 25.0, 60.0), 3));
  float vein = smoothstep(0.06, 0.0, vn) * veinArea * uVeins * (1.0 - uMelanin * 0.8);
  col = mix(col, col * vec3(0.78, 0.86, 1.0), vein * 0.7);
  // tan lines (lighter where swimwear would be)
  float swim = (1.0 - smoothstep(0.02, 0.05, abs(p.y - 0.06) - 0.06)) * smoothstep(0.0, 0.03, 0.17 - abs(p.x));
  col = mix(col, col * vec3(1.18, 1.24, 1.3), swim * uTanLines);

  // stubble shadow (dense hair follicles under the skin)
  float beard = vRegion.y;
  vec3 stubbleW = worley(ps * 900.0, 1.0);
  float follicle = smoothstep(0.5, 0.15, stubbleW.x);
  float stub = beard * uStubble;
  col = mix(col, col * mix(vec3(1.0), uStubbleColor * 1.6 + 0.05, 0.6), stub * (0.35 + 0.5 * follicle));
  // scalp: hair follicles + slight greying under hair
  float scalp = vRegion.x * uScalpShade;
  col = mix(col, col * (uHairColor * 1.2 + 0.25), scalp * (0.25 + 0.45 * follicle));

  // ---------------------------------------------------------------- makeup
  float blush = gauss3(pm, vec3(0.045, 0.700, 0.112), vec3(0.020, 0.014, 0.03)) * face;
  col = mix(col, col * uBlushColor * 2.2, clamp(blush * uBlushAmount, 0.0, 1.0) * 0.55);
  float lid = eyelids * smoothstep(-0.002, 0.004, pm.y - EYE_L.y);
  float shadowArea = clamp(lid * 1.3 + gauss3(pm, EYE_L + vec3(0.006, 0.012, 0.0), vec3(0.022, 0.009, 0.03)) * face * 0.8, 0.0, 1.0);
  col = mix(col, uShadowColor, shadowArea * uShadowAmount * 0.85);
  float liner = eyelids * smoothstep(0.0055, 0.0, abs(length((pm.xy - EYE_L.xy) * vec2(1.0, 2.2)) - 0.0145));
  col = mix(col, uLinerColor, clamp(liner * uLinerAmount * 1.5, 0.0, 1.0));
  col = mix(col, uLipColor, lips * uLipAmount);
  col = mix(col, uNailColor, nails * uNailAmount);

  // fantasy tint (beyond realism): keep shading detail via luminance
  vec3 tinted = uTint * (luma(col) / 0.3) * 0.7 + col * 0.15;
  col = mix(col, tinted, uTintAmount);

  // ---------------------------------------------------------------- height
  float h = 0.0;
  float wr = clamp((age - 0.42) / 0.58, 0.0, 1.0) * 1.2 + uWrinkles;
  // forehead lines
  float fh = face * smoothstep(0.755, 0.77, p.y) * (1.0 - smoothstep(0.80, 0.815, p.y)) * (1.0 - smoothstep(0.045, 0.06, abs(p.x)));
  float fl = sin((p.y + fbm(ps * 40.0, 2) * 0.004) * 2.0 * 3.14159 / 0.0072);
  h -= fh * smoothstep(0.6, 1.0, fl) * 0.5 * wr;
  // glabella "11" lines
  float gl = gauss3(pm, GLABELLA + vec3(0.006, 0.006, 0.0), vec3(0.004, 0.012, 0.02));
  h -= gl * smoothstep(0.0012, 0.0, abs(pm.x - 0.006)) * 0.6 * wr;
  // crow's feet
  vec2 ce = pm.xy - (EYE_L.xy + vec2(0.017, 0.0));
  float cf = smoothstep(0.022, 0.006, length(ce)) * smoothstep(0.0, 0.004, ce.x) * face;
  float ca = atan(ce.y, ce.x);
  h -= cf * smoothstep(0.55, 1.0, sin(ca * 22.0 + fbm(ps * 50.0, 2) * 2.0)) * 0.45 * wr;
  // under-eye lines
  float ue = smoothstep(0.012, 0.0, abs(length((pm.xy - EYE_L.xy) * vec2(1.0, 1.6)) - 0.019)) * smoothstep(0.0, -0.006, pm.y - EYE_L.y) * face;
  h -= ue * 0.35 * wr;
  // nasolabial fold shading line
  vec2 nl0 = vec2(0.016, 0.677), nl1 = vec2(0.03, 0.648);
  vec2 nd = pm.xy - nl0, nv = nl1 - nl0;
  float t = clamp(dot(nd, nv) / dot(nv, nv), 0.0, 1.0);
  float nlf = smoothstep(0.004, 0.0, length(nd - nv * t)) * face * smoothstep(0.1, 0.16, p.z);
  h -= nlf * 0.5 * (0.3 + wr);
  // neck rings
  float neck = smoothstep(0.55, 0.57, p.y) * (1.0 - smoothstep(0.61, 0.63, p.y)) * smoothstep(0.0, 0.04, p.z);
  h -= neck * smoothstep(0.7, 1.0, sin(p.y * 6.2832 / 0.014 + fbm(ps * 20.0, 2) * 2.0)) * 0.35 * (0.25 + wr);
  // lip vertical lines
  h -= lips * smoothstep(0.5, 1.0, sin(p.x * 6.2832 / 0.0016 + fbm(ps * 120.0, 2) * 3.0)) * 0.22;
  // finger joint creases and knuckle wrinkles
  float fingers = smoothstep(0.43, 0.46, abs(p.x));
  float creases = smoothstep(0.75, 1.0, sin(length(pm - FINGER3_L) * 6.2832 / 0.0045 + fbm(ps * 80.0, 2) * 2.0));
  h -= fingers * creases * 0.25 * (0.6 + wr * 0.5);
  // palm lines
  float pl = palm * smoothstep(0.03, 0.0, abs(fbm(ps * vec3(14.0, 6.0, 14.0), 3)));
  h -= pl * 0.45;
  // elbows / knees wrinkles
  h -= joints * smoothstep(0.6, 1.0, sin(p.y * 6.2832 / 0.005 + fbm(ps * 30.0, 2) * 3.0)) * 0.35;
  // navel depth accent
  h -= gauss3(p, NAVEL, vec3(0.006, 0.008, 0.01)) * 0.6;
  // scars (optional): a couple of thin raised lines
  float sc = smoothstep(0.0015, 0.0, abs(fbm(ps * 6.0, 2) - 0.0)) * step(0.0, fbm(ps * 3.0 + 9.0, 2)) * uScars;
  h += sc * 0.4;
  col = mix(col, col * vec3(1.08, 0.92, 0.92), sc * 0.6);
  // fine "skin tile" texture
  float tile = (fbm(ps * vec3(380.0, 900.0, 380.0), 2) + fbm(ps * vec3(900.0, 380.0, 900.0), 2)) * 0.5;
  h += tile * 0.08 * (1.0 - lips) * (1.0 - nails);

  // ---------------------------------------------------------------- roughness / oil / pores
  float tz = gauss3(p, vec3(0.0, 0.73, 0.15), vec3(0.018, 0.06, 0.04)) + gauss3(p, vec3(0.0, 0.775, 0.14), vec3(0.04, 0.02, 0.03));
  float oil = clamp(0.35 + tz * 0.5 + face * 0.1 + lips * 0.4 + mouthIn, 0.0, 1.0) * uOil;
  // specular breakup: roughness and oil vary on the mm-cm scale
  float rv = fbm(ps * 140.0 + 11.0, 3);
  oil *= 0.8 + 0.4 * (rv * 0.5 + 0.5);
  float rough = uRough + (1.0 - face) * 0.06 - tz * 0.08 - lips * (0.12 + uLipGloss * 0.25) - nails * 0.35 - mouthIn * 0.4
               + palm * 0.08 + mot2 * 0.04 + rv * 0.05 + wr * 0.03;
  rough -= lips * uLipAmount * uLipGloss * 0.2;
  float pores = clamp(face * (0.55 + noseR * 1.0 + cheek * 0.5) + (1.0 - face) * 0.28, 0.0, 1.0) * (1.0 - lips) * (1.0 - nails) * (1.0 - mouthIn);
  pores *= 1.0 - eyelids * 0.7;
  pores *= 1.0 - uFoundation * 0.5;

  // translucency mask (where light can actually pass through thin tissue), stored in
  // albedo alpha as 0.5 + 0.5 * t so that alpha > 0.25 still marks texel coverage
  float fingersT = smoothstep(0.44, 0.47, abs(p.x));
  float toes = (1.0 - smoothstep(-0.80, -0.78, p.y)) * smoothstep(0.17, 0.2, p.z);
  float trans = max(max(ears, noseR * 0.55), max(fingersT * 0.7, toes * 0.4));
  trans = max(trans, 0.12) * (1.0 - eyelids) * (1.0 - mouthIn) * (1.0 - lips * 0.5);
  outAlbedo = vec4(linearToSrgb(clamp(col, 0.0, 1.0)), 0.5 + 0.5 * trans);
  outMaps = vec4(clamp(0.5 + h * 0.25, 0.0, 1.0), clamp(rough, 0.05, 1.0), clamp(oil, 0.0, 1.0), pores);
}`;

const DILATE = /* glsl */`
precision highp float;
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
void main() {
  vec4 a = texture(tA, vUv), b = texture(tB, vUv);
  if (a.a > 0.25) { oA = a; oB = b; return; }
  vec4 sa = vec4(0.0), sb = vec4(0.0); float w = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * uTexel;
    vec4 na = texture(tA, vUv + o);
    if (na.a > 0.25) { sa += na; sb += texture(tB, vUv + o); w += 1.0; }
  }
  if (w > 0.0) { oA = sa / w; oB = sb / w; } else { oA = a; oB = b; }
}`;

const QUAD_VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const SKIN_DEFAULTS = {
  melanin: 0.18, hemo: 0.5, undertone: 0.1, flush: 0.3, freckles: 0.0, freckleScale: 1.0, moles: 0.35,
  veins: 0.4, spots: 0.5, wrinkles: 0.0, mottle: 1.0, tint: '#5aa05a', tintAmount: 0.0,
  stubble: 0.0, stubbleColor: '#2a1d14', foundation: 0.0, areola: 1.0, lipTone: 0.0,
  oil: 0.6, rough: 0.5, tanLines: 0.0, scars: 0.0,
  lipColor: '#a3263a', lipAmount: 0.0, lipGloss: 0.5,
  blushColor: '#d4606a', blushAmount: 0.0,
  shadowColor: '#5a3d52', shadowAmount: 0.0,
  linerColor: '#120c0c', linerAmount: 0.0,
  nailColor: '#b0123a', nailAmount: 0.0,
  seed: 0.37,
};

export class SkinBaker {
  constructor(renderer, character, size = 2048) {
    this.renderer = renderer;
    this.size = size;
    const opts = {
      count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
      generateMipmaps: false,
    };
    this.rtBake = new THREE.WebGLRenderTarget(size, size, opts);
    this.rtOut = new THREE.WebGLRenderTarget(size, size, { ...opts, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
    for (const t of this.rtOut.textures) { t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; }
    const loader = new THREE.TextureLoader();
    const tex = (url) => {
      const t = loader.load(new URL(`../../data/${url}`, import.meta.url).href, () => { this.dirty = true; });
      t.colorSpace = THREE.NoColorSpace; t.flipY = true;
      return t;
    };
    this.mask1 = tex('masks.png');
    this.mask2 = tex('masks2.png');

    const body = character.parts.body;
    const sd = body.sd;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sd.numRender * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(body.uv, 2));
    geo.setAttribute('aRest', new THREE.BufferAttribute(body.rest, 3));
    // rest normals from the subdivided base mesh
    const restN = new Float32Array(sd.numRender * 3);
    sd.update(character.assets.mesh.positions);
    sd.scatter(sd.newNrm, 3, restN);
    geo.setAttribute('aRestN', new THREE.BufferAttribute(restN, 3));
    this.region = new THREE.BufferAttribute(new Float32Array(sd.numRender * 4), 4);
    geo.setAttribute('aRegion', this.region);
    geo.setIndex(new THREE.BufferAttribute(body.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);

    const uniforms = {
      tMask1: { value: this.mask1 }, tMask2: { value: this.mask2 },
      uSeed: { value: 0.37 }, uAge: { value: 0.5 },
      uHairColor: { value: new THREE.Color(0.1, 0.07, 0.05) }, uScalpShade: { value: 0 },
    };
    for (const [k, v] of Object.entries(SKIN_DEFAULTS)) {
      const name = 'u' + k[0].toUpperCase() + k.slice(1);
      uniforms[name] = { value: typeof v === 'string' ? new THREE.Color(v) : v };
    }
    this.uniforms = uniforms;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms, vertexShader: 'precision highp float;\n' + VERT.replace('in vec2 uv;', 'in vec2 uv;\nin vec3 position;'),
      fragmentShader: FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.dilateMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { tA: { value: null }, tB: { value: null }, uTexel: { value: new THREE.Vector2(1 / size, 1 / size) } },
      vertexShader: 'precision highp float;\nin vec3 position;\n' + QUAD_VERT, fragmentShader: DILATE,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dilateMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.rtTmp = new THREE.WebGLRenderTarget(size, size, opts);
    this.dirty = true;
  }

  get albedo() { return this.rtOut.textures[0]; }
  get maps() { return this.rtOut.textures[1]; }

  set(params) {
    for (const [k, v] of Object.entries(params)) {
      const u = this.uniforms['u' + k[0].toUpperCase() + k.slice(1)];
      if (!u) continue;
      if (u.value && u.value.isColor) u.value.set(v); else u.value = v;
    }
    this.dirty = true;
  }

  setRegions(regionArray) {
    this.region.array.set(regionArray);
    this.region.needsUpdate = true;
    this.dirty = true;
  }

  bake() {
    if (!this.dirty) return false;
    this.dirty = false;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtBake);
    r.clear();
    r.render(this.scene, this.cam);
    // dilate islands to hide seams: ping-pong bake -> tmp -> bake ..., last into out
    let src = this.rtBake, dst = this.rtTmp;
    const passes = 8;
    for (let i = 0; i < passes; i++) {
      const last = i === passes - 1;
      const target = last ? this.rtOut : dst;
      this.dilateMat.uniforms.tA.value = src.textures[0];
      this.dilateMat.uniforms.tB.value = src.textures[1];
      r.setRenderTarget(target);
      r.render(this.quadScene, this.cam);
      if (!last) { const t = src; src = dst; dst = t; }
    }
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    return true;
  }
}
