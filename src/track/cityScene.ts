// Meshes for the free-roam town (see city.ts for the layout): streets and their paint,
// sidewalks, buildings merged into a few big meshes per district, and the street clutter
// that makes it feel like a Japanese neighbourhood: utility poles and their wires, vending
// machines, lanterns, signs, signals, gas stations, a shrine. Signs, windows and lamps
// glow after dark.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../cockpit';
import { CARS } from '../cars';
import { buildCarModel } from '../ui/carModel';
import { FLOOR, faceYaw, type Building, type City, type Facing, type Rect } from './city';
import type { DayTargets } from './daylight';
import { SUN_COLOR, SUN_DIR, buildClouds, buildEnvironmentScene, buildMountains, buildSky, type Scenery } from './scenery';

// ---------------------------------------------------------------------------
// Geometry batching: everything static goes into a few big non-indexed meshes.

class Batch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** A quad a-b-c-d, counter-clockwise seen from the front. */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color, uv?: number[]) {
    const n = normal(a, b, c);
    const u = uv ?? [0, 0, 1, 0, 1, 1, 0, 1];
    for (const [p, i] of [
      [a, 0],
      [b, 1],
      [c, 2],
      [a, 0],
      [c, 2],
      [d, 3],
    ] as [number[], number][]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(u[i * 2], u[i * 2 + 1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  tri(a: number[], b: number[], c: number[], color: THREE.Color) {
    const n = normal(a, b, c);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(0, 0);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /**
   * An axis-aligned box. `wallUv` maps each side's (distance along the wall, height) to
   * texture coordinates; without it the sides get plain 0..1 UVs.
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, opts: { wallUv?: (along: number, y: number) => [number, number]; top?: THREE.Color; noTop?: boolean; faces?: boolean[]; uv?: number[] } = {}) {
    const f = opts.faces ?? [true, true, true, true];
    const side = (a: number[], b: number[], c: number[], dd: number[], len: number) => {
      let uv = opts.uv;
      if (opts.wallUv) {
        const p = opts.wallUv(0, y0);
        const q = opts.wallUv(len, y1);
        uv = [p[0], p[1], q[0], p[1], q[0], q[1], p[0], q[1]];
      }
      this.quad(a, b, c, dd, color, uv);
    };
    const W = x1 - x0;
    const D = z1 - z0;
    if (f[0]) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], W); // north
    if (f[1]) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], D); // east
    if (f[2]) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], W); // south
    if (f[3]) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], D); // west
    if (!opts.noTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opts.top ?? color, opts.uv);
  }

  /** Any geometry, moved into place and painted one colour. */
  geo(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color) {
    const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    const p = ng.attributes.position;
    const nr = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nr.getX(i), nr.getY(i), nr.getZ(i));
      this.uv.push(0, 0);
      this.col.push(color.r, color.g, color.b);
    }
    ng.dispose();
  }

  mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    return m;
  }

  get empty() {
    return this.pos.length === 0;
  }
}

function normal(a: number[], b: number[], c: number[]) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------------------
// Textures, drawn once on canvases.

const JP_FONT = '"Hiragino Sans","Yu Gothic","Meiryo","Noto Sans JP","Noto Sans CJK JP","WenQuanYi Zen Hei",sans-serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function texture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Hash for deterministic "random" choices while drawing textures. */
function hr(i: number) {
  const s = Math.sin(i * 91.7 + 13.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Homes: 4x4 cells, each one bay by one storey, with sliding windows. Lit windows in the emissive map. */
function residentialFacade() {
  const [c, g] = canvas(512, 512);
  const [e, ge] = canvas(512, 512);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 512);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  const curtains = ['#d8c7a0', '#b5c4cf', '#e8e0d0', '#c9a38a', '#9fb09a'];
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 128;
    const y = Math.floor(i / 4) * 128;
    // A seam at each floor slab.
    g.fillStyle = '#d9d6cf';
    g.fillRect(x, y + 124, 128, 4);
    const kind = hr(i);
    if (kind < 0.12) continue; // blank wall
    const small = kind < 0.3;
    const wx = x + (small ? 44 : 16);
    const ww = small ? 40 : 96;
    const wy = y + (small ? 26 : 22);
    const wh = small ? 36 : 72;
    g.fillStyle = '#b9bdc2';
    g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
    g.fillStyle = '#39434f';
    g.fillRect(wx, wy, ww, wh);
    // Curtains half drawn, the frame's middle rail.
    g.fillStyle = curtains[i % curtains.length];
    g.fillRect(wx + 2, wy + 2, ww * (0.2 + hr(i + 40) * 0.3), wh - 4);
    g.fillStyle = '#b9bdc2';
    if (!small) g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
    // Sill.
    g.fillStyle = '#8f949a';
    g.fillRect(wx - 6, wy + wh + 4, ww + 12, 4);
    if (hr(i + 7) < 0.45) {
      ge.fillStyle = hr(i + 9) < 0.7 ? '#ffc98a' : '#dfe8ff';
      ge.fillRect(wx, wy, ww, wh);
    }
  }
  return { map: texture(c), emissive: texture(e) };
}

/** Offices: bands of glass between concrete spandrels. */
function officeFacade() {
  const [c, g] = canvas(512, 512);
  const [e, ge] = canvas(512, 512);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 512);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 128;
    const y = Math.floor(i / 4) * 128;
    g.fillStyle = '#44556a';
    g.fillRect(x, y + 30, 128, 86);
    // Reflections: a lighter streak across the glass.
    g.fillStyle = 'rgba(200,215,235,0.25)';
    g.fillRect(x, y + 40, 128, 18);
    g.fillStyle = '#9aa1a8';
    for (let m = 0; m < 4; m++) g.fillRect(x + m * 32, y + 30, 3, 86);
    // Blinds in some.
    if (hr(i + 3) < 0.3) {
      g.fillStyle = 'rgba(220,220,210,0.7)';
      g.fillRect(x + 3, y + 30, 125, 30 + hr(i) * 40);
    }
    if (hr(i + 11) < 0.5) {
      ge.fillStyle = hr(i + 5) < 0.6 ? '#e6eeff' : '#fff0d0';
      ge.fillRect(x, y + 30, 128, 86);
    }
  }
  return { map: texture(c), emissive: texture(e) };
}

/** Ground-floor fronts, 4x2 cells: shop window, glass door, shutter, izakaya / konbini glass, konbini door, lobby, garage. */
function shopfronts() {
  const [c, g] = canvas(512, 256);
  const [e, ge] = canvas(512, 256);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 256);
  const cell = (i: number) => [(i % 4) * 128, Math.floor(i / 4) * 128] as const;
  const glass = (i: number, bright: string, items: boolean) => {
    const [x, y] = cell(i);
    g.fillStyle = '#6d7277';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#2c3440';
    g.fillRect(x + 6, y + 10, 116, 112);
    if (items) {
      for (let k = 0; k < 9; k++) {
        g.fillStyle = ['#d9c07a', '#c85a4a', '#6a9ac2', '#e8e0cf', '#7bb06a'][k % 5];
        g.fillRect(x + 12 + (k % 3) * 36, y + 40 + Math.floor(k / 3) * 26, 28, 18);
      }
    }
    g.fillStyle = '#6d7277';
    g.fillRect(x + 62, y + 10, 4, 112);
    ge.fillStyle = bright;
    ge.fillRect(x + 6, y + 10, 116, 112);
  };
  glass(0, '#b89a70', true);
  // Door.
  {
    const [x, y] = cell(1);
    g.fillStyle = '#6d7277';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#2c3440';
    g.fillRect(x + 30, y + 16, 68, 112);
    g.fillStyle = '#c8ccd0';
    g.fillRect(x + 60, y + 60, 3, 20);
    g.fillRect(x + 66, y + 60, 3, 20);
    ge.fillStyle = '#ffdca8';
    ge.fillRect(x + 30, y + 16, 68, 112);
  }
  // Rolling shutter.
  {
    const [x, y] = cell(2);
    g.fillStyle = '#a9adb2';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#8e9297';
    for (let k = 0; k < 128; k += 6) g.fillRect(x + 4, y + k, 120, 2);
    g.fillStyle = '#5a5e63';
    g.fillRect(x, y, 4, 128);
    g.fillRect(x + 124, y, 4, 128);
  }
  // Izakaya: wooden lattice and a noren curtain over the door.
  {
    const [x, y] = cell(3);
    g.fillStyle = '#5b3a24';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#7a5334';
    for (let k = 4; k < 128; k += 9) g.fillRect(x + k, y + 20, 3, 108);
    g.fillStyle = '#2b3a66';
    for (let k = 0; k < 4; k++) g.fillRect(x + 20 + k * 22, y + 8, 20, 46);
    g.fillStyle = '#f4f1e8';
    g.font = `bold 22px ${JP_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['酒', '処', 'や', 'き'].forEach((ch, k) => g.fillText(ch, x + 30 + k * 22, y + 32));
    ge.fillStyle = '#ffb060';
    for (let k = 4; k < 128; k += 9) ge.fillRect(x + k + 3, y + 60, 6, 68);
  }
  // Konbini glass wall: bright shelves inside.
  {
    const [x, y] = cell(4);
    g.fillStyle = '#e8ecef';
    g.fillRect(x, y, 128, 128);
    for (let r = 0; r < 4; r++) {
      g.fillStyle = '#cfd6dc';
      g.fillRect(x + 4, y + 30 + r * 24, 120, 3);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = ['#e06a4a', '#f2c230', '#4a8ad6', '#6ac27a', '#f4f1e8'][(k + r) % 5];
        g.fillRect(x + 6 + k * 12, y + 18 + r * 24, 9, 12);
      }
    }
    g.fillStyle = '#9aa1a8';
    g.fillRect(x, y, 4, 128);
    g.fillRect(x + 124, y, 4, 128);
    ge.fillStyle = '#f4f8ff';
    ge.fillRect(x + 4, y, 120, 128);
  }
  // Konbini automatic door.
  {
    const [x, y] = cell(5);
    g.fillStyle = '#e8ecef';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#9aa1a8';
    g.fillRect(x + 62, y + 10, 4, 118);
    g.fillRect(x, y, 128, 10);
    ge.fillStyle = '#f4f8ff';
    ge.fillRect(x, y + 10, 128, 118);
  }
  glass(6, '#8a94a6', false); // office lobby
  // Garage / parking shutter with a dark opening.
  {
    const [x, y] = cell(7);
    g.fillStyle = '#b9b3a6';
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#1a1b1e';
    g.fillRect(x + 10, y + 24, 108, 104);
  }
  return { map: texture(c, false), emissive: texture(e, false) };
}

const SIGN_WORDS = ['ラーメン', '居酒屋', '寿司', '喫茶店', '薬局', 'カラオケ', '焼肉', '餃子', 'うどん', 'そば', '花屋', '本屋', '理容室', '酒店', 'たばこ', 'クリーニング', '不動産', '歯科', 'パン屋', '定食', '焼き鳥', 'お好み焼き', '珈琲', 'ゲーム', '銭湯', '電器', '眼鏡', '和菓子', 'ホテル', '中華', 'カレー', 'たこ焼き'];
const SIGN_COLORS: [string, string][] = [
  ['#c8302c', '#fff6e0'],
  ['#1f4e8c', '#ffffff'],
  ['#f2c230', '#1a1a1a'],
  ['#2e7d4f', '#ffffff'],
  ['#f4f1e8', '#b8201c'],
  ['#141518', '#f2c230'],
  ['#e2701f', '#ffffff'],
  ['#6a2e8c', '#ffffff'],
];

/**
 * Sign faces: the top half holds 32 horizontal boards (4 x 8, 256 x 64 px), the bottom half
 * 32 vertical ones (16 x 2, 64 x 256 px). Horizontal 0 is the konbini's, 1 the gas station's.
 */
function signAtlas() {
  const [c, g] = canvas(1024, 1024);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 32; i++) {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 64;
    let [bg, fg] = SIGN_COLORS[i % SIGN_COLORS.length];
    let word = SIGN_WORDS[i];
    if (i === 0) [bg, fg, word] = ['#ffffff', '#2e8b57', 'ヒカリマート'];
    if (i === 1) [bg, fg, word] = ['#c8302c', '#ffffff', 'カゼ石油  KAZE OIL'];
    g.fillStyle = bg;
    g.fillRect(x, y, 256, 64);
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(x + 5, y + 5, 246, 54);
    if (i === 0) {
      // The shop's stripes.
      g.fillStyle = '#2e8b57';
      g.fillRect(x, y + 50, 256, 7);
      g.fillStyle = '#2f5fae';
      g.fillRect(x, y + 57, 256, 7);
    }
    g.fillStyle = fg;
    g.font = `bold ${word.length > 6 ? 30 : 38}px ${JP_FONT}`;
    g.fillText(word, x + 128, y + 32, 236);
  }
  for (let i = 0; i < 32; i++) {
    const x = (i % 16) * 64;
    const y = 512 + Math.floor(i / 16) * 256;
    const [bg, fg] = SIGN_COLORS[(i + 3) % SIGN_COLORS.length];
    const word = SIGN_WORDS[(i * 7) % SIGN_WORDS.length];
    g.fillStyle = bg;
    g.fillRect(x, y, 64, 256);
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(x + 4, y + 4, 56, 248);
    g.fillStyle = fg;
    const chars = [...word].slice(0, 5);
    const size = Math.min(42, 230 / chars.length);
    g.font = `bold ${size}px ${JP_FONT}`;
    chars.forEach((ch, k) => g.fillText(ch, x + 32, y + 128 + (k - (chars.length - 1) / 2) * size * 1.05));
  }
  return texture(c, false);
}

/** UVs for a sign: horizontal board i or vertical board i. */
function signUv(i: number, vertical: boolean) {
  if (!vertical) {
    const u0 = (i % 4) / 4;
    const v1 = 1 - Math.floor(i / 4) / 16;
    const v0 = v1 - 1 / 16;
    return [u0, v0, u0 + 0.25, v0, u0 + 0.25, v1, u0, v1];
  }
  const u0 = (i % 16) / 16;
  const v1 = 0.5 - Math.floor(i / 16) / 4;
  const v0 = v1 - 0.25;
  return [u0, v0, u0 + 1 / 16, v0, u0 + 1 / 16, v1, u0, v1];
}

function shopUv(cell: number) {
  const u0 = (cell % 4) / 4;
  const v1 = 1 - Math.floor(cell / 4) / 2;
  return [u0, v1 - 0.5, u0 + 0.25, v1 - 0.5, u0 + 0.25, v1, u0, v1];
}

function tomareTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = '#f4f1e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold 170px ${JP_FONT}`;
  g.fillText('とまれ', 256, 132, 500);
  return texture(c, false);
}

function glowTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, '#6a6a6a');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return texture(c, false);
}

// ---------------------------------------------------------------------------

const C = (hex: string) => new THREE.Color(hex);
const pick = <T,>(a: T[], t: number) => a[Math.floor(t * a.length) % a.length];

const PALETTE = {
  house: ['#e9e2d0', '#d8cfbd', '#c9c3b8', '#efe9dc', '#b9b3a6', '#d6c7a8', '#a9a49a', '#cdd3cf'],
  roof: ['#3d4552', '#4a4f58', '#5a3a2e', '#2e3036', '#46556a', '#6b4a3a'],
  apartment: ['#e6e1d6', '#d3cabb', '#bfc3c6', '#cdb89a', '#e8dcc8', '#a6a9ab', '#d9c9b0'],
  shop: ['#e2d6c2', '#c9bda8', '#b8b0a2', '#8c7a66', '#d9d2c4', '#c0a78a', '#9aa0a4'],
  office: ['#cfd3d6', '#b8bec4', '#9aa3ab', '#d9d4cb', '#8e959c'],
  tower: ['#aeb8c2', '#8d99a6', '#c4c9ce', '#6f7a86', '#b9b2a6'],
  awning: ['#c8302c', '#2f5d8a', '#2e7d4f', '#d9a43a', '#6a4a8a', '#e8e4dc'],
};

export interface CityScenery extends Scenery {
  update(time: number): void;
}

export function buildCityScenery(scene: THREE.Scene, city: City): CityScenery {
  scene.background = COLORS.skyHorizon.clone();
  scene.fog = new THREE.Fog(COLORS.skyHorizon, 160, 1100);
  const hemi = new THREE.HemisphereLight(COLORS.skyTop, new THREE.Color('#8a8578'), 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  scene.add(sun);
  const sky = buildSky();
  const env = buildEnvironmentScene();
  const B = city.bounds;
  const bounds = { minX: B.x0 - 150, maxX: B.x1 + 150, minZ: B.z0 - 150, maxZ: B.z1 + 150 };
  const mountains = buildMountains(bounds);
  const clouds = buildClouds(bounds);
  scene.add(sky, mountains.group, clouds);

  // Materials.
  const res = residentialFacade();
  const off = officeFacade();
  const shop = shopfronts();
  const facadeMat = (t: { map: THREE.Texture; emissive: THREE.Texture }, glow: string) =>
    new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: glow, emissiveIntensity: 0.15, vertexColors: true, roughness: 0.85, flatShading: true });
  const mats = {
    res: facadeMat(res, '#54493a'),
    office: facadeMat(off, '#40454e'),
    shop: facadeMat(shop, '#5e5040'),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }),
    sign: new THREE.MeshStandardMaterial({ map: signAtlas(), emissive: '#ffffff', emissiveIntensity: 0.15, roughness: 0.5 }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tomare: new THREE.MeshStandardMaterial({ map: tomareTexture(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  mats.sign.emissiveMap = mats.sign.map;
  // Lamp heads, vending machine fronts, lanterns: lit at night.
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd89a', emissiveIntensity: 0.15, roughness: 0.4 });
  const lantern = new THREE.MeshStandardMaterial({ color: '#d8402c', emissive: '#ff6a3a', emissiveIntensity: 0.15, roughness: 0.6 });
  const pool = new THREE.MeshBasicMaterial({ color: '#b08650', map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  // Drawn over the road paint too (which is itself pulled forward to stop flicker).
  Object.assign(pool, { polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const coolPool = pool.clone();
  coolPool.color.set('#8a94a8');

  // Batches per district (so far-off ones can be culled) and material.
  const CHUNK = 240;
  const batches = new Map<string, Batch>();
  const batch = (x: number, z: number, mat: keyof typeof mats) => {
    const k = `${Math.floor((x - B.x0) / CHUNK)},${Math.floor((z - B.z0) / CHUNK)},${mat}`;
    let b = batches.get(k);
    if (!b) batches.set(k, (b = new Batch()));
    return b;
  };

  // ---- Ground: asphalt everywhere in town, sidewalks, lots, pads, grass outside ----
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6f7658', roughness: 1 }));
  outside.position.y = -0.6;
  outside.receiveShadow = true;
  scene.add(outside);
  const asphalt = C('#44474e');
  for (let x = B.x0 - 3; x < B.x1 + 3; x += CHUNK)
    for (let z = B.z0 - 3; z < B.z1 + 3; z += CHUNK) {
      const x1 = Math.min(B.x1 + 3, x + CHUNK);
      const z1 = Math.min(B.z1 + 3, z + CHUNK);
      batch(x + 1, z + 1, 'ground').quad([x, 0, z1], [x1, 0, z1], [x1, 0, z], [x, 0, z], asphalt);
    }
  const sidewalk = C('#a8a59e');
  const curb = C('#c9c6bf');
  const yard = C('#8c877c');
  for (const b of city.blocks) {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const g = batch(cx, cz, 'ground');
    g.box(b.x0, 0, b.z0, b.x1, 0.06, b.z1, curb, { top: sidewalk });
  }
  for (const r of city.inners) batch((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 'ground').box(r.x0, 0.06, r.z0, r.x1, 0.085, r.z1, yard, { faces: [false, false, false, false] });

  // ---- Paint on the roads ----
  const white = C('#e9e6dc');
  const yellow = C('#e0b53a');
  const strip = (axis: 'x' | 'z', at: number, s0: number, s1: number, width: number, color: THREE.Color, y = 0.012) => {
    const [x0, x1, z0, z1] = axis === 'z' ? [at - width / 2, at + width / 2, s0, s1] : [s0, s1, at - width / 2, at + width / 2];
    batch((x0 + x1) / 2, (z0 + z1) / 2, 'paint').quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color);
  };
  const dashes = (axis: 'x' | 'z', at: number, s0: number, s1: number, dash: number, gap: number, width: number, color: THREE.Color) => {
    for (let s = s0 + gap / 2; s + dash <= s1; s += dash + gap) strip(axis, at, s, s + dash, width, color);
  };
  for (const st of city.stretches) {
    const { axis, at, s0, s1 } = st;
    if (s1 - s0 < 2) continue;
    if (st.kind === 'avenue') {
      strip(axis, at - 0.14, s0, s1, 0.13, yellow);
      strip(axis, at + 0.14, s0, s1, 0.13, yellow);
      for (const sd of [-1, 1]) {
        dashes(axis, at + sd * 3, s0 + 6, s1 - 6, 5, 5, 0.13, white);
        strip(axis, at + sd * 5.6, s0, s1, 0.15, white);
      }
    } else if (st.kind === 'street') {
      dashes(axis, at, s0 + 4, s1 - 4, 3, 4, 0.13, white);
      for (const sd of [-1, 1]) strip(axis, at + sd * 3.15, s0, s1, 0.12, white);
    } else {
      for (const sd of [-1, 1]) strip(axis, at + sd * 1.85, s0, s1, 0.12, white);
    }
  }
  const tomare = new Batch();
  for (const m of city.markings) {
    if (m.kind === 'zebra') {
      // Bars along the road, spaced across it.
      for (let o = -m.w / 2 + 0.25; o < m.w / 2; o += 0.9) {
        if (m.axis === 'z') strip('z', m.x + o, m.z - m.d / 2, m.z + m.d / 2, 0.45, white, 0.013);
        else strip('x', m.z + o, m.x - m.d / 2, m.x + m.d / 2, 0.45, white, 0.013);
      }
    } else if (m.kind === 'stop') {
      if (m.axis === 'z') strip('x', m.z, m.x - m.w / 2, m.x + m.w / 2, m.d, white, 0.013);
      else strip('z', m.x, m.z - m.w / 2, m.z + m.w / 2, m.d, white, 0.013);
    } else {
      const y = 0.014;
      const hw = m.w / 2;
      const hd = m.d / 2;
      const { x, z } = m;
      const q =
        m.axis === 'z'
          ? !m.flip
            ? [[x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, y, z - hd], [x - hw, y, z - hd]]
            : [[x + hw, y, z - hd], [x - hw, y, z - hd], [x - hw, y, z + hd], [x + hw, y, z + hd]]
          : !m.flip
            ? [[x + hd, y, z + hw], [x + hd, y, z - hw], [x - hd, y, z - hw], [x - hd, y, z + hw]]
            : [[x - hd, y, z - hw], [x - hd, y, z + hw], [x + hd, y, z + hw], [x + hd, y, z - hw]];
      tomare.quad(q[0], q[1], q[2], q[3], white);
    }
  }
  if (!tomare.empty) {
    const t = tomare.mesh(mats.tomare);
    t.renderOrder = 2;
    scene.add(t);
  }

  // ---- Pads: gas station aprons, coin parking, konbini forecourts, the park ----
  const concrete = C('#b3afa6');
  const grass = C('#7ea35a');
  const gravel = C('#cbbf9f');
  for (const p of city.pads) {
    const r = p.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const g = batch(cx, cz, 'ground');
    if (p.kind === 'park') {
      g.box(r.x0, 0.07, r.z0, r.x1, 0.11, r.z1, grass, { faces: [false, false, false, false] });
      // Gravel path from the street to the shrine.
      const alongX = p.face === 1 || p.face === 3;
      if (alongX) g.box(r.x0, 0.09, cz - 2, r.x1, 0.13, cz + 2, gravel, { faces: [false, false, false, false] });
      else g.box(cx - 2, 0.09, r.z0, cx + 2, 0.13, r.z1, gravel, { faces: [false, false, false, false] });
      continue;
    }
    const col = p.kind === 'gas' ? concrete : C('#4c4f56');
    g.box(r.x0, 0.07, r.z0, r.x1, 0.11, r.z1, col, { faces: [false, false, false, false] });
    if (p.kind === 'parking' || p.kind === 'forecourt') {
      // Bay lines every 2.6 m, running in from the street.
      const alongX = p.face === 0 || p.face === 2;
      const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
      const depth = Math.min(5, (alongX ? r.z1 - r.z0 : r.x1 - r.x0) - 0.5);
      for (let t = 0; t <= len + 0.01; t += 2.6) {
        if (alongX) {
          const x = r.x0 + t;
          const z0 = p.face === 2 ? r.z0 + 0.3 : r.z1 - 0.3 - depth;
          strip('z', x, z0, z0 + depth, 0.12, white, 0.115);
        } else {
          const z = r.z0 + t;
          const x0 = p.face === 1 ? r.x0 + 0.3 : r.x1 - 0.3 - depth;
          strip('x', z, x0, x0 + depth, 0.12, white, 0.115);
        }
      }
    }
    if (p.kind === 'gas') buildCanopy(p.rect, p.face, batch, pool);
  }

  // ---- Buildings ----
  for (const b of city.buildings) buildBuilding(b, batch);
  // A ring of simple buildings outside the wall, so the town carries on into the haze.
  {
    let t = 1;
    const rand = () => hr((t += 1));
    for (let i = 0; i < 360; i++) {
      const side = i % 4;
      const along = rand();
      const out = 8 + rand() * 140;
      const wd = 10 + rand() * 22;
      const dp = 10 + rand() * 22;
      const h = 6 + rand() * rand() * 45;
      let x: number, z: number;
      if (side === 0) [x, z] = [B.x0 + along * (B.x1 - B.x0), B.z0 - out];
      else if (side === 1) [x, z] = [B.x1 + out, B.z0 + along * (B.z1 - B.z0)];
      else if (side === 2) [x, z] = [B.x0 + along * (B.x1 - B.x0), B.z1 + out];
      else [x, z] = [B.x0 - out, B.z0 + along * (B.z1 - B.z0)];
      const color = C(pick(PALETTE.office.concat(PALETTE.apartment), rand()));
      const u0 = Math.floor(rand() * 4) / 4;
      const tall = h > 16;
      batch(x, z, tall ? 'office' : 'res').box(x - wd / 2, 0, z - dp / 2, x + wd / 2, h, z + dp / 2, color, {
        wallUv: (a, y) => [u0 + a / 12, y / (FLOOR * 4)],
        noTop: true,
      });
      batch(x, z, 'plain').box(x - wd / 2, h, z - dp / 2, x + wd / 2, h + 0.4, z + dp / 2, C('#8d8f90'));
    }
  }

  const cityGroup = new THREE.Group();
  for (const [k, b] of batches) {
    const mat = mats[k.split(',')[2] as keyof typeof mats];
    const m = b.mesh(mat);
    m.castShadow = mat !== mats.ground && mat !== mats.paint;
    m.receiveShadow = true;
    if (mat === mats.paint) m.renderOrder = 1;
    cityGroup.add(m);
  }
  scene.add(cityGroup);

  // ---- Street furniture ----
  const props = buildProps(city, lamp, lantern, pool, coolPool);
  scene.add(props.group);
  scene.add(buildWires(city));
  const cars = buildParkedCars(city);
  scene.add(cars);

  const trees = new THREE.Group();
  trees.userData.lod = [];

  return {
    trees,
    sun,
    envScene: env.scene,
    day: {
      scene,
      sun,
      hemi,
      skies: [sky.material as THREE.ShaderMaterial, env.sky],
      haze: mountains.haze,
      clouds: clouds.material as THREE.MeshStandardMaterial,
      lamps: [lamp, lantern, mats.sign, mats.res, mats.office, mats.shop, props.vendFront],
      pools: [pool, coolPool],
      envGround: env.ground,
    } satisfies DayTargets,
    update: props.update,
  };
}

type BatchFn = (x: number, z: number, mat: 'res' | 'office' | 'shop' | 'plain' | 'sign' | 'ground' | 'paint') => Batch;

/** Unit vectors for a building front: out of the building, and along it (to the front's right). */
function frame(face: Facing) {
  const out = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ][face];
  // Looking at the front from the street, the front's right-hand direction.
  const right = [out[1], -out[0]];
  return { out, right: [-right[0], -right[1]] };
}

function buildBuilding(b: Building, batch: BatchFn) {
  const r = b.rect;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const t = b.seed;
  const h = b.height;
  const plain = batch(cx, cz, 'plain');
  const u0 = Math.floor(hr(t * 100) * 4) / 4;
  const v0 = Math.floor(hr(t * 200) * 4) / 4;
  const wallUv = (base: number) => (a: number, y: number) => [u0 + a / 12, v0 + (y - base) / (FLOOR * 4)] as [number, number];
  const { out } = frame(b.face);
  const alongX = b.face === 0 || b.face === 2;
  const frontW = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  // A point on the front face: `a` from the front's middle along it, `o` out from the wall, at height y.
  const front = (a: number, o: number, y: number) => {
    const fx = b.face === 1 ? r.x1 : b.face === 3 ? r.x0 : cx;
    const fz = b.face === 2 ? r.z1 : b.face === 0 ? r.z0 : cz;
    const ax = alongX ? 1 : 0;
    const az = alongX ? 0 : 1;
    return [fx + ax * a + out[0] * o, y, fz + az * a + out[1] * o];
  };
  /** A flat panel on the front: from along a0..a1, height y0..y1, `o` out from the wall, facing out. */
  const panel = (g: Batch, a0: number, a1: number, y0: number, y1: number, o: number, color: THREE.Color, uv?: number[]) => {
    // Counter-clockwise seen from the street: on the north and east faces +along runs to the viewer's left.
    const A = b.face === 0 || b.face === 1 ? [a1, a0] : [a0, a1];
    g.quad(front(A[0], o, y0), front(A[1], o, y0), front(A[1], o, y1), front(A[0], o, y1), color, uv);
  };
  /** A box sticking out of the front: along a0..a1, out o0..o1, height y0..y1. */
  const frontBox = (g: Batch, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, color: THREE.Color, uv?: number[]) => {
    const p = front(a0, o0, 0);
    const q = front(a1, o1, 0);
    g.box(Math.min(p[0], q[0]), y0, Math.min(p[2], q[2]), Math.max(p[0], q[0]), y1, Math.max(p[2], q[2]), color, { uv });
  };

  switch (b.kind) {
    case 'wall': {
      plain.box(r.x0, 0, r.z0, r.x1, h, r.z1, C('#9b988f'), { top: C('#85827a') });
      // A chain-link fence on top.
      plain.box(r.x0, h, r.z0, r.x1, h + 1.4, r.z1, C('#6d7a6a'), { noTop: true });
      return;
    }
    case 'house': {
      const wall = C(pick(PALETTE.house, t));
      batch(cx, cz, 'res').box(r.x0, 0, r.z0, r.x1, h, r.z1, wall, { wallUv: wallUv(0), noTop: true });
      gable(plain, r, h, C(pick(PALETTE.roof, hr(t * 7))), wall);
      // Entrance canopy and a little front wall.
      frontBox(plain, -1.2, 1.2, 0, 0.9, 2.3, 2.45, C('#5a5e63'));
      if (hr(t * 9) < 0.5) frontBox(plain, -frontW / 2 + 0.1, -1.4, 0.5, 0.7, 0, 1.1, C('#b7b1a4'));
      return;
    }
    case 'apartment': {
      const wall = C(pick(PALETTE.apartment, t));
      batch(cx, cz, 'res').box(r.x0, 0, r.z0, r.x1, h, r.z1, wall, { wallUv: wallUv(0), top: C('#8f8f8c') });
      parapet(plain, r, h, wall);
      // Balconies on every floor above the ground.
      const rail = C(hr(t * 3) < 0.5 ? '#e8e6e0' : '#6f7479');
      for (let f = 1; f < b.floors; f++) {
        const y = f * FLOOR;
        frontBox(plain, -frontW / 2 + 0.3, frontW / 2 - 0.3, 0, 1.1, y - 0.12, y + 0.04, C('#bcbab4'));
        frontBox(plain, -frontW / 2 + 0.3, frontW / 2 - 0.3, 1.02, 1.1, y + 0.04, y + 1.05, rail);
        // An air-con unit or some laundry here and there.
        if (hr(t * 50 + f) < 0.5) frontBox(plain, frontW / 2 - 1.6, frontW / 2 - 0.8, 0.1, 0.6, y + 0.04, y + 0.64, C('#e4e2dc'));
        if (hr(t * 70 + f) < 0.3) frontBox(plain, -frontW / 2 + 0.8, -frontW / 2 + 2.6, 0.7, 0.75, y + 0.9, y + 1.9, C(pick(['#e8e0d0', '#9fb5cf', '#d88a7a', '#f2e6a0'], hr(f + t))));
      }
      rooftop(plain, r, h, t);
      return;
    }
    case 'shop':
    case 'office':
    case 'tower': {
      const pal = b.kind === 'shop' ? PALETTE.shop : b.kind === 'office' ? PALETTE.office : PALETTE.tower;
      const wall = C(pick(pal, t));
      const facade = b.kind === 'shop' ? 'res' : 'office';
      const ground = b.kind === 'shop' ? FLOOR + 0.6 : FLOOR;
      batch(cx, cz, facade).box(r.x0, 0, r.z0, r.x1, h, r.z1, wall, { wallUv: wallUv(ground), top: C('#8f8f8c') });
      parapet(plain, r, h, wall);
      rooftop(plain, r, h, t);
      // Ground floor front: bays of shop windows, a door, sometimes a shutter pulled down.
      const shopG = batch(cx, cz, 'shop');
      const bays = Math.max(1, Math.round(frontW / 3.4));
      const bw = frontW / bays;
      const izakaya = b.kind === 'shop' && hr(t * 13) < 0.25;
      const shut = b.kind === 'shop' && hr(t * 17) < 0.15;
      const door = Math.floor(hr(t * 19) * bays);
      for (let i = 0; i < bays; i++) {
        const a0 = -frontW / 2 + i * bw;
        let cell = b.kind === 'shop' ? (i === door ? 1 : 0) : 6;
        if (izakaya) cell = 3;
        if (shut && i !== door) cell = 2;
        panel(shopG, a0 + 0.05, a0 + bw - 0.05, 0, ground - 0.35, 0.03, C('#ffffff'), shopUv(cell));
      }
      // Band over the shopfront, an awning, and the shop's sign.
      frontBox(plain, -frontW / 2, frontW / 2, 0, 0.12, ground - 0.35, ground, wall.clone().multiplyScalar(0.85));
      const signs = batch(cx, cz, 'sign');
      const word = 2 + Math.floor(hr(t * 23) * 30);
      if (b.kind === 'shop') {
        if (hr(t * 29) < 0.6) {
          // Sloping awning.
          const col = C(pick(PALETTE.awning, hr(t * 31)));
          const p0 = front(-frontW / 2 + 0.2, 0.05, ground - 0.4);
          const p1 = front(frontW / 2 - 0.2, 0.05, ground - 0.4);
          const p2 = front(frontW / 2 - 0.2, 1.1, ground - 0.9);
          const p3 = front(-frontW / 2 + 0.2, 1.1, ground - 0.9);
          const under = col.clone().multiplyScalar(0.7);
          if (b.face === 0 || b.face === 1) {
            plain.quad(p0, p1, p2, p3, col);
            plain.quad(p1, p0, p3, p2, under);
          } else {
            plain.quad(p1, p0, p3, p2, col);
            plain.quad(p0, p1, p2, p3, under);
          }
        }
        panel(signs, -Math.min(3.2, frontW / 2 - 0.4), Math.min(3.2, frontW / 2 - 0.4), ground + 0.1, ground + 0.95, 0.14, C('#ffffff'), signUv(word, false));
      }
      // Tall vertical signs stick out from the corners of shops and offices near the busy streets.
      if (b.floors >= 3 && hr(t * 37) < (b.kind === 'tower' ? 0.8 : 0.55)) {
        const a = (frontW / 2 - 0.5) * (hr(t * 41) < 0.5 ? -1 : 1);
        const y0 = ground + 1.2;
        const y1 = Math.min(h - 0.5, y0 + (b.kind === 'shop' ? 4 : 7));
        const p = front(a, 0.2, 0);
        const q = front(a, 1.1, 0);
        const uv = signUv(Math.floor(hr(t * 43) * 32), true);
        signs.box(Math.min(p[0], q[0]) - (alongX ? 0.09 : 0), y0, Math.min(p[2], q[2]) - (alongX ? 0 : 0.09), Math.max(p[0], q[0]) + (alongX ? 0.09 : 0), y1, Math.max(p[2], q[2]) + (alongX ? 0 : 0.09), C('#ffffff'), { uv, noTop: true });
      }
      // A rooftop billboard on some towers.
      if (b.kind === 'tower' && hr(t * 47) < 0.4) {
        const uv = signUv(2 + Math.floor(hr(t * 53) * 30), false);
        const hw = Math.min(8, frontW / 2 - 1);
        frontBox(plain, -hw * 0.6, -hw * 0.6 + 0.2, -3, -2.8, h, h + 1.5, C('#5a5e63'));
        frontBox(plain, hw * 0.6 - 0.2, hw * 0.6, -3, -2.8, h, h + 1.5, C('#5a5e63'));
        panel(signs, -hw, hw, h + 1.5, h + 4.5, -2.8, C('#ffffff'), uv);
      }
      return;
    }
    case 'konbini': {
      const white = C('#f2f2ee');
      plain.box(r.x0, 0, r.z0, r.x1, h, r.z1, white, { top: C('#9a9a96') });
      const shopG = batch(cx, cz, 'shop');
      const bays = Math.max(2, Math.round(frontW / 3));
      const bw = frontW / bays;
      for (let i = 0; i < bays; i++) {
        const a0 = -frontW / 2 + i * bw;
        panel(shopG, a0 + 0.02, a0 + bw - 0.02, 0.1, h - 1.3, 0.03, C('#ffffff'), shopUv(i === bays - 1 ? 5 : 4));
      }
      // Stripes round the top and the sign over the door.
      const bands = ['#2e8b57', '#f2f2ee', '#2f5fae'];
      bands.forEach((col, i) => plain.box(r.x0 - 0.05, h - 1.2 + i * 0.3, r.z0 - 0.05, r.x1 + 0.05, h - 0.9 + i * 0.3, r.z1 + 0.05, C(col), { noTop: true }));
      panel(batch(cx, cz, 'sign'), -Math.min(3.5, frontW / 2 - 0.3), Math.min(3.5, frontW / 2 - 0.3), h - 1.25, h + 0.3, 0.12, C('#ffffff'), signUv(0, false));
      return;
    }
    case 'kiosk': {
      plain.box(r.x0, 0, r.z0, r.x1, h, r.z1, C('#f2f2ee'), { top: C('#9a9a96') });
      const shopG = batch(cx, cz, 'shop');
      panel(shopG, -frontW / 2 + 0.4, frontW / 2 - 0.4, 0.1, h - 0.9, 0.03, C('#ffffff'), shopUv(4));
      frontBox(plain, -frontW / 2, frontW / 2, 0, 0.1, h - 0.8, h, C('#c8302c'));
      return;
    }
    case 'shrine': {
      const wood = C('#8a3a26');
      const dark = C('#2e2a28');
      plain.box(r.x0 - 1, 0, r.z0 - 1, r.x1 + 1, 0.8, r.z1 + 1, C('#9a968c'));
      plain.box(r.x0 + 0.5, 0.8, r.z0 + 0.5, r.x1 - 0.5, h, r.z1 - 0.5, wood, { top: wood });
      gable(plain, { x0: r.x0 - 0.8, z0: r.z0 - 0.8, x1: r.x1 + 0.8, z1: r.z1 + 0.8 }, h, dark, wood, 0.55, 1.2);
      // Offering box and a bell rope out front.
      frontBox(plain, -0.9, 0.9, 1.4, 2.2, 0.8, 1.6, C('#6a4a2a'));
      return;
    }
  }
}

/** A pitched roof, ridge along the longer side, with eaves. */
function gable(g: Batch, r: Rect, y: number, roof: THREE.Color, wall: THREE.Color, pitch = 0.42, eave = 0.45) {
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const e = eave;
  if (W >= D) {
    const zc = (r.z0 + r.z1) / 2;
    const rh = (D / 2) * pitch;
    const x0 = r.x0 - e, x1 = r.x1 + e;
    const drop = e * pitch;
    g.quad([x1, y - drop, r.z0 - e], [x0, y - drop, r.z0 - e], [x0, y + rh, zc], [x1, y + rh, zc], roof);
    g.quad([x0, y - drop, r.z1 + e], [x1, y - drop, r.z1 + e], [x1, y + rh, zc], [x0, y + rh, zc], roof);
    g.tri([r.x0, y, r.z0], [r.x0, y, r.z1], [r.x0, y + rh, zc], wall);
    g.tri([r.x1, y, r.z1], [r.x1, y, r.z0], [r.x1, y + rh, zc], wall);
  } else {
    const xc = (r.x0 + r.x1) / 2;
    const rh = (W / 2) * pitch;
    const z0 = r.z0 - e, z1 = r.z1 + e;
    const drop = e * pitch;
    g.quad([r.x0 - e, y - drop, z0], [r.x0 - e, y - drop, z1], [xc, y + rh, z1], [xc, y + rh, z0], roof);
    g.quad([r.x1 + e, y - drop, z1], [r.x1 + e, y - drop, z0], [xc, y + rh, z0], [xc, y + rh, z1], roof);
    g.tri([r.x1, y, r.z0], [r.x0, y, r.z0], [xc, y + rh, r.z0], wall);
    g.tri([r.x0, y, r.z1], [r.x1, y, r.z1], [xc, y + rh, r.z1], wall);
  }
}

function parapet(g: Batch, r: Rect, h: number, wall: THREE.Color) {
  const c = wall.clone().multiplyScalar(0.9);
  const t = 0.25;
  g.box(r.x0, h, r.z0, r.x1, h + 0.7, r.z0 + t, c);
  g.box(r.x0, h, r.z1 - t, r.x1, h + 0.7, r.z1, c);
  g.box(r.x0, h, r.z0 + t, r.x0 + t, h + 0.7, r.z1 - t, c);
  g.box(r.x1 - t, h, r.z0 + t, r.x1, h + 0.7, r.z1 - t, c);
}

const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
function rooftop(g: Batch, r: Rect, h: number, t: number) {
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  if (W < 6 || D < 6) return;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  // Air-con units and a stairwell hut.
  for (let i = 0; i < 3; i++) {
    const x = r.x0 + 1.5 + hr(t * 60 + i) * (W - 3);
    const z = r.z0 + 1.5 + hr(t * 61 + i) * (D - 3);
    g.box(x - 0.5, h, z - 0.4, x + 0.5, h + 0.8, z + 0.4, C('#d8d6d0'));
  }
  if (hr(t * 62) < 0.6) g.box(cx - 1.4, h, cz - 1.2, cx + 1.4, h + 2.4, cz + 1.2, C('#a9a8a2'));
  // A water tank on legs.
  if (hr(t * 63) < 0.35) {
    const x = r.x0 + 2 + hr(t * 64) * (W - 4);
    const z = r.z0 + 2 + hr(t * 65) * (D - 4);
    g.box(x - 0.9, h, z - 0.9, x + 0.9, h + 1.2, z + 0.9, C('#6d7075'), { noTop: true });
    g.geo(tankGeo, new THREE.Matrix4().compose(new THREE.Vector3(x, h + 2.1, z), new THREE.Quaternion(), new THREE.Vector3(1.1, 1.8, 1.1)), C('#c9c9c4'));
  }
}

/** Gas station canopy on columns over the pump islands, with its red fascia and lights. */
function buildCanopy(r: Rect, face: Facing, batch: BatchFn, pool: THREE.MeshBasicMaterial) {
  void pool;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const alongX = face === 0 || face === 2;
  const fx = face === 1 ? 1 : face === 3 ? -1 : 0;
  const fz = face === 2 ? 1 : face === 0 ? -1 : 0;
  const mx = cx + fx * 2;
  const mz = cz + fz * 2;
  const g = batch(cx, cz, 'plain');
  const hw = alongX ? 8 : 4.5;
  const hd = alongX ? 4.5 : 8;
  const y = 5.2;
  g.box(mx - hw, y, mz - hd, mx + hw, y + 0.3, mz + hd, C('#e8e8e4'));
  // Fascia with the brand's colour, and the sign on the street side.
  g.box(mx - hw - 0.1, y + 0.3, mz - hd - 0.1, mx + hw + 0.1, y + 1.1, mz + hd + 0.1, C('#c8302c'), { top: C('#e8e8e4') });
  // Columns on the islands.
  for (const s of [-1, 1])
    for (const k of [-1, 1]) {
      const x = mx + (alongX ? s * 4.5 : k * 1.6);
      const z = mz + (alongX ? k * 1.6 : s * 4.5);
      g.box(x - 0.18, 0, z - 0.18, x + 0.18, y, z + 0.18, C('#d8d8d4'));
    }
  // The price tower at the corner by the street.
  const tx = face === 1 ? r.x1 - 1 : face === 3 ? r.x0 + 1 : r.x0 + 1.2;
  const tz = face === 2 ? r.z1 - 1 : face === 0 ? r.z0 + 1 : r.z0 + 1.2;
  g.box(tx - 0.5, 0, tz - 0.5, tx + 0.5, 4.4, tz + 0.5, C('#c8302c'));
  const signs = batch(cx, cz, 'sign');
  const uv = signUv(1, false);
  // Brand board on each street-facing side of the fascia.
  const len = alongX ? hw * 1.4 : hd * 1.4;
  if (alongX) {
    const z = fz < 0 ? mz - hd - 0.12 : mz + hd + 0.12;
    const a = fz < 0 ? [mx + len / 2, mx - len / 2] : [mx - len / 2, mx + len / 2];
    signs.quad([a[0], y + 0.35, z], [a[1], y + 0.35, z], [a[1], y + 1.05, z], [a[0], y + 1.05, z], C('#ffffff'), uv);
  } else {
    const x = fx < 0 ? mx - hw - 0.12 : mx + hw + 0.12;
    const a = fx > 0 ? [mz + len / 2, mz - len / 2] : [mz - len / 2, mz + len / 2];
    signs.quad([x, y + 0.35, a[0]], [x, y + 0.35, a[1]], [x, y + 1.05, a[1]], [x, y + 1.05, a[0]], C('#ffffff'), uv);
  }
}

// ---------------------------------------------------------------------------
// Street furniture, instanced.

function buildProps(city: City, lamp: THREE.MeshStandardMaterial, lantern: THREE.MeshStandardMaterial, pool: THREE.MeshBasicMaterial, coolPool: THREE.MeshBasicMaterial) {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const lists = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; ms: THREE.Matrix4[]; cs?: THREE.Color[]; shadow: boolean }>();
  const part = (key: string, geo: () => THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    let l = lists.get(key);
    if (!l) lists.set(key, (l = { geo: geo(), mat, ms: [], shadow }));
    return l;
  };
  /** Add an instance of a part at a prop's position and heading, offset in the prop's frame. */
  const put = (key: string, geo: () => THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, yaw: number, off: [number, number, number], scale: [number, number, number] = [1, 1, 1], color?: THREE.Color, shadow = true) => {
    const l = part(key, geo, mat, shadow);
    q.setFromAxisAngle(up, yaw);
    const o = new THREE.Vector3(...off).applyQuaternion(q);
    l.ms.push(m4.clone().compose(new THREE.Vector3(x + o.x, o.y, z + o.z), q, new THREE.Vector3(...scale)));
    if (color) (l.cs ??= []).push(color);
  };
  const std = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
  const concrete = std('#a9a79f', 0.9);
  const steel = std('#8d9297', 0.45, 0.6);
  const darkSteel = std('#3a3d42', 0.5, 0.4);
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, flatShading: true });
  const trunk = std('#5a4636', 0.9);
  const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
  const vendFront = new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#e8f0ff', emissiveIntensity: 0.15, roughness: 0.3 });
  const poolGeo = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const box = (x: number, y: number, z: number, dy = 0) => () => new THREE.BoxGeometry(x, y, z).translate(0, dy, 0);
  const cyl = (r0: number, r1: number, hh: number, n = 8) => () => new THREE.CylinderGeometry(r0, r1, hh, n).translate(0, hh / 2, 0);
  const blob = () => new THREE.IcosahedronGeometry(1, 1);

  const treeGreens = ['#5f8f45', '#6f9a4a', '#8fb04a', '#4e7d3c'];
  const sakura = ['#f2b6c6', '#f7c9d4', '#eea8bc'];
  const vendColors = ['#c8302c', '#2d6fc2', '#f4f1e8', '#2e8b57'];

  for (const p of city.props) {
    const { x, z, yaw } = p;
    switch (p.kind) {
      case 'pole': {
        put('pole', cyl(0.13, 0.19, 9.2), concrete, x, z, yaw, [0, 0, 0]);
        put('arm', box(1.9, 0.12, 0.12), steel, x, z, yaw, [0, 8.0, 0]);
        put('arm', box(1.2, 0.1, 0.1), steel, x, z, yaw, [0, 7.3, 0]);
        if (p.variant === 1) {
          put('transformer', cyl(0.28, 0.28, 0.9, 10), std('#9ba3a0', 0.6), x, z, yaw, [0.42, 5.6, 0]);
          // A small street light on the pole, over the road.
          put('lampHead', box(0.5, 0.12, 0.22), lamp, x, z, yaw, [0, 5.0, 0.35], [1, 1, 1], undefined, false);
          put('pool', poolGeo, pool, x, z, yaw, [0, 0.03, 0], [10, 1, 10], undefined, false);
        }
        break;
      }
      case 'lamp': {
        put('lampPole', cyl(0.08, 0.12, 7.6), steel, x, z, yaw, [0, 0, 0]);
        put('lampArm', box(0.1, 0.1, 2.1), steel, x, z, yaw, [0, 7.45, -1]);
        put('lampHead', box(0.36, 0.16, 0.75), lamp, x, z, yaw, [0, 7.35, -1.9], [1, 1, 1], undefined, false);
        put('pool', poolGeo, coolPool, x, z, yaw, [0, 0.03, -3.2], [13, 1, 13], undefined, false);
        break;
      }
      case 'tree':
      case 'sakura': {
        const s = 0.8 + ((x * 13.7 + z * 7.1) % 1 + 1) % 1 * 0.5;
        const pink = p.kind === 'sakura';
        const cols = pink ? sakura : treeGreens;
        put('trunk', cyl(0.12, 0.2, 2.6 * s, 6), trunk, x, z, yaw, [0, 0, 0]);
        put('crown', blob, leaf, x, z, yaw, [0, 3.4 * s, 0], [1.9 * s, 1.5 * s, 1.9 * s], C(cols[p.variant % cols.length]));
        put('crown', blob, leaf, x, z, yaw, [0.7 * s, 3.0 * s, 0.4 * s], [1.3 * s, 1.1 * s, 1.3 * s], C(cols[(p.variant + 1) % cols.length]));
        break;
      }
      case 'vending': {
        put('vend', box(0.95, 1.85, 0.72, 0.925), white, x, z, yaw, [0, 0, 0], [1, 1, 1], C(vendColors[p.variant % 4]));
        put('vendFront', box(0.8, 1.05, 0.03), vendFront, x, z, yaw, [0, 1.25, -0.37], [1, 1, 1], undefined, false);
        put('vendSlot', box(0.6, 0.18, 0.04), darkSteel, x, z, yaw, [0, 0.35, -0.37]);
        break;
      }
      case 'pump': {
        put('pump', box(0.55, 1.5, 0.45, 0.75), white, x, z, yaw, [0, 0.15, 0], [1, 1, 1], C('#e8e8e4'));
        put('pumpTop', box(0.65, 0.35, 0.55), std('#c8302c', 0.5), x, z, yaw, [0, 1.85, 0]);
        put('pumpBase', box(1.2, 0.15, 4.8, 0.075), concrete, x, z, yaw + Math.PI / 2, [0, 0, 0]);
        break;
      }
      case 'bench': {
        put('bench', box(1.6, 0.08, 0.45), std('#8a6a4a', 0.8), x, z, yaw, [0, 0.45, 0]);
        put('benchLeg', box(1.5, 0.45, 0.4, 0.225), darkSteel, x, z, yaw, [0, 0, 0], [1, 1, 0.3]);
        break;
      }
      case 'lantern': {
        if (p.variant === 0) {
          put('lantern', () => new THREE.SphereGeometry(1, 10, 8), lantern, x, z, yaw, [0, 2.4, 0], [0.28, 0.42, 0.28], undefined, false);
        } else {
          // Stone lantern at the shrine.
          const stone = std('#8c8a84', 0.95);
          put('stoneBase', box(0.7, 0.9, 0.7, 0.45), stone, x, z, yaw, [0, 0, 0]);
          put('stoneLight', box(0.5, 0.45, 0.5, 0.225), lantern, x, z, yaw, [0, 0.9, 0]);
          put('stoneCap', box(0.95, 0.25, 0.95, 0.125), stone, x, z, yaw, [0, 1.35, 0]);
        }
        break;
      }
      case 'meter': {
        put('meter', box(0.4, 1.3, 0.3, 0.65), std('#d9b43a', 0.5), x, z, yaw, [0, 0, 0]);
        break;
      }
      case 'signal': {
        put('signalPole', cyl(0.1, 0.13, 5.8), steel, x, z, 0, [0, 0, 0]);
        break;
      }
      case 'torii': {
        const red = std('#d2462b', 0.6);
        const blk = std('#1f1d1c', 0.6);
        for (const s of [-1, 1]) put('toriiPillar', cyl(0.28, 0.32, 5.2, 12), red, x, z, yaw, [s * 2.2, 0, 0]);
        put('toriiBeam', box(5.8, 0.4, 0.45), red, x, z, yaw, [0, 4.3, 0]);
        put('toriiTop', box(7.2, 0.35, 0.6), blk, x, z, yaw, [0, 5.25, 0]);
        put('toriiTop2', box(6.4, 0.3, 0.5), red, x, z, yaw, [0, 4.95, 0]);
        break;
      }
    }
  }

  // Signals: an arm out over each road with a horizontal three-lamp head, lit in turn.
  const lampMats = ['#2fd27a', '#ffb020', '#ff3a2a'].map((c) => new THREE.MeshStandardMaterial({ color: '#202225', emissive: c, emissiveIntensity: 0.05, roughness: 0.4 }));
  const phases: THREE.MeshStandardMaterial[][] = [lampMats, lampMats.map((m) => m.clone())];
  const headGeo = new THREE.BoxGeometry(1, 0.38, 0.32);
  const lampGeo = new THREE.BoxGeometry(0.24, 0.24, 0.4);
  const head = part('signalHead', () => headGeo, darkSteel);
  const arm = part('signalArm', () => new THREE.BoxGeometry(1, 0.1, 0.1), steel);
  const lampLists = phases.map((set, i) => set.map((m, k) => part(`signalLamp${i}${k}`, () => lampGeo, m, false)));
  for (const s of city.props) {
    if (s.kind !== 'signal') continue;
    // Which corner: the pole sits off the junction, so the roads are towards -sx and -sz.
    const j = city.signals.reduce((a, b) => (Math.hypot(b.x - s.x, b.z - s.z) < Math.hypot(a.x - s.x, a.z - s.z) ? b : a));
    const sx = Math.sign(s.x - j.x) || 1;
    const sz = Math.sign(s.z - j.z) || 1;
    // Over the road running along z (the head faces along z, lamps across x).
    arm.ms.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x - sx * 1.7, 5.55, s.z), new THREE.Quaternion(), new THREE.Vector3(3.4, 1, 1)));
    head.ms.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x - sx * 3.6, 5.4, s.z), new THREE.Quaternion(), new THREE.Vector3(1.1, 1, 1)));
    [-0.36, 0, 0.36].forEach((o, k) => lampLists[0][k].ms.push(new THREE.Matrix4().makeTranslation(s.x - sx * 3.6 + o * sx, 5.4, s.z)));
    // Over the road running along x.
    const rot = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2);
    arm.ms.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, 5.55, s.z - sz * 1.7), rot, new THREE.Vector3(3.4, 1, 1)));
    head.ms.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, 5.4, s.z - sz * 3.6), rot, new THREE.Vector3(1.1, 1, 1)));
    [-0.36, 0, 0.36].forEach((o, k) => lampLists[1][k].ms.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, 5.4, s.z - sz * 3.6 + o * sz), rot, new THREE.Vector3(1, 1, 1))));
  }

  for (const l of lists.values()) {
    if (!l.ms.length) continue;
    const im = new THREE.InstancedMesh(l.geo, l.mat, l.ms.length);
    l.ms.forEach((m, i) => im.setMatrixAt(i, m));
    if (l.cs) l.cs.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = l.shadow;
    im.receiveShadow = l.mat !== pool && l.mat !== coolPool;
    if (l.mat === pool || l.mat === coolPool) im.renderOrder = 3;
    im.computeBoundingSphere();
    group.add(im);
  }

  /** Cycle the signals: the roads along z get green, then amber, then red while the others go. */
  const update = (time: number) => {
    const t = time % 24;
    const stateA = t < 10 ? 0 : t < 12.5 ? 1 : 2;
    const stateB = t >= 12 && t < 22 ? 0 : t >= 22 && t < 24.5 ? 1 : 2;
    const set = (mats: THREE.MeshStandardMaterial[], st: number) => mats.forEach((m, i) => (m.emissiveIntensity = i === st ? 2.6 : 0.04));
    set(phases[0], stateA);
    set(phases[1], stateB);
  };
  update(0);
  return { group, update, vendFront };
}

/** Sagging wires between the utility poles, three per span. */
function buildWires(city: City) {
  const pts: number[] = [];
  const SEG = 8;
  for (const [x0, z0, x1, z1] of city.wires) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    // Across the span (the crossarm's direction).
    const ax = -dz / len;
    const az = dx / len;
    for (const [off, y, sag] of [
      [-0.85, 8.0, 0.55],
      [0.85, 8.0, 0.55],
      [0.3, 7.3, 0.7],
      [0, 8.6, 0.45],
    ]) {
      for (let i = 0; i < SEG; i++) {
        const a = i / SEG;
        const b = (i + 1) / SEG;
        pts.push(x0 + dx * a + ax * off, y - sag * 4 * a * (1 - a), z0 + dz * a + az * off);
        pts.push(x0 + dx * b + ax * off, y - sag * 4 * b * (1 - b), z0 + dz * b + az * off);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1c1d20' }));
}

/** Parked cars: each car model is merged into one mesh per material, then instanced. */
function buildParkedCars(city: City) {
  const group = new THREE.Group();
  const parked = city.props.filter((p) => p.kind === 'car');
  const paints = ['#e8e4dc', '#1d1f24', '#b8342c', '#8a9aa6', '#2f5d8a', '#d9b43a', '#f4f1e8', '#5a6b5a'];
  const up = new THREE.Vector3(0, 1, 0);
  CARS.forEach((model, mi) => {
    const mine = parked.filter((p) => p.variant % CARS.length === mi);
    if (!mine.length) return;
    const car = buildCarModel(model.body, new THREE.Color('#ffffff'), { low: true });
    car.group.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    car.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.clearGroups();
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
    });
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const im = new THREE.InstancedMesh(merged, mat, mine.length);
      const isPaint = (mat as THREE.MeshStandardMaterial).color?.getHexString() === 'ffffff' && mat instanceof THREE.MeshPhysicalMaterial;
      mine.forEach((p, i) => {
        im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(up, p.yaw), new THREE.Vector3(1, 1, 1)));
        if (isPaint) im.setColorAt(i, new THREE.Color(paints[Math.floor(p.variant / CARS.length) % paints.length]));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      geos.forEach((g) => g.dispose());
    }
  });
  return group;
}

export { faceYaw };
