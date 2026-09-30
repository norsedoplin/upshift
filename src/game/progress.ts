// Player progress and settings kept in this browser: creds, garage and personal bests.
// Storage can be unavailable (private windows, blocked site data), so every access is guarded.

import { defaultBindings, parseBindings, type Bindings } from '../bindings';

export interface Settings {
  rumble: number; // 0..1
  volume: number; // 0..1
  units: 'kmh' | 'mph';
  hints: boolean;
  camera: CameraView;
  fov: number; // degrees, horizontal screens; portrait screens add 20
  graphics: GraphicsQuality;
  speedo: SpeedoMode; // on-screen speedo; auto = only when the dash is out of view
  bindings: Bindings;
}

export type SpeedoMode = 'auto' | 'on' | 'off';
export const SPEEDO_MODES: SpeedoMode[] = ['auto', 'on', 'off'];

export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS_QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high'];

/** Phones and tablets start on Medium; everything else on High. */
export function defaultGraphics(): GraphicsQuality {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
  } catch {
    return 'high';
  }
}

export type CameraView = 'cockpit' | 'hood' | 'chase';
export const CAMERA_VIEWS: CameraView[] = ['cockpit', 'hood', 'chase'];

export interface Progress {
  creds: number;
  bestScore: number;
  runs: number;
  ownedCars: string[];
  ownedPaints: string[];
  car: string;
  paintByCar: Record<string, string>;
  settings: Settings;
  grants: string[]; // one-time gifts already given, so each lands only once
}

const KEY = 'upshift.progress.v1';

export const DEFAULT_SETTINGS: Settings = { rumble: 1, volume: 0.8, units: 'kmh', hints: true, camera: 'cockpit', fov: 60, graphics: 'high', speedo: 'auto', bindings: defaultBindings() };

export function defaultProgress(): Progress {
  return {
    creds: 0,
    bestScore: 0,
    runs: 0,
    ownedCars: ['hatch'],
    ownedPaints: [],
    car: 'hatch',
    paintByCar: {},
    settings: { ...DEFAULT_SETTINGS, graphics: defaultGraphics(), bindings: defaultBindings() },
    grants: [],
  };
}

/** Creds handed out once per save. The playtest grant lets testers try every car. */
export const GRANTS: { id: string; creds: number }[] = [
  { id: 'playtest-1', creds: 6000 },
  { id: 'playtest-2', creds: 6000 }, // for the Raijin and the reworked cars
];

/** Give any grants this save hasn't had yet. Returns true if something was added. */
export function applyGrants(p: Progress) {
  let changed = false;
  for (const g of GRANTS) {
    if (p.grants.includes(g.id)) continue;
    p.creds += g.creds;
    p.grants.push(g.id);
    changed = true;
  }
  return changed;
}

/** Merge whatever was stored (possibly an older, smaller shape) over the defaults. */
export function parseProgress(raw: string | null): Progress {
  const p = defaultProgress();
  if (!raw) return p;
  try {
    const s = JSON.parse(raw);
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    p.creds = Math.max(0, num(s.creds, 0));
    p.bestScore = Math.max(0, num(s.bestScore, 0));
    p.runs = Math.max(0, num(s.runs, 0));
    p.ownedCars = Array.from(new Set(['hatch', ...strs(s.ownedCars)]));
    p.ownedPaints = strs(s.ownedPaints);
    p.grants = strs(s.grants);
    if (typeof s.car === 'string' && p.ownedCars.includes(s.car)) p.car = s.car;
    if (s.paintByCar && typeof s.paintByCar === 'object') {
      for (const [k, v] of Object.entries(s.paintByCar)) if (typeof v === 'string') p.paintByCar[k] = v;
    }
    const st = s.settings ?? {};
    p.settings = {
      rumble: Math.min(1, Math.max(0, num(st.rumble, DEFAULT_SETTINGS.rumble))),
      volume: Math.min(1, Math.max(0, num(st.volume, DEFAULT_SETTINGS.volume))),
      units: st.units === 'mph' ? 'mph' : 'kmh',
      hints: typeof st.hints === 'boolean' ? st.hints : true,
      camera: CAMERA_VIEWS.includes(st.camera) ? st.camera : DEFAULT_SETTINGS.camera,
      fov: Math.round(Math.min(100, Math.max(50, num(st.fov, DEFAULT_SETTINGS.fov))) / 5) * 5,
      graphics: GRAPHICS_QUALITIES.includes(st.graphics) ? st.graphics : p.settings.graphics,
      speedo: SPEEDO_MODES.includes(st.speedo) ? st.speedo : DEFAULT_SETTINGS.speedo,
      bindings: parseBindings(st.bindings),
    };
  } catch {
    // Corrupt data: start fresh rather than crash.
  }
  return p;
}

export function loadProgress(): Progress {
  try {
    const p = parseProgress(localStorage.getItem(KEY));
    if (applyGrants(p)) saveProgress(p);
    return p;
  } catch {
    const p = defaultProgress();
    applyGrants(p);
    return p;
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not persisted; progress still counts for this session.
  }
}
