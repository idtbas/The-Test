import { loadCore } from './core/assets.js';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const status = document.getElementById('loader-status');
const fill = document.getElementById('loader-fill');

function setProgress(f, text) {
  fill.style.width = `${Math.round(f * 100)}%`;
  if (text) status.textContent = text;
}

async function start() {
  setProgress(0.05, 'Lade Anatomie-Daten …');
  const assets = await loadCore();
  const chunks = Object.entries(assets.targets.index.chunks);
  const total = chunks.reduce((s, [, c]) => s + c.gz, 0);
  const got = Object.fromEntries(chunks.map(([k]) => [k, 0]));
  const prog = (k) => (loaded) => {
    got[k] = loaded;
    const sum = Object.values(got).reduce((a, b) => a + b, 0);
    setProgress(0.1 + 0.8 * Math.min(1, sum / total), 'Lade Morph-Targets …');
  };
  // the macro chunk is needed for the first frame, the rest streams in
  await assets.targets.loadChunk('macro', prog('macro'));
  const rest = Promise.all(chunks.filter(([k]) => k !== 'macro').map(([k]) => assets.targets.loadChunk(k, prog(k))));
  setProgress(0.92, 'Baue Körper …');

  const canvas = document.getElementById('view');
  const app = new App(canvas, assets, {
    textureSize: +(params.get('tex') || 2048),
    maxDpr: +(params.get('dpr') || 2),
  });
  window.app = app;
  // iPadOS may drop the WebGL context after backgrounding: recover by reloading (state is autosaved)
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); status.textContent = 'Grafik wird neu gestartet …'; document.getElementById('loader').classList.remove('done'); });
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  await applyTestParams(app);
  app.resize();
  addEventListener('resize', () => app.resize());

  rest.then(() => { app.character.human.dirty = true; app.requestRender(); app.emit('targets'); });
  if (params.get('wait') === 'all') await rest;

  // iPad Safari: keep pinch/double-tap gestures for the 3D view, never zoom the page
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  // double-tap zoom is disabled with touch-action in the CSS: cancelling touchend here would
  // also swallow the click of quick repeated taps on buttons (undo, chips, ...)

  // adaptive resolution: if interactive rendering stays slow, step the render scale down.
  // "Slow" is relative to the display cadence learned from idle frames, so a 30 Hz rAF cap
  // (Low Power Mode, thermal mitigation) is not mistaken for a slow GPU.
  let slow = 0, lastT = performance.now(), cadence = 16.7;
  const loop = () => {
    const now = performance.now();
    const dt = now - lastT;
    lastT = now;
    const interactive = app.accum <= 1;
    const before = app.lastRender;
    app.frame();
    if (app.lastRender === before) cadence = cadence * 0.9 + Math.min(dt, 50) * 0.1;
    if (interactive && app.autoQuality) {
      slow = dt > Math.max(36, cadence * 1.6) ? slow + 1 : Math.max(0, slow - 2);
      if (slow > 45 && app.renderer.settings.scale > 0.6) {
        app.renderer.settings.scale = Math.max(0.6, app.renderer.settings.scale - 0.12);
        app.resize();
        slow = 0;
        window.ui?.toast(`Auflösung automatisch auf ${Math.round(app.renderer.settings.scale * 100)} % reduziert`);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (params.get('wait') === 'hair') {
    await rest;
    await new Promise((res) => { const t = setInterval(() => { if (!app.hair.busyNow && performance.now() - app.hair.lastGeomChange > 400) { clearInterval(t); res(); } }, 200); });
  }
  // first frames compile shaders; mark ready after a couple of frames
  let n = 0;
  const ready = () => { if (++n > 3) { window.__ready = true; document.getElementById('loader').classList.add('done'); } else requestAnimationFrame(ready); };
  requestAnimationFrame(ready);
  const ui = await import('./ui/ui.js').catch((e) => { console.warn('UI', e); return null; });
  if (ui && params.get('ui') !== '0') ui.mountUI(app);
}

// URL parameters used by the screenshot tooling, e.g. ?gender=1&cam=face&light=portrait
async function applyTestParams(app) {
  const ch = app.character;
  const st = await import('./state.js');
  const preset = params.get('preset');
  const testing = [...params.keys()].some((k) => !['preset', 'dpr', 'tex'].includes(k));
  const saved = !preset && !testing ? st.History.restore() : null;
  if (saved) st.setState(app, saved);
  else if (preset !== 'none') st.setState(app, JSON.parse(JSON.stringify(st.PRESETS[preset || 'woman'].s)));
  for (const [k, v] of params) {
    if (k in ch.human.macros) ch.human.setMacro(k, parseFloat(v));
  }
  if (params.get('pose')) ch.setPose(params.get('pose'));
  if (params.get('light')) app.stage.apply(params.get('light'));
  if (params.get('sss') === '0') app.setSSS(false);
  if (params.get('ao') === '0') app.renderer.settings.ao = false;
  if (params.get('mel')) app.setSkin({ melanin: +params.get('mel') });
  if (params.get('hair')) app.hair.set({ style: params.get('hair') });
  if (params.get('beard')) app.hair.set({ beardStyle: params.get('beard'), beardLength: +(params.get('bl') || 0.004) });
  if (params.get('hq')) app.hair.quality = +params.get('hq');
  if (params.get('acc')) app.maxAccum = +params.get('acc');
  if (params.get('nobody')) { app.body.visible = false; app.renderer.settings.sss = false; }
  if (params.get('top')) app.clothing.set({ top: params.get('top'), bottom: params.get('bottom') || 'briefs' });
  if (params.get('hairdbg')) {
    for (const s of Object.values(app.hair.sets)) { s.mat.alphaToCoverage = false; s.mat.uniforms.uMinPx.value = +params.get('hairdbg'); s.mat.needsUpdate = true; }
  }
  if (params.get('expr')) import('./core/modifiers.js').then((m) => { ch.human.setExpression(m.EXPRESSION_PRESETS[params.get('expr')].u); });
  const c = params.get('c');
  if (c) {
    const v = c.split(',').map(Number);
    app.camera.position.set(v[0], v[1], v[2]);
    app.controls.target.set(v[3], v[4], v[5]);
    if (v[6]) { app.camera.fov = v[6]; app.camera.updateProjectionMatrix(); }
  } else if (params.get('cam') === 'face') {
    const h = ch.bonePos('head');
    app.controls.target.set(0, h[1] + 0.03, 0.08);
    app.camera.position.set(0.1, h[1] + 0.05, 0.72);
  }
  app.controls.update();
}

start().catch((e) => {
  console.error(e);
  status.textContent = 'Fehler: ' + e.message;
});
