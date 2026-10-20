// Procedural strand generation (runs inside a worker).
//
// Inputs are the posed, subdivided body mesh (meters), its rest positions/normals and a
// per-vertex density for the requested hair kind. Output is a fixed number of points per
// strand (K) packed as [x, y, z, t] and per-strand attributes [width, tone, rand, ao].

const HEAD_C = [0, 0.762, 0.035];
const CROWN = [0.0, 0.835, -0.035];

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const tangentOf = (v, n) => { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; };
const mat4p = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const mat3v = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

// ------------------------------------------------------------------------- SDF
export class VoxelSDF {
  constructor(pos, nrm, minY, maxCells = 420000, margin = 0.06) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      if (pos[i * 3 + 1] < minY) continue;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
    }
    lo = lo.map((v) => v - margin); hi = hi.map((v) => v + margin);
    lo[1] = Math.max(lo[1], minY - margin);
    const ext = sub(hi, lo);
    const h = Math.max(0.004, Math.cbrt((ext[0] * ext[1] * ext[2]) / maxCells));
    const dim = ext.map((e) => Math.max(4, Math.ceil(e / h) + 1));
    this.lo = lo; this.h = h; this.dim = dim;
    const N = dim[0] * dim[1] * dim[2];
    const dist = new Float32Array(N).fill(1e9);
    const near = new Int32Array(N).fill(-1);
    const QN = N * 8;
    const queue = new Int32Array(QN);
    let qh = 0, qt = 0;
    const idx = (x, y, z) => (z * dim[1] + y) * dim[0] + x;
    for (let i = 0; i < n; i++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (p[1] < lo[1]) continue;
      const c = p.map((v, k) => Math.round((v - lo[k]) / h));
      if (c.some((v, k) => v < 0 || v >= dim[k])) continue;
      const j = idx(c[0], c[1], c[2]);
      const cp = c.map((v, k) => lo[k] + v * h);
      const d = len(sub(p, cp));
      if (d < dist[j]) { dist[j] = d; if (near[j] < 0) queue[qt++] = j; near[j] = i; }
    }
    // brushfire propagation of nearest surface points (6-neighbourhood, re-push on improvement)
    const sx = 1, sy = dim[0], sz = dim[0] * dim[1];
    const offs = [sx, -sx, sy, -sy, sz, -sz];
    while (qh < qt) {
      const j = queue[qh++ % QN];
      const x = j % dim[0], y = ((j / dim[0]) | 0) % dim[1], z = (j / sz) | 0;
      const s3 = near[j] * 3;
      const qx = pos[s3], qy = pos[s3 + 1], qz = pos[s3 + 2];
      for (let o = 0; o < 6; o++) {
        if ((o === 0 && x === dim[0] - 1) || (o === 1 && x === 0) || (o === 2 && y === dim[1] - 1) || (o === 3 && y === 0) || (o === 4 && z === dim[2] - 1) || (o === 5 && z === 0)) continue;
        const k = j + offs[o];
        const X = o === 0 ? x + 1 : o === 1 ? x - 1 : x;
        const Y = o === 2 ? y + 1 : o === 3 ? y - 1 : y;
        const Z = o === 4 ? z + 1 : o === 5 ? z - 1 : z;
        const px = lo[0] + X * h - qx, py = lo[1] + Y * h - qy, pz = lo[2] + Z * h - qz;
        const d = Math.sqrt(px * px + py * py + pz * pz);
        if (d < dist[k] - 1e-6) {
          dist[k] = d; near[k] = near[j];
          if (qt - qh < QN) queue[qt++ % QN] = k;
        }
      }
    }
    // sign from the normal of the nearest vertex; close to the surface use the distance to
    // that vertex's tangent plane, which is far more accurate than the vertex distance
    for (let j = 0; j < N; j++) {
      const v = near[j];
      if (v < 0) continue;
      const x = j % dim[0], y = ((j / dim[0]) | 0) % dim[1], z = (j / sz) | 0;
      const px = lo[0] + x * h - pos[v * 3], py = lo[1] + y * h - pos[v * 3 + 1], pz = lo[2] + z * h - pos[v * 3 + 2];
      const dp = px * nrm[v * 3] + py * nrm[v * 3 + 1] + pz * nrm[v * 3 + 2];
      const dv = dist[j];
      dist[j] = dv < h * 1.5 ? dp : (dp < 0 ? -dv : dv);
    }
    this.dist = dist;
  }

  sample(p) {
    const { lo, h, dim, dist } = this;
    const fx = (p[0] - lo[0]) / h, fy = (p[1] - lo[1]) / h, fz = (p[2] - lo[2]) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= dim[0] - 1 || fy >= dim[1] - 1 || fz >= dim[2] - 1) return 1;
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    const i = (z * dim[1] + y) * dim[0] + x;
    const sx = 1, sy = dim[0], sz = dim[0] * dim[1];
    const c00 = dist[i] * (1 - tx) + dist[i + sx] * tx;
    const c10 = dist[i + sy] * (1 - tx) + dist[i + sy + sx] * tx;
    const c01 = dist[i + sz] * (1 - tx) + dist[i + sz + sx] * tx;
    const c11 = dist[i + sz + sy] * (1 - tx) + dist[i + sz + sy + sx] * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }

  grad(p) {
    const e = this.h * 0.6;
    return norm([
      this.sample([p[0] + e, p[1], p[2]]) - this.sample([p[0] - e, p[1], p[2]]),
      this.sample([p[0], p[1] + e, p[2]]) - this.sample([p[0], p[1] - e, p[2]]),
      this.sample([p[0], p[1], p[2] + e]) - this.sample([p[0], p[1], p[2] - e]),
    ]);
  }
}

// ----------------------------------------------------------------- root sampling
export function sampleRoots(mesh, density, count, rand, densityPow = 1) {
  const { rest, index } = mesh;
  const nt = index.length / 3;
  const cdf = new Float64Array(nt + 1);
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const d = (density[a] + density[b] + density[c]) / 3;
    let w = 0;
    if (d > 0.01) {
      const e1 = [rest[b * 3] - rest[a * 3], rest[b * 3 + 1] - rest[a * 3 + 1], rest[b * 3 + 2] - rest[a * 3 + 2]];
      const e2 = [rest[c * 3] - rest[a * 3], rest[c * 3 + 1] - rest[a * 3 + 1], rest[c * 3 + 2] - rest[a * 3 + 2]];
      w = len(cross(e1, e2)) * 0.5 * Math.pow(d, densityPow);
    }
    cdf[t + 1] = cdf[t] + w;
  }
  const total = cdf[nt];
  const roots = [];
  if (total <= 0) return { roots, area: 0 };
  for (let i = 0; i < count; i++) {
    const r = ((i + rand()) / count) * total;      // stratified
    let lo = 0, hi = nt;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m + 1] < r) lo = m + 1; else hi = m; }
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    roots.push({ tri: lo, b: [1 - u - v, u, v] });
  }
  return { roots, area: total };
}

function interp(arr, stride, index, root, out = [0, 0, 0]) {
  const t = root.tri * 3;
  const a = index[t] * stride, b = index[t + 1] * stride, c = index[t + 2] * stride;
  for (let k = 0; k < stride; k++) out[k] = arr[a + k] * root.b[0] + arr[b + k] * root.b[1] + arr[c + k] * root.b[2];
  return out;
}

// ------------------------------------------------------------------ hair styles
// Each style describes the groom field and shape. Lengths in meters.
export const HAIR_STYLES = {
  bald: { label: 'Glatze', length: 0 },
  buzz: { label: 'Buzz Cut', length: 0.004, lift: 0.55, natural: 1, stiff: 1, K: 4, density: 1.4 },
  crew: { label: 'Kurzhaar', length: 0.03, lengthTop: 1.8, lengthSide: 0.35, lift: 0.45, natural: 0.4, forward: 0.6, stiff: 0.9, K: 7, frizz: 0.2 },
  textured: { label: 'Kurz strukturiert', length: 0.05, lengthTop: 1.6, lengthSide: 0.4, lift: 0.6, natural: 0.3, up: 0.6, forward: 0.4, stiff: 0.75, K: 9, frizz: 0.5, clump: 0.6 },
  sidepart: { label: 'Seitenscheitel', length: 0.075, lengthTop: 1.3, lengthSide: 0.55, part: 0.45, side: 1, back: 0.4, lift: 0.25, stiff: 0.6, K: 12, clump: 0.5, gravity: 0.6 },
  slick: { label: 'Zurückgekämmt', length: 0.1, lengthSide: 0.7, back: 1.2, lift: 0.25, stiff: 0.6, K: 14, clump: 0.55, gravity: 0.5 },
  quiff: { label: 'Tolle', length: 0.08, lengthTop: 1.7, lengthSide: 0.35, back: 0.6, up: 1.0, lift: 0.7, stiff: 0.8, K: 14, clump: 0.7, gravity: 0.35, undercut: 0.7 },
  bob: { label: 'Bob', length: 0.2, part: 0.0, side: 0.8, down: 1, lift: 0.18, stiff: 0.25, K: 20, clump: 0.45, gravity: 1, faceClear: 0.8, comb: 0.7 },
  bangs: { label: 'Pony & Bob', length: 0.2, part: 0.0, side: 0.6, down: 1, lift: 0.18, stiff: 0.25, K: 20, clump: 0.45, gravity: 1, bangs: 1, faceClear: 0.7, comb: 0.7 },
  long: { label: 'Lang glatt', length: 0.42, part: 0.15, side: 0.9, down: 1, back: 0.35, lift: 0.15, stiff: 0.15, K: 28, clump: 0.5, gravity: 1, faceClear: 1, comb: 0.8, behind: 0.7 },
  wavy: { label: 'Lang gewellt', length: 0.4, part: -0.35, side: 1, down: 1, back: 0.35, lift: 0.18, stiff: 0.15, K: 30, clump: 0.6, gravity: 1, wave: 0.012, waveFreq: 9, frizz: 0.25, faceClear: 1, comb: 0.8, behind: 0.6 },
  curly: { label: 'Locken', length: 0.22, part: 0.2, side: 0.6, down: 0.6, out: 0.5, lift: 0.4, stiff: 0.35, K: 30, clump: 0.75, gravity: 0.55, curl: 0.011, curlFreq: 32, frizz: 0.35, faceClear: 0.8, comb: 0.5 },
  afro: { label: 'Afro', length: 0.13, out: 1.4, lift: 0.85, stiff: 0.9, K: 22, clump: 0.55, gravity: 0.08, curl: 0.004, curlFreq: 120, frizz: 1.0, density: 1.2, faceClear: 0.5 },
  ponytail: { label: 'Pferdeschwanz', length: 0.38, back: 1.0, lift: 0.1, stiff: 0.2, K: 30, clump: 0.6, gravity: 1, gather: 1, comb: 1 },
  mohawk: { label: 'Irokese', length: 0.12, up: 1.6, lift: 0.95, stiff: 1, K: 12, clump: 0.85, gravity: 0.05, mohawk: 1 },
  dreads: { label: 'Dreadlocks', length: 0.32, down: 1, out: 0.3, lift: 0.3, stiff: 0.35, K: 28, clump: 0.97, gravity: 1, frizz: 0.6, clumps: 0.06, curl: 0.002, curlFreq: 60, faceClear: 1, comb: 0.5 },
};

function scalpGroom(st, rest, rn, part) {
  // all in rest space
  const q = sub(rest, HEAD_C);
  const fromCrown = norm(tangentOf(sub(rest, CROWN), rn));
  // natural growth: away from the crown with a slight whorl twist
  let g = norm(add(fromCrown, scl(norm(cross(rn, fromCrown)), 0.25)));
  const w = (k) => st[k] || 0;
  const partX = part * 0.045;
  const sideDir = [Math.sign(q[0] - partX) || 1, 0, 0];
  const nearPart = smooth(0.09, 0.0, Math.abs(q[0] - partX)) * smooth(0.0, 0.03, rest[1] - 0.8);
  let groom = [0, 0, 0];
  groom = add(groom, scl([0, -1, 0], w('down')));
  groom = add(groom, scl([0, -0.3, -1], w('back')));
  groom = add(groom, scl([0, 0.2, 1], w('forward')));
  groom = add(groom, scl([0, 1, 0], w('up')));
  groom = add(groom, scl(rn, w('out')));
  groom = add(groom, scl(sideDir, w('side') * (0.35 + nearPart)));
  if (st.bangs) {
    const front = smooth(-0.02, 0.06, q[2]) * smooth(0.77, 0.81, rest[1]);
    groom = add(groom, scl([0, -0.6, 1.2], st.bangs * front * 2));
  }
  if (st.faceClear) {
    // long styles: comb the front away from the face, behind the ears
    const front = smooth(-0.02, 0.05, q[2]) * (1 - (st.bangs || 0) * smooth(0.0, 0.04, 0.045 - Math.abs(q[0] - partX)));
    groom = add(groom, scl([sideDir[0] * 0.55, 0.25, -1.0], st.faceClear * front * 1.8));
  }
  if (st.gather) groom = add(groom, scl(norm(sub([0, 0.74, -0.09], rest)), 1.2));
  const gl = len(groom);
  if (gl > 1e-4) g = norm(mix(g, norm(groom), Math.min(1, gl) * (1 - (st.natural || 0))));
  return norm(tangentOf(g, rn));
}

// ----------------------------------------------------------------- generation
/**
 * @param {object} job
 *   mesh: {pos, nrm, rest, restN, index}   (render vertex arrays, meters)
 *   density: Float32Array per render vertex
 *   kind: 'scalp'|'brow'|'beard'|'body'|'lash'
 *   params: style / shape parameters
 *   headRot: 3x3 column-major rotation rest -> posed of the head
 *   extra: kind specific data (lash lines, brow coordinates)
 */
export function generate(job) {
  const { kind } = job;
  if (kind === 'lash') return generateLashes(job);
  const P = job.params;
  const rand = mulberry32((P.seed || 1) * 1000 + kind.length * 7919);
  const mesh = job.mesh;
  const st = kind === 'scalp' ? { ...(HAIR_STYLES[P.style] || HAIR_STYLES.long) } : {};
  let baseLen, K, count, stiff, gravity, lift;
  if (kind === 'scalp') {
    if (!st.length) return empty(4);
    baseLen = st.length * P.length;
    K = Math.max(4, Math.min(36, Math.round((st.K || 12) * Math.sqrt(Math.max(0.3, P.length)))));
    count = Math.round(P.count * (st.density || 1) * P.density);
    stiff = st.stiff ?? 0.5; gravity = (st.gravity ?? 1) * P.gravity; lift = (st.lift ?? 0.2) + P.volume * 0.3;
  } else if (kind === 'brow') {
    baseLen = 0.0085 * P.length; K = 5; count = Math.round(1300 * P.density); stiff = 0.9; gravity = 0; lift = 0.12;
  } else if (kind === 'beard') {
    baseLen = P.length; K = baseLen < 0.004 ? 3 : Math.min(14, 4 + Math.round(baseLen / 0.006));
    count = Math.round(16000 * P.density); stiff = 0.6; gravity = 0.4; lift = baseLen < 0.004 ? 0.55 : 0.3;
  } else {
    baseLen = 0.011 * P.length; K = 4; count = Math.round(9000 * P.density); stiff = 0.8; gravity = 0.1; lift = 0.12;
  }
  if (count < 1 || baseLen <= 0) return empty(K);
  const dens = job.density;
  const { roots } = sampleRoots(mesh, dens, count, rand, kind === 'scalp' ? 0.7 : 1);
  const N = roots.length;
  if (!N) return empty(K);
  const sdf = (kind === 'scalp' && baseLen > 0.006) ? new VoxelSDF(mesh.pos, mesh.nrm, findMinY(mesh, baseLen), baseLen > 0.15 ? 300000 : 160000) : null;
  const headRot = job.headRot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const pts = new Float32Array(N * K * 4);
  const attr = new Float32Array(N * 4);
  const rootIdx = new Int32Array(N * 3);
  const rootW = new Float32Array(N * 3);

  // clump guides: a subset of roots, each strand follows its nearest guide towards the tip
  const clumpAmt = kind === 'scalp' ? (st.clump || 0.3) * P.clump : (kind === 'beard' ? 0.3 : 0);
  const clumpSpacing = st.clumps || (0.012 + 0.006 * (1 - P.clump));
  const tmp = [0, 0, 0];
  const rootInfo = roots.map((r) => {
    const p = interp(mesh.pos, 3, mesh.index, r, [0, 0, 0]);
    const n = norm(interp(mesh.nrm, 3, mesh.index, r, [0, 0, 0]));
    const rp = interp(mesh.rest, 3, mesh.index, r, [0, 0, 0]);
    const rn = norm(interp(mesh.restN, 3, mesh.index, r, [0, 0, 0]));
    const d = interp(dens, 1, mesh.index, r, tmp)[0];
    return { p, n, rp, rn, d };
  });

  // spatial hash on rest positions for clump assignment
  let guides = null, guideOf = null;
  if (clumpAmt > 0.01) {
    const cell = clumpSpacing;
    const hash = new Map();
    guides = [];
    rootInfo.forEach((ri, i) => {
      const key = ri.rp.map((v) => Math.floor(v / cell)).join(',');
      if (!hash.has(key)) { hash.set(key, guides.length); guides.push(i); }
    });
    guideOf = new Int32Array(N);
    rootInfo.forEach((ri, i) => {
      const c = ri.rp.map((v) => Math.floor(v / cell));
      let best = -1, bd = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const g = hash.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`);
        if (g === undefined) continue;
        const d = len(sub(rootInfo[guides[g]].rp, ri.rp));
        if (d < bd) { bd = d; best = g; }
      }
      guideOf[i] = best;
    });
  }

  const simulate = (i, out, curlPhase) => {
    const ri = rootInfo[i];
    const r1 = hashRand(i * 3 + 1), r2 = hashRand(i * 3 + 2), r3 = hashRand(i * 3 + 3);
    let L = baseLen * (0.82 + 0.36 * r1);
    let dirRest;
    if (kind === 'scalp') {
      // length zones
      const q = sub(ri.rp, HEAD_C);
      const top = smooth(0.79, 0.83, ri.rp[1]);
      const side = smooth(0.04, 0.07, Math.abs(q[0])) * (1 - top);
      L *= (1 + ((st.lengthTop || 1) - 1) * top) * (1 + ((st.lengthSide || 1) - 1) * side);
      if (st.bangs) L *= 1 - st.bangs * 0.55 * smooth(0.0, 0.08, q[2]) * smooth(0.76, 0.8, ri.rp[1]);
      if (st.undercut) L *= 1 - st.undercut * (1 - smooth(0.79, 0.805, ri.rp[1])) * 0.9;
      // fine, short baby hairs where the density fades out at the hairline
      L *= 0.08 + 0.92 * smooth(0.05, 0.7, ri.d);
      dirRest = scalpGroom(st, ri.rp, ri.rn, P.part ?? st.part ?? 0);
    } else if (kind === 'brow') {
      const t = job.extra.browT ? interp(job.extra.browT, 1, mesh.index, roots[i], [0])[0] : 0.5;
      const sx = Math.sign(ri.rp[0]) || 1;
      const lat = t < 0.18 ? 0.35 : (t < 0.62 ? 1 : 1);
      const up = t < 0.18 ? 1 : (t < 0.62 ? 0.32 : -0.22);
      dirRest = norm(tangentOf([sx * lat, up + (r2 - 0.5) * 0.5, 0], ri.rn));
      L *= t < 0.18 ? 0.7 : (t > 0.85 ? 0.75 : 1);
    } else if (kind === 'beard') {
      const sx = Math.sign(ri.rp[0]) || 1;
      const must = smooth(0.672, 0.68, ri.rp[1]) * smooth(0.04, 0.0, Math.abs(ri.rp[0]));
      const neck = smooth(0.62, 0.6, ri.rp[1]);
      let g = [sx * (0.15 + must * 0.9), -1, 0.15];
      if (neck > 0) g = mix(g, [sx * 0.2, -0.5, 1], neck * 0.7);
      dirRest = norm(tangentOf(g, ri.rn));
    } else {
      // body hair along the limbs towards the extremities
      const x = Math.abs(ri.rp[0]);
      const sx = Math.sign(ri.rp[0]) || 1;
      let g = [0, -1, 0];
      if (x > 0.17 && ri.rp[1] > 0.1) g = [sx * 0.75, -0.65, 0.1];
      dirRest = norm(tangentOf(add(g, scl([r2 - 0.5, r3 - 0.5, 0], 0.6)), ri.rn));
    }
    const dir0 = norm(add(scl(mat3v(headRotFor(kind, headRot), dirRest), 1 - lift), scl(ri.n, lift)));
    const seg = L / (K - 1);
    let p = add(ri.p, scl(ri.n, 0.0002));
    let d = dir0;
    const layer = r2;
    const minD = kind === 'scalp' ? 0.0015 + (P.volume * 0.012 + 0.002) * (0.3 + 0.7 * layer) : 0;
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
    const down = [0, -1, 0];
    const comb = kind === 'scalp' ? (st.comb ?? 0.35) : 0;
    const Hinv = job.headInv;
    for (let k = 1; k < K; k++) {
      const t = k / (K - 1);
      // stiffness keeps the root direction, gravity pulls down further along the strand
      const g = gravity * (1 - stiff * (1 - t) * 0.9) * seg * 18;
      d = norm(add(d, scl(down, g)));
      if (kind === 'brow' || kind === 'body') d = norm(add(d, scl(ri.n, -0.18)));   // lie flat
      // long hair: most of it falls behind the shoulders, held there by friction
      if (st.behind && k > 2) {
        const below = smooth(job.neckY + 0.06, job.neckY - 0.02, p[1]);
        const fwd = mat3v(headRot, [0, 0, 1]);
        d = norm(add(d, scl(fwd, -st.behind * below * seg * 9 * (0.6 + 0.8 * r3))));
      }
      // combing: while close to the scalp, the strand follows the groom field along
      // the head surface before it is allowed to fall freely
      if (comb > 0 && sdf && Hinv) {
        const sdist = sdf.sample(p);
        const zone = 0.012 + minD * 1.5;
        if (sdist < zone) {
          const pr = mat4p(Hinv, p);
          if (pr[1] > 0.66) {
            const rn = norm(sub(pr, HEAD_C));
            const gw = mat3v(headRot, scalpGroom(st, pr, rn, P.part ?? st.part ?? 0));
            const w = comb * smooth(zone, zone * 0.4, sdist) * smooth(0.66, 0.72, pr[1]);
            const gn = sdf.grad(p);
            d = norm(add(scl(d, 1 - w * 0.7), scl(gw, w)));
            d = norm(add(tangentOf(d, gn), scl(gn, Math.max(0, dot(d, gn)) * (1 - w))));
          }
        }
      }
      let np = add(p, scl(d, seg));
      if (sdf) {
        const want = minD * smooth(0.0, 0.25, t) + 0.0012;
        const sd = sdf.sample(np);
        if (sd < want) {
          const gr = sdf.grad(np);
          np = add(np, scl(gr, want - sd));
          d = norm(sub(np, p));
          np = add(p, scl(d, seg));
        }
      }
      p = np;
      out[k * 3] = p[0]; out[k * 3 + 1] = p[1]; out[k * 3 + 2] = p[2];
    }
    return { L, layer, r1, r3, curlPhase };
  };

  // simulate guides first
  const guideShapes = new Map();
  if (guides) {
    for (const gi of guides) {
      const out = new Float32Array(K * 3);
      simulate(gi, out, hashRand(gi * 17) * Math.PI * 2);
      guideShapes.set(gi, out);
    }
  }

  const curlR = (st.curl || 0) * P.curl + (P.curlExtra || 0), curlF = st.curlFreq || 30;
  const waveA = (st.wave || 0) * P.wave + (P.waveExtra || 0) * 0.015, waveF = st.waveFreq || 8;
  const frizz = (st.frizz || 0.1) * P.frizz;
  const shape = new Float32Array(K * 3);
  for (let i = 0; i < N; i++) {
    const gIdx = guides ? guides[guideOf[i]] : -1;
    const phase = gIdx >= 0 ? hashRand(gIdx * 17) * Math.PI * 2 : hashRand(i * 13) * Math.PI * 2;
    const info = simulate(i, shape, phase);
    const g = gIdx >= 0 ? guideShapes.get(gIdx) : null;
    // frame along the strand for curls/waves
    let T = norm([shape[3] - shape[0], shape[4] - shape[1], shape[5] - shape[2]]);
    let B1 = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    let s = 0;
    const base = i * K * 4;
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1);
      let p = [shape[k * 3], shape[k * 3 + 1], shape[k * 3 + 2]];
      if (k > 0) {
        const Tn = norm([shape[k * 3] - shape[k * 3 - 3], shape[k * 3 + 1] - shape[k * 3 - 2], shape[k * 3 + 2] - shape[k * 3 - 1]]);
        // parallel transport of B1
        B1 = norm(tangentOf(B1, Tn));
        T = Tn;
        s += info.L / (K - 1);
      }
      const B2 = cross(T, B1);
      if (g && gIdx !== i) {
        // pull towards the guide shape (offset by the root difference that fades out)
        const gp = [g[k * 3], g[k * 3 + 1], g[k * 3 + 2]];
        const rootOff = sub([shape[0], shape[1], shape[2]], [g[0], g[1], g[2]]);
        const target = add(gp, scl(rootOff, 1 - t * 0.85));
        p = mix(p, target, clumpAmt * Math.pow(t, 0.6));
      }
      const ramp = smooth(0.0, 0.25, t);
      if (curlR > 0) {
        const a = s * curlF * Math.PI * 2 + info.curlPhase;
        const r = curlR * ramp * (0.8 + 0.4 * info.r3);
        p = add(p, add(scl(B1, Math.cos(a) * r), scl(B2, Math.sin(a) * r)));
      }
      if (waveA > 0) p = add(p, scl(B1, Math.sin(s * waveF * Math.PI * 2 + info.curlPhase) * waveA * ramp));
      if (frizz > 0) {
        const f = frizz * 0.004 * t * t * (kind === 'scalp' ? 1 : 0.4);
        p = add(p, [(hashRand(i * 91 + k * 7) - 0.5) * f, (hashRand(i * 37 + k * 11) - 0.5) * f, (hashRand(i * 53 + k * 13) - 0.5) * f]);
      }
      if (sdf && k > 0) {
        const sd = sdf.sample(p);
        if (sd < 0.0012) p = add(p, scl(sdf.grad(p), 0.0012 - sd));
      }
      pts[base + k * 4] = p[0]; pts[base + k * 4 + 1] = p[1]; pts[base + k * 4 + 2] = p[2]; pts[base + k * 4 + 3] = t;
    }
    const ri = rootInfo[i];
    const rt = roots[i].tri * 3;
    rootIdx[i * 3] = mesh.index[rt]; rootIdx[i * 3 + 1] = mesh.index[rt + 1]; rootIdx[i * 3 + 2] = mesh.index[rt + 2];
    rootW[i * 3] = roots[i].b[0]; rootW[i * 3 + 1] = roots[i].b[1]; rootW[i * 3 + 2] = roots[i].b[2];
    attr[i * 4] = (0.6 + 0.4 * Math.min(1, ri.d)) * (0.8 + 0.4 * info.r1);
    attr[i * 4 + 1] = hashRand(i * 7 + 3);
    attr[i * 4 + 2] = info.r3;
    attr[i * 4 + 3] = info.layer;
  }
  return { pts, attr, N, K, rootIdx, rootW };
}

function headRotFor(kind, headRot) {
  return kind === 'body' ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : headRot;
}

function findMinY(mesh, L) {
  let maxY = -Infinity;
  for (let i = 1; i < mesh.pos.length; i += 3) maxY = Math.max(maxY, mesh.pos[i]);
  return maxY - 0.33 - L * 1.1;
}

function hashRand(n) {
  let x = (n | 0) * 0x9e3779b1;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function empty(K) { return { pts: new Float32Array(0), attr: new Float32Array(0), N: 0, K, rootIdx: new Int32Array(0), rootW: new Float32Array(0) }; }

// --------------------------------------------------------------------- lashes
function generateLashes(job) {
  const { lines, eyeCenters } = job.extra;
  const P = job.params;
  const K = 7;
  const out = [];
  const attrs = [];
  const rIdx = [], rW = [];
  const rand = mulberry32(4242);
  for (const line of lines) {
    const c = eyeCenters[line.side];
    const upper = line.upper;
    const n = Math.round((upper ? 120 : 70) * P.density);
    const pts = line.points;                        // posed points along the lid margin
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    const total = cum[cum.length - 1];
    for (let j = 0; j < n; j++) {
      const s = ((j + rand() * 0.8) / n) * total;
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const t0 = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      const root = mix(pts[i - 1], pts[i], t0);
      const u = s / total;                          // 0 medial .. 1 lateral (ordering given)
      const along = norm(sub(pts[i], pts[i - 1]));
      const radial = norm(sub(root, c));
      const lidUp = upper ? job.up : scl(job.up, -1);
      const prof = Math.sin(Math.min(1, Math.max(0, u)) * Math.PI);
      const L = (upper ? 0.0105 : 0.006) * P.length * (0.45 + 0.55 * Math.pow(prof, 0.6)) * (0.85 + 0.3 * rand());
      let d = norm(add(scl(radial, 0.85), scl(lidUp, 0.35 + P.curl * 0.2)));
      d = norm(add(d, scl(along, (u - 0.45) * 0.5)));       // fan out towards the corners
      const seg = L / (K - 1);
      // lashes emerge from the anterior lid margin, slightly in front of the helper row
      let p = add(add(root, scl(radial, 0.0009)), scl(lidUp, 0.0004));
      const base = out.length;
      for (let k = 0; k < K; k++) {
        if (k > 0) {
          d = norm(add(d, scl(lidUp, (0.16 + P.curl * 0.18))));
          p = add(p, scl(d, seg));
        }
        out.push(p[0], p[1], p[2], k / (K - 1));
      }
      void base;
      attrs.push(0.8 + 0.4 * rand(), rand(), rand(), 0.2);
      rIdx.push(line.render[i - 1], line.render[i], line.render[i]);
      rW.push(1 - t0, t0, 0);
    }
  }
  const N = attrs.length / 4;
  return { pts: Float32Array.from(out), attr: Float32Array.from(attrs), N, K, rootIdx: Int32Array.from(rIdx), rootW: Float32Array.from(rW) };
}
