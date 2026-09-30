// Gamepad (standard mapping) + keyboard input, merged into one control state.
// DualSense and Xbox pads both use the W3C "standard" layout in Chrome.
// Driving controls come from rebindable Bindings; menu navigation stays fixed.

import { defaultBindings, padPressed, padValue, type Bindings, type PadInput } from './bindings';

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
  pause: boolean;
  cycleCamera: boolean;
  source: 'gamepad' | 'keyboard';
}

/** Menu navigation, edge-triggered with auto-repeat when held. */
export interface MenuNav {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  pause: boolean;
  tabPrev: boolean; // L1 / Q: previous section
  tabNext: boolean; // R1 / E: next section
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
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private prevButtons: boolean[] = [];
  private kbThrottle = 0;
  private kbBrake = 0;
  private kbClutch = 0;
  private kbSteer = 0;
  private menuKeys = new Set<string>();
  private held: Record<string, number> = {};
  private navPrev: boolean[] = [];
  gamepadIndex: number | null = null;
  bindings: Bindings = defaultBindings();
  private capture: { kind: 'pad' | 'key'; armed: boolean; baseline: number[]; until: number } | null = null;
  private capturedKey: string | null = null;
  lastSource: 'gamepad' | 'keyboard' = 'keyboard';
  /**
   * Mouse clutch: with the pointer grabbed, the mouse is the pedal. Pull it towards you to
   * push the clutch in, push it away to let it out; a click stamps it straight to the floor
   * and the wheel nudges it.
   */
  mouseClutch = false;
  /** Pixels of mouse travel for the full pedal. */
  mouseTravel = 260;
  private mousePedal = 0;
  private mouseHeld = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.capture && !this.capturedKey && (this.capture.kind === 'key' || e.code === 'Escape')) {
        this.capturedKey = e.code;
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseGrabbed) return;
      this.mousePedal = Math.min(1, Math.max(0, this.mousePedal + e.movementY / this.mouseTravel));
      if (e.movementY !== 0) this.lastSource = 'keyboard';
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.mouseGrabbed || e.button !== 0) return;
      this.mouseHeld = true;
      this.mousePedal = 1;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.mouseGrabbed) return;
        this.mousePedal = Math.min(1, Math.max(0, this.mousePedal + Math.sign(e.deltaY) * 0.08));
      },
      { passive: true },
    );
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => (this.gamepadIndex = e.gamepad.index));
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  /** True while the pointer is locked to the game for the mouse clutch. */
  get mouseGrabbed() {
    return this.mouseClutch && document.pointerLockElement !== null;
  }

  /** Lock the pointer so the mouse drives the clutch. Must run from a click. */
  grabMouse(el: HTMLElement) {
    if (!this.mouseClutch || document.pointerLockElement) return;
    try {
      const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      // Not allowed right now (no click, or the browser said no).
    }
  }

  releaseMouse() {
    if (document.pointerLockElement) document.exitPointerLock();
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
    const kb = this.bindings.keys;
    const k = (c: string) => this.keys.has(c);
    const any = (codes: string[]) => codes.some(k);
    const edge = (codes: string[]) => codes.some((c) => this.pressedKeys.has(c));
    const ramp = (cur: number, target: number, up: number, down: number) =>
      target > cur ? Math.min(target, cur + up * dt) : Math.max(target, cur - down * dt);

    // Keyboard pedals ramp so they can be feathered a little.
    this.kbThrottle = ramp(this.kbThrottle, any(kb.gas) ? 1 : 0, 3, 6);
    this.kbBrake = ramp(this.kbBrake, any(kb.brake) ? 1 : 0, 4, 8);
    // Clutch: hold to press it down fast; let go and it comes up slowly.
    // Holding Shift while releasing slows it further for gentle launches.
    const clutchUp = k('ShiftLeft') || k('ShiftRight') ? 0.35 : 0.9;
    this.kbClutch = ramp(this.kbClutch, any(kb.clutch) ? 1 : 0, 6, clutchUp);
    const steerTarget = (any(kb.steerRight) ? 1 : 0) - (any(kb.steerLeft) ? 1 : 0);
    this.kbSteer = ramp(this.kbSteer, steerTarget, 2.5, 3.5);

    const c: Controls = {
      throttle: this.kbThrottle,
      brake: this.kbBrake,
      clutch: Math.max(this.kbClutch, this.mouseGrabbed ? (this.mouseHeld ? 1 : this.mousePedal) : 0),
      steer: this.kbSteer,
      handbrake: any(kb.handbrake),
      shiftUp: edge(kb.shiftUp),
      shiftDown: edge(kb.shiftDown),
      ignition: edge(kb.ignition),
      reset: edge(kb.reset),
      toggleDebug: edge(kb.debug),
      pause: edge(kb.pause),
      cycleCamera: edge(kb.camera),
      source: 'keyboard',
    };
    const anyKey = this.keys.size > 0 || this.pressedKeys.size > 0;
    this.menuKeys = new Set(this.pressedKeys);
    this.pressedKeys.clear();

    const pad = this.gamepad();
    if (pad) {
      const pb = this.bindings.pad;
      const val = (i: PadInput | null) => padValue(pad, i);
      const held = (i: PadInput | null) => padPressed(pad, i);
      const pressed = (i: PadInput | null) => held(i) && !this.prevHeld(i);
      const gas = val(pb.gas);
      const brake = val(pb.brake);
      const clutch = val(pb.clutch);
      const sx = val(pb.steerRight) - val(pb.steerLeft);
      const padActive = gas > 0 || brake > 0 || clutch > 0 || sx !== 0 || pad.buttons.some((b) => b.pressed);

      if (padActive || !anyKey) {
        c.throttle = Math.max(c.throttle, gas);
        c.clutch = Math.max(c.clutch, clutch);
        c.brake = Math.max(c.brake, brake);
        if (sx !== 0) c.steer = Math.sign(sx) * Math.abs(sx) ** 1.4;
        c.handbrake ||= held(pb.handbrake);
        c.shiftUp ||= pressed(pb.shiftUp);
        c.shiftDown ||= pressed(pb.shiftDown);
        c.ignition ||= pressed(pb.ignition);
        c.pause ||= pressed(pb.pause);
        c.toggleDebug ||= pressed(pb.debug);
        c.cycleCamera ||= pressed(pb.camera);
        c.reset ||= pressed(pb.reset);
        if (padActive) this.lastSource = 'gamepad';
      }
      this.prevButtons = pad.buttons.map((b) => b.pressed);
      this.prevAxes = pad.axes.slice();
    }
    if (anyKey) this.lastSource = 'keyboard';
    c.source = this.lastSource;
    return c;
  }

  private prevAxes: readonly number[] = [];
  private prevHeld(i: PadInput | null) {
    if (!i) return false;
    if (i.kind === 'button') return this.prevButtons[i.index] ?? false;
    return (this.prevAxes[i.index] ?? 0) * i.dir > 0.5;
  }

  /** Start listening for the next controller input or key press to bind. */
  startCapture(kind: 'pad' | 'key') {
    const pad = this.gamepad();
    this.capture = { kind, armed: false, baseline: pad ? pad.axes.slice() : [], until: performance.now() + 8000 };
    this.capturedKey = null;
  }

  cancelCapture() {
    this.capture = null;
    this.capturedKey = null;
  }

  get capturing() {
    return this.capture !== null;
  }

  /**
   * Poll a capture started with startCapture. Returns the input once one arrives,
   * 'cancel' for Esc or after 8 seconds of nothing, or null while waiting.
   */
  pollCapture(): { pad?: PadInput; key?: string } | 'cancel' | null {
    const cap = this.capture;
    if (!cap) return null;
    if (performance.now() > cap.until) {
      this.cancelCapture();
      return 'cancel';
    }
    if (cap.kind === 'key') {
      const code = this.capturedKey;
      if (!code) return null;
      this.cancelCapture();
      return code === 'Escape' ? 'cancel' : { key: code };
    }
    const pad = this.gamepad();
    if (this.capturedKey === 'Escape') {
      this.cancelCapture();
      return 'cancel';
    }
    this.capturedKey = null;
    if (!pad) return null;
    // Wait until the press that opened the capture is let go, so it isn't bound by accident.
    const anyDown = pad.buttons.some((b) => b.pressed || b.value > 0.3);
    const anyMoved = pad.axes.some((v, i) => Math.abs(v - (cap.baseline[i] ?? 0)) > 0.3);
    if (!cap.armed) {
      if (!anyDown && !anyMoved) cap.armed = true;
      return null;
    }
    // Analog triggers report a value before "pressed"; take the first one past halfway.
    const b = pad.buttons.findIndex((x) => x.pressed || x.value > 0.5);
    if (b >= 0) {
      this.cancelCapture();
      return { pad: { kind: 'button', index: b } };
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const d = pad.axes[i] - (cap.baseline[i] ?? 0);
      if (Math.abs(d) > 0.6) {
        this.cancelCapture();
        return { pad: { kind: 'axis', index: i, dir: d > 0 ? 1 : -1 } };
      }
    }
    return null;
  }

  /**
   * Menu navigation for this frame. Call after read(): it reuses the key presses and
   * button states read there. Held directions repeat after a short delay.
   */
  nav(dt: number): MenuNav {
    const k = (c: string) => this.menuKeys.has(c);
    const pad = this.gamepad();
    const btn = (i: number) => pad?.buttons[i]?.pressed ?? false;
    const ax = pad?.axes[0] ?? 0;
    const ay = pad?.axes[1] ?? 0;
    // The stick only counts along its main axis, so a slightly diagonal push right
    // doesn't also move down a row.
    const vert = Math.abs(ay) > Math.abs(ax);
    const dirs = {
      up: btn(B.dpadUp) || (vert && ay < -0.6),
      down: btn(B.dpadDown) || (vert && ay > 0.6),
      left: btn(B.dpadLeft) || (!vert && ax < -0.6),
      right: btn(B.dpadRight) || (!vert && ax > 0.6),
    };
    const repeat = (name: keyof typeof dirs) => {
      if (!dirs[name]) {
        delete this.held[name];
        return false;
      }
      const t = this.held[name];
      if (t === undefined) {
        this.held[name] = 0.35; // first repeat delay
        return true;
      }
      this.held[name] = t - dt;
      if (this.held[name] <= 0) {
        this.held[name] = 0.12;
        return true;
      }
      return false;
    };
    const edgeBtn = (i: number) => btn(i) && !this.navPrev[i];
    const out: MenuNav = {
      up: repeat('up') || k('ArrowUp') || k('KeyW'),
      down: repeat('down') || k('ArrowDown') || k('KeyS'),
      left: repeat('left') || k('ArrowLeft') || k('KeyA'),
      right: repeat('right') || k('ArrowRight') || k('KeyD'),
      confirm: edgeBtn(B.cross) || k('Enter') || k('Space'),
      back: edgeBtn(B.circle) || k('Escape') || k('Backspace'),
      pause: edgeBtn(B.options),
      tabPrev: edgeBtn(B.l1) || k('KeyQ'),
      tabNext: edgeBtn(B.r1) || k('KeyE'),
    };
    this.navPrev = pad ? pad.buttons.map((b) => b.pressed) : [];
    return out;
  }
}
