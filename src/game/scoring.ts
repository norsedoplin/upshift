// Skill scoring: rewards shifting well, not going fast. Every gear change is graded on
// rev matching, smoothness and speed; heel-toe downshifts earn a bonus; stalls, grinds,
// money shifts, lugging, over-revving and hitting the rails cost points and break the combo.

import type { Car, CarEvent } from '../sim/car';
import { RPM } from '../sim/car';

export type Grade = 'PERFECT' | 'CLEAN' | 'OK' | 'ROUGH';

export interface ScoreEvent {
  label: string;
  points: number; // after multiplier; negative for penalties
  combo: number;
  good: boolean;
}

export interface ScoreInputs {
  throttle: number;
  brake: number;
  clutch: number;
}

interface PendingShift {
  from: number;
  to: number;
  down: boolean;
  clutchDownAt: number;
  shiftAt: number;
  slipAtBite: number | null;
  energy: number;
  lastAccel: number;
  jerk: number; // peak rate of change of acceleration during engagement, m/s^3
  braking: boolean;
  blipped: boolean;
  moneyShift: boolean;
}

export interface RunStats {
  score: number;
  shifts: number;
  perfect: number;
  clean: number;
  heelToe: number;
  stalls: number;
  bestCombo: number;
}

export class Scorer {
  time = 0;
  score = 0;
  combo = 0;
  stats: RunStats = { score: 0, shifts: 0, perfect: 0, clean: 0, heelToe: 0, stalls: 0, bestCombo: 0 };
  private events: ScoreEvent[] = [];
  private pending: PendingShift | null = null;
  private clutchDownAt = -1;
  private lastGear = 0;
  private brakeWindow = 0;
  private blipWindow = 0;
  private lugTime = 0;
  private lugFlagged = false;
  private limiterTime = 0;
  private limiterFlagged = false;
  private launch: { energy: number } | null = null;
  private wallCooldown = 0;

  get multiplier() {
    return 1 + Math.min(this.combo, 8) * 0.25;
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  reset() {
    Object.assign(this, new Scorer());
  }

  private award(label: string, base: number, good: boolean) {
    const points = base > 0 ? Math.round(base * this.multiplier) : base;
    this.score = Math.max(0, this.score + points);
    this.stats.score = this.score;
    this.events.push({ label, points, combo: this.combo, good });
  }

  private breakCombo() {
    this.combo = 0;
  }

  update(dt: number, car: Car, inp: ScoreInputs, carEvents: CarEvent[]) {
    this.time += dt;
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    const rpm = car.rpm;

    // Remember when the clutch went down and what the feet did around the shift.
    if (inp.clutch > 0.8 && this.clutchDownAt < 0) this.clutchDownAt = this.time;
    if (inp.clutch < 0.5 && !this.pending) this.clutchDownAt = -1;
    this.brakeWindow = inp.brake > 0.25 ? this.time : this.brakeWindow;
    this.blipWindow = inp.throttle > 0.3 ? this.time : this.blipWindow;

    for (const e of carEvents) {
      if (e.type === 'shift') this.onShift(e.gear, car);
      else if (e.type === 'grind') {
        this.breakCombo();
        this.award('GRIND', -25, false);
      } else if (e.type === 'stall') {
        this.pending = null;
        this.launch = null;
        this.breakCombo();
        this.stats.stalls++;
        this.award('STALLED', -100, false);
      } else if (e.type === 'wall' && this.wallCooldown === 0 && e.impact > 1.5) {
        this.wallCooldown = 1;
        this.breakCombo();
        this.award('HIT THE RAIL', -Math.round(Math.min(150, 20 + e.impact * 12)), false);
      }
    }

    // Grade an in-progress gear change.
    const p = this.pending;
    if (p) {
      if (inp.throttle > 0.3) p.blipped = true;
      if (inp.brake > 0.25) p.braking = true;
      const slip = (car.engineOmega - car.outputOmega) * RPM;
      if (p.slipAtBite === null && car.clutchCapacity > 30) {
        p.slipAtBite = slip;
        // Dropping the clutch into a gear that would spin the engine far past the limiter.
        if (car.outputOmega * RPM > car.spec.revLimit + 700) p.moneyShift = true;
      }
      if (p.slipAtBite !== null) {
        p.energy += Math.abs(car.clutchTorque * (car.engineOmega - car.outputOmega)) * dt;
        p.jerk = Math.max(p.jerk, Math.abs(car.accel - p.lastAccel) / dt);
      }
      p.lastAccel = car.accel;
      const done = carEvents.some((e) => e.type === 'lock') && p.slipAtBite !== null;
      if (done || this.time - p.shiftAt > 3) this.finishShift(p, done);
    }

    // A launch from a standstill: graded on how much clutch it cost.
    if (this.launch) {
      this.launch.energy += Math.abs(car.clutchTorque * (car.engineOmega - car.outputOmega)) * dt;
      if (car.locked && car.speed > 1) {
        const e = this.launch.energy;
        this.launch = null;
        if (e < 25000) this.award('SMOOTH LAUNCH', 40, true);
        else if (e > 60000) this.award('CLUTCH COOKED', -20, false);
      }
    } else if (car.gear === 1 && Math.abs(car.speed) < 0.2 && inp.clutch > 0.8 && car.running) {
      this.launch = { energy: 0 };
    }

    // Driving in the wrong gear: lugging and bouncing off the limiter.
    const inGear = car.gear !== 0 && car.locked && car.running;
    if (inGear && rpm < 1100 && car.load > 0.5 && Math.abs(car.speed) > 2) this.lugTime += dt;
    else {
      this.lugTime = 0;
      this.lugFlagged = false;
    }
    if (this.lugTime > 1.5 && !this.lugFlagged) {
      this.lugFlagged = true;
      this.award('LUGGING', -10, false);
    }
    if (inGear && rpm > car.spec.revLimit - 50) this.limiterTime += dt;
    else {
      this.limiterTime = 0;
      this.limiterFlagged = false;
    }
    if (this.limiterTime > 0.8 && !this.limiterFlagged) {
      this.limiterFlagged = true;
      this.award('ON THE LIMITER', -10, false);
    }
    this.lastGear = car.gear;
  }

  private onShift(gear: number, car: Car) {
    const from = this.lastGear;
    this.lastGear = gear;
    if (gear <= 0 || Math.abs(car.speed) < 2) return; // neutral, reverse, or pulling away
    if (from === gear) return;
    this.pending = {
      from,
      to: gear,
      down: from > gear || from === 0,
      clutchDownAt: this.clutchDownAt >= 0 ? this.clutchDownAt : this.time,
      shiftAt: this.time,
      slipAtBite: null,
      energy: 0,
      lastAccel: car.accel,
      jerk: 0,
      braking: this.time - this.brakeWindow < 0.6,
      blipped: false,
      moneyShift: false,
    };
    if (from !== 0) this.pending.down = gear < from;
  }

  private finishShift(p: PendingShift, completed: boolean) {
    this.pending = null;
    this.clutchDownAt = -1;
    if (!completed || p.slipAtBite === null) return; // left in neutral / coasting: no grade
    this.stats.shifts++;
    if (p.moneyShift) {
      this.breakCombo();
      this.award('MONEY SHIFT', -150, false);
      return;
    }
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    const match = clamp(1 - Math.abs(p.slipAtBite) / 1500);
    const smooth = clamp(1 - (p.jerk - 10) / 50);
    const wear = clamp(1 - p.energy / 8000);
    const duration = this.time - p.clutchDownAt;
    const quick = clamp(1 - (duration - 0.6) / 2);
    const q = 0.45 * match + 0.25 * smooth + 0.15 * wear + 0.15 * quick;

    let grade: Grade = 'ROUGH';
    if (q >= 0.9) grade = 'PERFECT';
    else if (q >= 0.75) grade = 'CLEAN';
    else if (q >= 0.5) grade = 'OK';

    if (grade === 'PERFECT' || grade === 'CLEAN') this.combo++;
    else if (grade === 'ROUGH') this.breakCombo();
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    if (grade === 'PERFECT') this.stats.perfect++;
    if (grade === 'CLEAN') this.stats.clean++;

    const label = `${grade} ${p.down ? 'DOWNSHIFT' : 'SHIFT'}`;
    this.award(label, Math.round(100 * q * q), grade !== 'ROUGH');

    if (p.down && p.braking && p.blipped && match >= 0.7) {
      this.stats.heelToe++;
      this.award('HEEL-TOE', 50, true);
    }
  }
}

/** Creds earned for a finished run. */
export function credsForRun(stats: RunStats) {
  return Math.round(stats.score / 10) + 20;
}
