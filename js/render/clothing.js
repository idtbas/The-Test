// Garments cut out of MakeHuman's "tights" helper (a skin-tight suit that follows every
// morph). Regions are selected with skin weights so that seams follow the anatomy, e.g.
// the leg openings follow the groin crease.

import * as THREE from 'three';
import { DM } from '../core/character.js';
import { withSSAO } from './skinMaterial.js';
import { NOISE } from './glsl.js';
import { chips, color, section, hint } from '../ui/controls.js';

const GROUPS = {
  hip: ['root', 'pelvis.L', 'pelvis.R', 'spine05'],
  leg: ['upperleg01.L', 'upperleg01.R', 'upperleg02.L', 'upperleg02.R'],
  calf: ['lowerleg01.L', 'lowerleg01.R', 'lowerleg02.L', 'lowerleg02.R', 'foot.L', 'foot.R'],
  arm: ['upperarm01.L', 'upperarm01.R', 'upperarm02.L', 'upperarm02.R'],
  fore: ['lowerarm01.L', 'lowerarm01.R', 'lowerarm02.L', 'lowerarm02.R', 'wrist.L', 'wrist.R'],
  shoulder: ['shoulder01.L', 'shoulder01.R', 'clavicle.L', 'clavicle.R'],
  neck: ['neck01', 'neck02', 'neck03', 'head'],
};
const GKEYS = Object.keys(GROUPS);

export const TOPS = {
  none: { label: 'Ohne' },
  bandeau: { label: 'Bandeau' },
  bra: { label: 'Sport-BH' },
  tank: { label: 'Tanktop' },
  tshirt: { label: 'T-Shirt' },
  longsleeve: { label: 'Langarm' },
};
export const BOTTOMS = {
  none: { label: 'Ohne' },
  briefs: { label: 'Slip' },
  boxers: { label: 'Boxershorts' },
  shorts: { label: 'Shorts' },
  leggings: { label: 'Leggings' },
};

export const CLOTHING_DEFAULTS = {
  top: 'bandeau', bottom: 'briefs', topColor: '#2a2c33', bottomColor: '#2a2c33',
  topRough: 0.8, bottomRough: 0.8, topSheen: 0.6, bottomSheen: 0.6, knit: 1,
};

// Garment masks as continuous "margins" of the rest position p (meters) and group weights
// g: positive inside. Intersection = min, union = max. Weights are scaled (x 0.06) so that
// a weight step of 0.1 is comparable to 6 mm; interpolated per fragment this gives
// smooth hem lines instead of jagged triangle edges.
const W = 0.06;
const inside = (...m) => Math.min(...m);
const either = (...m) => Math.max(...m);
const between = (v, lo, hi) => Math.min(v - lo, hi - v);

function topMask(kind, p, g) {
  const y = p[1], ax = Math.abs(p[0]), z = p[2];
  const armW = g.arm + g.fore, sh = g.shoulder;
  switch (kind) {
    case 'bandeau': return inside(between(y, 0.325, 0.43), (0.2 - armW) * W, (0.55 - sh) * W, 0.17 - ax);
    case 'bra': {
      const band = between(y, 0.31, 0.44);
      const strap = inside(between(y, 0.43, 0.56), between(ax, 0.048, 0.072), (0.95 - sh) * W);
      const back = inside(-z, between(y, 0.31, 0.47));
      return inside(either(band, strap, back), (0.15 - armW) * W, (0.05 - g.neck) * W, 0.18 - ax);
    }
    case 'tank': {
      const scoop = inside(y - 0.47, z - 0.04, 0.075 - (y - 0.47) * 0.2 - ax);
      const armhole = inside(ax - 0.135, y - 0.38);
      return inside(between(y, 0.105, 0.58), (0.12 - armW) * W, (0.25 - g.neck) * W, (0.75 - sh) * W, -scoop, -armhole);
    }
    case 'tshirt': {
      const neck = inside(y - 0.5, z - 0.05, 0.06 - ax);
      return inside((0.3 - g.neck) * W, (0.05 - g.fore) * W, y - 0.07, -neck, 0.33 - ax);
    }
    case 'longsleeve': {
      const neck = inside(y - 0.5, z - 0.05, 0.055 - ax);
      return inside((0.3 - g.neck) * W, y - 0.07, -neck, 0.43 - ax);
    }
    default: return -1;
  }
}

// Height of the leg opening of briefs: rises steeply along the groin crease at the front,
// runs flatter under the buttocks at the back (crotch at y = -0.042).
function legLine(ax, z) {
  const front = -0.04 + Math.max(0, ax - 0.018) * 1.05;
  const back = -0.06 + Math.max(0, ax - 0.018) * 0.42;
  const t = Math.min(1, Math.max(0, (z + 0.03) / 0.09));
  return back + (front - back) * t * t * (3 - 2 * t);
}

function bottomMask(kind, p) {
  const y = p[1], ax = Math.abs(p[0]);
  switch (kind) {
    case 'briefs': return inside(0.108 - y, y - legLine(ax, p[2]), 0.2 - ax);
    case 'boxers': return inside(between(y, -0.16, 0.12), 0.24 - ax);
    case 'shorts': return inside(between(y, -0.28, 0.135), 0.24 - ax);
    case 'leggings': return inside(between(y, -0.74, 0.13), 0.24 - ax);
    default: return -1;
  }
}

const FABRIC_PARS = /* glsl */`
attribute vec3 aRest;
attribute float aMask;
varying vec3 vRestC;
varying float vMask;
uniform float uInflate;
`;

export class Clothing {
  constructor(app) {
    this.app = app;
    const ch = app.character;
    this.ch = ch;
    this.params = { ...CLOTHING_DEFAULTS };
    const part = ch.parts.tights;
    const sd = part.sd;
    const base = ch.assets.mesh.positions;
    // rest positions & group weights per render vertex
    const restNew = sd.subdivideAttr(base, 3);
    this.rest = sd.scatter(restNew, 3, new Float32Array(sd.numRender * 3), DM);
    const nv = ch.nv;
    const gw = new Float32Array(nv * GKEYS.length);
    const S = ch.skeleton;
    const boneGroup = new Int8Array(S.n).fill(-1);
    GKEYS.forEach((k, gi) => { for (const b of GROUPS[k]) { const i = S.byName.get(b); if (i !== undefined) boneGroup[i] = gi; } });
    const W = ch.weights;
    for (let v = 0; v < nv; v++) {
      for (let k = W.offsets[v]; k < W.offsets[v + 1]; k++) {
        const gi = boneGroup[W.bones[k]];
        if (gi >= 0) gw[v * GKEYS.length + gi] += W.weights[k];
      }
    }
    const gNew = sd.subdivideAttr(gw, GKEYS.length);
    this.gw = sd.scatter(gNew, GKEYS.length, new Float32Array(sd.numRender * GKEYS.length));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(part.position, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRest', new THREE.BufferAttribute(this.rest, 3));
    this.geo = geo;
    this.meshes = {};
    for (const slot of ['top', 'bottom']) {
      const mat = this._fabric(slot);
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.layers.enable(2);
      m.visible = false;
      app.scene.add(m);
      this.meshes[slot] = m;
    }
    this.set({});
  }

  _fabric(slot) {
    const u = { uInflate: { value: slot === 'top' ? 0.0022 : 0.0018 }, uKnit: { value: 1 }, uTime: { value: 0 } };
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2c33, roughness: 0.8, metalness: 0, sheen: 0.6, sheenRoughness: 0.55,
      sheenColor: new THREE.Color(0.6, 0.6, 0.62), side: THREE.DoubleSide,
    });
    mat.userData.u = u;
    withSSAO(mat, this.app.skinU, 'fabric-' + slot);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      prev(shader, r);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + FABRIC_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * uInflate;\nvRestC = aRest;\nvMask = aMask;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vRestC;\nvarying float vMask;\nuniform float uKnit;\n${NOISE}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vMask < 0.0) discard;')
        .replace('#include <normal_fragment_maps>', `
          {
            // knitted jersey: fine stitched ribs, faded out when smaller than a pixel
            vec3 q = vRestC * vec3(1100.0, 1700.0, 1100.0);
            float fw = length(fwidth(vRestC)) * 1100.0;
            float rib = sin(q.x + q.z) * 0.5 + 0.5;
            float st = sin(q.y + rib * 1.4);
            float hgt = (st * 0.6 + gnoise(vRestC * 600.0) * 0.4) * 0.00012 * uKnit * smoothstep(1.2, 0.3, fw);
            vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
            float dHx = dFdx(hgt), dHy = dFdy(hgt);
            vec3 R1 = cross(dpdy, normal), R2 = cross(normal, dpdx);
            float det = dot(dpdx, R1) * faceDirection;
            normal = normalize(abs(det) * normal - sign(det) * (dHx * R1 + dHy * R2));
          }`);
    };
    mat.customProgramCacheKey = () => 'fabric-' + slot;
    return mat;
  }

  set(p) {
    Object.assign(this.params, p);
    const P = this.params;
    const part = this.ch.parts.tights;
    const idx = part.index;
    const G = GKEYS.length;
    const gAt = (v) => { const o = {}; GKEYS.forEach((k, i) => { o[k] = this.gw[v * G + i]; }); return o; };
    const n = this.rest.length / 3;
    for (const slot of ['top', 'bottom']) {
      const kind = P[slot];
      const m = this.meshes[slot];
      const sel = [];
      const mask = new Float32Array(n);
      if (kind !== 'none') {
        for (let v = 0; v < n; v++) {
          const p = [this.rest[v * 3], this.rest[v * 3 + 1], this.rest[v * 3 + 2]];
          mask[v] = slot === 'top' ? topMask(kind, p, gAt(v)) : bottomMask(kind, p);
        }
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t], b = idx[t + 1], c = idx[t + 2];
          if (mask[a] > 0 || mask[b] > 0 || mask[c] > 0) sel.push(a, b, c);
        }
      }
      m.geometry.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
      m.geometry.setIndex(sel.length ? sel : null);
      m.visible = sel.length > 0;
      const mat = m.material;
      mat.color.set(slot === 'top' ? P.topColor : P.bottomColor);
      mat.roughness = slot === 'top' ? P.topRough : P.bottomRough;
      mat.sheen = slot === 'top' ? P.topSheen : P.bottomSheen;
      mat.userData.u.uKnit.value = P.knit;
    }
    this.app.requestRender();
  }

  sync() {
    const g = this.geo;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }

  uiSections(ui) {
    const P = this.params;
    const opt = (o) => Object.entries(o).map(([id, v]) => ({ label: v.label, value: id }));
    const s = (key, label, min, max) => ui.S({ label, min, max, emin: min, emax: max, def: undefined, get: () => P[key], set: (v) => this.set({ [key]: v }) });
    return [
      section('Oberteil', [
        chips({ label: 'Oberteil', options: opt(TOPS), get: () => P.top, set: (v) => this.set({ top: v }) }, ui.ctx),
        color({ label: 'Farbe', get: () => P.topColor, set: (v) => this.set({ topColor: v }) }, ui.ctx),
        s('topRough', 'Stoff matt ↔ glänzend', 0.35, 1), s('topSheen', 'Stoff-Schimmer', 0, 1),
      ]),
      section('Unterteil', [
        chips({ label: 'Unterteil', options: opt(BOTTOMS), get: () => P.bottom, set: (v) => this.set({ bottom: v }) }, ui.ctx),
        color({ label: 'Farbe', get: () => P.bottomColor, set: (v) => this.set({ bottomColor: v }) }, ui.ctx),
        s('bottomRough', 'Stoff matt ↔ glänzend', 0.35, 1), s('bottomSheen', 'Stoff-Schimmer', 0, 1),
      ]),
      section('Material', [s('knit', 'Strickstruktur', 0, 2), hint('Die Kleidung passt sich automatisch jeder Körperform an.')]),
    ];
  }
}
