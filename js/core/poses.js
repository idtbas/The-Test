// Pose library. Rotations are in degrees; `w` rotates about a rest-pose world axis,
// `l` about the bone's own rest axes (X = hinge, Y = along bone, Z = X x Y).
// Left side (".L") is the character's left at +X; right side values are mirrored.

const D = Math.PI / 180;
const FINGERS = [1, 2, 3, 4, 5];

function side(S, s, fn) {
  const m = s === 'L' ? 1 : -1;
  fn((name) => `${name}.${s}`, m);
}

function curlFingers(S, b, amount, spread = 0, m = 1) {
  // amount in degrees per joint (thumb uses 60%); m = side sign (mirrors the spread)
  for (const f of FINGERS) {
    const k = f === 1 ? 0.6 : 1;
    const fall = 1 + (f - 2) * 0.12; // little finger curls a bit more
    for (let j = 1; j <= 3; j++) {
      // negative rotation about the hinge axis flexes towards the palm
      S.rotateLocal(b(`finger${f}-${j}`), [1, 0, 0], -amount * k * fall * D * (j === 1 ? 0.8 : 1.1));
    }
    if (spread && f > 1) S.rotateLocal(b(`finger${f}-1`), [0, 0, 1], m * spread * (f - 3) * D);
  }
}

function arms(S, { down = 33, forward = 5, elbow = 30, twist = 0, wrist = 0, curl = 16, clav = 5 } = {}) {
  for (const s of ['L', 'R']) {
    side(S, s, (b, m) => {
      S.rotateWorld(b('clavicle'), [0, 0, 1], -m * clav * D);
      S.rotateWorld(b('upperarm01'), [0, 0, 1], -m * down * D);
      S.rotateWorld(b('upperarm01'), [1, 0, 0], -forward * D);
      S.rotateLocal(b('lowerarm01'), [1, 0, 0], elbow * D);
      if (twist) S.rotateLocal(b('lowerarm02'), [0, 1, 0], m * twist * D);
      if (wrist) S.rotateLocal(b('wrist'), [1, 0, 0], wrist * D);
      curlFingers(S, b, curl);
    });
  }
}

// explicit arm pose (angles found by fitting target hand positions)
function armPose(S, b, m, { down, fwd, twist, elbow, fore }) {
  S.rotateWorld(b('clavicle'), [0, 0, 1], -m * 4 * D);
  S.rotateWorld(b('upperarm01'), [0, 0, 1], -m * down * D);
  S.rotateWorld(b('upperarm01'), [1, 0, 0], -fwd * D);
  S.rotateLocal(b('upperarm01'), [0, 1, 0], m * twist * D);
  S.rotateLocal(b('lowerarm01'), [1, 0, 0], elbow * D);
  S.rotateLocal(b('lowerarm02'), [0, 1, 0], m * fore * D);
}

function legs(S, { inward = 2.5, knee = 0 } = {}) {
  for (const s of ['L', 'R']) {
    side(S, s, (b, m) => {
      S.rotateWorld(b('upperleg01'), [0, 0, 1], -m * inward * D);
      S.rotateWorld(b('foot'), [0, 0, 1], m * inward * D);
      if (knee) {
        S.rotateWorld(b('upperleg01'), [1, 0, 0], -knee * D);
        S.rotateWorld(b('lowerleg01'), [1, 0, 0], 2 * knee * D);
        S.rotateWorld(b('foot'), [1, 0, 0], -knee * D);
      }
    });
  }
}

export const POSES = {
  relaxed: {
    label: 'Entspannt',
    apply(S) {
      arms(S, {});
      legs(S, {});
    },
  },
  apose: {
    label: 'A-Pose',
    apply() {},
  },
  tpose: {
    label: 'T-Pose',
    apply(S) {
      for (const s of ['L', 'R']) {
        side(S, s, (b, m) => {
          S.rotateWorld(b('upperarm01'), [0, 0, 1], m * 45 * D);
          S.rotateLocal(b('lowerarm01'), [1, 0, 0], 40 * D);
          curlFingers(S, b, 4);
        });
      }
    },
  },
  contrapposto: {
    label: 'Kontrapost',
    apply(S) {
      arms(S, { down: 38, elbow: 22 });
      S.rotateWorld('spine05', [0, 0, 1], 3 * D);
      S.rotateWorld('spine03', [0, 0, 1], -4 * D);
      S.rotateWorld('spine01', [0, 0, 1], -2 * D);
      S.rotateWorld('neck01', [0, 0, 1], 3 * D);
      S.rotateWorld('upperleg01.L', [0, 0, 1], 1 * D);
      S.rotateWorld('upperleg01.R', [0, 0, 1], -5 * D);
      S.rotateWorld('upperleg01.R', [1, 0, 0], -8 * D);
      S.rotateWorld('lowerleg01.R', [1, 0, 0], 14 * D);
      S.rotateWorld('foot.R', [1, 0, 0], -6 * D);
      S.rotateWorld('foot.L', [0, 0, 1], -2 * D);
    },
  },
  hips: {
    label: 'Hände in den Hüften',
    apply(S) {
      for (const s of ['L', 'R']) side(S, s, (b, m) => {
        armPose(S, b, m, { down: 5, fwd: -20, twist: 60, elbow: -40, fore: -60 });
        curlFingers(S, b, 10);
      });
      legs(S, { inward: 0 });
    },
  },
  thinker: {
    label: 'Nachdenklich',
    apply(S) {
      side(S, 'L', (b, m) => { armPose(S, b, m, { down: 33, fwd: 5, twist: 0, elbow: 30, fore: 0 }); curlFingers(S, b, 16); });
      side(S, 'R', (b, m) => {
        armPose(S, b, m, { down: 50, fwd: 40, twist: 45, elbow: -90, fore: -60 });
        S.rotateLocal(b('wrist'), [1, 0, 0], -15 * D);
        curlFingers(S, b, 38);
      });
      S.rotateWorld('neck02', [1, 0, 0], 6 * D);
      S.rotateWorld('head', [0, 1, 0], -10 * D);
      S.rotateWorld('head', [0, 0, 1], -4 * D);
      legs(S, {});
    },
  },
  wave: {
    label: 'Winken',
    apply(S) {
      side(S, 'L', (b, m) => { armPose(S, b, m, { down: 33, fwd: 5, twist: 0, elbow: 30, fore: 0 }); curlFingers(S, b, 16); });
      side(S, 'R', (b, m) => {
        armPose(S, b, m, { down: -30, fwd: 10, twist: -30, elbow: -95, fore: 20 });
        curlFingers(S, b, 4, 6, m);
      });
      S.rotateWorld('head', [0, 0, 1], 3 * D);
      legs(S, {});
    },
  },
};

export const POSE_LIST = Object.entries(POSES).map(([id, p]) => ({ id, label: p.label }));
