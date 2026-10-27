// Procedural cockpit audio (WebAudio). Every sound is synthesized, nothing is loaded.
import { clamp } from './util.js';

export class CockpitAudio {
  constructor() {
    this.ctx = null;
    this.layers = {};
    this.volume = 0.8;
    this._warnT = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // shared noise buffers
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }

    const L = this.layers;
    // Hull ambience: wind and structure
    L.amb = this._noiseLayer(this.brown, 'lowpass', 320, 0.6, 0.012);
    // Avionics: fans and mains hum
    L.fan = this._noiseLayer(this.white, 'bandpass', 1400, 0.6, 0);
    L.hum = this._oscLayer('sine', 120, 0, null);
    // APU: whine + roar
    L.apuWhine = this._oscLayer('sawtooth', 200, 0, { type: 'lowpass', f: 2600, q: 2 });
    L.apuRoar = this._noiseLayer(this.white, 'bandpass', 600, 0.8, 0);
    // Main turbine
    L.mtgTone = this._oscLayer('sawtooth', 80, 0, { type: 'lowpass', f: 900, q: 1.5 });
    L.mtgWhine = this._oscLayer('sine', 2400, 0, null);
    L.mtgRoar = this._noiseLayer(this.brown, 'lowpass', 500, 0.7, 0);
    L.mtgHiss = this._noiseLayer(this.white, 'bandpass', 3000, 0.5, 0);
    // Hydraulic pump (electric) with tremolo
    L.hyd = this._oscLayer('triangle', 410, 0, { type: 'bandpass', f: 800, q: 1.0 }, 22);
    // Gyro spin
    L.gyro = this._oscLayer('sine', 300, 0, null);
    // Servos / actuators
    L.servo = this._oscLayer('sawtooth', 160, 0, { type: 'bandpass', f: 700, q: 3 });
    L.servoNoise = this._noiseLayer(this.white, 'bandpass', 1800, 2, 0);
    // Coolant flow
    L.cool = this._noiseLayer(this.brown, 'bandpass', 260, 1.2, 0);
  }

  get ready() { return !!this.ctx; }

  _noiseLayer(buf, ftype, f, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const flt = ctx.createBiquadFilter(); flt.type = ftype; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(flt).connect(g).connect(this.master);
    src.start(ctx.currentTime + Math.random() * 0.1);
    return { src, flt, g };
  }

  _oscLayer(type, f, gain, filter, tremolo) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f;
    let node = osc, flt = null;
    if (filter) {
      flt = ctx.createBiquadFilter(); flt.type = filter.type; flt.frequency.value = filter.f; flt.Q.value = filter.q;
      node.connect(flt); node = flt;
    }
    const g = ctx.createGain(); g.gain.value = gain;
    if (tremolo) {
      const am = ctx.createGain(); am.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.frequency.value = tremolo;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg).connect(am.gain); lfo.start();
      node.connect(am); node = am;
    }
    node.connect(g).connect(this.master);
    osc.start();
    return { osc, flt, g };
  }

  _set(param, v, tc = 0.08) {
    param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // Called every frame with simulation state
  update(sim, dt, motion) {
    if (!this.ctx) return;
    const L = this.layers, s = sim;
    const ess = s.bus.ess > 18 ? 1 : 0;
    const avion = ess && s.sw.avionics ? 1 : 0;
    this._set(L.fan.g.gain, avion * 0.016 + (s.sw.cool1 || s.sw.cool2 ? 0.004 : 0));
    this._set(L.hum.g.gain, ess * 0.004 + avion * 0.004);

    const apu = s.apu.rpm;
    this._set(L.apuWhine.osc.frequency, 140 + apu * 1900, 0.15);
    this._set(L.apuWhine.g.gain, Math.pow(apu, 1.3) * 0.035, 0.15);
    this._set(L.apuRoar.flt.frequency, 300 + apu * 1600, 0.2);
    this._set(L.apuRoar.g.gain, (apu * 0.05 + (s.apu.lit ? 0.04 : 0)) * apu, 0.2);

    const n2 = s.mtg.n2;
    this._set(L.mtgTone.osc.frequency, 45 + n2 * 520, 0.2);
    this._set(L.mtgTone.g.gain, Math.pow(n2, 1.5) * 0.05, 0.2);
    this._set(L.mtgWhine.osc.frequency, 1400 + n2 * 5200, 0.2);
    this._set(L.mtgWhine.g.gain, n2 * n2 * 0.006, 0.2);
    const comb = s.mtg.lit ? 1 : 0;
    this._set(L.mtgRoar.flt.frequency, 120 + n2 * 700 + s.mtg.load * 400, 0.3);
    this._set(L.mtgRoar.g.gain, comb * (0.08 + n2 * 0.18 + s.mtg.load * 0.15), 0.3);
    this._set(L.mtgHiss.g.gain, n2 * 0.012, 0.3);

    const hydB = s.hyd.pumpB;
    this._set(L.hyd.osc.frequency, 330 + s.hyd.b / 207 * 120 + motion * 60, 0.2);
    this._set(L.hyd.g.gain, hydB * (0.012 + motion * 0.02), 0.2);

    this._set(L.gyro.osc.frequency, 120 + s.gyro.rpm * 1700, 0.3);
    this._set(L.gyro.g.gain, s.gyro.rpm > 0.01 ? 0.0035 * Math.min(1, s.gyro.rpm * 3) : 0, 0.3);

    this._set(L.servo.osc.frequency, 110 + motion * 260, 0.05);
    this._set(L.servo.g.gain, motion * 0.035, 0.05);
    this._set(L.servoNoise.g.gain, motion * 0.02, 0.05);

    this._set(L.cool.g.gain, s.cool.flow * 0.03, 0.4);
    this._set(L.amb.g.gain, 0.012 + s.walk.speedAbs * 0.004, 0.3);

    // Master warning aural tone: repeating two-tone while active
    if (s.warn.masterWarning && !s.warn.warningSilenced) {
      this._warnT -= dt;
      if (this._warnT <= 0) { this._warnT = 0.9; this.tone([[880, 0.18], [660, 0.18]], 0.11); }
    } else this._warnT = 0;
  }

  // ---- one-shots ----
  _burst({ dur = 0.02, f = 3000, q = 1, type = 'bandpass', gain = 0.2, buf = 'white', at = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = buf === 'white' ? this.white : this.brown;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }

  _ping({ f = 1000, f2 = null, dur = 0.05, gain = 0.1, type = 'sine', at = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  click(kind = 'toggle') {
    if (!this.ctx) return;
    switch (kind) {
      case 'toggle':
        this._burst({ dur: 0.012, f: 4200, q: 1.5, gain: 0.5 });
        this._ping({ f: 2300, f2: 1500, dur: 0.025, gain: 0.08, type: 'triangle' });
        this._burst({ dur: 0.03, f: 900, q: 2, gain: 0.12, at: 0.004 });
        break;
      case 'guard':
        this._burst({ dur: 0.03, f: 1800, q: 1, gain: 0.25 });
        this._ping({ f: 700, f2: 400, dur: 0.06, gain: 0.05, type: 'triangle' });
        break;
      case 'push':
        this._burst({ dur: 0.015, f: 2600, q: 1.2, gain: 0.35 });
        this._ping({ f: 1200, f2: 800, dur: 0.03, gain: 0.05, type: 'triangle' });
        break;
      case 'release':
        this._burst({ dur: 0.01, f: 3400, q: 1.2, gain: 0.15 });
        break;
      case 'detent':
        this._burst({ dur: 0.01, f: 5000, q: 2, gain: 0.25 });
        this._burst({ dur: 0.02, f: 1400, q: 3, gain: 0.1, at: 0.003 });
        break;
      case 'breaker':
        this._burst({ dur: 0.02, f: 2000, q: 1, gain: 0.4 });
        this._ping({ f: 500, f2: 300, dur: 0.05, gain: 0.08, type: 'square' });
        break;
      case 'lever':
        this._burst({ dur: 0.05, f: 700, q: 0.8, gain: 0.08 });
        break;
      case 'estop':
        this._burst({ dur: 0.05, f: 800, q: 0.7, gain: 0.6 });
        this._ping({ f: 180, f2: 90, dur: 0.12, gain: 0.25, type: 'sine' });
        break;
    }
  }

  relay(n = 1) {
    for (let i = 0; i < n; i++) {
      const at = 0.02 + i * (0.03 + Math.random() * 0.05);
      this._ping({ f: 140, f2: 60, dur: 0.06, gain: 0.18, at });
      this._burst({ dur: 0.012, f: 2500, q: 0.7, gain: 0.18, at });
    }
  }

  thump(strength = 1) {
    if (!this.ctx) return;
    const s = clamp(strength, 0, 1.6);
    this._ping({ f: 70, f2: 28, dur: 0.5, gain: 0.5 * s });
    this._burst({ dur: 0.35, f: 160, q: 0.7, type: 'lowpass', gain: 0.6 * s, buf: 'brown' });
    // structure creak
    this._ping({ f: 220 + Math.random() * 80, f2: 150, dur: 0.25, gain: 0.03 * s, type: 'sawtooth', at: 0.06 });
    this._burst({ dur: 0.08, f: 3500, q: 4, gain: 0.04 * s, at: 0.03 });
  }

  tone(seq, gain = 0.08) {
    if (!this.ctx) return;
    let at = 0;
    for (const [f, d] of seq) { this._ping({ f, dur: d, gain, at, type: 'square' }); at += d; }
  }

  chime() {
    this._ping({ f: 1318, dur: 0.9, gain: 0.07 });
    this._ping({ f: 1976, dur: 0.6, gain: 0.03 });
  }

  beep(f = 2000, d = 0.1) { this._ping({ f, dur: d, gain: 0.05, type: 'sine' }); }

  starter(on) {
    if (!this.ctx) return;
    if (on) this._burst({ dur: 0.3, f: 300, q: 0.6, type: 'lowpass', gain: 0.25, buf: 'brown' });
  }

  ignition() {
    // light-off "whoomp"
    this._burst({ dur: 1.2, f: 220, q: 0.5, type: 'lowpass', gain: 0.6, buf: 'brown' });
    this._ping({ f: 55, f2: 35, dur: 0.9, gain: 0.25 });
  }
}
