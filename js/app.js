// Application core: scene graph, character meshes, materials and the render loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Character } from './core/character.js';
import { Renderer, LAYER_SKIN, LAYER_AO } from './render/renderer.js';
import { Stage } from './render/environment.js';
import { createSkinMaterial, sharedSkinUniforms, withSSAO } from './render/skinMaterial.js';
import { SkinBaker, SKIN_DEFAULTS } from './render/skinBake.js';
import { createEyeMaterial, createCorneaMaterial, applyEyeParams, EYE_DEFAULTS } from './render/eyes.js';
import { ageInYears } from './core/human.js';
import { HairSystem } from './hair/hair.js';
import { Clothing } from './render/clothing.js';

function dynAttr(arr, size) {
  const a = new THREE.BufferAttribute(arr, size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

export class App {
  constructor(canvas, assets, opts = {}) {
    this.canvas = canvas;
    this.assets = assets;
    this.opts = opts;
    this.skinU = sharedSkinUniforms();
    this.renderer = new Renderer(canvas, this.skinU);
    this.gl = this.renderer.gl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.03, 40);
    this.camera.position.set(0, 1.05, 4.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.92, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 0.18;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.update();
    this._setupDoubleTap(canvas);

    this.character = new Character(assets, { subdivision: opts.subdivision ?? 1 });
    this.stage = new Stage(this.gl, this.scene, this.skinU);
    this.skin = { ...SKIN_DEFAULTS };
    this.eyeParams = { ...EYE_DEFAULTS };
    this.gazeMode = 'camera';
    this.dirty = true;
    this._buildMeshes();
    this.baker = new SkinBaker(this.gl, this.character, opts.textureSize || 2048);
    this.skinU.tAlbedo.value = this.baker.albedo;
    this.skinU.tMaps.value = this.baker.maps;
    this.hair = new HairSystem(this, opts.hairQuality ?? 1);
    this.hair.setAmbient(new THREE.Color(0.42, 0.43, 0.46), new THREE.Color(0.14, 0.13, 0.12), 1);
    this.clothing = new Clothing(this);
    this.stage.apply('studio');
    this.clock = new THREE.Timer();
    this.listeners = new Set();
    this.blink = { t: 0, next: 2.5, phase: -1 };
    this.blinking = opts.blinking ?? true;
    this.accum = 0;
    this.maxAccum = opts.maxAccum ?? 32;
    this.autoQuality = true;
    this.renderer.settings.scale = opts.scale ?? 0.85;
  }

  _buildMeshes() {
    const ch = this.character;
    ch.update();
    const body = ch.parts.body;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', dynAttr(body.position, 3));
    g.setAttribute('normal', dynAttr(body.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(body.uv, 2));
    g.setAttribute('aRest', new THREE.BufferAttribute(body.rest, 3));
    g.setAttribute('aThick', new THREE.BufferAttribute(body.thickness, 1));
    g.setIndex(new THREE.BufferAttribute(body.index, 1));
    this.skinMat = createSkinMaterial(this.skinU, 2);
    this.skinMatPass1 = createSkinMaterial(this.skinU, 1);
    this.skinMatSingle = createSkinMaterial(this.skinU, 0);
    this.body = new THREE.Mesh(g, this.skinMat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.layers.enable(LAYER_SKIN);
    this.body.layers.enable(LAYER_AO);
    this.body.frustumCulled = false;
    this.scene.add(this.body);

    // mouth interior
    const mk = (part, mat) => {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', dynAttr(part.position, 3));
      pg.setAttribute('normal', dynAttr(part.normal, 3));
      pg.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
      pg.setIndex(new THREE.BufferAttribute(part.index, 1));
      const m = new THREE.Mesh(pg, mat);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.layers.enable(LAYER_AO);
      this.scene.add(m);
      return m;
    };
    const teethMat = withSSAO(new THREE.MeshPhysicalMaterial({ color: 0xe9dfca, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1, sheen: 0.2 }), this.skinU, 'teeth');
    const tongueMat = withSSAO(new THREE.MeshPhysicalMaterial({ color: 0xa8474b, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.15 }), this.skinU, 'tongue');
    this.teeth = [mk(ch.parts.upperTeeth, teethMat), mk(ch.parts.lowerTeeth, teethMat)];
    this.tongue = mk(ch.parts.tongue, tongueMat);

    // eyes
    ch.updateEyes(null);
    this.eyeMats = { L: createEyeMaterial(this.skinU, 'L'), R: createEyeMaterial(this.skinU, 'R') };
    this.corneaMat = createCorneaMaterial();
    this.eyes = {};
    for (const s of ['L', 'R']) {
      for (const kind of ['ball', 'cornea']) {
        const em = ch.eyeMeshes[s + kind];
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', dynAttr(em.position, 3));
        eg.setAttribute('normal', dynAttr(em.normal, 3));
        eg.setAttribute('aEyeLocal', new THREE.BufferAttribute(em.local, 3));
        eg.setIndex(new THREE.BufferAttribute(em.index, 1));
        const m = new THREE.Mesh(eg, kind === 'ball' ? this.eyeMats[s] : this.corneaMat);
        m.frustumCulled = false;
        if (kind === 'ball') { m.receiveShadow = true; m.layers.enable(LAYER_AO); }
        m.renderOrder = kind === 'cornea' ? 2 : 0;
        this.scene.add(m);
        this.eyes[s + kind] = m;
      }
    }
    applyEyeParams(this.eyeMats, this.eyeParams);
    this.eyeInv = { L: new THREE.Matrix4(), R: new THREE.Matrix4() };
  }

  // double tap on the character: orbit around (and move towards) the tapped point
  _setupDoubleTap(canvas) {
    let last = null;
    const ray = new THREE.Raycaster();
    canvas.addEventListener('pointerup', (e) => {
      const now = performance.now();
      if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24) {
        last = null;
        const r = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        this.body.geometry.computeBoundingSphere();
        const hit = ray.intersectObject(this.body, false)[0];
        if (hit) this.focusOn(hit.point);
        return;
      }
      last = { t: now, x: e.clientX, y: e.clientY };
    });
  }

  focusOn(point) {
    const cam = this.camera, ctl = this.controls;
    const t0 = ctl.target.clone(), p0 = cam.position.clone();
    const dir = p0.clone().sub(t0);
    const d = Math.max(0.35, Math.min(dir.length() * 0.6, 1.4));
    const p1 = point.clone().add(dir.normalize().multiplyScalar(d));
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      ctl.target.lerpVectors(t0, point, e);
      cam.position.lerpVectors(p0, p1, e);
      ctl.update();
      this.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { for (const fn of this.listeners) fn(type); }

  setSkin(params) {
    Object.assign(this.skin, params);
    this.baker.set(params);
    this.requestRender();
  }

  setEyes(params) {
    Object.assign(this.eyeParams, params);
    applyEyeParams(this.eyeMats, this.eyeParams);
    this.requestRender();
  }

  requestRender() { this.dirty = true; }

  resize() {
    const w = this.canvas.parentElement.clientWidth, h = this.canvas.parentElement.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr || 2);
    this.renderer.setSize(w, h, dpr);
    this.hair?.setViewport(this.renderer.height);
    this.camera.aspect = w / h;
    this._applyViewOffset();
  }

  _syncGeometry() {
    const ch = this.character;
    if (!ch.update()) return false;
    const g = this.body.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    for (const m of [...this.teeth, this.tongue]) {
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.attributes.normal.needsUpdate = true;
    }
    this.clothing?.sync();
    if (this.baker.uniforms.uAge.value !== ch.human.macros.age) {
      this.baker.uniforms.uAge.value = ch.human.macros.age;
      this.baker.dirty = true;
    }
    const sv = ch.shapeVersion;
    this.hair?.onGeometryChanged(sv !== this._lastShape);
    this._lastShape = sv;
    this.emit('geometry');
    return true;
  }

  _updateEyes() {
    const ch = this.character;
    let target = null;
    if (this.gazeMode === 'camera') {
      const off = this.saccade ? this.saccade.off.clone().applyQuaternion(this.camera.quaternion) : new THREE.Vector3();
      target = this.camera.position.clone().add(off.multiplyScalar(this.camera.position.distanceTo(this.controls.target))).toArray();
    }
    else if (this.gazeMode === 'forward') target = null;
    ch.updateEyes(target);
    for (const s of ['L', 'R']) {
      for (const kind of ['ball', 'cornea']) {
        const g = this.eyes[s + kind].geometry;
        g.attributes.position.needsUpdate = true;
        g.attributes.normal.needsUpdate = true;
      }
      this.eyeInv[s].fromArray(ch.eyeMatrix[s]).invert();
      this.eyeMats[s].userData.u.uEyeInv.value.copy(this.eyeInv[s]);
    }
  }

  focusShadows() {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const r = THREE.MathUtils.clamp(d * 0.42, 0.22, 1.25);
    // keep the feet inside the shadow frustum for full body views
    const c = r > 0.9 ? new THREE.Vector3(0, Math.max(t.y, 0.9), 0) : t.clone();
    this.stage.setFocus(c, r > 0.9 ? 1.25 : r);
  }

  frame() {
    this.clock.update();
    const dt = Math.min(0.1, this.clock.getDelta());
    this._animate(dt);
    const moved = this.controls.update() || this.controls.autoRotate;
    const shapeBefore = this._lastShape;
    let changed = this._syncGeometry();
    const animOnly = changed && shapeBefore === this.character.shapeVersion && !this.dirty;
    if (this.baker.bake()) { changed = true; this.dirty = true; }
    this.hair.update();
    this._updateEyes();
    const hard = moved || this.dirty || (changed && !animOnly) || this.alwaysRender;
    const soft = animOnly || this.softDirty;
    if (hard) this.accum = 0;
    else if (soft) this.accum = Math.min(this.accum, 3);
    if (hard || soft || this.accum < this.maxAccum) {
      this.focusShadows();
      this.hair.setFrame(this.accum);
      this.renderer.render(this.scene, this.camera, this.renderer.settings.sss ? this.skinMatPass1 : null, this.accum);
      this.accum++;
      this.dirty = false;
      this.softDirty = false;
      this.lastRender = performance.now();
    }
    return dt;
  }

  /** Keep the character centred in the area not covered by the side panel. */
  setViewInset(rightPx, bottomPx = 0) {
    this.viewInset = [rightPx, bottomPx];
    this._applyViewOffset();
  }

  _applyViewOffset() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    const [r, b] = this.viewInset || [0, 0];
    if (r || b) this.camera.setViewOffset(w, h, r / 2, b / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Render a fully converged image into the drawing buffer (for photo export). */
  captureFrame(samples = 16) {
    this.focusShadows();
    for (let i = 0; i < samples; i++) {
      this.hair.setFrame(i);
      this.renderer.render(this.scene, this.camera, this.renderer.settings.sss ? this.skinMatPass1 : null, i);
    }
    this.accum = samples;
  }

  setLight(id) {
    this.stage.apply(id);
    const p = this.stage.preset;
    const bg = new THREE.Color(p.bg);
    const key = new THREE.Color(p.lights[0].color);
    const top = bg.clone().lerp(key, 0.35).multiplyScalar(0.9);
    const bot = new THREE.Color(p.floor).multiplyScalar(0.55);
    this.hair.setAmbient(top, bot, 1);
    this.renderer.settings.exposure = p.exposure ?? 1;
    this.requestRender();
  }

  _animate(dt) {
    // blinking: ~every 2-6 s, 150 ms close/open
    const b = this.blink;
    const H = this.character.human;
    if (this.blinking) {
      b.t += dt;
      if (b.phase < 0 && b.t > b.next) { b.phase = 0; b.t = 0; }
      if (b.phase >= 0) {
        b.phase += dt / 0.17;
        const v = b.phase < 1 ? Math.sin(Math.min(1, b.phase) * Math.PI) : 0;
        H.setBlink(v);
        if (b.phase >= 1) { b.phase = -1; b.t = 0; b.next = 2 + Math.random() * 4.5; H.setBlink(0); }
      }
    } else if (H.blink) H.setBlink(0);
    // micro saccades
    const s = this.saccade || (this.saccade = { t: 0, next: 1, off: new THREE.Vector3() });
    s.t += dt;
    if (s.t > s.next) {
      s.t = 0; s.next = 0.8 + Math.random() * 2.5;
      s.off.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.035, 0);
      this.softDirty = true;
    }
  }

  setSSS(on) {
    this.renderer.settings.sss = on;
    this.body.material = on ? this.skinMat : this.skinMatSingle;
    this.requestRender();
  }

  /** Debug helper: read back a baked texture as PNG data URL. */
  dumpTexture(which = 0, size = 1024) {
    const rt = this.baker.rtOut;
    const w = rt.width, h = rt.height;
    const buf = new Uint8Array(w * h * 4);
    this.gl.readRenderTargetPixels(rt, 0, 0, w, h, buf, undefined, which);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(t, 0, 0, size, size);
    return c.toDataURL('image/png');
  }

  get ageYears() { return ageInYears(this.character.human.macros.age); }
}
