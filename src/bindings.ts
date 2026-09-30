// Rebindable controls: which controller input and which keys drive each action.

export type PadInput = { kind: 'button'; index: number } | { kind: 'axis'; index: number; dir: 1 | -1 };

export const ANALOG_ACTIONS = ['gas', 'brake', 'clutch', 'steerLeft', 'steerRight'] as const;
export const BUTTON_ACTIONS = ['shiftUp', 'shiftDown', 'handbrake', 'ignition', 'camera', 'reset', 'pause', 'debug'] as const;
export type AnalogAction = (typeof ANALOG_ACTIONS)[number];
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];
export type Action = AnalogAction | ButtonAction;
export const ACTIONS: Action[] = [...ANALOG_ACTIONS, ...BUTTON_ACTIONS];

export const ACTION_LABELS: Record<Action, string> = {
  gas: 'Gas',
  brake: 'Brake',
  clutch: 'Clutch',
  steerLeft: 'Steer left',
  steerRight: 'Steer right',
  shiftUp: 'Shift up',
  shiftDown: 'Shift down',
  handbrake: 'Handbrake',
  ignition: 'Ignition',
  camera: 'Camera',
  reset: 'Restart run',
  pause: 'Pause',
  debug: 'Debug info',
};

export interface Bindings {
  pad: Record<Action, PadInput | null>;
  keys: Record<Action, string[]>; // KeyboardEvent.code values
}

const btn = (index: number): PadInput => ({ kind: 'button', index });
const axis = (index: number, dir: 1 | -1): PadInput => ({ kind: 'axis', index, dir });

export function defaultBindings(): Bindings {
  return {
    pad: {
      gas: btn(7),
      brake: axis(3, 1),
      clutch: btn(6),
      steerLeft: axis(0, -1),
      steerRight: axis(0, 1),
      shiftUp: btn(5),
      shiftDown: btn(4),
      handbrake: btn(0),
      ignition: btn(3),
      camera: btn(13),
      reset: null,
      pause: btn(9),
      debug: btn(12),
    },
    keys: {
      gas: ['KeyW', 'ArrowUp'],
      brake: ['KeyS', 'ArrowDown'],
      clutch: ['Space'],
      steerLeft: ['KeyA', 'ArrowLeft'],
      steerRight: ['KeyD', 'ArrowRight'],
      shiftUp: ['KeyE'],
      shiftDown: ['KeyQ'],
      handbrake: ['KeyX'],
      ignition: ['KeyI'],
      camera: ['KeyC'],
      reset: ['KeyR'],
      pause: ['Escape', 'KeyP'],
      debug: ['Backquote', 'F2'],
    },
  };
}

/** Merge stored bindings over the defaults, dropping anything malformed. */
export function parseBindings(raw: unknown): Bindings {
  const b = defaultBindings();
  if (!raw || typeof raw !== 'object') return b;
  const r = raw as { pad?: Record<string, unknown>; keys?: Record<string, unknown> };
  for (const a of ACTIONS) {
    if (r.pad && a in r.pad) {
      const p = r.pad[a] as Partial<PadInput> | null;
      if (p === null) b.pad[a] = null;
      else if (p && p.kind === 'button' && Number.isInteger(p.index) && p.index! >= 0 && p.index! < 32) b.pad[a] = btn(p.index!);
      else if (p && p.kind === 'axis' && Number.isInteger(p.index) && p.index! >= 0 && p.index! < 16 && (p.dir === 1 || p.dir === -1))
        b.pad[a] = axis(p.index!, p.dir);
    }
    const k = r.keys?.[a];
    if (Array.isArray(k)) b.keys[a] = k.filter((x): x is string => typeof x === 'string' && x.length < 32).slice(0, 3);
  }
  return b;
}

export function samePad(a: PadInput | null, b: PadInput | null) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.index === b.index && (a.kind === 'button' || a.dir === (b as typeof a).dir);
}

/**
 * Bind an input to an action. Whatever else used that input loses it, so one press never
 * does two things. Returns the actions that were cleared.
 */
export function assignPad(b: Bindings, action: Action, input: PadInput | null): Action[] {
  const cleared: Action[] = [];
  if (input) {
    for (const a of ACTIONS) {
      if (a !== action && samePad(b.pad[a], input)) {
        b.pad[a] = null;
        cleared.push(a);
      }
    }
  }
  b.pad[action] = input;
  return cleared;
}

export function assignKey(b: Bindings, action: Action, code: string | null): Action[] {
  const cleared: Action[] = [];
  if (code) {
    for (const a of ACTIONS) {
      if (a !== action && b.keys[a].includes(code)) {
        b.keys[a] = b.keys[a].filter((k) => k !== code);
        cleared.push(a);
      }
    }
  }
  b.keys[action] = code ? [code] : [];
  return cleared;
}

/** How far an input is pushed, 0..1. */
export function padValue(pad: Gamepad, input: PadInput | null) {
  if (!input) return 0;
  if (input.kind === 'button') {
    const v = pad.buttons[input.index]?.value ?? 0;
    return deadzone(v, 0.02);
  }
  const v = (pad.axes[input.index] ?? 0) * input.dir;
  return deadzone(Math.max(0, v), 0.1);
}

export function padPressed(pad: Gamepad, input: PadInput | null) {
  if (!input) return false;
  if (input.kind === 'button') return pad.buttons[input.index]?.pressed ?? false;
  return (pad.axes[input.index] ?? 0) * input.dir > 0.5;
}

function deadzone(v: number, dz: number) {
  return v < dz ? 0 : (v - dz) / (1 - dz);
}

const PAD_BUTTONS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS', 'Touchpad'];
const PAD_AXES = ['Left stick', 'Left stick', 'Right stick', 'Right stick'];

export function padLabel(input: PadInput | null) {
  if (!input) return '—';
  if (input.kind === 'button') return PAD_BUTTONS[input.index] ?? `Button ${input.index}`;
  const name = PAD_AXES[input.index] ?? `Axis ${input.index}`;
  const horizontal = input.index % 2 === 0;
  return `${name} ${horizontal ? (input.dir < 0 ? '←' : '→') : input.dir < 0 ? '↑' : '↓'}`;
}

export function keyLabel(code: string) {
  const named: Record<string, string> = {
    Space: 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backquote: '`',
    Escape: 'Esc',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    AltLeft: 'L Alt',
    AltRight: 'R Alt',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function keysLabel(codes: string[]) {
  return codes.length ? codes.map(keyLabel).join(' / ') : '—';
}
