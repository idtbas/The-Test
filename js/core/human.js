// Morph engine: turns macro values (gender, age, ...) and the individual modifiers into a
// set of target weights and keeps the morphed base mesh up to date incrementally.

import { buildModifierList, MACRO_DEFAULTS, EXPRESSION_UNITS } from './modifiers.js';

// Piecewise-linear blend weights between named key points, extrapolating linearly past the
// ends so that "beyond realistic" slider ranges keep pushing in the same direction.
function blend(v, keys, names) {
  const out = {};
  for (const n of names) out[n] = 0;
  const last = keys.length - 1;
  let i = 0;
  if (v <= keys[0]) i = 0;
  else if (v >= keys[last]) i = last - 1;
  else while (i < last - 1 && v > keys[i + 1]) i++;
  const t = (v - keys[i]) / (keys[i + 1] - keys[i]);
  if (v < keys[0]) {
    out[names[0]] = 1 + (keys[0] - v) / (keys[1] - keys[0]);
    out[names[1]] = -(keys[0] - v) / (keys[1] - keys[0]);
  } else if (v > keys[last]) {
    out[names[last]] = 1 + (v - keys[last]) / (keys[last] - keys[last - 1]);
    out[names[last - 1]] = -(v - keys[last]) / (keys[last] - keys[last - 1]);
  } else {
    out[names[i]] = 1 - t;
    out[names[i + 1]] = t;
  }
  return out;
}

const AGE_KEYS = [0, 0.1875, 0.5, 1];          // 1, 11, 25, 90 years
const AGES = ['baby', 'child', 'young', 'old'];
const TRI = ['min', 'average', 'max'];

export function ageInYears(a) {
  if (a < 0.1875) return 1 + a / 0.1875 * 10;
  if (a < 0.5) return 11 + (a - 0.1875) / 0.3125 * 14;
  return 25 + (a - 0.5) / 0.5 * 65;
}

export class Human {
  constructor(assets) {
    this.store = assets.targets;
    this.base = assets.mesh.positions;
    this.nv = this.base.length / 3;
    this.morphed = new Float64Array(this.base);
    this.applied = new Map();
    this.macros = { ...MACRO_DEFAULTS };
    this.mods = new Map();          // modifier id -> value
    this.expression = new Map();    // unit -> value
    this.modList = buildModifierList();
    this.modById = new Map(this.modList.map((m) => [m.id, m]));
    this.version = 0;
    this.shapeVersion = 0;   // bumps on shape edits only (not expressions / blinking)
    this.dirty = true;
    // streamed-in target chunks change the shape as well
    this.store.onChunk(() => { this.dirty = true; this.shapeVersion++; });
  }

  setMacro(name, v) {
    if (name === 'african' || name === 'asian' || name === 'caucasian') {
      // keep the three ethnic weights summing to one
      const others = ['african', 'asian', 'caucasian'].filter((n) => n !== name);
      v = Math.min(1, Math.max(0, v));
      const rest = this.macros[others[0]] + this.macros[others[1]];
      const remain = 1 - v;
      if (rest < 1e-6) {
        this.macros[others[0]] = remain / 2;
        this.macros[others[1]] = remain / 2;
      } else {
        this.macros[others[0]] *= remain / rest;
        this.macros[others[1]] *= remain / rest;
      }
    }
    this.macros[name] = v;
    this.dirty = true;
    this.shapeVersion++;
  }

  setModifier(id, v) {
    if (Math.abs(v) < 1e-6) this.mods.delete(id);
    else this.mods.set(id, v);
    this.dirty = true;
    this.shapeVersion++;
  }

  getModifier(id) { return this.mods.get(id) || 0; }

  setExpressionUnit(u, v) {
    if (Math.abs(v) < 1e-6) this.expression.delete(u);
    else this.expression.set(u, v);
    this.dirty = true;
  }

  /** Transient eyelid closure (blinking), not part of the saved state. */
  setBlink(v) {
    if (Math.abs((this.blink || 0) - v) < 1e-3) return;
    this.blink = v;
    this.dirty = true;
  }

  setExpression(units) {
    this.expression.clear();
    for (const [k, v] of Object.entries(units)) this.expression.set(k, v);
    this.dirty = true;
  }

  // --------------------------------------------------------------------- weights
  computeWeights() {
    const m = this.macros;
    const W = new Map();
    const add = (name, w) => {
      if (Math.abs(w) < 1e-5) return;
      W.set(name, (W.get(name) || 0) + w);
    };
    const gender = { female: 1 - m.gender, male: m.gender };
    const age = blend(m.age, AGE_KEYS, AGES);
    const muscle = blend(m.muscle, [0, 0.5, 1], TRI);
    const weight = blend(m.weight, [0, 0.5, 1], TRI);
    const eth = { african: m.african, asian: m.asian, caucasian: m.caucasian };

    for (const [g, gw] of Object.entries(gender)) {
      if (!gw) continue;
      for (const [a, aw] of Object.entries(age)) {
        if (!aw) continue;
        for (const [e, ew] of Object.entries(eth)) add(`macrodetails/${e}-${g}-${a}`, gw * aw * ew);
        for (const [mu, mw] of Object.entries(muscle)) {
          if (!mw) continue;
          for (const [we, ww] of Object.entries(weight)) {
            if (!ww) continue;
            const combo = `${g}-${a}-${mu}muscle-${we}weight`;
            const cw = gw * aw * mw * ww;
            add(`macrodetails/universal-${combo}`, cw);
            if (m.height < 0.5) add(`macrodetails/height/${combo}-minheight`, cw * (1 - 2 * m.height));
            else add(`macrodetails/height/${combo}-maxheight`, cw * (2 * m.height - 1));
            if (m.proportions < 0.5) add(`macrodetails/proportions/${combo}-uncommonproportions`, cw * (1 - 2 * m.proportions));
            else add(`macrodetails/proportions/${combo}-idealproportions`, cw * (2 * m.proportions - 1));
          }
        }
      }
    }

    // Breast shape: female targets, applied regardless of gender so it can be pushed on
    // any body; the neutral (average cup, average firmness) has no target.
    const cup = blend(m.breastSize, [0, 0.5, 1], TRI);
    const firm = blend(m.breastFirmness, [0, 0.5, 1], TRI);
    for (const [a, aw] of Object.entries(age)) {
      if (!aw) continue;
      for (const [mu, mw] of Object.entries(muscle)) {
        if (!mw) continue;
        for (const [we, ww] of Object.entries(weight)) {
          if (!ww) continue;
          for (const [c, cwt] of Object.entries(cup)) {
            for (const [f, fw] of Object.entries(firm)) {
              if (c === 'average' && f === 'average') continue;
              add(`breast/female-${a}-${mu}muscle-${we}weight-${c}cup-${f}firmness`, aw * mw * ww * cwt * fw);
            }
          }
        }
      }
    }

    for (const [id, v] of this.mods) {
      const mod = this.modById.get(id);
      if (!mod) continue;
      if (mod.oneSided) add(mod.targets[1], v);
      else if (v < 0) add(mod.targets[0], -v);
      else add(mod.targets[1], v);
    }

    for (const [u, v] of this.expression) {
      for (const [e, ew] of Object.entries(eth)) add(`expression/units/${e}/${u}`, v * ew);
    }
    if (this.blink) {
      // close what is still open: subtract existing closure, compensate wide-open eyes
      for (const side of ['left', 'right']) {
        const cur = (this.expression.get(`eye-${side}-closure`) || 0) - (this.expression.get(`eye-${side}-opened-up`) || 0) * 0.6;
        const b = this.blink * Math.max(0, 1 - cur);
        for (const [e, ew] of Object.entries(eth)) add(`expression/units/${e}/eye-${side}-closure`, b * ew);
      }
    }
    return W;
  }

  // Apply weight changes incrementally. Returns true if the mesh changed.
  update(force = false) {
    if (!this.dirty && !force) return false;
    this.dirty = false;
    const W = this.computeWeights();
    const pos = this.morphed;
    let changed = false;
    const apply = (name, dw) => {
      const t = this.store.get(name);
      if (!t) return false;
      const { idx, d } = t;
      const s = dw * 0.001;
      for (let i = 0, n = idx.length; i < n; i++) {
        const v = idx[i] * 3, k = i * 3;
        pos[v] += s * d[k];
        pos[v + 1] += s * d[k + 1];
        pos[v + 2] += s * d[k + 2];
      }
      return true;
    };
    for (const [name, w] of this.applied) {
      if (!W.has(name)) {
        apply(name, -w);
        this.applied.delete(name);
        changed = true;
      }
    }
    for (const [name, w] of W) {
      const old = this.applied.get(name) || 0;
      if (Math.abs(w - old) < 1e-7) continue;
      if (apply(name, w - old)) {
        this.applied.set(name, w);
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  // Rebuild from scratch (removes floating point drift from many incremental steps).
  rebuild() {
    this.morphed.set(this.base);
    this.applied.clear();
    this.dirty = true;
    return this.update();
  }

  // ---------------------------------------------------------------- serialization
  toJSON() {
    return {
      macros: { ...this.macros },
      mods: Object.fromEntries(this.mods),
      expression: Object.fromEntries(this.expression),
    };
  }

  fromJSON(o) {
    this.macros = { ...MACRO_DEFAULTS, ...(o.macros || {}) };
    this.mods = new Map(Object.entries(o.mods || {}).filter(([id]) => this.modById.has(id)));
    this.expression = new Map(Object.entries(o.expression || {}));
    this.dirty = true;
    this.shapeVersion++;
  }
}

export const EXPRESSION_UNIT_NAMES = EXPRESSION_UNITS.map((u) => u[0]);
