// Head look, pointer lock, picking and keyboard.
import * as THREE from 'three';
import { G, clamp, approach, DEG } from './util.js';

export const VIEWS = {
  1: { yaw: 0, pitch: -2, fov: 0, name: 'Sichtschirme' },
  2: { yaw: 0, pitch: -30, fov: 0, name: 'Instrumentenbrett' },
  3: { yaw: 44, pitch: -52, fov: 0, name: 'Linke Konsole' },
  4: { yaw: -44, pitch: -52, fov: 0, name: 'Rechte Konsole' },
  5: { yaw: 0, pitch: 62, fov: 0, name: 'Overhead' },
};

export class Input {
  constructor(canvas, camera, cockpit, ui) {
    this.canvas = canvas; this.camera = camera; this.cockpit = cockpit; this.ui = ui;
    this.yaw = 0; this.pitch = -6; this.tYaw = 0; this.tPitch = -6;
    this.baseFov = 68; this.fov = 68; this.zoom = false; this.zoomWheel = 0;
    this.locked = false;
    this.mouse = new THREE.Vector2(0, 0);   // NDC in free mode
    this.ray = new THREE.Raycaster();
    this.ray.near = 0.05; this.ray.far = 3;
    this.hover = null; this.active = null; this.dragLook = false;
    this.keys = new Set();
    this.wheelAcc = 0;
    this.lean = new THREE.Vector3();
    this.enabled = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      this.ui.setLocked(this.locked);
    });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); G.sim.sw.turn = 0; });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => { });
    } catch (e) { /* not available */ }
  }

  setView(n) {
    const v = VIEWS[n]; if (!v) return;
    this.tYaw = v.yaw; this.tPitch = v.pitch;
    this.ui.toast(v.name);
  }

  pickFrom(ndc) {
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.cockpit.pickables, false);
    if (!hits.length) return null;
    const h = hits[0];
    return { control: h.object.userData.control, object: h.object, point: h.point };
  }

  currentNDC() { return this.locked ? new THREE.Vector2(0, 0) : this.mouse; }

  onDown(e) {
    if (!this.enabled) return;
    G.audio?.start();
    this.updateMouse(e);
    if (e.pointerType === 'mouse' && !this.locked && e.button === 0 && e.shiftKey) { this.requestLock(); return; }
    const hit = this.pickFrom(this.currentNDC());
    if (hit && hit.control) {
      const ctl = hit.control;
      const local = ctl.group.worldToLocal(hit.point.clone());
      this.active = { ctl, button: e.button };
      ctl.interact({ type: 'down', button: e.button, local, object: hit.object });
      G.shadowDirty = G.time + 0.6;
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    // empty space: in free mode, drag to look; a click without drag captures the mouse
    this.dragLook = true;
    this.dragMoved = 0;
    this.downAt = { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType };
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  onMove(e) {
    if (!this.enabled) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    this.updateMouse(e);
    if (this.active) {
      if (this.active.ctl.dragging) this.active.ctl.interact({ type: 'drag', dx: mx, dy: my });
      return;
    }
    const sens = 0.11 * (this.fov / this.baseFov);
    if (this.locked) {
      this.tYaw -= mx * sens; this.tPitch -= my * sens;
    } else if (this.dragLook) {
      const k = e.pointerType === 'touch' ? 0.18 : 0.16;
      this.tYaw += mx * k * (this.fov / this.baseFov); this.tPitch += my * k * (this.fov / this.baseFov);
      this.dragMoved += Math.abs(mx) + Math.abs(my);
    }
    this.clampView();
  }

  onUp(e) {
    if (this.active) {
      this.active.ctl.interact({ type: 'up', button: this.active.button });
      this.active.ctl.dragging = false;
      this.active = null;
      G.shadowDirty = G.time + 0.6;
    } else if (this.dragLook) {
      // a simple click into empty space captures the mouse for mouse-look
      if (this.downAt && this.downAt.type === 'mouse' && this.dragMoved < 4 && this.downAt.button === 0 && !this.locked) this.requestLock();
    }
    this.dragLook = false;
  }

  onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const hit = this.hover;
    this.wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    if (Math.abs(this.wheelAcc) < 40) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    if (hit) { hit.interact({ type: 'wheel', dir }); G.shadowDirty = G.time + 0.6; }
    else this.zoomWheel = clamp(this.zoomWheel + dir * 0.18, 0, 1);
  }

  onKey(e, down) {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) {
      if (k === 'a' || k === 'd') G.sim.sw.turn = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
      return;
    }
    if (e.repeat) return;
    if (VIEWS[k]) this.setView(k);
    if (k === 'x') { G.sim.sw.throttle = 0; G.audio?.click('lever'); }
    if (k === 'h') this.ui.toggleHelp();
    if (k === 'q') this.ui.cycleQuality();
    if (k === 'c') { this.tYaw = 0; this.tPitch = -6; this.zoomWheel = 0; }
    if (k === 'm') { G.sim.masterCautionReset(); G.sim.masterWarningReset(); }
    if (k === 'a' || k === 'd') G.sim.sw.turn = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
  }

  updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.clientX = e.clientX; this.clientY = e.clientY;
  }

  clampView() {
    this.tYaw = clamp(this.tYaw, -140, 140);
    this.tPitch = clamp(this.tPitch, -72, 78);
  }

  update(dt, shake) {
    const s = G.sim;
    // throttle by keys
    let thr = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) thr += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) thr -= 1;
    if (thr) this.cockpit.setThrottle(s.sw.throttle + thr * dt * 0.45);
    // smoothing of the head
    this.yaw = approach(this.yaw, this.tYaw, 16, dt);
    this.pitch = approach(this.pitch, this.tPitch, 16, dt);
    const zoomTarget = this.keys.has('z') ? 1 : this.zoomWheel;
    const fovT = lerpF(this.baseFov, 22, zoomTarget);
    this.fov = approach(this.fov, fovT, 10, dt);
    const cam = this.camera;
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // head leans slightly towards where it looks (natural neck pivot)
    const yawR = this.yaw * DEG, pitR = this.pitch * DEG;
    const neck = 0.1;
    this.lean.set(-Math.sin(yawR) * Math.cos(pitR) * neck, Math.sin(pitR) * neck * 0.6 - (1 - Math.cos(pitR)) * 0.05, -Math.cos(yawR) * Math.cos(pitR) * neck + neck);
    cam.position.set(0, 1.15, 0).add(this.lean).add(shake.pos);
    cam.rotation.set(pitR + shake.pitch, yawR + shake.yaw, shake.roll, 'YXZ');
    cam.updateMatrixWorld();
    // hover
    if (!this.active) {
      const hit = this.pickFrom(this.currentNDC());
      this.hover = hit ? hit.control : null;
    }
    this.ui.updateHover(this.hover, this.locked, this.clientX, this.clientY);
  }
}

function lerpF(a, b, t) { return a + (b - a) * t; }
