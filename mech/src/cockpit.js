// Cockpit geometry, panels, controls and interior lighting.
// Cockpit space: meters, floor at y=0, pilot design eye at (0, 1.15, 0), forward = -z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  G, materials, sharedTextures, orient, V3, DEG, TAU, clamp, approach, makeCanvas, canvasTex, rng, FONT_LABEL, FONT_MONO, lerp,
} from './util.js';
import { Panel, Toggle, Korry, Rotary, Knob, Breaker, PushButton, Gauge, Control, dialFace, LEGEND_LIGHT } from './panel.js';
import { MFD, Annunciator } from './mfd.js';
import { BREAKERS, GAITS } from './systems.js';

export const EYE = V3(0, 1.15, 0);

const flash = (hz = 2) => (Math.floor(G.time * hz * 2) % 2 === 0);

export class Cockpit {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.panels = [];
    this.controls = [];
    this.screens = [];
    this.mfds = [];
    this.lights = {};
    RectAreaLightUniformsLib.init();
    this.buildShell();
    this.buildScreens();
    this.buildMainPanel();
    this.buildConsoles();
    this.buildOverhead();
    this.buildSeat();
    this.buildDetails();
    this.buildLights();
    for (const p of this.panels) for (const c of p.controls) this.controls.push(c);
    this.pickables = [];
    for (const c of this.controls) for (const m of c.picks) this.pickables.push(m);
    this.root.traverse((o) => { if (o.isMesh && !o.material.transparent && o.material.visible !== false) { o.receiveShadow = true; } });
  }

  addPanel(p, origin, xAxis, yAxis) {
    p.build();
    orient(p.group, origin, xAxis, yAxis);
    this.root.add(p.group);
    this.panels.push(p);
    return p;
  }

  // ------------------------------------------------------------------ shell
  buildShell() {
    const M = materials();
    const half = [[0.62, 0], [0.98, 0.42], [1.08, 0.95], [1.04, 1.55], [0.66, 1.98]];
    const pts = [];
    for (const [x, y] of half) pts.push(new THREE.Vector2(x, y));
    for (let i = half.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(-half[i][0], half[i][1]));
    const shape = new THREE.Shape(pts);
    const len = 2.0, z0 = -1.08;
    const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: 1 });
    shellGeo.translate(0, 0, z0);
    const shell = new THREE.Mesh(shellGeo, M.wall.clone());
    shell.material.side = THREE.BackSide;
    this.root.add(shell);
    this.shellShape = pts;

    // structural frames (ribs)
    const center = V3(0, 1.0, 0);
    const ring = (k) => pts.map((p) => new THREE.Vector2(center.x + (p.x - center.x) * k, center.y + (p.y - center.y) * k));
    const ribs = [];
    for (const z of [-0.92, -0.42, 0.12, 0.62]) {
      const outer = new THREE.Shape(ring(1.0));
      outer.holes.push(new THREE.Path(ring(0.93).reverse()));
      const g = new THREE.ExtrudeGeometry(outer, { depth: 0.055, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
      g.translate(0, 0, z);
      ribs.push(g);
    }
    const ribMesh = new THREE.Mesh(mergeGeometries(ribs), M.structure);
    ribMesh.castShadow = true;
    this.root.add(ribMesh);
    // rivet rows on ribs (instanced)
    const rivGeo = new THREE.SphereGeometry(0.0045, 8, 4, 0, TAU, 0, Math.PI / 2);
    const rivs = [];
    for (const z of [-0.92, -0.42, 0.12, 0.62]) {
      const r = ring(0.965);
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const L = a.distanceTo(b), n = Math.floor(L / 0.06);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          rivs.push([lerp(a.x, b.x, t), lerp(a.y, b.y, t), z + 0.062]);
        }
      }
    }
    const rivMesh = new THREE.InstancedMesh(rivGeo.rotateX(Math.PI / 2), M.darkSteel, rivs.length);
    const m4 = new THREE.Matrix4();
    rivs.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); rivMesh.setMatrixAt(i, m4); });
    this.root.add(rivMesh);

    // floor plate
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.02, 1.9), M.floor);
    floor.position.set(0, 0.01, -0.12);
    M.floor.bumpMap.repeat.set(3, 4);
    this.root.add(floor);
  }

  // ------------------------------------------------------------------ sensor displays
  buildScreens() {
    const M = materials();
    const h = 0.535, wC = 0.95, wS = 0.70, y = 1.232, zC = -0.80;
    const defs = [
      { name: 'SDU L', w: wS, side: -1 },
      { name: 'SDU M', w: wC, side: 0 },
      { name: 'SDU R', w: wS, side: 1 },
    ];
    const ang = 46 * DEG;
    const order = [0, 1, 2];
    for (const i of order) {
      const d = defs[i];
      const g = new THREE.Group();
      if (d.side === 0) g.position.set(0, y, zC);
      else {
        const hx = d.side * (wC / 2 + 0.035);
        const c = V3(hx + d.side * Math.cos(ang) * (d.w / 2 + 0.035), y, zC + Math.sin(ang) * (d.w / 2 + 0.035));
        g.position.copy(c);
        g.rotation.y = -d.side * ang;
      }
      this.root.add(g);
      // bezel housing
      const bez = new THREE.Mesh(new RoundedBoxGeometry(d.w + 0.07, h + 0.075, 0.09, 3, 0.012), M.bezel);
      bez.position.z = -0.04; bez.castShadow = true;
      g.add(bez);
      // recess frame around the active area
      for (const [fx, fy, fw, fh] of [[0, h / 2 + 0.006, d.w + 0.024, 0.012], [0, -h / 2 - 0.006, d.w + 0.024, 0.012], [-d.w / 2 - 0.006, 0, 0.012, h], [d.w / 2 + 0.006, 0, 0.012, h]]) {
        const fr = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.008), M.black);
        fr.position.set(fx, fy, 0.008); g.add(fr);
      }
      // bolts
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 6).rotateX(Math.PI / 2), M.darkSteel);
        b.position.set(sx * (d.w / 2 + 0.022), sy * (h / 2 + 0.025), 0.007); g.add(b);
      }
      // screen surface (custom shader)
      const ov = makeCanvas(i === 1 ? 1024 : 768, 576);
      const ovTex = canvasTex(ov);
      const mat = screenMaterial(ovTex);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(d.w, h), mat);
      scr.position.z = 0.0062;
      g.add(scr);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(d.w, h), M.glass.clone());
      glass.material.opacity = 0.12;
      glass.position.z = 0.0085;
      g.add(glass);
      // label strip with brightness knob
      const strip = new Panel({ id: 'sdu' + i, w: 0.24, h: 0.03, ppm: 3000, fasteners: false, color: '#1d1f21' });
      strip.text(`SDU-3  ${['L', 'M', 'R'][i]}`, -0.075, 0, { size: 0.0045, weight: 700 });
      strip.add(new Knob({ key: 'sduBrt' + i, name: `${d.name} Helligkeit`, r: 0.0065, ends: ['', ''] }), 0.085, -0.002);
      strip.text('BRT', 0.06, 0, { size: 0.0032 });
      strip.build();
      strip.group.position.set(0, -h / 2 - 0.022, 0.006);
      strip.group.scale.setScalar(1);
      g.add(strip.group);
      this.panels.push(strip);
      // power LED
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 10, 6), new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x33ff66, emissiveIntensity: 0 }));
      led.position.set(-d.w / 2 + 0.01, -h / 2 - 0.022, 0.012); g.add(led);

      g.updateMatrixWorld(true);
      const pa = V3(-d.w / 2, -h / 2, 0).applyMatrix4(scr.matrixWorld);
      const pb = V3(d.w / 2, -h / 2, 0).applyMatrix4(scr.matrixWorld);
      const pc = V3(-d.w / 2, h / 2, 0).applyMatrix4(scr.matrixWorld);
      // area light emitted by the screen
      const ra = new THREE.RectAreaLight(0x9fb3c4, 0, d.w, h);
      ra.position.set(0, 0, 0.02);
      ra.lookAt(0, 0, 1);
      g.add(ra);
      this.screens.push({ i, mesh: scr, mat, ov, ovTex, pa, pb, pc, light: ra, led, w: d.w, h, boot: 0, ovTimer: 0 });
    }
    // housing behind / between the screens + upper frame
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.6), M.structure);
    top.position.set(0, y + h / 2 + 0.07, -0.78); this.root.add(top);
  }

  // ------------------------------------------------------------------ main instrument panel
  buildMainPanel() {
    const M = materials();
    const s = G.sim;
    const top = V3(0, 0.94, -0.61), bot = V3(0, 0.495, -0.53);
    const yAxis = top.clone().sub(bot);
    const H = yAxis.length();
    const origin = top.clone().add(bot).multiplyScalar(0.5);
    const p = new Panel({ id: 'main', w: 1.14, h: H, ppm: 2200, color: '#26292c' });
    this.mainPanel = p;

    // MFDs
    const mfdX = [-0.285, 0, 0.285], mfdY = 0.045;
    const pages = ['ENG', 'CHK', 'ELEK'];
    ['L', 'M', 'R'].forEach((l, i) => {
      const m = new MFD(i, l, pages[i]);
      this.mfds.push(m);
      p.text(`MFD ${l}`, mfdX[i], mfdY - 0.128, { size: 0.0034, weight: 700 });
    });

    // master warning / caution
    const mw = new Korry({
      id: 'mwarn', name: 'MASTER WARNUNG (quittieren)', size: [0.042, 0.024], mode: 'action',
      legends: [{ text: 'MASTER\nWARNUNG', color: '#ff2a12', lit: () => s.warn.masterWarning && flash(2), gain: 3.4 }],
      onPress: () => s.masterWarningReset(), state: () => (s.warn.masterWarning ? 'AKTIV' : 'AUS'),
    });
    const mc = new Korry({
      id: 'mcaut', name: 'MASTER VORSICHT (quittieren)', size: [0.042, 0.024], mode: 'action',
      legends: [{ text: 'MASTER\nVORSICHT', color: '#ffae00', lit: () => s.warn.masterCaution, gain: 3.0 }],
      onPress: () => s.masterCautionReset(), state: () => (s.warn.masterCaution ? 'AKTIV' : 'AUS'),
    });
    p.add(mw, -0.04, 0.192);
    p.add(mc, 0.04, 0.192);

    // gauges
    const gN2 = dialFace({ min: 0, max: 110, a0: -135, a1: 135, major: 10, minor: 5, labels: [0, 20, 40, 60, 80, 100], title: 'MTG N2', unit: '%', arcs: [{ from: 104, to: 110, color: '#d22' }] });
    p.add(new Gauge({ id: 'gN2', name: 'MTG Drehzahl N2', r: 0.034, face: gN2, needles: [{ value: () => s.mtg.n2 * 100, min: 0, max: 110, a0: -135, a1: 135 }], read: () => `${(s.mtg.n2 * 100).toFixed(1)} %` }), -0.505, 0.125);
    const gEGT = dialFace({ min: 0, max: 1100, a0: -135, a1: 135, major: 100, minor: 50, labels: [0, 200, 400, 600, 800, 1000], fmt: (v) => v / 100, title: 'MTG AGT', unit: '°C ×100', arcs: [{ from: 760, to: 860, color: '#e8a400' }, { from: 860, to: 1100, color: '#d22' }] });
    p.add(new Gauge({ id: 'gEGT', name: 'MTG Abgastemperatur', r: 0.034, face: gEGT, needles: [{ value: () => s.mtg.egt, min: 0, max: 1100, a0: -135, a1: 135 }], read: () => `${s.mtg.egt.toFixed(0)} °C` }), -0.505, 0.02);
    const gHyd = dialFace({ min: 0, max: 300, a0: -135, a1: 135, major: 50, minor: 25, labels: [0, 100, 200, 300], title: 'HYD A  B', unit: 'BAR', arcs: [{ from: 0, to: 150, color: '#e8a400' }, { from: 190, to: 225, color: '#2c2' }] });
    p.add(new Gauge({
      id: 'gHyd', name: 'Hydraulikdruck A/B', r: 0.034, face: gHyd,
      needles: [{ value: () => s.hyd.a, min: 0, max: 300, a0: -135, a1: 135, color: 0xf2f0e8 }, { value: () => s.hyd.b, min: 0, max: 300, a0: -135, a1: 135, color: 0xffb020, len: 0.66 }],
      read: () => `A ${s.hyd.a.toFixed(0)} bar · B ${s.hyd.b.toFixed(0)} bar`,
    }), -0.505, -0.085);
    const gG = dialFace({ min: -1, max: 3, a0: -135, a1: 135, major: 1, minor: 0.25, labels: [-1, 0, 1, 2, 3], title: 'BESCHL', unit: 'G' });
    this.gLoad = 1;
    p.add(new Gauge({ id: 'gG', name: 'Vertikalbeschleunigung', r: 0.034, face: gG, needles: [{ value: () => this.gLoad, min: -1, max: 3, a0: -135, a1: 135, damp: 18 }], read: () => `${this.gLoad.toFixed(2)} g` }), -0.505, -0.19);

    // attitude indicator
    p.add(this.makeAttitude(), 0.505, 0.125);
    // clock
    const cf = dialFace({ min: 0, max: 60, a0: 0, a1: 360, major: 5, minor: 1, labels: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60], fmt: (v) => String(v / 5), title: 'UHR', titleY: -0.35, unit: '' });
    const now = () => { const d = new Date(); return d.getHours() % 12 + d.getMinutes() / 60; };
    p.add(new Gauge({
      id: 'clock', name: 'Borduhr', r: 0.034, face: cf,
      needles: [
        { value: () => now() * 5, min: 0, max: 60, a0: 0, a1: 360, len: 0.5, width: 0.06, damp: 50 },
        { value: () => { const d = new Date(); return d.getMinutes() + d.getSeconds() / 60; }, min: 0, max: 60, a0: 0, a1: 360, len: 0.8, width: 0.045, damp: 50 },
        { value: () => { const d = new Date(); return d.getSeconds() + d.getMilliseconds() / 1000; }, min: 0, max: 60, a0: 0, a1: 360, len: 0.88, width: 0.02, color: 0xff6020, damp: 60 },
      ],
      read: () => new Date().toLocaleTimeString('de-DE'),
    }), 0.505, 0.02);
    const gT = dialFace({ min: 0, max: 140, a0: -120, a1: 120, major: 20, minor: 10, labels: [0, 40, 80, 120], title: 'KÜHLM', unit: '°C', arcs: [{ from: 95, to: 115, color: '#e8a400' }, { from: 115, to: 140, color: '#d22' }] });
    p.add(new Gauge({ id: 'gCool', name: 'Kühlmitteltemperatur', r: 0.034, face: gT, needles: [{ value: () => s.cool.temp, min: 0, max: 140, a0: -120, a1: 120 }], read: () => `${s.cool.temp.toFixed(0)} °C` }), 0.505, -0.085);
    const gS = dialFace({ min: 0, max: 40, a0: -135, a1: 135, major: 5, minor: 1, labels: [0, 10, 20, 30, 40], title: 'GESCHW', unit: 'KM/H' });
    p.add(new Gauge({ id: 'gSpd', name: 'Geschwindigkeit über Grund', r: 0.034, face: gS, needles: [{ value: () => Math.abs(s.walk.speed) * 3.6, min: 0, max: 40, a0: -135, a1: 135 }], read: () => `${(s.walk.speed * 3.6).toFixed(1)} km/h` }), 0.505, -0.19);

    // lamp test + warning volume
    p.add(new PushButton({
      id: 'lamptest', name: 'Lampentest', label: 'LAMPEN-\nTEST', titleSize: 0.003,
      onPress: () => { s.warn.lampTest = true; if (s.P.ess) s.flags.lampTested = true; },
      onRelease: () => { s.warn.lampTest = false; },
    }), -0.38, -0.165);
    p.add(new Knob({ key: 'warnVol', name: 'Warnton-Lautstärke', label: 'WARNTON', ends: ['LEISE', 'LAUT'], onChange: (v) => { if (G.audio) G.audio.master && (G.audio.master.gain.value = 0.25 + v * 0.8); } }), -0.25, -0.17);

    // annunciator
    this.ann = new Annunciator(5, 4, 0.058, 0.0225);
    const annCtl = new Control({ id: 'ann', name: 'Warnlichtfeld' });
    annCtl.build = () => {
      annCtl.group.add(this.ann.build());
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.02), M.pick);
      pick.position.z = 0.01; annCtl.group.add(annCtl.addPick(pick));
    };
    annCtl.tip = () => {
      const a = [...s.warn.active].map((id) => s.warn.list.find((x) => x[0] === id)?.[1].replace('\n', ' ')).filter(Boolean);
      return { title: 'Warnlichtfeld', state: a.length ? a.join(' · ') : 'keine Meldung' };
    };
    p.add(annCtl, 0, -0.158);
    p.text('WARNUNGEN', 0, -0.098, { size: 0.0032, weight: 700 });

    // emergency stop
    p.add(this.makeEStop(), 0.33, -0.163);
    p.text('NOT-AUS', 0.33, -0.124, { size: 0.0042, weight: 700 });
    p.text('DREHEN ZUM\nENTRIEGELN', 0.39, -0.165, { size: 0.0026, align: 'left' });

    this.addPanel(p, origin, V3(1, 0, 0), yAxis);
    // attach MFDs after build
    this.mfds.forEach((m, i) => { m.attach(p, mfdX[i], mfdY); });

    // body behind panel + glareshield
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.46, 0.26), M.paint);
    body.position.set(0, 0.72, -0.755); this.root.add(body);
    const glare = new THREE.Mesh(new RoundedBoxGeometry(1.24, 0.03, 0.27, 2, 0.01), M.paint);
    glare.position.set(0, 0.945, -0.735); glare.castShadow = true; this.root.add(glare);
    const coaming = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.24, 16).rotateZ(Math.PI / 2), M.leather);
    coaming.position.set(0, 0.948, -0.605); coaming.castShadow = true; this.root.add(coaming);
    // center pedestal and knee wells
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.2), M.paint);
    ped.position.set(0, 0.25, -0.66); this.root.add(ped);
    const pedPanel = new Panel({ id: 'ped', w: 0.22, h: 0.4, ppm: 1800, color: '#26292c' });
    pedPanel.text('GW-7 GRAUWOLF', 0, 0.16, { size: 0.007, weight: 700 });
    pedPanel.text('S/N 07-0419  ·  BAULOS 3', 0, 0.143, { size: 0.0038 });
    pedPanel.text('KESSLER-WERKE\nWEHRTECHNIK', 0, 0.115, { size: 0.0042 });
    pedPanel.box(0, 0.0, 0.18, 0.18, 'BETRIEBSGRENZEN');
    pedPanel.text('MTG N2  MAX 104 %\nMTG AGT  MAX 860 °C\nHYD  190–225 BAR\nKÜHLM  MAX 95 °C\nGESCHW  MAX 32 KM/H\nNEIGUNG  MAX 18°', 0, -0.005, { size: 0.0052, align: 'center' });
    pedPanel.stripes(0, -0.17, 0.2, 0.02);
    this.addPanel(pedPanel, V3(0, 0.27, -0.555), V3(1, 0, 0), V3(0, 1, -0.05));
  }

  makeAttitude() {
    const s = G.sim;
    const S = 512;
    const c = makeCanvas(S, S * 2), k = c.getContext('2d');
    // sky / ground with pitch ladder (90° range over canvas height)
    const sky = k.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#0f3c66'); sky.addColorStop(1, '#3a7cb8');
    k.fillStyle = sky; k.fillRect(0, 0, S, S);
    const gr = k.createLinearGradient(0, S, 0, S * 2);
    gr.addColorStop(0, '#6b4a26'); gr.addColorStop(1, '#3a2814');
    k.fillStyle = gr; k.fillRect(0, S, S, S);
    k.strokeStyle = '#fff'; k.fillStyle = '#fff'; k.lineWidth = 6;
    k.beginPath(); k.moveTo(0, S); k.lineTo(S, S); k.stroke();
    k.lineWidth = 3; k.font = `600 26px ${FONT_LABEL}`; k.textAlign = 'center'; k.textBaseline = 'middle';
    for (let d = -40; d <= 40; d += 5) {
      if (!d) continue;
      const y = S - d * (S / 45);
      const w = d % 10 === 0 ? 90 : 40;
      k.beginPath(); k.moveTo(S / 2 - w, y); k.lineTo(S / 2 + w, y); k.stroke();
      if (d % 10 === 0) { k.fillText(String(Math.abs(d)), S / 2 - w - 26, y); k.fillText(String(Math.abs(d)), S / 2 + w + 26, y); }
    }
    const tex = canvasTex(c);
    tex.center.set(0.5, 0.5);
    tex.repeat.set(1, 0.5);
    const e = makeCanvas(8, 8); e.getContext('2d').fillStyle = '#fff'; e.getContext('2d').fillRect(0, 0, 8, 8);
    const g = new Gauge({
      id: 'att', name: 'Lageanzeige (Kreisel)', r: 0.034,
      face: { c, e: c },
      needles: [],
      read: () => (s.gyro.ok ? `Neigung ${(this.pitchDeg || 0).toFixed(1)}° · Rollen ${(this.rollDeg || 0).toFixed(1)}°` : 'KREISEL AUS – FLAGGE'),
      extra: (gg) => {
        gg.faceMat.map = tex; gg.faceMat.emissiveMap = null; gg.faceMat.emissive.set(0x000000);
        // fixed symbol overlay
        const o = makeCanvas(256, 256), ok = o.getContext('2d');
        ok.strokeStyle = '#ffb000'; ok.lineWidth = 10; ok.lineCap = 'round';
        ok.beginPath(); ok.moveTo(40, 128); ok.lineTo(100, 128); ok.lineTo(115, 145); ok.moveTo(216, 128); ok.lineTo(156, 128); ok.lineTo(141, 145); ok.stroke();
        ok.fillStyle = '#ffb000'; ok.beginPath(); ok.arc(128, 128, 7, 0, TAU); ok.fill();
        ok.strokeStyle = '#fff'; ok.lineWidth = 4;
        for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
          const r = a * DEG - Math.PI / 2, l = a % 30 === 0 ? 18 : 10;
          ok.beginPath(); ok.moveTo(128 + Math.cos(r) * 122, 128 + Math.sin(r) * 122); ok.lineTo(128 + Math.cos(r) * (122 - l), 128 + Math.sin(r) * (122 - l)); ok.stroke();
        }
        const om = new THREE.MeshStandardMaterial({ map: canvasTex(o), transparent: true, emissive: LEGEND_LIGHT.clone(), emissiveMap: canvasTex(o), emissiveIntensity: 0, roughness: 0.5 });
        G.gaugeMats.push(om);
        const ov = new THREE.Mesh(new THREE.CircleGeometry(0.034, 40), om);
        ov.position.z = 0.0052; gg.group.add(ov);
        // OFF flag
        const fl = makeCanvas(128, 48), fk = fl.getContext('2d');
        fk.fillStyle = '#d01c10'; fk.fillRect(0, 0, 128, 48); fk.fillStyle = '#fff'; fk.font = `700 34px ${FONT_LABEL}`; fk.textAlign = 'center'; fk.textBaseline = 'middle'; fk.fillText('AUS', 64, 26);
        gg.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.0075), new THREE.MeshStandardMaterial({ map: canvasTex(fl), roughness: 0.6 }));
        gg.flag.position.set(-0.016, -0.016, 0.0055); gg.flag.rotation.z = 0.5; gg.group.add(gg.flag);
        gg.tex = tex;
        gg.cage = { pitch: 0, roll: 0 };
      },
      onUpdate: (gg, dt) => {
        const up = s.gyro.rpm > 0.6;
        const tumble = up ? 0 : (1 - s.gyro.rpm);
        const pitch = up ? (this.pitchDeg || 0) : 12 * tumble;
        const roll = up ? (this.rollDeg || 0) : 25 * tumble;
        gg.cage.pitch = approach(gg.cage.pitch, pitch, 4, dt);
        gg.cage.roll = approach(gg.cage.roll, roll, 4, dt);
        gg.tex.rotation = gg.cage.roll * DEG;
        gg.tex.offset.set(0, 0.25 + gg.cage.pitch / 90 * 0.5);
        gg.flag.visible = !s.gyro.ok;
      },
    });
    return g;
  }

  makeEStop() {
    const s = G.sim, M = materials();
    const c = new Control({ id: 'estop', name: 'NOT-AUS (Bewegungssystem)', key: 'estop' });
    c.depth = s.sw.estop ? 1 : 0;
    c.build = () => {
      const plate = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.052, 0.004, 2, 0.004), M.yellow);
      plate.position.z = 0.002;
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 24).rotateX(Math.PI / 2), M.black);
      collar.position.z = 0.008;
      const pts = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * 0.019 + 0.0001, Math.cos(a) * 0.009)); }
      pts.push(new THREE.Vector2(0.012, -0.006), new THREE.Vector2(0.0, -0.006));
      pts.reverse();
      c.head = new THREE.Mesh(new THREE.LatheGeometry(pts, 32).rotateX(Math.PI / 2), M.red);
      c.head.castShadow = true;
      c.head.position.z = 0.022;
      c.group.add(plate, collar, c.head);
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 16).rotateX(Math.PI / 2), M.pick);
      pick.position.z = 0.018; c.group.add(c.addPick(pick));
    };
    c.interact = (ev) => {
      if (ev.type !== 'down') return;
      c.set(c.value ? 0 : 1);
      G.audio?.click('estop');
      s.message(c.value ? 'NOT-AUS AUSGELÖST' : 'NOT-AUS ENTRIEGELT');
    };
    c.update = (dt) => {
      c.sync();
      c.depth = approach(c.depth, c.value ? 1 : 0, 25, dt);
      c.head.position.z = 0.022 - c.depth * 0.007;
      c.head.rotation.z = (1 - c.depth) * 0.0;
    };
    c.tip = () => ({ title: 'NOT-AUS (Bewegungssystem)', state: c.value ? 'AUSGELÖST · Klick: entriegeln' : 'BEREIT' });
    return c;
  }

  // ------------------------------------------------------------------ consoles
  buildConsoles() {
    const M = materials(), s = G.sim;
    const tilt = 9 * DEG;
    const yc = 0.665, zFront = -0.62, zBack = 0.24;
    const mk = (side) => {
      const xc = side * 0.56, wTop = 0.44;
      const xIn = xc - side * wTop / 2, xOut = xc + side * wTop / 2;
      // surface: inner edge lower than outer
      const yIn = yc - Math.tan(tilt) * wTop / 2, yOut = yc + Math.tan(tilt) * wTop / 2;
      const prof = new THREE.Shape([
        new THREE.Vector2(xIn, 0.02), new THREE.Vector2(xOut + side * 0.1, 0.02), new THREE.Vector2(xOut + side * 0.06, yOut - 0.01),
        new THREE.Vector2(xOut, yOut), new THREE.Vector2(xIn, yIn),
      ].map((v) => (side < 0 ? v : v)));
      const g = new THREE.ExtrudeGeometry(prof, { depth: zBack - zFront, bevelEnabled: false });
      g.translate(0, 0, zFront);
      const body = new THREE.Mesh(g, M.paint);
      body.material = M.paint;
      body.castShadow = true;
      this.root.add(body);
      if (side > 0) { body.geometry.scale(1, 1, 1); }
      // frame for orienting panels on the surface
      const xAxis = V3(Math.cos(tilt), side < 0 ? -Math.sin(tilt) : Math.sin(tilt), 0);
      const yAxis = V3(0, 0, -1);
      const normal = new THREE.Vector3().crossVectors(xAxis, yAxis);
      return { xc, yc, xAxis, yAxis, normal, side };
    };
    const L = mk(-1), R = mk(1);
    const place = (frame, panel, zStart) => {
      const zc = zStart - panel.h / 2;
      const o = V3(frame.xc, frame.yc, zc).addScaledVector(frame.normal, 0.0012);
      // panels are drawn with local +y pointing forward (−z): panel spans from zStart towards −z
      return this.addPanel(panel, o, frame.xAxis, frame.yAxis);
    };
    // panel stacks from the back towards the front, position = rear edge z
    // ---- LEFT
    let z = 0.24;
    const thr = this.throttlePanel();
    place(L, thr, z); z -= thr.h;
    for (const p of [this.lightPanel(), this.mtgPanel(), this.apuPanel(), this.fuelPanel()]) { place(L, p, z); z -= p.h; }
    // ---- RIGHT
    z = 0.24;
    const st = this.stickPanel();
    place(R, st, z); z -= st.h;
    for (const p of [this.motionPanel(), this.navPanel(), this.coolPanel(), this.hydPanel(), this.sensorPanel()]) { place(R, p, z); z -= p.h; }
  }

  fuelPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'fuel', title: 'KRAFTSTOFF', w: 0.42, h: 0.12 });
    p.add(new Toggle({ key: 'fuelL', name: 'Kraftstoffpumpe links', label: 'PUMPE L', positions: ['AUS', 'EIN'] }), -0.15, -0.012);
    p.add(new Toggle({ key: 'fuelR', name: 'Kraftstoffpumpe rechts', label: 'PUMPE R', positions: ['AUS', 'EIN'] }), -0.075, -0.012);
    p.add(new Toggle({ key: 'xfeed', name: 'Querspeisung', label: 'QUERSP.', positions: ['ZU', 'AUF'] }), 0.0, -0.012);
    p.box(-0.112, -0.012, 0.13, 0.085, 'BOOST');
    const face = dialFace({ min: 0, max: 2000, a0: -120, a1: 120, major: 500, minor: 100, labels: [0, 500, 1000, 1500, 2000], fmt: (v) => v / 100, title: 'L    R', titleY: 0.3, unit: 'KG ×100' });
    p.add(new Gauge({
      id: 'gFuel', name: 'Kraftstoffmenge L/R', r: 0.032, face,
      needles: [{ value: () => s.fuel.L, min: 0, max: 2000, a0: -120, a1: 120 }, { value: () => s.fuel.R, min: 0, max: 2000, a0: -120, a1: 120, color: 0xffb020, len: 0.66 }],
      read: () => `L ${s.fuel.L.toFixed(0)} kg · R ${s.fuel.R.toFixed(0)} kg · ${s.fuel.press.toFixed(1)} bar`,
    }), 0.135, -0.008);
    return p;
  }

  apuPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'apu', title: 'HILFSTURBINE  APU', w: 0.42, h: 0.12 });
    p.add(new Toggle({ key: 'apu', name: 'APU-Schalter (START federt zurück)', label: 'APU', positions: ['AUS', 'EIN', 'START'], momentary: 2, springTo: 1 }), -0.15, -0.012);
    p.add(new Toggle({ key: 'apuBleed', name: 'APU-Zapfluft', label: 'ZAPFLUFT', positions: ['AUS', 'EIN'] }), -0.065, -0.012);
    p.add(new Korry({
      id: 'apuStat', name: 'APU-Status', mode: 'none', size: [0.022, 0.022],
      legends: [{ text: 'BEREIT', color: '#3dff6a', lit: () => s.apu.avail }, { text: 'FEHLER', color: '#ffae00', lit: () => s.apu.fault }],
      state: () => (s.apu.avail ? 'BEREIT' : s.apu.fault ? 'FEHLER' : s.apu.state.toUpperCase()),
    }), 0.03, -0.008);
    const face = dialFace({ min: 0, max: 110, a0: -120, a1: 120, major: 10, minor: 5, labels: [0, 50, 100], title: 'APU', titleY: 0.3, unit: 'U/MIN %' });
    p.add(new Gauge({ id: 'gApu', name: 'APU-Drehzahl', r: 0.03, face, needles: [{ value: () => s.apu.rpm * 100, min: 0, max: 110, a0: -120, a1: 120 }], read: () => `${(s.apu.rpm * 100).toFixed(0)} % · AGT ${s.apu.egt.toFixed(0)} °C` }), 0.135, -0.008);
    return p;
  }

  mtgPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'mtg', title: 'HAUPTTURBINE  MTG', w: 0.42, h: 0.13 });
    p.add(new Toggle({ key: 'ign', name: 'Zündung', label: 'ZÜNDUNG', positions: ['AUS', 'EIN'] }), -0.15, -0.015);
    p.add(new Korry({
      id: 'mtgStart', name: 'MTG Anlassen (Anlassventil)', mode: 'action', size: [0.024, 0.024], label: 'ANLASSEN',
      legends: [{ text: 'START', color: '#ffffff', lit: () => s.P.ess, gain: 0.9 }, { text: 'VENTIL\nAUF', color: '#ffae00', lit: () => s.mtg.valve }],
      onPress: () => s.pressMtgStart(), state: () => (s.mtg.valve ? 'ANLASSVENTIL AUF' : 'ZU'),
    }), -0.06, -0.018);
    p.add(new Toggle({ key: 'mtgFuel', name: 'Kraftstoffhahn MTG', label: 'KST-HAHN', positions: ['ZU', 'AUF'], guard: true }), 0.035, -0.015);
    p.text('N2 ≥ 15 %', 0.035, -0.052, { size: 0.0028 });
    p.add(new Gauge({
      id: 'gOil', name: 'MTG Öldruck', r: 0.028,
      face: dialFace({ min: 0, max: 10, a0: -120, a1: 120, major: 2, minor: 1, labels: [0, 2, 4, 6, 8, 10], title: 'ÖL', titleY: 0.3, unit: 'BAR', arcs: [{ from: 0, to: 2, color: '#d22' }, { from: 3.5, to: 8, color: '#2c2' }] }),
      needles: [{ value: () => s.mtg.oil, min: 0, max: 10, a0: -120, a1: 120 }], read: () => `${s.mtg.oil.toFixed(1)} bar`,
    }), 0.14, -0.01);
    return p;
  }

  lightPanel() {
    const p = new Panel({ id: 'light', title: 'BELEUCHTUNG', w: 0.42, h: 0.13 });
    p.add(new Knob({ key: 'panelLight', name: 'Instrumentenbeleuchtung', label: 'INSTR', ends: ['AUS', 'HELL'] }), -0.15, -0.012);
    p.add(new Toggle({ key: 'flood', name: 'Flutlicht', label: 'FLUTLICHT', positions: ['AUS', 'ROT', 'WEISS'] }), -0.06, -0.012);
    p.add(new Toggle({ key: 'dome', name: 'Deckenlicht (Batterie direkt)', label: 'DECKE', positions: ['AUS', 'EIN'] }), 0.035, -0.012);
    p.add(new Toggle({ key: 'extLights', name: 'Außenscheinwerfer', label: 'SCHEINW.', positions: ['AUS', 'EIN'] }), 0.13, -0.012);
    return p;
  }

  throttlePanel() {
    const s = G.sim, M = materials();
    const p = new Panel({ id: 'thr', title: '', w: 0.42, h: 0.36 });
    const lx = -0.07;
    // slot and scale
    p.rect(lx, 0.012, 0.016, 0.1, { fill: '#050505' });
    const yFor = (v) => (v < 0 ? v / 0.3 * 0.045 : v * 0.105) - 0.0;
    for (const [v, l] of [[-0.3, 'R'], [0, 'STOP'], [0.25, '25'], [0.5, '50'], [0.75, '75'], [1, '100']]) {
      const y = Math.tan(this.thrAngle(v)) * 0.08;
      p.line(lx + 0.012, y, lx + 0.024, y, { width: 0.0008 });
      p.text(l, lx + 0.028, y, { size: 0.0042, align: 'left', weight: v === 0 ? 700 : 600 });
    }
    p.text('FAHRHEBEL', lx, -0.15, { size: 0.0048, weight: 700 });
    p.text('VOR', lx - 0.03, 0.12, { size: 0.0034 }); p.line(lx - 0.03, 0.128, lx - 0.03, 0.142, { width: 0.0008 });
    p.add(new Rotary({ key: 'gait', name: 'Gangart', label: 'GANGART', positions: GAITS.map((g) => g.name), step: 45 }), 0.11, 0.06);
    p.box(0.11, -0.08, 0.15, 0.1, 'FUSS-KAMERA', { open: false });
    p.text('NICHT\nINSTALLIERT', 0.11, -0.085, { size: 0.0036 });
    const lever = new Control({ id: 'throttle', name: 'Fahrhebel', key: 'throttle' });
    lever.build = () => {
      lever.pivot = new THREE.Group();
      lever.pivot.position.set(lx, 0, -0.08);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.15), M.steel);
      arm.position.z = 0.075;
      const grip = new THREE.Group();
      grip.position.z = 0.17;
      const gb = new THREE.Mesh(new RoundedBoxGeometry(0.038, 0.056, 0.085, 4, 0.014), M.rubber);
      gb.rotation.x = -0.25; gb.castShadow = true;
      const cap = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.05, 0.02, 3, 0.008), M.black);
      cap.position.set(0, 0.008, 0.045); cap.rotation.x = -0.25;
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 16), M.red);
      b1.position.set(0.012, 0.004, 0.056); b1.rotation.x = Math.PI / 2 - 0.25;
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.008, 8), M.darkSteel);
      hat.position.set(-0.01, 0.014, 0.057); hat.rotation.x = Math.PI / 2 - 0.25;
      grip.add(gb, cap, b1, hat);
      lever.pivot.add(arm, grip);
      lever.group.add(lever.pivot);
      // boot / brush seal in the slot
      const brush = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.1, 0.002), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1 }));
      brush.position.set(lx, 0.012, 0.001); lever.group.add(brush);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.12), M.pick);
      pick.position.z = 0.17; lever.pivot.add(lever.addPick(pick));
      lever.ang = this.thrAngle(s.sw.throttle);
    };
    lever.group.position.set(0, 0, 0);
    lever.interact = (ev) => {
      if (ev.type === 'wheel') { this.setThrottle(s.sw.throttle + ev.dir * 0.05); }
      if (ev.type === 'down') { lever.dragging = true; G.audio?.click('lever'); }
      if (ev.type === 'up') lever.dragging = false;
      if (ev.type === 'drag') this.setThrottle(s.sw.throttle - ev.dy * 0.004);
    };
    lever.update = (dt) => {
      lever.ang = approach(lever.ang, this.thrAngle(s.sw.throttle), 20, dt);
      lever.pivot.rotation.x = -lever.ang;
    };
    lever.tip = () => ({ title: 'Fahrhebel (W/S, ziehen oder Mausrad)', state: s.sw.throttle < -0.01 ? `RÜCKWÄRTS ${Math.round(-s.sw.throttle / 0.3 * 100)} %` : s.sw.throttle < 0.01 ? 'STOP' : `${Math.round(s.sw.throttle * 100)} %` });
    // the lever pivot sits below the panel; panel-local origin
    p.add(lever, 0, 0);
    this.lever = lever;
    return p;
  }

  thrAngle(v) { return v < 0 ? v / 0.3 * 12 * DEG : v * 38 * DEG; }

  setThrottle(v) {
    const s = G.sim;
    let n = clamp(v, -0.3, 1);
    // detent at STOP
    if (Math.sign(n) !== Math.sign(s.sw.throttle) && s.sw.throttle !== 0) { n = 0; G.audio?.click('detent'); }
    s.sw.throttle = Math.round(n * 1000) / 1000;
    G.shadowDirty = G.time + 0.3;
  }

  stickPanel() {
    const s = G.sim, M = materials();
    const p = new Panel({ id: 'stick', title: '', w: 0.42, h: 0.36 });
    p.text('STEUERKNÜPPEL', -0.05, -0.15, { size: 0.0045, weight: 700 });
    p.text('A / D  DREHEN', -0.05, -0.162, { size: 0.0034 });
    const st = new Control({ id: 'stick', name: 'Steuerknüppel (Drehen: A/D)' });
    st.build = () => {
      // rubber boot (bellows)
      const pts = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector2(0.045 - t * 0.028 + Math.sin(t * Math.PI * 7) * 0.003, t * 0.06)); }
      const boot = new THREE.Mesh(new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2), M.rubber);
      boot.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.004, 8, 32), M.darkSteel);
      ring.position.z = 0.002;
      st.pivot = new THREE.Group(); st.pivot.position.z = 0.02;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.12, 12).rotateX(Math.PI / 2), M.darkSteel);
      shaft.position.z = 0.06;
      const grip = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.05, 0.12, 4, 0.018), M.rubber);
      grip.position.set(0, 0.004, 0.155); grip.rotation.x = 0.12; grip.castShadow = true;
      const trig = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.016, 0.03, 2, 0.004), M.black);
      trig.position.set(0, 0.03, 0.15);
      const top = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.055, 0.02, 3, 0.009), M.black);
      top.position.set(0, 0.006, 0.22);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.01, 8).rotateX(Math.PI / 2), M.darkSteel);
      hat.position.set(-0.01, 0.0, 0.233);
      const pb = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16).rotateX(Math.PI / 2), M.red);
      pb.position.set(0.012, 0.012, 0.232);
      st.pivot.add(shaft, grip, trig, top, hat, pb);
      st.group.add(boot, ring, st.pivot);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.26), M.pick);
      pick.position.z = 0.13; st.group.add(st.addPick(pick));
      st.rx = 0; st.ry = 0;
    };
    st.update = (dt) => {
      st.ry = approach(st.ry, s.sw.turn * 12 * DEG, 10, dt);
      st.rx = approach(st.rx, clamp(s.walk.accel * 0.05, -0.1, 0.1), 6, dt);
      st.pivot.rotation.y = st.ry; st.pivot.rotation.x = st.rx;
    };
    st.tip = () => ({ title: 'Steuerknüppel', state: 'Drehen mit A / D' });
    p.add(st, -0.05, 0.02);
    // hand rest pad
    return p;
  }

  hydPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'hyd', title: 'HYDRAULIK', w: 0.42, h: 0.12 });
    p.add(new Toggle({ key: 'hydA', name: 'Hydraulikpumpe A (MTG-getrieben)', label: 'PUMPE A', positions: ['AUS', 'EIN'] }), -0.15, -0.012);
    p.add(new Toggle({ key: 'hydB', name: 'Hydraulikpumpe B (elektrisch)', label: 'PUMPE B', positions: ['AUS', 'EIN'] }), -0.075, -0.012);
    p.add(new Korry({
      id: 'hydStat', name: 'Hydraulik-Status', mode: 'none', size: [0.022, 0.022],
      legends: [{ text: 'A DRUCK', color: '#ffae00', lit: () => s.hyd.a < 150 }, { text: 'B DRUCK', color: '#ffae00', lit: () => s.hyd.b < 150 }],
      state: () => `A ${s.hyd.a.toFixed(0)} · B ${s.hyd.b.toFixed(0)} bar`,
    }), 0.02, -0.008);
    p.text('210 BAR', 0.12, -0.05, { size: 0.0034 });
    p.stripes(0.12, 0.022, 0.12, 0.012);
    p.text('ACHTUNG HOCHDRUCK', 0.12, 0.002, { size: 0.0036, weight: 700 });
    return p;
  }

  coolPanel() {
    const p = new Panel({ id: 'cool', title: 'KÜHLUNG', w: 0.42, h: 0.12 });
    p.add(new Toggle({ key: 'cool1', name: 'Kühlmittelpumpe 1', label: 'PUMPE 1', positions: ['AUS', 'EIN'] }), -0.15, -0.012);
    p.add(new Toggle({ key: 'cool2', name: 'Kühlmittelpumpe 2', label: 'PUMPE 2', positions: ['AUS', 'EIN'] }), -0.075, -0.012);
    p.add(new Toggle({ key: 'fan', name: 'Kühlerlüfter', label: 'LÜFTER', positions: ['AUTO', 'MAX'] }), 0.0, -0.012);
    return p;
  }

  navPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'nav', title: 'NAVIGATION', w: 0.42, h: 0.13 });
    p.add(new Rotary({ key: 'insMode', name: 'INS-Betriebsart', label: 'INS', positions: ['AUS', 'AUSR', 'NAV', 'NOT'], step: 38, labelBelow: 0.028 }), -0.13, -0.006);
    p.add(new Toggle({ key: 'gyro', name: 'Stabilisierungskreisel', label: 'KREISEL', positions: ['AUS', 'EIN'] }), -0.02, -0.012);
    p.add(new Korry({
      id: 'insStat', name: 'INS-Status', mode: 'none', size: [0.024, 0.022],
      legends: [{ text: 'AUSR', color: '#ffae00', lit: () => s.ins.status === 'AUSRICHTUNG' && flash(1) }, { text: 'BEREIT', color: '#3dff6a', lit: () => s.ins.align >= 1 }],
      state: () => `${s.ins.status} ${s.ins.align < 1 && s.P.ins ? Math.round(s.ins.align * 100) + ' %' : ''}`,
    }), 0.075, -0.008);
    p.add(new Korry({
      id: 'gyroStat', name: 'Kreisel-Status', mode: 'none', size: [0.024, 0.022],
      legends: [{ text: 'HOCHL.', color: '#ffae00', lit: () => s.gyro.rpm > 0 && !s.gyro.ok }, { text: 'STABIL', color: '#3dff6a', lit: () => s.gyro.ok }],
      state: () => `${Math.round(s.gyro.rpm * 100)} %`,
    }), 0.145, -0.008);
    return p;
  }

  sensorPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'sens', title: 'SENSOREN', w: 0.42, h: 0.11 });
    p.add(new Toggle({ key: 'sensors', name: 'Optische Sensoren / Displays', label: 'OPT SENS', positions: ['AUS', 'EIN'] }), -0.15, -0.01);
    p.add(new Korry({
      key: 'sensorMode', name: 'Bildmodus TV / IR', mode: 'latch', size: [0.024, 0.022], label: 'MODUS',
      legends: [{ text: 'TV', color: '#3dff6a', lit: () => s.sw.sensorMode === 0 && s.P.sdu.some(Boolean) }, { text: 'IR', color: '#ffffff', lit: () => s.sw.sensorMode === 1 && s.P.sdu.some(Boolean) }],
      state: () => (s.sw.sensorMode ? 'IR (Wärmebild)' : 'TV (Tageslicht)'),
    }), -0.06, -0.012);
    p.add(new Toggle({ key: 'hud', name: 'HUD-Symbolik', label: 'HUD', positions: ['AUS', 'EIN'] }), 0.03, -0.01);
    return p;
  }

  motionPanel() {
    const s = G.sim;
    const p = new Panel({ id: 'motion', title: 'BEWEGUNGSSYSTEM', w: 0.42, h: 0.15 });
    p.add(new Toggle({ key: 'actPower', name: 'Aktuator-Stromversorgung', label: 'AKT STROM', positions: ['AUS', 'EIN'] }), -0.15, -0.018);
    p.add(new Korry({
      id: 'cal', name: 'Aktuatoren kalibrieren', mode: 'action', size: [0.026, 0.024], label: 'KALIBRIEREN',
      legends: [{ text: 'KAL', color: '#ffae00', lit: () => s.act.calibrating && flash(1.5) }, { text: 'OK', color: '#3dff6a', lit: () => s.act.calibrated }],
      onPress: () => s.pressCal(), state: () => (s.act.calibrating ? `läuft ${Math.round(s.act.cal * 100)} %` : s.act.calibrated ? 'KALIBRIERT' : 'NICHT KALIBRIERT'),
    }), -0.065, -0.02);
    p.add(new Korry({
      id: 'stand', name: 'Aufrichten / Hocke', mode: 'action', size: [0.026, 0.024], label: 'HALTUNG',
      legends: [{ text: 'HOCKE', color: '#ffffff', lit: () => s.act.posture < 0.01 && s.P.act, gain: 1.2 }, { text: 'STAND', color: '#3dff6a', lit: () => s.act.posture > 0.99 || (s.act.target === 1 && flash(1.5)) }],
      onPress: () => s.pressStand(), state: () => (s.act.posture > 0.99 ? 'STAND' : s.act.posture < 0.01 ? 'HOCKE' : `${Math.round(s.act.posture * 100)} %`),
    }), 0.02, -0.02);
    p.add(new Toggle({ key: 'footLock', name: 'Fuß-Sperre', label: 'FUSS-SPERRE', positions: ['GESP.', 'FREI'], guard: true }), 0.12, -0.018);
    p.box(-0.022, -0.02, 0.19, 0.09, 'SEQUENZ');
    return p;
  }

  // ------------------------------------------------------------------ overhead
  buildOverhead() {
    const M = materials(), s = G.sim;
    const front = V3(0, 1.79, -0.66), back = V3(0, 1.92, -0.08);
    const yAxis = back.clone().sub(front).normalize();
    const L = back.distanceTo(front);
    const xAxis = V3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(xAxis, yAxis);

    const el = new Panel({ id: 'elec', title: 'ELEKTRIK', w: 0.64, h: 0.27, color: '#2a2e31' });
    const r1 = 0.035;
    el.add(new Toggle({ key: 'bat', name: 'Batterie-Hauptschalter', label: 'BATTERIE', positions: ['AUS', 'EIN'], guard: true }), -0.25, r1);
    el.add(new Toggle({ key: 'apuGen', name: 'APU-Generator', label: 'APU GEN', positions: ['AUS', 'EIN'] }), -0.15, r1);
    el.add(new Toggle({ key: 'gen1', name: 'Generator 1', label: 'GEN 1', positions: ['AUS', 'EIN'] }), -0.075, r1);
    el.add(new Toggle({ key: 'gen2', name: 'Generator 2', label: 'GEN 2', positions: ['AUS', 'EIN'] }), 0.0, r1);
    el.add(new Toggle({ key: 'busTie', name: 'Buskopplung', label: 'BUS-KOPPL', positions: ['OFFEN', 'AUTO'] }), 0.085, r1);
    el.add(new Toggle({ key: 'avionics', name: 'Avionik / Bordrechner', label: 'AVIONIK', positions: ['AUS', 'EIN'] }), 0.2, r1);
    el.box(-0.075, r1 + 0.002, 0.25, 0.085, 'GENERATOREN');
    // mimic lines
    el.line(-0.15, -0.012, -0.15, -0.03); el.line(-0.075, -0.012, -0.075, -0.03); el.line(0, -0.012, 0, -0.03);
    el.line(-0.15, -0.03, 0.0, -0.03); el.line(-0.25, -0.012, -0.25, -0.03); el.line(-0.25, -0.03, -0.15, -0.03);
    // volt meter + selector
    const vsel = ['BATT', 'APU', 'GEN 1', 'GEN 2', 'BUS 1', 'BUS 2', 'ESS'];
    const vRead = () => {
      const v = s.sw.voltSel;
      return [s.bus.hot, s.gen.apu ? 28.3 : 0, s.gen.g1 ? 28.3 : 0, s.gen.g2 ? 28.3 : 0, s.bus.b1, s.bus.b2, s.bus.ess][v] || 0;
    };
    el.add(new Gauge({
      id: 'volt', name: 'Voltmeter', r: 0.032,
      face: dialFace({ min: 0, max: 32, a0: -120, a1: 120, major: 4, minor: 1, labels: [0, 8, 16, 24, 32], title: 'VOLT', titleY: 0.32, unit: 'DC', arcs: [{ from: 0, to: 22, color: '#d22' }, { from: 26, to: 29.5, color: '#2c2' }] }),
      needles: [{ value: vRead, min: 0, max: 32, a0: -120, a1: 120, damp: 5 }], read: () => `${vsel[s.sw.voltSel]}: ${vRead().toFixed(1)} V`,
    }), 0.065, -0.07);
    el.add(new Rotary({ key: 'voltSel', name: 'Voltmeter-Wahlschalter', label: 'MESSSTELLE', positions: vsel, step: 30, radius: 0.026, labelBelow: 0.04 }), 0.18, -0.07);
    el.text('BATT ENTLADEN: ESS-LAST', -0.15, -0.065, { size: 0.0034 });
    el.text('MAX 15 MIN OHNE GENERATOR', -0.15, -0.078, { size: 0.0034 });
    this.addPanel(el, front.clone().addScaledVector(yAxis, el.h / 2).addScaledVector(normal, 0.001), xAxis, yAxis);

    const cb = new Panel({ id: 'cb', title: 'SICHERUNGEN', w: 0.64, h: 0.2, color: '#2a2e31' });
    BREAKERS.forEach(([id, label, amps], i) => {
      const row = Math.floor(i / 10), col = i % 10;
      cb.add(new Breaker({ cb: id, name: label, label, amps }), -0.27 + col * 0.06, 0.035 - row * 0.065);
    });
    cb.text('GEZOGENE SICHERUNG = SYSTEM STROMLOS', 0, -0.085, { size: 0.0032 });
    this.addPanel(cb, front.clone().addScaledVector(yAxis, el.h + cb.h / 2 + 0.01).addScaledVector(normal, 0.001), xAxis, yAxis);

    // housing for overhead
    const hous = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, L + 0.06), M.paint);
    hous.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, normal.clone().negate(), yAxis));
    hous.position.copy(front.clone().add(back).multiplyScalar(0.5).addScaledVector(normal, -0.045));
    this.root.add(hous);
  }

  // ------------------------------------------------------------------ seat
  buildSeat() {
    const M = materials();
    const g = new THREE.Group();
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.48, 4, 0.04), M.fabric);
    cushion.position.set(0, 0.47, 0.08); g.add(cushion);
    for (const sx of [-1, 1]) {
      const bol = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.13, 0.46, 4, 0.035), M.leather);
      bol.position.set(sx * 0.27, 0.5, 0.08); bol.rotation.z = sx * -0.15; g.add(bol);
    }
    const pan = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.05, 0.55, 2, 0.01), M.paint);
    pan.position.set(0, 0.4, 0.08); g.add(pan);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.8, 0.12, 4, 0.04), M.fabric);
    back.position.set(0, 0.92, 0.38); back.rotation.x = -0.12; g.add(back);
    const rails = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), M.darkSteel);
    rails.position.set(0, 0.19, 0.15); g.add(rails);
    // harness straps lying on the cushion
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([V3(sx * 0.2, 0.53, 0.25), V3(sx * 0.12, 0.535, 0.1), V3(sx * 0.03, 0.53, -0.08)]);
      const strap = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.012, 4), strapMat);
      strap.scale.set(1, 1, 1); g.add(strap);
    }
    const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), M.steel);
    buckle.position.set(0, 0.535, -0.1); g.add(buckle);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(g);
    // pedals
    for (const sx of [-1, 1]) {
      const ped = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.22, 0.02, 2, 0.006), M.darkSteel);
      ped.position.set(sx * 0.17, 0.14, -0.72); ped.rotation.x = -0.9; ped.castShadow = true;
      this.root.add(ped);
    }
  }

  // ------------------------------------------------------------------ details: cables, pipes, placards
  buildDetails() {
    const M = materials();
    const R = rng(9);
    const tube = (pts, r, mat, seg = 40) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 8), mat);
      m.castShadow = true; this.root.add(m); return m;
    };
    // wall cable looms (several conductors per loom)
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const off = (k - 2.5) * 0.016;
        const pts = [V3(sx * 1.0, 1.52 + off, -0.95), V3(sx * 1.02, 1.5 + off * 1.2, -0.4), V3(sx * 1.02, 1.48 + off, 0.2), V3(sx * 0.98, 1.5 + off, 0.8)];
        tube(pts, 0.007 + R() * 0.004, k % 3 === 0 ? M.cableGrey : M.cable);
      }
      // clamps
      for (const z of [-0.7, -0.2, 0.3]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.025), M.darkSteel);
        c.position.set(sx * 0.995, 1.5, z); this.root.add(c);
      }
      // hydraulic lines along the floor edge with yellow ID bands
      for (let k = 0; k < 2; k++) {
        const y = 0.2 + k * 0.05;
        const pts = [V3(sx * 0.8, y, -1.0), V3(sx * 0.88, y + 0.05, -0.5), V3(sx * 0.9, y + 0.05, 0.2), V3(sx * 0.82, y, 0.8)];
        tube(pts, 0.012, M.steel);
        for (const t of [0.2, 0.5, 0.8]) {
          const c = new THREE.CatmullRomCurve3(pts).getPoint(t);
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.03, 12), M.yellow);
          band.position.copy(c); band.rotation.x = Math.PI / 2; this.root.add(band);
        }
      }
      // ventilation grilles in the side walls above consoles
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.3), M.black);
      grille.position.set(sx * 1.03, 1.1, -0.15); this.root.add(grille);
      for (let i = 0; i < 9; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.3), M.structure);
        slat.position.set(sx * 1.02, 1.05 + i * 0.012, -0.15); slat.rotation.z = sx * 0.4; this.root.add(slat);
      }
    }
    // conduit from overhead to front
    tube([V3(-0.2, 1.93, -0.1), V3(-0.25, 1.92, -0.5), V3(-0.3, 1.75, -0.9)], 0.02, M.hose);
    tube([V3(0.22, 1.93, -0.1), V3(0.28, 1.9, -0.55), V3(0.33, 1.74, -0.9)], 0.016, M.cable);

    // placards
    const placard = (lines, w, h, pos, rotY, opts = {}) => {
      const S = 1600;
      const c = makeCanvas(Math.round(w * S), Math.round(h * S)), k = c.getContext('2d');
      k.fillStyle = opts.bg || '#d9d4c3'; k.fillRect(0, 0, c.width, c.height);
      if (opts.stripe) { k.fillStyle = opts.stripe; k.fillRect(0, 0, c.width, c.height * 0.28); }
      k.strokeStyle = '#111'; k.lineWidth = 4; k.strokeRect(6, 6, c.width - 12, c.height - 12);
      k.fillStyle = opts.fg || '#111'; k.textAlign = 'center'; k.textBaseline = 'middle';
      lines.forEach(([t, sz, wgt, col], i) => {
        k.font = `${wgt || 600} ${sz * S}px ${FONT_LABEL}`;
        k.fillStyle = col || opts.fg || '#111';
        k.fillText(t, c.width / 2, (opts.y0 || 0.2) * c.height + i * (c.height * (opts.lh || 0.2)));
      });
      // dirt
      for (let i = 0; i < 40; i++) { k.fillStyle = `rgba(60,50,30,${R() * 0.08})`; k.beginPath(); k.arc(R() * c.width, R() * c.height, R() * 20, 0, TAU); k.fill(); }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.55 }));
      m.position.copy(pos); m.rotation.y = rotY; if (opts.rotX) m.rotation.x = opts.rotX;
      this.root.add(m);
      return m;
    };
    placard([['WARNUNG', 0.012, 800, '#fff'], ['HYDRAULIKLEITUNGEN 210 BAR', 0.0085], ['VOR WARTUNG DRUCK ABBAUEN', 0.0085], ['STROMLOS SCHALTEN', 0.0085]], 0.16, 0.07, V3(-1.04, 0.95, -0.45), Math.PI / 2 - 0.08, { stripe: '#b51a12', y0: 0.15, lh: 0.24 });
    placard([['NOTAUSSTIEG', 0.011, 800, '#111'], ['GRIFF ZIEHEN · LUKE NACH OBEN', 0.0075], ['SPRENGBOLZEN', 0.0075, 700, '#b51a12']], 0.15, 0.06, V3(1.02, 1.62, 0.25), -Math.PI / 2 + 0.25, { bg: '#e0b400', y0: 0.22, lh: 0.28 });
    placard([['VOR DEM AUSSTIEG', 0.009, 700], ['FUSS-SPERRE SETZEN', 0.009, 700], ['HALTUNG: HOCKE', 0.009, 700]], 0.12, 0.055, V3(0.9, 0.78, -0.62), -0.55, { y0: 0.24, lh: 0.27 });
    placard([['KESSLER-WERKE', 0.008, 800], ['GW-7 GRAUWOLF', 0.011, 800], ['LEERGEW. 41,6 T · MAX 52 T', 0.006], ['GEPRÜFT 03/2041  ·  QS 118', 0.006]], 0.11, 0.06, V3(-0.9, 0.78, -0.62), 0.55, { bg: '#b9b6ae', y0: 0.18, lh: 0.22 });

    // fire extinguisher on the right wall behind the console
    const ext = new THREE.Group();
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 24), M.red);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.05, 12), M.darkSteel);
    head.position.y = 0.17;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.015), M.steel);
    handle.position.set(0.02, 0.2, 0);
    const strap1 = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.004, 6, 24).rotateX(Math.PI / 2), M.darkSteel);
    strap1.position.y = 0.08;
    const strap2 = strap1.clone(); strap2.position.y = -0.08;
    ext.add(bottle, head, handle, strap1, strap2);
    ext.position.set(0.9, 0.9, 0.35);
    ext.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(ext);

    // hatch handle in the ceiling (yellow/black)
    const hcan = makeCanvas(256, 32), hk = hcan.getContext('2d');
    for (let i = 0; i < 16; i++) { hk.fillStyle = i % 2 ? '#111' : '#e0b400'; hk.beginPath(); hk.moveTo(i * 16, 0); hk.lineTo(i * 16 + 16, 0); hk.lineTo(i * 16 + 8, 32); hk.lineTo(i * 16 - 8, 32); hk.fill(); }
    const hmat = new THREE.MeshStandardMaterial({ map: canvasTex(hcan, true, true), roughness: 0.5 });
    const hbar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 12).rotateZ(Math.PI / 2), hmat);
    hbar.position.set(0, 1.86, 0.32);
    const hstem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 10), M.steel);
    hstem.position.set(0, 1.92, 0.32);
    this.root.add(hbar, hstem);

    // armrests above consoles at the back
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.04, 0.24, 4, 0.016), M.leather);
      arm.position.set(sx * 0.47, 0.715, 0.26); arm.castShadow = true;
      this.root.add(arm);
    }
    // side wall consoles fill (between console and wall)
    for (const sx of [-1, 1]) {
      const fill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.9), M.paint);
      fill.position.set(sx * 0.95, 0.5, -0.2); this.root.add(fill);
    }
  }

  // ------------------------------------------------------------------ lights
  buildLights() {
    const L = this.lights;
    L.dome = new THREE.SpotLight(0xffd2a0, 0, 3.2, 72 * DEG, 0.85, 1.6);
    L.dome.position.set(0, 1.9, 0.12);
    L.dome.target.position.set(0, 0.5, -0.35);
    L.dome.castShadow = true;
    L.dome.shadow.mapSize.set(1024, 1024);
    L.dome.shadow.bias = -0.0008; L.dome.shadow.normalBias = 0.01;
    L.dome.shadow.autoUpdate = false;
    // dome fixture
    const M = materials();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.03, 32), M.darkSteel);
    housing.position.set(0, 1.955, 0.12);
    const fx = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 12, 0, TAU, Math.PI * 0.62, Math.PI * 0.38),
      new THREE.MeshStandardMaterial({ color: 0x8a8378, emissive: 0xffd2a0, emissiveIntensity: 0, roughness: 0.35, transparent: true, opacity: 0.92 }));
    fx.position.set(0, 1.975, 0.12);
    const grid = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.002, 6, 32).rotateX(Math.PI / 2), M.darkSteel);
    grid.position.set(0, 1.935, 0.12);
    L.domeFx = fx;
    this.root.add(L.dome, L.dome.target, housing, fx, grid);

    L.floodL = new THREE.SpotLight(0xffffff, 0, 2.2, 55 * DEG, 0.7, 1.5);
    L.floodL.position.set(-0.42, 1.72, -0.25); L.floodL.target.position.set(-0.3, 0.6, -0.5);
    L.floodR = new THREE.SpotLight(0xffffff, 0, 2.2, 55 * DEG, 0.7, 1.5);
    L.floodR.position.set(0.42, 1.72, -0.25); L.floodR.target.position.set(0.3, 0.6, -0.5);
    for (const f of [L.floodL, L.floodR]) {
      f.castShadow = true; f.shadow.mapSize.set(1024, 1024); f.shadow.bias = -0.0008; f.shadow.normalBias = 0.01; f.shadow.autoUpdate = false;
      this.root.add(f, f.target);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.04, 12), materials().black);
      lamp.position.copy(f.position); lamp.lookAt(f.target.position); lamp.rotateX(Math.PI / 2);
      this.root.add(lamp);
    }
    // MFD spill light
    L.amb = new THREE.HemisphereLight(0x8090a0, 0x202020, 0.06);
    this.root.add(L.amb);
  }

  shadowLights() { return [this.lights.dome, this.lights.floodL, this.lights.floodR]; }

  // ------------------------------------------------------------------ per frame
  update(dt, world) {
    const s = G.sim, L = this.lights;
    // integral lighting
    const lvl = s.P.lights ? s.sw.panelLight * s.P.lightV : 0;
    for (const m of G.panelMats) m.emissiveIntensity = lvl * 1.15;
    for (const m of G.gaugeMats) m.emissiveIntensity = lvl * 0.9;
    // dome light runs on the hot battery bus
    const domeOn = s.sw.dome ? clamp((s.bus.hot - 20) / 6, 0, 1) * (s.sw.bat ? s.P.lightV * 0.95 + 0.05 : 1) : 0;
    L.dome.intensity = approach(L.dome.intensity, domeOn * 5.5, 12, dt);
    L.domeFx.material.emissiveIntensity = L.dome.intensity * 0.25;
    const fl = s.P.ess ? s.sw.flood : 0;
    const fcol = fl === 1 ? 0xff2a12 : 0xfff0dc;
    for (const f of [L.floodL, L.floodR]) {
      f.color.set(fcol);
      f.intensity = approach(f.intensity, fl ? (fl === 1 ? 2.2 : 1.6) * s.P.lightV : 0, 12, dt);
    }

    for (const c of this.controls) c.update(dt);
    for (const m of this.mfds) m.update(dt);
    this.ann.update(dt);

    // sensor displays
    const vis = s.sw.sensorMode;
    for (const sc of this.screens) {
      const i = sc.i;
      const on = s.P.sdu[i];
      sc.boot = s.sens.boot[i];
      const brt = s.sw['sduBrt' + i] ?? 0.85;
      const u = sc.mat.uniforms;
      u.power.value = approach(u.power.value, on ? 1 : 0, on ? 3 : 20, dt);
      u.boot.value = sc.boot;
      u.brightness.value = 0.25 + brt * 1.35;
      u.ir.value = vis;
      u.time.value = G.time;
      sc.led.material.emissiveIntensity = on ? 2 : 0;
      // overlay
      sc.ovTimer -= dt;
      if (sc.ovTimer <= 0 && u.power.value > 0.01) {
        sc.ovTimer = 1 / 15;
        this.drawOverlay(sc, s);
        sc.ovTex.needsUpdate = true;
      }
      // screen emits light into the cockpit
      const img = smoothBoot(sc.boot);
      sc.light.intensity = u.power.value * (0.25 + img * 2.3) * u.brightness.value;
      sc.light.color.setRGB(vis ? 0.7 : 0.62, vis ? 0.7 : 0.7, vis ? 0.7 : 0.78);
    }
    const lightSum = L.dome.intensity * 0.6 + L.floodL.intensity * 0.5 + this.screens.reduce((a, sc) => a + sc.light.intensity, 0) * 0.08;
    this.scene.environmentIntensity = 0.02 + lightSum * 0.06;
  }

  drawOverlay(sc, s) {
    const c = sc.ov, k = c.getContext('2d');
    const W = c.width, H = c.height;
    k.clearRect(0, 0, W, H);
    const green = '#5dff8a';
    k.font = `600 22px ${FONT_MONO}`;
    k.textBaseline = 'middle';
    if (sc.boot < 0.62) {
      k.fillStyle = 'rgba(0,0,0,1)'; k.fillRect(0, 0, W, H);
      k.fillStyle = '#cfd8d4'; k.textAlign = 'left';
      const t = sc.boot / 0.62;
      const lines = ['SDU-3 SENSOR DISPLAY UNIT', 'FW 2.08.1  SN 30418-' + sc.i, '', 'SELBSTTEST ......... ' + (t > 0.25 ? 'OK' : ''), 'PANEL-TEMP ......... 21 °C', 'VIDEO-EINGANG ...... ' + (t > 0.55 ? 'KAM-' + ['L', 'M', 'R'][sc.i] : 'SUCHE'), 'SYNCHRONISATION .... ' + (t > 0.85 ? 'OK' : '')];
      lines.forEach((l, j) => { if (t * 9 > j) k.fillText(l, 60, 80 + j * 34); });
      if (Math.floor(G.time * 3) % 2) k.fillRect(60, 80 + lines.length * 34, 14, 22);
      return;
    }
    // camera caption
    k.fillStyle = 'rgba(220,240,230,0.85)';
    k.textAlign = 'left';
    k.font = `600 18px ${FONT_MONO}`;
    k.fillText(`KAM-${['L', 'M', 'R'][sc.i]}  ${s.sw.sensorMode ? 'IR WH' : 'TV'}  ${sc.i === 1 ? 'WFOV' : 'SEITE'}`, 24, 26);
    const d = new Date();
    k.textAlign = 'right';
    k.fillText(`${d.toLocaleTimeString('de-DE')}`, W - 24, 26);
    if (sc.i === 1 && s.P.hud) this.drawHUD(k, W, H, s);
  }

  drawHUD(k, W, H, s) {
    const col = 'rgba(110,255,150,0.92)';
    k.strokeStyle = col; k.fillStyle = col; k.lineWidth = 2;
    k.font = `600 20px ${FONT_MONO}`;
    const w = s.walk;
    // heading tape
    const hdg = ((-w.heading / DEG) % 360 + 360) % 360;
    const cx = W / 2;
    k.save();
    k.beginPath(); k.rect(cx - 260, 40, 520, 60); k.clip();
    for (let d = Math.floor(hdg / 5) * 5 - 60; d <= hdg + 60; d += 5) {
      const x = cx + (d - hdg) * 4.3;
      const dd = ((d % 360) + 360) % 360;
      k.beginPath(); k.moveTo(x, 90); k.lineTo(x, dd % 10 === 0 ? 76 : 83); k.stroke();
      if (dd % 10 === 0) { k.textAlign = 'center'; k.fillText(dd === 0 ? 'N' : dd === 90 ? 'O' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0'), x, 60); }
    }
    k.restore();
    k.beginPath(); k.moveTo(cx, 93); k.lineTo(cx - 8, 104); k.lineTo(cx + 8, 104); k.closePath(); k.fill();
    // boresight
    const by = H * 0.42;
    k.beginPath(); k.moveTo(cx - 40, by); k.lineTo(cx - 14, by); k.lineTo(cx - 7, by + 10); k.lineTo(cx, by); k.lineTo(cx + 7, by + 10); k.lineTo(cx + 14, by); k.lineTo(cx + 40, by); k.stroke();
    // horizon / roll from gyro
    if (s.gyro.ok) {
      const roll = (this.rollDeg || 0) * DEG, pitch = this.pitchDeg || 0;
      k.save(); k.translate(cx, by + pitch * 8); k.rotate(-roll);
      k.beginPath(); k.moveTo(-220, 0); k.lineTo(-70, 0); k.moveTo(70, 0); k.lineTo(220, 0); k.stroke();
      k.restore();
    }
    // speed box (left) & throttle
    k.textAlign = 'right';
    k.strokeRect(70, by - 22, 120, 44);
    k.font = `700 28px ${FONT_MONO}`;
    k.fillText((w.speed * 3.6).toFixed(0), 180, by + 1);
    k.font = `600 16px ${FONT_MONO}`;
    k.textAlign = 'left';
    k.fillText('KM/H', 72, by + 38);
    k.fillText(GAITS[s.sw.gait].name, 72, by - 38);
    // throttle command bar
    k.strokeRect(210, by - 70, 12, 140);
    const t = s.sw.throttle;
    const y0 = by + 70 - (0.3 / 1.3) * 140;
    k.beginPath(); k.moveTo(204, y0); k.lineTo(228, y0); k.stroke();
    k.fillRect(212, Math.min(y0, y0 - t / 1.3 * 140), 8, Math.abs(t / 1.3 * 140));
    // right: posture / status
    k.textAlign = 'right';
    k.font = `600 18px ${FONT_MONO}`;
    const p = s.act.posture;
    k.fillText(p > 0.99 ? 'STAND' : p < 0.01 ? 'HOCKE' : `HALTUNG ${Math.round(p * 100)}%`, W - 60, by - 40);
    k.fillText(`N2 ${(s.mtg.n2 * 100).toFixed(0)}%`, W - 60, by - 12);
    k.fillText(`HYD ${Math.min(s.hyd.a, s.hyd.b).toFixed(0)}`, W - 60, by + 16);
    // bottom advisories
    k.textAlign = 'center';
    k.font = `700 22px ${FONT_MONO}`;
    let msg = '';
    if (s.sw.estop) msg = 'NOT-AUS';
    else if (s.act.posture > 0.99 && !s.sw.footLock) msg = 'FUSS-SPERRE';
    else if (s.act.posture > 0.99 && w.canWalk) msg = '';
    else if (s.act.posture < 0.99 && s.act.target === 1) msg = 'AUFRICHTEN';
    if (msg && Math.floor(G.time * 2) % 2 === 0) { k.strokeRect(cx - 110, H - 96, 220, 40); k.fillText(msg, cx, H - 75); }
    // pitch / roll readout
    k.font = `600 16px ${FONT_MONO}`;
    k.fillText(`NEIG ${(this.pitchDeg || 0).toFixed(1)}°  ROLL ${(this.rollDeg || 0).toFixed(1)}°`, cx, H - 30);
  }
}

function smoothBoot(b) { return clamp((b - 0.62) / 0.38, 0, 1); }

function screenMaterial(ovTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      feed: { value: null }, overlay: { value: ovTex }, power: { value: 0 }, boot: { value: 0 }, time: { value: 0 },
      ir: { value: 0 }, brightness: { value: 1 }, res: { value: new THREE.Vector2(1920, 1080) }, exposure: { value: 0.85 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D feed; uniform sampler2D overlay;
      uniform float power, boot, time, ir, brightness, exposure; uniform vec2 res;
      varying vec2 vUv;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        float img = clamp((boot - 0.62) / 0.38, 0.0, 1.0);
        // sync wobble while locking on
        uv.x += (1.0 - img) * 0.01 * sin(uv.y * 80.0 + time * 30.0) * step(0.001, img);
        vec4 src = texture2D(feed, uv);
        vec3 col = aces(src.rgb * exposure);
        if (ir > 0.5) {
          // crude thermal model: sun-warmed ground and objects, cold sky, hot emitters
          float sky = 1.0 - src.a;
          float l = dot(col, vec3(0.3, 0.59, 0.11));
          float heat = 0.18 + l * 0.55 + max(0.0, dot(src.rgb, vec3(0.33)) - 2.5) * 0.4;
          heat = mix(heat, 0.06 + l * 0.08, sky);
          heat = pow(clamp(heat, 0.0, 1.0), 0.9);
          col = vec3(heat) * vec3(0.95, 1.0, 0.97);
        }
        vec2 px = uv * res;
        float n = hash(floor(px) + fract(time * 13.7) * 91.0) - 0.5;
        col += n * (0.022 + ir * 0.03 + (1.0 - img) * 0.5);
        vec2 d = uv - 0.5;
        col *= 1.0 - dot(d, d) * 0.45;
        col *= img;
        vec4 o = texture2D(overlay, vUv);
        col = mix(col, o.rgb, o.a);
        // LCD pixel structure, visible only up close
        vec2 f = fract(px);
        float fw = max(fwidth(px.x), fwidth(px.y));
        float grid = 0.78 + 0.22 * smoothstep(0.0, 0.18, f.x) * smoothstep(0.0, 0.18, f.y) * smoothstep(1.0, 0.82, f.y);
        col *= mix(1.0, grid, clamp(1.6 - fw * 1.8, 0.0, 1.0));
        vec3 black = vec3(0.004, 0.0045, 0.005);
        gl_FragColor = vec4((col * brightness + black) * power, 1.0);
      }
    `,
  });
}
