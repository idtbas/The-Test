import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { G, clamp, approach, lerp, DEG, smoothstep } from './util.js';
import { Sim } from './systems.js';
import { CockpitAudio } from './audio.js';
import { World, heightAt } from './world.js';
import { Cockpit, EYE } from './cockpit.js';
import { Input, VIEWS } from './input.js';

const QUALITY = [
  { name: 'Leistung', pr: 1.0, feed: 960, bloom: true, shadow: 512 },
  { name: 'Ausgewogen', pr: 1.5, feed: 1280, bloom: true, shadow: 1024 },
  { name: 'Maximal', pr: 2.0, feed: 1600, bloom: true, shadow: 2048 },
];

class UI {
  constructor() {
    this.tip = document.getElementById('tip');
    this.cross = document.getElementById('cross');
    this.toastEl = document.getElementById('toast');
    this.help = document.getElementById('help');
    this.hint = document.getElementById('hint');
    this.q = 1;
    try { const v = localStorage.getItem('gw7-quality'); if (v != null) this.q = clamp(+v, 0, 2); } catch (e) { /* ignore */ }
    this._t = 0;
  }
  setLocked(l) { this.cross.hidden = !l; document.body.classList.toggle('locked', l); this.hint.hidden = l; }
  toast(text) {
    this.toastEl.textContent = text; this.toastEl.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('on'), 1400);
  }
  toggleHelp() { this.help.hidden = !this.help.hidden; }
  cycleQuality() {
    this.q = (this.q + 1) % 3;
    try { localStorage.setItem('gw7-quality', String(this.q)); } catch (e) { /* ignore */ }
    this.onQuality?.(this.q);
    this.toast('Grafik: ' + QUALITY[this.q].name);
  }
  updateHover(ctl, locked, x, y) {
    this.cross.classList.toggle('hot', !!ctl);
    if (!ctl) { this.tip.hidden = true; this.lastCtl = null; return; }
    const t = ctl.tip();
    const html = `<b>${t.title}</b>${t.state !== '' && t.state != null ? `<span>${t.state}</span>` : ''}`;
    if (html !== this.lastHtml) { this.tip.innerHTML = html; this.lastHtml = html; }
    this.tip.hidden = false;
    if (locked) { this.tip.style.left = '50%'; this.tip.style.top = 'calc(50% + 26px)'; this.tip.style.transform = 'translateX(-50%)'; }
    else { this.tip.style.left = (x + 18) + 'px'; this.tip.style.top = (y + 18) + 'px'; this.tip.style.transform = 'none'; }
  }
}

async function loadFonts() {
  if (!document.fonts) return;
  const want = ['600 20px "Barlow Condensed"', '700 20px "Barlow Condensed"', '800 20px "Barlow Condensed"', '400 20px "B612 Mono"', '700 20px "B612 Mono"', '400 20px "B612"', '700 20px "B612"'];
  await Promise.race([Promise.all(want.map((f) => document.fonts.load(f).catch(() => { }))), new Promise((r) => setTimeout(r, 3500))]);
}

function status(t) { const el = document.getElementById('load-status'); if (el) el.textContent = t; }
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  status('Lade Schriften …');
  await loadFonts();
  await frame();

  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  G.renderer = renderer;
  G.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const ui = new UI();
  const sim = G.sim = new Sim();
  const audio = G.audio = new CockpitAudio();

  status('Erzeuge Außenwelt …');
  await frame();
  const world = G.world = new World(renderer);

  status('Baue Cockpit …');
  await frame();
  const scene = G.scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.03;
  const cockpit = new Cockpit(scene);
  cockpit.screens.forEach((sc) => {
    world.setupScreen(sc.i, sc.pa, sc.pb, sc.pc, EYE);
  });
  const bindFeeds = () => cockpit.screens.forEach((sc) => {
    sc.mat.uniforms.feed.value = world.rts[sc.i].texture;
    sc.mat.uniforms.res.value.set(world.rts[sc.i].width * 1.5, world.rts[sc.i].height * 1.5);
  });
  world.onResize = bindFeeds;

  const camera = new THREE.PerspectiveCamera(68, 1, 0.01, 60);
  camera.position.copy(EYE);
  scene.add(camera);

  // post processing
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.022 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, amount; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - dot(d,d) * 0.55;
        c.rgb *= v; c.rgb += (h(gl_FragCoord.xy) - 0.5) * amount; gl_FragColor = c; }`,
  });
  composer.addPass(grain);

  const applyQuality = (qi) => {
    const q = QUALITY[qi];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    world.setResolution(q.feed);
    for (const l of cockpit.shadowLights()) {
      l.shadow.mapSize.set(q.shadow, q.shadow);
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
      l.shadow.needsUpdate = true;
    }
    resize();
  };
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom.setSize(w * renderer.getPixelRatio() / 2, h * renderer.getPixelRatio() / 2);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  ui.onQuality = applyQuality;
  applyQuality(ui.q);

  const input = new Input(canvas, camera, cockpit, ui);

  // ------------------------------------------------------------ motion model
  const M = {
    eyeH: 5.6, heave: 0, heaveV: 0, pitch: 0, roll: 0, terrPitch: 0, terrRoll: 0,
    jolt: 0, joltV: 0, idleT: 0,
  };
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bodyQuat: new THREE.Quaternion() };
  const shake = { pos: new THREE.Vector3(), pitch: 0, yaw: 0, roll: 0 };
  const eul = new THREE.Euler();
  let lastVy = 0;

  function motion(dt) {
    const w = sim.walk, a = sim.act;
    const post = a.posture;
    const e = post * post * (3 - 2 * post);
    const ground = heightAt(w.x, w.z);
    M.eyeH = lerp(5.4, 9.3, e);
    // terrain attitude from the foot span
    const hF = heightAt(w.x - Math.sin(w.heading) * 2.5, w.z - Math.cos(w.heading) * 2.5);
    const hB = heightAt(w.x + Math.sin(w.heading) * 2.5, w.z + Math.cos(w.heading) * 2.5);
    const hL = heightAt(w.x - Math.cos(w.heading) * 2, w.z + Math.sin(w.heading) * 2);
    const hR = heightAt(w.x + Math.cos(w.heading) * 2, w.z - Math.sin(w.heading) * 2);
    M.terrPitch = approach(M.terrPitch, Math.atan2(hF - hB, 5) * 0.55, 2, dt);
    M.terrRoll = approach(M.terrRoll, Math.atan2(hL - hR, 4) * 0.5, 2, dt);
    // gait oscillation
    const ph = w.phase;
    const u = ph - Math.floor(ph);
    const amp = clamp(w.speedAbs / 3, 0, 1);
    const vBob = -Math.cos(u * Math.PI * 2) * (0.05 + w.speedAbs * 0.012) * amp;
    const lat = Math.sin(ph * Math.PI) * 0.07 * amp;
    const rollGait = Math.sin(ph * Math.PI) * 1.4 * DEG * amp;
    // spring-damper for impacts and posture transitions
    const k = 140, c = 15;
    M.jolt += M.joltV * dt; M.joltV += (-k * M.jolt - c * M.joltV) * dt;
    // idle balancing micro movements
    M.idleT += dt;
    const idle = post > 0.5 ? 1 : 0.3;
    const balP = (Math.sin(M.idleT * 0.7) * 0.5 + Math.sin(M.idleT * 1.9 + 1) * 0.3) * 0.12 * DEG * idle;
    const balR = (Math.sin(M.idleT * 0.53 + 2) * 0.5 + Math.sin(M.idleT * 1.37) * 0.3) * 0.15 * DEG * idle;
    // body pitch: crouched leans forward; acceleration pitches
    const transition = a.target !== (post > 0.5 ? 1 : 0) || (post > 0.001 && post < 0.999) ? Math.sin(post * Math.PI) : 0;
    const bodyPitch = (1 - e) * 4 * DEG + transition * -2.5 * DEG - w.accel * 1.2 * DEG - w.speedAbs * 0.35 * DEG + balP + M.terrPitch;
    const bodyRoll = rollGait + balR + M.terrRoll - w.yawRate * w.speedAbs * 0.08;
    M.pitch = approach(M.pitch, bodyPitch, 4, dt);
    M.roll = approach(M.roll, bodyRoll, 6, dt);
    const y = ground + M.eyeH + vBob + M.jolt;
    // world pose of the head / eye mount
    eul.set(M.pitch, w.heading, M.roll, 'YXZ');
    pose.quat.setFromEuler(eul);
    pose.bodyQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.heading);
    const side = new THREE.Vector3(Math.cos(w.heading), 0, -Math.sin(w.heading));
    pose.pos.set(w.x, y, w.z).addScaledVector(side, lat);
    // g-load from vertical acceleration
    const vy = (vBob + M.jolt) / Math.max(dt, 1e-3);
    const ay = (vy - lastVy) / Math.max(dt, 1e-3);
    lastVy = vy;
    cockpit.gLoad = approach(cockpit.gLoad, 1 + clamp(M.joltV * 0.08, -1.5, 1.5) + clamp((-Math.cos(u * Math.PI * 2)) * amp * 0.12, -0.3, 0.3), 12, dt);
    cockpit.pitchDeg = M.pitch / DEG; cockpit.rollDeg = M.roll / DEG;
    // inside the cockpit the head lags behind the structure a little
    shake.pos.set(0, -M.jolt * 0.25 - vBob * 0.15, 0);
    shake.pitch = M.joltV * 0.0018 + (bodyPitch - M.pitch) * 0.3;
    shake.roll = -rollGait * 0.25;
    shake.yaw = 0;
    // servo vibration when actuators work hard
    const vib = a.motion * 0.0012;
    shake.pos.x += (Math.random() - 0.5) * vib; shake.pos.y += (Math.random() - 0.5) * vib;
    // engine vibration
    const ev = sim.mtg.lit ? 0.00025 + sim.mtg.load * 0.0004 : sim.apu.lit ? 0.00008 : 0;
    shake.pos.y += (Math.random() - 0.5) * ev;
  }

  function handleEvents() {
    for (const ev of sim.events) {
      switch (ev.type) {
        case 'relay': audio.relay(ev.n || 1); break;
        case 'starter': audio.starter(true); audio.relay(2); break;
        case 'ignite': audio.ignition(); break;
        case 'caution': audio.chime(); break;
        case 'chime': audio.beep(1600, 0.25); break;
        case 'bootDone': audio.beep(2200, 0.08); setTimeout(() => audio.beep(2200, 0.08), 140); break;
        case 'reject': audio.tone([[400, 0.12], [300, 0.18]], 0.05); break;
        case 'footfall':
          M.joltV -= 0.9 * ev.strength;
          setTimeout(() => audio.thump(ev.strength), 30);
          G.shadowDirty = G.time + 0.1;
          break;
      }
    }
    sim.events.length = 0;
  }

  // ------------------------------------------------------------ debug / automation hooks
  window.__gw7 = {
    sim, cockpit, input, world, camera, renderer,
    view: (yaw, pitch, fov) => { input.tYaw = input.yaw = yaw; input.tPitch = input.pitch = pitch; if (fov) { input.baseFov = fov; } },
    ff: (sec, step = 0.05) => { for (let t = 0; t < sec; t += step) { sim.update(step); sim.events.length = 0; } },
    stats: () => {
      renderer.info.autoReset = false; renderer.info.reset();
      renderer.render(scene, camera);
      const cockpitCalls = renderer.info.render.calls;
      renderer.info.reset();
      world.renderFeeds(renderer, pose, [true, true, true]);
      const feedCalls = renderer.info.render.calls;
      renderer.info.autoReset = true;
      let meshes = 0; scene.traverse((o) => { if (o.isMesh) meshes++; });
      return { cockpitCalls, feedCalls, meshes, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries };
    },
    screenPos: (id) => {
      const c = cockpit.controls.find((x) => x.id === id); if (!c) return null;
      const v = new THREE.Vector3(); c.group.getWorldPosition(v); v.project(camera);
      return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
    },
    press: (id, opts = {}) => {
      const c = cockpit.controls.find((x) => x.id === id); if (!c) return false;
      c.interact({ type: 'down', button: opts.button || 0, local: new THREE.Vector3(opts.x || 0, opts.y ?? 0.01, 0.02), object: c.picks[0] });
      c.interact({ type: 'up', button: opts.button || 0 });
      return true;
    },
  };

  // ------------------------------------------------------------ loop
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.time += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    sim.update(dt);
    handleEvents();
    motion(dt);
    audio.update(sim, dt, sim.act.motion);
    input.update(dt, shake);
    cockpit.update(dt, world);
    world.update(dt, pose, sim);
    const enabled = cockpit.screens.map((sc) => sc.mat.uniforms.power.value > 0.01 && sc.boot > 0.6);
    if (enabled.some(Boolean)) world.renderFeeds(renderer, pose, enabled);
    // cockpit shadow maps only refresh while something moves
    const dirty = (G.shadowDirty || 0) > G.time || sim.walk.speedAbs > 0.05 || sim.act.motion > 0.05 || !G.shadowInit;
    G.shadowInit = true;
    if (dirty) for (const l of cockpit.shadowLights()) l.shadow.needsUpdate = true;
    grain.uniforms.time.value = (G.time * 60) % 1000;
    composer.render(dt);
  };

  status('Bereit');
  document.getElementById('loader').classList.add('ready');
  window.__ready = true;
  const go = document.getElementById('go');
  go.disabled = false;
  go.textContent = 'Einsteigen';
  const start = () => {
    document.getElementById('loader').hidden = true;
    input.enabled = true;
    audio.start();
    input.requestLock();
    ui.toast('Klick ins Bild: Maus fangen · Esc: freigeben · H: Hilfe');
  };
  go.addEventListener('click', start);
  if (new URLSearchParams(location.search).has('autostart')) { document.getElementById('loader').hidden = true; input.enabled = true; }
  requestAnimationFrame(loop);
}

main().catch((e) => {
  console.error(e);
  status('Fehler: ' + e.message);
});
