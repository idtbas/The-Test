// GW-7 systems simulation. Units: volts, amps, bar, °C, kg, m/s.
import { clamp, approach, step, sat, DEG } from './util.js';

export const AMBIENT = 14;

export const BREAKERS = [
  // id, label, amps, bus
  ['mfdL', 'MFD L', 5], ['mfdC', 'MFD M', 5], ['mfdR', 'MFD R', 5], ['ann', 'WARN LT', 3],
  ['sduL', 'SDU L', 10], ['sduC', 'SDU M', 10], ['sduR', 'SDU R', 10], ['ins', 'INS', 7.5],
  ['gyro', 'KREISEL', 15], ['act', 'AKT STRG', 10], ['hydB', 'HYD B PMP', 50], ['cool1', 'KÜHL 1', 20],
  ['cool2', 'KÜHL 2', 20], ['fuelL', 'KST PMP L', 15], ['fuelR', 'KST PMP R', 15], ['apu', 'APU STRG', 5],
  ['ign', 'MTG ZÜND', 7.5], ['lights', 'INSTR LT', 5], ['ext', 'SCHEINW', 25], ['hud', 'HUD', 3],
];

export const GAITS = [
  { name: 'PRÄZ', max: 1.2, rev: 0.6, turn: 24 },
  { name: 'GEHEN', max: 4.2, rev: 1.2, turn: 18 },
  { name: 'LAUFEN', max: 8.6, rev: 1.2, turn: 11 },
];

export class Sim {
  constructor() {
    this.t = 0;
    this.sw = {
      bat: 0, apuGen: 0, gen1: 0, gen2: 0, busTie: 1, avionics: 0, voltSel: 0,
      panelLight: 0.65, flood: 0, dome: 1, extLights: 0,
      fuelL: 0, fuelR: 0, xfeed: 0,
      apu: 0, apuBleed: 0, ign: 0, mtgFuel: 0,
      hydA: 0, hydB: 0, cool1: 0, cool2: 0, fan: 0,
      insMode: 0, gyro: 0,
      sensors: 0, sensorMode: 0, hud: 1, sduBrt0: 0.85, sduBrt1: 0.85, sduBrt2: 0.85,
      actPower: 0, footLock: 0, gait: 1, estop: 0,
      throttle: 0, turn: 0, warnVol: 0.7,
    };
    this.cb = {};
    for (const [id] of BREAKERS) this.cb[id] = 1;

    this.bat = { charge: 0.9, v: 0, i: 0 };
    this.bus = { ess: 0, b1: 0, b2: 0, hot: 0, src1: null, src2: null };
    this.gen = { apu: false, g1: false, g2: false };
    this.P = {};
    this.av = { boot: 0, ready: false };
    this.fuel = { L: 1460, R: 1440, press: 0, flow: 0 };
    this.apu = { rpm: 0, egt: AMBIENT, lit: false, state: 'off', fault: false, timer: 0, avail: false, bleed: 0 };
    this.mtg = { n2: 0, egt: AMBIENT, oil: 0, lit: false, valve: false, hot: false, wet: 0, overT: 0, damaged: false, load: 0, ff: 0 };
    this.hyd = { a: 0, b: 0, pumpB: 0 };
    this.cool = { temp: AMBIENT + 2, flow: 0 };
    this.ins = { align: 0, status: 'AUS' };
    this.gyro = { rpm: 0, ok: false };
    this.sens = { boot: [0, 0, 0] };
    this.act = { cal: 0, calibrating: false, calibrated: false, posture: 0, target: 0, motion: 0, msg: '' };
    this.walk = { speed: 0, speedAbs: 0, yawRate: 0, heading: 0, x: 0, z: 0, phase: 0, foot: 0, canWalk: false, accel: 0 };
    this.warn = { list: [], active: new Set(), masterCaution: false, masterWarning: false, warningSilenced: false, lampTest: false };
    this.flags = { lampTested: false, apuWasOn: false };
    this.events = []; // {type, ...} consumed by main loop (sounds etc.)
    this.log = [];
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  message(text) { this.log.push({ t: this.t, text }); if (this.log.length > 40) this.log.shift(); }

  // ---------- commands from controls ----------
  pressMtgStart() {
    if (this.bus.ess < 18) return;
    this.mtg.valve = !this.mtg.valve;
    this.emit('relay');
    this.message(this.mtg.valve ? 'MTG ANLASSVENTIL AUF' : 'MTG ANLASSVENTIL ZU');
  }

  pressCal() {
    const a = this.act;
    if (!this.P.act) { this.message('KAL: AKTUATOR STROM AUS'); this.emit('reject'); return; }
    if (!this.hydOK()) { this.message('KAL: HYDRAULIKDRUCK ZU NIEDRIG'); this.emit('reject'); return; }
    if (a.posture > 0.02 && a.posture < 0.98) return;
    a.calibrating = true; a.cal = 0; a.calibrated = false;
    this.message('AKTUATOR KALIBRIERUNG GESTARTET');
  }

  pressStand() {
    const a = this.act;
    if (!a.calibrated) { this.message('AUFRICHTEN: NICHT KALIBRIERT'); this.emit('reject'); return; }
    if (!this.gyro.ok) { this.message('AUFRICHTEN: KREISEL NICHT BEREIT'); this.emit('reject'); return; }
    if (!(this.ins.align >= 1 || this.sw.insMode === 3)) { this.message('AUFRICHTEN: INS NICHT AUSGERICHTET'); this.emit('reject'); return; }
    if (!this.hydOK()) { this.message('AUFRICHTEN: HYDRAULIKDRUCK'); this.emit('reject'); return; }
    if (this.sw.footLock === 1 && a.target === 1 && Math.abs(this.walk.speed) > 0.1) return;
    a.target = a.target > 0.5 ? 0 : 1;
    this.message(a.target ? 'AUFRICHTEN' : 'IN DIE HOCKE');
  }

  masterCautionReset() { this.warn.masterCaution = false; }
  masterWarningReset() { this.warn.masterWarning = false; this.warn.warningSilenced = true; }

  hydOK() { return this.hyd.a > 150 && this.hyd.b > 150; }

  // ---------- simulation ----------
  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.electrical(dt);
    this.fuelSys(dt);
    this.apuSys(dt);
    this.mtgSys(dt);
    this.hydraulics(dt);
    this.cooling(dt);
    this.navigation(dt);
    this.sensors(dt);
    this.actuators(dt);
    this.walking(dt);
    this.annunciators(dt);
  }

  electrical(dt) {
    const sw = this.sw, cb = this.cb, b = this.bat;
    const gen = this.gen;
    const wasA = gen.apu, was1 = gen.g1, was2 = gen.g2;
    gen.apu = !!sw.apuGen && this.apu.rpm > 0.94 && this.apu.lit;
    gen.g1 = !!sw.gen1 && this.mtg.n2 > 0.55 && this.mtg.lit;
    gen.g2 = !!sw.gen2 && this.mtg.n2 > 0.55 && this.mtg.lit;
    if (gen.apu !== wasA || gen.g1 !== was1 || gen.g2 !== was2) this.emit('relay', { n: 2 });

    const tie = sw.busTie === 1;
    const GV = 28.3;
    let s1 = gen.g1 ? 'GEN 1' : gen.apu ? 'APU' : (tie && gen.g2) ? 'GEN 2' : null;
    let s2 = gen.g2 ? 'GEN 2' : (tie && gen.g1) ? 'GEN 1' : (tie && gen.apu) ? 'APU' : null;
    const prev1 = this.bus.src1, prev2 = this.bus.src2;
    this.bus.src1 = s1; this.bus.src2 = s2;
    if ((prev1 === null) !== (s1 === null) || (prev2 === null) !== (s2 === null)) this.emit('relay', { n: 1 });
    const b1 = s1 ? GV + Math.sin(this.t * 7) * 0.05 : 0;
    const b2 = s2 ? GV + Math.sin(this.t * 6.3) * 0.05 : 0;
    const genOnEss = b1 > 0 || b2 > 0;

    // Battery open-circuit voltage and loads on the essential bus
    const vOC = 23.2 + 3.5 * b.charge;
    const essOn = sw.bat || genOnEss;
    const Pess = (cbId) => essOn && (cbId ? cb[cbId] : true);
    let load = 0;
    if (Pess('mfdL') && sw.avionics) load += 4;
    if (Pess('mfdC') && sw.avionics) load += 4;
    if (Pess('mfdR') && sw.avionics) load += 4;
    if (Pess('ann')) load += 1.2;
    if (Pess('ins') && sw.insMode) load += 5;
    if (Pess('lights')) load += 2.5 * sw.panelLight;
    if (essOn && sw.flood) load += 3;
    if (Pess('apu') && sw.apu) load += 2;
    if (Pess('fuelL') && sw.fuelL) load += 7;
    if (Pess('ign') && sw.ign) load += 3;
    if (this.apu.state === 'start' && this.apu.rpm < 0.55) load += 210 * (1 - this.apu.rpm * 0.8);

    let ess = 0;
    if (genOnEss) {
      ess = GV - 0.3;
      if (sw.bat) {
        b.i = -clamp((GV - vOC) / 0.06, 0, 35); // charging
        b.charge = Math.min(1, b.charge - b.i * dt / (40 * 3600));
      } else b.i = 0;
    } else if (sw.bat) {
      b.i = load;
      ess = Math.max(0, vOC - load * 0.028);
      b.charge = Math.max(0, b.charge - load * dt / (40 * 3600));
    } else b.i = 0;
    b.v = sw.bat ? (genOnEss ? GV - 0.3 : ess) : vOC;
    // smooth a little (bus capacitance)
    this.bus.ess = approach(this.bus.ess, ess, 30, dt);
    if (ess === 0) this.bus.ess = 0;
    this.bus.b1 = b1; this.bus.b2 = b2;
    this.bus.hot = vOC;

    const E = this.bus.ess > 17;
    const P = this.P;
    P.ess = E;
    P.mfd = [E && sw.avionics && cb.mfdL, E && sw.avionics && cb.mfdC, E && sw.avionics && cb.mfdR].map(Boolean);
    P.ann = E && cb.ann;
    P.ins = E && cb.ins && sw.insMode > 0;
    P.lights = E && cb.lights;
    P.apuCtl = E && cb.apu && sw.apu > 0;
    P.fuelL = E && cb.fuelL && sw.fuelL;
    P.fuelR = b2 > 0 && cb.fuelR && sw.fuelR;
    P.ign = E && cb.ign && sw.ign;
    P.gyro = b1 > 0 && cb.gyro && sw.gyro;
    P.hydB = b2 > 0 && cb.hydB && sw.hydB && !sw.estop;
    P.cool1 = b1 > 0 && cb.cool1 && sw.cool1;
    P.cool2 = b2 > 0 && cb.cool2 && sw.cool2;
    P.sdu = [b1 > 0 && cb.sduL && sw.sensors, b1 > 0 && cb.sduC && sw.sensors, b2 > 0 && cb.sduR && sw.sensors].map(Boolean);
    P.act = b1 > 0 && cb.act && sw.actPower && !sw.estop;
    P.ext = b2 > 0 && cb.ext && sw.extLights;
    P.hud = b1 > 0 && cb.hud && sw.hud;
    // light level factor follows bus voltage (lights dim during APU crank)
    P.lightV = clamp((this.bus.ess - 12) / 16, 0, 1.05);

    // Avionics boot
    if (P.mfd.some(Boolean)) {
      const before = this.av.boot;
      this.av.boot = Math.min(1, this.av.boot + dt / 11);
      if (before < 1 && this.av.boot >= 1) { this.av.ready = true; this.emit('bootDone'); this.message('BORDRECHNER BEREIT'); }
    } else { this.av.boot = 0; this.av.ready = false; }
  }

  fuelSys(dt) {
    const f = this.fuel, P = this.P;
    let target = 0;
    if (P.fuelL) target += 2.4;
    if (P.fuelR) target += 2.4;
    target = Math.min(target, 3.3);
    if (target === 0 && this.mtg.n2 > 0.4 && this.mtg.lit) target = 0.9; // engine-driven suction
    f.press = approach(f.press, target, target > f.press ? 1.6 : 0.5, dt);
    // consumption
    let flow = 0;
    if (this.apu.lit) flow += 0.028 + this.apu.bleed * 0.004 + (this.gen.apu ? 0.006 : 0);
    if (this.mtg.lit) flow += this.mtg.ff;
    f.flow = flow;
    const take = flow * dt;
    if (this.sw.xfeed || (!P.fuelL && !P.fuelR)) { f.L -= take / 2; f.R -= take / 2; }
    else if (P.fuelL && !P.fuelR) f.L -= take;
    else if (P.fuelR && !P.fuelL) f.R -= take;
    else { f.L -= take / 2; f.R -= take / 2; }
    f.L = Math.max(0, f.L); f.R = Math.max(0, f.R);
    if (f.L + f.R < 1) f.press = 0;
  }

  apuSys(dt) {
    const a = this.apu, sw = this.sw, P = this.P;
    a.timer += dt;
    const ctl = P.apuCtl;
    if (sw.apu === 2 && ctl && (a.state === 'off' || a.state === 'down' && a.rpm < 0.15)) {
      a.state = 'start'; a.timer = 0; a.fault = false;
      this.emit('starter');
      this.message('APU ANLASSEN');
    }
    if (!ctl && a.state !== 'off' && a.state !== 'down') { a.state = 'down'; a.lit = false; this.message('APU AUS'); }

    let rpmTarget = 0, rate = 0.16;
    if (a.state === 'start') {
      const v = this.bus.ess;
      const starter = v > 18 ? (v - 16) / 10 : 0;
      if (!a.lit) {
        a.rpm = Math.min(0.24, a.rpm + dt * 0.055 * starter);
        if (a.rpm > 0.09) {
          if (this.fuel.press > 1.0) { a.lit = true; this.emit('ignite', { which: 'apu' }); }
          else if (a.timer > 14) { a.fault = true; a.state = 'down'; this.message('APU FEHLER: KEIN KRAFTSTOFFDRUCK'); this.emit('caution'); }
        }
      } else {
        const accel = 0.05 + (a.rpm < 0.55 ? 0.03 * starter : 0);
        a.rpm = Math.min(1.0, a.rpm + dt * accel * (1.15 - a.rpm) * 1.6);
        if (a.rpm >= 0.995) { a.state = 'run'; this.message('APU BEREIT'); }
      }
      rpmTarget = a.rpm;
    } else if (a.state === 'run') {
      rpmTarget = 1.0 - (this.gen.apu ? 0.004 : 0) - a.bleed * 0.004;
      a.rpm = approach(a.rpm, rpmTarget, 2, dt);
    } else {
      a.rpm = Math.max(0, approach(a.rpm, 0, rate, dt) - dt * 0.004);
      if (a.rpm < 0.004) { a.rpm = 0; if (a.state === 'down') a.state = 'off'; }
    }
    if (a.lit && this.fuel.press < 0.4) { a.lit = false; a.fault = true; a.state = 'down'; this.message('APU FLAMMABRISS'); }
    if (sw.apu === 0) a.fault = false;
    a.avail = a.lit && a.rpm > 0.95;
    let egtT = AMBIENT + a.rpm * 40;
    if (a.lit) {
      egtT = a.rpm < 0.95 ? 470 + 230 * Math.sin(Math.PI * Math.min(1, a.rpm * 1.2)) : 405;
      egtT += a.bleed * 22 + (this.gen.apu ? 25 : 0);
    }
    a.egt = approach(a.egt, egtT, a.lit ? 0.9 : 0.12, dt);
    a.bleed = approach(a.bleed, sw.apuBleed && a.avail ? 3.1 : 0, 1.5, dt);
    if (a.lit) this.flags.apuWasOn = true;
  }

  mtgSys(dt) {
    const m = this.mtg, sw = this.sw, P = this.P;
    const bleed = this.apu.bleed;
    // start valve auto-closes at 50 % N2
    if (m.valve && m.n2 > 0.5) { m.valve = false; this.emit('relay'); this.message('ANLASSER AUS (50 % N2)'); }
    if (m.valve && this.bus.ess < 17) m.valve = false;
    const starter = m.valve ? clamp((bleed - 1.2) / 1.8, 0, 1) : 0;

    const fuelAvail = sw.mtgFuel === 1 && (this.fuel.press > 0.8 || (m.lit && m.n2 > 0.4 && this.fuel.L + this.fuel.R > 1));
    if (fuelAvail && !m.lit && m.n2 > 0.04) {
      if (P.ign) {
        m.lit = true;
        m.hot = m.n2 < 0.15 || m.wet > 2.5;
        m.wet = 0;
        this.emit('ignite', { which: 'mtg' });
        this.message(m.hot ? 'MTG ZÜNDUNG – HEISSSTART!' : 'MTG ZÜNDUNG');
      } else m.wet += dt;
    }
    if (!fuelAvail && m.lit) { m.lit = false; this.message(sw.mtgFuel ? 'MTG FLAMMABRISS' : 'MTG ABGESTELLT'); }
    if (!fuelAvail) m.wet = Math.max(0, m.wet - dt * 0.3);

    // Load from motion system
    const demand = sat(this.walk.speedAbs / 8.6) * 0.75 + this.act.motion * 0.35 + (this.hyd.pumpB ? 0.03 : 0);
    m.load = approach(m.load, m.lit ? demand : 0, 1.2, dt);

    if (m.lit) {
      const idle = m.damaged ? 0.57 : 0.62;
      const target = idle + (1.0 - idle) * m.load;
      if (m.n2 < idle - 0.01) {
        // acceleration through start range
        const acc = 0.022 + starter * 0.02 + (m.hot ? -0.006 : 0);
        m.n2 = Math.min(target, m.n2 + dt * acc * (m.n2 < 0.3 ? 0.9 : 1.2));
      } else m.n2 = approach(m.n2, target, 0.8, dt);
    } else {
      const motorTarget = starter * 0.27;
      if (m.n2 < motorTarget) m.n2 = Math.min(motorTarget, m.n2 + dt * 0.03 * starter);
      else m.n2 = Math.max(0, approach(m.n2, motorTarget, 0.09, dt) - dt * 0.002);
    }
    if (m.n2 > 0.6) m.hot = false;

    // EGT
    let egtT = AMBIENT + m.n2 * 60;
    if (m.lit) {
      if (m.n2 < 0.6) egtT = 520 + 300 * (1 - clamp((m.n2 - 0.12) / 0.48, 0, 1));
      else egtT = 470 + 240 * m.load;
      if (m.hot) egtT += 330;
      if (m.damaged) egtT += 70;
    }
    m.egt = approach(m.egt, egtT, m.lit ? 0.55 : 0.08, dt);
    if (m.egt > 900) { m.overT += dt; if (m.overT > 5 && !m.damaged) { m.damaged = true; this.message('MTG ÜBERTEMPERATUR – SCHADEN'); } }
    else m.overT = Math.max(0, m.overT - dt);
    m.oil = approach(m.oil, m.n2 * 7.2 * (m.damaged ? 0.8 : 1), 2, dt);
    m.ff = m.lit ? 0.06 + m.n2 * 0.09 + m.load * 0.35 : 0;
  }

  hydraulics(dt) {
    const h = this.hyd, m = this.mtg, sw = this.sw;
    const tA = sw.hydA && !sw.estop && m.lit ? 207 * clamp((m.n2 - 0.4) / 0.2, 0, 1) : 0;
    const tB = this.P.hydB ? 207 : 0;
    const demand = this.act.motion * 16 + this.walk.speedAbs * 2;
    h.a = Math.max(0, approach(h.a, Math.max(0, tA - (tA ? demand : 0)), tA > h.a ? 1.1 : 0.06, dt));
    h.b = Math.max(0, approach(h.b, Math.max(0, tB - (tB ? demand : 0)), tB > h.b ? 0.8 : 0.06, dt));
    if (!tA && demand > 0) h.a = Math.max(0, h.a - demand * dt * 0.8);
    if (!tB && demand > 0) h.b = Math.max(0, h.b - demand * dt * 0.8);
    h.pumpB = this.P.hydB ? 1 : 0;
  }

  cooling(dt) {
    const c = this.cool, P = this.P;
    const flow = ((P.cool1 ? 1 : 0) + (P.cool2 ? 1 : 0)) / 2 * (this.sw.fan ? 1.35 : 1);
    c.flow = approach(c.flow, flow, 1.5, dt);
    const heat = (this.mtg.lit ? 0.35 + this.mtg.n2 * 0.6 + this.mtg.load * 0.8 : 0) + this.act.motion * 0.5 +
      (this.apu.lit ? 0.12 : 0) + (this.P.mfd.some(Boolean) ? 0.03 : 0);
    c.temp += (heat * 2.0 - (0.004 + 0.05 * c.flow) * (c.temp - AMBIENT)) * dt;
  }

  navigation(dt) {
    const i = this.ins, P = this.P, mode = this.sw.insMode;
    const moving = this.walk.speedAbs > 0.05 || this.act.motion > 0.05;
    if (!P.ins) { i.align = 0; i.status = mode ? 'KEIN STROM' : 'AUS'; return; }
    if (mode === 1) {
      if (moving) { if (i.align > 0) this.message('INS: AUSRICHTUNG DURCH BEWEGUNG GESTÖRT'); i.align = 0; }
      else i.align = Math.min(1, i.align + dt / 42);
      i.status = i.align >= 1 ? 'AUSGERICHTET' : 'AUSRICHTUNG';
    } else if (mode === 2) i.status = i.align >= 1 ? 'NAV' : 'NAV DEGR';
    else if (mode === 3) i.status = 'NOTBETRIEB';

    const g = this.gyro;
    if (this.P.gyro) g.rpm = Math.min(1, g.rpm + dt / 24);
    else g.rpm = Math.max(0, g.rpm - dt / 70);
    const wasOk = g.ok;
    g.ok = g.rpm > 0.95;
    if (g.ok && !wasOk) this.message('KREISEL STABIL');
  }

  sensors(dt) {
    for (let k = 0; k < 3; k++) {
      if (this.P.sdu[k]) this.sens.boot[k] = Math.min(1, this.sens.boot[k] + dt / (5 + k * 0.7));
      else this.sens.boot[k] = 0;
    }
  }

  actuators(dt) {
    const a = this.act, P = this.P;
    const hydOK = this.hydOK();
    let motion = 0;
    if (!P.act) {
      if (a.calibrated || a.calibrating) this.message('AKTUATOREN STROMLOS – KALIBRIERUNG VERLOREN');
      a.calibrated = false; a.calibrating = false; a.cal = 0;
    }
    if (a.calibrating) {
      if (!hydOK) { a.calibrating = false; a.cal = 0; this.message('KALIBRIERUNG ABGEBROCHEN: HYD DRUCK'); }
      else {
        a.cal = Math.min(1, a.cal + dt / 18);
        motion = 0.5 + 0.5 * Math.abs(Math.sin(a.cal * 40));
        if (a.cal >= 1) { a.calibrating = false; a.calibrated = true; this.message('KALIBRIERUNG ABGESCHLOSSEN'); this.emit('chime'); }
      }
    }
    // posture
    const canMove = P.act && hydOK && a.calibrated;
    if (canMove && Math.abs(a.target - a.posture) > 0.001) {
      a.posture = step(a.posture, a.target, dt / 8.5);
      motion = Math.max(motion, 1);
    } else if (!hydOK && a.posture > 0) {
      // loss of hydraulics: mech sags down slowly
      const sag = (150 - Math.min(this.hyd.a, this.hyd.b)) / 150;
      if (sag > 0) { a.posture = Math.max(0, a.posture - dt * 0.02 * sag); a.target = Math.min(a.target, a.posture); motion = Math.max(motion, 0.2 * sag); }
    }
    // walking adds servo motion
    motion = Math.max(motion, Math.min(1, this.walk.speedAbs / 5 + Math.abs(this.walk.yawRate) * 2));
    a.motion = approach(a.motion, motion, 6, dt);
  }

  walking(dt) {
    const w = this.walk, a = this.act, sw = this.sw;
    const gait = GAITS[sw.gait] || GAITS[1];
    w.canWalk = a.posture > 0.995 && sw.footLock === 1 && this.P.act && this.hydOK() && this.gyro.ok && this.mtg.lit && !sw.estop;
    const thr = sw.throttle;
    let cmd = thr >= 0 ? thr * gait.max : thr / 0.3 * gait.rev;
    if (!w.canWalk) cmd = 0;
    const acc = Math.abs(cmd) > Math.abs(w.speed) ? 0.8 : 1.5;
    const prev = w.speed;
    w.speed = step(w.speed, cmd, acc * dt);
    w.accel = (w.speed - prev) / Math.max(dt, 1e-4);
    w.speedAbs = Math.abs(w.speed);
    const turnCmd = w.canWalk ? sw.turn * gait.turn * DEG : 0;
    w.yawRate = step(w.yawRate, turnCmd, 30 * DEG * dt);
    w.heading += w.yawRate * dt;
    w.x += -Math.sin(w.heading) * w.speed * dt;
    w.z += -Math.cos(w.heading) * w.speed * dt;
    const stride = 1.5 + 0.38 * w.speedAbs;
    const rate = w.speedAbs / stride + Math.abs(w.yawRate) * 1.4;
    if (rate > 0.01) {
      const before = Math.floor(w.phase);
      w.phase += rate * dt;
      if (Math.floor(w.phase) !== before) {
        w.foot = 1 - w.foot;
        this.emit('footfall', { strength: 0.45 + w.speedAbs / 7, foot: w.foot });
      }
    }
  }

  annunciators(dt) {
    const s = this, P = this.P, sw = this.sw;
    const E = P.ess;
    const list = [
      ['BATT', 'BATT\nENTLADUNG', 'c', E && sw.bat && this.bat.i > 0.5],
      ['GEN1', 'GEN 1', 'c', E && !this.gen.g1],
      ['GEN2', 'GEN 2', 'c', E && !this.gen.g2],
      ['APUGEN', 'APU GEN', 'c', E && this.apu.avail && !this.gen.apu],
      ['BUS', 'BUS 1/2\nSTROMLOS', 'c', E && (!this.bus.b1 || !this.bus.b2)],
      ['FUELP', 'KST\nDRUCK', 'c', E && this.fuel.press < 1.0],
      ['FUELLO', 'KST\nRESERVE', 'c', E && this.fuel.L + this.fuel.R < 600],
      ['APUF', 'APU\nFEHLER', 'c', E && this.apu.fault],
      ['OIL', 'MTG\nÖLDRUCK', 'c', E && this.mtg.oil < 2.0],
      ['MTGT', 'MTG\nÜBERTEMP', 'w', E && this.mtg.egt > 860],
      ['HYDA', 'HYD A\nDRUCK', 'c', E && this.hyd.a < 150],
      ['HYDB', 'HYD B\nDRUCK', 'c', E && this.hyd.b < 150],
      ['COOL', 'KÜHLUNG', this.cool.temp > 115 ? 'w' : 'c', E && (this.cool.temp > 95 || (this.mtg.lit && this.cool.flow < 0.1))],
      ['INS', 'INS', 'c', E && this.ins.status !== 'NAV' && this.ins.status !== 'AUSGERICHTET'],
      ['GYRO', 'KREISEL', 'c', E && !this.gyro.ok],
      ['SENS', 'SENSOR', 'c', E && this.sens.boot.some((v) => v < 1)],
      ['ACT', 'AKTUATOR', 'c', E && !this.act.calibrated],
      ['FOOT', 'FUSS-\nSPERRE', 'a', E && sw.footLock === 0],
      ['ESTOP', 'NOT-AUS', 'w', E && !!sw.estop],
      ['BAL', 'STABILITÄT', 'w', E && this.act.posture > 0.2 && (!this.gyro.ok || !this.hydOK())],
    ];
    const prev = this.warn.active;
    const now = new Set();
    let newC = false, newW = false;
    for (const [id, , kind, on] of list) {
      if (on && P.ann) {
        now.add(id);
        if (!prev.has(id)) { if (kind === 'w') newW = true; else if (kind === 'c') newC = true; }
      }
    }
    if (newC) { this.warn.masterCaution = true; this.emit('caution'); }
    if (newW) { this.warn.masterWarning = true; this.warn.warningSilenced = false; }
    let anyW = false;
    for (const [id, , kind] of list) if (kind === 'w' && now.has(id)) anyW = true;
    if (!anyW) { this.warn.masterWarning = false; }
    if (!P.ann) { this.warn.masterCaution = false; this.warn.masterWarning = false; }
    this.warn.active = now;
    this.warn.list = list;
  }
}
