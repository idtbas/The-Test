// Loading and decoding of the packed runtime data produced by tools/build_data.py.

const DATA = new URL('../../data/', import.meta.url);

async function fetchOk(name) {
  const res = await fetch(new URL(name, DATA));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res;
}

export async function loadJSON(name) {
  return (await fetchOk(name)).json();
}

export async function loadBinary(name, onProgress) {
  // streamed progress first; if the stream stalls (seen on some Safari/CDN combinations),
  // fall back to a plain download
  let last = performance.now(), timer = 0;
  const touch = (l, t) => { last = performance.now(); onProgress?.(l, t); };
  const stall = new Promise((_, rej) => { timer = setInterval(() => { if (performance.now() - last > 30000) rej(new Error('stalled')); }, 1000); });
  try {
    return await Promise.race([loadBinaryStream(name, touch), stall]);
  } catch (e) {
    console.warn('stream load failed, retrying plain', name, e);
    const res = await fetchOk(name + (name.includes('?') ? '&' : '?') + 'r=1');
    const raw = new Uint8Array(await res.arrayBuffer());
    onProgress?.(raw.byteLength, raw.byteLength);
    return gunzipIfNeeded(raw);
  } finally {
    clearInterval(timer);
  }
}

async function gunzipIfNeeded(raw) {
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(ds).arrayBuffer();
  }
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

async function loadBinaryStream(name, onProgress) {
  const res = await fetchOk(name);
  const total = Number(res.headers.get('content-length')) || 0;
  let stream = res.body;
  if (onProgress && stream) {
    let loaded = 0;
    stream = stream.pipeThrough(new TransformStream({
      transform(chunk, ctrl) {
        loaded += chunk.byteLength;
        onProgress(loaded, total);
        ctrl.enqueue(chunk);
      },
    }));
  }
  if (name.endsWith('.gz')) {
    // Some static hosts already send these with Content-Encoding: gzip, in which case the
    // browser hands us plain bytes. Sniff the gzip magic number to decide.
    return gunzipIfNeeded(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return new Response(stream).arrayBuffer();
}

const TYPED = { float32: Float32Array, uint16: Uint16Array, uint8: Uint8Array, uint32: Uint32Array };

export function sections(meta, buffer) {
  const out = {};
  for (const [name, s] of Object.entries(meta.sections)) {
    out[name] = new TYPED[s.type](buffer, s.offset, s.length);
  }
  return out;
}

// A packed target: uint16 delta indices | zigzag-delta int16 values (planar x,y,z) split
// into a low-byte plane and a high-byte plane. Values are in 1/1000 decimeter.
export function decodeTarget(bytes, offset, n) {
  const idx = new Uint16Array(n);
  const d = new Int16Array(n * 3);
  const di = new Uint16Array(bytes.buffer, bytes.byteOffset + offset, n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += di[i]; idx[i] = acc; }
  const lo = offset + 2 * n, hi = offset + 5 * n;
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const k = c * n + i;
      const z = bytes[lo + k] | (bytes[hi + k] << 8);
      v += (z >>> 1) ^ -(z & 1);
      d[i * 3 + c] = v;
    }
  }
  return { idx, d };
}

export class TargetStore {
  constructor(index) {
    this.index = index;           // targets.json
    this.targets = new Map();     // name -> {idx, d}
    this.loadedChunks = new Set();
    this.listeners = [];
  }
  has(name) { return this.targets.has(name); }
  get(name) { return this.targets.get(name); }
  exists(name) { return name in this.index.targets; }
  onChunk(fn) { this.listeners.push(fn); }

  async loadChunk(chunk, onProgress) {
    if (this.loadedChunks.has(chunk)) return;
    const info = this.index.chunks[chunk];
    const buf = await loadBinary(info.file, onProgress);
    const bytes = new Uint8Array(buf);
    for (const [name, [ch, off, n]] of Object.entries(this.index.targets)) {
      if (ch === chunk) this.targets.set(name, decodeTarget(bytes, off, n));
    }
    this.loadedChunks.add(chunk);
    for (const fn of this.listeners) fn(chunk);
  }
}

export async function loadCore(onProgress) {
  const [meshMeta, meshBuf, rig, weightsBuf, eyesMeta, eyesBuf, targetIndex] = await Promise.all([
    loadJSON('mesh.json'), loadBinary('mesh.bin'), loadJSON('rig.json'), loadBinary('weights.bin'),
    loadJSON('eyes.json'), loadBinary('eyes.bin'), loadJSON('targets.json'),
  ]);
  const mesh = sections(meshMeta, meshBuf);
  mesh.meta = meshMeta;

  const nv = meshMeta.numVerts;
  const wOff = new Uint32Array(weightsBuf, 0, nv + 1);
  const ne = wOff[nv];
  const weights = {
    offsets: wOff,
    weights: new Float32Array(weightsBuf, (nv + 1) * 4, ne),
    bones: new Uint8Array(weightsBuf, (nv + 1) * 4 + ne * 4, ne),
  };

  const env = eyesMeta.numVerts, enu = eyesMeta.numUVs, enq = eyesMeta.numQuads;
  let o = 0;
  const eyes = {
    meta: eyesMeta,
    positions: new Float32Array(eyesBuf, o, env * 3),
    uvs: new Float32Array(eyesBuf, (o += env * 12), enu * 2),
    quadV: new Uint16Array(eyesBuf, (o += enu * 8), enq * 4),
    quadT: new Uint16Array(eyesBuf, (o += enq * 8), enq * 4),
  };

  const targets = new TargetStore(targetIndex);
  return { mesh, rig, weights, eyes, targets };
}
