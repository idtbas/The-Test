// Anatomical hair regions evaluated in the rest pose of the base mesh (meters, +y up,
// +z forward, +x = character's left). One source of truth for both strand root placement
// and the skin bake (stubble shadow, scalp shading).
//
// Output per vertex: [scalp, beard, brow, body] densities in 0..1.

const HEAD_C = [0, 0.762, 0.035];
const EAR = [0.0764, 0.7113, 0.0499];
const GLABELLA_Y = 0.756;

export const HAIRLINE_DEFAULTS = {
  hairline: 0.052,      // glabella -> front hairline height
  recession: 0.0,       // temple recession ("Geheimratsecken")
  crown: 0.0,           // crown bald spot radius
  top: 0.0,             // top balding
  sideburns: 0.0,       // sideburn extension below the default (meters)
  nape: 0.0,            // nape hairline raise (meters)
  undercut: 0.0,        // shaved sides (0..1)
  mohawk: 0.0,          // only a central strip (0..1)
};

export const BEARD_STYLES = {
  none: { label: 'Kein Bart', z: {} },
  stubble: { label: 'Dreitagebart', z: { mustache: 1, soul: 1, chin: 1, jaw: 1, cheek: 1, neck: 0.8 } },
  full: { label: 'Vollbart', z: { mustache: 1, soul: 1, chin: 1, jaw: 1, cheek: 1, neck: 1, high: 0.6 } },
  boxed: { label: 'Kurzer Vollbart', z: { mustache: 1, soul: 1, chin: 1, jaw: 1, cheek: 1, neck: 0.4 } },
  goatee: { label: 'Ziegenbart', z: { mustache: 1, soul: 1, chin: 1 } },
  circle: { label: 'Kinnbart rund', z: { mustache: 1, soul: 1, chin: 1, link: 1 } },
  vandyke: { label: 'Van Dyke', z: { mustache: 1, soul: 0.6, chin: 1, gap: 1 } },
  mustache: { label: 'Schnurrbart', z: { mustache: 1 } },
  chinstrap: { label: 'Kinnriemen', z: { jaw: 1, chin: 1, strap: 1 } },
  mutton: { label: 'Koteletten-Bart', z: { jaw: 1, cheek: 1, mustache: 1, nochin: 1 } },
};

export const BROW_DEFAULTS = {
  thickness: 1.0, arch: 1.0, length: 1.0, gap: 1.0, height: 0.0, tilt: 0.0, density: 1.0,
};

export const BODYHAIR_DEFAULTS = { arms: 0.3, legs: 0.35, chest: 0.0, belly: 0.0, back: 0.0, fur: 0.0 };

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function lerpKeys(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1], [x1, y1] = keys[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

/** Scalp hair density at rest position p. */
export function scalpDensity(p, h) {
  const x = Math.abs(p[0]), y = p[1], z = p[2];
  if (y < 0.62) return 0;
  const qx = x - HEAD_C[0], qy = y - HEAD_C[1], qz = z - HEAD_C[2];
  if (Math.hypot(qx, qy * 0.85, qz) > 0.16) return 0;
  const phi = Math.atan2(qx, qz) * 180 / Math.PI;  // 0 front .. 180 back
  const yF = GLABELLA_Y + h.hairline;
  const rec = h.recession;
  const ySb = 0.708 - h.sideburns;
  const yN = 0.662 + h.nape;
  const keys = [
    [0, yF], [20, yF + 0.002 + rec * 0.2], [32, yF + 0.004 + rec], [42, yF - 0.02 + rec * 0.5],
    [50, 0.742 + rec * 0.2], [55, ySb + 0.006], [58, ySb], [63, ySb], [66, 0.735], [72, 0.75],
    [84, 0.756], [96, 0.745], [108, 0.7], [135, yN + 0.008], [180, yN],
  ];
  const yh = lerpKeys(keys, phi);
  let d = smooth(yh - 0.002, yh + 0.007, y);
  // ears and the skin directly around them
  const ex = (x - EAR[0]) / 0.024, ey = (y - EAR[1]) / 0.036, ez = (z - EAR[2]) / 0.03;
  d *= smooth(0.9, 1.25, Math.hypot(ex, ey, ez));
  // only the outer surface of the skull (not the face below the hairline in front)
  if (phi < 40) d *= smooth(yF - 0.03, yF - 0.01, y);
  // baldness
  if (h.crown > 0) {
    const cd = Math.hypot(p[0], (y - 0.838) * 1.2, z + 0.03);
    d *= smooth(h.crown, h.crown + 0.012, cd);
  }
  if (h.top > 0) {
    const t = smooth(0.79, 0.81, y) * smooth(-0.07, -0.02, -Math.abs(phi) / 100 + 0.5 - (1 - h.top) * 0.9 + 0.43);
    d *= 1 - h.top * t;
  }
  if (h.undercut > 0) {
    d *= 1 - h.undercut * (1 - smooth(0.792, 0.802, y)) * (Math.abs(phi) > 40 ? 1 : smooth(0.0, 0.01, Math.abs(phi) - 30));
  }
  if (h.mohawk > 0) {
    d *= 1 - h.mohawk * smooth(0.018, 0.026, x);
  }
  return d;
}

/** Beard density at rest position p for a zone set z (weights 0..1). */
export function beardDensity(p, z) {
  const x = Math.abs(p[0]), y = p[1], zz = p[2];
  if (y < 0.56 || y > 0.73 || zz < -0.02) return 0;
  let d = 0;
  const front = smooth(0.02, 0.05, zz) * smooth(0.075, 0.066, x) * smooth(0.075, 0.09, zz + (0.07 - x) * 0.0);
  // cheek line: sideburn bottom -> above mouth corner
  const tx = Math.min(1, Math.max(0, (0.072 - x) / 0.042));
  // concave line from the sideburn down to the mouth corner
  const cheekLineY = 0.712 - Math.pow(tx, 0.8) * 0.05 + (z.high ? 0.008 : 0);
  const belowCheek = smooth(cheekLineY + 0.004, cheekLineY - 0.004, y);
  const lipTop = 0.6705, lipBot = 0.6488;
  const mouthW = 0.027;
  const nearLips = Math.hypot(x / 0.031, (y - 0.661) / 0.0135) < 1;
  if (z.mustache) {
    // between the nostrils and the upper lip, flaring towards the mouth corners
    const yc = 0.6765 - (x / 0.03) * (x / 0.03) * 0.006;
    const m = smooth(1.0, 0.65, Math.hypot(x / 0.031, (y - yc) / 0.0062)) * smooth(0.125, 0.14, zz);
    const noseBase = smooth(0.6775, 0.6795, y) * smooth(0.02, 0.014, x);
    d = Math.max(d, z.mustache * m * (1 - noseBase) * (y > lipTop - 0.0015 ? 1 : 0));
  }
  if (z.soul) {
    const s = smooth(1, 0.6, Math.hypot(x / 0.012, (y - 0.641) / 0.008)) * smooth(0.12, 0.14, zz);
    d = Math.max(d, z.soul * s);
  }
  if (z.chin) {
    let c = smooth(1.0, 0.75, Math.hypot(x / (z.gap ? 0.022 : 0.034), (y - 0.622) / 0.03)) * front;
    if (z.gap) c *= smooth(0.6, 0.7, Math.hypot(x / 0.03, (y - 0.648) / 0.006)) ;
    d = Math.max(d, z.chin * c * (y < lipBot - 0.003 ? 1 : 0));
  }
  if (z.link) {
    const l = smooth(0.012, 0.006, Math.abs(Math.hypot(x / 1.0, (y - 0.655) / 0.75) - 0.032)) * smooth(0.11, 0.13, zz);
    d = Math.max(d, z.link * l);
  }
  if (z.jaw && !z.strap) {
    const j = belowCheek * front * smooth(0.6, 0.64, y) * (nearLips ? 0 : 1);
    const nochin = z.nochin ? smooth(0.02, 0.035, x) : 1;
    d = Math.max(d, z.jaw * j * nochin);
  }
  if (z.strap) {
    // narrow band along the jaw line
    const jl = 0.62 + (x / 0.07) * 0.06;
    const s = smooth(0.012, 0.006, Math.abs(y - jl)) * front * smooth(0.012, 0.03, x + 0.03);
    d = Math.max(d, s);
  }
  if (z.cheek) {
    const c = belowCheek * front * smooth(0.03, 0.045, x) * smooth(0.64, 0.66, y);
    d = Math.max(d, z.cheek * c);
  }
  if (z.neck) {
    // under the jaw down to the adam's apple, front half of the neck
    const n = smooth(0.585, 0.605, y) * smooth(0.64, 0.62, y) * smooth(0.0, 0.03, zz) * smooth(0.065, 0.05, x);
    d = Math.max(d, z.neck * n);
  }
  // keep the lips, nostrils and the area right below the eyes clean
  if (nearLips && y < lipTop && y > lipBot - 0.002 && x < mouthW) d = 0;
  return Math.min(1, d);
}

/** Eyebrow density + brow coordinate (t along the brow 0 medial .. 1 tail). */
export function browDensity(p, b) {
  const x = Math.abs(p[0]), y = p[1], z = p[2];
  if (y < 0.735 || y > 0.785 || z < 0.1) return [0, 0];
  const start = 0.009 + (b.gap - 1) * 0.006, end = 0.062 + (b.length - 1) * 0.012;
  const t = (x - start) / (end - start);
  if (t < -0.15 || t > 1.08) return [0, t];
  const tc = Math.min(1, Math.max(0, t));
  // centerline: rises to the arch at ~60 %, falls off towards the tail
  const arch = Math.sin(Math.min(1, tc / 0.62) * Math.PI / 2) * (tc < 0.62 ? 1 : 1 - Math.pow((tc - 0.62) / 0.38, 1.6) * 0.75);
  const yc = 0.7475 + b.height + arch * 0.0105 * b.arch + (tc - 0.5) * b.tilt * 0.01;
  const half = (0.0052 - tc * 0.0032) * b.thickness * (tc > 0.85 ? 1 - (tc - 0.85) * 3 : 1);
  const dy = Math.abs(y - yc) / Math.max(half, 0.0006);
  let d = smooth(1.25, 0.6, dy) * smooth(-0.15, 0.06, t) * smooth(1.08, 0.9, t);
  d *= b.density;
  return [Math.min(1, d), t];
}

export function bodyHairDensity(p, n, b) {
  const x = Math.abs(p[0]), y = p[1], z = p[2];
  let d = 0;
  // head handled by other regions
  if (y > 0.58) return b.fur;
  // arms: forearms (x > 0.2) denser than upper arms
  if (x > 0.17 && y > 0.12) {
    const fore = smooth(0.28, 0.33, x);
    const hand = smooth(0.43, 0.41, x);
    d = Math.max(d, b.arms * (0.35 + 0.65 * fore) * hand);
  }
  // legs
  if (y < -0.02) {
    const shin = smooth(-0.32, -0.4, y) * smooth(-0.78, -0.72, y);
    const thigh = smooth(-0.02, -0.08, y) * smooth(-0.36, -0.3, y) * 0.55;
    d = Math.max(d, b.legs * Math.max(shin, thigh));
  }
  // chest & belly (front of torso)
  if (x < 0.15 && y > -0.02 && z > 0.03) {
    const chest = smooth(0.25, 0.32, y) * smooth(0.5, 0.45, y) * smooth(0.11, 0.04, x);
    const sternum = smooth(0.25, 0.3, y) * smooth(0.46, 0.4, y) * smooth(0.03, 0.01, x) * 0.6;
    d = Math.max(d, b.chest * Math.max(chest, sternum));
    const trail = smooth(0.32, 0.26, y) * smooth(0.04, 0.12, y) * smooth(0.02 + (0.3 - y) * 0.05, 0.006, x);
    d = Math.max(d, b.belly * Math.max(trail, smooth(0.25, 0.1, y) * smooth(0.05, 0.11, y) * smooth(0.09, 0.05, x) * 0.5));
  }
  // back
  if (x < 0.16 && y > 0.05 && z < 0.02) d = Math.max(d, b.back * smooth(0.05, 0.15, y) * smooth(0.5, 0.42, y));
  return Math.min(1, Math.max(d, b.fur));
}

/**
 * Evaluate all region densities for rest positions (meters, stride 3).
 * Returns Float32Array(n * 4) and the brow coordinate array.
 */
export function computeRegions(rest, normals, params) {
  const n = rest.length / 3;
  const out = new Float32Array(n * 4);
  const browT = new Float32Array(n);
  const zones = (BEARD_STYLES[params.beardStyle] || BEARD_STYLES.none).z;
  const p = [0, 0, 0], nn = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = rest[i * 3]; p[1] = rest[i * 3 + 1]; p[2] = rest[i * 3 + 2];
    nn[0] = normals[i * 3]; nn[1] = normals[i * 3 + 1]; nn[2] = normals[i * 3 + 2];
    out[i * 4] = params.scalp ? scalpDensity(p, params.hairline) : 0;
    out[i * 4 + 1] = beardDensity(p, zones) * params.beardDensity;
    const [bd, bt] = browDensity(p, params.brows);
    out[i * 4 + 2] = bd;
    browT[i] = bt;
    out[i * 4 + 3] = bodyHairDensity(p, nn, params.bodyHair);
  }
  return { regions: out, browT };
}
