// GW-7 sound design. Everything is synthesized at start-up, nothing is downloaded:
// - one-shots are rendered into AudioBuffers by modal synthesis (damped resonances,
//   filtered noise, pitch sweeps), several variants each
// - continuous machinery uses custom harmonic spectra (PeriodicWave), filtered noise
//   and slow random modulation
// - every source is placed in 3D (HRTF) in cockpit space; the listener follows the head
// - a synthetic impulse response gives the small steel capsule its sound; external
//   machinery reaches the pilot through a "hull" filter (structure-borne, muffled)
import { clamp } from './util.js';

const TAU = Math.PI * 2;
const R = Math.random;
const jit = (v, p) => v * (1 + (R() * 2 - 1) * p);

// ---------------------------------------------------------------- offline synthesis helpers
class Synth {
  constructor(ctx, dur) {
    this.sr = ctx.sampleRate;
    this.n = Math.ceil(dur * this.sr);
    this.buf = ctx.createBuffer(1, this.n, this.sr);
    this.d = this.buf.getChannelData(0);
  }
  // damped sinusoids: [freq, decay(s), amp]
  modes(t0, modes, amp = 1) {
    const { d, sr, n } = this;
    const i0 = Math.floor(t0 * sr);
    for (const [f, dec, a] of modes) {
      const ph = R() * TAU, w = TAU * f / sr, k = Math.exp(-1 / (dec * sr));
      const len = Math.min(n - i0, Math.ceil(dec * 7 * sr));
      let e = a * amp;
      // short attack avoids clicks on low modes
      const att = Math.max(1, Math.floor(sr / f / 4));
      for (let i = 0; i < len; i++) {
        d[i0 + i] += e * Math.sin(ph + w * i) * (i < att ? i / att : 1);
        e *= k;
      }
    }
    return this;
  }
  // filtered noise burst with attack/decay envelope; lp/hp are one-pole cut-offs
  noise(t0, dur, amp, { lp = 20000, hp = 20, att = 0.0005, dec = null, lpTo = null } = {}) {
    const { d, sr, n } = this;
    const i0 = Math.floor(t0 * sr), len = Math.min(n - i0, Math.ceil(dur * sr));
    let y1 = 0, y2 = 0;
    const aH = 1 - Math.exp(-TAU * hp / sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const fc = lpTo ? lp + (lpTo - lp) * Math.min(1, t / dur) : lp;
      const aL = 1 - Math.exp(-TAU * fc / sr);
      const x = R() * 2 - 1;
      y1 += aL * (x - y1);
      y2 += aH * (y1 - y2);
      const v = y1 - y2;
      const env = (t < att ? t / att : 1) * (dec ? Math.exp(-(t - att) / dec) : Math.max(0, 1 - t / dur));
      d[i0 + i] += v * env * amp;
    }
    return this;
  }
  // sine with exponential pitch glide
  sweep(t0, f0, f1, glide, dec, amp, att = 0.003) {
    const { d, sr, n } = this;
    const i0 = Math.floor(t0 * sr), len = Math.min(n - i0, Math.ceil(dec * 7 * sr));
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / glide);
      ph += TAU * f / sr;
      d[i0 + i] += Math.sin(ph) * amp * Math.exp(-t / dec) * Math.min(1, t / att);
    }
    return this;
  }
  // square-ish buzz (relay coils, solenoids)
  buzz(t0, f, dur, amp) {
    const { d, sr, n } = this;
    const i0 = Math.floor(t0 * sr), len = Math.min(n - i0, Math.ceil(dur * sr));
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const s = Math.sin(TAU * f * t);
      d[i0 + i] += Math.tanh(s * 4) * 0.5 * amp * (1 - t / dur);
    }
    return this;
  }
  done(peak = 0.95) {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.d[i]));
    if (m > 0) for (let i = 0; i < this.n; i++) this.d[i] *= peak / m;
    // fade out tail
    const f = Math.min(this.n, Math.floor(this.sr * 0.01));
    for (let i = 0; i < f; i++) this.d[this.n - 1 - i] *= i / f;
    return this.buf;
  }
}

// ---------------------------------------------------------------- sound library
function buildLibrary(ctx) {
  const L = {};
  const variants = (n, fn) => Array.from({ length: n }, (_, k) => fn(k));

  // MS-style toggle switch: over-centre snap, then contact closure; tiny panel resonance
  L.toggle = variants(6, () => new Synth(ctx, 0.12)
    .noise(0, 0.0012, 0.5, { hp: 2500 })
    .modes(0, [[jit(3100, 0.08), 0.0025, 0.5], [jit(5300, 0.08), 0.0018, 0.35]])
    .noise(jit(0.0055, 0.25), 0.0018, 1.0, { hp: 1200 })
    .modes(jit(0.0055, 0.25), [[jit(2050, 0.06), 0.01, 0.8], [jit(3600, 0.06), 0.006, 0.5], [jit(6100, 0.05), 0.003, 0.3], [jit(820, 0.1), 0.02, 0.25], [jit(240, 0.1), 0.03, 0.15]])
    .done());
  // guard cover: plastic clack + hinge spring
  L.guard = variants(4, () => new Synth(ctx, 0.2)
    .noise(0, 0.004, 0.8, { lp: 5000, hp: 300 })
    .modes(0, [[jit(870, 0.08), 0.018, 0.7], [jit(1640, 0.08), 0.01, 0.45], [jit(2900, 0.08), 0.005, 0.3], [jit(310, 0.1), 0.03, 0.3]])
    .modes(0.012, [[jit(4400, 0.1), 0.006, 0.15], [jit(6800, 0.1), 0.004, 0.08]])
    .done());
  // Korry push button: soft plastic thock with spring + microswitch
  L.push = variants(4, () => new Synth(ctx, 0.12)
    .noise(0, 0.003, 0.6, { lp: 2500, hp: 150 })
    .modes(0, [[jit(320, 0.08), 0.018, 0.6], [jit(1150, 0.08), 0.008, 0.35]])
    .noise(0.004, 0.001, 0.5, { hp: 3000 })
    .modes(0.004, [[jit(3800, 0.05), 0.002, 0.3]])
    .done());
  L.release = variants(3, () => new Synth(ctx, 0.08)
    .noise(0, 0.001, 0.4, { hp: 2500 })
    .modes(0, [[jit(2600, 0.06), 0.003, 0.3], [jit(900, 0.08), 0.008, 0.2]])
    .done(0.5));
  // MFD rubber key
  L.osb = variants(3, () => new Synth(ctx, 0.06)
    .noise(0, 0.004, 0.5, { lp: 1800, hp: 120 })
    .modes(0, [[jit(520, 0.1), 0.01, 0.4], [jit(2900, 0.1), 0.0015, 0.2]])
    .done(0.6));
  // rotary detent
  L.detent = variants(5, () => new Synth(ctx, 0.07)
    .noise(0, 0.0006, 0.8, { hp: 3000 })
    .modes(0, [[jit(3300, 0.08), 0.003, 0.5], [jit(5600, 0.08), 0.002, 0.35], [jit(780, 0.1), 0.012, 0.3]])
    .done(0.8));
  // circuit breaker pop
  L.breaker = variants(3, () => new Synth(ctx, 0.15)
    .noise(0, 0.006, 0.7, { lp: 4000, hp: 200 })
    .modes(0, [[jit(1500, 0.08), 0.008, 0.6], [jit(420, 0.08), 0.025, 0.5], [jit(2700, 0.08), 0.004, 0.3]])
    .done());
  // emergency stop: heavy mushroom + latch
  L.estop = variants(2, () => new Synth(ctx, 0.35)
    .noise(0, 0.01, 0.8, { lp: 1500, hp: 60 })
    .modes(0, [[jit(240, 0.05), 0.05, 0.8], [jit(690, 0.05), 0.025, 0.5], [jit(1800, 0.05), 0.01, 0.3]])
    .noise(0.03, 0.002, 0.5, { hp: 2500 })
    .modes(0.03, [[jit(3500, 0.05), 0.004, 0.4]])
    .done());
  // throttle detent / gate
  L.lever = variants(3, () => new Synth(ctx, 0.25)
    .noise(0, 0.12, 0.25, { lp: 1200, hp: 200, att: 0.03 })
    .modes(0.1, [[jit(380, 0.08), 0.04, 0.6], [jit(1200, 0.08), 0.012, 0.3]])
    .done(0.7));
  // contactor / relay: coil buzz + armature slam
  L.relay = variants(5, () => new Synth(ctx, 0.3)
    .buzz(0, jit(100, 0.02), 0.018, 0.25)
    .noise(0.006, 0.0015, 0.9, { hp: 1500 })
    .modes(0.006, [[jit(170, 0.1), 0.04, 0.7], [jit(410, 0.1), 0.025, 0.5], [jit(1950, 0.08), 0.012, 0.4], [jit(3150, 0.08), 0.006, 0.25]])
    .done());
  // igniter spark
  L.spark = variants(4, () => new Synth(ctx, 0.05)
    .noise(0, 0.002, 1, { hp: 3500 })
    .noise(0.0015, 0.012, 0.3, { hp: 2000, lp: 9000, dec: 0.003 })
    .modes(0, [[jit(4300, 0.1), 0.002, 0.3]])
    .done());
  // combustion light-off
  L.lightoff = variants(2, () => new Synth(ctx, 2.4)
    .noise(0, 2.2, 1.0, { lp: 90, lpTo: 1400, hp: 25, att: 0.08, dec: 0.5 })
    .sweep(0, 70, 34, 0.25, 0.7, 0.6, 0.05)
    .modes(0.05, [[jit(110, 0.1), 0.4, 0.15], [jit(167, 0.1), 0.3, 0.1]])
    .done());
  // footstep: sub impact, structural ring, damper hiss, rattles
  L.step = variants(5, () => {
    const s = new Synth(ctx, 2.2);
    s.sweep(0, jit(62, 0.08), 29, 0.09, 0.45, 1.0, 0.004);
    s.noise(0, 0.3, 0.9, { lp: 220, hp: 20, att: 0.002, dec: 0.07 });
    s.modes(0.004, [[jit(87, 0.05), 0.7, 0.12], [jit(131, 0.05), 0.55, 0.1], [jit(197, 0.05), 0.5, 0.08], [jit(283, 0.05), 0.4, 0.06],
      [jit(419, 0.05), 0.3, 0.05], [jit(611, 0.05), 0.22, 0.04], [jit(897, 0.05), 0.15, 0.03], [jit(1340, 0.05), 0.1, 0.02]]);
    s.noise(0.035, 0.6, 0.12, { hp: 1400, lp: 5500, att: 0.04, dec: 0.18 });
    const k = 3 + Math.floor(R() * 5);
    for (let i = 0; i < k; i++) s.modes(0.02 + R() * 0.12, [[2200 + R() * 3500, 0.004, 0.08 + R() * 0.1], [800 + R() * 900, 0.01, 0.04]]);
    return s.done();
  });
  // ground contact heard through the hull: gravel and soil
  L.crunch = variants(4, () => {
    const s = new Synth(ctx, 0.5);
    for (let i = 0; i < 60; i++) s.noise(Math.pow(R(), 1.8) * 0.3, 0.003 + R() * 0.012, (0.2 + R() * 0.8) * Math.exp(-i / 30), { hp: 500, lp: 3500 });
    s.noise(0, 0.35, 0.5, { lp: 600, hp: 60, dec: 0.08 });
    return s.done();
  });
  // structural creak: stick-slip excitation of plate modes
  L.creak = variants(5, () => {
    const s = new Synth(ctx, 1.4);
    const f1 = 150 + R() * 140, dur = 0.5 + R() * 0.7;
    let t = 0.02, rate = 22 + R() * 15;
    while (t < dur) {
      const env = Math.sin(Math.PI * t / dur);
      s.modes(t, [[f1 * (1 + t * 0.15), 0.025, env], [f1 * 2.13, 0.015, env * 0.5], [f1 * 4.7, 0.008, env * 0.25]], 0.5);
      t += (1 / rate) * (0.7 + R() * 0.6);
      rate *= 1.01 + R() * 0.02;
    }
    return s.done();
  });
  // heavy mechanical lock (foot lock, posture end-stop, calibration joints)
  L.clunk = variants(4, () => new Synth(ctx, 0.9)
    .sweep(0, 95, 48, 0.05, 0.18, 0.8)
    .noise(0, 0.08, 0.6, { lp: 800, hp: 40, dec: 0.025 })
    .modes(0.003, [[jit(143, 0.05), 0.3, 0.3], [jit(311, 0.05), 0.2, 0.2], [jit(733, 0.05), 0.1, 0.12], [jit(1610, 0.05), 0.05, 0.08]])
    .done());
  // hydraulic dump (E-stop, pressure relief)
  L.dump = variants(2, () => new Synth(ctx, 2.0)
    .noise(0, 1.9, 1, { hp: 900, lp: 7000, att: 0.01, dec: 0.5 })
    .noise(0, 1.0, 0.4, { lp: 300, hp: 40, dec: 0.25 })
    .done());
  // caution chime: struck bell
  L.chime = [new Synth(ctx, 1.6).modes(0, [[1046, 1.0, 1], [2093, 0.5, 0.2], [2886, 0.45, 0.28], [4257, 0.25, 0.1]]).done(0.8)];
  // MFD-key / system tick
  L.tick = [new Synth(ctx, 0.05).modes(0, [[2400, 0.012, 1]]).done(0.5)];
  return L;
}

// slowly varying random signal (used to modulate machinery organically)
function randomBuffer(ctx, seconds = 24) {
  const sr = 8000, n = seconds * sr;
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  let v = 0, t = 0;
  for (let i = 0; i < n; i++) { t += (R() * 2 - 1) * 0.02; t *= 0.999; v += (t - v) * 0.002; d[i] = v; }
  let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] /= m || 1;
  // seamless loop
  const f = 4000; for (let i = 0; i < f; i++) { const a = i / f; d[n - f + i] = d[n - f + i] * (1 - a) + d[i] * a; }
  return b;
}

// small steel capsule: dense early reflections, short metallic tail, low cabin modes
function cabinIR(ctx) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 0.7);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (const ms of [2.1, 3.4, 4.6, 5.9, 7.3, 8.8, 10.4, 12.7, 15.1]) {
      const i = Math.floor((ms + R() * 0.6) / 1000 * sr);
      d[i] += (R() > 0.5 ? 1 : -1) * (0.6 - ms * 0.025);
    }
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      lp += 0.35 * ((R() * 2 - 1) - lp);
      d[i] += lp * Math.exp(-t / 0.075) * 0.55 * Math.min(1, t / 0.004);
      d[i] += (Math.sin(TAU * 86 * t) * 0.05 + Math.sin(TAU * 131 * t + ch) * 0.035 + Math.sin(TAU * 2350 * t) * 0.012) * Math.exp(-t / 0.16);
    }
  }
  return b;
}

// ---------------------------------------------------------------- engine
export class CockpitAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.85;
    this.srcPos = null;
    this._warnT = 0; this._sparkT = 0; this._creakT = 0; this._rattleT = 0;
    this.lastWarn = new Set();
  }

  get ready() { return !!this.ctx; }

  start() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    // master chain: bus → soft clip → compressor → limiter → out
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(lim).connect(this.master).connect(ctx.destination);
    // cabin reverb
    this.verb = ctx.createConvolver();
    this.verb.buffer = cabinIR(ctx);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 1;
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(verbOut).connect(this.bus);
    // hull transmission (outside → inside): low-pass + cabin boom
    this.hull = ctx.createBiquadFilter(); this.hull.type = 'lowpass'; this.hull.frequency.value = 700; this.hull.Q.value = 0.5;
    const boom = ctx.createBiquadFilter(); boom.type = 'peaking'; boom.frequency.value = 95; boom.Q.value = 1.2; boom.gain.value = 3;
    this.hullOut = ctx.createGain(); this.hullOut.gain.value = 1;
    this.hull.connect(boom).connect(this.hullOut);
    this.hullOut.connect(this.bus);
    const hs = ctx.createGain(); hs.gain.value = 0.25; this.hullOut.connect(hs).connect(this.verbIn);
    // cockpit loudspeaker for tones (small, band-limited, slightly driven)
    const shp = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    shp.curve = curve;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4800; lp.Q.value = 0.9;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 2; pk.gain.value = 5;
    this.speaker = ctx.createGain(); this.speaker.gain.value = 0.7;
    this.speaker.connect(hp).connect(pk).connect(shp).connect(lp);
    const spPan = this.panner([0.25, 0.92, -0.62], 0.4);
    lp.connect(spPan); spPan.connect(this.bus);
    const spV = ctx.createGain(); spV.gain.value = 0.3; lp.connect(spV).connect(this.verbIn);

    this.white = this.noiseBuffer('white');
    this.pink = this.noiseBuffer('pink');
    this.brown = this.noiseBuffer('brown');
    this.rand = randomBuffer(ctx);
    this.lib = buildLibrary(ctx);
    this.rr = {};
    this.buildLayers();
  }

  noiseBuffer(kind) {
    const ctx = this.ctx, n = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = R() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    // crossfade loop seam
    const f = 2000; for (let i = 0; i < f; i++) { const a = i / f; d[n - f + i] = d[n - f + i] * (1 - a) + d[i] * a; }
    return b;
  }

  panner(pos, ref = 0.5, rolloff = 1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 100;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    return p;
  }

  // ---- continuous sources
  loop(buf, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(this.ctx.currentTime, R() * buf.duration);
    return s;
  }
  filter(type, f, q = 0.7, gain = 0) {
    const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b;
  }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  // harmonic oscillator; amps = harmonic amplitudes (index 1 = fundamental)
  harm(f, amps) {
    const real = new Float32Array(amps.length + 1), imag = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => { imag[i + 1] = a; });
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.ctx.createPeriodicWave(real, imag, { disableNormalization: false }));
    o.frequency.value = f; o.start();
    return o;
  }
  // slow random modulation into an AudioParam
  wobble(param, depth, rate = 1) {
    const s = this.loop(this.rand, rate);
    const g = this.gain(depth);
    s.connect(g).connect(param);
    return g;
  }
  // route a node into the mix: 'cabin' (spatial, dry + reverb) or 'hull' (through structure)
  out(node, { pos = [0, 0.5, 0], ref = 0.6, send = 0.15, via = 'cabin' } = {}) {
    if (via === 'hull') {
      const p = this.panner(pos, ref, 0.6);
      node.connect(p); p.connect(this.hull);
      return p;
    }
    const p = this.panner(pos, ref);
    node.connect(p); p.connect(this.bus);
    if (send) { const s = this.gain(send); p.connect(s).connect(this.verbIn); }
    return p;
  }

  buildLayers() {
    const L = this.L = {};
    // --- outside wind / hull ambience (always, swells with speed)
    {
      const n = this.loop(this.brown, 0.8);
      const f = this.filter('lowpass', 260, 0.6);
      const g = this.gain(0);
      n.connect(f).connect(g);
      this.wobble(g.gain, 0.006, 0.6);
      this.wobble(f.frequency, 80, 0.4);
      this.out(g, { pos: [0, 1.4, -1.5], via: 'hull', ref: 1 });
      L.wind = { g, f };
    }
    // --- cabin ventilation (ESS powered blower)
    {
      const n = this.loop(this.pink, 1);
      const f = this.filter('bandpass', 1800, 0.35);
      const g = this.gain(0);
      n.connect(f).connect(g);
      this.out(g, { pos: [0.4, 1.85, -0.2], send: 0.1, ref: 0.4 });
      const tone = this.harm(147, [1, 0.4, 0.2, 0.1]);
      const tg = this.gain(0);
      tone.connect(tg);
      this.out(tg, { pos: [0.4, 1.85, -0.2], send: 0.05, ref: 0.4 });
      L.vent = { g, tg, tone, n };
    }
    // --- avionics: cooling fans + 400 Hz static inverter whine
    {
      const n = this.loop(this.pink, 1.1);
      const f = this.filter('bandpass', 1300, 0.5);
      const g = this.gain(0);
      n.connect(f).connect(g);
      const blade = this.harm(212, [1, 0.5, 0.25, 0.12, 0.06]);
      const bg = this.gain(0);
      blade.connect(bg);
      const mix = this.gain(1); g.connect(mix); bg.connect(mix);
      this.out(mix, { pos: [0, 0.72, -0.85], send: 0.12, ref: 0.4 });
      const inv = this.harm(400, [1, 0.35, 0.5, 0.1, 0.2, 0.05, 0.08]);
      const ig = this.gain(0);
      inv.connect(ig);
      this.wobble(inv.frequency, 0.8, 0.3);
      this.out(ig, { pos: [-0.3, 0.3, 0.6], send: 0.05, ref: 0.4 });
      L.avio = { g, bg, blade, n, ig };
    }
    // --- fuel boost pumps (two motors, below floor left/right)
    L.fuel = [-1, 1].map((sx) => {
      const m = this.harm(97 + sx * 2, [0.6, 1, 0.5, 0.35, 0.2, 0.12, 0.08, 0.05]);
      const mg = this.gain(0);
      const flt = this.filter('lowpass', 1600, 0.7);
      m.connect(flt).connect(mg);
      const n = this.loop(this.brown, 1.4); const nf = this.filter('bandpass', 420, 1.2); const ng = this.gain(0);
      n.connect(nf).connect(ng);
      const mix = this.gain(1); mg.connect(mix); ng.connect(mix);
      this.out(mix, { pos: [sx * 0.5, -0.4, 0.4], via: 'hull', ref: 0.5 });
      return { m, mg, ng };
    });
    // --- APU (rear left, outside the capsule): starter motor, compressor whine, combustion, intake
    {
      const P = [-0.9, 0.4, 2.0];
      const starter = this.harm(40, [1, 0.6, 0.45, 0.2, 0.3, 0.1, 0.15, 0.05, 0.12]);
      const sg = this.gain(0);
      starter.connect(this.filter('lowpass', 2500)).connect(sg);
      this.out(sg, { pos: P, via: 'hull', ref: 1 });
      const sgIn = this.gain(0); sg.connect(sgIn); this.out(sgIn, { pos: P, send: 0.1, ref: 1.5 });
      const w1 = this.harm(100, [1, 0.3, 0.12]); const w2 = this.harm(100, [1, 0.2]);
      const wg = this.gain(0);
      w1.connect(wg); w2.connect(wg);
      this.wobble(w1.frequency, 3, 0.7);
      // the whine leaks through the hull more than the roar
      const wf = this.filter('lowpass', 5000, 0.5); wg.connect(wf);
      this.out(wf, { pos: P, send: 0.1, ref: 1.2 });
      const roar = this.loop(this.brown, 1); const rf = this.filter('lowpass', 200, 0.6); const rg = this.gain(0);
      roar.connect(rf).connect(rg);
      this.wobble(rg.gain, 0.03, 1.4);
      this.out(rg, { pos: P, via: 'hull', ref: 1 });
      const intake = this.loop(this.white, 1); const inf = this.filter('bandpass', 2600, 0.6); const ing = this.gain(0);
      intake.connect(inf).connect(ing);
      this.out(ing, { pos: P, send: 0.08, ref: 1.5 });
      L.apu = { sg, sgIn, starter, w1, w2, wg, rf, rg, inf, ing };
    }
    // --- main turbine (behind, below): rotor tones, roar with turbulence, rumble, air starter
    {
      const P = [0, 0.2, 2.4];
      const w1 = this.harm(300, [1, 0.25, 0.4, 0.1]); const w2 = this.harm(300, [1, 0.3]);
      const wg = this.gain(0);
      w1.connect(wg); w2.connect(wg);
      const wf = this.filter('lowpass', 4500, 0.4);
      wg.connect(wf);
      this.out(wf, { pos: P, send: 0.08, ref: 1.6 });
      const tone = this.harm(60, [1, 0.6, 0.35, 0.25, 0.12, 0.08]);
      const tg = this.gain(0);
      tone.connect(tg);
      this.out(tg, { pos: P, via: 'hull', ref: 1 });
      const roar = this.loop(this.brown, 1); const rf = this.filter('lowpass', 120, 0.6); const rg = this.gain(0);
      roar.connect(rf).connect(rg);
      this.wobble(rg.gain, 0.06, 2.2);
      this.wobble(rf.frequency, 40, 0.8);
      this.out(rg, { pos: P, via: 'hull', ref: 1 });
      const hiss = this.loop(this.white, 1); const hf = this.filter('bandpass', 3500, 0.5); const hg = this.gain(0);
      hiss.connect(hf).connect(hg);
      this.out(hg, { pos: P, send: 0.05, ref: 1.6 });
      const rum = this.ctx.createOscillator(); rum.type = 'sine'; rum.frequency.value = 30; rum.start();
      const rmg = this.gain(0); rum.connect(rmg);
      this.out(rmg, { pos: [0, 0, 0.5], via: 'hull', ref: 1 });
      // air turbine starter (bleed air): rising whistle + rush
      const ast = this.harm(800, [1, 0.3, 0.15]);
      const asg = this.gain(0);
      ast.connect(asg);
      const air = this.loop(this.white, 1); const af = this.filter('bandpass', 1800, 0.8); const ag = this.gain(0);
      air.connect(af).connect(ag);
      const amix = this.gain(1); asg.connect(amix); ag.connect(amix);
      this.out(amix, { pos: [0.3, 0.6, 1.6], send: 0.1, ref: 1.2 });
      L.mtg = { w1, w2, wg, tone, tg, rf, rg, hg, rum, rmg, ast, asg, ag };
    }
    // --- hydraulic pumps: piston ripple (9 pistons) + fluid noise; B electric, A engine driven
    L.hyd = ['A', 'B'].map((id, k) => {
      const P = [k ? 0.55 : -0.55, -0.3, -0.2];
      const amps = [0.3, 0.15, 0.1, 0.08, 0.06, 0.08, 0.1, 0.2, 1.0, 0.25, 0.1, 0.08, 0.06, 0.05, 0.1, 0.05, 0.08, 0.4];
      const o = this.harm(60, amps);
      const og = this.gain(0);
      o.connect(this.filter('lowpass', 3000, 0.5)).connect(og);
      this.wobble(o.frequency, 0.6, 0.5);
      const n = this.loop(this.white, 1); const nf = this.filter('bandpass', 2200, 0.9); const ng = this.gain(0);
      n.connect(nf).connect(ng);
      const mix = this.gain(1); og.connect(mix); ng.connect(mix);
      this.out(mix, { pos: P, via: 'hull', ref: 0.6 });
      const leak = this.gain(0); og.connect(leak); this.out(leak, { pos: P, send: 0.05, ref: 0.4 });
      return { o, og, ng, leak };
    });
    // --- hydraulic flow / servo valves (legs and hips), swelling with gait
    {
      const n = this.loop(this.white, 1); const f = this.filter('bandpass', 2600, 0.8); const g = this.gain(0);
      n.connect(f).connect(g);
      const n2 = this.loop(this.pink, 0.7); const f2 = this.filter('bandpass', 520, 1.1); const g2 = this.gain(0);
      n2.connect(f2).connect(g2);
      this.wobble(f.frequency, 500, 1.3);
      const mix = this.gain(1); g.connect(mix); g2.connect(mix);
      this.out(mix, { pos: [0, -0.5, 0.2], via: 'hull', ref: 0.6 });
      const valve = this.harm(38, [1, 0.5, 0.8, 0.3, 0.5, 0.2]);
      const vg = this.gain(0);
      valve.connect(vg);
      this.out(vg, { pos: [0, -0.2, 0.3], via: 'hull', ref: 0.6 });
      L.flow = { g, g2, f, valve, vg };
    }
    // --- stabilisation gyro under the seat
    {
      const o1 = this.harm(100, [1, 0.15, 0.05]); const o2 = this.harm(100, [1]);
      const g = this.gain(0);
      o1.connect(g); o2.connect(g);
      const n = this.loop(this.white, 1); const nf = this.filter('bandpass', 7000, 2); const ng = this.gain(0);
      n.connect(nf).connect(ng);
      const mix = this.gain(1); g.connect(mix); ng.connect(mix);
      this.out(mix, { pos: [0, 0.25, 0.35], send: 0.08, ref: 0.4 });
      L.gyro = { o1, o2, g, ng };
    }
    // --- coolant pumps: motor hum + liquid gurgle
    {
      const m = this.harm(118, [1, 0.5, 0.3, 0.15]); const mg = this.gain(0);
      m.connect(mg);
      const n = this.loop(this.brown, 1); const nf = this.filter('bandpass', 320, 2.5); const ng = this.gain(0);
      n.connect(nf).connect(ng);
      this.wobble(ng.gain, 0.012, 3);
      this.wobble(nf.frequency, 120, 2);
      const mix = this.gain(1); mg.connect(mix); ng.connect(mix);
      this.out(mix, { pos: [-0.6, 0.1, 0.8], via: 'hull', ref: 0.6 });
      L.cool = { mg, ng };
    }
    // --- display backlights: faint coil whine when the large screens are on
    {
      const o = this.harm(11800, [1]); const g = this.gain(0);
      o.connect(g);
      this.out(g, { pos: [0, 1.25, -0.82], send: 0, ref: 0.3 });
      L.sdu = { g };
    }
  }

  // ---------------------------------------------------------------- listener / placement
  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02); l.upY.setTargetAtTime(uy, t, 0.02); l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // position of the next interaction sound (set by the input handler)
  at(v) { this.srcPos = v ? [v.x, v.y, v.z] : null; this.srcPosT = performance.now(); }

  play(name, { gain = 1, rate = 1, pos = null, send = 0.25, via = 'cabin', delay = 0, ref = 0.35 } = {}) {
    if (!this.ctx) return;
    const list = this.lib[name]; if (!list) return;
    // round robin with random start, never the same variant twice in a row
    let k = Math.floor(R() * list.length);
    if (list.length > 1 && k === this.rr[name]) k = (k + 1) % list.length;
    this.rr[name] = k;
    const src = this.ctx.createBufferSource();
    src.buffer = list[k];
    src.playbackRate.value = rate * (1 + (R() - 0.5) * 0.04);
    const g = this.gain(gain);
    src.connect(g);
    let p = pos;
    if (!p) p = this.srcPos && performance.now() - this.srcPosT < 400 ? this.srcPos : [0, 0.8, -0.5];
    if (via === 'hull') {
      const pn = this.panner(p, ref, 0.4);
      g.connect(pn); pn.connect(this.hull);
    } else {
      const pn = this.panner(p, ref);
      g.connect(pn); pn.connect(this.bus);
      if (send) { const s = this.gain(send); pn.connect(s).connect(this.verbIn); }
    }
    src.start(this.ctx.currentTime + delay);
    src.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
  }

  // ---- public API used by the controls and the simulation
  click(kind = 'toggle') {
    const map = { toggle: ['toggle', 0.55], guard: ['guard', 0.5], push: ['push', 0.45], release: ['release', 0.3], detent: ['detent', 0.4], breaker: ['breaker', 0.5], lever: ['lever', 0.5], estop: ['estop', 0.8], osb: ['osb', 0.35] };
    const [n, g] = map[kind] || map.toggle;
    this.play(n, { gain: g });
  }
  relay(n = 1) {
    for (let i = 0; i < n; i++) this.play('relay', { gain: 0.35, delay: 0.02 + i * (0.035 + R() * 0.05), pos: [R() * 0.6 - 0.3, 0.45, 0.55] });
  }
  thump(strength = 1, foot = 0) {
    const s = clamp(strength, 0.2, 1.6);
    const side = foot ? 1 : -1;
    this.play('step', { gain: 0.9 * s, pos: [side * 1.2, -1.5, 0.2], via: 'hull', ref: 1.2, rate: 1 - (s - 0.5) * 0.06 });
    this.play('crunch', { gain: 0.35 * s, pos: [side * 1.7, -5, -0.4], via: 'hull', ref: 3 });
    if (s > 0.6 && R() < 0.5) this.play('creak', { gain: 0.12 * s, pos: [side * 0.8, 1.6, -0.3], delay: 0.08 + R() * 0.2 });
  }
  tone(seq, gain = 0.25) {
    if (!this.ctx) return;
    let at = this.ctx.currentTime;
    for (const [f, d] of seq) {
      if (!f) { at += d; continue; }
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.01); g.gain.setValueAtTime(gain, at + d - 0.02); g.gain.linearRampToValueAtTime(0, at + d);
      o.connect(g).connect(this.speaker);
      o.start(at); o.stop(at + d + 0.02);
      at += d;
    }
  }
  chime() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.lib.chime[0];
    const g = this.gain(0.6 * (0.4 + (this.warnVol ?? 0.7)));
    src.connect(g).connect(this.speaker); src.start();
  }
  beep(f = 2000, d = 0.1) { this.tone([[f, d]], 0.12); }
  starter() { this.relay(2); }
  ignition(which = 'mtg') {
    this.play('lightoff', { gain: which === 'apu' ? 0.45 : 0.85, pos: which === 'apu' ? [-0.9, 0.4, 2] : [0, 0.2, 2.4], via: 'hull', ref: 1.2 });
  }
  event(type, data = {}) {
    switch (type) {
      case 'clunk': this.play('clunk', { gain: 0.7, pos: [0, -1, 0.3], via: 'hull', ref: 1 }); this.play('clunk', { gain: 0.15, pos: [0, 0.6, 0.4], send: 0.4 }); break;
      case 'lock': this.play('clunk', { gain: 0.9, pos: [0, -3, 0], via: 'hull', ref: 2 }); this.play('relay', { gain: 0.2 }); break;
      case 'dump': this.play('dump', { gain: 0.7, pos: [0, -0.4, 0.4], via: 'hull', ref: 0.8 }); this.play('dump', { gain: 0.12, pos: [0.4, 0.3, 0.2] }); break;
      case 'creak': this.play('creak', { gain: data.gain ?? 0.25, pos: [R() * 1.6 - 0.8, 0.8 + R(), R() - 0.2] }); break;
    }
  }
  setVolume(v) { this.volume = clamp(v, 0, 1.5); if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); }

  speak(text) {
    try {
      const ss = window.speechSynthesis; if (!ss) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.rate = 1.08; u.pitch = 0.85; u.volume = clamp(0.4 + (this.warnVol ?? 0.7) * 0.6, 0, 1);
      const v = ss.getVoices().find((x) => x.lang && x.lang.startsWith('de'));
      if (v) u.voice = v;
      ss.speak(u);
    } catch (e) { /* speech not available */ }
  }

  // ---------------------------------------------------------------- per frame
  update(sim, dt, motion) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = sim, L = this.L;
    const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
    this.warnVol = s.sw.warnVol;
    const ess = s.bus.ess > 17 ? clamp((s.bus.ess - 17) / 10, 0, 1.05) : 0;
    const main = s.bus.b1 > 0 || s.bus.b2 > 0 ? 1 : 0;

    // wind: always a faint breeze outside, more with speed and height
    set(L.wind.g.gain, 0.02 + s.walk.speedAbs * 0.012 + s.act.posture * 0.008, 0.4);
    set(L.wind.f.frequency, 220 + s.walk.speedAbs * 60, 0.4);

    // ventilation and avionics run up with bus voltage (fans spin up)
    set(L.vent.g.gain, ess * 0.035, 0.8);
    set(L.vent.tg.gain, ess * 0.004, 0.8);
    set(L.vent.n.playbackRate, 0.6 + ess * 0.45, 1.2);
    set(L.vent.tone.frequency, 60 + ess * 90, 1.2);
    const av = s.P.mfd && s.P.mfd.some(Boolean) ? ess : 0;
    set(L.avio.g.gain, av * 0.03, 1.0);
    set(L.avio.bg.gain, av * 0.005, 1.0);
    set(L.avio.blade.frequency, 40 + av * 175, 1.5);
    set(L.avio.n.playbackRate, 0.5 + av * 0.6, 1.5);
    set(L.avio.ig.gain, ess * 0.0022 + main * 0.0012, 0.3);

    // fuel pumps
    const fp = [s.P.fuelL, s.P.fuelR];
    L.fuel.forEach((f, i) => {
      set(f.mg.gain, fp[i] ? 0.05 : 0, fp[i] ? 0.25 : 0.6);
      set(f.ng.gain, fp[i] ? 0.03 * clamp(s.fuel.press / 2.5, 0.2, 1) : 0, 0.4);
      set(f.m.frequency, fp[i] ? 97 + i * 3 : 30, fp[i] ? 0.3 : 0.9);
    });

    // APU
    const a = s.apu, ar = a.rpm;
    const cranking = a.state === 'start' && ar < 0.55;
    set(L.apu.starter.frequency, 25 + ar * 520 * (cranking ? 1 : 0.6), 0.1);
    set(L.apu.sg.gain, cranking ? 0.14 * clamp(ar * 6, 0.3, 1) : 0, 0.15);
    set(L.apu.sgIn.gain, cranking ? 0.03 : 0, 0.15);
    set(L.apu.w1.frequency, 60 + ar * 2650, 0.25);
    set(L.apu.w2.frequency, 61 + ar * 3980, 0.25);
    set(L.apu.wg.gain, Math.pow(ar, 1.6) * 0.045, 0.3);
    set(L.apu.rf.frequency, 90 + ar * 700, 0.3);
    set(L.apu.rg.gain, (a.lit ? 0.05 + ar * 0.09 : ar * 0.03), 0.3);
    set(L.apu.inf.frequency, 1500 + ar * 2500, 0.3);
    set(L.apu.ing.gain, ar * ar * 0.03, 0.3);

    // main turbine
    const m = s.mtg, n2 = m.n2;
    set(L.mtg.w1.frequency, 80 + n2 * 2350, 0.3);
    set(L.mtg.w2.frequency, 82 + n2 * 3520, 0.3);
    set(L.mtg.wg.gain, n2 * n2 * 0.05, 0.3);
    set(L.mtg.tone.frequency, 18 + n2 * 150, 0.3);
    set(L.mtg.tg.gain, Math.pow(n2, 1.4) * 0.1, 0.3);
    set(L.mtg.rf.frequency, 70 + n2 * 380 + m.load * 450, 0.4);
    set(L.mtg.rg.gain, (m.lit ? 0.07 + n2 * 0.13 + m.load * 0.35 : n2 * 0.06), 0.4);
    set(L.mtg.hg.gain, n2 * 0.015 + m.load * 0.01, 0.4);
    set(L.mtg.rum.frequency, 18 + n2 * 32, 0.3);
    set(L.mtg.rmg.gain, m.lit ? 0.04 + m.load * 0.07 : n2 * 0.03, 0.4);
    const airStart = m.valve && a.bleed > 1.2;
    set(L.mtg.ast.frequency, 500 + n2 * 9000, 0.2);
    set(L.mtg.asg.gain, airStart ? 0.02 : 0, 0.25);
    set(L.mtg.ag.gain, (airStart ? 0.05 : 0) + (a.bleed > 0.5 && s.sw.apuBleed ? 0.012 : 0), 0.25);

    // hydraulics: B electric, A follows N2; pitch sags under demand
    const demand = motion;
    const pA = s.sw.hydA && m.lit && n2 > 0.4, pB = !!s.hyd.pumpB;
    [[L.hyd[0], pA, 26 + n2 * 50], [L.hyd[1], pB, 60]].forEach(([h, on, f]) => {
      set(h.o.frequency, on ? f * (1 - demand * 0.06) : 8, on ? 0.4 : 1.2);
      set(h.og.gain, on ? 0.035 + demand * 0.045 : 0, on ? 0.3 : 0.8);
      set(h.ng.gain, on ? 0.02 + demand * 0.05 : 0, 0.3);
      set(h.leak.gain, on ? 0.006 : 0, 0.3);
    });

    // servo valves and fluid flow, pulsing with the gait
    const w = s.walk;
    const gait = 0.5 + 0.5 * Math.abs(Math.sin(w.phase * Math.PI));
    const flow = motion * (w.speedAbs > 0.2 ? gait : 1);
    set(L.flow.g.gain, flow * 0.09, 0.05);
    set(L.flow.g2.gain, flow * 0.12, 0.05);
    set(L.flow.valve.frequency, 30 + flow * 40, 0.1);
    set(L.flow.vg.gain, flow * 0.025, 0.08);

    // gyro
    const gr = s.gyro.rpm;
    set(L.gyro.o1.frequency, 30 + gr * 590, 0.4);
    set(L.gyro.o2.frequency, 30.6 + gr * 591.5, 0.4);
    set(L.gyro.g.gain, gr > 0.01 ? 0.004 + gr * 0.008 : 0, 0.5);
    set(L.gyro.ng.gain, gr * 0.004, 0.5);

    // coolant
    set(L.cool.mg.gain, s.cool.flow * 0.03, 0.5);
    set(L.cool.ng.gain, s.cool.flow * 0.06, 0.5);

    // display coil whine (very faint)
    const sdu = s.P.sdu ? s.P.sdu.filter(Boolean).length : 0;
    set(L.sdu.g.gain, sdu * 0.00035, 0.5);

    // igniters tick during starts
    const apuIgn = a.state === 'start' && !a.lit && ar > 0.05;
    const mtgIgn = s.P.ign && !m.lit && n2 > 0.04;
    if (apuIgn || mtgIgn) {
      this._sparkT -= dt;
      if (this._sparkT <= 0) {
        this._sparkT = mtgIgn ? 0.33 : 0.25;
        this.play('spark', { gain: mtgIgn ? 0.22 : 0.15, pos: mtgIgn ? [0.2, 0.3, 1.9] : [-0.9, 0.4, 1.8], via: 'cabin', send: 0.3, ref: 0.8 });
      }
    }
    // structure groans while the actuators move the whole machine
    if (s.act.motion > 0.35 && w.speedAbs < 0.3) {
      this._creakT -= dt;
      if (this._creakT <= 0) { this._creakT = 0.5 + R() * 1.4; this.event('creak', { gain: 0.15 + s.act.motion * 0.2 }); }
    }

    // master warning aural tone + voice
    if (s.warn.masterWarning && !s.warn.warningSilenced) {
      this._warnT -= dt;
      if (this._warnT <= 0) { this._warnT = 1.1; this.tone([[1250, 0.16], [0, 0.05], [1250, 0.16], [0, 0.05], [940, 0.3]], 0.12 + (s.sw.warnVol || 0) * 0.18); }
    } else this._warnT = 0;
    const voice = { MTGT: 'Warnung. Turbine Übertemperatur.', COOL: 'Warnung. Kühlung.', ESTOP: 'Not-Aus aktiv.', BAL: 'Warnung. Stabilität.' };
    for (const id of s.warn.active) {
      if (voice[id] && !this.lastWarn.has(id)) {
        const entry = s.warn.list.find((x) => x[0] === id);
        if (entry && entry[2] === 'w') setTimeout(() => this.speak(voice[id]), 900);
      }
    }
    this.lastWarn = new Set(s.warn.active);
  }
}
