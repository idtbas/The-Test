// Touch-first UI controls: slider rows, chips, toggles, color pickers, sections.

import { icon } from './icons.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * Slider row.
 * def: { label, get(), set(v), min, max, def, emin, emax (extreme range), fmt(v), commit() }
 * ctx: { extreme: bool, onCommit() }
 */
export function slider(def, ctx) {
  const row = el('div', 'row slider');
  row.dataset.search = def.label.toLowerCase();
  const head = el('div', 'row-head');
  const label = el('span', 'label', def.label);
  const val = el('span', 'val');
  head.append(label, val);
  const track = el('div', 'track');
  const bar = el('div', 'bar'), zone = el('div', 'zone'), fill = el('div', 'fill'), center = el('div', 'center'), thumb = el('div', 'thumb');
  track.append(bar, zone, fill, center, thumb);
  row.append(head, track);
  const range = () => (ctx.extreme && def.emin !== undefined ? [def.emin, def.emax] : [def.min, def.max]);
  const frac = (v) => { const [a, b] = range(); return (v - a) / (b - a); };
  const fmt = def.fmt || ((v) => (Math.abs(v) < 0.005 ? '0' : (v > 0 ? '+' : '') + Math.round(v * 100)));
  const neutral = def.def ?? 0;
  function render() {
    const v = def.get();
    const [a, b] = range();
    const f = Math.min(1, Math.max(0, frac(v)));
    const n = Math.min(1, Math.max(0, frac(neutral)));
    thumb.style.left = `${f * 100}%`;
    fill.style.left = `${Math.min(f, n) * 100}%`;
    fill.style.width = `${Math.abs(f - n) * 100}%`;
    center.style.left = `${n * 100}%`;
    center.style.display = n > 0.001 && n < 0.999 ? '' : 'none';
    if (ctx.extreme && def.emin !== undefined) {
      zone.style.display = '';
      zone.style.left = `${frac(def.min) * 100}%`;
      zone.style.width = `${(frac(def.max) - frac(def.min)) * 100}%`;
    } else zone.style.display = 'none';
    val.textContent = fmt(v);
    row.classList.toggle('changed', Math.abs(v - neutral) > 1e-4);
    row.classList.toggle('beyond', v < def.min - 1e-6 || v > def.max + 1e-6);
    void a; void b;
  }
  let start = null, lastTap = 0;
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    start = { x: e.clientX, y: e.clientY, v: def.get(), id: e.pointerId, drag: false, onTrack: track.contains(e.target) };
  });
  row.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.drag) {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        start.drag = true;
        row.setPointerCapture(e.pointerId);
        row.classList.add('dragging');
      } else return;
    }
    e.preventDefault();
    const [a, b] = range();
    const w = track.getBoundingClientRect().width;
    // finer control the further the finger moves away vertically
    const fine = 1 / (1 + Math.max(0, Math.abs(dy) - 30) / 60);
    let v = start.v + (dx / w) * (b - a) * fine;
    v = Math.min(b, Math.max(a, v));
    if (def.step) v = Math.round(v / def.step) * def.step;
    def.set(v);
    render();
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const s = start;
    start = null;
    row.classList.remove('dragging');
    if (s.drag) { ctx.onCommit(); return; }
    if (e.type === 'pointercancel') return;
    const now = performance.now();
    if (now - lastTap < 320) {
      def.set(neutral); render(); ctx.onCommit(); lastTap = 0; return;
    }
    lastTap = now;
    if (s.onTrack) {
      const r = track.getBoundingClientRect();
      const [a, b] = range();
      let v = a + ((e.clientX - r.left) / r.width) * (b - a);
      v = Math.min(b, Math.max(a, v));
      if (def.step) v = Math.round(v / def.step) * def.step;
      def.set(v); render(); ctx.onCommit();
    }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.render = render;
  render();
  return row;
}

export function chips(def, ctx) {
  const wrap = el('div', 'chips');
  wrap.dataset.search = (def.label || '') + ' ' + def.options.map((o) => o.label).join(' ').toLowerCase();
  const btns = def.options.map((o) => {
    const b = el('button', 'chip');
    if (o.color) { const sw = el('span', 'sw'); sw.style.background = o.color; b.append(sw); }
    b.append(document.createTextNode(o.label));
    b.addEventListener('click', () => { def.set(o.value); render(); ctx.onCommit(); });
    return b;
  });
  wrap.append(...btns);
  function render() {
    const cur = def.get ? def.get() : undefined;
    def.options.forEach((o, i) => btns[i].classList.toggle('active', cur !== undefined && JSON.stringify(cur) === JSON.stringify(o.value)));
  }
  wrap.render = render;
  render();
  return wrap;
}

export function toggle(def, ctx) {
  const row = el('div', 'toggle-row');
  row.dataset.search = def.label.toLowerCase();
  const sw = el('div', 'switch');
  row.append(el('span', '', def.label), sw);
  sw.addEventListener('click', () => { def.set(!def.get()); render(); ctx.onCommit(); });
  function render() { sw.classList.toggle('on', !!def.get()); }
  row.render = render;
  render();
  return row;
}

export function color(def, ctx) {
  const row = el('div', 'color-row');
  row.dataset.search = def.label.toLowerCase();
  const inp = el('input');
  inp.type = 'color';
  row.append(el('span', '', def.label), inp);
  inp.addEventListener('input', () => def.set(inp.value));
  inp.addEventListener('change', () => { def.set(inp.value); ctx.onCommit(); });
  function render() { inp.value = def.get(); }
  row.render = render;
  render();
  return row;
}

export function section(title, children, { open = true, count } = {}) {
  const s = el('div', 'section' + (open ? '' : ' closed'));
  const head = el('div', 'section-head', `<span>${title}${count ? `<span class="count">${count}</span>` : ''}</span>${icon('chev').replace('<svg', '<svg class="chev"')}`);
  const body = el('div', 'section-body');
  body.append(...children.filter(Boolean));
  head.addEventListener('click', () => s.classList.toggle('closed'));
  s.append(head, body);
  s.dataset.title = title.toLowerCase();
  return s;
}

export function hint(text) { return el('div', 'hint', text); }
