// Catmull-Clark subdivision (one level) for an all-quad mesh with face-varying UVs.
// Topology and UV layout are built once; per frame only positions are recomputed.

export class SubdivMesh {
  /**
   * @param {Uint16Array} quadV original vertex index per quad corner
   * @param {Uint16Array} quadT uv index per quad corner
   * @param {Float32Array} uvs  uv table (2 floats per index)
   * @param {number} level 0 (plain quads) or 1 (Catmull-Clark)
   */
  constructor(quadV, quadT, uvs, level = 1) {
    this.level = level;
    const nf = quadV.length / 4;
    // compact vertex ids
    const local = new Map();
    const orig = [];
    const qv = new Uint32Array(quadV.length);
    for (let i = 0; i < quadV.length; i++) {
      let l = local.get(quadV[i]);
      if (l === undefined) { l = orig.length; local.set(quadV[i], l); orig.push(quadV[i]); }
      qv[i] = l;
    }
    const nv = orig.length;
    this.nf = nf;
    this.nv = nv;
    this.orig = Uint32Array.from(orig);
    this.qv = qv;

    // edges
    const emap = new Map();
    const ev = [], ef = [];
    const fe = new Uint32Array(nf * 4);
    for (let f = 0; f < nf; f++) {
      for (let k = 0; k < 4; k++) {
        const a = qv[f * 4 + k], b = qv[f * 4 + ((k + 1) & 3)];
        const key = a < b ? a * nv + b : b * nv + a;
        let e = emap.get(key);
        if (e === undefined) {
          e = ev.length / 2;
          emap.set(key, e);
          ev.push(Math.min(a, b), Math.max(a, b));
          ef.push(f, -1);
        } else {
          ef[e * 2 + 1] = f;
        }
        fe[f * 4 + k] = e;
      }
    }
    const ne = ev.length / 2;
    this.ne = ne;
    this.ev = Uint32Array.from(ev);
    this.ef = Int32Array.from(ef);
    this.fe = fe;

    // vertex -> faces / edges (CSR)
    const vfCount = new Uint32Array(nv + 1), veCount = new Uint32Array(nv + 1);
    for (let i = 0; i < qv.length; i++) vfCount[qv[i] + 1]++;
    for (let e = 0; e < ne; e++) { veCount[ev[e * 2] + 1]++; veCount[ev[e * 2 + 1] + 1]++; }
    for (let v = 0; v < nv; v++) { vfCount[v + 1] += vfCount[v]; veCount[v + 1] += veCount[v]; }
    const vf = new Uint32Array(vfCount[nv]), ve = new Uint32Array(veCount[nv]);
    const fill1 = vfCount.slice(), fill2 = veCount.slice();
    for (let i = 0; i < qv.length; i++) vf[fill1[qv[i]]++] = i >> 2;
    for (let e = 0; e < ne; e++) { ve[fill2[ev[e * 2]]++] = e; ve[fill2[ev[e * 2 + 1]]++] = e; }
    this.vfOff = vfCount; this.vf = vf; this.veOff = veCount; this.ve = ve;

    // boundary neighbours
    const bnd = new Int32Array(nv * 2).fill(-1);
    const bcount = new Uint8Array(nv);
    for (let e = 0; e < ne; e++) {
      if (this.ef[e * 2 + 1] >= 0) continue;
      const a = ev[e * 2], b = ev[e * 2 + 1];
      if (bcount[a] < 2) bnd[a * 2 + bcount[a]] = b;
      if (bcount[b] < 2) bnd[b * 2 + bcount[b]] = a;
      bcount[a]++; bcount[b]++;
    }
    this.bnd = bnd; this.bcount = bcount;

    this.numNew = level ? nv + ne + nf : nv;
    this._buildRender(quadT, uvs);
    this.newPos = new Float32Array(this.numNew * 3);
    this.newNrm = new Float32Array(this.numNew * 3);
    this._faceTmp = level ? new Float32Array(nf * 3) : null;
    this._buildStencils();
  }

  // Express every new vertex as a weighted sum of original vertices (CSR), so the
  // per-frame position update is a single sparse matrix-vector product.
  _buildStencils() {
    const { nv, ne, nf, qv, ev, ef, orig, vfOff, vf, veOff, ve, bnd, bcount } = this;
    const off = new Uint32Array(this.numNew + 1);
    const idx = [], wt = [];
    let row = 0;
    const acc = new Map();
    const put = (v, w) => acc.set(v, (acc.get(v) || 0) + w);
    const flush = () => {
      for (const [v, w] of acc) { idx.push(orig[v]); wt.push(w); }
      acc.clear();
      off[++row] = idx.length;
    };
    const facePut = (f, w) => { for (let k = 0; k < 4; k++) put(qv[f * 4 + k], w * 0.25); };
    if (!this.level) {
      for (let v = 0; v < nv; v++) { put(v, 1); flush(); }
    } else {
      for (let v = 0; v < nv; v++) {
        if (bcount[v]) {
          if (bcount[v] === 2) { put(bnd[v * 2], 0.125); put(bnd[v * 2 + 1], 0.125); put(v, 0.75); } else put(v, 1);
        } else {
          const nfv = vfOff[v + 1] - vfOff[v], n = veOff[v + 1] - veOff[v];
          for (let i = vfOff[v]; i < vfOff[v + 1]; i++) facePut(vf[i], 1 / (nfv * n));
          for (let i = veOff[v]; i < veOff[v + 1]; i++) {
            const e = ve[i];
            put(ev[e * 2], 1 / (n * n)); put(ev[e * 2 + 1], 1 / (n * n));
          }
          put(v, (n - 3) / n);
        }
        flush();
      }
      for (let e = 0; e < ne; e++) {
        const f0 = ef[e * 2], f1 = ef[e * 2 + 1];
        if (f1 < 0) { put(ev[e * 2], 0.5); put(ev[e * 2 + 1], 0.5); } else {
          put(ev[e * 2], 0.25); put(ev[e * 2 + 1], 0.25); facePut(f0, 0.25); facePut(f1, 0.25);
        }
        flush();
      }
      for (let f = 0; f < nf; f++) { facePut(f, 1); flush(); }
    }
    this.stOff = off;
    this.stIdx = Uint32Array.from(idx);
    this.stW = Float32Array.from(wt);
  }

  applyStencils(src, out) {
    const { stOff, stIdx, stW } = this;
    for (let i = 0, n = this.numNew; i < n; i++) {
      let x = 0, y = 0, z = 0;
      for (let k = stOff[i], e = stOff[i + 1]; k < e; k++) {
        const j = stIdx[k] * 3, w = stW[k];
        x += w * src[j]; y += w * src[j + 1]; z += w * src[j + 2];
      }
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    }
    return out;
  }

  _buildRender(quadT, uvs) {
    const { nf, nv, ne, qv, fe, ev } = this;
    const rmap = new Map();
    const src = [], uv = [], index = [];
    const T = 65536;
    const corner = (f, k) => {
      const v = qv[f * 4 + k], t = quadT[f * 4 + k];
      const key = v * T + t;
      let r = rmap.get(key);
      if (r === undefined) {
        r = src.length; rmap.set(key, r);
        src.push(v); uv.push(uvs[t * 2], uvs[t * 2 + 1]);
      }
      return r;
    };
    if (!this.level) {
      for (let f = 0; f < nf; f++) {
        const r = [0, 1, 2, 3].map((k) => corner(f, k));
        index.push(r[0], r[1], r[2], r[0], r[2], r[3]);
      }
    } else {
      const edgeR = (f, k) => {
        const e = fe[f * 4 + k];
        const k2 = (k + 1) & 3;
        let ta = quadT[f * 4 + k], tb = quadT[f * 4 + k2];
        if (qv[f * 4 + k] !== ev[e * 2]) { const x = ta; ta = tb; tb = x; }
        const key = 'e' + e + ':' + ta + ':' + tb;
        let r = rmap.get(key);
        if (r === undefined) {
          r = src.length; rmap.set(key, r);
          src.push(nv + e);
          uv.push((uvs[ta * 2] + uvs[tb * 2]) / 2, (uvs[ta * 2 + 1] + uvs[tb * 2 + 1]) / 2);
        }
        return r;
      };
      for (let f = 0; f < nf; f++) {
        const c = [0, 1, 2, 3].map((k) => corner(f, k));
        const e = [0, 1, 2, 3].map((k) => edgeR(f, k));
        const fr = src.length;
        src.push(nv + ne + f);
        let u = 0, w = 0;
        for (let k = 0; k < 4; k++) { const t = quadT[f * 4 + k]; u += uvs[t * 2]; w += uvs[t * 2 + 1]; }
        uv.push(u / 4, w / 4);
        // sub-quad at corner k: (corner k, edge k, face, edge k-1)
        for (let k = 0; k < 4; k++) {
          const a = c[k], b = e[k], cc = fr, d = e[(k + 3) & 3];
          index.push(a, b, cc, a, cc, d);
        }
      }
    }
    this.renderSrc = Uint32Array.from(src);
    this.renderUV = Float32Array.from(uv);
    this.index = Uint32Array.from(index);
    this.numRender = src.length;
    // topology quads on "new" vertex ids for normal computation
    const nq = index.length / 6;
    const q = new Uint32Array(nq * 4);
    for (let i = 0; i < nq; i++) {
      q[i * 4] = src[index[i * 6]];
      q[i * 4 + 1] = src[index[i * 6 + 1]];
      q[i * 4 + 2] = src[index[i * 6 + 2]];
      q[i * 4 + 3] = src[index[i * 6 + 5]];
    }
    this.newQuads = q;
  }

  /** Subdivide a per-original-vertex attribute (stride `s`) into a per-new-vertex array. */
  subdivideAttr(srcAttr, s, out) {
    const { nv, ne, nf, qv, ev, ef, orig } = this;
    out = out || new Float32Array(this.numNew * s);
    if (!this.level) {
      for (let v = 0; v < nv; v++) for (let c = 0; c < s; c++) out[v * s + c] = srcAttr[orig[v] * s + c];
      return out;
    }
    const F = s === 3 && this._faceTmp ? this._faceTmp : new Float32Array(nf * s);
    const fo = (nv + ne) * s, eo = nv * s;
    for (let f = 0; f < nf; f++) {
      const a = orig[qv[f * 4]] * s, b = orig[qv[f * 4 + 1]] * s, c = orig[qv[f * 4 + 2]] * s, d = orig[qv[f * 4 + 3]] * s;
      for (let k = 0; k < s; k++) {
        const val = (srcAttr[a + k] + srcAttr[b + k] + srcAttr[c + k] + srcAttr[d + k]) * 0.25;
        F[f * s + k] = val;
        out[fo + f * s + k] = val;
      }
    }
    for (let e = 0; e < ne; e++) {
      const a = orig[ev[e * 2]] * s, b = orig[ev[e * 2 + 1]] * s;
      const f0 = ef[e * 2], f1 = ef[e * 2 + 1];
      for (let k = 0; k < s; k++) {
        out[eo + e * s + k] = f1 < 0
          ? (srcAttr[a + k] + srcAttr[b + k]) * 0.5
          : (srcAttr[a + k] + srcAttr[b + k] + F[f0 * s + k] + F[f1 * s + k]) * 0.25;
      }
    }
    const { vfOff, vf, veOff, ve, bnd, bcount } = this;
    for (let v = 0; v < nv; v++) {
      const p = orig[v] * s;
      if (bcount[v]) {
        if (bcount[v] === 2) {
          const a = orig[bnd[v * 2]] * s, b = orig[bnd[v * 2 + 1]] * s;
          for (let k = 0; k < s; k++) out[v * s + k] = (srcAttr[a + k] + srcAttr[b + k] + 6 * srcAttr[p + k]) * 0.125;
        } else {
          for (let k = 0; k < s; k++) out[v * s + k] = srcAttr[p + k];
        }
        continue;
      }
      const nfv = vfOff[v + 1] - vfOff[v];
      const n = veOff[v + 1] - veOff[v];
      for (let k = 0; k < s; k++) {
        let q = 0;
        for (let i = vfOff[v]; i < vfOff[v + 1]; i++) q += F[vf[i] * s + k];
        q /= nfv;
        let r = 0;
        for (let i = veOff[v]; i < veOff[v + 1]; i++) {
          const e = ve[i];
          r += srcAttr[orig[ev[e * 2]] * s + k] + srcAttr[orig[ev[e * 2 + 1]] * s + k];
        }
        r = r * 0.5 / n;
        out[v * s + k] = (q + 2 * r + (n - 3) * srcAttr[p + k]) / n;
      }
    }
    return out;
  }

  /** Positions (stride 3, indexed by original vertex id) -> new positions + normals. */
  update(srcPos) {
    const P = this.applyStencils(srcPos, this.newPos);
    const N = this.newNrm;
    N.fill(0);
    const q = this.newQuads;
    for (let i = 0; i < q.length; i += 4) {
      const a = q[i] * 3, b = q[i + 1] * 3, c = q[i + 2] * 3, d = q[i + 3] * 3;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
      const vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
      N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
      N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
      N[d] += nx; N[d + 1] += ny; N[d + 2] += nz;
    }
    for (let i = 0; i < N.length; i += 3) {
      const x = N[i], y = N[i + 1], z = N[i + 2];
      const l = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      N[i] = x * l; N[i + 1] = y * l; N[i + 2] = z * l;
    }
    return P;
  }

  /** Scatter new-vertex data (stride s) into render vertex order. */
  scatter(src, s, out, scale = 1, offset = null) {
    const r = this.renderSrc;
    for (let i = 0; i < r.length; i++) {
      const j = r[i] * s, o = i * s;
      for (let k = 0; k < s; k++) out[o + k] = src[j + k] * scale + (offset ? offset[k] : 0);
    }
    return out;
  }
}
