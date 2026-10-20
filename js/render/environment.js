// Lighting rigs: direct lights (with shadows) plus a matching procedural HDR environment
// (softboxes / sky) baked into a PMREM, and a photo-studio cyclorama backdrop.

import * as THREE from 'three';
import { LAYER_AO } from './renderer.js';
import { withSSAO } from './skinMaterial.js';

const D2R = Math.PI / 180;

// dir: [azimuth deg (0 = front, + = character's left), elevation deg]
export const LIGHT_PRESETS = {
  studio: {
    label: 'Fotostudio',
    bg: '#5b5f66', floor: '#55595f', exposure: 1.0,
    lights: [
      { dir: [36, 32], color: '#fff3e6', intensity: 3.4, shadow: 4096, size: 2.6 },
      { dir: [-52, 10], color: '#e9f0ff', intensity: 0.32 },
      { dir: [150, 38], color: '#ffffff', intensity: 2.1, shadow: 2048, size: 2 },
      { dir: [-140, 25], color: '#dfe8ff', intensity: 0.65 },
    ],
    env: { ambient: '#141518', panels: [
      { dir: [36, 28], size: [1.6, 2.0], color: '#fff3e6', intensity: 8 },
      { dir: [-52, 8], size: [2.4, 2.4], color: '#e9f0ff', intensity: 0.85 },
      { dir: [150, 30], size: [0.5, 2.6], color: '#ffffff', intensity: 6 },
      { dir: [-140, 25], size: [0.5, 2.6], color: '#dfe8ff', intensity: 2.6 },
      { dir: [0, 80], size: [3, 3], color: '#ffffff', intensity: 0.45 },
    ], floor: '#2a2b2e' },
  },
  portrait: {
    label: 'Porträt (Rembrandt)',
    bg: '#2b2a2c', floor: '#2a292b', exposure: 1.05,
    lights: [
      { dir: [52, 40], color: '#fff0de', intensity: 3.8, shadow: 4096, size: 2.2 },
      { dir: [-60, 8], color: '#e4ebff', intensity: 0.22 },
      { dir: [-160, 35], color: '#fff6ee', intensity: 1.6, shadow: 2048, size: 2 },
    ],
    env: { ambient: '#08080a', panels: [
      { dir: [52, 38], size: [1.2, 1.6], color: '#fff0de', intensity: 10 },
      { dir: [-60, 5], size: [2.0, 2.0], color: '#e4ebff', intensity: 0.6 },
      { dir: [-160, 30], size: [0.4, 2.0], color: '#fff6ee', intensity: 6 },
    ], floor: '#111112' },
  },
  daylight: {
    label: 'Tageslicht',
    bg: '#9fb4c8', floor: '#8e8a82', exposure: 0.95,
    lights: [
      { dir: [30, 52], color: '#fff2dc', intensity: 4.2, shadow: 4096, size: 0.8 },
      { dir: [-150, 30], color: '#bcd2ff', intensity: 0.5 },
    ],
    env: { sky: { top: '#3d6fb4', horizon: '#c9dbea', ground: '#6e675c', sun: [30, 52], sunColor: '#fff2dc', sunIntensity: 60, intensity: 1.2 } },
  },
  golden: {
    label: 'Goldene Stunde',
    bg: '#c79a76', floor: '#8a6a52', exposure: 1.0,
    lights: [
      { dir: [65, 9], color: '#ffb06a', intensity: 4.0, shadow: 4096, size: 0.9 },
      { dir: [-120, 30], color: '#7ea0ff', intensity: 0.6 },
    ],
    env: { sky: { top: '#4b6aa8', horizon: '#ffc58e', ground: '#5c4535', sun: [65, 9], sunColor: '#ffb06a', sunIntensity: 50, intensity: 1.0 } },
  },
  overcast: {
    label: 'Bewölkt',
    bg: '#a7adb3', floor: '#8b8d8f', exposure: 1.1,
    lights: [
      { dir: [20, 70], color: '#f2f5fa', intensity: 1.3, shadow: 2048, size: 6 },
    ],
    env: { sky: { top: '#c9ced4', horizon: '#e5e8eb', ground: '#5d5f61', sun: [20, 70], sunColor: '#ffffff', sunIntensity: 3, intensity: 1.6 } },
  },
  backlight: {
    label: 'Gegenlicht',
    bg: '#16181c', floor: '#18191c', exposure: 1.15,
    lights: [
      { dir: [170, 22], color: '#ffe2c4', intensity: 6.5, shadow: 4096, size: 1.4 },
      { dir: [-20, 12], color: '#cfdcff', intensity: 0.35 },
    ],
    env: { ambient: '#060708', panels: [
      { dir: [170, 20], size: [1.2, 1.4], color: '#ffe2c4', intensity: 14 },
      { dir: [-20, 10], size: [2.4, 2.4], color: '#cfdcff', intensity: 0.8 },
    ], floor: '#0b0b0c' },
  },
  neon: {
    label: 'Neon',
    bg: '#0d0b14', floor: '#110e18', exposure: 1.1,
    lights: [
      { dir: [75, 15], color: '#ff2fb4', intensity: 3.4, shadow: 2048, size: 1.6 },
      { dir: [-75, 15], color: '#21d4ff', intensity: 3.2, shadow: 2048, size: 1.6 },
      { dir: [0, 60], color: '#8a6bff', intensity: 0.5 },
    ],
    env: { ambient: '#050408', panels: [
      { dir: [75, 12], size: [0.4, 2.8], color: '#ff2fb4', intensity: 12 },
      { dir: [-75, 12], size: [0.4, 2.8], color: '#21d4ff', intensity: 12 },
    ], floor: '#08060c' },
  },
  night: {
    label: 'Mondnacht',
    bg: '#0e1420', floor: '#121620', exposure: 1.25,
    lights: [
      { dir: [-40, 40], color: '#a9c2ff', intensity: 1.6, shadow: 2048, size: 1.2 },
      { dir: [120, 12], color: '#ffb46a', intensity: 1.2 },
    ],
    env: { sky: { top: '#050812', horizon: '#1a2438', ground: '#08090c', sun: [-40, 40], sunColor: '#a9c2ff', sunIntensity: 8, intensity: 0.6 } },
  },
};

function dirVec([az, el]) {
  const a = az * D2R, e = el * D2R;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

function buildEnvScene(env) {
  const s = new THREE.Scene();
  if (env.sky) {
    const k = env.sky;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(k.top) }, hor: { value: new THREE.Color(k.horizon) },
        gnd: { value: new THREE.Color(k.ground) }, sunDir: { value: dirVec(k.sun) },
        sunCol: { value: new THREE.Color(k.sunColor).multiplyScalar(k.sunIntensity) }, inten: { value: k.intensity },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, hor, gnd, sunCol, sunDir; uniform float inten; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float y = d.y;
          vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, gnd, pow(-y, 0.35));
          float s = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(s, 1200.0) + 0.02 * pow(s, 12.0));
          gl_FragColor = vec4(c * inten, 1.0); }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
    return s;
  }
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: env.ambient, side: THREE.BackSide }));
  room.position.y = 4;
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: env.floor || env.ambient }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  s.add(floor);
  for (const p of env.panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.intensity), side: THREE.DoubleSide }));
    const d = dirVec(p.dir);
    m.position.copy(d.multiplyScalar(5)).add(new THREE.Vector3(0, 1.2, 0));
    m.lookAt(0, 1.2, 0);
    s.add(m);
  }
  return s;
}

export class Stage {
  constructor(renderer, scene, skinUniforms) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.lights = [];
    this.rotation = 0;
    this.intensity = 1;
    this.target = new THREE.Object3D();
    this.target.position.set(0, 1, 0);
    scene.add(this.target);
    this.center = new THREE.Vector3(0, 0.9, 0);
    this.radius = 1.2;

    // cyclorama: floor curving into a back wall
    const shape = [];
    const R = 2.2, depthFront = 9, wallH = 9, back = -3.2;
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI / 2;
      shape.push(new THREE.Vector2(back + R - Math.sin(a) * R, R - Math.cos(a) * R));
    }
    const pts = [new THREE.Vector2(depthFront, 0), ...shape.map((p) => p), new THREE.Vector2(back, wallH)];
    const geo = new THREE.BufferGeometry();
    const W = 30, seg = pts.length;
    const pos = [], idx = [];
    for (let i = 0; i < seg; i++) {
      const p = pts[Math.min(seg - 1, i)];
      for (const x of [-W / 2, W / 2]) pos.push(x, p.y, p.x);
    }
    for (let i = 0; i < seg - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const domeCol = { value: new THREE.Color(0x5b5f66) };
    const DOME_K = 'float domeK(vec3 d) { float y = normalize(d).y; return mix(0.55, 0.85, smoothstep(-0.2, 0.25, y)) * mix(1.0, 0.7, smoothstep(0.3, 0.9, y)); }';
    const bd = new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.92, metalness: 0 });
    // towards its far edges the backdrop fades into the dome, so orbiting never shows a seam
    bd.onBeforeCompile = (shader) => {
      shader.uniforms.uDomeCol = domeCol;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBdW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBdW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBdW;\nuniform vec3 uDomeCol;\n' + DOME_K)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          float edge = max(max(smoothstep(6.0, 13.0, abs(vBdW.x)), smoothstep(4.0, 8.5, vBdW.z)), smoothstep(4.5, 8.5, vBdW.y));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uDomeCol * domeK(vBdW), edge);`);
    };
    this.backdropMat = withSSAO(bd, skinUniforms, 'backdrop');
    this.backdrop = new THREE.Mesh(geo, this.backdropMat);
    this.backdrop.receiveShadow = true;
    this.backdrop.layers.enable(LAYER_AO);
    scene.add(this.backdrop);
    // studio dome so that no view direction ends in the void
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uCol: domeCol },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uCol; varying vec3 vP;
        ${DOME_K}
        void main(){ gl_FragColor = vec4(uCol * domeK(vP), 1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(28, 48, 24), this.domeMat);
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.skinUniforms = skinUniforms;
  }

  apply(id) {
    const p = LIGHT_PRESETS[id] || LIGHT_PRESETS.studio;
    this.presetId = id;
    this.preset = p;
    for (const l of this.lights) { this.scene.remove(l); l.dispose?.(); l.shadow?.map?.dispose(); }
    this.lights = [];
    for (const def of p.lights) {
      const l = new THREE.DirectionalLight(new THREE.Color(def.color), def.intensity);
      l.userData.def = def;
      l.target = this.target;
      l.layers.enableAll();
      if (def.shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(def.shadow, def.shadow);
        l.shadow.bias = -0.00012;
        l.shadow.normalBias = 0.012;
        l.shadow.radius = def.size || 2;
        l.shadow.camera.near = 0.1;
        l.shadow.camera.far = 20;
      }
      this.scene.add(l);
      this.lights.push(l);
    }
    if (this.envRT) this.envRT.dispose();
    const envScene = buildEnvScene(p.env);
    this.envRT = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.envRotation(this.rotation);
    this.backdropMat.color.set(p.bg);
    this.domeMat.uniforms.uCol.value.set(p.bg);
    this.update();
  }

  setBackground(hex) {
    this.backdropMat.color.set(hex);
    this.domeMat.uniforms.uCol.value.set(hex);
  }

  envRotation(r) {
    this.rotation = r;
    this.scene.environmentRotation = new THREE.Euler(0, r, 0);
    this.update();
  }

  setFocus(center, radius) {
    this.center.copy(center);
    this.radius = radius;
    this.update();
  }

  update() {
    const c = this.center;
    this.target.position.copy(c);
    for (const l of this.lights) {
      const def = l.userData.def;
      const d = dirVec([def.dir[0] + this.rotation / D2R, def.dir[1]]);
      l.position.copy(c).addScaledVector(d, 6);
      l.intensity = def.intensity * this.intensity;
      if (l.castShadow) {
        const s = this.radius;
        const cam = l.shadow.camera;
        cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
        cam.near = 6 - s * 2.5; cam.far = 6 + s * 2.5;
        cam.updateProjectionMatrix();
      }
    }
  }
}
