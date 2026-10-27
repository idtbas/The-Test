// Exterior world seen through the sensor displays.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, makeNoise, fbm, makeCanvas, canvasTex, rng, clamp, lerp, smoothstep, DEG, TAU } from './util.js';

const noise = makeNoise(1234);
const noise2 = makeNoise(777);

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = fbm(noise, x / 700, z / 700, 5) * 70 + fbm(noise2, x / 160, z / 160, 3) * 6;
  // mountain ring
  const m = smoothstep(900, 1900, r);
  if (m > 0) {
    const ridge = 1 - Math.abs(fbm(noise2, x / 500 + 9, z / 500 - 3, 4) * 2);
    h += m * (90 + ridge * ridge * 260);
  }
  // road heading north (-z) from the depot
  const road = (1 - smoothstep(7, 22, Math.abs(x - Math.sin(z / 300) * 40 + Math.sin(0) * 40))) * (z < 0 ? 1 : 0) * (1 - smoothstep(1100, 1300, -z));
  const roadH = fbm(noise, x / 700, z / 700, 2) * 40;
  h = lerp(h, roadH, road * 0.85);
  // flatten depot area to 0
  const f = smoothstep(70, 230, r);
  return h * f;
}

function roadMask(x, z) {
  if (z > 0 || -z > 1250) return 0;
  return 1 - smoothstep(4.5, 6.5, Math.abs(x - Math.sin(z / 300) * 40));
}

// Collects static geometry per material and merges it into a few draw calls.
class Merger {
  constructor(scene) { this.scene = scene; this.buckets = new Map(); }
  add(geo, mat, x, y, z, ry = 0, rx = 0, shadow = true) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = geo.clone().applyMatrix4(m);
    const key = mat.uuid + (shadow ? 's' : 'n') + Object.keys(g.attributes).sort().join();
    if (!this.buckets.has(key)) this.buckets.set(key, { mat, shadow, geos: [] });
    this.buckets.get(key).geos.push(g);
  }
  flush() {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.buckets.clear();
  }
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    this.t = 0;
    this.sunDir = new THREE.Vector3();
    const elev = 14 * DEG, az = -128 * DEG;
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));

    // Sky
    const sky = new Sky();
    sky.scale.setScalar(15000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    u.cloudCoverage.value = 0.48; u.cloudDensity.value = 0.55; u.cloudSpeed.value = 0.00006;
    // sky writes alpha 0: the display shader uses it as a mask (cold sky in IR)
    sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor, 0.0 );');
    scene.add(sky);
    this.sky = sky;

    // environment from sky
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.turbidity, { value: 5.5 });
    sky2.material.uniforms.rayleigh.value = 1.6; sky2.material.uniforms.mieCoefficient.value = 0.004;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    const groundEnv = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2c2a22 }));
    groundEnv.position.y = -5; envScene.add(groundEnv);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.6;

    const fogCol = new THREE.Color(0.62, 0.66, 0.70);
    scene.fog = new THREE.FogExp2(fogCol, 0.00042);

    const sun = this.sun = new THREE.DirectionalLight(0xffe2bd, 3.2);
    sun.position.copy(this.sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 800;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    sun.shadow.camera.layers.enable(1);
    sun.shadow.autoUpdate = false;
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xa9c3dc, 0x4a4030, 0.55);
    scene.add(hemi);

    // mech flood lights
    this.headlights = [];
    for (const sx of [-1, 1]) {
      const l = new THREE.SpotLight(0xfff1dc, 0, 140, 22 * DEG, 0.5, 1.6);
      l.position.set(sx * 1.4, -0.6, -1.0);
      this.headlights.push(l);
    }
    this.headGroup = new THREE.Group();
    for (const l of this.headlights) { this.headGroup.add(l, l.target); l.target.position.set(l.position.x * 2, -9, -40); }
    scene.add(this.headGroup);

    this.merger = new Merger(scene);
    this.buildTerrain();
    this.buildDepot();
    this.buildScatter();
    this.buildDistant();
    this.merger.flush();
    this.buildMechProxy();
    this.buildNavMap();

    // cameras for the three displays
    this.cams = [0, 1, 2].map(() => {
      const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.25, 20000);
      c.layers.set(0);
      return c;
    });
    this.rts = [];
    this.setResolution(1280);
  }

  setResolution(w) {
    const h = Math.round(w * 0.565);
    for (const rt of this.rts) rt.dispose();
    this.rts = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace,
    }));
    this.onResize?.();
  }

  // Kooima generalized perspective projection for a screen rectangle seen from eye pe
  setupScreen(i, pa, pb, pc, pe) {
    const vr = new THREE.Vector3().subVectors(pb, pa).normalize();
    const vu = new THREE.Vector3().subVectors(pc, pa).normalize();
    const vn = new THREE.Vector3().crossVectors(vr, vu).normalize();
    const va = new THREE.Vector3().subVectors(pa, pe);
    const vb = new THREE.Vector3().subVectors(pb, pe);
    const vc = new THREE.Vector3().subVectors(pc, pe);
    const d = -va.dot(vn);
    const n = 0.25, f = 20000;
    const l = vr.dot(va) * n / d, r = vr.dot(vb) * n / d, b = vu.dot(va) * n / d, t = vu.dot(vc) * n / d;
    const cam = this.cams[i];
    cam.projectionMatrix.makePerspective(l, r, t, b, n, f);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.userData.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(vr, vu, vn));
  }

  buildTerrain() {
    const size = 4400, seg = 320;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const R = rng(5);
    const grass = new THREE.Color(0.13, 0.15, 0.075), dry = new THREE.Color(0.27, 0.24, 0.14), dirt = new THREE.Color(0.21, 0.17, 0.12);
    const rock = new THREE.Color(0.30, 0.29, 0.27), snow = new THREE.Color(0.82, 0.85, 0.9), road = new THREE.Color(0.11, 0.11, 0.11);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const slope = 1 - nrm.getY(i);
      const n1 = fbm(noise2, x / 90, z / 90, 3);
      c.copy(grass).lerp(dry, clamp(0.5 + n1 * 1.6, 0, 1));
      c.lerp(dirt, clamp(0.4 - n1 * 1.2, 0, 1) * 0.7);
      c.lerp(rock, smoothstep(0.12, 0.3, slope));
      c.lerp(snow, smoothstep(230, 300, y) * smoothstep(0.35, 0.15, slope));
      const r = Math.hypot(x, z);
      c.lerp(dirt, (1 - smoothstep(60, 120, r)) * 0.85);
      c.lerp(road, roadMask(x, z) * 0.8);
      c.multiplyScalar(0.92 + R() * 0.1);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // detail texture (tiling every 6 m)
    const dc = makeCanvas(512, 512), k = dc.getContext('2d');
    const img = k.createImageData(512, 512);
    const n3 = makeNoise(99);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 0.7 + fbm(n3, x / 512 * 16, y / 512 * 16, 4, 16) * 0.5 + (Math.random() - 0.5) * 0.12;
      const i = (y * 512 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 1) * 255; img.data[i + 3] = 255;
    }
    k.putImageData(img, 0, 0);
    const det = canvasTex(dc, true, true);
    det.repeat.set(size / 6, size / 6);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: det, roughness: 0.95, metalness: 0, bumpMap: det, bumpScale: 2 });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    this.terrain = terrain;
  }

  buildDepot() {
    const S = this.scene;
    const R = rng(77);
    // concrete pad with expansion joints
    const cc = makeCanvas(1024, 1024), k = cc.getContext('2d');
    const n = makeNoise(5);
    const img = k.createImageData(1024, 1024);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const v = 0.62 + fbm(n, x / 1024 * 8, y / 1024 * 8, 5, 8) * 0.22 + (Math.random() - 0.5) * 0.05;
      const i = (y * 1024 + x) * 4;
      img.data[i] = v * 245; img.data[i + 1] = v * 242; img.data[i + 2] = v * 235; img.data[i + 3] = 255;
    }
    k.putImageData(img, 0, 0);
    k.strokeStyle = 'rgba(30,30,30,0.8)'; k.lineWidth = 4;
    k.strokeRect(0, 0, 1024, 1024);
    // oil stains
    for (let i = 0; i < 8; i++) {
      const x = R() * 1024, y = R() * 1024, r = 30 + R() * 90;
      const g = k.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(20,18,15,0.35)'); g.addColorStop(1, 'rgba(20,18,15,0)');
      k.fillStyle = g; k.beginPath(); k.arc(x, y, r, 0, TAU); k.fill();
    }
    const ct = canvasTex(cc, true, true); ct.repeat.set(10, 10);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(80, 0.4, 80), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.9, bumpMap: ct, bumpScale: 1.5 }));
    pad.position.y = -0.18; pad.receiveShadow = true; S.add(pad);
    // painted bay markings
    const mark = new THREE.MeshStandardMaterial({ color: 0xc9a400, roughness: 0.8 });
    for (const [x, z, w, d] of [[-9, 0, 0.3, 20], [9, 0, 0.3, 20], [0, -10, 18, 0.3], [0, 10, 18, 0.3]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mark); m.position.set(x, 0.03, z); m.receiveShadow = true; S.add(m);
    }

    const yellow = new THREE.MeshStandardMaterial({ color: 0xc89a12, roughness: 0.6, metalness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.5, metalness: 0.8 });
    const grating = new THREE.MeshStandardMaterial({ color: 0x3d4042, roughness: 0.7, metalness: 0.7 });
    const mg = this.merger;
    const add = (geo, mat, x, y, z, ry = 0, rx = 0, shadow = true) => mg.add(geo, mat, x, y, z, ry, rx, shadow);

    // maintenance gantry: two lattice towers either side of the bay + bridge behind
    const lampMatG = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d6, emissiveIntensity: 6 });
    for (const sx of [-1, 1]) {
      const x0 = sx * 8.5;
      for (const [dx, dz] of [[-1.2, -2], [1.2, -2], [-1.2, 2.5], [1.2, 2.5]]) add(new THREE.BoxGeometry(0.35, 17, 0.35), yellow, x0 + dx, 8.5, dz);
      for (let h = 1.5; h < 17; h += 2.8) {
        add(new THREE.BoxGeometry(2.6, 0.2, 0.2), yellow, x0, h, -2);
        add(new THREE.BoxGeometry(2.6, 0.2, 0.2), yellow, x0, h, 2.5);
        add(new THREE.BoxGeometry(0.2, 0.2, 4.6), yellow, x0 - 1.2, h, 0.25);
        add(new THREE.BoxGeometry(0.2, 0.2, 4.6), yellow, x0 + 1.2, h, 0.25);
        add(new THREE.BoxGeometry(0.12, 3.4, 0.12), steel, x0 - 1.2, h + 1.4, 0.25, 0, 0.9);
        add(new THREE.BoxGeometry(0.12, 3.4, 0.12), steel, x0 + 1.2, h + 1.4, 0.25, 0, -0.9);
      }
      // work platforms reaching towards the mech
      for (const h of [5.6, 9.8]) {
        add(new THREE.BoxGeometry(4.2, 0.12, 4.8), grating, x0 - sx * 2.6, h, 0.25);
        add(new THREE.BoxGeometry(0.06, 1.1, 4.8), yellow, x0 - sx * 4.6, h + 0.55, 0.25);
        add(new THREE.BoxGeometry(4.2, 0.06, 0.06), yellow, x0 - sx * 2.6, h + 1.1, -2.1);
      }
      add(new THREE.BoxGeometry(0.6, 0.4, 0.3), lampMatG, x0 - sx * 1.4, 14, -2.2, 0, 0, false);
    }
    add(new THREE.BoxGeometry(19.5, 1.1, 1.2), yellow, 0, 16.8, 3.2);
    // hoses hanging from the gantry
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const pts = [new THREE.Vector3(sx * 7, 9.8, -1), new THREE.Vector3(sx * 5.5, 6, -0.5), new THREE.Vector3(sx * 4.3, 3.2, 0.2), new THREE.Vector3(sx * 3.2, 5.0, 0.6)];
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.09, 8), hoseMat, 0, 0, 0);
    }

    // containers: one shared corrugated texture, colour per container via vertex colours
    const cvs = makeCanvas(512, 128), ck = cvs.getContext('2d');
    ck.fillStyle = '#c8c8c8'; ck.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 512; i += 8) { ck.fillStyle = 'rgba(0,0,0,0.22)'; ck.fillRect(i, 0, 3, 128); ck.fillStyle = 'rgba(255,255,255,0.08)'; ck.fillRect(i + 4, 0, 2, 128); }
    for (let i = 0; i < 60; i++) { ck.fillStyle = `rgba(110,60,25,${R() * 0.3})`; ck.fillRect(R() * 512, R() * 128, R() * 30, R() * 50); }
    ck.fillStyle = 'rgba(0,0,0,0.25)'; ck.fillRect(0, 0, 512, 6); ck.fillRect(0, 122, 512, 6);
    const ctex = canvasTex(cvs, true);
    const contMat = new THREE.MeshStandardMaterial({ map: ctex, vertexColors: true, roughness: 0.7, metalness: 0.45, bumpMap: ctex, bumpScale: 2 });
    const cont = (x, z, ry, color, y = 1.3) => {
      const geo = new THREE.BoxGeometry(12.2, 2.6, 2.45);
      const c = new THREE.Color(color);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      add(geo, contMat, x, y, z, ry);
    };
    const colors = ['#7c2d1d', '#1f4a73', '#2f5233', '#8a8a86', '#a35b16', '#5a2c1e'];
    let ci = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      cont(-28 - j * 2.8, -18 - i * 14, 0.02 * (R() - 0.5), colors[(ci++) % colors.length], 1.3);
      if (R() > 0.4) cont(-28 - j * 2.8, -18 - i * 14, 0.03 * (R() - 0.5), colors[(ci++) % colors.length], 3.9);
    }
    for (let i = 0; i < 3; i++) cont(30, -26 - i * 3, Math.PI / 2 + 0.02, colors[(ci++) % colors.length], 1.3);
    cont(30, -29.5, Math.PI / 2, colors[1], 3.9);

    // fuel tanks
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xb8b5aa, roughness: 0.45, metalness: 0.6 });
    for (let i = 0; i < 3; i++) {
      add(new THREE.CylinderGeometry(4.5, 4.5, 9, 32), tankMat, 48 + i * 11, 4.5, -48);
      add(new THREE.SphereGeometry(4.5, 32, 12, 0, TAU, 0, Math.PI / 2), tankMat, 48 + i * 11, 9, -48);
    }
    // control building
    const bldMat = new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 0.85 });
    add(new THREE.BoxGeometry(22, 7, 12), bldMat, -50, 3.5, -55);
    add(new THREE.BoxGeometry(6, 14, 6), bldMat, -40, 7, -48);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2730, roughness: 0.1, metalness: 0.9, emissive: 0xffd8a0, emissiveIntensity: 0.15 });
    add(new THREE.BoxGeometry(6.2, 2.2, 6.2), glassMat, -40, 12.5, -48);
    // light masts
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x777b7d, roughness: 0.5, metalness: 0.8 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0d0, emissiveIntensity: 8 });
    for (const [x, z] of [[-38, 38], [38, 38], [-38, -38], [38, -38]]) {
      add(new THREE.CylinderGeometry(0.25, 0.4, 22, 10), poleMat, x, 11, z);
      add(new THREE.BoxGeometry(2.6, 0.6, 0.8), lampMat, x, 22, z, 0, 0, false);
    }
    // fence posts along the depot border
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6);
    const posts = new THREE.InstancedMesh(postGeo, poleMat, 160);
    let pi = 0;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      for (const [x, z] of [[-60 + i * 3, -60], [-60 + i * 3, 60], [-60, -60 + i * 3], [60, -60 + i * 3]]) {
        if (Math.abs(x) < 10 && z < 0) continue; // gate
        m4.makeTranslation(x, 1.2, z); posts.setMatrixAt(pi++, m4);
      }
    }
    posts.count = pi; posts.castShadow = true; S.add(posts);
  }

  buildScatter() {
    const S = this.scene;
    const R = rng(31);
    // rocks
    const rg = new THREE.IcosahedronGeometry(1, 1);
    const p = rg.attributes.position;
    for (let i = 0; i < p.count; i++) { const f = 0.75 + R() * 0.5; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.7, p.getZ(i) * f); }
    rg.computeVertexNormals();
    const rocks = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x6c665d, roughness: 0.95, flatShading: true }), 1400);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0;
    while (n < 1400) {
      const x = (R() - 0.5) * 3000, z = (R() - 0.5) * 3000;
      const r = Math.hypot(x, z);
      if (r < 90 || roadMask(x, z) > 0.1) continue;
      const sz = 0.4 + Math.pow(R(), 3) * 5;
      q.setFromEuler(new THREE.Euler(R() * 0.5, R() * TAU, R() * 0.5));
      s.set(sz, sz, sz); v.set(x, heightAt(x, z) + sz * 0.2, z);
      m.compose(v, q, s); rocks.setMatrixAt(n++, m);
    }
    rocks.castShadow = rocks.receiveShadow = true;
    S.add(rocks);
    // conifers in patches
    const trunkG = new THREE.CylinderGeometry(0.15, 0.25, 3, 6).translate(0, 1.5, 0);
    const crownG = new THREE.ConeGeometry(2.2, 8, 8).translate(0, 6.5, 0);
    const N = 2600;
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 1 }), N);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x24321f, roughness: 0.95 }), N);
    const centers = Array.from({ length: 24 }, () => {
      let x, z;
      do { x = (R() - 0.5) * 3200; z = (R() - 0.5) * 3200; } while (Math.hypot(x, z) < 320);
      return [x, z, 60 + R() * 140];
    });
    const col = new THREE.Color();
    n = 0;
    while (n < N) {
      const c = centers[Math.floor(R() * centers.length)];
      const a = R() * TAU, d = Math.sqrt(R()) * c[2];
      const x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
      if (roadMask(x, z) > 0) continue;
      const y = heightAt(x, z);
      if (y > 260) continue;
      const sz = 0.7 + R() * 0.8;
      m.compose(v.set(x, y - 0.2, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * TAU), s.set(sz, sz * (0.9 + R() * 0.4), sz));
      trunks.setMatrixAt(n, m); crowns.setMatrixAt(n, m);
      crowns.setColorAt(n, col.setHSL(0.27 + R() * 0.06, 0.25 + R() * 0.15, 0.13 + R() * 0.06));
      n++;
    }
    trunks.castShadow = crowns.castShadow = true;
    S.add(trunks, crowns);
  }

  buildDistant() {
    const S = this.scene;
    const R = rng(8);
    // ruined town to the north
    const bm = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 });
    const wc = makeCanvas(64, 128), wk = wc.getContext('2d');
    wk.fillStyle = '#7a766f'; wk.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 16) for (let x = 6; x < 64; x += 16) { wk.fillStyle = R() > 0.3 ? '#1b1d1f' : '#3a3a38'; wk.fillRect(x, y, 8, 9); }
    const wt = canvasTex(wc, true, true);
    const bmW = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9 });
    for (let i = 0; i < 70; i++) {
      const x = (R() - 0.5) * 700 + 120, z = -820 - R() * 500;
      const w = 12 + R() * 22, d = 12 + R() * 22, h = 8 + Math.pow(R(), 2) * 45;
      const geo = new THREE.BoxGeometry(w, h, d);
      // scale UVs so windows keep their size; roofs sample plain wall colour
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i2 = f * 4 + k;
        if (f === 2 || f === 3) { uv.setXY(i2, 0.02, 0.98); continue; }
        uv.setXY(i2, uv.getX(i2) * (f < 2 ? d : w) / 8, uv.getY(i2) * h / 8);
      }
      this.merger.add(geo, bmW, x, heightAt(x, z) + h / 2 - 1, z, (R() - 0.5) * 0.3);
    }
    // wind turbines on the ridges
    this.rotors = [];
    const tw = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5 });
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.32 + R() * 0.1, r = 1350 + R() * 250;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      const y = heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 90, 12).translate(0, 45, 0), tw);
      const nac = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 10), tw); nac.position.set(0, 91, 0);
      const rotor = new THREE.Group(); rotor.position.set(0, 91, -5.5);
      for (let b = 0; b < 3; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 46, 0.6).translate(0, 23, 0), tw);
        bl.rotation.z = b * TAU / 3; rotor.add(bl);
      }
      rotor.rotation.z = R() * TAU;
      g.rotation.y = 0.4;
      g.add(tower, nac, rotor);
      tower.castShadow = true;
      S.add(g);
      this.rotors.push(rotor);
    }
    // power line pylons along the east
    const pyl = new THREE.MeshStandardMaterial({ color: 0x5b5f61, roughness: 0.6, metalness: 0.7 });
    for (let i = 0; i < 14; i++) {
      const x = 260 + i * 12, z = 300 - i * 140;
      const y = heightAt(x, z);
      this.merger.add(new THREE.CylinderGeometry(0.6, 2.4, 34, 4), pyl, x, y + 17, z);
      this.merger.add(new THREE.BoxGeometry(16, 0.8, 0.8), pyl, x, y + 30, z);
      this.merger.add(new THREE.BoxGeometry(11, 0.8, 0.8), pyl, x, y + 25, z);
    }
  }

  // Shadow-only stand-in for our own mech (layer 1: seen by the sun's shadow camera, not by the view cameras)
  buildMechProxy() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const g = new THREE.Group();
    const add = (geo, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.layers.set(1); parent.add(m); return m; };
    this.mech = { root: g, legs: [] };
    this.mech.torso = add(new THREE.BoxGeometry(4.2, 3.2, 4.0), 0, 0, 0);
    add(new THREE.BoxGeometry(2.4, 1.6, 2.6), 0, 2.2, -0.6, this.mech.torso);
    add(new THREE.BoxGeometry(1.0, 1.0, 4.5), -2.8, 0.4, -1.2, this.mech.torso);
    add(new THREE.BoxGeometry(1.0, 1.0, 4.5), 2.8, 0.4, -1.2, this.mech.torso);
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 1.7, -1.4, 0); g.add(hip);
      const thigh = add(new THREE.BoxGeometry(1.1, 4.0, 1.3), 0, -2.0, 0, hip);
      const kneeG = new THREE.Group(); kneeG.position.set(0, -4.0, 0); hip.add(kneeG);
      add(new THREE.BoxGeometry(0.9, 4.2, 1.0), 0, -2.1, 0, kneeG);
      const ankle = new THREE.Group(); ankle.position.set(0, -4.2, 0); kneeG.add(ankle);
      add(new THREE.BoxGeometry(1.6, 0.6, 3.0), 0, -0.3, -0.4, ankle);
      this.mech.legs.push({ hip, knee: kneeG, ankle, thigh });
    }
    this.scene.add(g);
  }

  buildNavMap() {
    const N = 512, size = 4000;
    const c = makeCanvas(N, N), k = c.getContext('2d');
    const img = k.createImageData(N, N);
    const hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * size, z = (j / N - 0.5) * size;
      hs[j * N + i] = heightAt(x, z);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = hs[j * N + i];
      const hx = hs[j * N + Math.min(N - 1, i + 1)] - h, hz = hs[Math.min(N - 1, j + 1) * N + i] - h;
      const shade = clamp(0.5 - (hx + hz) * 0.05, 0, 1);
      const contour = Math.abs((h / 25) - Math.round(h / 25)) < 0.06 ? 1 : 0;
      const p = (j * N + i) * 4;
      const base = 18 + h * 0.12;
      img.data[p] = base * 0.4 + contour * 40;
      img.data[p + 1] = base + shade * 30 + contour * 70;
      img.data[p + 2] = base * 0.9 + shade * 25 + contour * 60;
      img.data[p + 3] = 255;
      const x = (i / N - 0.5) * size, z = (j / N - 0.5) * size;
      if (roadMask(x, z) > 0.5) { img.data[p] = 120; img.data[p + 1] = 110; img.data[p + 2] = 90; }
    }
    k.putImageData(img, 0, 0);
    this.navMap = c; this.navMapSize = size;
  }

  // pose: {pos: Vector3 (head/eye mount), quat: Quaternion}, gait for the shadow proxy
  update(dt, pose, sim) {
    this.t += dt;
    for (const r of this.rotors) r.rotation.z += dt * 0.9;
    this.sky.material.uniforms.time.value = this.t;
    // keep sun shadow camera around the mech
    const p = pose.pos;
    this.sun.position.set(p.x, 0, p.z).addScaledVector(this.sunDir, 300);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
    // headlights
    this.headGroup.position.copy(pose.pos); this.headGroup.quaternion.copy(pose.bodyQuat);
    const on = sim.P.ext ? 1 : 0;
    for (const l of this.headlights) l.intensity = on * 9000;
    // mech shadow proxy
    const m = this.mech;
    m.root.position.set(p.x, p.y - 1.4, p.z);
    m.root.quaternion.copy(pose.bodyQuat);
    const post = sim.act.posture;
    const ph = sim.walk.phase * Math.PI;
    for (let i = 0; i < 2; i++) {
      const L = m.legs[i];
      const sw = Math.sin(ph + i * Math.PI) * clamp(sim.walk.speedAbs / 4, 0, 1) * 0.5;
      const crouch = (1 - post) * 0.9;
      L.hip.rotation.x = -crouch - sw;
      L.knee.rotation.x = crouch * 2 + Math.max(0, Math.sin(ph + i * Math.PI)) * 0.6 * clamp(sim.walk.speedAbs / 4, 0, 1);
      L.ankle.rotation.x = -crouch + sw * 0.5;
    }
  }

  renderFeeds(renderer, pose, enabled) {
    const prevTarget = renderer.getRenderTarget();
    this.sun.shadow.needsUpdate = true;
    for (let i = 0; i < 3; i++) {
      if (!enabled[i]) continue;
      const cam = this.cams[i];
      cam.position.copy(pose.pos);
      cam.quaternion.copy(pose.quat).multiply(cam.userData.q);
      cam.updateMatrixWorld();
      renderer.setRenderTarget(this.rts[i]);
      renderer.render(this.scene, cam);
    }
    renderer.setRenderTarget(prevTarget);
  }
}
