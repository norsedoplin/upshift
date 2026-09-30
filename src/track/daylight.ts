// Time of day: moves the sun (or moon) and recolours the sky, fog, light and haze to match.
// Pure colour maths up top so it can be tested; the class below applies it to the scene.

import * as THREE from 'three';
import type { TimeOfDay } from '../game/progress';

export interface Sky {
  top: THREE.Color;
  horizon: THREE.Color;
  light: THREE.Color; // sun or moon colour
  lightI: number; // directional light intensity
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  env: number; // image-based light
  dark: number; // 0 in daylight, 1 at night: lamps, headlights, stars
}

interface Key {
  h: number;
  top: string;
  horizon: string;
  light: string;
  lightI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  env: number;
  dark: number;
}

// The sun rises at 6:00 and sets at 19:00; around those times the light fades out and the
// moon takes over, so the switch between them happens in the dark.
const KEYS: Key[] = [
  { h: 0, top: '#020409', horizon: '#05070d', light: '#8ea4d8', lightI: 0.05, hemiSky: '#1a2440', hemiGround: '#050608', hemiI: 0.07, env: 0.012, dark: 1 },
  { h: 5.0, top: '#050815', horizon: '#11121f', light: '#8ea4d8', lightI: 0.06, hemiSky: '#1d2a48', hemiGround: '#07080b', hemiI: 0.1, env: 0.02, dark: 1 },
  { h: 5.9, top: '#28396a', horizon: '#b77a74', light: '#ff9c6a', lightI: 0.02, hemiSky: '#5d6d96', hemiGround: '#2c2622', hemiI: 0.35, env: 0.15, dark: 0.7 },
  { h: 6.7, top: '#4c74aa', horizon: '#f4b485', light: '#ffb27a', lightI: 1.6, hemiSky: '#8fa8c8', hemiGround: '#6a5a48', hemiI: 0.75, env: 0.5, dark: 0.15 },
  { h: 8.5, top: '#5a93c9', horizon: '#e9dfcf', light: '#fff0da', lightI: 2.8, hemiSky: '#8fbde0', hemiGround: '#9c8a66', hemiI: 0.95, env: 0.75, dark: 0 },
  { h: 12.5, top: '#5d9bd0', horizon: '#f2dcc0', light: '#ffe6c4', lightI: 3.1, hemiSky: '#7fb2d9', hemiGround: '#9c8a66', hemiI: 1.0, env: 0.8, dark: 0 },
  { h: 16.2, top: '#5b95cc', horizon: '#f2d8b8', light: '#ffe0b8', lightI: 3.0, hemiSky: '#7fb2d9', hemiGround: '#9c8a66', hemiI: 1.0, env: 0.8, dark: 0 },
  { h: 17.9, top: '#4f6fa6', horizon: '#f6b27a', light: '#ffa860', lightI: 2.3, hemiSky: '#8a9cc0', hemiGround: '#8a6a4a', hemiI: 0.8, env: 0.6, dark: 0.05 },
  { h: 18.7, top: '#2d3d6e', horizon: '#e08466', light: '#ff7a4a', lightI: 0.8, hemiSky: '#6a6f96', hemiGround: '#4a3a32', hemiI: 0.6, env: 0.35, dark: 0.35 },
  { h: 19.1, top: '#1a2550', horizon: '#7a5260', light: '#ff7a4a', lightI: 0.02, hemiSky: '#3c4670', hemiGround: '#1c1a1c', hemiI: 0.3, env: 0.1, dark: 0.75 },
  { h: 20.0, top: '#060a1a', horizon: '#121426', light: '#8ea4d8', lightI: 0.06, hemiSky: '#1d2a48', hemiGround: '#07080b', hemiI: 0.1, env: 0.02, dark: 1 },
  { h: 24, top: '#020409', horizon: '#05070d', light: '#8ea4d8', lightI: 0.05, hemiSky: '#1a2440', hemiGround: '#050608', hemiI: 0.07, env: 0.012, dark: 1 },
];

export const PRESET_HOURS: Record<Exclude<TimeOfDay, 'cycle'>, number> = { morning: 7.6, noon: 13, sunset: 18.3, night: 22.5 };

/** Real minutes for one full day on the Day cycle setting. */
export const DAY_MINUTES = 16;

const SUNRISE = 6;
const SUNSET = 19;

/** Direction from the ground towards the sun at an hour (it can be below the horizon). */
export function sunDirection(hour: number, out = new THREE.Vector3()) {
  const a = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  return out.set(Math.cos(a) * 0.85, Math.sin(a) * 0.9, 0.45).normalize();
}

/** Where the light comes from: the sun by day, the moon (high on the other side) by night. */
export function lightDirection(hour: number, out = new THREE.Vector3()) {
  sunDirection(hour, out);
  if (out.y > -0.02) return out.setY(Math.max(out.y, 0.06)).normalize();
  // Moon: opposite the sun, never lower than about 25 degrees.
  return out.set(-out.x, Math.max(0.45, -out.y), out.z * 0.6).normalize();
}

export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (h - a.h) / (b.h - a.h);
  const col = (x: string, y: string) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  const num = (x: number, y: number) => x + (y - x) * t;
  return {
    top: col(a.top, b.top),
    horizon: col(a.horizon, b.horizon),
    light: col(a.light, b.light),
    lightI: num(a.lightI, b.lightI),
    hemiSky: col(a.hemiSky, b.hemiSky),
    hemiGround: col(a.hemiGround, b.hemiGround),
    hemiI: num(a.hemiI, b.hemiI),
    env: num(a.env, b.env),
    dark: num(a.dark, b.dark),
  };
}

/** Everything in the scene that changes with the time of day. */
export interface DayTargets {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  skies: THREE.ShaderMaterial[]; // the visible sky and the one baked into reflections
  haze: { mat: THREE.MeshStandardMaterial; amount: number }[]; // distant mountains
  clouds: THREE.MeshStandardMaterial;
  lamps: THREE.MeshStandardMaterial[]; // lit at night
  pools: THREE.MeshBasicMaterial[]; // pools of lamplight on the ground, only seen after dark
  envGround: THREE.MeshBasicMaterial;
}

export class DayCycle {
  hour = 13;
  /** Where the light comes from now. */
  dir = new THREE.Vector3();
  sky: Sky = skyAt(13);
  private bakedHour = -99;

  constructor(private t: DayTargets) {
    this.apply();
  }

  /** Advance the clock (Day cycle) or jump to a fixed time. Returns true when reflections should be rebaked. */
  update(dt: number, mode: TimeOfDay) {
    if (mode === 'cycle') this.hour = (this.hour + (dt / (DAY_MINUTES * 60)) * 24) % 24;
    else this.hour = PRESET_HOURS[mode];
    this.apply();
    const diff = Math.abs(this.hour - this.bakedHour);
    if (Math.min(diff, 24 - diff) > 0.2) {
      this.bakedHour = this.hour;
      return true;
    }
    return false;
  }

  private apply() {
    const { scene, sun, hemi, skies, haze, clouds, lamps, pools, envGround } = this.t;
    const s = (this.sky = skyAt(this.hour));
    lightDirection(this.hour, this.dir);
    sun.color.copy(s.light);
    sun.intensity = s.lightI;
    hemi.color.copy(s.hemiSky);
    hemi.groundColor.copy(s.hemiGround);
    hemi.intensity = s.hemiI;
    scene.environmentIntensity = s.env;
    (scene.background as THREE.Color | null)?.copy?.(s.horizon);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(s.horizon);
    const isSun = sunDirection(this.hour).y > -0.02;
    for (const m of skies) {
      m.uniforms.top.value.copy(s.top);
      m.uniforms.horizon.value.copy(s.horizon);
      m.uniforms.sunDir.value.copy(this.dir);
      // The moon gets a small pale disc and hardly any glow.
      m.uniforms.sunColor.value.copy(isSun ? s.light : new THREE.Color('#c8d4f0')).multiplyScalar(isSun ? Math.min(1, s.lightI / 1.2 + 0.3) : 0.35);
      m.uniforms.stars.value = Math.max(0, (s.dark - 0.4) / 0.6);
    }
    for (const { mat, amount } of haze) {
      mat.emissive.copy(s.horizon);
      mat.emissiveIntensity = amount;
    }
    clouds.emissive.copy(s.horizon).lerp(new THREE.Color('#dfe6ee'), 1 - s.dark);
    clouds.color.setScalar(1 - s.dark * 0.7);
    for (const m of lamps) m.emissiveIntensity = 0.15 + s.dark * 2;
    for (const m of pools) {
      m.opacity = s.dark * 0.9;
      m.visible = s.dark > 0.05;
    }
    envGround.color.set('#5e5d4c').multiplyScalar(0.15 + 0.85 * (1 - s.dark));
  }
}
