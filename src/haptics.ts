// Controller rumble driven by the drivetrain state.
// Chrome/Edge expose gamepad.vibrationActuator with "dual-rumble" (DualSense, DualShock, Xbox)
// and, for Xbox pads on Windows, "trigger-rumble". Everything here degrades to a no-op.

import type { Car } from './sim/car';
import { DualSense, TRIGGER_OFF, triggerSection } from './dualsense';

type Actuator = {
  effects?: string[];
  playEffect: (type: string, params: Record<string, number>) => Promise<string>;
  reset?: () => Promise<string>;
};

export class Haptics {
  enabled = true;
  strength = 1; // player setting, 0..1
  strong = 0;
  weak = 0;
  private impulse = 0; // decaying one-shot jolts
  private buzz = 0;
  private flutterAmp = 0; // turbo flutter on lift-off: a quick decaying pulse train
  private flutterT = 0;
  private lastSent = 0;
  private lastStrong = -1;
  private lastWeak = -1;
  private t = 0;
  /** Direct USB/Bluetooth link to a DualSense, used when the browser can't rumble it. */
  readonly dualsense = new DualSense();
  private testUntil = 0;
  private lastEngage = 1;
  /** How fast the clutch is engaging (per second, smoothed): positive letting out, negative pushing in. */
  private engageRate = 0;
  /** Which trigger the clutch is on (from the bindings), so it can push back at the bite point. */
  clutchTrigger: 'left' | 'right' | null = 'left';
  clutchFeel = true; // player setting

  stall() {
    this.impulse = Math.max(this.impulse, 1);
  }
  grind() {
    this.buzz = Math.max(this.buzz, 1);
  }
  jolt(strength: number) {
    this.impulse = Math.max(this.impulse, strength);
  }
  flutter(strength: number) {
    this.flutterAmp = Math.max(this.flutterAmp, Math.min(0.35, strength * 0.3));
    this.flutterT = 0;
  }
  thud(strength: number) {
    this.impulse = Math.max(this.impulse, Math.min(0.6, strength));
  }
  lock(slip: number) {
    // A clutch that snaps shut with a big speed difference is a thump.
    this.impulse = Math.max(this.impulse, Math.min(0.9, slip / 60));
  }

  update(dt: number, car: Car, pad: Gamepad | null, tyreSlip = 0) {
    this.t += dt;
    this.impulse *= Math.exp(-dt / 0.12);
    this.buzz *= Math.exp(-dt / 0.08);
    this.flutterAmp *= Math.exp(-dt / 0.18);
    this.flutterT += dt;
    const flutter = this.flutterAmp > 0.02 && Math.sin(this.flutterT * 2 * Math.PI * 13) > 0 ? this.flutterAmp : 0;

    // A soft thud as the clutch comes fully home, bigger for a quick release in gear.
    const engage = car.spec.clutchMaxTorque > 0 ? car.clutchCapacity / car.spec.clutchMaxTorque : 1;
    if (dt > 0) this.engageRate += ((engage - this.lastEngage) / dt - this.engageRate) * Math.min(1, dt / 0.08);
    // Letting the clutch out is what you feel for, so it's felt far more than pushing it in.
    const releasing = clamp01(this.engageRate / 1.2);
    const pressing = clamp01(-this.engageRate / 1.2);
    // The moment it first grabs on the way out: a small knock.
    if (this.lastEngage < 0.04 && engage >= 0.04 && this.engageRate > 0.2 && car.gear !== 0) this.impulse = Math.max(this.impulse, 0.28);
    if (this.lastEngage < 0.97 && engage >= 0.97 && dt > 0) {
      const rate = Math.min(1, (engage - this.lastEngage) / dt / 6); // full release in ~1/6 s = 1
      this.thud(0.18 + 0.3 * rate + (car.gear !== 0 ? 0.08 : 0));
    }
    this.lastEngage = engage;

    // Friction power in the clutch: highest right at the bite point while slipping.
    const slipPower = Math.abs(car.clutchTorque * (car.engineOmega - car.outputOmega));
    let bite = Math.min(1, slipPower / 7000) ** 0.5;
    // Clutch judder: a low shudder rather than a flat hum.
    bite *= 0.75 + 0.25 * Math.sin(this.t * 2 * Math.PI * 11);
    bite = Math.min(1, bite * (1 + 1.1 * releasing - 0.65 * pressing));

    // Engine lugging under load at low rpm.
    const rpm = car.rpm;
    const lug =
      car.running && car.gear !== 0 && car.clutchCapacity > 20 && rpm < 1300
        ? ((1300 - rpm) / 900) * (0.3 + 0.7 * car.load) * (0.7 + 0.3 * Math.sin(this.t * 2 * Math.PI * (rpm / 30)))
        : 0;

    // Subtle idle buzz so a running engine is felt; much quieter than the bite.
    const idle = car.running ? 0.012 + (rpm / 7000) * 0.04 : car.cranking ? 0.2 : 0;

    // On boost the car hums through the seat.
    const tb = car.spec.turbo;
    const boost = tb ? (car.boost / tb.maxBoost) * car.throttleEff : 0;
    this.strong = clamp01(bite + lug * 0.4 + this.impulse + boost * 0.12);
    // Tyres near and past their grip limit: a fine buzz you can drive by.
    const scrub = Math.max(0, Math.min(1, (tyreSlip - 0.08) / 0.2)) * (0.6 + 0.4 * Math.sin(this.t * 2 * Math.PI * 23));
    this.weak = clamp01(idle + boost * 0.1 + bite * 0.35 + this.buzz * 0.9 + flutter + lug * 0.12 + scrub * 0.22);

    if (this.dualsense.connected) {
      if (performance.now() < this.testUntil) return;
      // No pad passed means menus are open: keep the motors still.
      const k = this.enabled && pad ? this.strength : 0;
      // Adaptive trigger: the clutch trigger stiffens over the stretch where the clutch first grabs.
      // Pedal travel is 1 - engagement, so the grab starts at 1 - biteStart and firms up towards 1 - biteEnd.
      let clutch = TRIGGER_OFF;
      if (pad && this.clutchFeel && this.clutchTrigger && k > 0) {
        const grab = 1 - car.spec.biteStart;
        const firm = 1 - car.spec.biteEnd;
        const start = grab - (grab - firm) * 0.35;
        // Kept light: enough to find the bite, not a wall.
        // Firmer while letting it out, barely there pushing in.
        // Three steps rather than a smooth blend, so the pad isn't sent a new effect every frame.
        const force = releasing > 0.15 ? 0.22 : pressing > 0.15 ? 0.05 : 0.1;
        clutch = triggerSection(start, grab + 0.03, force * Math.min(1, 0.4 + 0.6 * k));
      }
      this.dualsense.setTriggers(this.clutchTrigger === 'left' ? clutch : TRIGGER_OFF, this.clutchTrigger === 'right' ? clutch : TRIGGER_OFF);
      this.dualsense.rumble(this.strong * k, this.weak * k);
      return;
    }
    if (!this.enabled || !pad || this.strength <= 0) return;
    const act = (pad as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    if (!act?.playEffect) return;

    // Effects are fire-and-forget with a duration, so re-issue short ones continuously.
    const now = performance.now();
    const changed = Math.abs(this.strong - this.lastStrong) > 0.04 || Math.abs(this.weak - this.lastWeak) > 0.04;
    if (now - this.lastSent < (changed ? 30 : 70)) return;
    this.lastSent = now;
    this.lastStrong = this.strong;
    this.lastWeak = this.weak;
    const k = this.strength;
    const params = { startDelay: 0, duration: 120, strongMagnitude: this.strong * k, weakMagnitude: this.weak * k };
    if (act.effects?.includes('trigger-rumble')) {
      act
        .playEffect('trigger-rumble', { ...params, leftTrigger: clamp01(bite * 0.9 + this.buzz * 0.5) * k, rightTrigger: clamp01(lug * 0.4) * k })
        .catch(() => {});
    } else {
      act.playEffect('dual-rumble', params).catch(() => {});
    }
  }

  /** Plays one strong pulse and says what happened, so players can tell whether their browser can rumble. */
  async test(pad: Gamepad | null): Promise<string> {
    if (this.dualsense.connected) {
      this.testUntil = performance.now() + 800;
      const err = await this.dualsense.pulse(1, 1, 700);
      const fw = this.dualsense.firmware ? ` fw ${this.dualsense.firmware}` : '';
      return err ? `Error: ${err}` : `Sent (${this.dualsense.vibrationV2 ? 'v2' : 'v1'}${fw}): felt it?`;
    }
    if (!pad) return 'No controller yet';
    const act = (pad as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    if (!act?.playEffect) return 'Not in this browser';
    try {
      const r = await act.playEffect('dual-rumble', { startDelay: 0, duration: 700, strongMagnitude: 1, weakMagnitude: 1 });
      return r === 'complete' || r === 'preempted' ? 'Sent: felt it?' : `Result: ${r}`;
    } catch (e) {
      console.warn('Rumble test failed', e);
      return 'Failed';
    }
  }

  stop(pad: Gamepad | null) {
    this.dualsense.setTriggers(TRIGGER_OFF, TRIGGER_OFF);
    this.dualsense.stop();
    const act = (pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
    act?.reset?.().catch(() => {});
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
