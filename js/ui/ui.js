// Editor UI: category rail, searchable control panel, toolbar, camera shortcuts.

import * as THREE from 'three';
import { el, slider, chips, toggle, color, section, hint } from './controls.js';
import { icon } from './icons.js';
import { MODIFIER_GROUPS, EXPRESSION_UNITS, EXPRESSION_PRESETS } from '../core/modifiers.js';
import { ageInYears } from '../core/human.js';
import { BONE_SHAPES } from '../core/character.js';
import { POSE_LIST } from '../core/poses.js';
import { LIGHT_PRESETS } from '../render/environment.js';
import { HAIR_STYLES } from '../hair/generate.js';
import { BEARD_STYLES } from '../core/regions.js';
import { hairColor } from '../hair/hairMaterial.js';
import { History, getState, setState, PRESETS, randomState } from '../state.js';

const CATS = [
  { id: 'presets', label: 'Vorlagen' },
  { id: 'body', label: 'Körper' },
  { id: 'shape', label: 'Rumpf' },
  { id: 'limbs', label: 'Glied­maßen' },
  { id: 'bones', label: 'Skelett' },
  { id: 'head', label: 'Kopf' },
  { id: 'face', label: 'Gesicht' },
  { id: 'expr', label: 'Mimik' },
  { id: 'skin', label: 'Haut' },
  { id: 'makeup', label: 'Make-up' },
  { id: 'eyes', label: 'Augen' },
  { id: 'hair', label: 'Frisur' },
  { id: 'beard', label: 'Bart & Brauen' },
  { id: 'clothes', label: 'Kleidung' },
  { id: 'scene', label: 'Pose & Licht' },
];

const HAIR_COLORS = [
  ['Schwarz', 9, 0.3], ['Dunkelbraun', 5, 0.5], ['Braun', 3, 0.6], ['Hellbraun', 1.8, 0.7], ['Dunkelblond', 1.1, 0.6],
  ['Blond', 0.55, 0.45], ['Platin', 0.15, 0.1], ['Erdbeerblond', 0.5, 1.0], ['Rot', 0.4, 1.8], ['Kupfer', 0.9, 2.3],
];
const EYE_COLORS = [
  ['Dunkelbraun', '#2e1a0e', '#3a2414'], ['Braun', '#5a3b22', '#6b4a2b'], ['Haselnuss', '#7a5a2a', '#5d7a4a'],
  ['Grün', '#4f7a3a', '#6b8a4a'], ['Grau', '#7d8a94', '#9aa6ae'], ['Blau', '#3f6a8a', '#5c86a8'], ['Hellblau', '#7fa7c4', '#a9c4d8'],
  ['Bernstein', '#b07a22', '#8a5a12'], ['Violett', '#7a4ab0', '#a07ad0'], ['Rot', '#b01818', '#601010'], ['Gold', '#e0b030', '#b08010'],
];
const SKIN_TYPES = [['Typ I', 0.04], ['Typ II', 0.14], ['Typ III', 0.27], ['Typ IV', 0.42], ['Typ V', 0.62], ['Typ VI', 0.84]];

export function mountUI(app) {
  const ui = new EditorUI(app);
  window.ui = ui;
  return ui;
}

class EditorUI {
  constructor(app) {
    this.app = app;
    this.H = app.character.human;
    this.history = new History(app);
    this.sym = true;
    this.extreme = false;
    this.cat = 'body';
    this.ctx = { extreme: false, onCommit: () => this.history.commit() };
    this.rows = [];
    this._build();
    this.history.listeners.add(() => this._updateToolbar());
    app.on((t) => {
      if (t === 'geometry') this._updateInfo();
      if (t === 'state') this.refresh();
      if (t === 'hair' || t === 'geometry') this._updateBusy();
    });
    setInterval(() => this._updateBusy(), 400);
    addEventListener('resize', () => setTimeout(() => this._updateInset(), 50));
    this._updateInset();
    // a manual orbit/zoom ends the preset framing
    app.controls.addEventListener('start', () => { this.camMode = null; this.camButtons.forEach((b) => b.classList.remove('active')); });
    const q = new URLSearchParams(location.search);
    // frame the body once it has its final shape (after the first frames and once all
    // morph targets have streamed in), unless the user already moved the camera
    if (!q.has('c') && !q.has('cam')) {
      this.camMode = 'full';
      this._refit(true);
      app.on((t) => { if (t === 'targets' && this.camMode === 'full') this._refit(true); });
    }
    this.select(this.cat);
    this._updateToolbar();
    this._updateInfo();
  }

  // ------------------------------------------------------------------ shell
  _build() {
    const root = el('div', 'ui-root');
    this.root = root;
    document.getElementById('app').append(root);

    // toolbar
    const tb = el('div', 'toolbar');
    const btn = (name, title, fn, cls = '') => {
      const b = el('button', cls, icon(name));
      b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', fn);
      tb.append(b);
      return b;
    };
    this.bUndo = btn('undo', 'Rückgängig', () => this.history.undo());
    this.bRedo = btn('redo', 'Wiederholen', () => this.history.redo());
    tb.append(el('div', 'sep'));
    btn('dice', 'Zufälliger Charakter', () => this.randomize(false));
    this.bSym = btn('sym', 'Symmetrie', () => { this.sym = !this.sym; this._updateToolbar(); this.select(this.cat); this.toast(this.sym ? 'Symmetrie an: linke und rechte Seite gekoppelt' : 'Symmetrie aus: Seiten einzeln einstellbar'); });
    this.bExt = btn('infinity', 'Über die Grenzen (Extrem-Modus)', () => {
      this.extreme = !this.extreme; this.ctx.extreme = this.extreme;
      this.root.classList.toggle('extreme', this.extreme);
      this._updateToolbar(); this.select(this.cat);
      this.toast(this.extreme ? 'Extrem-Modus: Regler gehen weit über realistische Werte hinaus' : 'Realistischer Bereich');
    }, 'ext');
    tb.append(el('div', 'sep'));
    btn('camera', 'Foto speichern', () => this.screenshot());
    btn('save', 'Charakter exportieren (Datei)', () => this.exportFile());
    btn('load', 'Charakter importieren (Datei)', () => this.importFile());
    tb.append(el('div', 'sep'));
    this.bSpin = btn('spin', 'Drehteller', () => { this.app.controls.autoRotate = !this.app.controls.autoRotate; this.app.controls.autoRotateSpeed = 1.2; this._updateToolbar(); });
    btn('hide', 'Oberfläche ausblenden', () => { this.root.classList.add('ui-hidden'); this._updateInset(); });
    root.append(tb);
    const show = el('button', 'showui', icon('show'));
    show.addEventListener('click', () => { this.root.classList.remove('ui-hidden'); this._updateInset(); });
    root.append(show);

    // info chip
    this.info = el('div', 'infochip', '<span class="dot"></span><span class="txt"></span>');
    root.append(this.info);

    // camera chips
    const cam = el('div', 'camchips');
    this.camButtons = [['full', 'Ganzkörper'], ['upper', 'Oberkörper'], ['face', 'Gesicht'], ['eyes', 'Augen'], ['back', 'Rücken']].map(([id, label]) => {
      const b = el('button', '', label);
      b.addEventListener('click', () => this.cameraTo(id));
      cam.append(b);
      return b;
    });
    root.append(cam);

    // panel
    const panel = el('div', 'panel');
    const rail = el('div', 'rail');
    this.railButtons = {};
    for (const c of CATS) {
      const b = el('button', '', icon(c.id) + `<span>${c.label}</span>`);
      b.addEventListener('click', () => this.select(c.id));
      rail.append(b);
      this.railButtons[c.id] = b;
    }
    const content = el('div', 'content');
    const head = el('div', 'content-head');
    this.title = el('div', 'content-title');
    this.sub = el('div', 'content-sub');
    const search = el('div', 'search', icon('search'));
    this.searchInput = el('input');
    this.searchInput.placeholder = 'Regler suchen … (z. B. Nase, Lippen, Locken)';
    this.searchInput.addEventListener('input', () => this._search());
    search.append(this.searchInput);
    head.append(this.title, this.sub, search);
    this.scroll = el('div', 'scroll');
    content.append(head, this.scroll);
    panel.append(rail, content);
    root.append(panel);
    this.panel = panel;
    this.toastEl = el('div', 'toast');
    root.append(this.toastEl);
    this._welcome();
  }

  _welcome() {
    let seen = false;
    try { seen = localStorage.getItem('koerper-editor:welcome') === '1'; } catch { /* private mode */ }
    const q = new URLSearchParams(location.search);
    if (seen || q.has('ui') || q.has('acc')) return;
    const card = el('div', 'welcome', `
      <div class="w-title">Willkommen im Körper-Editor</div>
      <div class="w-grid">
        <div><b>1 Finger</b><span>Figur drehen</span></div>
        <div><b>2 Finger</b><span>Zoomen & verschieben</span></div>
        <div><b>Regler</b><span>seitlich ziehen – weiter weg vom Regler = feiner</span></div>
        <div><b>Doppeltipp</b><span>auf einen Regler setzt ihn zurück</span></div>
        <div><b>∞-Taste</b><span>Regler weit über die Realität hinaus</span></div>
        <div><b>Würfel</b><span>Zufälliger Charakter</span></div>
      </div>
      <button class="btn primary">Los geht's</button>`);
    card.querySelector('button').addEventListener('click', () => {
      card.remove();
      try { localStorage.setItem('koerper-editor:welcome', '1'); } catch { /* ignore */ }
    });
    this.root.append(card);
  }

  _updateInset() {
    if (this.root.classList.contains('ui-hidden')) { this.app.setViewInset(0, 0); return; }
    const r = this.panel.getBoundingClientRect();
    const portrait = innerHeight > innerWidth;
    if (portrait) this.app.setViewInset(0, innerHeight - r.top);
    else this.app.setViewInset(innerWidth - r.left, 0);
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  _updateToolbar() {
    this.bUndo.disabled = !this.history.canUndo;
    this.bRedo.disabled = !this.history.canRedo;
    this.bSym.classList.toggle('on', this.sym);
    this.bExt.classList.toggle('on', this.extreme);
    this.bSpin.classList.toggle('on', !!this.app.controls.autoRotate);
  }

  _updateInfo() {
    const ch = this.app.character;
    const h = ch.height;
    const age = ageInYears(ch.human.macros.age);
    this.stats = `${(h * 100).toFixed(0)} cm · ${age < 2 ? age.toFixed(1) : Math.round(age)} Jahre`;
    this.info.querySelector('.txt').textContent = this._busy ? 'Haare werden berechnet …' : this.stats;
    if (this.cat === 'body') this.sub.textContent = this.stats;
  }

  _updateBusy() {
    const busy = this.app.hair.busyNow;
    if (busy !== this._busy) {
      this._busy = busy;
      this.info.classList.toggle('busy', busy);
      this._updateInfo();
    }
  }

  select(id) {
    this.cat = id;
    for (const [k, b] of Object.entries(this.railButtons)) b.classList.toggle('active', k === id);
    const c = CATS.find((x) => x.id === id);
    this.title.textContent = c.label.replace('­', '');
    this.sub.textContent = '';
    this.scroll.innerHTML = '';
    this.rows = [];
    const sections = this['cat_' + id]();
    this.scroll.append(...sections);
    this.scroll.scrollTop = 0;
    this.rows = [...this.scroll.querySelectorAll('.row, .chips, .toggle-row, .color-row')];
    if (id === 'body') this.sub.textContent = this.stats || '';
    this._search();
  }

  refresh() {
    for (const r of this.rows) r.render?.();
    this._updateInfo();
  }

  _search() {
    const q = this.searchInput.value.trim().toLowerCase();
    if (q && !this._searchAll) {
      // search across all categories
      this._searchAll = true;
      this.scroll.innerHTML = '';
      const all = [];
      for (const c of CATS) {
        if (c.id === 'presets') continue;
        for (const s of this['cat_' + c.id]()) all.push(s);
      }
      this.scroll.append(...all);
      this.rows = [...this.scroll.querySelectorAll('.row, .chips, .toggle-row, .color-row')];
    } else if (!q && this._searchAll) {
      this._searchAll = false;
      this.select(this.cat);
      return;
    }
    for (const s of this.scroll.querySelectorAll('.section')) {
      let any = false;
      for (const r of s.querySelectorAll('.row, .chips, .toggle-row, .color-row')) {
        const hit = !q || (r.dataset.search || '').includes(q) || s.dataset.title.includes(q);
        r.style.display = hit ? '' : 'none';
        any = any || hit;
      }
      s.style.display = any ? '' : 'none';
      if (q) s.classList.remove('closed');
    }
  }

  // --------------------------------------------------------------- helpers
  S(def) { return slider(def, this.ctx); }

  macro(name, label, opts = {}) {
    const H = this.H;
    return this.S({
      label, min: opts.min ?? 0, max: opts.max ?? 1, emin: opts.emin ?? -0.5, emax: opts.emax ?? 1.5, def: opts.def ?? 0.5,
      get: () => H.macros[name], set: (v) => { H.setMacro(name, v); this.app.requestRender(); if (opts.after) opts.after(); },
      fmt: opts.fmt || ((v) => Math.round(v * 100) + ' %'),
    });
  }

  modGroup(groupId, open = true) {
    const H = this.H;
    const mods = H.modList.filter((m) => m.group === groupId);
    const rows = [];
    for (const m of mods) {
      const two = !m.oneSided;
      const rng = two ? { min: -1, max: 1, emin: -2.5, emax: 2.5, def: 0 } : { min: 0, max: 1, emin: 0, emax: 2.5, def: 0 };
      if (m.side === 'r') continue;
      if (m.side === 'l') {
        const base = m.label.replace(' (L)', '');
        if (this.sym) {
          rows.push(this.S({ ...rng, label: base, get: () => H.getModifier(m.id), set: (v) => { H.setModifier(m.id, v); H.setModifier(m.pair, v); } }));
        } else {
          rows.push(this.S({ ...rng, label: base + ' links', get: () => H.getModifier(m.id), set: (v) => H.setModifier(m.id, v) }));
          rows.push(this.S({ ...rng, label: base + ' rechts', get: () => H.getModifier(m.pair), set: (v) => H.setModifier(m.pair, v) }));
        }
      } else {
        rows.push(this.S({ ...rng, label: m.label, get: () => H.getModifier(m.id), set: (v) => H.setModifier(m.id, v) }));
      }
    }
    const g = MODIFIER_GROUPS.find((x) => x.id === groupId);
    return section(g ? g.label : 'Asymmetrie', rows, { open, count: rows.length });
  }

  skinS(key, label, min = 0, max = 1, emin, emax, fmt) {
    const a = this.app;
    return this.S({ label, min, max, emin: emin ?? min, emax: emax ?? max, def: undefined, get: () => a.skin[key], set: (v) => a.setSkin({ [key]: v }), fmt });
  }
  skinC(key, label) { const a = this.app; return color({ label, get: () => a.skin[key], set: (v) => a.setSkin({ [key]: v }) }, this.ctx); }

  eyeS(key, label, min = 0, max = 1, emin, emax) {
    const a = this.app;
    return this.S({ label, min, max, emin: emin ?? min, emax: emax ?? max, def: undefined, get: () => a.eyeParams[key], set: (v) => a.setEyes({ [key]: v }) });
  }
  eyeC(key, label) { const a = this.app; return color({ label, get: () => a.eyeParams[key], set: (v) => a.setEyes({ [key]: v }) }, this.ctx); }

  hairS(path, label, min, max, emin, emax, fmt, def) {
    const hs = this.app.hair;
    const get = () => path.split('.').reduce((o, k) => o[k], hs.params);
    const set = (v) => {
      const keys = path.split('.');
      const obj = {};
      let cur = obj;
      keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = v; else cur = cur[k] = {}; });
      hs.set(obj);
    };
    return this.S({ label, min, max, emin: emin ?? min, emax: emax ?? max, def: def ?? undefined, get, set, fmt });
  }

  // ------------------------------------------------------------- categories
  cat_presets() {
    const a = this.app;
    const grid = el('div', 'grid');
    for (const p of Object.values(PRESETS)) {
      const t = el('button', 'tile', `<span class="ic">${p.icon}</span><span>${p.label}</span>`);
      t.addEventListener('click', () => {
        setState(a, { ...getState(a), human: { macros: {}, mods: {}, expression: {} }, bones: {}, ...JSON.parse(JSON.stringify(p.s)) });
        this.history.commit();
        this._refit();
        this.toast(`Vorlage „${p.label}" geladen`);
      });
      grid.append(t);
    }
    const btns = el('div', 'btns');
    const b1 = el('button', 'btn primary', 'Zufall realistisch');
    b1.addEventListener('click', () => this.randomize(false));
    const b2 = el('button', 'btn ext', 'Zufall extrem');
    b2.addEventListener('click', () => this.randomize(true));
    const b3 = el('button', 'btn', 'Alles zurücksetzen');
    b3.addEventListener('click', () => { setState(a, { human: { macros: {}, mods: {}, expression: {} }, bones: {}, pose: 'relaxed' }); this.history.commit(); });
    const b4 = el('button', 'btn', 'Im Browser speichern');
    b4.addEventListener('click', () => this.saveLocal());
    btns.append(b1, b2, b3, b4);
    const saved = el('div', 'saved');
    this._renderSaved(saved);
    return [
      section('Vorlagen', [grid, hint('Tippe auf eine Vorlage als Ausgangspunkt – alles lässt sich danach frei verändern.')]),
      section('Generieren', [btns]),
      section('Gespeicherte Charaktere', [saved, hint('Charaktere werden lokal auf diesem Gerät gespeichert. Für ein Backup: Export über das Pfeil-Symbol oben.')]),
    ];
  }

  cat_body() {
    const ageFmt = (v) => { const y = ageInYears(Math.max(0, v)); return v < 0 ? 'Säugling+' : (y < 2 ? y.toFixed(1) : Math.round(y)) + ' J.' + (v > 1 ? '+' : ''); };
    const gFmt = (v) => (v <= 0.02 ? 'weiblich' : v >= 0.98 ? 'männlich' : Math.round(v * 100) + ' % ♂') + (v < 0 || v > 1 ? ' ⁺' : '');
    return [
      section('Grundform', [
        this.macro('gender', 'Geschlecht', { fmt: gFmt }),
        this.macro('age', 'Alter', { fmt: ageFmt, emin: -0.15, emax: 1.35 }),
        this.macro('muscle', 'Muskulatur'),
        this.macro('weight', 'Körperfett / Gewicht'),
        this.macro('height', 'Körpergröße', { fmt: () => `${Math.round(this.app.character.height * 100)} cm` }),
        this.macro('proportions', 'Proportionen (ideal ↔ ungewöhnlich)'),
      ]),
      section('Herkunft (Mischung)', [
        this.macro('african', 'Afrikanisch', { emin: 0, emax: 1, def: 1 / 3 }),
        this.macro('asian', 'Asiatisch', { emin: 0, emax: 1, def: 1 / 3 }),
        this.macro('caucasian', 'Europäisch', { emin: 0, emax: 1, def: 1 / 3 }),
        hint('Die drei Anteile ergeben zusammen immer 100 % und beeinflussen Gesichts- und Körperform. Den Hautton stellst du separat unter „Haut" ein.'),
      ]),
      section('Brust', [
        this.macro('breastSize', 'Brustgröße'),
        this.macro('breastFirmness', 'Festigkeit'),
      ]),
    ];
  }

  cat_shape() {
    return ['torso', 'breast', 'stomach', 'hip', 'buttocks', 'pelvis', 'measure', 'bodyshapes'].map((g, i) => this.modGroup(g, i < 2));
  }

  cat_limbs() {
    return ['arms', 'hands', 'legs', 'feet'].map((g) => this.modGroup(g, true));
  }

  cat_bones() {
    const ch = this.app.character;
    const rows = BONE_SHAPES.map((b) => this.S({
      label: b.label, min: 0.8, max: 1.25, emin: 0.35, emax: 2.4, def: 1,
      get: () => ch.boneShape[b.id] ?? 1, set: (v) => ch.setBoneShape(b.id, v),
      fmt: (v) => Math.round(v * 100) + ' %',
    }));
    const groups = [
      ['Schädel & Kiefer', rows.slice(0, 5)], ['Wirbelsäule & Rumpf', rows.slice(5, 12)],
      ['Arme & Hände', rows.slice(12, 18)], ['Beine & Füße', rows.slice(18)],
    ];
    return [
      section('Knochenbau', [hint('Skaliert die Knochen direkt im Skelett – Länge und Stärke. Im Extrem-Modus sind Proportionen weit jenseits des Menschlichen möglich.')]),
      ...groups.map(([t, r]) => section(t, r)),
    ];
  }

  cat_head() {
    return ['head', 'forehead', 'eyebrows', 'chin', 'cheek', 'neck'].map((g, i) => this.modGroup(g, i < 2));
  }

  cat_face() {
    return [...['eyes', 'nose', 'mouth', 'ears'].map((g, i) => this.modGroup(g, i < 1)), this.modGroup('asym', false)];
  }

  cat_expr() {
    const H = this.H;
    const a = this.app;
    this._exprInt = this._exprInt ?? 1;
    const presetChips = chips({
      label: 'Ausdruck',
      options: Object.entries(EXPRESSION_PRESETS).map(([id, p]) => ({ label: p.label, value: id })),
      get: () => this._exprPreset, set: (id) => {
        this._exprPreset = id;
        const u = {};
        for (const [k, v] of Object.entries(EXPRESSION_PRESETS[id].u)) u[k] = v * this._exprInt;
        H.setExpression(u);
        this.refresh();
      },
    }, this.ctx);
    const intensity = this.S({
      label: 'Intensität', min: 0, max: 1, emin: 0, emax: 2, def: 1, get: () => this._exprInt,
      set: (v) => {
        this._exprInt = v;
        if (this._exprPreset) {
          const u = {};
          for (const [k, x] of Object.entries(EXPRESSION_PRESETS[this._exprPreset].u)) u[k] = x * v;
          H.setExpression(u);
        }
      },
    });
    const units = EXPRESSION_UNITS.map(([u, label]) => this.S({
      label, min: 0, max: 1, emin: -1, emax: 2, def: 0,
      get: () => H.expression.get(u) || 0, set: (v) => { H.setExpressionUnit(u, v); this._exprPreset = null; },
    }));
    const gaze = chips({
      label: 'Blick', options: [{ label: 'Folgt der Kamera', value: 'camera' }, { label: 'Geradeaus', value: 'forward' }],
      get: () => a.gazeMode, set: (v) => { a.gazeMode = v; a.requestRender(); },
    }, this.ctx);
    const blink = toggle({ label: 'Natürliches Blinzeln', get: () => a.blinking, set: (v) => { a.blinking = v; } }, this.ctx);
    return [
      section('Gesichtsausdruck', [presetChips, intensity]),
      section('Blick & Leben', [gaze, blink]),
      section('Einzelne Muskeln', units, { open: false, count: units.length }),
    ];
  }

  cat_skin() {
    const a = this.app;
    const types = chips({ label: 'Hauttyp', options: SKIN_TYPES.map(([l, v]) => ({ label: l, value: v, color: '#' + skinPreview(v) })), get: () => a.skin.melanin, set: (v) => a.setSkin({ melanin: v }) }, this.ctx);
    const U = a.skinU;
    const shaderS = (u, label, min, max, emin, emax) => this.S({ label, min, max, emin, emax, def: undefined, get: () => U[u].value, set: (v) => { U[u].value = v; a.requestRender(); } });
    const rs = a.renderer.settings;
    return [
      section('Hautton', [
        types,
        this.skinS('melanin', 'Pigmentierung (Melanin)', 0, 1, 0, 1, (v) => Math.round(v * 100) + ' %'),
        this.skinS('hemo', 'Durchblutung / Rötung', 0, 1, -0.5, 2),
        this.skinS('undertone', 'Unterton (rosig ↔ golden)', -1, 1, -2, 2),
        this.skinS('flush', 'Wangenröte', 0, 1, 0, 2.5),
        this.skinS('mottle', 'Ungleichmäßigkeit', 0, 2, 0, 4),
      ]),
      section('Details', [
        this.skinS('freckles', 'Sommersprossen', 0, 1, 0, 1),
        this.skinS('freckleScale', 'Sommersprossen Größe', 0.4, 2, 0.2, 4),
        this.skinS('moles', 'Leberflecken', 0, 1, 0, 3),
        this.skinS('veins', 'Sichtbare Venen', 0, 1, 0, 2),
        this.skinS('spots', 'Altersflecken', 0, 1, 0, 2),
        this.skinS('wrinkles', 'Falten (zusätzlich zum Alter)', 0, 1, -0.5, 3),
        this.skinS('scars', 'Narben', 0, 1, 0, 2),
        this.skinS('tanLines', 'Bräunungsstreifen', 0, 1, 0, 1),
        shaderS('uPores', 'Poren', 0, 1.6, 0, 4),
        shaderS('uPoreSize', 'Porengröße', 0.0002, 0.00055, 0.0001, 0.002),
        this.skinS('seed', 'Variation (Zufallsmuster)', 0, 1, 0, 1),
      ]),
      section('Oberfläche & Licht', [
        this.skinS('oil', 'Glanz / Ölige Haut', 0, 1, 0, 2),
        this.skinS('rough', 'Rauheit', 0.3, 0.7, 0.15, 1),
        shaderS('uWet', 'Nass / Schweiß', 0, 1, 0, 1),
        this.S({ label: 'Lichtstreuung (Subsurface)', min: 0.001, max: 0.008, emin: 0, emax: 0.03, def: 0.0042, get: () => rs.sssWidth, set: (v) => { rs.sssWidth = v; a.requestRender(); }, fmt: (v) => (v * 1000).toFixed(1) + ' mm' }),
        shaderS('uTranslucency', 'Durchscheinen bei Gegenlicht', 0, 2, 0, 5),
      ]),
      section('Fantasie', [
        this.skinC('tint', 'Fantasiefarbe'),
        this.skinS('tintAmount', 'Fantasiefarbe Stärke', 0, 1, 0, 1),
        hint('Für Orks, Aliens, Elfen & Co.: färbt die Haut um und erhält dabei alle natürlichen Details.'),
      ]),
    ];
  }

  cat_makeup() {
    return [
      section('Lippen', [this.skinC('lipColor', 'Lippenstift'), this.skinS('lipAmount', 'Deckkraft'), this.skinS('lipGloss', 'Glanz'), this.skinS('lipTone', 'Natürliche Lippenfarbe', -1, 1, -2, 2)]),
      section('Augen', [this.skinC('shadowColor', 'Lidschatten'), this.skinS('shadowAmount', 'Lidschatten Stärke'), this.skinC('linerColor', 'Eyeliner'), this.skinS('linerAmount', 'Eyeliner Stärke')]),
      section('Teint', [this.skinC('blushColor', 'Rouge'), this.skinS('blushAmount', 'Rouge Stärke'), this.skinS('foundation', 'Foundation (ebenmäßig)')]),
      section('Nägel', [this.skinC('nailColor', 'Nagellack'), this.skinS('nailAmount', 'Deckkraft')]),
    ];
  }

  cat_eyes() {
    const a = this.app;
    const presets = chips({
      label: 'Augenfarbe', options: EYE_COLORS.map(([l, c1, c2]) => ({ label: l, value: [c1, c2], color: c1 })),
      get: () => [a.eyeParams.irisColor1, a.eyeParams.irisColor2], set: ([c1, c2]) => a.setEyes({ irisColor1: c1, irisColor2: c2 }),
    }, this.ctx);
    return [
      section('Iris', [
        presets, this.eyeC('irisColor1', 'Farbe innen'), this.eyeC('irisColor2', 'Farbe außen'),
        this.eyeS('irisMix', 'Farbverlauf'), this.eyeS('irisDetail', 'Struktur', 0, 1.5, 0, 3), this.eyeS('limbus', 'Dunkler Rand (Limbus)', 0, 1, 0, 2),
        this.eyeS('irisSize', 'Irisgröße', 0.85, 1.15, 0.5, 2.3), this.eyeS('seed', 'Muster-Variation'),
      ]),
      section('Pupille', [this.eyeS('pupil', 'Pupillengröße', 0.1, 0.8, 0, 1), this.eyeS('pupilShape', 'Form (rund ↔ Katzenauge)', 0, 0, 0, 1)]),
      section('Lederhaut', [this.eyeC('sclera', 'Farbe'), this.eyeS('scleraVeins', 'Äderchen', 0, 1, 0, 2), this.eyeS('glow', 'Leuchten', 0, 0, 0, 2)]),
      section('Verschiedenfarbig', [
        toggle({ label: 'Heterochromie (rechtes Auge anders)', get: () => a.eyeParams.heterochromia, set: (v) => a.setEyes({ heterochromia: v }) }, this.ctx),
        this.eyeC('irisColorR1', 'Rechts innen'), this.eyeC('irisColorR2', 'Rechts außen'),
      ]),
    ];
  }

  cat_hair() {
    const hs = this.app.hair;
    const styles = chips({
      label: 'Frisur', options: Object.entries(HAIR_STYLES).map(([id, s]) => ({ label: s.label, value: id })),
      get: () => hs.params.style, set: (v) => hs.set({ style: v }),
    }, this.ctx);
    const cols = chips({
      label: 'Haarfarbe', options: [...HAIR_COLORS.map(([l, e, p]) => ({ label: l, value: [e, p], color: '#' + hairColor(e, p).getHexString() })),
        { label: 'Grau', value: 'gray', color: '#9a9a96' }, { label: 'Weiß', value: 'white', color: '#e8e6e0' }],
      get: () => [hs.params.eumelanin, hs.params.pheomelanin],
      set: (v) => {
        if (v === 'gray') hs.set({ gray: 0.85 });
        else if (v === 'white') hs.set({ gray: 1, eumelanin: 0.1 });
        else hs.set({ eumelanin: v[0], pheomelanin: v[1], tipEu: v[0], tipPheo: v[1], gray: 0, dyeAmount: 0 });
      },
    }, this.ctx);
    const mm = (v) => (v * 100).toFixed(1) + ' cm';
    return [
      section('Frisur', [styles]),
      section('Form', [
        this.hairS('length', 'Länge', 0.3, 1.8, 0.05, 4, (v) => Math.round(v * 100) + ' %', 1),
        this.hairS('density', 'Dichte', 0.3, 1.5, 0.05, 2.5, null, 1),
        this.hairS('thickness', 'Haardicke', 0.6, 1.6, 0.2, 4, null, 1),
        this.hairS('volume', 'Volumen', 0, 1, 0, 3, null, 0.3),
        this.hairS('gravity', 'Schwerkraft', 0, 1.5, -1, 3, null, 1),
        this.hairS('part', 'Scheitel (links ↔ rechts)', -1, 1, -1, 1, null, 0),
        this.hairS('clump', 'Strähnigkeit', 0, 1.5, 0, 2, null, 1),
      ]),
      section('Struktur', [
        this.hairS('curlExtra', 'Locken (zusätzlich)', 0, 0.012, 0, 0.04, (v) => (v * 1000).toFixed(1) + ' mm', 0),
        this.hairS('curl', 'Lockenstärke der Frisur', 0, 2, 0, 4, null, 1),
        this.hairS('waveExtra', 'Wellen', 0, 1, 0, 3, null, 0),
        this.hairS('frizz', 'Frizz', 0, 2, 0, 6, null, 1),
        this.hairS('seed', 'Variation', 1, 50, 1, 200, (v) => Math.round(v), 1),
      ]),
      section('Farbe', [
        cols,
        this.hairS('eumelanin', 'Dunkelheit (Eumelanin)', 0, 10, 0, 12, (v) => v.toFixed(1), 3),
        this.hairS('pheomelanin', 'Rotanteil (Phäomelanin)', 0, 2.5, 0, 4, (v) => v.toFixed(2), 0.5),
        this.hairS('gray', 'Graue Haare', 0, 1, 0, 1, (v) => Math.round(v * 100) + ' %', 0),
        this.hairS('highlights', 'Strähnchen', 0, 0.6, 0, 1, null, 0),
        this.hairS('ombre', 'Farbverlauf zu den Spitzen', 0, 1, 0, 1, null, 0),
        this.hairS('tipEu', 'Spitzen Dunkelheit', 0, 10, 0, 12, (v) => v.toFixed(1), 3),
        this.hairS('tipPheo', 'Spitzen Rotanteil', 0, 2.5, 0, 4, (v) => v.toFixed(2), 0.5),
        color({ label: 'Färbung (Fantasiefarbe)', get: () => hs.params.dye, set: (v) => hs.set({ dye: v }) }, this.ctx),
        this.hairS('dyeAmount', 'Färbung Stärke', 0, 1, 0, 1, null, 0),
        this.hairS('shine', 'Glanz', 0, 1.6, 0, 3, null, 1),
      ]),
      section('Haaransatz', [
        this.hairS('hairline.hairline', 'Stirnhöhe', 0.035, 0.07, 0.02, 0.1, mm, 0.052),
        this.hairS('hairline.recession', 'Geheimratsecken', 0, 0.03, 0, 0.05, mm, 0),
        this.hairS('hairline.crown', 'Tonsur (Hinterkopf)', 0, 0.05, 0, 0.09, mm, 0),
        this.hairS('hairline.top', 'Lichtes Oberhaupt', 0, 1, 0, 1, null, 0),
        this.hairS('hairline.sideburns', 'Koteletten', -0.02, 0.025, -0.03, 0.05, mm, 0),
        this.hairS('hairline.nape', 'Nacken-Haaransatz', -0.02, 0.03, -0.04, 0.06, mm, 0),
        this.hairS('hairline.undercut', 'Seiten rasiert', 0, 1, 0, 1, null, 0),
      ], { open: false }),
    ];
  }

  cat_beard() {
    const hs = this.app.hair;
    const beards = chips({
      label: 'Bart', options: Object.entries(BEARD_STYLES).map(([id, s]) => ({ label: s.label, value: id })),
      get: () => hs.params.beardStyle, set: (v) => hs.set({ beardStyle: v }),
    }, this.ctx);
    const mm = (v) => (v * 1000).toFixed(1) + ' mm';
    return [
      section('Bart', [
        beards,
        this.hairS('beardLength', 'Bartlänge', 0.0008, 0.06, 0.0005, 0.25, mm, 0.002),
        this.hairS('beardDensity', 'Dichte', 0.2, 1.4, 0, 2.5, null, 1),
        this.hairS('beardEu', 'Farbe Dunkelheit', 0, 10, 0, 12, (v) => v.toFixed(1), 3),
        this.hairS('beardPheo', 'Farbe Rotanteil', 0, 2.5, 0, 4, (v) => v.toFixed(2), 0.6),
        this.hairS('beardGray', 'Grau', 0, 1, 0, 1, null, 0),
      ]),
      section('Augenbrauen', [
        this.hairS('brows.thickness', 'Breite', 0.5, 1.6, 0.1, 3, null, 1),
        this.hairS('brows.density', 'Dichte', 0, 1.5, 0, 2.5, null, 1),
        this.hairS('brows.arch', 'Bogen', 0, 1.8, -1, 4, null, 1),
        this.hairS('brows.length', 'Länge', 0.7, 1.3, 0.3, 2, null, 1),
        this.hairS('brows.gap', 'Abstand (Monobraue ↔ weit)', 0.2, 1.6, -0.6, 3, null, 1),
        this.hairS('brows.height', 'Höhe', -0.005, 0.005, -0.012, 0.015, mm, 0),
        this.hairS('brows.tilt', 'Neigung', -1, 1, -3, 3, null, 0),
        this.hairS('browLength', 'Haarlänge', 0.6, 1.6, 0.2, 4, null, 1),
        this.hairS('browEu', 'Farbe Dunkelheit', 0, 10, 0, 12, (v) => v.toFixed(1), 3.4),
        this.hairS('browPheo', 'Farbe Rotanteil', 0, 2.5, 0, 4, (v) => v.toFixed(2), 0.5),
      ]),
      section('Wimpern', [
        this.hairS('lashLength', 'Länge', 0.6, 1.5, 0.2, 3, null, 1),
        this.hairS('lashDensity', 'Dichte', 0.3, 1.5, 0, 3, null, 1),
        this.hairS('lashCurl', 'Schwung', 0, 2, -1, 4, null, 1),
        this.hairS('lashEu', 'Farbe Dunkelheit', 0, 10, 0, 12, (v) => v.toFixed(1), 8),
      ]),
      section('Körperbehaarung', [
        this.hairS('bodyHair.arms', 'Arme', 0, 1, 0, 2, null, 0.3),
        this.hairS('bodyHair.legs', 'Beine', 0, 1, 0, 2, null, 0.35),
        this.hairS('bodyHair.chest', 'Brust', 0, 1, 0, 2, null, 0),
        this.hairS('bodyHair.belly', 'Bauch', 0, 1, 0, 2, null, 0),
        this.hairS('bodyHair.back', 'Rücken', 0, 1, 0, 2, null, 0),
        this.hairS('bodyHair.fur', 'Fell (überall)', 0, 0, 0, 1.5, null, 0),
        this.hairS('bodyLength', 'Haarlänge', 0.5, 2, 0.2, 6, null, 1),
        this.hairS('bodyEu', 'Farbe Dunkelheit', 0, 10, 0, 12, (v) => v.toFixed(1), 2.5),
      ], { open: false }),
    ];
  }

  cat_clothes() {
    const c = this.app.clothing;
    if (!c) return [section('Kleidung', [hint('Kleidung wird geladen …')])];
    return c.uiSections(this);
  }

  cat_scene() {
    const a = this.app;
    const st = a.stage;
    const rs = a.renderer.settings;
    const poses = chips({ label: 'Pose', options: POSE_LIST.map((p) => ({ label: p.label, value: p.id })), get: () => a.character.poseId, set: (v) => a.character.setPose(v) }, this.ctx);
    const lights = chips({ label: 'Licht', options: Object.entries(LIGHT_PRESETS).map(([id, p]) => ({ label: p.label, value: id })), get: () => st.presetId, set: (v) => a.setLight(v) }, this.ctx);
    const tm = chips({ label: 'Farbwiedergabe', options: [{ label: 'AgX (filmisch)', value: 1 }, { label: 'Neutral', value: 2 }, { label: 'ACES', value: 3 }], get: () => rs.toneMap, set: (v) => { rs.toneMap = v; a.requestRender(); } }, this.ctx);
    const q = chips({ label: 'Qualität', options: [{ label: 'Ultra (100 %)', value: 1 }, { label: 'Hoch (85 %)', value: 0.85 }, { label: 'Ausgewogen (70 %)', value: 0.7 }], get: () => rs.scale, set: (v) => { rs.scale = v; a.autoQuality = false; a.resize(); } }, this.ctx);
    const rsS = (k, label, min, max, emin, emax, fmt) => this.S({ label, min, max, emin, emax, def: undefined, get: () => rs[k], set: (v) => { rs[k] = v; a.requestRender(); }, fmt });
    return [
      section('Pose', [poses]),
      section('Licht', [
        lights,
        this.S({ label: 'Lichtrichtung', min: -Math.PI, max: Math.PI, emin: -Math.PI, emax: Math.PI, def: 0, get: () => st.rotation, set: (v) => { st.envRotation(v); a.requestRender(); }, fmt: (v) => Math.round(v * 180 / Math.PI) + '°' }),
        this.S({ label: 'Lichtstärke', min: 0.3, max: 2, emin: 0, emax: 5, def: 1, get: () => st.intensity, set: (v) => { st.intensity = v; st.update(); a.requestRender(); } }),
        rsS('exposure', 'Belichtung', 0.5, 2, 0.1, 5, (v) => v.toFixed(2)),
        color({ label: 'Hintergrund', get: () => '#' + st.backdropMat.color.getHexString(THREE.SRGBColorSpace), set: (v) => { st.setBackground(v); a.requestRender(); } }, this.ctx),
      ]),
      section('Kamera', [
        this.S({ label: 'Brennweite', min: 20, max: 135, emin: 12, emax: 300, def: 50, get: () => 24 / Math.tan((a.camera.fov * Math.PI / 180) / 2) / 2, set: (v) => { a.camera.fov = 2 * Math.atan(12 / v) * 180 / Math.PI; a.camera.updateProjectionMatrix(); a.requestRender(); }, fmt: (v) => Math.round(v) + ' mm' }),
      ]),
      section('Bildlook', [
        tm,
        rsS('contrast', 'Kontrast', 0.85, 1.25, 0.5, 2),
        rsS('saturation', 'Sättigung', 0.6, 1.4, 0, 2.5),
        rsS('bloom', 'Glühen (Bloom)', 0, 0.2, 0, 1),
        rsS('vignette', 'Vignette', 0, 0.8, 0, 1.5),
        rsS('grain', 'Filmkorn', 0, 0.08, 0, 0.3),
        rsS('ca', 'Chromatische Aberration', 0, 1.5, 0, 6),
      ]),
      section('Darstellung', [
        q,
        chips({ label: 'Hauttextur', options: [{ label: 'Haut 2K', value: 2048 }, { label: 'Haut 4K', value: 4096 }], get: () => a.baker.size, set: (v) => { a.baker.resize(v); a.requestRender(); } }, this.ctx),
        chips({ label: 'Haardichte', options: [{ label: 'Haare 60 %', value: 0.6 }, { label: 'Haare 80 %', value: 0.8 }, { label: 'Haare 100 %', value: 1 }, { label: 'Haare 130 %', value: 1.3 }], get: () => a.hair.quality, set: (v) => { a.hair.quality = v; a.hair.set({ seed: a.hair.params.seed }); a.hair.dirtyKinds.add('scalp'); a.hair.dirtyKinds.add('beard'); } }, this.ctx),
        toggle({ label: 'Subsurface Scattering (Haut)', get: () => rs.sss, set: (v) => a.setSSS(v) }, this.ctx),
        toggle({ label: 'Umgebungsverdeckung (SSAO)', get: () => rs.ao, set: (v) => { rs.ao = v; a.requestRender(); } }, this.ctx),
        hint('Optimiert für iPad Pro (M4/M5). Bei „Ultra" wird in voller Retina-Auflösung mit 4×MSAA gerendert.'),
      ]),
    ];
  }

  // ------------------------------------------------------------- actions
  randomize(extreme) {
    setState(this.app, randomState(this.app, extreme));
    this._refit();
    this.history.commit();
    this.toast(extreme ? 'Extremer Zufallscharakter' : 'Neuer Zufallscharakter');
  }

  cameraTo(id, instant = false) {
    const a = this.app, ch = a.character;
    this.camMode = id;
    const head = ch.bonePos('head');
    const eyeY = (ch.eyeCenter.L[1] * 0.1 - ch.groundY);
    const h = ch.height;
    let pos, tgt, fov = 28;
    if (id === 'full') { tgt = [0, h * 0.53, 0]; pos = [0, h * 0.58, h * 2.75]; }
    else if (id === 'upper') { tgt = [0, head[1] - 0.12, 0.02]; pos = [0.15, head[1] - 0.05, 1.55]; }
    else if (id === 'face') { tgt = [0, eyeY - 0.025, 0.07]; pos = [0.08, eyeY - 0.005, 0.72]; }
    else if (id === 'eyes') { tgt = [0, eyeY, 0.1]; pos = [0.02, eyeY + 0.005, 0.36]; fov = 22; }
    else { tgt = [0, h * 0.53, 0]; pos = [0, h * 0.6, -h * 2.75]; }
    this.camButtons.forEach((b, i) => b.classList.toggle('active', ['full', 'upper', 'face', 'eyes', 'back'][i] === id));
    // the framings are made for an unobstructed view: move back so they fit into the part
    // of the screen the panel leaves free (in portrait the bottom sheet covers ~45 %)
    const k = this._fitScale();
    const P = new THREE.Vector3(...pos), T = new THREE.Vector3(...tgt);
    P.sub(T).multiplyScalar(k).add(T);
    if (instant) {
      a.camera.position.copy(P); a.controls.target.copy(T);
      a.camera.fov = fov; a.camera.updateProjectionMatrix(); a.controls.update(); a.requestRender();
    } else animateCamera(a, P, T, fov);
  }

  _fitScale() {
    const el = this.app.canvas.parentElement, w = el.clientWidth, h = el.clientHeight;
    const [r, b] = this.app.viewInset || [0, 0];
    const fv = Math.max(0.3, (h - b) / h);
    // and keep at least a 1:2 (width:height) visible area for the full figure
    const fh = Math.min(1, (w - r) / Math.max(1, (h - b) * 0.5));
    return 1 / (fv * fh);
  }

  /** Re-frame after the body changed a lot (presets, random); keeps the chosen framing. */
  _refit(instant = false) {
    let n = 0;
    const go = () => { if (++n < 3) requestAnimationFrame(go); else this.cameraTo(this.camMode || 'full', instant); };
    requestAnimationFrame(go);
  }

  async screenshot() {
    const a = this.app;
    this.toast('Foto wird erstellt …');
    await new Promise((r) => setTimeout(r, 30));
    a.captureFrame(16);
    const canvas = a.canvas;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const name = `koerper-editor-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Körper-Editor' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    downloadBlob(blob, name);
    this.toast('Bild gespeichert');
  }

  exportFile() {
    const blob = new Blob([JSON.stringify(getState(this.app), null, 1)], { type: 'application/json' });
    downloadBlob(blob, `charakter-${Date.now()}.json`);
    this.toast('Charakter exportiert');
  }

  importFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        setState(this.app, JSON.parse(await f.text()));
        this.history.commit();
        this.toast('Charakter geladen');
      } catch { this.toast('Datei konnte nicht gelesen werden'); }
    });
    inp.click();
  }

  saveLocal() {
    const a = this.app;
    a.captureFrame(6);
    const c = document.createElement('canvas');
    c.width = 180; c.height = 240;
    const src = a.canvas;
    const ar = src.width / src.height;
    const sw = ar > 0.75 ? src.height * 0.75 : src.width, sh = sw / 0.75;
    c.getContext('2d').drawImage(src, (src.width - sw) / 2 - (ar > 0.75 ? src.width * 0.12 : 0), (src.height - sh) / 2, sw, sh, 0, 0, 180, 240);
    const list = loadSaves();
    list.unshift({ name: `Charakter ${list.length + 1}`, date: Date.now(), thumb: c.toDataURL('image/jpeg', 0.7), state: getState(a) });
    try { localStorage.setItem('koerper-editor:saves', JSON.stringify(list.slice(0, 24))); this.toast('Im Browser gespeichert'); } catch { this.toast('Speicher voll – bitte exportieren'); }
    if (this.cat === 'presets') this.select('presets');
  }

  _renderSaved(container) {
    const list = loadSaves();
    if (!list.length) { container.append(hint('Noch nichts gespeichert.')); return; }
    list.forEach((s, i) => {
      const card = el('div', 'card', `<img src="${s.thumb}" alt=""><div class="nm">${s.name}</div><div class="del">×</div>`);
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          const l = loadSaves(); l.splice(i, 1);
          try { localStorage.setItem('koerper-editor:saves', JSON.stringify(l)); } catch { /* ignore */ }
          this.select('presets');
          return;
        }
        setState(this.app, s.state); this.history.commit(); this.toast(`„${s.name}" geladen`);
      });
      container.append(card);
    });
  }
}

function loadSaves() {
  try { return JSON.parse(localStorage.getItem('koerper-editor:saves') || '[]'); } catch { return []; }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function skinPreview(mel) {
  const c = [1.0 * Math.exp(-3.28 * Math.pow(mel, 1.4)), 0.66 * Math.exp(-3.79 * Math.pow(mel, 1.4)), 0.456 * Math.exp(-4.17 * Math.pow(mel, 1.4))];
  return new THREE.Color().setRGB(...c, THREE.LinearSRGBColorSpace).getHexString();
}

function animateCamera(app, pos, tgt, fov) {
  const cam = app.camera, ctl = app.controls;
  const p0 = cam.position.clone(), t0 = ctl.target.clone(), f0 = cam.fov;
  const start = performance.now(), dur = 700;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.position.lerpVectors(p0, pos, e);
    ctl.target.lerpVectors(t0, tgt, e);
    cam.fov = f0 + (fov - f0) * e;
    cam.updateProjectionMatrix();
    ctl.update();
    app.requestRender();
    if (t < 1) requestAnimationFrame(step);
  };
  step();
}
