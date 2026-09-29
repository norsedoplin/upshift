// Gamepad (standard mapping) + keyboard input, merged into one control state.
// DualSense and Xbox pads both use the W3C "standard" layout in Chrome.

export interface Controls {
  throttle: number;
  brake: number;
  clutch: number; // 1 = pedal fully down
  steer: number; // -1..1, left negative
  handbrake: boolean;
  shiftUp: boolean; // edge-triggered this frame
  shiftDown: boolean;
  ignition: boolean;
  reset: boolean;
  toggleDebug: boolean;
  source: 'gamepad' | 'keyboard';
}

const B = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  options: 9,
  dpadUp: 12,
} as const;

function deadzone(v: number, dz: number) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private prevButtons: boolean[] = [];
  private kbThrottle = 0;
  private kbBrake = 0;
  private kbClutch = 0;
  private kbSteer = 0;
  gamepadIndex: number | null = null;
  lastSource: 'gamepad' | 'keyboard' = 'keyboard';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => (this.gamepadIndex = e.gamepad.index));
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  gamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex !== null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.gamepadIndex = p.index;
        return p;
      }
    }
    return null;
  }

  read(dt: number): Controls {
    const k = (c: string) => this.keys.has(c);
    const edge = (c: string) => this.pressedKeys.has(c);
    const ramp = (cur: number, target: number, up: number, down: number) =>
      target > cur ? Math.min(target, cur + up * dt) : Math.max(target, cur - down * dt);

    // Keyboard pedals ramp so they can be feathered a little.
    this.kbThrottle = ramp(this.kbThrottle, k('KeyW') || k('ArrowUp') ? 1 : 0, 3, 6);
    this.kbBrake = ramp(this.kbBrake, k('KeyS') || k('ArrowDown') ? 1 : 0, 4, 8);
    // Clutch: hold Space to press it down fast; let go and it comes up slowly.
    // Holding Shift while releasing slows it further for gentle launches.
    const clutchUp = k('ShiftLeft') || k('ShiftRight') ? 0.35 : 0.9;
    this.kbClutch = ramp(this.kbClutch, k('Space') ? 1 : 0, 6, clutchUp);
    const steerTarget = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    this.kbSteer = ramp(this.kbSteer, steerTarget, 2.5, 3.5);

    const c: Controls = {
      throttle: this.kbThrottle,
      brake: this.kbBrake,
      clutch: this.kbClutch,
      steer: this.kbSteer,
      handbrake: k('KeyX'),
      shiftUp: edge('KeyE'),
      shiftDown: edge('KeyQ'),
      ignition: edge('KeyI'),
      reset: edge('KeyR'),
      toggleDebug: edge('Backquote') || edge('F2'),
      source: 'keyboard',
    };
    const anyKey = this.keys.size > 0 || this.pressedKeys.size > 0;
    this.pressedKeys.clear();

    const pad = this.gamepad();
    if (pad) {
      const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
      const val = (i: number) => pad.buttons[i]?.value ?? 0;
      const pressed = (i: number) => btn(i) && !this.prevButtons[i];
      const lt = deadzone(val(B.l2), 0.02);
      const rt = deadzone(val(B.r2), 0.02);
      const sx = deadzone(pad.axes[0] ?? 0, 0.08);
      const ry = deadzone(pad.axes[3] ?? 0, 0.12);
      const padActive = lt > 0 || rt > 0 || sx !== 0 || ry > 0 || pad.buttons.some((b) => b.pressed);

      if (padActive || !anyKey) {
        c.throttle = Math.max(c.throttle, rt);
        c.clutch = Math.max(c.clutch, lt);
        c.brake = Math.max(c.brake, Math.max(0, ry));
        if (sx !== 0) c.steer = Math.sign(sx) * Math.abs(sx) ** 1.4;
        c.handbrake ||= btn(B.cross);
        c.shiftUp ||= pressed(B.r1);
        c.shiftDown ||= pressed(B.l1);
        c.ignition ||= pressed(B.triangle);
        c.reset ||= pressed(B.options);
        c.toggleDebug ||= pressed(B.dpadUp);
        if (padActive) this.lastSource = 'gamepad';
      }
      this.prevButtons = pad.buttons.map((b) => b.pressed);
    }
    if (anyKey) this.lastSource = 'keyboard';
    c.source = this.lastSource;
    return c;
  }
}
