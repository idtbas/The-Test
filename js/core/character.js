// Character pipeline: morph -> skeleton -> pose + bone shape -> skinning -> subdivision.
// Produces render-ready vertex data in meters with the feet on y = 0.

import { Human } from './human.js';
import { Skeleton } from './skeleton.js';
import { SubdivMesh } from './subdivide.js';
import { POSES } from './poses.js';

export const DM = 0.1; // data is in decimeters

// Bone shape controls. Each scales a set of bones; `tree` also scales all descendants so
// that e.g. the whole skull grows uniformly including the facial bones.
export const BONE_SHAPES = [
  { id: 'skull', label: 'Schädelgröße', bones: ['head'], tree: true, axes: 'xyz' },
  { id: 'skullW', label: 'Schädelbreite', bones: ['head'], tree: true, axes: 'x' },
  { id: 'skullH', label: 'Schädelhöhe', bones: ['head'], tree: true, axes: 'y' },
  { id: 'skullD', label: 'Schädeltiefe', bones: ['head'], tree: true, axes: 'z' },
  { id: 'jaw', label: 'Unterkiefer', bones: ['jaw'], tree: true, axes: 'xyz' },
  { id: 'neckL', label: 'Halswirbel Länge', bones: ['neck01', 'neck02', 'neck03'], axes: 'y' },
  { id: 'neckT', label: 'Halswirbel Stärke', bones: ['neck01', 'neck02', 'neck03'], axes: 'xz' },
  { id: 'spineL', label: 'Wirbelsäule Länge', bones: ['spine01', 'spine02', 'spine03', 'spine04', 'spine05'], axes: 'y' },
  { id: 'chestW', label: 'Brustkorb Breite', bones: ['spine01', 'spine02', 'spine03'], axes: 'x' },
  { id: 'chestD', label: 'Brustkorb Tiefe', bones: ['spine01', 'spine02', 'spine03'], axes: 'z' },
  { id: 'clavicle', label: 'Schlüsselbein (Schulterbreite)', bones: ['clavicle.L', 'clavicle.R'], axes: 'y' },
  { id: 'pelvis', label: 'Becken Breite', bones: ['pelvis.L', 'pelvis.R'], axes: 'y' },
  { id: 'humerusL', label: 'Oberarmknochen Länge', bones: ['upperarm01.L', 'upperarm02.L', 'upperarm01.R', 'upperarm02.R'], axes: 'y' },
  { id: 'humerusT', label: 'Oberarm Stärke', bones: ['upperarm01.L', 'upperarm02.L', 'upperarm01.R', 'upperarm02.R'], axes: 'xz' },
  { id: 'ulnaL', label: 'Unterarmknochen Länge', bones: ['lowerarm01.L', 'lowerarm02.L', 'lowerarm01.R', 'lowerarm02.R'], axes: 'y' },
  { id: 'ulnaT', label: 'Unterarm Stärke', bones: ['lowerarm01.L', 'lowerarm02.L', 'lowerarm01.R', 'lowerarm02.R'], axes: 'xz' },
  { id: 'hand', label: 'Handknochen', bones: ['wrist.L', 'wrist.R'], tree: true, axes: 'xyz' },
  { id: 'fingers', label: 'Fingerglieder Länge', bones: [1, 2, 3, 4, 5].flatMap((f) => [1, 2, 3].flatMap((j) => [`finger${f}-${j}.L`, `finger${f}-${j}.R`])), axes: 'y' },
  { id: 'femurL', label: 'Oberschenkelknochen Länge', bones: ['upperleg01.L', 'upperleg02.L', 'upperleg01.R', 'upperleg02.R'], axes: 'y' },
  { id: 'femurT', label: 'Oberschenkel Stärke', bones: ['upperleg01.L', 'upperleg02.L', 'upperleg01.R', 'upperleg02.R'], axes: 'xz' },
  { id: 'tibiaL', label: 'Schienbein Länge', bones: ['lowerleg01.L', 'lowerleg02.L', 'lowerleg01.R', 'lowerleg02.R'], axes: 'y' },
  { id: 'tibiaT', label: 'Unterschenkel Stärke', bones: ['lowerleg01.L', 'lowerleg02.L', 'lowerleg01.R', 'lowerleg02.R'], axes: 'xz' },
  { id: 'foot', label: 'Fußknochen', bones: ['foot.L', 'foot.R'], tree: true, axes: 'xyz' },
];

export class Character {
  constructor(assets, { subdivision = 1 } = {}) {
    this.assets = assets;
    this.human = new Human(assets);
    this.skeleton = new Skeleton(assets.rig);
    this.weights = assets.weights;
    const m = assets.mesh;
    this.nv = m.meta.numVerts;
    this.posed = new Float64Array(this.nv * 3);
    this.poseId = 'relaxed';
    this.poseVersion = 0;
    this.boneShape = {};             // id -> value (1 = neutral)
    this.rootOffset = [0, 0, 0];
    this.groundY = 0;

    this.parts = {};
    const mk = (name, level) => {
      const sd = new SubdivMesh(m[name + 'QuadV'], m[name + 'QuadT'], m.uvs, level);
      this.parts[name] = {
        sd,
        position: new Float32Array(sd.numRender * 3),
        normal: new Float32Array(sd.numRender * 3),
        uv: sd.renderUV,
        index: sd.index,
      };
    };
    mk('body', subdivision);
    mk('tongue', 1);
    mk('upperTeeth', 1);
    mk('lowerTeeth', 1);
    mk('tights', subdivision);

    // static per-vertex attributes of the body: rest position (for procedural detail)
    // and baked thickness (for translucency)
    const body = this.parts.body;
    const restNew = body.sd.subdivideAttr(m.positions, 3);
    body.rest = body.sd.scatter(restNew, 3, new Float32Array(body.sd.numRender * 3), DM);
    const thick = new Float32Array(this.nv);
    for (let i = 0; i < m.thickness.length; i++) thick[i] = m.thickness[i] / 85;
    const thickNew = body.sd.subdivideAttr(thick, 1);
    body.thickness = body.sd.scatter(thickNew, 1, new Float32Array(body.sd.numRender), DM);

    this._initEyes(assets.eyes);
    this.morphVersion = -1;
    this.poseDirty = true;
    this.version = 0;
  }

  // ------------------------------------------------------------------- eyes
  _initEyes(eyes) {
    const nv = eyes.meta.numVerts;
    // split into components: eyeball / cornea for each side (by uv region and x sign)
    const P = eyes.positions;
    const quadV = eyes.quadV, quadT = eyes.quadT, uvs = eyes.uvs;
    const parts = { L: { ball: [], cornea: [] }, R: { ball: [], cornea: [] } };
    for (let q = 0; q < quadV.length / 4; q++) {
      const v0 = quadV[q * 4];
      const t0 = quadT[q * 4];
      const s = P[v0 * 3] > 0 ? 'L' : 'R';
      const cornea = uvs[t0 * 2] > 0.86 && uvs[t0 * 2 + 1] < 0.14;
      parts[s][cornea ? 'cornea' : 'ball'].push(q);
    }
    // local eye coordinates: sphere-fit center of the eyeball and its radius
    const local = new Float32Array(nv * 3);
    this.eyeMeshes = {};
    for (const s of ['L', 'R']) {
      const ballVerts = new Set();
      for (const q of parts[s].ball) for (let k = 0; k < 4; k++) ballVerts.add(quadV[q * 4 + k]);
      let cx = 0, cy = 0, cz = 0;
      for (const v of ballVerts) { cx += P[v * 3]; cy += P[v * 3 + 1]; }
      cx /= ballVerts.size; cy /= ballVerts.size;
      // the ball is a sphere truncated at the back: center z from back-most & front-most
      let zmin = 1e9, zmax = -1e9;
      for (const v of ballVerts) { zmin = Math.min(zmin, P[v * 3 + 2]); zmax = Math.max(zmax, P[v * 3 + 2]); }
      let r = 0;
      for (const v of ballVerts) r = Math.max(r, Math.hypot(P[v * 3] - cx, P[v * 3 + 1] - cy));
      cz = zmax - r;
      for (let v = 0; v < nv; v++) {
        if ((P[v * 3] > 0) !== (s === 'L')) continue;
        local[v * 3] = (P[v * 3] - cx) / r;
        local[v * 3 + 1] = (P[v * 3 + 1] - cy) / r;
        local[v * 3 + 2] = (P[v * 3 + 2] - cz) / r;
      }
      for (const kind of ['ball', 'cornea']) {
        const qs = parts[s][kind];
        const map = new Map(); const verts = [];
        const index = [];
        for (const q of qs) {
          const ids = [0, 1, 2, 3].map((k) => {
            const v = quadV[q * 4 + k];
            let l = map.get(v);
            if (l === undefined) { l = verts.length; map.set(v, l); verts.push(v); }
            return l;
          });
          index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        }
        const n = verts.length;
        const loc = new Float32Array(n * 3);
        verts.forEach((v, i) => loc.set(local.subarray(v * 3, v * 3 + 3), i * 3));
        this.eyeMeshes[s + kind] = {
          verts: Uint32Array.from(verts),
          index: Uint32Array.from(index),
          local: loc,
          position: new Float32Array(n * 3),
          normal: new Float32Array(n * 3),
          fitted: new Float64Array(n * 3),
        };
      }
    }
    this.eyeRefs = eyes.meta.refs;
    this.eyeScales = eyes.meta.scales;
    this.eyeFitted = new Float64Array(nv * 3);
    this.eyeCenter = { L: [0, 0, 0], R: [0, 0, 0] };
    this.eyeRadius = 0.012;
  }

  _fitEyes() {
    const M = this.human.morphed, Q = this.posed;
    const sc = {};
    for (const ax of ['x', 'y', 'z']) {
      const [a, b, ref] = this.eyeScales[ax];
      const k = { x: 0, y: 1, z: 2 }[ax];
      sc[ax] = Math.abs(M[a * 3 + k] - M[b * 3 + k]) / ref;
    }
    const out = this.eyeFitted;
    const refs = this.eyeRefs;
    for (let i = 0; i < refs.length; i++) {
      const [v1, v2, v3, w1, w2, w3, ox, oy, oz] = refs[i];
      for (let k = 0; k < 3; k++) {
        out[i * 3 + k] = w1 * Q[v1 * 3 + k] + w2 * Q[v2 * 3 + k] + w3 * Q[v3 * 3 + k];
      }
      out[i * 3] += ox * sc.x; out[i * 3 + 1] += oy * sc.y; out[i * 3 + 2] += oz * sc.z;
    }
    // Fit an affine map eye-local -> world for each eyeball (least squares). The local
    // frame is the eye obj's own: radius 1, +z forward, +y up.
    this.eyeAffine = this.eyeAffine || {};
    for (const s of ['L', 'R']) {
      for (const kind of ['ball', 'cornea']) {
        const em = this.eyeMeshes[s + kind];
        for (let j = 0; j < em.verts.length; j++) {
          const v = em.verts[j];
          em.fitted[j * 3] = out[v * 3]; em.fitted[j * 3 + 1] = out[v * 3 + 1]; em.fitted[j * 3 + 2] = out[v * 3 + 2];
        }
      }
      const ball = this.eyeMeshes[s + 'ball'];
      const AtA = new Float64Array(16), AtW = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
      for (let j = 0; j < ball.verts.length; j++) {
        const a = [ball.local[j * 3], ball.local[j * 3 + 1], ball.local[j * 3 + 2], 1];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) AtA[r * 4 + c] += a[r] * a[c];
          for (let k = 0; k < 3; k++) AtW[k][r] += a[r] * ball.fitted[j * 3 + k];
        }
      }
      const rows = AtW.map((b) => solve4(AtA, b));   // rows[k] = [m_kx, m_ky, m_kz, t_k]
      this.eyeAffine[s] = rows;
      this.eyeCenter[s] = [rows[0][3], rows[1][3], rows[2][3]];
    }
    const rL = this.eyeAffine.L;
    this.eyeRadius = Math.cbrt(Math.abs(det3(rL))) * DM;
  }

  /** Rotate eyes towards a world-space target (meters) and write their render buffers. */
  updateEyes(target, maxAngle = 0.6) {
    for (const s of ['L', 'R']) {
      const c = this.eyeCenter[s];
      const cw = [c[0] * DM, c[1] * DM - this.groundY, c[2] * DM];
      const A = this.eyeAffine[s];
      let fwd = [A[0][2], A[1][2], A[2][2]];
      const fl = Math.hypot(...fwd); fwd = fwd.map((x) => x / fl);
      let rot = null;
      if (target) {
        let d = [target[0] - cw[0], target[1] - cw[1], target[2] - cw[2]];
        const l = Math.hypot(...d); d = d.map((x) => x / l);
        let dot = fwd[0] * d[0] + fwd[1] * d[1] + fwd[2] * d[2];
        let ang = Math.acos(Math.min(1, Math.max(-1, dot)));
        let axis = [fwd[1] * d[2] - fwd[2] * d[1], fwd[2] * d[0] - fwd[0] * d[2], fwd[0] * d[1] - fwd[1] * d[0]];
        const al = Math.hypot(...axis);
        if (al > 1e-6 && ang > 1e-4) {
          axis = axis.map((x) => x / al);
          ang = Math.min(ang, maxAngle);
          rot = rodrigues(axis, ang);
        }
      }
      for (const kind of ['ball', 'cornea']) {
        const em = this.eyeMeshes[s + kind];
        const F = em.fitted, P = em.position;
        for (let j = 0; j < em.verts.length; j++) {
          let x = F[j * 3] - c[0], y = F[j * 3 + 1] - c[1], z = F[j * 3 + 2] - c[2];
          if (rot) {
            const nx = rot[0] * x + rot[3] * y + rot[6] * z;
            const ny = rot[1] * x + rot[4] * y + rot[7] * z;
            const nz = rot[2] * x + rot[5] * y + rot[8] * z;
            x = nx; y = ny; z = nz;
          }
          P[j * 3] = (x + c[0]) * DM;
          P[j * 3 + 1] = (y + c[1]) * DM - this.groundY;
          P[j * 3 + 2] = (z + c[2]) * DM;
        }
        computeNormals(P, em.index, em.normal);
      }
      // local -> world (meters) including gaze, column-major 4x4
      const R = rot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const M = new Float64Array(16);
      for (let col = 0; col < 3; col++) {
        const v = [A[0][col], A[1][col], A[2][col]];
        const w = [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
        M[col * 4] = w[0] * DM; M[col * 4 + 1] = w[1] * DM; M[col * 4 + 2] = w[2] * DM;
      }
      M[12] = cw[0]; M[13] = cw[1]; M[14] = cw[2]; M[15] = 1;
      this.eyeMatrix = this.eyeMatrix || {};
      this.eyeMatrix[s] = M;
    }
  }

  // ------------------------------------------------------------------- update
  setPose(id) { this.poseId = id; this.poseDirty = true; this.poseVersion++; }
  setBoneShape(id, v) { this.boneShape[id] = v; this.poseDirty = true; this.poseVersion++; }
  get shapeVersion() { return this.human.shapeVersion * 7919 + this.poseVersion; }

  _applyBoneShapes() {
    const S = this.skeleton;
    S.scale.fill(1);
    const desc = (i, out) => {
      out.push(i);
      for (let c = 0; c < S.n; c++) if (S.bones[c].parent === i) desc(c, out);
      return out;
    };
    for (const def of BONE_SHAPES) {
      const v = this.boneShape[def.id];
      if (v === undefined || Math.abs(v - 1) < 1e-4) continue;
      let ids = def.bones.map((b) => S.byName.get(b)).filter((i) => i !== undefined);
      if (def.tree) ids = ids.flatMap((i) => desc(i, []));
      for (const i of ids) {
        if (def.axes.includes('x')) S.scale[i * 3] *= v;
        if (def.axes.includes('y')) S.scale[i * 3 + 1] *= v;
        if (def.axes.includes('z')) S.scale[i * 3 + 2] *= v;
      }
    }
  }

  /** Returns true if geometry changed. */
  update() {
    const H = this.human;
    const morphChanged = H.update();
    if (!morphChanged && !this.poseDirty && this.morphVersion === H.version) return false;
    const S = this.skeleton;
    if (morphChanged || this.morphVersion !== H.version) S.computeRest(H.morphed);
    this.morphVersion = H.version;
    S.resetPose();
    (POSES[this.poseId] || POSES.relaxed).apply(S);
    this._applyBoneShapes();
    S.computePose(this.rootOffset);
    S.skinVertices(H.morphed, this.weights, this.posed);
    this.poseDirty = false;

    // ground: lowest point of the body
    const Q = this.posed;
    let minY = Infinity;
    const nb = this.assets.mesh.meta.groups.body[2];
    for (let v = 0; v < nb; v++) if (Q[v * 3 + 1] < minY) minY = Q[v * 3 + 1];
    this.groundY = minY * DM;
    const off = [0, -this.groundY, 0];

    for (const name of Object.keys(this.parts)) {
      const p = this.parts[name];
      p.sd.update(Q);
      p.sd.scatter(p.sd.newPos, 3, p.position, DM, off);
      p.sd.scatter(p.sd.newNrm, 3, p.normal);
    }
    this._fitEyes();
    this.version++;
    return true;
  }

  /** Height in meters (top of head to sole). */
  get height() {
    const Q = this.posed;
    let maxY = -Infinity;
    const nb = this.assets.mesh.meta.groups.body[2];
    for (let v = 0; v < nb; v++) if (Q[v * 3 + 1] > maxY) maxY = Q[v * 3 + 1];
    return maxY * DM - this.groundY;
  }

  /** Posed world position (meters) of a joint/bone head. */
  bonePos(name) {
    const S = this.skeleton, i = S.byName.get(name);
    return [S.poseHead[i * 3] * DM, S.poseHead[i * 3 + 1] * DM - this.groundY, S.poseHead[i * 3 + 2] * DM];
  }
}

function solve4(A, b) {
  // Gaussian elimination with partial pivoting on a copy (4x4, row-major)
  const M = Array.from({ length: 4 }, (_, r) => [A[r * 4], A[r * 4 + 1], A[r * 4 + 2], A[r * 4 + 3], b[r]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, r) => row[4] / row[r]);
}

function det3(rows) {
  const [a, b, c] = rows;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function rodrigues(axis, ang) {
  const [x, y, z] = axis;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  ];
}

export function computeNormals(P, index, N) {
  N.fill(0);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = 0; i < N.length; i += 3) {
    const x = N[i], y = N[i + 1], z = N[i + 2];
    const l = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    N[i] = x * l; N[i + 1] = y * l; N[i + 2] = z * l;
  }
}
