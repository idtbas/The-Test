// Skeleton derived from the morphed mesh (joint helper cubes), posing with per-bone
// rotation + non-inheriting 3x3 shape matrix ("bone shape"), and CPU linear blend skinning.
//
// Bone frame convention: Y = head->tail, X = normal of the bone's rotation plane
// (the hinge axis for elbows/knees/fingers), Z = X x Y.

const tmp = new Float64Array(9);

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

// 3x3 matrices as Float64Array(9), column-major: m[c*3 + r]
export function mat3Mul(a, b, out = new Float64Array(9)) {
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      tmp[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
  }
  out.set(tmp);
  return out;
}
export function mat3T(a, out = new Float64Array(9)) {
  const t = [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  out.set(t);
  return out;
}
export function mat3Vec(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}
export function axisAngle(ax, ang) {
  const [x, y, z] = normalize([...ax]);
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return Float64Array.of(
    t * x * x + c, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  );
}
// intrinsic rotation: X then Y then Z (local axes, angles in radians)
export function eulerXYZ(x, y, z) {
  let m = axisAngle([1, 0, 0], x);
  if (y) m = mat3Mul(m, axisAngle([0, 1, 0], y));
  if (z) m = mat3Mul(m, axisAngle([0, 0, 1], z));
  return m;
}

export class Skeleton {
  constructor(rig) {
    this.bones = rig.bones;
    this.n = rig.bones.length;
    this.byName = new Map(rig.bones.map((b, i) => [b.name, i]));
    this.jointNames = Object.keys(rig.joints);
    this.jointVerts = this.jointNames.map((j) => rig.joints[j]);
    this.jointIndex = new Map(this.jointNames.map((j, i) => [j, i]));
    this.joints = new Float64Array(this.jointNames.length * 3);
    const n = this.n;
    this.restHead = new Float64Array(n * 3);
    this.restTail = new Float64Array(n * 3);
    this.restRot = Array.from({ length: n }, () => new Float64Array(9));
    this.length = new Float64Array(n);
    this.poseHead = new Float64Array(n * 3);
    this.poseRot = Array.from({ length: n }, () => new Float64Array(9));
    this.local = Array.from({ length: n }, () => Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1));
    this.shape = Array.from({ length: n }, () => Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)); // in the bone's rest frame
    this.skin = new Float64Array(n * 12); // 3x4 per bone, column-major
  }

  joint(name) {
    const i = this.jointIndex.get(name);
    return [this.joints[i * 3], this.joints[i * 3 + 1], this.joints[i * 3 + 2]];
  }

  computeRest(pos) {
    for (let j = 0; j < this.jointVerts.length; j++) {
      const vs = this.jointVerts[j];
      let x = 0, y = 0, z = 0;
      for (const v of vs) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
      this.joints[j * 3] = x / vs.length;
      this.joints[j * 3 + 1] = y / vs.length;
      this.joints[j * 3 + 2] = z / vs.length;
    }
    for (let i = 0; i < this.n; i++) {
      const b = this.bones[i];
      const h = this.joint(b.head), t = this.joint(b.tail);
      this.restHead.set(h, i * 3);
      this.restTail.set(t, i * 3);
      const y = sub(t, h);
      this.length[i] = Math.hypot(...y);
      normalize(y);
      const [p0, p1, p2] = b.plane.map((j) => this.joint(j));
      let x = normalize(cross(sub(p1, p0), sub(p2, p1)));
      const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
      x = normalize([x[0] - d * y[0], x[1] - d * y[1], x[2] - d * y[2]]);
      if (!isFinite(x[0]) || Math.hypot(...x) < 0.5) x = normalize(cross(y, [0, 0, 1]));
      const z = cross(x, y);
      this.restRot[i].set([...x, ...y, ...z]);
    }
  }

  resetPose() {
    for (let i = 0; i < this.n; i++) this.local[i].set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }

  /** Rotate bone about an axis given in its own rest frame. */
  rotateLocal(name, axis, angle) {
    const i = this.byName.get(name);
    if (i === undefined) return;
    mat3Mul(this.local[i], axisAngle(axis, angle), this.local[i]);
  }

  /**
   * Rotate bone about an axis given in rest-pose world space, applied after the rotations
   * already set on this bone (extrinsic order, so calls compose like world rotations).
   */
  rotateWorld(name, axis, angle) {
    const i = this.byName.get(name);
    if (i === undefined) return;
    const R = this.restRot[i];
    const la = mat3Vec(mat3T(R), axis);
    mat3Mul(axisAngle(la, angle), this.local[i], this.local[i]);
  }

  setScale(name, sx, sy, sz) {
    const i = this.byName.get(name);
    if (i === undefined) return;
    this.shape[i].set([sx, 0, 0, 0, sy, 0, 0, 0, sz]);
  }

  computePose(rootOffset = [0, 0, 0]) {
    const RtP = new Float64Array(9), q = new Float64Array(9), RS = new Float64Array(9);
    for (let i = 0; i < this.n; i++) {
      const p = this.bones[i].parent;
      const R = this.restRot[i];
      if (p < 0) {
        mat3Mul(R, this.local[i], this.poseRot[i]);
        for (let k = 0; k < 3; k++) this.poseHead[i * 3 + k] = this.restHead[i * 3 + k] + rootOffset[k];
      } else {
        mat3T(this.restRot[p], RtP);
        mat3Mul(RtP, R, q);                        // rest rotation relative to parent
        mat3Mul(this.poseRot[p], q, q);
        mat3Mul(q, this.local[i], this.poseRot[i]);
        const off = mat3Vec(this.shape[p], mat3Vec(RtP, [
          this.restHead[i * 3] - this.restHead[p * 3],
          this.restHead[i * 3 + 1] - this.restHead[p * 3 + 1],
          this.restHead[i * 3 + 2] - this.restHead[p * 3 + 2],
        ]));
        const w = mat3Vec(this.poseRot[p], off);
        for (let k = 0; k < 3; k++) this.poseHead[i * 3 + k] = this.poseHead[p * 3 + k] + w[k];
      }
      // skin matrix A = poseRot * Shape * restRot^T ; t = poseHead - A * restHead
      const A = mat3Mul(mat3Mul(this.poseRot[i], this.shape[i], RS), mat3T(R));
      const h = [this.restHead[i * 3], this.restHead[i * 3 + 1], this.restHead[i * 3 + 2]];
      const Ah = mat3Vec(A, h);
      const o = i * 12;
      for (let k = 0; k < 9; k++) this.skin[o + k] = A[k];
      this.skin[o + 9] = this.poseHead[i * 3] - Ah[0];
      this.skin[o + 10] = this.poseHead[i * 3 + 1] - Ah[1];
      this.skin[o + 11] = this.poseHead[i * 3 + 2] - Ah[2];
    }
  }

  /** Linear blend skinning of all vertices. */
  skinVertices(src, weights, out) {
    const { offsets, weights: W, bones: B } = weights;
    const S = this.skin;
    const nv = offsets.length - 1;
    for (let v = 0; v < nv; v++) {
      const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = offsets[v], e = offsets[v + 1]; k < e; k++) {
        const w = W[k], o = B[k] * 12;
        ox += w * (S[o] * x + S[o + 3] * y + S[o + 6] * z + S[o + 9]);
        oy += w * (S[o + 1] * x + S[o + 4] * y + S[o + 7] * z + S[o + 10]);
        oz += w * (S[o + 2] * x + S[o + 5] * y + S[o + 8] * z + S[o + 11]);
      }
      out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    }
    return out;
  }

  /** World transform of a point given in a bone's rest space -> posed. */
  posePoint(bone, p) {
    const i = typeof bone === 'string' ? this.byName.get(bone) : bone;
    const S = this.skin, o = i * 12;
    return [
      S[o] * p[0] + S[o + 3] * p[1] + S[o + 6] * p[2] + S[o + 9],
      S[o + 1] * p[0] + S[o + 4] * p[1] + S[o + 7] * p[2] + S[o + 10],
      S[o + 2] * p[0] + S[o + 5] * p[1] + S[o + 8] * p[2] + S[o + 11],
    ];
  }
}
