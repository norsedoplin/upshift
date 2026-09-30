// Controller rumble driven by the drivetrain state.
// Chrome/Edge expose gamepad.vibrationActuator with "dual-rumble" (DualSense, DualShock, Xbox)
// and, for Xbox pads on Windows, "trigger-rumble". Everything here degrades to a no-op.

import type { Car } from './sim/car';
import { DualSense } from './dualsense';

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
  private lastSent = 0;
  private lastStrong = -1;
  private lastWeak = -1;
  private t = 0;
  /** Direct USB/Bluetooth link to a DualSense, used when the browser can't rumble it. */
  readonly dualsense = new DualSense();
  private testUntil = 0;

  stall() {
    this.impulse = Math.max(this.impulse, 1);
  }
  grind() {
    this.buzz = Math.max(this.buzz, 1);
  }
  jolt(strength: number) {
    this.impulse = Math.max(this.impulse, strength);
  }
  lock(slip: number) {
    // A clutch that snaps shut with a big speed difference is a thump.
    this.impulse = Math.max(this.impulse, Math.min(0.9, slip / 60));
  }

  update(dt: number, car: Car, pad: Gamepad | null, tyreSlip = 0) {
    this.t += dt;
    this.impulse *= Math.exp(-dt / 0.12);
    this.buzz *= Math.exp(-dt / 0.08);

    // Friction power in the clutch: highest right at the bite point while slipping.
    const slipPower = Math.abs(car.clutchTorque * (car.engineOmega - car.outputOmega));
    let bite = Math.min(1, slipPower / 9000) ** 0.6;
    // Clutch judder: a low shudder rather than a flat hum.
    bite *= 0.75 + 0.25 * Math.sin(this.t * 2 * Math.PI * 11);

    // Engine lugging under load at low rpm.
    const rpm = car.rpm;
    const lug =
      car.running && car.gear !== 0 && car.clutchCapacity > 20 && rpm < 1300
        ? ((1300 - rpm) / 900) * (0.3 + 0.7 * car.load) * (0.7 + 0.3 * Math.sin(this.t * 2 * Math.PI * (rpm / 30)))
        : 0;

    // Subtle idle buzz so a running engine is felt; much quieter than the bite.
    const idle = car.running ? 0.03 + (rpm / 7000) * 0.1 : car.cranking ? 0.25 : 0;

    this.strong = clamp01(bite * 0.85 + lug * 0.6 + this.impulse);
    // Tyres near and past their grip limit: a fine buzz you can drive by.
    const scrub = Math.max(0, Math.min(1, (tyreSlip - 0.08) / 0.2)) * (0.6 + 0.4 * Math.sin(this.t * 2 * Math.PI * 23));
    this.weak = clamp01(idle + bite * 0.3 + this.buzz * 0.9 + lug * 0.2 + scrub * 0.45);

    if (this.dualsense.connected) {
      if (performance.now() < this.testUntil) return;
      // No pad passed means menus are open: keep the motors still.
      const k = this.enabled && pad ? this.strength : 0;
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
      this.testUntil = performance.now() + 700;
      this.dualsense.rumble(1, 1);
      await new Promise((r) => setTimeout(r, 700));
      this.dualsense.stop();
      return 'Sent: felt it?';
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
    this.dualsense.stop();
    const act = (pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
    act?.reset?.().catch(() => {});
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
