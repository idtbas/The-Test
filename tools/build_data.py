#!/usr/bin/env python3
"""
Build the compact runtime data for the body editor from the CC0 MakeHuman assets.

Usage:
    python3 tools/build_data.py <makehuman-repo>/makehuman/data <mpfb2-repo>/src/mpfb/data

Inputs (all CC0 1.0, see CREDITS.md):
    3dobjs/base.obj                 hm08 base mesh (decimeters, +Y up, +Z forward, A-pose)
    targets/**.target               sparse morph targets ("index dx dy dz", 3 decimals)
    rigs/default.mhskel + .mhw      skeleton joints/bones and skin weights
    eyes/high-poly/*.obj + .mhclo   eye proxy fitted onto helper geometry
    mpfb textures/*.jpg             UV-space region masks (lips, nails, ...)

Outputs (into ./data):
    mesh.bin / mesh.json            base mesh, face lists, per-vertex bake data
    targets-<chunk>.bin.gz          morph targets, packed (see pack_target)
    targets.json                    target index
    rig.json, weights.bin           skeleton + CSR skin weights
    eyes.bin / eyes.json            eye proxy mesh + fitting references
    masks.png                       region masks packed into RGBA
"""
import gzip
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageFilter

MH = sys.argv[1] if len(sys.argv) > 1 else 'makehuman/data'
MPFB = sys.argv[2] if len(sys.argv) > 2 else 'mpfb/data'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
os.makedirs(OUT, exist_ok=True)


# --------------------------------------------------------------------------- OBJ
def load_obj(path):
    V, T, faces = [], [], []
    grp = None
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            T.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            grp = line.split()[1]
        elif line.startswith('f '):
            idx = []
            for p in line.split()[1:]:
                s = p.split('/')
                idx.append((int(s[0]) - 1, int(s[1]) - 1 if len(s) > 1 and s[1] else -1))
            faces.append((grp, idx))
    return np.array(V, np.float32), np.array(T, np.float32), faces


V, T, faces = load_obj(os.path.join(MH, '3dobjs/base.obj'))
NV = len(V)
print('base mesh', NV, 'verts', len(T), 'uvs', len(faces), 'faces')

groups = {}
for g, f in faces:
    groups.setdefault(g, []).append(f)

group_verts = {}
for g, fl in groups.items():
    s = set()
    for f in fl:
        for v, t in f:
            s.add(v)
    group_verts[g] = sorted(s)


def quads_of(names):
    vs, ts = [], []
    for n in names:
        for f in groups[n]:
            if len(f) == 3:
                f = f + [f[2]]
            assert len(f) == 4
            vs.extend(v for v, t in f)
            ts.extend(t for v, t in f)
    return np.array(vs, np.uint16), np.array(ts, np.uint16)


blob = bytearray()
meta = {'numVerts': NV, 'numUVs': len(T), 'sections': {}}


def add_section(name, arr):
    global blob
    while len(blob) % 4:
        blob.append(0)
    meta['sections'][name] = {'offset': len(blob), 'type': str(arr.dtype), 'length': int(arr.size)}
    blob += arr.tobytes()


add_section('positions', V.ravel())
add_section('uvs', T.ravel())
for name, gl in [('body', ['body']), ('tongue', ['helper-tongue']),
                 ('upperTeeth', ['helper-upper-teeth']), ('lowerTeeth', ['helper-lower-teeth']),
                 ('tights', ['helper-tights'])]:
    qv, qt = quads_of(gl)
    add_section(name + 'QuadV', qv)
    add_section(name + 'QuadT', qt)

meta['groups'] = {g: [int(min(v)), int(max(v)), len(v)] for g, v in group_verts.items()
                  if not g.startswith('joint')}
meta['eyelashes'] = {g: group_verts[g] for g in group_verts if 'eyelashes' in g}
meta['groupVerts'] = {g: group_verts[g] for g in ['helper-hair', 'helper-l-eye', 'helper-r-eye']}

# --------------------------------------------------------------- thickness bake
# For every body vertex cast a ray inward (against the normal) and record the distance
# to the next surface. Used for light transmission (ears, nostrils, fingers glow).
body_q = np.array([[v for v, t in f] for f in groups['body']])
tris = np.concatenate([body_q[:, [0, 1, 2]], body_q[:, [0, 2, 3]]])
P0, P1, P2 = V[tris[:, 0]], V[tris[:, 1]], V[tris[:, 2]]
fn = np.cross(P1 - P0, P2 - P0)
vn = np.zeros_like(V)
for k in range(3):
    np.add.at(vn, tris[:, k], fn)
vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
E1, E2 = P1 - P0, P2 - P0
nbody = len(group_verts['body'])
thick = np.full(nbody, 3.0, np.float32)
for i in range(nbody):
    o = V[i] - vn[i] * 0.002
    d = -vn[i]
    pv = np.cross(d, E2)
    det = np.einsum('ij,ij->i', E1, pv)
    ok = np.abs(det) > 1e-9
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    tv = o - P0
    u = np.einsum('ij,ij->i', tv, pv) * inv
    qv = np.cross(tv, E1)
    w = (d @ qv.T) * inv
    t = np.einsum('ij,ij->i', E2, qv) * inv
    hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 0.004)
    if hit.any():
        thick[i] = min(3.0, float(t[hit].min()))
# store as uint8: thickness in decimeters * 85 (0..3dm)
add_section('thickness', np.clip(np.round(thick * 85), 0, 255).astype(np.uint8))
print('thickness: min %.3f median %.3f' % (thick.min(), np.median(thick)))

with open(os.path.join(OUT, 'mesh.bin'), 'wb') as fh:
    fh.write(blob)
with open(os.path.join(OUT, 'mesh.json'), 'w') as fh:
    json.dump(meta, fh, separators=(',', ':'))
print('mesh.bin', len(blob))


# ----------------------------------------------------------------------- targets
def read_target(path):
    idx, val = [], []
    for line in open(path):
        if line[0] == '#' or not line.strip():
            continue
        p = line.split()
        idx.append(int(p[0]))
        val.append([int(round(float(x) * 1000)) for x in p[1:4]])
    if not idx:
        return np.zeros(0, np.int64), np.zeros((0, 3), np.int64)
    idx = np.array(idx)
    val = np.array(val, np.int64)
    o = np.argsort(idx, kind='stable')
    return idx[o], val[o]


def pack_target(idx, val):
    """uint16 delta indices, then zigzag-delta int16 values in planar x/y/z, split into
    low-byte and high-byte planes. Lossless (targets have exactly 3 decimals)."""
    n = len(idx)
    di = np.diff(np.concatenate([[0], idx])).astype(np.uint16)
    dv = np.diff(np.concatenate([np.zeros((1, 3), np.int64), val]), axis=0).T.ravel()
    assert np.abs(dv).max(initial=0) < 32768
    z = ((dv << 1) ^ (dv >> 63)).astype(np.uint16)
    zb = z.view(np.uint8)
    return di.tobytes() + zb[0::2].tobytes() + zb[1::2].tobytes(), n


def chunk_of(rel):
    top = rel.split('/')[0]
    if top == 'macrodetails':
        if rel.startswith('macrodetails/height/'):
            return 'height'
        if rel.startswith('macrodetails/proportions/'):
            return 'proportions'
        return 'macro'
    if top in ('head', 'neck', 'eyes', 'nose', 'mouth', 'ears', 'chin', 'cheek', 'forehead',
               'eyebrows', 'asym'):
        return 'face'
    if top == 'expression':
        return 'expression'
    if top == 'genitals':
        return None
    return 'body'


TROOT = os.path.join(MH, 'targets')
chunks = {}
index = {}
for root, dirs, files in os.walk(TROOT):
    for f in sorted(files):
        if not f.endswith('.target'):
            continue
        path = os.path.join(root, f)
        rel = os.path.relpath(path, TROOT)[:-7]
        ch = chunk_of(rel)
        if ch is None:
            continue
        idx, val = read_target(path)
        data, n = pack_target(idx, val)
        buf = chunks.setdefault(ch, bytearray())
        while len(buf) % 2:
            buf.append(0)
        index[rel] = [ch, len(buf), n]
        buf += data

tmeta = {'chunks': {}, 'targets': index}
for ch, buf in chunks.items():
    gz = gzip.compress(bytes(buf), 9, mtime=0)
    fn_ = 'targets-%s.bin.gz' % ch
    with open(os.path.join(OUT, fn_), 'wb') as fh:
        fh.write(gz)
    tmeta['chunks'][ch] = {'file': fn_, 'size': len(buf), 'gz': len(gz)}
    print('chunk %-12s raw %8d gz %8d' % (ch, len(buf), len(gz)))
with open(os.path.join(OUT, 'targets.json'), 'w') as fh:
    json.dump(tmeta, fh, separators=(',', ':'))
print('targets', len(index))

# --------------------------------------------------------------------------- rig
skel = json.load(open(os.path.join(MH, 'rigs/default.mhskel')))
bones = skel['bones']
order = []
seen = set()


def visit(b):
    if b in seen:
        return
    p = bones[b]['parent']
    if p:
        visit(p)
    seen.add(b)
    order.append(b)


for b in sorted(bones):
    visit(b)
bidx = {b: i for i, b in enumerate(order)}
rig = {
    'bones': [{
        'name': b,
        'parent': bidx[bones[b]['parent']] if bones[b]['parent'] else -1,
        'head': bones[b]['head'],
        'tail': bones[b]['tail'],
        'plane': skel['planes'][bones[b]['rotation_plane']],
    } for b in order],
    'joints': skel['joints'],
}
with open(os.path.join(OUT, 'rig.json'), 'w') as fh:
    json.dump(rig, fh, separators=(',', ':'))

w = json.load(open(os.path.join(MH, 'rigs/default_weights.mhw')))['weights']
per_v = [[] for _ in range(NV)]
for b, lst in w.items():
    for v, wt in lst:
        per_v[v].append((bidx[b], wt))
offs = [0]
bb, ww = [], []
for lst in per_v:
    s = sum(x[1] for x in lst) or 1.0
    for bi, wt in sorted(lst, key=lambda x: -x[1]):
        bb.append(bi)
        ww.append(wt / s)
    offs.append(len(bb))
with open(os.path.join(OUT, 'weights.bin'), 'wb') as fh:
    fh.write(np.array(offs, np.uint32).tobytes())
    fh.write(np.array(ww, np.float32).tobytes())
    fh.write(np.array(bb, np.uint8).tobytes())
print('rig', len(order), 'bones; weights entries', len(bb))

# -------------------------------------------------------------------------- eyes
EV, ET, efaces = load_obj(os.path.join(MH, 'eyes/high-poly/high-poly.obj'))
refs, scales = [], {}
started = False
for line in open(os.path.join(MH, 'eyes/high-poly/high-poly.mhclo')):
    p = line.split()
    if not p or p[0].startswith('#'):
        continue
    if p[0] in ('x_scale', 'y_scale', 'z_scale'):
        scales[p[0][0]] = [int(p[1]), int(p[2]), float(p[3])]
    elif p[0] == 'verts':
        started = True
    elif started and len(p) == 9:
        refs.append([int(p[0]), int(p[1]), int(p[2])] + [float(x) for x in p[3:9]])
    elif started and len(p) == 1:
        refs.append([int(p[0]), int(p[0]), int(p[0]), 1, 0, 0, 0, 0, 0])
assert len(refs) == len(EV), (len(refs), len(EV))
eq = []
et = []
for g, f in efaces:
    if len(f) == 3:
        f = f + [f[2]]
    eq.extend(v for v, t in f)
    et.extend(t for v, t in f)
eblob = (EV.ravel().tobytes() + ET.ravel().tobytes() + np.array(eq, np.uint16).tobytes() +
         np.array(et, np.uint16).tobytes())
with open(os.path.join(OUT, 'eyes.bin'), 'wb') as fh:
    fh.write(eblob)
with open(os.path.join(OUT, 'eyes.json'), 'w') as fh:
    json.dump({'numVerts': len(EV), 'numUVs': len(ET), 'numQuads': len(eq) // 4,
               'refs': refs, 'scales': scales}, fh, separators=(',', ':'))
print('eyes', len(EV), 'verts', len(eq) // 4, 'quads')

# ------------------------------------------------------------------------- masks
TEX = os.path.join(MPFB, 'textures')


def mask(name, size=1024, blur=0):
    im = Image.open(os.path.join(TEX, 'mpfb_%s.jpg' % name)).convert('L').resize((size, size), Image.LANCZOS)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return im


def maxim(a, b):
    return Image.fromarray(np.maximum(np.array(a), np.array(b)))


# RGB only: browsers premultiply alpha on decode, which would destroy masks stored in RGB
# wherever A is zero.
# masks.png  R: lips     G: nails (finger+toe)  B: areola
# masks2.png R: ears     G: eyelids             B: mouth interior
m1 = Image.merge('RGB', [mask('lips', blur=1), maxim(mask('fingernails'), mask('toenails')),
                         mask('aureolae', blur=1)])
m2 = Image.merge('RGB', [mask('ears', blur=2), mask('eyelids', blur=1), mask('inside-mouth')])
m1.save(os.path.join(OUT, 'masks.png'), optimize=True)
m2.save(os.path.join(OUT, 'masks2.png'), optimize=True)
print('done')
