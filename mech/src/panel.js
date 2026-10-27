// Panels and physical controls. Panel-local coordinates are meters, origin at the panel
// center, +x right, +y "up" on the face, +z out of the face towards the pilot.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  G, materials, makeCanvas, canvasTex, sharedTextures, noiseCanvas, FONT_LABEL, clamp, DEG, rng, TAU, approach,
} from './util.js';

const PAINT = '#e7e3d6';      // engraved label paint
export const LEGEND_LIGHT = new THREE.Color(1.0, 0.78, 0.52); // integral lighting colour (warm white)

let grimeCache = null;
function grime() {
  if (!grimeCache) grimeCache = noiseCanvas(256, { seed: 41, scale: 6, oct: 5, contrast: 1.2, bias: 0.5, scratches: 160 });
  return grimeCache;
}

// ---------------------------------------------------------------- Panel
export class Panel {
  constructor({ id, title = '', w, h, ppm = 2600, color = '#2a2e31', depth = 0.008, fasteners = true, titleSide = 'top' }) {
    Object.assign(this, { id, title, w, h, ppm, color, depth, fasteners, titleSide });
    this.cmds = [];
    this.controls = [];
    this.group = new THREE.Group();
    this.group.name = 'panel:' + id;
  }

  text(str, x, y, o = {}) { this.cmds.push({ t: 'text', str, x, y, ...o }); return this; }
  line(x1, y1, x2, y2, o = {}) { this.cmds.push({ t: 'line', x1, y1, x2, y2, ...o }); return this; }
  // grouping bracket with a title notch, typical for aircraft panels
  box(x, y, w, h, label = '', o = {}) { this.cmds.push({ t: 'box', x, y, w, h, label, ...o }); return this; }
  rect(x, y, w, h, o = {}) { this.cmds.push({ t: 'rect', x, y, w, h, ...o }); return this; }
  stripes(x, y, w, h) { this.cmds.push({ t: 'stripes', x, y, w, h }); return this; }

  add(ctrl, x, y, rot = 0) {
    ctrl.panel = this;
    ctrl.group.position.set(x, y, 0);
    ctrl.group.rotation.z = rot;
    this.group.add(ctrl.group);
    this.controls.push(ctrl);
    ctrl.decorate?.(this, x, y);
    return ctrl;
  }

  build() {
    const { w, h, ppm } = this;
    const cw = Math.ceil(w * ppm), ch = Math.ceil(h * ppm);
    const col = makeCanvas(cw, ch), emi = makeCanvas(cw, ch);
    const c = col.getContext('2d'), e = emi.getContext('2d');
    const R = rng(this.id.length * 131 + cw);
    // base paint
    c.fillStyle = this.color; c.fillRect(0, 0, cw, ch);
    c.globalAlpha = 0.1; c.globalCompositeOperation = 'overlay';
    const g = grime();
    for (let yy = 0; yy < ch; yy += 256) for (let xx = 0; xx < cw; xx += 256) c.drawImage(g, xx, yy);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    // edge wear: lighter rim + darker grime band
    const edge = c.createLinearGradient(0, 0, 0, ch);
    edge.addColorStop(0, 'rgba(255,255,255,0.06)'); edge.addColorStop(0.03, 'rgba(0,0,0,0)');
    edge.addColorStop(0.97, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = edge; c.fillRect(0, 0, cw, ch);
    // finger wear spots around controls
    for (const ctl of this.controls) {
      const [x, y] = [this.px(ctl.group.position.x), this.py(ctl.group.position.y)];
      const r = 0.02 * ppm * (0.8 + R() * 0.6);
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch);

    if (this.title) this.cmds.unshift({ t: 'text', str: this.title, x: 0, y: h / 2 - 0.009, size: 0.0058, weight: 700, spacing: 0.0009 });
    for (const cmd of this.cmds) this.draw(c, e, cmd);

    const mapT = canvasTex(col, true), emT = canvasTex(emi, true);
    const T = sharedTextures();
    const front = new THREE.MeshStandardMaterial({
      map: mapT, emissiveMap: emT, emissive: LEGEND_LIGHT.clone(), emissiveIntensity: 0,
      roughness: 0.78, metalness: 0.12, roughnessMap: T.coarse,
    });
    G.panelMats.push(front);
    const M = materials();
    const geo = new THREE.BoxGeometry(w, h, this.depth);
    geo.translate(0, 0, -this.depth / 2 + 0.0004);
    const plate = new THREE.Mesh(geo, [M.panelSide, M.panelSide, M.panelSide, M.panelSide, front, M.panelSide]);
    plate.receiveShadow = true; plate.castShadow = true;
    plate.userData.panel = this;
    this.plate = plate;
    this.group.add(plate);

    if (this.fasteners) {
      const inset = 0.0075;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        this.group.add(fastener(sx * (w / 2 - inset), sy * (h / 2 - inset), R() * TAU));
      }
      if (h > 0.2) for (const sx of [-1, 1]) this.group.add(fastener(sx * (w / 2 - inset), 0, R() * TAU));
    }
    for (const ctl of this.controls) ctl.build?.();
    return this.group;
  }

  px(x) { return (x + this.w / 2) * this.ppm; }
  py(y) { return (this.h / 2 - y) * this.ppm; }

  draw(c, e, d) {
    const S = this.ppm;
    const both = (fn) => { fn(c, PAINT); fn(e, '#fff'); };
    if (d.t === 'text') {
      const size = (d.size || 0.0036) * S;
      both((k, color) => {
        k.save();
        k.fillStyle = d.color && k === c ? d.color : color;
        if (d.color && k === e) k.fillStyle = d.emis || '#fff';
        k.font = `${d.weight || 600} ${size}px ${FONT_LABEL}`;
        k.textAlign = d.align || 'center'; k.textBaseline = 'middle';
        if ('letterSpacing' in k) k.letterSpacing = `${(d.spacing || 0.0004) * S}px`;
        const lines = String(d.str).split('\n');
        lines.forEach((ln, i) => k.fillText(ln, this.px(d.x), this.py(d.y) + (i - (lines.length - 1) / 2) * size * 1.05));
        k.restore();
      });
    } else if (d.t === 'line') {
      both((k, color) => {
        k.strokeStyle = color; k.lineWidth = (d.width || 0.0006) * S; k.lineCap = 'round';
        k.beginPath(); k.moveTo(this.px(d.x1), this.py(d.y1)); k.lineTo(this.px(d.x2), this.py(d.y2)); k.stroke();
      });
    } else if (d.t === 'box') {
      // bracket: corners + top line with gap for the label
      const x0 = this.px(d.x - d.w / 2), x1 = this.px(d.x + d.w / 2), y0 = this.py(d.y + d.h / 2), y1 = this.py(d.y - d.h / 2);
      const size = (d.size || 0.0034) * S;
      both((k, color) => {
        k.save();
        k.strokeStyle = color; k.fillStyle = color; k.lineWidth = 0.0006 * S;
        k.font = `700 ${size}px ${FONT_LABEL}`; k.textAlign = 'center'; k.textBaseline = 'middle';
        if ('letterSpacing' in k) k.letterSpacing = `${0.0005 * S}px`;
        const tw = d.label ? k.measureText(d.label).width + size * 0.8 : 0;
        const mx = (x0 + x1) / 2;
        k.beginPath();
        k.moveTo(mx - tw / 2, y0); k.lineTo(x0, y0); k.lineTo(x0, y1 - 0.0 * S);
        if (!d.open) { k.lineTo(x1, y1); }
        else { k.moveTo(x1, y1); }
        k.lineTo(x1, y0); k.lineTo(mx + tw / 2, y0);
        k.stroke();
        if (d.label) k.fillText(d.label, mx, y0);
        k.restore();
      });
    } else if (d.t === 'rect') {
      c.fillStyle = d.fill || '#111'; c.fillRect(this.px(d.x - d.w / 2), this.py(d.y + d.h / 2), d.w * S, d.h * S);
      if (d.emis) { e.fillStyle = d.emis; e.fillRect(this.px(d.x - d.w / 2), this.py(d.y + d.h / 2), d.w * S, d.h * S); }
    } else if (d.t === 'stripes') {
      c.save();
      c.beginPath(); c.rect(this.px(d.x - d.w / 2), this.py(d.y + d.h / 2), d.w * S, d.h * S); c.clip();
      c.fillStyle = '#d6a800'; c.fillRect(this.px(d.x - d.w / 2), this.py(d.y + d.h / 2), d.w * S, d.h * S);
      c.fillStyle = '#111';
      const st = 0.006 * S;
      for (let i = -20; i < 60; i++) {
        const x = this.px(d.x - d.w / 2) + i * st * 2;
        c.beginPath(); c.moveTo(x, this.py(d.y + d.h / 2)); c.lineTo(x + st, this.py(d.y + d.h / 2));
        c.lineTo(x + st - d.h * S, this.py(d.y - d.h / 2)); c.lineTo(x - d.h * S, this.py(d.y - d.h / 2)); c.fill();
      }
      c.restore();
    }
  }
}

// Dzus-style quarter-turn fastener
let fastGeo = null;
function fastener(x, y, rot) {
  const M = materials();
  if (!fastGeo) {
    fastGeo = new THREE.CylinderGeometry(0.0042, 0.0046, 0.0016, 20).rotateX(Math.PI / 2).translate(0, 0, 0.0008);
  }
  const g = new THREE.Group();
  const head = new THREE.Mesh(fastGeo, M.darkSteel);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0062, 0.0009, 0.0006), M.black);
  slot.position.z = 0.0015; slot.rotation.z = rot;
  g.add(head, slot);
  g.position.set(x, y, 0);
  return g;
}

// ---------------------------------------------------------------- base control
export class Control {
  constructor(o) {
    this.o = o;
    this.id = o.id || o.key;
    this.name = o.name || this.id;
    this.key = o.key;
    this.group = new THREE.Group();
    this.picks = [];
    this.value = this.read();
  }
  read() {
    if (this.o.cb) return G.sim.cb[this.o.cb];
    if (this.key != null) return G.sim.sw[this.key];
    return this.o.value ?? 0;
  }
  write(v) {
    if (this.o.cb) G.sim.cb[this.o.cb] = v;
    else if (this.key != null) G.sim.sw[this.key] = v;
  }
  addPick(m) { m.userData.control = this; this.picks.push(m); return m; }
  set(v) {
    if (v === this.value) return false;
    this.value = v; this.write(v);
    this.o.onChange?.(v, this);
    return true;
  }
  sync() { const v = this.read(); if (v !== undefined && v !== this.value) this.value = v; }
  interact() { }
  update() { }
  tip() { return { title: this.name, state: '' }; }
}

// ---------------------------------------------------------------- toggle switch
let toggleGeo = null;
function toggleGeos() {
  if (toggleGeo) return toggleGeo;
  const pts = [];
  pts.push(new THREE.Vector2(0.0, 0));
  pts.push(new THREE.Vector2(0.0029, 0));
  pts.push(new THREE.Vector2(0.0027, 0.004));
  pts.push(new THREE.Vector2(0.0019, 0.017));
  pts.push(new THREE.Vector2(0.0018, 0.019));
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0, Math.cos(a) * 0.0026), 0.0205 + Math.sin(a) * 0.0026));
  }
  const handle = new THREE.LatheGeometry(pts, 18).rotateX(Math.PI / 2);
  toggleGeo = {
    handle,
    nut: new THREE.CylinderGeometry(0.0066, 0.0066, 0.0022, 6).rotateX(Math.PI / 2).translate(0, 0, 0.0011),
    washer: new THREE.CylinderGeometry(0.0075, 0.0075, 0.0006, 24).rotateX(Math.PI / 2).translate(0, 0, 0.0003),
    bushing: new THREE.CylinderGeometry(0.0042, 0.0042, 0.0075, 16).rotateX(Math.PI / 2).translate(0, 0, 0.0055),
    pivotCap: new THREE.SphereGeometry(0.0034, 16, 8, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2),
    pick: new THREE.BoxGeometry(0.024, 0.042, 0.032).translate(0, 0, 0.016),
  };
  return toggleGeo;
}

export class Toggle extends Control {
  // o.positions: labels from bottom to top, e.g. ['AUS','EIN'] or ['AUS','EIN','START']
  // o.momentary: index that springs back to o.springTo
  // o.guard: true → red flip guard, closing it forces o.guardSafe (0)
  constructor(o) {
    super(o);
    this.n = o.positions.length;
    this.ang = this.angleFor(this.value);
    this.guardOpen = o.guard ? (this.value !== (o.guardSafe ?? 0)) : true;
    this.guardAng = this.guardOpen ? 1 : 0;
  }
  angleFor(v) {
    const T = 24 * DEG;
    if (this.n === 2) return v ? -T : T;
    return v === 0 ? T : v === 1 ? 0 : -T;
  }
  build() {
    const M = materials(), g = toggleGeos();
    const nut = new THREE.Mesh(g.nut, M.steel);
    const washer = new THREE.Mesh(g.washer, M.darkSteel);
    const bush = new THREE.Mesh(g.bushing, M.steel);
    this.pivot = new THREE.Group();
    this.pivot.position.z = 0.0092;
    const handle = new THREE.Mesh(g.handle, M.chrome);
    handle.castShadow = true;
    const cap = new THREE.Mesh(g.pivotCap, M.steel);
    this.pivot.add(handle, cap);
    this.group.add(washer, nut, bush, this.pivot);
    // optional lock-ring tab
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.004, 0.0012), M.darkSteel);
    tab.position.set(0, 0.0085, 0.0006); this.group.add(tab);
    this.addPick(new THREE.Mesh(g.pick, M.pick));
    this.group.add(this.picks[0]);
    if (this.o.guard) this.buildGuard();
  }
  buildGuard() {
    const M = materials();
    const mat = this.o.guardColor === 'black' ? M.black : M.red;
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.019, 0.004);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.021, 0.039, 0.0018, 2, 0.0008), mat);
    top.position.set(0, -0.0195, 0.031);
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.039, 0.031), mat);
    s1.position.set(-0.0097, -0.0195, 0.0155);
    const s2 = s1.clone(); s2.position.x = 0.0097;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.021, 0.0016, 0.01), mat);
    lip.position.set(0, -0.0385, 0.026);
    for (const m of [top, s1, s2, lip]) { m.castShadow = true; hinge.add(m); }
    // hinge base bracket
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.006, 0.006), M.darkSteel);
    base.position.set(0, 0.019, 0.003);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.026, 8).rotateZ(Math.PI / 2), M.steel);
    pin.position.set(0, 0.019, 0.004);
    this.group.add(base, pin, hinge);
    this.guard = hinge;
    const gp = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.044, 0.008), M.pick);
    gp.position.set(0, -0.02, 0.031);
    gp.userData.isGuard = true;
    hinge.add(this.addPick(gp));
  }
  decorate(p, x, y) {
    const pos = this.o.positions;
    const s = this.o.labelSize || 0.0037;
    if (this.o.label) p.text(this.o.label, x, y + (this.o.guard ? 0.0335 : 0.0315), { size: this.o.titleSize || 0.0043, weight: 700 });
    if (this.n === 2) {
      p.text(pos[1], x, y + 0.0205, { size: s });
      p.text(pos[0], x, y - 0.0205, { size: s });
    } else {
      p.text(pos[2], x, y + 0.0205, { size: s });
      p.text(pos[1], x + 0.0125, y, { size: s, align: 'left' });
      p.text(pos[0], x, y - 0.0205, { size: s });
    }
    if (this.o.guard) p.stripes(x, y - 0.026, 0.026, 0.004);
  }
  interact(ev) {
    if (ev.type === 'down') {
      if (this.o.guard) {
        if (this.guardOpen && ev.button === 2) {
          this.guardOpen = false;
          const safe = this.o.guardSafe ?? 0;
          if (this.value !== safe) { this.set(safe); G.audio?.click('toggle'); }
          G.audio?.click('guard');
          return;
        }
        if (!this.guardOpen) { this.guardOpen = true; G.audio?.click('guard'); return; }
      }
      // two-position switches simply flip; three-position ones use the clicked side (right click = down)
      let dir = this.n === 2 ? (this.value ? -1 : 1) : ev.button === 2 ? -1 : ((ev.sy ?? ev.local.y) > 0 ? 1 : -1);
      this.move(dir);
      this.held = true;
    } else if (ev.type === 'up') {
      this.held = false;
      if (this.o.momentary != null && this.value === this.o.momentary) { this.set(this.o.springTo ?? this.o.momentary - 1); G.audio?.click('release'); }
    } else if (ev.type === 'wheel') {
      if (this.o.guard && !this.guardOpen) return;
      if (this.o.momentary != null && this.value + ev.dir === this.o.momentary) return; // no wheel into spring position
      this.move(ev.dir);
    }
  }
  move(dir) {
    const v = clamp(this.value + dir, 0, this.n - 1);
    if (this.set(v)) G.audio?.click('toggle');
  }
  update(dt) {
    this.sync();
    if (this.o.guard && this.value !== (this.o.guardSafe ?? 0)) this.guardOpen = true;
    this.ang = approach(this.ang, this.angleFor(this.value), 45, dt);
    this.pivot.rotation.x = this.ang;
    if (this.guard) {
      this.guardAng = approach(this.guardAng, this.guardOpen ? 1 : 0, 18, dt);
      this.guard.rotation.x = -this.guardAng * 105 * DEG;
    }
  }
  tip() {
    let state = this.o.positions[this.value];
    if (this.o.guard) state += this.guardOpen ? '  ·  Kappe offen (Rechtsklick: schließen)' : '  ·  Kappe zu (Klick: öffnen)';
    return { title: this.name, state };
  }
}

// ---------------------------------------------------------------- illuminated push button
function legendCanvas(text, w, h, lit) {
  const px = 256;
  const c = makeCanvas(px, Math.round(px * h / w));
  const k = c.getContext('2d');
  k.fillStyle = lit ? '#000' : '#16181a'; k.fillRect(0, 0, c.width, c.height);
  const lines = text.split('\n');
  const size = Math.min(c.height / (lines.length * 1.25 + 0.4), px * 0.22);
  k.font = `700 ${size}px ${FONT_LABEL}`;
  k.textAlign = 'center'; k.textBaseline = 'middle';
  if ('letterSpacing' in k) k.letterSpacing = `${size * 0.06}px`;
  k.fillStyle = lit ? '#fff' : '#3d3f40';
  lines.forEach((ln, i) => k.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
  if (!lit) { // subtle "dead front" lens texture
    k.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < c.height; y += 3) k.fillRect(0, y, c.width, 1);
  }
  return c;
}

export class Korry extends Control {
  // o.legends: [{text, color, lit:()=>bool|number}] top→bottom; o.mode: 'momentary'|'latch'|'action'
  constructor(o) {
    super(o);
    this.size = o.size || [0.019, 0.019];
    this.pressed = false;
    this.depth = 0;
  }
  build() {
    const M = materials();
    const [w, h] = this.size;
    const bez = new THREE.Mesh(new RoundedBoxGeometry(w + 0.005, h + 0.005, 0.006, 2, 0.0012), M.bezel);
    bez.position.z = 0.003; bez.castShadow = true;
    this.group.add(bez);
    this.cap = new THREE.Group();
    this.cap.position.z = 0.0062;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004), M.black);
    body.position.z = -0.0005;
    this.cap.add(body);
    this.halves = [];
    const L = this.o.legends;
    const hh = h / L.length;
    L.forEach((lg, i) => {
      const map = canvasTex(legendCanvas(lg.text, w, hh, false));
      const em = canvasTex(legendCanvas(lg.text, w, hh, true));
      const mat = new THREE.MeshStandardMaterial({
        map, emissiveMap: em, emissive: new THREE.Color(lg.color || '#fff'), emissiveIntensity: 0,
        roughness: 0.25, metalness: 0.0,
      });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, hh * 0.94), mat);
      pl.position.set(0, h / 2 - hh * (i + 0.5), 0.0016);
      this.cap.add(pl);
      this.halves.push({ mat, lg, level: 0 });
    });
    // separator line between halves
    if (L.length > 1) {
      const sep = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0006, 0.0008), M.black);
      sep.position.z = 0.0017; this.cap.add(sep);
    }
    this.group.add(this.cap);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(w + 0.006, h + 0.006, 0.014), M.pick);
    pick.position.z = 0.006;
    this.group.add(this.addPick(pick));
  }
  decorate(p, x, y) {
    if (this.o.label) p.text(this.o.label, x, y + this.size[1] / 2 + 0.008, { size: this.o.titleSize || 0.0039, weight: 700 });
  }
  interact(ev) {
    if (ev.type === 'down') {
      this.pressed = true;
      G.audio?.click('push');
      if (this.o.mode === 'latch') this.set(this.value ? 0 : 1);
      else if (this.o.mode === 'momentary') this.set(1);
      this.o.onPress?.(this);
    } else if (ev.type === 'up') {
      if (this.pressed) G.audio?.click('release');
      this.pressed = false;
      if (this.o.mode === 'momentary') this.set(0);
      this.o.onRelease?.(this);
    }
  }
  update(dt) {
    this.sync();
    this.depth = approach(this.depth, this.pressed ? 1 : 0, 40, dt);
    this.cap.position.z = 0.0062 - this.depth * 0.0018;
    const s = G.sim;
    const pw = s.P.ess ? s.P.lightV : 0;
    const test = s.warn.lampTest && s.P.ess;
    for (const hf of this.halves) {
      let on = hf.lg.lit ? hf.lg.lit(this) : 0;
      on = typeof on === 'number' ? on : on ? 1 : 0;
      if (test) on = 1;
      const target = on * pw * (hf.lg.gain || 2.6);
      // incandescent lamp lag
      hf.level = approach(hf.level, target, 14, dt);
      hf.mat.emissiveIntensity = hf.level;
    }
  }
  tip() {
    const st = this.o.state ? this.o.state(this) : (this.o.mode === 'latch' ? (this.value ? 'EIN' : 'AUS') : '');
    return { title: this.name, state: st };
  }
}

// ---------------------------------------------------------------- rotary selector
export class Rotary extends Control {
  // o.positions labels; o.step deg between positions; o.style 'pointer'|'round'
  constructor(o) {
    super(o);
    this.n = o.positions.length;
    this.stepDeg = o.step || 40;
    this.ang = this.angleFor(this.value);
  }
  angleFor(v) { return -(((v - (this.n - 1) / 2) * this.stepDeg) + (this.o.offset || 0)) * DEG; }
  build() {
    const M = materials();
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.0035, 36).rotateX(Math.PI / 2), M.black);
    skirt.position.z = 0.00175;
    this.knob = new THREE.Group();
    this.knob.add(skirt);
    const idx = new THREE.Mesh(new THREE.BoxGeometry(0.0013, 0.006, 0.0006), M.white);
    idx.position.set(0, 0.0085, 0.0036);
    this.knob.add(idx);
    if ((this.o.style || 'pointer') === 'pointer') {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(0.0085, 0.026, 0.011, 3, 0.0025), M.black);
      bar.position.set(0, 0.002, 0.0085); bar.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.011, 0.0006), M.white);
      stripe.position.set(0, 0.0085, 0.0143);
      this.knob.add(bar, stripe);
    } else {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.009, 0.011, 24).rotateX(Math.PI / 2), M.black);
      k.position.z = 0.009; k.castShadow = true;
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.005, 0.0006), M.white);
      dot.position.set(0, 0.0055, 0.0148);
      this.knob.add(k, dot);
    }
    this.group.add(this.knob);
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16).rotateX(Math.PI / 2), M.pick);
    pick.position.z = 0.01;
    this.group.add(this.addPick(pick));
  }
  decorate(p, x, y) {
    const r = this.o.radius || 0.0205;
    for (let i = 0; i < this.n; i++) {
      const a = (i - (this.n - 1) / 2) * this.stepDeg + (this.o.offset || 0);
      const s = Math.sin(a * DEG), c = Math.cos(a * DEG);
      p.line(x + s * 0.0135, y + c * 0.0135, x + s * 0.0165, y + c * 0.0165, { width: 0.0007 });
      const lx = x + s * r, ly = y + c * r;
      const align = Math.abs(s) < 0.3 ? 'center' : s > 0 ? 'left' : 'right';
      p.text(this.o.positions[i], lx + (align === 'left' ? -0.001 : align === 'right' ? 0.001 : 0), ly, { size: this.o.labelSize || 0.0035, align });
    }
    if (this.o.label) p.text(this.o.label, x, y - (this.o.labelBelow || 0.025), { size: this.o.titleSize || 0.0042, weight: 700 });
  }
  interact(ev) {
    let dir = 0;
    if (ev.type === 'down') dir = ev.button === 2 ? -1 : ((ev.sx ?? ev.local.x) >= 0 ? 1 : -1);
    else if (ev.type === 'wheel') dir = ev.dir;
    if (!dir) return;
    const v = clamp(this.value + dir, 0, this.n - 1);
    if (this.set(v)) G.audio?.click('detent');
  }
  update(dt) {
    this.sync();
    this.ang = approach(this.ang, this.angleFor(this.value), 30, dt);
    this.knob.rotation.z = this.ang;
  }
  tip() { return { title: this.name, state: this.o.positions[this.value] }; }
}

// ---------------------------------------------------------------- continuous knob (dimmer)
export class Knob extends Control {
  constructor(o) {
    super(o);
    this.ang = this.angleFor(this.value);
  }
  angleFor(v) { return -(-135 + 270 * v) * DEG; }
  build() {
    const M = materials();
    this.knob = new THREE.Group();
    const r = this.o.r || 0.0085;
    const k = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.012, 28).rotateX(Math.PI / 2), M.black);
    k.position.z = 0.006; k.castShadow = true;
    const ridges = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.07, r * 1.07, 0.006, 28, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.4, metalness: 0.3, wireframe: false }));
    ridges.position.z = 0.004;
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.0012, r * 0.6, 0.0006), M.white);
    dot.position.set(0, r * 0.6, 0.0122);
    this.knob.add(k, ridges, dot);
    this.group.add(this.knob);
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.8, r * 1.8, 0.02, 16).rotateX(Math.PI / 2), M.pick);
    pick.position.z = 0.01;
    this.group.add(this.addPick(pick));
  }
  decorate(p, x, y) {
    const r = 0.0145;
    for (let i = 0; i <= 10; i++) {
      const a = (-135 + 27 * i) * DEG;
      const l = i % 5 === 0 ? 0.004 : 0.0022;
      p.line(x + Math.sin(a) * r, y + Math.cos(a) * r, x + Math.sin(a) * (r + l), y + Math.cos(a) * (r + l), { width: 0.0006 });
    }
    const [lo, hi] = this.o.ends || ['AUS', 'HELL'];
    p.text(lo, x - 0.016, y - 0.016, { size: 0.0033, align: 'right' });
    p.text(hi, x + 0.016, y - 0.016, { size: 0.0033, align: 'left' });
    if (this.o.label) p.text(this.o.label, x, y + 0.025, { size: this.o.titleSize || 0.0042, weight: 700 });
  }
  interact(ev) {
    let d = 0;
    if (ev.type === 'down') d = (ev.button === 2 ? -1 : ((ev.sx ?? ev.local.x) >= 0 ? 1 : -1)) * 0.1;
    else if (ev.type === 'wheel') d = ev.dir * 0.05;
    if (!d) return;
    const v = clamp(Math.round((this.value + d) * 100) / 100, 0, 1);
    if (this.set(v)) G.audio?.click('detent');
  }
  update(dt) {
    this.sync();
    this.ang = approach(this.ang, this.angleFor(this.value), 25, dt);
    this.knob.rotation.z = this.ang;
  }
  tip() { return { title: this.name, state: `${Math.round(this.value * 100)} %` }; }
}

// ---------------------------------------------------------------- circuit breaker
export class Breaker extends Control {
  constructor(o) { super(o); this.out = this.value ? 0 : 1; }
  build() {
    const M = materials();
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.0025, 6).rotateX(Math.PI / 2), M.darkSteel);
    collar.position.z = 0.00125;
    this.btn = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.008, 16).rotateX(Math.PI / 2), M.black);
    stem.position.z = 0.002;
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(0.00345, 0.00345, 0.0028, 16).rotateX(Math.PI / 2), M.white);
    this.band.position.z = 0.0014;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0037, 0.0037, 0.0015, 16).rotateX(Math.PI / 2), M.black);
    top.position.z = 0.0062;
    this.btn.add(stem, this.band, top);
    this.group.add(collar, this.btn);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.016, 0.014), M.pick);
    pick.position.z = 0.007;
    this.group.add(this.addPick(pick));
  }
  decorate(p, x, y) {
    p.text(this.o.label || this.name, x, y + 0.011, { size: 0.0031, weight: 700 });
    p.text(String(this.o.amps), x, y - 0.0098, { size: 0.0031 });
  }
  interact(ev) {
    if (ev.type !== 'down') return;
    this.set(this.value ? 0 : 1);
    G.audio?.click('breaker');
  }
  update(dt) {
    this.sync();
    this.out = approach(this.out, this.value ? 0 : 1, 30, dt);
    this.btn.position.z = this.out * 0.0045;
  }
  tip() { return { title: `Sicherung ${this.o.label} (${this.o.amps} A)`, state: this.value ? 'DRIN' : 'GEZOGEN' }; }
}

// ---------------------------------------------------------------- round push button (unlit)
export class PushButton extends Control {
  constructor(o) { super(o); this.pressed = false; this.depth = 0; }
  build() {
    const M = materials();
    const r = this.o.r || 0.0065;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.5, 0.003, 28).rotateX(Math.PI / 2), M.darkSteel);
    ring.position.z = 0.0015;
    this.cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.006, 28).rotateX(Math.PI / 2), this.o.color === 'red' ? M.red : M.black);
    this.cap.position.z = 0.004; this.cap.castShadow = true;
    this.group.add(ring, this.cap);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(r * 3.4, r * 3.4, 0.014), M.pick);
    pick.position.z = 0.007;
    this.group.add(this.addPick(pick));
  }
  decorate(p, x, y) {
    if (this.o.label) p.text(this.o.label, x, y + (this.o.r || 0.0065) * 1.5 + 0.0055, { size: this.o.titleSize || 0.0032, weight: 700 });
  }
  interact(ev) {
    if (ev.type === 'down') { this.pressed = true; G.audio?.click('push'); this.o.onPress?.(); }
    if (ev.type === 'up') { if (this.pressed) G.audio?.click('release'); this.pressed = false; this.o.onRelease?.(); }
  }
  update(dt) {
    this.depth = approach(this.depth, this.pressed ? 1 : 0, 40, dt);
    this.cap.position.z = 0.004 - this.depth * 0.002;
  }
  tip() { return { title: this.name, state: this.o.stateText ? this.o.stateText() : '' }; }
}

// ---------------------------------------------------------------- analog gauge
export function dialFace(o) {
  // o: {size, min, max, a0, a1, major, minor, labels:[values], title, unit, arcs:[{from,to,color}], fmt}
  const S = o.px || 512;
  const c = makeCanvas(S, S), e = makeCanvas(S, S);
  const k = c.getContext('2d'), m = e.getContext('2d');
  k.fillStyle = '#0d0e0f'; k.fillRect(0, 0, S, S);
  m.fillStyle = '#000'; m.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  const ang = (v) => (o.a0 + (v - o.min) / (o.max - o.min) * (o.a1 - o.a0)) * DEG;
  const both = (fn) => { fn(k, '#ecebe4'); fn(m, '#fff'); };
  for (const arc of o.arcs || []) {
    for (const ctx of [k, m]) {
      ctx.strokeStyle = arc.color; ctx.lineWidth = S * 0.035;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, ang(arc.from) - Math.PI / 2, ang(arc.to) - Math.PI / 2); ctx.stroke();
    }
  }
  both((ctx, col) => {
    ctx.strokeStyle = col; ctx.fillStyle = col;
    if (o.minor) for (let v = o.min; v <= o.max + 1e-6; v += o.minor) {
      const a = ang(v) - Math.PI / 2;
      ctx.lineWidth = S * 0.008;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      ctx.lineTo(cx + Math.cos(a) * R * 0.99, cy + Math.sin(a) * R * 0.99); ctx.stroke();
    }
    for (let v = o.min; v <= o.max + 1e-6; v += o.major) {
      const a = ang(v) - Math.PI / 2;
      ctx.lineWidth = S * 0.016;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84);
      ctx.lineTo(cx + Math.cos(a) * R * 0.99, cy + Math.sin(a) * R * 0.99); ctx.stroke();
    }
    ctx.font = `600 ${S * 0.1}px ${FONT_LABEL}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const v of o.labels || []) {
      const a = ang(v) - Math.PI / 2;
      ctx.fillText(o.fmt ? o.fmt(v) : String(v), cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68);
    }
    ctx.font = `700 ${S * 0.085}px ${FONT_LABEL}`;
    if (o.title) ctx.fillText(o.title, cx, cy + R * (o.titleY ?? 0.38));
    ctx.font = `500 ${S * 0.07}px ${FONT_LABEL}`;
    if (o.unit) ctx.fillText(o.unit, cx, cy + R * (o.unitY ?? 0.55));
  });
  return { c, e };
}

export class Gauge extends Control {
  // o.r radius (m), o.face {c,e} canvases, o.needles [{value:()=>v, min,max,a0,a1, len, color}], o.read()=>string
  constructor(o) { super(o); this.vals = (o.needles || []).map(() => 0); }
  build() {
    const M = materials();
    const r = this.o.r;
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, r * 0.09, 10, 48), M.black);
    bezel.position.z = 0.0055;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.12, 0.003, 48).rotateX(Math.PI / 2), M.bezel);
    body.position.z = 0.0015;
    // mounting screws
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0015, 12).rotateX(Math.PI / 2), M.darkSteel);
      s.position.set(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 0.0008);
      this.group.add(s);
    }
    const mat = new THREE.MeshStandardMaterial({
      map: canvasTex(this.o.face.c), emissiveMap: canvasTex(this.o.face.e),
      emissive: LEGEND_LIGHT.clone(), emissiveIntensity: 0, roughness: 0.6,
    });
    G.gaugeMats.push(mat);
    this.faceMat = mat;
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
    face.position.z = 0.0033;
    this.face = face;
    this.group.add(body, bezel, face);
    this.needles = [];
    for (const nd of this.o.needles || []) {
      const len = r * (nd.len || 0.82);
      const shape = new THREE.Shape();
      const wd = r * (nd.width || 0.045);
      shape.moveTo(-wd, -r * 0.18); shape.lineTo(wd, -r * 0.18); shape.lineTo(wd * 0.55, len); shape.lineTo(0, len + wd); shape.lineTo(-wd * 0.55, len); shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      const nm = new THREE.MeshStandardMaterial({ color: nd.color || 0xf2f0e8, emissive: new THREE.Color(nd.color || 0xf2f0e8), emissiveIntensity: 0, roughness: 0.5 });
      G.gaugeMats.push(nm);
      const needle = new THREE.Mesh(geo, nm);
      needle.position.z = 0.0042 + this.needles.length * 0.0005;
      this.group.add(needle);
      this.needles.push(needle);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.08, 0.002, 16).rotateX(Math.PI / 2), M.black);
    hub.position.z = 0.0058;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.0, 48), M.glass);
    glass.position.z = 0.0082;
    this.group.add(hub, glass);
    this.o.extra?.(this);
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.01, 16).rotateX(Math.PI / 2), M.pick);
    pick.position.z = 0.005;
    this.group.add(this.addPick(pick));
  }
  update(dt) {
    (this.o.needles || []).forEach((nd, i) => {
      const v = clamp(nd.value(), nd.min, nd.max);
      this.vals[i] = approach(this.vals[i], v, nd.damp || 6, dt);
      const a = (nd.a0 + (this.vals[i] - nd.min) / (nd.max - nd.min) * (nd.a1 - nd.a0)) * DEG;
      this.needles[i].rotation.z = -a;
    });
    this.o.onUpdate?.(this, dt);
  }
  tip() { return { title: this.name, state: this.o.read ? this.o.read() : '' }; }
}
