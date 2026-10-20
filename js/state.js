// Character state: serialization, undo/redo, presets and the randomizer.

import { MACRO_DEFAULTS, EXPRESSION_PRESETS } from './core/modifiers.js';
import { SKIN_DEFAULTS } from './render/skinBake.js';
import { EYE_DEFAULTS } from './render/eyes.js';
import { HAIR_DEFAULTS } from './hair/hair.js';
import { HAIR_STYLES } from './hair/generate.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export function getState(app) {
  const ch = app.character;
  return {
    v: 1,
    human: ch.human.toJSON(),
    bones: { ...ch.boneShape },
    pose: ch.poseId,
    skin: { ...app.skin },
    eyes: { ...app.eyeParams },
    hair: clone(app.hair.params),
    clothing: app.clothing ? { ...app.clothing.params } : undefined,
  };
}

export function setState(app, s) {
  const ch = app.character;
  if (s.human) ch.human.fromJSON(s.human);
  ch.boneShape = { ...(s.bones || {}) };
  ch.poseDirty = true;
  if (s.pose) ch.setPose(s.pose);
  app.setSkin({ ...SKIN_DEFAULTS, ...(s.skin || {}) });
  app.setEyes({ ...EYE_DEFAULTS, ...(s.eyes || {}) });
  const h = clone(HAIR_DEFAULTS);
  if (s.hair) deepMerge(h, s.hair);
  app.hair.set(h);
  if (app.clothing) {
    const female = (s.human?.macros?.gender ?? 0.5) < 0.5;
    app.clothing.set(s.clothing || (female ? { top: 'bandeau', bottom: 'briefs' } : { top: 'none', bottom: 'boxers' }));
  }
  app.requestRender();
  app.emit('state');
}

function deepMerge(t, s) {
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deepMerge(t[k], v);
    else t[k] = v;
  }
}

export class History {
  constructor(app) {
    this.app = app;
    this.stack = [JSON.stringify(getState(app))];
    this.index = 0;
    this.listeners = new Set();
  }
  commit() {
    const s = JSON.stringify(getState(this.app));
    if (s === this.stack[this.index]) return;
    this.stack.length = this.index + 1;
    this.stack.push(s);
    if (this.stack.length > 120) this.stack.shift();
    this.index = this.stack.length - 1;
    this.autosave(s);
    this.notify();
  }
  undo() { if (this.index > 0) { this.index--; setState(this.app, JSON.parse(this.stack[this.index])); this.notify(); } }
  redo() { if (this.index < this.stack.length - 1) { this.index++; setState(this.app, JSON.parse(this.stack[this.index])); this.notify(); } }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
  notify() { for (const f of this.listeners) f(); }
  autosave(s) {
    try { localStorage.setItem('koerper-editor:autosave', s); } catch { /* storage unavailable */ }
  }
  static restore() {
    try { const s = localStorage.getItem('koerper-editor:autosave'); return s ? JSON.parse(s) : null; } catch { return null; }
  }
}

// ------------------------------------------------------------------- presets
const H = (o) => o;
export const PRESETS = {
  woman: {
    label: 'Frau', icon: '♀',
    s: { human: { macros: { ...MACRO_DEFAULTS, gender: 0.0, age: 0.48, muscle: 0.5, weight: 0.48, height: 0.55, proportions: 0.7, breastSize: 0.55, caucasian: 0.7, african: 0.1, asian: 0.2 },
      mods: { 'mouth/mouth-upperlip-volume|decr|incr': 0.3, 'mouth/mouth-lowerlip-volume|decr|incr': 0.25, 'nose/nose-scale-horiz|decr|incr': -0.15, 'chin/chin-width|decr|incr': -0.2, 'eyes/l-eye-scale|decr|incr': 0.04, 'eyes/r-eye-scale|decr|incr': 0.04, 'eyes/l-eye-height2|decr|incr': -0.2, 'eyes/r-eye-height2|decr|incr': -0.2 } },
      skin: { melanin: 0.2, hemo: 0.55, undertone: 0.05, freckles: 0.1, lipAmount: 0.15, lipColor: '#b34a55' },
      eyes: { irisColor1: '#5d7a4a', irisColor2: '#4f6d7a', irisMix: 0.5 },
      hair: H({ style: 'wavy', eumelanin: 2.2, pheomelanin: 0.9, tipEu: 1.4, tipPheo: 0.8, ombre: 0.4, length: 1.0, lashLength: 1.2, brows: { thickness: 0.8, arch: 1.25, density: 0.9 }, bodyHair: { arms: 0.06, legs: 0.03 } }) },
  },
  man: {
    label: 'Mann', icon: '♂',
    s: { human: { macros: { ...MACRO_DEFAULTS, gender: 1, age: 0.52, muscle: 0.58, weight: 0.52, height: 0.55, proportions: 0.7, caucasian: 0.6, african: 0.2, asian: 0.2 },
      mods: { 'chin/chin-width|decr|incr': 0.2, 'chin/chin-prominent|decr|incr': 0.2, 'eyebrows/eyebrows-trans|backward|forward': 0.2 } },
      skin: { melanin: 0.3, hemo: 0.52, undertone: 0.15 },
      eyes: { irisColor1: '#5a3b22', irisColor2: '#6b4a2b', irisMix: 0.3 },
      hair: H({ style: 'sidepart', eumelanin: 4.5, pheomelanin: 0.6, beardStyle: 'stubble', beardLength: 0.0018, beardEu: 4.5 }) },
  },
  athlete: {
    label: 'Athletin', icon: '🏃',
    s: { clothing: { top: 'bra', bottom: 'shorts', topColor: '#1d3b5c', bottomColor: '#1d3b5c', topRough: 0.55, bottomRough: 0.55 }, human: { macros: { ...MACRO_DEFAULTS, gender: 0.05, age: 0.45, muscle: 0.85, weight: 0.35, height: 0.62, proportions: 0.85, african: 0.75, caucasian: 0.15, asian: 0.1 } },
      skin: { melanin: 0.68, hemo: 0.5, undertone: 0.2 },
      eyes: { irisColor1: '#3a2414', irisColor2: '#4a2e18', irisMix: 0.2 },
      hair: H({ style: 'ponytail', eumelanin: 7, pheomelanin: 0.3, curl: 1, curlExtra: 0.004, length: 0.9 }) },
  },
  bodybuilder: {
    label: 'Bodybuilder', icon: '💪',
    s: { clothing: { top: 'none', bottom: 'briefs', bottomColor: '#111214' }, human: { macros: { ...MACRO_DEFAULTS, gender: 1, age: 0.5, muscle: 1.0, weight: 0.62, height: 0.6, proportions: 0.8 },
      mods: { 'torso/torso-vshape|decr|incr': 0.8, 'neck/neck-scale-horiz|decr|incr': 0.5, 'measure/measure-waist-circ|decr|incr': -0.4 } },
      skin: { melanin: 0.42, undertone: 0.3, oil: 1.0 },
      hair: H({ style: 'buzz', eumelanin: 5, beardStyle: 'boxed', beardLength: 0.008 }) },
  },
  elder_w: {
    label: 'Seniorin', icon: '👵',
    s: { clothing: { top: 'tshirt', bottom: 'leggings', topColor: '#8a6f7a', bottomColor: '#2e3036' }, human: { macros: { ...MACRO_DEFAULTS, gender: 0.0, age: 0.92, muscle: 0.35, weight: 0.6, height: 0.42, breastSize: 0.6, breastFirmness: 0.15 } },
      skin: { melanin: 0.15, spots: 1, wrinkles: 0.4, veins: 0.7 },
      eyes: { irisColor1: '#6a7f8f', irisColor2: '#8a9aa6', irisMix: 0.6, scleraVeins: 0.5, sclera: '#e6dccf' },
      hair: H({ style: 'bob', eumelanin: 2, gray: 0.92, length: 0.7, volume: 0.6 }) },
  },
  elder_m: {
    label: 'Senior', icon: '👴',
    s: { clothing: { top: 'tank', bottom: 'boxers', topColor: '#d9d6cf', bottomColor: '#3a4a5c' }, human: { macros: { ...MACRO_DEFAULTS, gender: 1, age: 0.95, muscle: 0.4, weight: 0.62, height: 0.45 } },
      skin: { melanin: 0.25, spots: 1, wrinkles: 0.5, veins: 0.6 },
      eyes: { irisColor1: '#4a5a66', irisColor2: '#6c7c88', irisMix: 0.5, scleraVeins: 0.6 },
      hair: H({ style: 'crew', eumelanin: 2, gray: 0.97, hairline: { recession: 0.025, crown: 0.035, top: 0.6 }, beardStyle: 'full', beardLength: 0.025, beardGray: 0.95 }) },
  },
  child: {
    label: 'Kind', icon: '🧒',
    s: { clothing: { top: 'tshirt', bottom: 'shorts', topColor: '#d9a43a', bottomColor: '#3c5a8a' }, human: { macros: { ...MACRO_DEFAULTS, gender: 0.5, age: 0.16, muscle: 0.5, weight: 0.5, height: 0.5 } },
      skin: { melanin: 0.22, freckles: 0.6, flush: 0.6, moles: 0.05 },
      eyes: { irisColor1: '#3f6a8a', irisColor2: '#5c86a8', irisMix: 0.6, pupil: 0.45 },
      hair: H({ style: 'textured', eumelanin: 1.0, pheomelanin: 0.5, length: 1.2 }) },
  },
  viking: {
    label: 'Wikinger', icon: '🪓',
    s: { clothing: { top: 'none', bottom: 'shorts', bottomColor: '#4a3626', bottomRough: 0.95, bottomSheen: 0.2 }, human: { macros: { ...MACRO_DEFAULTS, gender: 1, age: 0.6, muscle: 0.8, weight: 0.7, height: 0.8, caucasian: 1, african: 0, asian: 0 },
      mods: { 'chin/chin-width|decr|incr': 0.5, 'eyebrows/eyebrows-trans|backward|forward': 0.6, 'nose/nose-scale-vert|decr|incr': 0.3 } },
      skin: { melanin: 0.1, hemo: 0.65, flush: 0.8, freckles: 0.3, scars: 0.6 },
      eyes: { irisColor1: '#5f86a3', irisColor2: '#9fb7c7', irisMix: 0.7 },
      hair: H({ style: 'long', eumelanin: 0.6, pheomelanin: 1.3, length: 1.1, frizz: 2, wave: 1, waveExtra: 0.4, beardStyle: 'full', beardLength: 0.06, beardEu: 0.7, beardPheo: 1.4 }) },
  },
  elf: {
    label: 'Elfe', icon: '🧝',
    s: { clothing: { top: 'longsleeve', bottom: 'leggings', topColor: '#3e5a3a', bottomColor: '#2c3a2a', topSheen: 0.9 }, human: { macros: { ...MACRO_DEFAULTS, gender: 0.15, age: 0.45, muscle: 0.4, weight: 0.3, height: 0.8, proportions: 1 },
      mods: { 'ears/l-ear-shape|pointed|triangle': -1.8, 'ears/r-ear-shape|pointed|triangle': -1.8, 'ears/l-ear-scale-vert|decr|incr': 1.2, 'ears/r-ear-scale-vert|decr|incr': 1.2, 'ears/l-ear-rot|backward|forward': -0.8, 'ears/r-ear-rot|backward|forward': -0.8, 'eyes/l-eye-scale|decr|incr': 0.5, 'eyes/r-eye-scale|decr|incr': 0.5, 'cheek/l-cheek-bones|decr|incr': 0.8, 'cheek/r-cheek-bones|decr|incr': 0.8, 'chin/chin-width|decr|incr': -0.6 } },
      skin: { melanin: 0.05, hemo: 0.35, undertone: -0.3, tint: '#d8ecff', tintAmount: 0.12 },
      eyes: { irisColor1: '#7fd0c8', irisColor2: '#3d8a9a', irisMix: 0.8, glow: 0.15 },
      hair: H({ style: 'long', eumelanin: 0.1, pheomelanin: 0.08, length: 1.3, shine: 1.4 }) },
  },
  orc: {
    label: 'Ork', icon: '👹',
    s: { clothing: { top: 'none', bottom: 'shorts', bottomColor: '#3a2a1e', bottomRough: 0.95 }, human: { macros: { ...MACRO_DEFAULTS, gender: 1.3, age: 0.55, muscle: 1.3, weight: 0.85, height: 0.9 },
      mods: { 'chin/chin-prognathism|decr|incr': 1.6, 'chin/chin-width|decr|incr': 1.5, 'nose/nose-scale-horiz|decr|incr': 1.5, 'nose/nose-flaring|decr|incr': 1.2, 'eyebrows/eyebrows-trans|backward|forward': 1.8, 'neck/neck-scale-horiz|decr|incr': 1.5, 'ears/l-ear-shape|pointed|triangle': -1.2, 'ears/r-ear-shape|pointed|triangle': -1.2, 'eyes/l-eye-scale|decr|incr': -0.5, 'eyes/r-eye-scale|decr|incr': -0.5 } },
      bones: { jaw: 1.18, chestW: 1.12, clavicle: 1.15 },
      skin: { melanin: 0.3, tint: '#5f8f3a', tintAmount: 0.85, scars: 1, moles: 1 },
      eyes: { irisColor1: '#c9a227', irisColor2: '#8a5a12', irisMix: 0.7, sclera: '#d8c8a0', scleraVeins: 0.8 },
      hair: H({ style: 'mohawk', eumelanin: 9, length: 1.3 }) },
  },
  alien: {
    label: 'Außerirdisch', icon: '👽',
    s: { clothing: { top: 'longsleeve', bottom: 'leggings', topColor: '#c8ccd2', bottomColor: '#c8ccd2', topRough: 0.4, bottomRough: 0.4, knit: 0.2 }, human: { macros: { ...MACRO_DEFAULTS, gender: 0.5, age: 0.45, muscle: 0.2, weight: 0.05, height: 0.6 },
      mods: { 'eyes/l-eye-scale|decr|incr': 2.2, 'eyes/r-eye-scale|decr|incr': 2.2, 'head/head-scale-vert|decr|incr': 1.5, 'chin/chin-width|decr|incr': -1.8, 'nose/nose-scale-depth|decr|incr': -1.5, 'nose/nose-scale-horiz|decr|incr': -1, 'mouth/mouth-scale-horiz|decr|incr': -1, 'ears/l-ear-scale|decr|incr': -2, 'ears/r-ear-scale|decr|incr': -2 } },
      bones: { skull: 1.25, neckL: 1.2, neckT: 0.8, fingers: 1.35 },
      skin: { melanin: 0.1, tint: '#9aa3a8', tintAmount: 0.9, moles: 0, freckles: 0, veins: 1 },
      eyes: { irisColor1: '#050505', irisColor2: '#101010', irisSize: 2.1, pupil: 0.9, sclera: '#0a0a0c', limbus: 0 },
      hair: H({ style: 'bald', brows: { density: 0 }, lashDensity: 0.1 }) },
  },
  giant: {
    label: 'Riese', icon: '🗿',
    s: { clothing: { top: 'none', bottom: 'shorts', bottomColor: '#3b3a33', bottomRough: 0.95 },
      human: { macros: { ...MACRO_DEFAULTS, gender: 1.1, age: 0.62, muscle: 1.1, weight: 0.9, height: 1.45, proportions: 0.3 },
      mods: { 'head/head-scale-horiz|decr|incr': -0.4, 'chin/chin-prominent|decr|incr': 1.4, 'chin/chin-width|decr|incr': 1.2, 'eyebrows/eyebrows-trans|backward|forward': 1.5, 'nose/nose-scale-horiz|decr|incr': 0.8, 'nose/nose-hump|decr|incr': 1.2 } },
      bones: { hand: 1.3, foot: 1.25, jaw: 1.15, chestW: 1.15 },
      skin: { melanin: 0.32, hemo: 0.62, mottle: 2.2, scars: 0.8, moles: 0.8 },
      hair: H({ style: 'long', eumelanin: 5, length: 0.8, frizz: 3, beardStyle: 'full', beardLength: 0.05, beardEu: 5, bodyHair: { arms: 0.9, legs: 1, chest: 1, belly: 0.8 } }) },
  },
  goblin: {
    label: 'Kobold', icon: '👺',
    s: { clothing: { top: 'none', bottom: 'shorts', bottomColor: '#4b3b22', bottomRough: 1 },
      human: { macros: { ...MACRO_DEFAULTS, gender: 0.85, age: 0.6, muscle: 0.4, weight: 0.25, height: -0.35, proportions: 0.05 },
      mods: { 'ears/l-ear-scale|decr|incr': 2.2, 'ears/r-ear-scale|decr|incr': 2.2, 'ears/l-ear-shape|pointed|triangle': -2.2, 'ears/r-ear-shape|pointed|triangle': -2.2, 'ears/l-ear-wing|decr|incr': 2, 'ears/r-ear-wing|decr|incr': 2, 'nose/nose-scale-vert|decr|incr': 2, 'nose/nose-point|down|up': -1.5, 'nose/nose-hump|decr|incr': 1.5, 'chin/chin-prominent|decr|incr': 1.5, 'chin/chin-triangle': 1.5, 'eyes/l-eye-scale|decr|incr': 0.8, 'eyes/r-eye-scale|decr|incr': 0.8, 'mouth/mouth-scale-horiz|decr|incr': 1.2 } },
      bones: { skull: 1.18, hand: 1.2, fingers: 1.3, foot: 1.2 },
      skin: { melanin: 0.25, tint: '#6c8f2e', tintAmount: 0.85, mottle: 3, moles: 2, scars: 0.5 },
      eyes: { irisColor1: '#e0b030', irisColor2: '#b07a10', irisMix: 0.6, pupilShape: 0.85, sclera: '#d8d0a0', scleraVeins: 1.2 },
      hair: H({ style: 'bald', brows: { density: 0.6, thickness: 1.6 } }) },
  },
  vampire: {
    label: 'Vampir', icon: '🧛',
    s: { clothing: { top: 'longsleeve', bottom: 'leggings', topColor: '#14090c', bottomColor: '#0d0d10', topSheen: 1, topRough: 0.45 },
      human: { macros: { ...MACRO_DEFAULTS, gender: 0.9, age: 0.5, muscle: 0.45, weight: 0.2, height: 0.75, proportions: 1 },
      mods: { 'cheek/l-cheek-bones|decr|incr': 1.2, 'cheek/r-cheek-bones|decr|incr': 1.2, 'cheek/l-cheek-volume|decr|incr': -1, 'cheek/r-cheek-volume|decr|incr': -1, 'chin/chin-triangle': 0.8, 'eyes/l-eye-corner2|down|up': 0.8, 'eyes/r-eye-corner2|down|up': 0.8 } },
      skin: { melanin: 0.0, hemo: -0.3, undertone: -0.6, flush: 0, veins: 1.6, shadowColor: '#2a0d16', shadowAmount: 0.55, lipColor: '#5a0d1c', lipAmount: 0.7, lipGloss: 0.9 },
      eyes: { irisColor1: '#c0101a', irisColor2: '#600810', irisMix: 0.7, glow: 0.35, scleraVeins: 0.8 },
      hair: H({ style: 'slick', eumelanin: 10, shine: 1.6, brows: { arch: 1.8, thickness: 0.9 } }) },
  },
  dwarf: {
    label: 'Zwerg', icon: '⛏️',
    s: { clothing: { top: 'tshirt', bottom: 'shorts', topColor: '#6a3b2a', bottomColor: '#3a3326', topRough: 0.95 }, human: { macros: { ...MACRO_DEFAULTS, gender: 1, age: 0.7, muscle: 0.8, weight: 0.8, height: -0.3, proportions: 0.1 },
      mods: { 'nose/nose-scale-horiz|decr|incr': 1, 'nose/nose-volume|decr|incr': 1.2 } },
      bones: { femurL: 0.75, tibiaL: 0.75, humerusL: 0.85, ulnaL: 0.85, chestW: 1.15, hand: 1.15 },
      skin: { melanin: 0.2, flush: 1, hemo: 0.7 },
      hair: H({ style: 'long', eumelanin: 1.4, pheomelanin: 1.4, length: 0.8, frizz: 2, beardStyle: 'full', beardLength: 0.12, beardEu: 1.4, beardPheo: 1.5 }) },
  },
};

// ------------------------------------------------------------------ randomizer
function rnd(a, b) { return a + Math.random() * (b - a); }
function gauss(s = 1) { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * s; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

export function randomState(app, extreme = false) {
  const s = getState(app);
  const g = Math.random() < 0.5 ? rnd(0, 0.15) : rnd(0.85, 1);
  const eth = [Math.random(), Math.random(), Math.random()].map((x) => x * x);
  const es = eth.reduce((a, b) => a + b, 0);
  const m = s.human.macros = {
    ...MACRO_DEFAULTS,
    gender: extreme ? rnd(-0.4, 1.4) : g,
    age: extreme ? rnd(-0.1, 1.2) : rnd(0.3, 0.95),
    muscle: extreme ? rnd(-0.3, 1.5) : Math.min(1, Math.max(0, 0.5 + gauss(0.18))),
    weight: extreme ? rnd(-0.3, 1.5) : Math.min(1, Math.max(0, 0.5 + gauss(0.2))),
    height: extreme ? rnd(-0.5, 1.5) : Math.min(1, Math.max(0, 0.5 + gauss(0.18))),
    proportions: rnd(0.4, 1),
    african: eth[0] / es, asian: eth[1] / es, caucasian: eth[2] / es,
    breastSize: rnd(0.25, 0.85), breastFirmness: rnd(0.3, 0.8),
  };
  const mods = {};
  const sigma = extreme ? 1.1 : 0.28;
  for (const mod of app.character.human.modList) {
    if (mod.group === 'bodyshapes' || mod.group === 'measure') continue;
    if (Math.random() < (extreme ? 0.6 : 0.45)) {
      let v = gauss(sigma);
      if (mod.oneSided) v = Math.abs(v) * 0.6;
      if (mod.pair && mod.side === 'r') continue;
      mods[mod.id] = v;
      if (mod.pair) mods[mod.pair] = v + gauss(extreme ? 0.4 : 0.04);
    }
  }
  s.human.mods = mods;
  s.human.expression = {};
  s.bones = {};
  if (extreme) {
    for (const id of ['skull', 'jaw', 'neckL', 'spineL', 'clavicle', 'humerusL', 'ulnaL', 'hand', 'fingers', 'femurL', 'tibiaL', 'foot']) {
      if (Math.random() < 0.4) s.bones[id] = Math.max(0.5, 1 + gauss(0.25));
    }
  }
  const mel = Math.min(1, Math.max(0, 0.12 + m.african * 0.6 + m.asian * 0.15 + gauss(0.07)));
  s.skin = { ...s.skin, melanin: mel, hemo: rnd(0.4, 0.65), undertone: rnd(-0.2, 0.5) * (1 - m.african * 0.5),
    freckles: mel < 0.25 && Math.random() < 0.35 ? rnd(0.2, 1) : 0, moles: rnd(0.1, 0.7), flush: rnd(0.1, 0.7),
    tintAmount: extreme && Math.random() < 0.4 ? rnd(0.3, 0.9) : 0, tint: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
    lipAmount: m.gender < 0.5 && Math.random() < 0.4 ? rnd(0.1, 0.6) : 0, seed: Math.random() };
  const darkEye = mel > 0.4 || Math.random() < 0.5;
  const eyeCols = darkEye ? ['#3a2414', '#4a2e18', '#5a3b22', '#6b4a2b'] : ['#3f6a8a', '#5f86a3', '#5d7a4a', '#7a8a5a', '#8a9aa6', '#6b5a3a'];
  s.eyes = { ...s.eyes, irisColor1: pick(eyeCols), irisColor2: pick(eyeCols), irisMix: rnd(0.2, 0.8), pupil: rnd(0.25, 0.45), seed: Math.random() };
  if (extreme && Math.random() < 0.3) Object.assign(s.eyes, { irisColor1: pick(['#c9a227', '#e03030', '#7fd0c8', '#a050ff']), pupilShape: Math.random() < 0.5 ? 0.9 : 0, glow: rnd(0, 0.4) });
  const styles = Object.keys(HAIR_STYLES).filter((k) => k !== 'bald' || Math.random() < 0.3);
  const male = m.gender > 0.5;
  const style = male ? pick(['buzz', 'crew', 'textured', 'sidepart', 'slick', 'quiff', 'curly', 'afro', 'long', 'bald', 'dreads'])
    : pick(['bob', 'bangs', 'long', 'wavy', 'curly', 'afro', 'ponytail', 'textured', 'dreads']);
  const eu = mel > 0.45 ? rnd(5, 10) : pick([0.3, 0.6, 1.2, 2, 3, 4.5, 6, 8]);
  s.hair = { ...s.hair, style: extreme ? pick(styles) : style, eumelanin: eu, pheomelanin: rnd(0.1, eu < 2 ? 1.4 : 0.8), tipEu: eu, tipPheo: rnd(0.1, 0.8),
    length: rnd(0.75, 1.25), curlExtra: m.african > 0.5 ? rnd(0, 0.006) : 0, gray: m.age > 0.75 ? rnd(0.3, 1) : 0, seed: Math.floor(rnd(1, 999)),
    dyeAmount: extreme && Math.random() < 0.4 ? rnd(0.5, 1) : 0, dye: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
    beardStyle: male && Math.random() < 0.6 ? pick(['stubble', 'full', 'boxed', 'goatee', 'mustache', 'circle', 'vandyke']) : 'none',
    beardLength: rnd(0.0015, 0.03), beardEu: eu, beardPheo: rnd(0.2, 1),
    brows: { ...HAIR_DEFAULTS.brows, thickness: rnd(0.7, 1.4), arch: rnd(0.5, 1.5), density: rnd(0.7, 1.2) }, browEu: Math.max(eu, 2.5),
    bodyHair: male ? { ...HAIR_DEFAULTS.bodyHair, arms: rnd(0.2, 0.6), legs: rnd(0.25, 0.7), chest: Math.random() < 0.4 ? rnd(0.2, 0.9) : 0, belly: Math.random() < 0.3 ? rnd(0.2, 0.7) : 0 } : { ...HAIR_DEFAULTS.bodyHair, arms: rnd(0, 0.1), legs: rnd(0, 0.06) },
    lashLength: male ? rnd(0.85, 1.05) : rnd(1.0, 1.3),
  };
  if (Math.random() < 0.3) Object.assign(s.hair.hairline, { recession: male ? rnd(0, 0.03) : 0 });
  return s;
}

export { EXPRESSION_PRESETS };
