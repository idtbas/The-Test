import * as THREE from 'three';

// Shared globals, filled in by main.js
export const G = {
  renderer: null,
  scene: null,
  sim: null,
  audio: null,
  maxAniso: 8,
  panelMats: [],      // panel front materials with backlit legends
  gaugeMats: [],      // gauge faces with backlit markings
  time: 0,
};

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sat = (x) => clamp(x, 0, 1);
// exponential approach of cur towards target, frame-rate independent
export const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);
export const step = (cur, target, maxDelta) =>
  cur < target ? Math.min(target, cur + maxDelta) : Math.max(target, cur - maxDelta);
export const smoothstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gradient noise with optional integer period (for tileable textures)
export function makeNoise(seed = 1) {
  const r = rng(seed);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const g = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, period = 256) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X0 = ((xi % period) + period) % period, Y0 = ((yi % period) + period) % period;
    const X1 = (X0 + 1) % period, Y1 = (Y0 + 1) % period;
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X0] + Y0], ba = perm[perm[X1] + Y0];
    const ab = perm[perm[X0] + Y1], bb = perm[perm[X1] + Y1];
    return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v) * 0.75;
  };
}

export function fbm(noise, x, y, oct = 4, period = 256) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, period * f); a *= 0.5; f *= 2; }
  return s;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = G.maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Tileable grayscale noise canvas
export function noiseCanvas(size, { seed = 1, scale = 8, oct = 4, contrast = 1, bias = 0.5, scratches = 0 } = {}) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = makeNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm(n, (x / size) * scale, (y / size) * scale, oct, scale);
      const g = clamp((bias + v * contrast) * 255, 0, 255);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (scratches) {
    const r = rng(seed + 99);
    ctx.lineCap = 'round';
    for (let i = 0; i < scratches; i++) {
      const x = r() * size, y = r() * size, a = r() * TAU, l = 4 + r() * size * 0.08;
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.2})`;
      ctx.lineWidth = 0.5 + r() * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.3) * l * 0.5, y + Math.sin(a + 0.3) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  return c;
}

let _tex = null;
export function sharedTextures() {
  if (_tex) return _tex;
  const coarse = canvasTex(noiseCanvas(256, { seed: 3, scale: 4, oct: 5, contrast: 0.9, bias: 0.55 }), false, true);
  const fine = canvasTex(noiseCanvas(512, { seed: 7, scale: 32, oct: 3, contrast: 1.1, bias: 0.5, scratches: 260 }), false, true);
  const grain = canvasTex(noiseCanvas(256, { seed: 11, scale: 64, oct: 2, contrast: 1.4, bias: 0.5 }), false, true);
  _tex = { coarse, fine, grain, checker: checkerPlate(), fabric: fabricCanvas(), wall: wallCanvas() };
  return _tex;
}

// Diamond tread plate (bump)
function checkerPlate() {
  const s = 512, c = makeCanvas(s, s), ctx = c.getContext('2d');
  ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, s, s);
  const n = 8, d = s / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * d, cy = (j + 0.5) * d, rot = ((i + j) % 2 ? 1 : -1) * Math.PI / 4;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    const gr = ctx.createLinearGradient(-d * 0.35, 0, d * 0.35, 0);
    gr.addColorStop(0, '#888'); gr.addColorStop(0.5, '#e8e8e8'); gr.addColorStop(1, '#888');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(0, 0, d * 0.36, d * 0.07, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  const t = canvasTex(c, false, true);
  return t;
}

function fabricCanvas() {
  const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const r = rng(5);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) {
    const v = ((x / 4 + y / 4) % 2) ? 150 : 100;
    const k = v + (r() - 0.5) * 30;
    ctx.fillStyle = `rgb(${k},${k},${k})`;
    ctx.fillRect(x, y, 4, 4);
  }
  return canvasTex(c, false, true);
}

// Wall lining: riveted panels with seams. color + bump in one (grayscale)
function wallCanvas() {
  const s = 1024, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const n = makeNoise(21);
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const v = 0.62 + fbm(n, x / s * 6, y / s * 6, 4, 6) * 0.25;
    const i = (y * s + x) * 4; const g = v * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // seams every 0.5 m (texture = 1 m)
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
  for (let k = 0; k <= 2; k++) {
    ctx.beginPath(); ctx.moveTo(k * s / 2, 0); ctx.lineTo(k * s / 2, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k * s / 2); ctx.lineTo(s, k * s / 2); ctx.stroke();
  }
  // rivets along seams
  for (let k = 0; k < 2; k++) for (let t = 0; t < s; t += 32) {
    for (const [x, y] of [[k * s / 2 + 12, t + 16], [t + 16, k * s / 2 + 12], [k * s / 2 - 12 + s / 2, t + 16]]) {
      const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0, x, y, 6);
      g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#bbb'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    }
  }
  return canvasTex(c, false, true);
}

// Common materials
let _mats = null;
export function materials() {
  if (_mats) return _mats;
  const T = sharedTextures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  _mats = {
    paint: std({ color: 0x34383b, roughness: 0.72, metalness: 0.2, roughnessMap: T.coarse, bumpMap: T.fine, bumpScale: 0.08 }),
    paintLight: std({ color: 0x5b6266, roughness: 0.65, metalness: 0.2, roughnessMap: T.coarse, bumpMap: T.fine, bumpScale: 0.08 }),
    panelSide: std({ color: 0x1e2022, roughness: 0.6, metalness: 0.3 }),
    structure: std({ color: 0x3b3f3a, roughness: 0.6, metalness: 0.35, roughnessMap: T.coarse, bumpMap: T.fine, bumpScale: 0.12 }),
    wall: std({ color: 0x4a4f4c, roughness: 0.78, metalness: 0.15, map: T.wall, bumpMap: T.wall, bumpScale: 1.5, roughnessMap: T.coarse }),
    bezel: std({ color: 0x1a1c1e, roughness: 0.62, metalness: 0.2, roughnessMap: T.coarse }),
    black: std({ color: 0x0b0b0c, roughness: 0.55, metalness: 0.1 }),
    rubber: std({ color: 0x121212, roughness: 0.9, metalness: 0.0 }),
    chrome: std({ color: 0xd8dadc, roughness: 0.22, metalness: 1.0, roughnessMap: T.fine }),
    steel: std({ color: 0x9a9da0, roughness: 0.38, metalness: 1.0, roughnessMap: T.coarse }),
    darkSteel: std({ color: 0x4a4d50, roughness: 0.45, metalness: 1.0, roughnessMap: T.coarse }),
    brass: std({ color: 0xb08d57, roughness: 0.35, metalness: 1.0 }),
    white: std({ color: 0xe8e6df, roughness: 0.5, metalness: 0.0 }),
    red: std({ color: 0xa3140f, roughness: 0.45, metalness: 0.1, roughnessMap: T.coarse }),
    yellow: std({ color: 0xd9a400, roughness: 0.55, metalness: 0.1, roughnessMap: T.coarse }),
    floor: std({ color: 0x5a5d5e, roughness: 0.5, metalness: 0.85, bumpMap: T.checker, bumpScale: 2.0, roughnessMap: T.coarse }),
    fabric: std({ color: 0x23262a, roughness: 0.95, metalness: 0.0, bumpMap: T.fabric, bumpScale: 0.15 }),
    leather: std({ color: 0x1b1c1d, roughness: 0.62, metalness: 0.0, bumpMap: T.grain, bumpScale: 0.05 }),
    cable: std({ color: 0x151617, roughness: 0.55, metalness: 0.0 }),
    cableGrey: std({ color: 0x5c5f60, roughness: 0.6, metalness: 0.0 }),
    hose: std({ color: 0x232d33, roughness: 0.5, metalness: 0.0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    pick: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return _mats;
}

export function setAnisotropy(tex) { if (tex) tex.anisotropy = G.maxAniso; }

// Place an object so that its local X/Y axes match given world axes, at origin o.
export function orient(obj, o, xAxis, yAxis) {
  const x = xAxis.clone().normalize();
  const y = yAxis.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  y.crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(m);
  obj.position.copy(o);
  return obj;
}

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Fonts used for panels and displays
export const FONT_LABEL = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = '"B612 Mono", "Menlo", "Consolas", monospace';
export const FONT_SANS = '"B612", "Helvetica Neue", Arial, sans-serif';
