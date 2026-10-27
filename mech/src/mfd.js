// Multifunction displays (MFD): bezel, 20 option select buttons (OSB), canvas display.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G, materials, makeCanvas, canvasTex, FONT_MONO, FONT_SANS, clamp, TAU, DEG, approach } from './util.js';
import { Control } from './panel.js';
import { GAITS, BREAKERS } from './systems.js';

const C = {
  bg: '#030605', white: '#e9f2ee', green: '#3cf07a', cyan: '#3fe0ff', amber: '#ffb400', red: '#ff3b2f',
  grey: '#5d6b66', dim: '#26302c', magenta: '#ff5cf0',
};

export const CHECKLIST = [
  ['BATTERIE', 'EIN', (s) => s.sw.bat === 1],
  ['BORDRECHNER (AVIONIK)', 'EIN', (s) => s.av.ready],
  ['LAMPENTEST', 'PRÜFEN', (s) => s.flags.lampTested],
  ['KST-PUMPE L', 'EIN', (s) => s.sw.fuelL === 1],
  ['KST-DRUCK', '> 1 BAR', (s) => s.fuel.press > 1],
  ['APU-SCHALTER', 'START', (s) => s.apu.lit || s.apu.avail || s.mtg.lit],
  ['APU BEREIT (100 %)', 'ABWARTEN', (s) => s.apu.avail || (s.mtg.lit && s.flags.apuWasOn)],
  ['APU GEN', 'EIN', (s) => s.gen.apu || (s.gen.g1 && s.gen.g2)],
  ['KST-PUMPE R', 'EIN', (s) => s.sw.fuelR === 1],
  ['APU ZAPFLUFT', 'EIN', (s) => s.apu.bleed > 2.5 || s.mtg.lit],
  ['ZÜNDUNG', 'EIN', (s) => s.sw.ign === 1],
  ['MTG START', 'DRÜCKEN', (s) => s.mtg.valve || s.mtg.n2 > 0.1],
  ['N2 ≥ 15 %: KST-HAHN', 'AUF', (s) => s.sw.mtgFuel === 1 && s.mtg.lit],
  ['MTG LEERLAUF 62 %', 'PRÜFEN', (s) => s.mtg.lit && s.mtg.n2 > 0.6],
  ['GEN 1 / GEN 2', 'EIN', (s) => s.gen.g1 && s.gen.g2],
  ['APU ZAPFLUFT / GEN / APU', 'AUS', (s) => s.sw.apu === 0 && s.sw.apuBleed === 0, true],
  ['HYD PUMPE A / B', 'EIN', (s) => s.hyd.a > 150 && s.hyd.b > 150],
  ['KÜHLPUMPE 1 / 2', 'EIN', (s) => s.sw.cool1 === 1 && s.sw.cool2 === 1],
  ['INS-WAHLSCHALTER', 'AUSR', (s) => s.sw.insMode >= 1 && s.P.ins],
  ['KREISEL', 'EIN', (s) => s.sw.gyro === 1 && s.gyro.rpm > 0],
  ['SENSOREN', 'EIN', (s) => s.sens.boot.every((v) => v >= 1)],
  ['INS AUSRICHTUNG', 'ABWARTEN', (s) => s.ins.align >= 1],
  ['INS-WAHLSCHALTER', 'NAV', (s) => s.ins.status === 'NAV'],
  ['KREISEL STABIL', 'PRÜFEN', (s) => s.gyro.ok],
  ['AKTUATOR STROM', 'EIN', (s) => !!s.P.act],
  ['AKTUATOREN', 'KALIBRIEREN', (s) => s.act.calibrated],
  ['HALTUNG', 'AUFRICHTEN', (s) => s.act.posture > 0.99],
  ['FUSS-SPERRE', 'FREI', (s) => s.sw.footLock === 1],
  ['MASTER VORSICHT', 'QUITTIEREN', (s) => !s.warn.masterCaution],
  ['BEREIT ZUM GEHEN', '✓', (s) => s.walk.canWalk],
];

const BOOT = [
  [0.6, 'GW-7 MISSIONSRECHNER  MC-3B', C.white],
  [0.9, 'BIOS 4.12.7  (C) KESSLER-WERKE AVIONIK', C.grey],
  [1.4, 'CPU 0/1  RH-PPC 1.2 GHZ ........ OK'],
  [1.6, 'SPEICHER %MEM'],
  [3.0, 'MIL-1553B BUS-CONTROLLER ...... OK'],
  [3.3, 'DISPLAYPROZESSOR DP-2 ......... OK'],
  [3.6, 'WARNSYSTEM-SCHNITTSTELLE ...... OK'],
  [3.9, 'INS-SCHNITTSTELLE ............. OK'],
  [4.2, 'APU-STEUERGERÄT ECU-40 ........ OK'],
  [4.5, 'MTG-REGLER FADEC-7 ............ OK'],
  [4.9, 'AKTUATOR-STEUERUNG ...... BEREITSCH.', C.amber],
  [5.3, 'SENSOR-NETZ .............. KEIN SIGNAL', C.amber],
  [5.9, 'LADE KX-OS 7.3 ...', C.white],
];

class OSB extends Control {
  constructor(mfd, i) { super({ id: `osb${mfd.idx}_${i}`, name: `MFD ${mfd.label} · Taste ${i + 1}` }); this.mfd = mfd; this.i = i; this.depth = 0; this.pressed = false; }
  build() {
    const M = materials();
    this.cap = new THREE.Mesh(new RoundedBoxGeometry(0.0105, 0.0095, 0.006, 2, 0.0015), M.rubber);
    this.cap.position.z = 0.003; this.cap.castShadow = true;
    this.group.add(this.cap);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.014), M.pick);
    pick.position.z = 0.006;
    this.group.add(this.addPick(pick));
  }
  interact(ev) {
    if (ev.type === 'down') { this.pressed = true; G.audio?.click('push'); this.mfd.osb(this.i); }
    if (ev.type === 'up') { this.pressed = false; }
  }
  update(dt) { this.depth = approach(this.depth, this.pressed ? 1 : 0, 40, dt); this.cap.position.z = 0.003 - this.depth * 0.0015; }
  tip() { const l = this.mfd.labelFor(this.i); return { title: this.name, state: l ? l.replace('\n', ' ') : '–' }; }
}

const TOP = ['ENG', 'ELEK', 'HYD', 'NAV', 'CHK'];
const BOTTOM = ['STAT', 'MELD', 'SICH', '', ''];

export class MFD {
  constructor(idx, label, page) {
    this.idx = idx; this.label = label; this.page = page;
    this.S = 640;
    this.canvas = makeCanvas(this.S, this.S);
    this.ctx = this.canvas.getContext('2d');
    this.tex = canvasTex(this.canvas);
    this.timer = Math.random() * 0.1;
    this.scroll = 0; this.autoScroll = true;
    this.brt = 0;
    this.osbs = [];
  }

  // place on a panel at (x,y)
  attach(panel, x, y) {
    const M = materials();
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const bez = new THREE.Mesh(new RoundedBoxGeometry(0.236, 0.236, 0.026, 3, 0.006), M.bezel);
    bez.position.z = 0.012; bez.castShadow = true; bez.receiveShadow = true;
    g.add(bez);
    // display surface
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x020303, roughness: 0.12, metalness: 0.0, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0,
    });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.168, 0.168), this.mat);
    scr.position.z = 0.0254;
    g.add(scr);
    // recess frame around display
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.176, 0.176, 0.002), M.black);
    fr.position.z = 0.0236; g.add(fr);
    // bezel screws + rocker switches in the corners
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0012, 12).rotateX(Math.PI / 2), M.darkSteel);
      s.position.set(sx * 0.108, sy * 0.108, 0.0255); g.add(s);
      const rk = new THREE.Mesh(new RoundedBoxGeometry(0.011, 0.02, 0.005, 2, 0.002), M.rubber);
      rk.position.set(sx * 0.098, sy * 0.098, 0.026);
      rk.rotation.z = (sx * sy > 0 ? -1 : 1) * Math.PI / 4;
      g.add(rk);
    }
    panel.group.add(g);
    this.group = g;
    // OSBs: 0-4 top (L→R), 5-9 right (T→B), 10-14 bottom (R→L), 15-19 left (B→T)
    const P = [-0.06, -0.03, 0, 0.03, 0.06], d = 0.1035;
    for (let i = 0; i < 20; i++) {
      const o = new OSB(this, i);
      const k = i % 5, side = Math.floor(i / 5);
      let ox, oy;
      if (side === 0) { ox = P[k]; oy = d; } else if (side === 1) { ox = d; oy = -P[k]; }
      else if (side === 2) { ox = -P[k]; oy = -d; } else { ox = -d; oy = P[k]; }
      o.build();
      o.group.position.set(ox, oy, 0.025);
      g.add(o.group);
      this.osbs.push(o);
      panel.controls.push(o);
    }
    // engraved label strip
    return g;
  }

  labelFor(i) {
    if (i < 5) return TOP[i];
    if (i >= 10 && i < 15) return BOTTOM[i - 10];
    if (this.page === 'CHK') { if (i === 5) return 'AUF'; if (i === 9) return 'AB'; if (i === 7) return 'AUTO'; }
    if (this.page === 'SICH') { if (i === 5) return 'AUF'; if (i === 9) return 'AB'; }
    return '';
  }

  osb(i) {
    const s = G.sim;
    if (!s.P.mfd[this.idx] || s.av.boot < 1) return;
    if (i < 5) { this.page = TOP[i]; G.audio?.beep(2600, 0.03); return; }
    if (i >= 10 && i < 15 && BOTTOM[i - 10]) { this.page = BOTTOM[i - 10]; G.audio?.beep(2600, 0.03); return; }
    if (this.page === 'CHK') {
      if (i === 5) { this.scroll = Math.max(0, this.scroll - 3); this.autoScroll = false; }
      if (i === 9) { this.scroll = Math.min(CHECKLIST.length - 10, this.scroll + 3); this.autoScroll = false; }
      if (i === 7) this.autoScroll = true;
    }
  }

  update(dt) {
    const s = G.sim;
    const on = s.P.mfd[this.idx];
    const target = on ? 1.5 * clamp((s.bus.ess - 16) / 8, 0, 1) : 0;
    this.brt = approach(this.brt, target, on ? 4 : 12, dt);
    this.mat.emissiveIntensity = this.brt;
    if (!on && this.brt < 0.01) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 12;
    this.draw(s);
    this.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ drawing
  draw(s) {
    const k = this.ctx, S = this.S;
    k.fillStyle = C.bg; k.fillRect(0, 0, S, S);
    const bootT = s.av.boot * 11 - this.idx * 0.35;
    if (bootT < 10.2) { this.drawBoot(k, bootT); return; }
    k.save();
    const fn = this['page' + this.page];
    if (fn) fn.call(this, k, s); else this.pageCHK(k, s);
    k.restore();
    this.drawLabels(k);
  }

  font(px, w = 400, mono = true) { this.ctx.font = `${w} ${px}px ${mono ? FONT_MONO : FONT_SANS}`; }

  t(str, x, y, color = C.white, px = 22, align = 'left', w = 400) {
    const k = this.ctx;
    this.font(px, w);
    k.fillStyle = color; k.textAlign = align; k.textBaseline = 'middle';
    k.fillText(str, x, y);
  }

  drawBoot(k, t) {
    const S = this.S;
    if (t < 0.4) { k.fillStyle = '#0a0d0c'; k.fillRect(0, 0, S, S); return; }
    if (t > 8.2) {
      // splash
      const a = clamp((t - 8.2) / 0.6, 0, 1);
      k.globalAlpha = a;
      this.t('GW-7', S / 2, S / 2 - 50, C.white, 64, 'center', 700);
      this.t('GRAUWOLF', S / 2, S / 2 + 14, C.green, 34, 'center', 700);
      this.t('KX-OS 7.3  ·  MFD ' + this.label, S / 2, S / 2 + 70, C.grey, 18, 'center');
      k.globalAlpha = 1;
      return;
    }
    let y = 40;
    for (const [at, txt, col] of BOOT) {
      if (t < at) break;
      let line = txt;
      if (txt.includes('%MEM')) {
        const kb = Math.min(4194304, Math.floor((t - at) / 1.3 * 4194304));
        line = txt.replace('%MEM', `${String(kb).padStart(7, ' ')} KB ${kb >= 4194304 ? 'OK' : ''}`);
      }
      this.t(line, 28, y, col || C.green, 19);
      y += 30;
    }
    if (t > 5.9) {
      const p = clamp((t - 6.2) / 1.9, 0, 1);
      k.strokeStyle = C.green; k.lineWidth = 2; k.strokeRect(28, y + 6, S - 56, 22);
      k.fillStyle = C.green; k.fillRect(32, y + 10, (S - 64) * p, 14);
    }
    if (Math.floor(t * 3) % 2 === 0) { k.fillStyle = C.green; k.fillRect(28, y + 50, 12, 20); }
  }

  drawLabels(k) {
    const S = this.S, P = [-0.06, -0.03, 0, 0.03, 0.06].map((p) => (p / 0.168 + 0.5) * S);
    for (let i = 0; i < 20; i++) {
      const l = this.labelFor(i); if (!l) continue;
      const kk = i % 5, side = Math.floor(i / 5);
      const sel = (i < 5 && TOP[i] === this.page) || (i >= 10 && i < 15 && BOTTOM[i - 10] === this.page);
      this.font(20, 700);
      const w = k.measureText(l).width;
      let x, y, align = 'center';
      if (side === 0) { x = P[kk]; y = 18; } else if (side === 2) { x = S - P[kk]; y = S - 18; }
      else if (side === 1) { x = S - 10; y = P[kk]; align = 'right'; } else { x = 10; y = S - P[kk]; align = 'left'; }
      if (sel) {
        k.strokeStyle = C.white; k.lineWidth = 2;
        const bx = align === 'center' ? x - w / 2 - 5 : align === 'right' ? x - w - 5 : x - 5;
        k.strokeRect(bx, y - 13, w + 10, 26);
      }
      this.t(l, x, y, C.white, 20, align, 700);
    }
  }

  // ---- reusable instruments
  arcGauge(x, y, r, v, min, max, opts = {}) {
    const k = this.ctx;
    const a0 = 150 * DEG, a1 = 390 * DEG;
    const f = clamp((v - min) / (max - min), 0, 1);
    k.lineWidth = 3; k.strokeStyle = C.grey;
    k.beginPath(); k.arc(x, y, r, a0, a1); k.stroke();
    for (const z of opts.zones || []) {
      k.strokeStyle = z.color; k.lineWidth = 5;
      k.beginPath(); k.arc(x, y, r + 5, a0 + (z.from - min) / (max - min) * (a1 - a0), a0 + (z.to - min) / (max - min) * (a1 - a0)); k.stroke();
    }
    let col = C.white;
    if (opts.red != null && v >= opts.red) col = C.red; else if (opts.amber != null && v >= opts.amber) col = C.amber;
    if (opts.low != null && v < opts.low && opts.lowActive) col = C.amber;
    k.fillStyle = col === C.white ? 'rgba(233,242,238,0.22)' : col === C.red ? 'rgba(255,59,47,0.35)' : 'rgba(255,180,0,0.3)';
    k.beginPath(); k.moveTo(x, y); k.arc(x, y, r - 2, a0, a0 + f * (a1 - a0)); k.closePath(); k.fill();
    const a = a0 + f * (a1 - a0);
    k.strokeStyle = col; k.lineWidth = 4;
    k.beginPath(); k.moveTo(x, y); k.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); k.stroke();
    // digital readout
    k.strokeStyle = C.grey; k.lineWidth = 2;
    k.strokeRect(x + 4, y - r * 0.55 - 16, r * 0.95, 30);
    this.t(opts.fmt ? opts.fmt(v) : v.toFixed(0), x + 4 + r * 0.9, y - r * 0.55 - 1, col, 24, 'right', 700);
    if (opts.label) this.t(opts.label, x, y + r * 0.62, C.cyan, 18, 'center');
  }

  bar(x, y, w, h, v, min, max, color = C.green) {
    const k = this.ctx;
    const f = clamp((v - min) / (max - min), 0, 1);
    k.strokeStyle = C.grey; k.lineWidth = 2; k.strokeRect(x, y, w, h);
    k.fillStyle = color; k.fillRect(x + 3, y + h - 3 - (h - 6) * f, w - 6, (h - 6) * f);
  }

  header(title) {
    this.t(title, this.S / 2, 54, C.cyan, 22, 'center', 700);
  }

  // ---- pages
  pageENG(k, s) {
    const S = this.S;
    this.header('TRIEBWERKE');
    this.t('APU', 120, 92, C.cyan, 22, 'center', 700);
    this.arcGauge(120, 175, 62, s.apu.rpm * 100, 0, 110, { label: 'U/MIN %', red: 106, zones: [{ from: 102, to: 110, color: C.red }] });
    this.arcGauge(120, 330, 62, s.apu.egt, 0, 900, { label: 'AGT °C', amber: 680, red: 760, zones: [{ from: 680, to: 760, color: C.amber }, { from: 760, to: 900, color: C.red }] });
    const st = s.apu.state === 'start' ? (s.apu.lit ? 'HOCHLAUF' : 'ANLASSER') : s.apu.avail ? 'BEREIT' : s.apu.state === 'down' ? 'AUSLAUF' : 'AUS';
    this.t(st, 120, 420, s.apu.fault ? C.amber : s.apu.avail ? C.green : C.white, 20, 'center', 700);
    this.t(`ZAPFL ${s.apu.bleed.toFixed(1)} BAR`, 120, 450, C.white, 18, 'center');

    k.strokeStyle = C.dim; k.lineWidth = 2; k.beginPath(); k.moveTo(232, 90); k.lineTo(232, 470); k.stroke();
    this.t('HAUPTTURBINE MTG', 430, 92, C.cyan, 22, 'center', 700);
    this.arcGauge(345, 175, 62, s.mtg.n2 * 100, 0, 110, { label: 'N2 %', red: 104, zones: [{ from: 104, to: 110, color: C.red }] });
    this.arcGauge(515, 175, 62, s.mtg.egt, 0, 1100, { label: 'AGT °C', amber: 760, red: 860, zones: [{ from: 760, to: 860, color: C.amber }, { from: 860, to: 1100, color: C.red }] });
    this.arcGauge(345, 330, 62, s.mtg.oil, 0, 10, { label: 'ÖL BAR', fmt: (v) => v.toFixed(1), low: 2, lowActive: true });
    this.arcGauge(515, 330, 62, s.mtg.ff * 3600, 0, 2000, { label: 'KST-FLUSS KG/H' });
    const mst = s.mtg.lit ? (s.mtg.n2 < 0.6 ? 'HOCHLAUF' : 'LÄUFT') : s.mtg.valve ? 'ANLASSEN' : s.mtg.n2 > 0.02 ? 'AUSLAUF' : 'AUS';
    this.t(mst, 430, 420, s.mtg.hot ? C.red : s.mtg.lit ? C.green : C.white, 20, 'center', 700);
    if (s.mtg.valve) this.t('ANLASSVENTIL AUF', 430, 448, C.amber, 18, 'center', 700);
    if (s.mtg.damaged) this.t('SCHADEN', 430, 448, C.red, 18, 'center', 700);
    if (s.mtg.wet > 1) this.t('KST IN BRENNKAMMER', 430, 448, C.amber, 18, 'center', 700);

    k.strokeStyle = C.dim; k.beginPath(); k.moveTo(40, 478); k.lineTo(S - 40, 478); k.stroke();
    this.t('KRAFTSTOFF', 80, 500, C.cyan, 18, 'left', 700);
    this.t(`L ${s.fuel.L.toFixed(0).padStart(4)} KG`, 80, 532, C.white, 22);
    this.t(`R ${s.fuel.R.toFixed(0).padStart(4)} KG`, 80, 562, C.white, 22);
    this.t(`GES ${(s.fuel.L + s.fuel.R).toFixed(0)} KG`, 300, 532, C.white, 22);
    this.t(`DRUCK ${s.fuel.press.toFixed(1)} BAR`, 300, 562, s.fuel.press < 1 ? C.amber : C.white, 22);
    this.t(s.sw.xfeed ? 'QUERSPEISUNG AUF' : '', 300, 592, C.amber, 18);
  }

  pageELEK(k, s) {
    this.header('ELEKTRIK');
    const live = (on) => (on ? C.green : C.grey);
    const box = (x, y, w, h, title, on, sub, col) => {
      k.strokeStyle = col || live(on); k.lineWidth = 3; k.strokeRect(x - w / 2, y - h / 2, w, h);
      this.t(title, x, y - (sub ? 11 : 0), col || (on ? C.green : C.white), 20, 'center', 700);
      if (sub) this.t(sub, x, y + 14, C.white, 18, 'center');
    };
    const line = (pts, on) => {
      k.strokeStyle = live(on); k.lineWidth = 4; k.beginPath();
      pts.forEach(([x, y], i) => (i ? k.lineTo(x, y) : k.moveTo(x, y))); k.stroke();
    };
    const g = s.gen;
    box(110, 130, 130, 62, 'GEN 1', g.g1, g.g1 ? '28.3 V' : s.sw.gen1 ? 'BEREIT' : 'AUS', !g.g1 && s.P.ess ? C.amber : null);
    box(320, 130, 130, 62, 'APU GEN', g.apu, g.apu ? '28.3 V' : s.sw.apuGen ? 'BEREIT' : 'AUS');
    box(530, 130, 130, 62, 'GEN 2', g.g2, g.g2 ? '28.3 V' : s.sw.gen2 ? 'BEREIT' : 'AUS', !g.g2 && s.P.ess ? C.amber : null);
    const b1 = s.bus.b1 > 0, b2 = s.bus.b2 > 0;
    line([[110, 161], [110, 260]], g.g1);
    line([[530, 161], [530, 260]], g.g2);
    line([[320, 161], [320, 210], [140, 210], [140, 260]], g.apu);
    box(110, 290, 150, 58, 'BUS 1', b1, b1 ? s.bus.b1.toFixed(1) + ' V' : '0 V');
    box(530, 290, 150, 58, 'BUS 2', b2, b2 ? s.bus.b2.toFixed(1) + ' V' : '0 V');
    // bus tie
    const tie = s.sw.busTie === 1;
    line([[185, 290], [270, 290]], b1 && tie);
    line([[370, 290], [455, 290]], b2 && tie);
    k.strokeStyle = tie ? C.green : C.amber; k.lineWidth = 3;
    k.beginPath(); k.arc(320, 290, 38, 0, TAU); k.stroke();
    if (tie) { k.beginPath(); k.moveTo(282, 290); k.lineTo(358, 290); k.stroke(); }
    else { k.beginPath(); k.moveTo(300, 270); k.lineTo(340, 310); k.stroke(); }
    this.t('KOPPL', 320, 345, C.white, 16, 'center');
    // ESS bus
    line([[110, 319], [110, 420], [260, 420]], b1);
    line([[530, 319], [530, 420], [380, 420]], b2);
    const ess = s.bus.ess > 17;
    box(320, 420, 120, 58, 'ESS BUS', ess, ess ? s.bus.ess.toFixed(1) + ' V' : '0 V');
    line([[320, 449], [320, 500]], s.sw.bat && ess);
    const bcol = s.bat.charge < 0.3 ? C.amber : null;
    box(320, 540, 220, 70, 'BATTERIE', s.sw.bat === 1, `${s.bat.v.toFixed(1)} V  ${s.bat.i >= 0 ? '' : '+'}${Math.abs(s.bat.i).toFixed(0)} A  ${Math.round(s.bat.charge * 100)} %`, bcol);
    if (s.bat.i > 0.5 && s.sw.bat) this.t('ENTLADUNG', 320, 593, C.amber, 18, 'center', 700);
    else if (s.bat.i < -0.5) this.t('LADUNG', 320, 593, C.green, 18, 'center', 700);
  }

  pageHYD(k, s) {
    this.header('HYDRAULIK / KÜHLUNG');
    const col = (p) => (p < 150 ? C.amber : C.green);
    const sys = (x, name, p, pump, pumpTxt) => {
      this.t(name, x, 100, C.cyan, 22, 'center', 700);
      this.bar(x - 30, 120, 60, 260, p, 0, 300, col(p));
      k.strokeStyle = C.white; k.lineWidth = 2;
      const yN = 120 + 260 - 260 * (207 / 300);
      k.beginPath(); k.moveTo(x - 40, yN); k.lineTo(x - 30, yN); k.stroke();
      this.t(p.toFixed(0), x, 405, col(p), 28, 'center', 700);
      this.t('BAR', x, 432, C.white, 16, 'center');
      k.strokeStyle = pump ? C.green : C.grey; k.lineWidth = 3;
      k.beginPath(); k.arc(x, 480, 24, 0, TAU); k.stroke();
      if (pump) { k.beginPath(); k.moveTo(x - 14, 490); k.lineTo(x, 466); k.lineTo(x + 14, 490); k.stroke(); }
      this.t(pumpTxt, x, 524, pump ? C.green : C.white, 16, 'center');
    };
    sys(110, 'HYD A', s.hyd.a, s.sw.hydA && s.mtg.lit && s.mtg.n2 > 0.4, 'MTG-PUMPE');
    sys(250, 'HYD B', s.hyd.b, s.hyd.pumpB, 'E-PUMPE');
    k.strokeStyle = C.dim; k.beginPath(); k.moveTo(330, 90); k.lineTo(330, 560); k.stroke();
    this.t('KÜHLMITTEL', 470, 100, C.cyan, 22, 'center', 700);
    const T = s.cool.temp;
    const tc = T > 115 ? C.red : T > 95 ? C.amber : C.green;
    this.bar(400, 120, 50, 260, T, 0, 140, tc);
    this.t(`${T.toFixed(0)} °C`, 425, 405, tc, 26, 'center', 700);
    this.t('DURCHFLUSS', 545, 140, C.white, 16, 'center');
    this.t(`${Math.round(s.cool.flow * 100)} %`, 545, 168, s.cool.flow > 0.4 ? C.green : C.amber, 26, 'center', 700);
    this.t('PUMPE 1', 545, 220, s.P.cool1 ? C.green : C.grey, 18, 'center', 700);
    this.t('PUMPE 2', 545, 250, s.P.cool2 ? C.green : C.grey, 18, 'center', 700);
    this.t(s.sw.fan ? 'LÜFTER MAX' : 'LÜFTER AUTO', 545, 290, C.white, 16, 'center');
  }

  pageNAV(k, s) {
    const S = this.S, w = s.walk;
    this.header('NAVIGATION');
    const cx = S / 2, cy = 330, R = 210;
    const map = G.world?.navMap;
    const ok = s.ins.status === 'NAV' || s.ins.status === 'NOTBETRIEB' || s.ins.status === 'NAV DEGR';
    k.save();
    k.beginPath(); k.arc(cx, cy, R, 0, TAU); k.clip();
    if (map && ok) {
      const scale = R / 600; // 600 m radius
      k.translate(cx, cy); k.rotate(w.heading);
      k.globalAlpha = 0.85;
      const ms = G.world.navMapSize; // meters covered
      k.drawImage(map, (-ms / 2 - w.x) * scale, (-ms / 2 - w.z) * scale, ms * scale, ms * scale);
      k.globalAlpha = 1;
      // north marker / grid
      k.strokeStyle = 'rgba(63,224,255,0.25)'; k.lineWidth = 1;
      for (let gx = -2000; gx <= 2000; gx += 200) {
        k.beginPath(); k.moveTo((gx - w.x) * scale, (-2000 - w.z) * scale); k.lineTo((gx - w.x) * scale, (2000 - w.z) * scale); k.stroke();
        k.beginPath(); k.moveTo((-2000 - w.x) * scale, (gx - w.z) * scale); k.lineTo((2000 - w.x) * scale, (gx - w.z) * scale); k.stroke();
      }
      // depot marker
      k.strokeStyle = C.magenta; k.lineWidth = 2;
      k.strokeRect((-30 - w.x) * scale, (-30 - w.z) * scale, 60 * scale, 60 * scale);
    } else {
      k.fillStyle = '#071010'; k.fillRect(0, 0, S, S);
    }
    k.restore();
    // compass rose (heading up)
    k.strokeStyle = C.white; k.lineWidth = 2;
    k.beginPath(); k.arc(cx, cy, R, 0, TAU); k.stroke();
    const hdg = ((-w.heading / DEG) % 360 + 360) % 360;
    for (let d = 0; d < 360; d += 10) {
      const a = (d - hdg) * DEG - Math.PI / 2;
      const l = d % 30 === 0 ? 14 : 7;
      k.beginPath(); k.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); k.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); k.stroke();
      if (d % 30 === 0) {
        const lbl = { 0: 'N', 90: 'O', 180: 'S', 270: 'W' }[d] ?? String(d / 10);
        this.t(lbl, cx + Math.cos(a) * (R - 28), cy + Math.sin(a) * (R - 28), d % 90 === 0 ? C.cyan : C.white, 18, 'center', 700);
      }
    }
    // own symbol
    k.strokeStyle = C.white; k.lineWidth = 3;
    k.beginPath(); k.moveTo(cx, cy - 16); k.lineTo(cx + 10, cy + 12); k.lineTo(cx, cy + 6); k.lineTo(cx - 10, cy + 12); k.closePath(); k.stroke();
    // lubber line + heading box
    k.strokeStyle = C.white; k.strokeRect(cx - 40, 86, 80, 34);
    this.t(ok ? String(Math.round(hdg)).padStart(3, '0') : '---', cx, 104, C.white, 24, 'center', 700);
    this.t(`INS ${s.ins.status}`, 30, 575, s.ins.status === 'NAV' ? C.green : C.amber, 18, 'left', 700);
    if (s.ins.status === 'AUSRICHTUNG') {
      this.bar(30, 590, 200, 18, 0, 0, 1);
      k.fillStyle = C.amber; k.fillRect(33, 593, 194 * s.ins.align, 12);
      this.t(`${Math.round(s.ins.align * 100)} %`, 245, 599, C.amber, 16);
    }
    this.t(`GS ${(w.speedAbs * 3.6).toFixed(0)} KM/H`, S - 30, 575, C.white, 18, 'right', 700);
    this.t(ok ? `N${(-w.z).toFixed(0)} O${w.x.toFixed(0)}` : '', S - 30, 600, C.white, 16, 'right');
  }

  pageCHK(k, s) {
    const S = this.S;
    this.header('CHECKLISTE · KALTSTART');
    let cur = CHECKLIST.findIndex((c) => !c[3] && !c[2](s));
    if (cur < 0) cur = CHECKLIST.length;
    if (this.autoScroll) this.scroll = clamp(cur - 4, 0, CHECKLIST.length - 13);
    const rows = 13, y0 = 92, lh = 37;
    for (let r = 0; r < rows; r++) {
      const i = this.scroll + r;
      if (i >= CHECKLIST.length) break;
      const [name, act, done, opt] = CHECKLIST[i];
      const ok = done(s);
      const y = y0 + r * lh;
      const isCur = i === cur;
      if (isCur) { k.strokeStyle = C.cyan; k.lineWidth = 2; k.strokeRect(36, y - 16, S - 72, 33); }
      const col = ok ? C.green : isCur ? C.cyan : opt ? C.grey : C.white;
      this.t(String(i + 1).padStart(2, '0'), 48, y, C.grey, 17);
      // dotted leader
      this.font(19, 400);
      const nameW = k.measureText(name).width;
      this.t(name, 86, y, col, 19);
      this.font(19, 700);
      const actW = k.measureText(act).width;
      const xEnd = S - 80 - actW;
      k.fillStyle = C.dim;
      for (let x = 92 + nameW; x < xEnd - 8; x += 9) k.fillRect(x, y + 6, 2, 2);
      this.t(act, S - 80, y, col, 19, 'right', 700);
      if (ok) this.t('✓', S - 50, y, C.green, 22, 'center', 700);
      else if (opt) this.t('OPT', S - 50, y, C.grey, 13, 'center');
    }
    this.t(`${Math.min(cur, CHECKLIST.length)}/${CHECKLIST.length}`, S / 2, S - 50, C.grey, 18, 'center');
    if (!this.autoScroll) this.t('MANUELL', S - 70, S - 50, C.amber, 16, 'right');
  }

  pageSTAT(k, s) {
    const S = this.S, a = s.act, w = s.walk;
    this.header('BEWEGUNGSSYSTEM');
    // side view stick figure, posture 0..1
    const cx = 200, base = 520;
    const p = a.posture;
    const thigh = 120, shin = 125;
    const hipH = 120 + p * 115; // height of hip above foot
    // knee angle from leg geometry
    const d = Math.min(thigh + shin - 1, hipH);
    const ang = Math.acos(clamp((thigh * thigh + d * d - shin * shin) / (2 * thigh * d), -1, 1));
    const hip = [cx, base - hipH];
    const knee = [cx + Math.sin(ang) * thigh, hip[1] + Math.cos(ang) * thigh];
    const foot = [cx, base];
    k.strokeStyle = a.calibrated ? C.green : C.amber; k.lineWidth = 8; k.lineCap = 'round';
    k.beginPath(); k.moveTo(...hip); k.lineTo(...knee); k.lineTo(...foot); k.stroke();
    k.lineWidth = 3; k.strokeStyle = C.white;
    k.strokeRect(cx - 60, hip[1] - 120, 120, 105);
    k.beginPath(); k.moveTo(foot[0] - 50, base); k.lineTo(foot[0] + 60, base); k.stroke();
    for (const j of [hip, knee, foot]) { k.fillStyle = C.bg; k.beginPath(); k.arc(j[0], j[1], 9, 0, TAU); k.fill(); k.stroke(); }
    k.lineCap = 'butt';
    // status lines
    const L = (y, l, v, col = C.white) => { this.t(l, 360, y, C.cyan, 18); this.t(v, S - 40, y, col, 20, 'right', 700); };
    L(110, 'AKT STROM', s.P.act ? 'EIN' : 'AUS', s.P.act ? C.green : C.amber);
    L(145, 'KALIBRIERUNG', a.calibrating ? `${Math.round(a.cal * 100)} %` : a.calibrated ? 'OK' : 'FEHLT', a.calibrated ? C.green : C.amber);
    L(180, 'HALTUNG', p > 0.99 ? 'STAND' : p < 0.01 ? 'HOCKE' : `${Math.round(p * 100)} %`);
    L(215, 'KREISEL', `${Math.round(s.gyro.rpm * 100)} %`, s.gyro.ok ? C.green : C.amber);
    L(250, 'HYD A/B', `${s.hyd.a.toFixed(0)}/${s.hyd.b.toFixed(0)}`, s.hydOK() ? C.green : C.amber);
    L(285, 'FUSS-SPERRE', s.sw.footLock ? 'FREI' : 'GESPERRT', s.sw.footLock ? C.green : C.amber);
    L(320, 'GANGART', GAITS[s.sw.gait].name);
    L(355, 'GESCHW', `${(w.speed * 3.6).toFixed(1)} KM/H`);
    L(390, 'FAHRHEBEL', `${Math.round(s.sw.throttle * 100)} %`);
    L(425, 'NOT-AUS', s.sw.estop ? 'AKTIV' : 'BEREIT', s.sw.estop ? C.red : C.green);
    L(470, 'BEREIT', w.canWalk ? 'JA' : 'NEIN', w.canWalk ? C.green : C.amber);
    if (a.calibrating) {
      const joints = ['HÜFTE L', 'HÜFTE R', 'KNIE L', 'KNIE R', 'FUSS L', 'FUSS R'];
      const j = Math.min(5, Math.floor(a.cal * 6));
      this.t(`TEST ${joints[j]}`, 360, 520, C.amber, 20, 'left', 700);
    }
    if (a.msg) this.t(a.msg, S / 2, 590, C.amber, 18, 'center');
  }

  pageMELD(k, s) {
    this.header('MELDUNGEN');
    const log = s.log.slice(-15);
    log.forEach((m, i) => {
      const mm = Math.floor(m.t / 60), ss = Math.floor(m.t % 60);
      this.t(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, 40, 100 + i * 33, C.grey, 18);
      this.t(m.text, 120, 100 + i * 33, C.white, 18);
    });
    // active cautions
    let y = 100;
    if (!log.length) this.t('KEINE MELDUNGEN', this.S / 2, 300, C.grey, 20, 'center');
  }

  pageSICH(k, s) {
    this.header('SICHERUNGEN');
    BREAKERS.forEach(([id, l, a], i) => {
      const col = i < 10 ? 0 : 1, row = i % 10;
      const x = 60 + col * 290, y = 100 + row * 44;
      const on = s.cb[id];
      this.t(l, x, y, on ? C.white : C.amber, 19);
      this.t(on ? 'DRIN' : 'GEZOGEN', x + 240, y, on ? C.green : C.amber, 18, 'right', 700);
    });
  }
}

// Annunciator (caution/warning light) panel drawn on one canvas
export class Annunciator {
  constructor(cols, rows, cellW, cellH) {
    Object.assign(this, { cols, rows, cellW, cellH });
    this.px = 128;
    const W = Math.round(cols * this.px), H = Math.round(rows * this.px * cellH / cellW);
    this.cMap = makeCanvas(W, H); this.cEm = makeCanvas(W, H);
    this.texMap = canvasTex(this.cMap); this.texEm = canvasTex(this.cEm);
    this.levels = {};
    this.state = '';
  }
  build() {
    const M = materials();
    const w = this.cols * this.cellW, h = this.rows * this.cellH;
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new RoundedBoxGeometry(w + 0.012, h + 0.012, 0.014, 2, 0.003), M.bezel);
    housing.position.z = 0.007; g.add(housing);
    this.mat = new THREE.MeshStandardMaterial({ map: this.texMap, emissiveMap: this.texEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
    face.position.z = 0.0142; g.add(face);
    // grid dividers
    for (let i = 1; i < this.cols; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.0012, h, 0.002), M.black);
      d.position.set(-w / 2 + i * this.cellW, 0, 0.0148); g.add(d);
    }
    for (let j = 1; j < this.rows; j++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0012, 0.002), M.black);
      d.position.set(0, -h / 2 + j * this.cellH, 0.0148); g.add(d);
    }
    this.group = g;
    this.redraw(new Set(), false, true);
    return g;
  }
  redraw(active, test, force) {
    const s = G.sim;
    const key = [...active].join() + (test ? 'T' : '') + (s.P.ann ? 'P' : '');
    if (!force && key === this.state) return;
    this.state = key;
    const list = s.warn.list.length ? s.warn.list : [];
    const k = this.cMap.getContext('2d'), e = this.cEm.getContext('2d');
    const cw = this.cMap.width / this.cols, ch = this.cMap.height / this.rows;
    k.fillStyle = '#101112'; k.fillRect(0, 0, this.cMap.width, this.cMap.height);
    e.fillStyle = '#000'; e.fillRect(0, 0, this.cEm.width, this.cEm.height);
    list.forEach(([id, label, kind], i) => {
      if (i >= this.cols * this.rows) return;
      const cx = (i % this.cols + 0.5) * cw, cy = (Math.floor(i / this.cols) + 0.5) * ch;
      const lines = label.split('\n');
      const size = ch * (lines.length > 1 ? 0.3 : 0.36);
      for (const [ctx, lit] of [[k, false], [e, true]]) {
        ctx.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const on = s.P.ann && (active.has(id) || test);
        if (lit && !on) continue;
        const col = kind === 'w' ? '#ff2a1a' : kind === 'a' ? '#36ff7a' : '#ffae00';
        ctx.fillStyle = lit ? col : '#3a3b3c';
        lines.forEach((ln, j) => ctx.fillText(ln, cx, cy + (j - (lines.length - 1) / 2) * size * 1.1));
      }
    });
    this.texMap.needsUpdate = true; this.texEm.needsUpdate = true;
  }
  update(dt) {
    const s = G.sim;
    this.redraw(s.warn.active, s.warn.lampTest, false);
    this.mat.emissiveIntensity = s.P.ann ? 2.4 * s.P.lightV : 0;
  }
}
