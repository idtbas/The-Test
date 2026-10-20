// Hair manager: regions -> worker jobs -> strand meshes (scalp, brows, lashes, beard,
// body hair). Between regenerations the head-attached sets follow the head rigidly.

import * as THREE from 'three';
import { computeRegions, HAIRLINE_DEFAULTS, BROW_DEFAULTS, BODYHAIR_DEFAULTS } from '../core/regions.js';
import { createStrandTemplate, createHairMaterial, hairColor } from './hairMaterial.js';
import { DM } from '../core/character.js';
import { Skeleton } from '../core/skeleton.js';

export const HAIR_DEFAULTS = {
  style: 'sidepart', length: 1, density: 1, thickness: 1, gravity: 1, volume: 0.3, clump: 1,
  curl: 1, wave: 1, frizz: 1, part: 0.45, curlExtra: 0, waveExtra: 0, seed: 1,
  eumelanin: 3.2, pheomelanin: 0.5, tipEu: 3.2, tipPheo: 0.5, ombre: 0, gray: 0, highlights: 0,
  highEu: 0.6, highPheo: 0.4, dye: '#ffffff', dyeAmount: 0, shine: 1, rough: 0.35,
  hairline: { ...HAIRLINE_DEFAULTS },
  beardStyle: 'none', beardLength: 0.002, beardDensity: 1, beardEu: 3.0, beardPheo: 0.6, beardGray: 0,
  brows: { ...BROW_DEFAULTS }, browEu: 3.4, browPheo: 0.5, browLength: 1,
  lashLength: 1, lashDensity: 1, lashCurl: 1, lashEu: 8, lashPheo: 0.2,
  bodyHair: { ...BODYHAIR_DEFAULTS }, bodyLength: 1, bodyEu: 2.5, bodyPheo: 0.6,
};

const COUNTS = { scalp: 80000 };
const KINDS = ['scalp', 'brow', 'lash', 'beard', 'body'];
const FOLLOW = ['brow', 'lash', 'beard'];

export class HairSystem {
  constructor(app, quality = 1) {
    this.app = app;
    this.ch = app.character;
    this.params = structuredClone(HAIR_DEFAULTS);
    this.quality = quality;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onResult(e.data);
    this.jobId = 0;
    this.pending = new Map();
    this.sets = {};
    this.dirtyKinds = new Set(KINDS);
    this.regionsDirty = true;
    this.lastGeomChange = 0;
    this.busy = new Set();
    for (const k of KINDS) {
      const { mat, depth } = createHairMaterial();
      this.sets[k] = { mesh: null, mat, depth, genHead: new THREE.Matrix4(), N: 0, K: 0 };
    }
    const body = this.ch.parts.body;
    const sd = body.sd;
    // rest normals per render vertex
    sd.update(this.ch.assets.mesh.positions);
    this.restN = sd.scatter(sd.newNrm, 3, new Float32Array(sd.numRender * 3));
    this.restNew = sd.subdivideAttr(this.ch.assets.mesh.positions, 3).map((v) => v * DM);
    this.restNewN = new Float32Array(sd.newNrm);
    this.ch.poseDirty = true;
    // skeleton of the unmorphed base mesh: maps style coordinates (defined on the base mesh)
    // onto the current, morphed head
    this.baseSkel = new Skeleton(this.ch.assets.rig);
    this.baseSkel.computeRest(this.ch.assets.mesh.positions);
    this._findLashLines();
    this.applyColors();
  }

  set(p) {
    const before = JSON.stringify(this.params);
    deepAssign(this.params, p);
    const changed = (keys) => keys.some((k) => k in p);
    const regionKeys = ['hairline', 'beardStyle', 'beardDensity', 'brows', 'bodyHair'];
    if (changed(regionKeys)) this.regionsDirty = true;
    if (changed(['style', 'length', 'density', 'thickness', 'gravity', 'volume', 'clump', 'curl', 'wave', 'frizz', 'part', 'curlExtra', 'waveExtra', 'seed', 'hairline'])) this.dirtyKinds.add('scalp');
    if (changed(['beardStyle', 'beardLength', 'beardDensity'])) this.dirtyKinds.add('beard');
    if (changed(['brows', 'browLength'])) this.dirtyKinds.add('brow');
    if (changed(['lashLength', 'lashDensity', 'lashCurl'])) this.dirtyKinds.add('lash');
    if (changed(['bodyHair', 'bodyLength'])) this.dirtyKinds.add('body');
    this.applyColors();
    if (before !== JSON.stringify(this.params)) this.app.requestRender();
  }

  applyColors() {
    const p = this.params;
    const dye = new THREE.Color(p.dye);
    const tint = (c) => c.lerp(dye.clone().multiplyScalar(0.8), p.dyeAmount);
    const sc = this.sets.scalp.mat.uniforms;
    sc.uRoot.value.copy(tint(hairColor(p.eumelanin, p.pheomelanin)));
    sc.uTip.value.copy(tint(hairColor(p.tipEu, p.tipPheo)));
    sc.uOmbre.value = p.ombre;
    sc.uGray.value = p.gray;
    sc.uHighAmt.value = p.highlights;
    sc.uHigh.value.copy(hairColor(p.highEu, p.highPheo));
    sc.uWidth.value = 0.00017 * p.thickness;
    sc.uSpec.value = 1.1 * p.shine; sc.uSpec2.value = 0.9 * p.shine; sc.uRough.value = p.rough;
    const set = (k, eu, ph, gray, w, spec = 0.6) => {
      const u = this.sets[k].mat.uniforms;
      u.uRoot.value.copy(hairColor(eu, ph)); u.uTip.value.copy(u.uRoot.value);
      u.uGray.value = gray; u.uWidth.value = w; u.uSpec.value = spec; u.uSpec2.value = spec * 0.7;
      u.uAO.value = 0.6; u.uTaper.value = 0.9;
    };
    set('brow', p.browEu, p.browPheo, p.gray * 0.5, 0.00019, 0.35);
    set('lash', p.lashEu, p.lashPheo, 0, 0.0002, 0.5);
    set('beard', p.beardEu, p.beardPheo, p.beardGray, 0.00016, 0.5);
    set('body', p.bodyEu, p.bodyPheo, p.gray * 0.5, 0.00008, 0.3);
    this.sets.lash.mat.uniforms.uAO.value = 0.9;
    this.sets.body.mat.uniforms.uAO.value = 0.8;
    this.sets.body.mat.uniforms.uMinPx.value = 0.45;
    // stubble also darkens the skin through the bake (only re-bake when it changes)
    const bp = {
      stubble: p.beardStyle !== 'none' ? Math.min(1, 0.55 + p.beardDensity * 0.35) : 0,
      stubbleColor: '#' + hairColor(p.beardEu, p.beardPheo).getHexString(),
      scalpShade: p.style === 'bald' ? 0 : Math.min(1, 0.4 + p.density * 0.4),
      hairColor: '#' + hairColor(p.eumelanin, p.pheomelanin).getHexString(),
      browShade: Math.min(1, p.brows.density * 0.7),
      browColor: '#' + hairColor(p.browEu, p.browPheo).getHexString(),
    };
    const key = JSON.stringify(bp);
    if (key !== this._bakeKey && this.app.baker) { this._bakeKey = key; this.app.baker.set(bp); }
  }

  setAmbient(top, bottom, amb = 1) {
    for (const k of KINDS) {
      const u = this.sets[k].mat.uniforms;
      u.uAmbTop.value.copy(top); u.uAmbBot.value.copy(bottom); u.uAmb.value = amb;
    }
  }

  // ------------------------------------------------------------------ regions
  _computeRegions() {
    const p = this.params;
    const sd = this.ch.parts.body.sd;
    const { regions, browT } = computeRegions(this.restNew, this.restNewN, {
      scalp: p.style !== 'bald', hairline: { ...p.hairline, mohawk: p.style === 'mohawk' ? 1 : p.hairline.mohawk },
      beardStyle: p.beardStyle, beardDensity: p.beardDensity, brows: p.brows, bodyHair: p.bodyHair,
    });
    this.regions = sd.scatter(regions, 4, new Float32Array(sd.numRender * 4));
    this.browT = sd.scatter(browT, 1, new Float32Array(sd.numRender));
    this.app.baker?.setRegions(this.regions);
    this.regionsDirty = false;
  }

  _density(ch) {
    const n = this.regions.length / 4;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = this.regions[i * 4 + ch];
    return d;
  }

  // -------------------------------------------------------------- eyelash lines
  // The base mesh carries eyelash helper strips at the lid margins (morphed and skinned
  // with everything else). Their innermost row is the lash line.
  _findLashLines() {
    const meta = this.ch.assets.mesh.meta;
    const P = this.ch.assets.mesh.positions;
    this.lashLines = [];
    for (const [g, verts] of Object.entries(meta.eyelashes)) {
      const side = g.includes('-l-') ? 'L' : 'R';
      const upper = g.endsWith('-2');
      const c = side === 'L' ? [0.308, 7.284, 1.245] : [-0.308, 7.284, 1.245];
      const r = verts.map((v) => Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]));
      const rmin = Math.min(...r);
      const row = verts.filter((v, i) => r[i] < rmin + 0.012);
      row.sort((a, b) => Math.abs(P[a * 3]) - Math.abs(P[b * 3]));
      this.lashLines.push({ side, upper, render: row });
    }
    this.lashPosBuf = new Float32Array(P.length);
  }

  // all base vertices (incl. helpers) posed, in meters with the feet on the ground
  _posedMeters() {
    const Q = this.ch.posed, out = this.lashPosBuf, g = this.ch.groundY;
    for (let i = 0; i < out.length; i += 3) { out[i] = Q[i] * DM; out[i + 1] = Q[i + 1] * DM - g; out[i + 2] = Q[i + 2] * DM; }
    return out;
  }

  _findLashLinesFromBoundary() {
    const sd = this.ch.parts.body.sd;
    const q = sd.newQuads;
    const count = new Map();
    const key = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
    for (let i = 0; i < q.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        const a = q[i + k], b = q[i + ((k + 1) & 3)];
        const kk = key(a, b);
        count.set(kk, (count.get(kk) || 0) + 1);
      }
    }
    const adj = new Map();
    for (const [kk, c] of count) {
      if (c !== 1) continue;
      const a = Math.floor(kk / 1e6), b = kk % 1e6;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    const R = this.restNew;
    const eyes = { L: [0.0308, 0.7284, 0.1245], R: [-0.0308, 0.7284, 0.1245] };
    // first render vertex of each new vertex
    const firstRender = new Int32Array(sd.numNew).fill(-1);
    for (let i = 0; i < sd.renderSrc.length; i++) if (firstRender[sd.renderSrc[i]] < 0) firstRender[sd.renderSrc[i]] = i;
    this.lashLines = [];
    for (const [side, c] of Object.entries(eyes)) {
      const verts = [...adj.keys()].filter((v) => Math.hypot(R[v * 3] - c[0], R[v * 3 + 1] - c[1], R[v * 3 + 2] - c[2]) < 0.025);
      for (const upper of [true, false]) {
        const sel = verts.filter((v) => (R[v * 3 + 1] - c[1] >= -0.0005) === upper);
        sel.sort((a, b) => Math.abs(R[a * 3]) - Math.abs(R[b * 3]));       // medial -> lateral
        this.lashLines.push({ side, upper, render: sel.map((v) => firstRender[v]) });
      }
    }
  }

  // ------------------------------------------------------------------- update
  headMatrix(out = new THREE.Matrix4()) {
    const S = this.ch.skeleton, i = S.byName.get('head');
    const m = S.skin, o = i * 12;
    out.set(
      m[o], m[o + 3], m[o + 6], m[o + 9] * DM,
      m[o + 1], m[o + 4], m[o + 7], m[o + 10] * DM - this.ch.groundY,
      m[o + 2], m[o + 5], m[o + 8], m[o + 11] * DM,
      0, 0, 0, 1,
    );
    return out;
  }

  /** shapeChanged: the body shape/pose changed (regenerate); otherwise only animate. */
  /** Similarity transform base-mesh rest (m) -> morphed rest (m) of the head. */
  _baseToMorph() {
    const B = this.baseSkel, M = this.ch.skeleton;
    const jn = (bone, end) => B.bones[B.byName.get(bone)][end];
    const pick = (S, j) => S.joint(j).map((v) => v * DM);
    const eL = jn('eye.L', 'head'), eR = jn('eye.R', 'head'), top = jn('head', 'tail'), neck = jn('head', 'head');
    const cb = mid(pick(B, eL), pick(B, eR)), cm = mid(pick(M, eL), pick(M, eR));
    const hb = dist(pick(B, top), pick(B, neck)), hm = dist(pick(M, top), pick(M, neck));
    const wb = dist(pick(B, eL), pick(B, eR)), wm = dist(pick(M, eL), pick(M, eR));
    const s = (hm / hb + wm / wb) / 2;
    return new THREE.Matrix4().makeTranslation(cm[0], cm[1], cm[2])
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-cb[0], -cb[1], -cb[2]));
  }

  onGeometryChanged(shapeChanged = true) {
    for (const k of FOLLOW) this._follow(k);
    if (!shapeChanged) return;
    this.lastGeomChange = performance.now();
    for (const k of KINDS) this.dirtyKinds.add(k);
  }

  // shift strands with the skin at their roots (expressions, blinking, small morphs)
  _follow(kind) {
    const s = this.sets[kind];
    if (!s.mesh || !s.rootIdx || !s.N) return;
    const P = kind === 'lash' ? this._posedMeters() : this.ch.parts.body.position, G = s.genPos;
    const data = s.tex.image.data, base = s.basePts, K = s.K;
    const ri = s.rootIdx, rw = s.rootW;
    for (let i = 0; i < s.N; i++) {
      let dx = 0, dy = 0, dz = 0;
      for (let j = 0; j < 3; j++) {
        const v = ri[i * 3 + j] * 3, w = rw[i * 3 + j];
        dx += w * (P[v] - G[v]); dy += w * (P[v + 1] - G[v + 1]); dz += w * (P[v + 2] - G[v + 2]);
      }
      const o = i * K * 4;
      for (let k = 0; k < K; k++) {
        const q = o + k * 4;
        data[q] = base[q] + dx; data[q + 1] = base[q + 1] + dy; data[q + 2] = base[q + 2] + dz;
      }
    }
    s.tex.needsUpdate = true;
  }

  update() {
    const now = performance.now();
    if (this.regionsDirty && (!this.regions || now - (this._lastRegions || 0) > 120)) {
      this._lastRegions = now;
      this._computeRegions();
    }
    // rigid follow of the head between regenerations
    const H = this.headMatrix(new THREE.Matrix4());
    for (const k of ['scalp']) {
      const s = this.sets[k];
      if (s.mesh) s.mat.uniforms.uDelta.value.multiplyMatrices(H, s.genHeadInv);
    }
    const settle = performance.now() - this.lastGeomChange > 220;
    if (!settle || !this.dirtyKinds.size) return;
    for (const k of [...this.dirtyKinds]) {
      if (this.busy.has(k)) continue;
      this.dirtyKinds.delete(k);
      this._dispatch(k, H);
    }
  }

  _dispatch(kind, H) {
    const p = this.params;
    const body = this.ch.parts.body;
    const S = this.ch.skeleton;
    const hi = S.byName.get('head');
    const hr = new Float64Array(9);
    // rest -> posed rotation of the head (poseRot * restRot^T)
    const PR = S.poseRot[hi], RR = S.restRot[hi];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      hr[c * 3 + r] = PR[r] * RR[c] + PR[3 + r] * RR[3 + c] + PR[6 + r] * RR[6 + c];
    }
    const mesh = { pos: body.position.slice(), nrm: body.normal.slice(), rest: body.rest, restN: this.restN, index: body.index };
    let params, density = null, extra = {};
    const q = this.quality;
    if (kind === 'scalp') {
      params = { ...p, count: COUNTS.scalp * q, seed: p.seed };
      density = this._density(0);
    } else if (kind === 'brow') {
      params = { density: p.brows.density * q, length: p.browLength, seed: 3 };
      density = this._density(2);
      extra.browT = this.browT;
    } else if (kind === 'beard') {
      params = { density: (p.beardStyle === 'none' ? 0 : p.beardDensity) * q, length: p.beardLength, seed: 5 };
      density = this._density(1);
    } else if (kind === 'body') {
      const total = Object.values(p.bodyHair).reduce((a, b) => a + b, 0);
      params = { density: Math.min(2.5, total) * q, length: p.bodyLength, seed: 7 };
      density = this._density(3);
    } else if (kind === 'lash') {
      params = { density: p.lashDensity, length: p.lashLength, curl: p.lashCurl };
      const P = this._posedMeters().slice();
      mesh.pos = P;
      extra.lines = this.lashLines.map((l) => ({ side: l.side, upper: l.upper, render: l.render, points: l.render.map((r) => [P[r * 3], P[r * 3 + 1], P[r * 3 + 2]]) }));
      extra.eyeCenters = {};
      for (const s of ['L', 'R']) {
        const c = this.ch.eyeCenter[s];
        extra.eyeCenters[s] = [c[0] * DM, c[1] * DM - this.ch.groundY, c[2] * DM];
      }
    }
    const up = [hr[3], hr[4], hr[5]], fwd = [hr[6], hr[7], hr[8]];
    const id = ++this.jobId;
    this.pending.set(id, { kind, head: H.clone(), pos: mesh.pos });
    this.busy.add(kind);
    const neckY = this.ch.bonePos('neck01')[1];
    const HB = H.clone().multiply(this._baseToMorph());   // base-mesh rest -> posed world
    const job = { kind, mesh, density, params, headRot: Array.from(hr), headInv: HB.clone().invert().elements.slice(), headM: HB.elements.slice(), extra, up, fwd, neckY };
    this.worker.postMessage({ id, job });
  }

  _onResult(msg) {
    const info = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (!info) return;
    this.busy.delete(info.kind);
    if (msg.error) { console.error('hair', msg.error); return; }
    const { pts, attr, N, K } = msg.res;
    const s = this.sets[info.kind];
    if (s.mesh) {
      this.app.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.tex?.dispose(); s.atex?.dispose();
      s.mesh = null;
    }
    if (N > 0) {
      const W = 4096;
      const H = Math.ceil((N * K) / W);
      const data = new Float32Array(W * H * 4); data.set(pts);
      const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      const AH = Math.ceil(N / W);
      const adata = new Float32Array(W * AH * 4); adata.set(attr);
      const atex = new THREE.DataTexture(adata, W, AH, THREE.RGBAFormat, THREE.FloatType);
      atex.needsUpdate = true;
      const geo = createStrandTemplate(K);
      geo.instanceCount = N;
      const u = s.mat.uniforms;
      u.tPos.value = tex; u.tAttr.value = atex; u.uK.value = K; u.uW.value = W;
      const mesh = new THREE.Mesh(geo, s.mat);
      mesh.customDepthMaterial = s.depth;
      mesh.castShadow = info.kind !== 'body' && info.kind !== 'lash';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.app.scene.add(mesh);
      s.mesh = mesh; s.tex = tex; s.atex = atex;
    }
    s.N = N; s.K = K;
    s.genHeadInv = info.head.clone().invert();
    const Hn = this.headMatrix(new THREE.Matrix4());
    s.mat.uniforms.uDelta.value.multiplyMatrices(Hn, s.genHeadInv);
    if (info.kind !== 'scalp') s.mat.uniforms.uDelta.value.identity();
    s.rootIdx = msg.res.rootIdx; s.rootW = msg.res.rootW; s.genPos = info.pos;
    s.basePts = s.mesh ? new Float32Array(s.tex.image.data) : null;
    if (FOLLOW.includes(info.kind)) this._follow(info.kind);
    this.app.requestRender();
    this.app.emit('hair');
  }

  setFrame(n) {
    for (const k of KINDS) this.sets[k].mat.uniforms.uFrame.value = n;
  }

  setViewport(h) {
    for (const k of KINDS) this.sets[k].mat.uniforms.uViewH.value = h;
  }

  get busyNow() { return this.busy.size > 0 || this.dirtyKinds.size > 0; }
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function deepAssign(t, s) {
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deepAssign(t[k], v);
    else t[k] = v;
  }
}
